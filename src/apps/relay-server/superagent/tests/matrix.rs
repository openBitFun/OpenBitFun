//! The fake runtime matrix: three fake devices (a macOS CLI on aarch64, a
//! Windows desktop on x86_64 whose detached worker can be toggled, a Linux
//! CLI on x86_64) behind the `DeviceRpc` trait, and a scripted model that
//! the fake devices relay through `fleet_model_*` (so the real relay client
//! runs too). Every scenario drives the real engine, ledger, slots and
//! encrypted store.

use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use openbitfun_product_domains::fleet::FleetHostKind;
use openbitfun_product_domains::superagent::{RuntimeFacts, SuperagentJobState};
use openbitfun_superagent::api::Service;
use openbitfun_superagent::conversation::Step;
use openbitfun_superagent::device::{BoxFuture, DeviceRpc, DeviceSnapshot, RpcError};
use openbitfun_superagent::directory::{Directory, DirectoryDevice, DirectoryError};
use openbitfun_superagent::engine::{Clock, Engine, EngineConfig, NO_HOLDER_NOTICE};
use openbitfun_superagent::model::{ModelReply, ModelToolCall, RelayModel};
use openbitfun_superagent::slots::{SlotLimits, Slots};
use openbitfun_superagent::store::Store;
use serde_json::{json, Value};

const ACCOUNT: &str = "email-scratch-matrix";
const MAC: &str = "mac-cli";
const WIN: &str = "win-desktop";
const LINUX: &str = "linux-cli";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct FakeJob {
    state: String,
    polls: u32,
    branch: String,
    pending: Vec<String>,
    answered: Vec<String>,
    #[allow(dead_code)]
    source: Value,
}

struct FakeDevice {
    facts: RuntimeFacts,
    jobs: BTreeMap<String, FakeJob>,
    submits: BTreeMap<String, u32>,
    /// Status polls before a running job succeeds (`None`: never by itself).
    finish_after: Option<u32>,
    outcome: &'static str,
    /// The next submit is recorded but the answer is lost (transport break).
    lose_next_submit_answer: bool,
    /// Model polls on this device break (the holder is lost).
    drop_model: bool,
    /// A permission prompt every new job raises.
    prompt_on_start: bool,
}

type Step_ = Box<dyn FnOnce(&[Value]) -> ModelReply + Send>;

#[derive(Default)]
struct FakeFleet {
    devices: Mutex<BTreeMap<String, FakeDevice>>,
    calls: Mutex<Vec<(String, String, Value)>>,
    script: Mutex<VecDeque<Step_>>,
    model_rounds: Mutex<BTreeMap<String, (String, ModelReply)>>,
    holders: Mutex<Vec<String>>,
}

fn device(
    id: &str,
    name: &str,
    kind: FleetHostKind,
    os: &str,
    arch: &str,
    detached: bool,
) -> FakeDevice {
    let mut dispatch = vec![
        "dispatch_target_v1",
        "workspace_target_source_v1",
        "status_summary_only_v1",
        "job_submitter_v1",
        "query_result_summary_v1",
        "workspace_peer_import_v1",
        "workspace_publish_v1",
    ];
    if detached {
        dispatch.push("detached_worker");
    }
    FakeDevice {
        facts: RuntimeFacts {
            device_id: id.into(),
            name: name.into(),
            host_kind: kind,
            os: os.into(),
            arch: arch.into(),
            online: true,
            host_capabilities: vec!["cloud_agent_scope_v1".into(), "fleet_model_v1".into()],
            dispatch_capabilities: dispatch.into_iter().map(String::from).collect(),
            accept_dispatch: true,
            allow_auto_approval: true,
            model_configured: true,
            latency_ms: Some(20),
        },
        jobs: BTreeMap::new(),
        submits: BTreeMap::new(),
        finish_after: Some(2),
        outcome: "pass",
        lose_next_submit_answer: false,
        drop_model: false,
        prompt_on_start: false,
    }
}

impl FakeFleet {
    fn matrix() -> Arc<Self> {
        let fleet = Arc::new(Self::default());
        {
            let mut devices = fleet.devices.lock().unwrap();
            let mut mac = device(MAC, "Mac CLI", FleetHostKind::Cli, "macos", "aarch64", true);
            mac.facts.latency_ms = Some(10);
            devices.insert(MAC.into(), mac);
            devices.insert(
                WIN.into(),
                device(
                    WIN,
                    "Win Desktop",
                    FleetHostKind::Desktop,
                    "windows",
                    "x86_64",
                    false,
                ),
            );
            devices.insert(
                LINUX.into(),
                device(
                    LINUX,
                    "Linux CLI",
                    FleetHostKind::Cli,
                    "linux",
                    "x86_64",
                    true,
                ),
            );
        }
        fleet
    }

    fn with<R>(&self, id: &str, f: impl FnOnce(&mut FakeDevice) -> R) -> R {
        f(self.devices.lock().unwrap().get_mut(id).unwrap())
    }

    fn push(&self, step: impl FnOnce(&[Value]) -> ModelReply + Send + 'static) {
        self.script.lock().unwrap().push_back(Box::new(step));
    }

    fn calls_of(&self, device: &str, command: &str) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(d, c, _)| d == device && c == command)
            .map(|(_, _, a)| a.clone())
            .collect()
    }

    fn submits(&self, device: &str) -> u32 {
        self.with(device, |d| d.submits.values().sum())
    }

    fn handle(&self, device_id: &str, command: &str, args: &Value) -> Result<Value, RpcError> {
        let mut devices = self.devices.lock().unwrap();
        let device = devices
            .get_mut(device_id)
            .ok_or_else(|| RpcError::Offline("unknown device".into()))?;
        if !device.facts.online {
            return Err(RpcError::Offline(format!("mesh_unreachable: {device_id}")));
        }
        if !device
            .facts
            .host_capabilities
            .iter()
            .any(|c| c == "cloud_agent_scope_v1")
        {
            return Err(RpcError::UpdateRequired(
                "superagent_requires_update".into(),
            ));
        }
        let job_id = args
            .get("jobId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        match command {
            "dispatch_target_workspace_provision_source" => {
                let source = args["source"].clone();
                if source["kind"] != "job" {
                    // The target's own request type reads it (unknown fields refused).
                    let request: openbitfun_services_core::dispatch_contract::wire::DispatchWorkspaceProvisionSourceRequest =
                        serde_json::from_value(args.clone()).expect("provision request matches the target DTO");
                    assert!(request.branch.starts_with("openbitfun/dispatch/"));
                }
                if source["kind"] == "job" {
                    let origin = source["sourceDeviceId"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let branch = source["branch"].as_str().unwrap_or_default().to_string();
                    if branch.is_empty() {
                        return Err(RpcError::Refused("no_result_branch".into()));
                    }
                    // Peer import: the origin device must be online (Link).
                    let _ = origin;
                }
                device
                    .jobs
                    .entry(job_id.clone())
                    .or_insert_with(|| FakeJob {
                        state: "provisioned".into(),
                        branch: format!("obf/dispatch/{}", &job_id[..11.min(job_id.len())]),
                        source,
                        ..FakeJob::default()
                    });
                let branch = device.jobs[&job_id].branch.clone();
                Ok(
                    json!({ "pending": false, "provisioned": true, "workspacePath": format!("/work/{job_id}"),
                           "branch": branch, "baseCommit": "a".repeat(40) }),
                )
            }
            "dispatch_target_submit" => {
                assert_eq!(args["submitter"], "cloud");
                let _: openbitfun_services_core::dispatch_contract::wire::DispatchSubmitRequest =
                    serde_json::from_value(args.clone())
                        .expect("submit request matches the target DTO");
                assert!(args.get("summaryOnly").is_none());
                *device.submits.entry(job_id.clone()).or_default() += 1;
                let prompt = device.prompt_on_start;
                let job = device.jobs.entry(job_id.clone()).or_default();
                if job.state == "provisioned" || job.state.is_empty() {
                    job.state = "running".into();
                    if prompt {
                        job.pending.push(format!("perm-{job_id}"));
                    }
                }
                if std::mem::take(&mut device.lose_next_submit_answer) {
                    return Err(RpcError::Transport("connection reset".into()));
                }
                Ok(
                    json!({ "accepted": true, "jobId": job_id, "sessionId": args["sessionId"], "state": "running" }),
                )
            }
            "dispatch_target_status" => {
                let finish_after = device.finish_after;
                let Some(job) = device
                    .jobs
                    .get_mut(&job_id)
                    .filter(|j| j.state != "provisioned")
                else {
                    return Err(RpcError::Refused(format!("unknown dispatch job {job_id}")));
                };
                job.polls += 1;
                if job.state == "running"
                    && job.pending.is_empty()
                    && finish_after.is_some_and(|n| job.polls >= n)
                {
                    job.state = "succeeded".into();
                }
                if args["summaryOnly"] == true {
                    // The target's summary-only answer: no prompt input.
                    let pending: Vec<Value> = job
                        .pending
                        .iter()
                        .map(|id| json!({ "requestId": id, "toolName": "bash" }))
                        .collect();
                    return Ok(
                        json!({ "summaryOnly": true, "state": job.state, "cursor": job.polls,
                                      "pendingPermissions": pending }),
                    );
                }
                let pending: Vec<Value> = job
                    .pending
                    .iter()
                    .map(|id| {
                        json!({ "requestId": id, "action": "bash", "roundId": "r",
                                      "resources": ["cargo test --workspace"] })
                    })
                    .collect();
                Ok(json!({ "state": job.state, "cursor": job.polls, "events": [
                    {"type": "jobState", "state": job.state, "timestamp": "t"},
                    {"type": "agentEvent", "timestamp": "t", "event": {"text": format!("worked on {device_id}")}}
                ], "pendingPermissions": pending, "cursorReset": false, "historyTruncated": false,
                   "eventLogComplete": true, "omittedEventCount": 0 }))
            }
            "dispatch_target_query" => {
                assert_eq!(args["kind"], "resultSummary");
                let job = device
                    .jobs
                    .get(&job_id)
                    .ok_or_else(|| RpcError::Refused("unknown job".into()))?;
                Ok(
                    json!({ "kind": "resultSummary", "jobId": job_id, "sessionId": "s", "state": job.state, "uncommittedChanges": false, "summaryTruncated": false, "summary": format!("Built and tested on {}.\nOUTCOME: {}", device.facts.name, device.outcome),
                           "branch": job.branch, "baseCommit": "a".repeat(40), "headCommit": "b".repeat(40), "commitCount": 1,
                           "diffStat": {"filesChanged": 2, "insertions": 10, "deletions": 3, "files": [{"path": "src/lib.rs", "added": 8, "deleted": 3}]} }),
                )
            }
            "dispatch_target_answer" => {
                let request = args["requestId"].as_str().unwrap_or_default().to_string();
                let job = device
                    .jobs
                    .get_mut(&job_id)
                    .ok_or_else(|| RpcError::Refused("unknown job".into()))?;
                job.pending.retain(|id| *id != request);
                job.answered.push(request);
                Ok(json!({ "accepted": true }))
            }
            "dispatch_target_cancel" => {
                let job = device
                    .jobs
                    .get_mut(&job_id)
                    .ok_or_else(|| RpcError::Refused("unknown job".into()))?;
                job.state = "cancelled".into();
                Ok(json!({ "cancelled": true }))
            }
            "fleet_model_start" => {
                let request = args["request"].clone();
                assert_relay_start_shape(&request);
                let id = request["requestId"].as_str().unwrap().to_string();
                self.holders.lock().unwrap().push(device_id.to_string());
                if device.drop_model {
                    return Err(RpcError::Transport("holder dropped".into()));
                }
                let mut rounds = self.model_rounds.lock().unwrap();
                if !rounds.contains_key(&id) {
                    let step = self
                        .script
                        .lock()
                        .unwrap()
                        .pop_front()
                        .expect("the script has a step for every round");
                    let messages = request["messages"].as_array().cloned().unwrap_or_default();
                    rounds.insert(id.clone(), (device_id.to_string(), step(&messages)));
                }
                Ok(json!({ "requestId": id }))
            }
            "fleet_model_poll" => {
                let id = args["request"]["requestId"].as_str().unwrap().to_string();
                let rounds = self.model_rounds.lock().unwrap();
                let (_, reply) = rounds
                    .get(&id)
                    .ok_or_else(|| RpcError::Refused("unknown request".into()))?;
                Ok(
                    json!({ "requestId": id, "chunks": [{"seq": 1, "text": reply.text}], "nextSeq": 1, "done": true,
                            "result": { "text": reply.text, "finishReason": "stop", "model": "fake",
                                        "usage": {"inputTokens": 10, "outputTokens": 5},
                                        "toolCalls": reply.tool_calls.iter().map(openbitfun_superagent::model::relay_tool_call).collect::<Vec<_>>() } }),
                )
            }
            "dispatch_target_append" => {
                let job = device
                    .jobs
                    .get_mut(&job_id)
                    .ok_or_else(|| RpcError::Refused("unknown job".into()))?;
                assert_eq!(job.state, "running");
                Ok(json!({ "accepted": true, "messageId": args["messageId"] }))
            }
            "dispatch_target_continue" => {
                let job = device
                    .jobs
                    .get_mut(&job_id)
                    .ok_or_else(|| RpcError::Refused("unknown job".into()))?;
                job.state = "running".into();
                job.polls = 0;
                Ok(
                    json!({ "accepted": true, "jobId": job_id, "sessionId": "s", "turnId": args["turnId"], "state": "running" }),
                )
            }
            "fleet_model_cancel" => Ok(json!({ "cancelled": true })),
            other => Err(RpcError::Refused(format!("unknown command {other}"))),
        }
    }
}

impl DeviceRpc for FakeFleet {
    fn devices<'a>(
        &'a self,
        _account_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DeviceSnapshot>, RpcError>> {
        Box::pin(async move {
            Ok(self
                .devices
                .lock()
                .unwrap()
                .values()
                .map(|d| DeviceSnapshot {
                    facts: d.facts.clone(),
                    version: Some("1.1.0".into()),
                    models: vec!["fake-model".into()],
                    workspaces: vec![json!({ "workspaceId": format!("w-{}", d.facts.device_id), "name": "app", "git": {"branch": "main", "dirty": false} })],
                })
                .collect())
        })
    }

    fn call<'a>(
        &'a self,
        _account_id: &'a str,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> BoxFuture<'a, Result<Value, RpcError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((
                device_id.to_string(),
                command.to_string(),
                args.clone(),
            ));
            self.handle(device_id, command, &args)
        })
    }
}

#[derive(Default)]
struct FakeDirectory {
    rows: Mutex<BTreeMap<String, String>>,
}

impl Directory for FakeDirectory {
    fn register<'a>(
        &'a self,
        _account: &'a str,
        device_id: &'a str,
        _name: &'a str,
        public_key: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>> {
        Box::pin(async move {
            self.rows
                .lock()
                .unwrap()
                .insert(device_id.to_string(), public_key.to_string());
            Ok(format!("token-{device_id}"))
        })
    }
    fn unregister<'a>(
        &'a self,
        _account: &'a str,
        device_id: &'a str,
        _token: Option<&'a str>,
    ) -> BoxFuture<'a, Result<(), DirectoryError>> {
        Box::pin(async move {
            self.rows
                .lock()
                .unwrap()
                .remove(device_id)
                .map(|_| ())
                .ok_or(DirectoryError::NotFound)
        })
    }
    fn devices<'a>(
        &'a self,
        _token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, DirectoryError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn device_key<'a>(
        &'a self,
        _token: &'a str,
        _device_id: &'a str,
    ) -> BoxFuture<'a, Result<(String, Option<String>), DirectoryError>> {
        Box::pin(async { Err(DirectoryError::NotFound) })
    }
}

struct ManualClock(AtomicU64);

impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

impl ManualClock {
    fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}

struct Harness {
    _dir: tempfile::TempDir,
    root: std::path::PathBuf,
    fleet: Arc<FakeFleet>,
    clock: Arc<ManualClock>,
    directory: Arc<FakeDirectory>,
    service: Arc<Service>,
    limits: SlotLimits,
}

const MASTER: [u8; 32] = [42u8; 32];

impl Harness {
    async fn new(fleet: Arc<FakeFleet>) -> Self {
        Self::with_limits(fleet, SlotLimits::default()).await
    }

    async fn with_limits(fleet: Arc<FakeFleet>, limits: SlotLimits) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let clock = Arc::new(ManualClock(AtomicU64::new(1_700_000_000_000)));
        let directory = Arc::new(FakeDirectory::default());
        let service = build(&root, &fleet, &clock, &directory, limits.clone());
        service.ensure(ACCOUNT).await.unwrap();
        Self {
            _dir: dir,
            root,
            fleet,
            clock,
            directory,
            service,
            limits,
        }
    }

    /// A new process over the same data (a restart).
    fn restart(&mut self) {
        self.service = build(
            &self.root,
            &self.fleet,
            &self.clock,
            &self.directory,
            self.limits.clone(),
        );
    }

    fn engine(&self) -> &Arc<Engine> {
        &self.service.engine
    }

    async fn call(&self, command: &str, request: Value) -> Result<Value, String> {
        self.service
            .dispatch(ACCOUNT, command, json!({ "request": request }))
            .await
    }

    async fn send(&self, text: &str) -> String {
        let answer = self
            .call(
                "superagent_send",
                json!({ "message": text, "clientMessageId": format!("c-{text}") }),
            )
            .await
            .unwrap();
        answer["conversationId"].as_str().unwrap().to_string()
    }

    async fn step_of(&self, conversation: &str) -> Step {
        let slot = self
            .engine()
            .slots
            .load(ACCOUNT, self.clock.now_ms(), None)
            .await
            .unwrap();
        let mut state = slot.state.lock().await;
        slot.conversation(&mut state, conversation)
            .unwrap()
            .unwrap()
            .turn
            .clone()
            .unwrap()
            .step
    }

    /// Runs the watcher until the turn is finished (or parked with nothing
    /// left to wake it, after `limit` passes).
    async fn settle(&self, conversation: &str, limit: usize) -> Step {
        for _ in 0..limit {
            tokio::time::sleep(Duration::from_millis(5)).await;
            let step = self.step_of(conversation).await;
            if step.is_finished() {
                return step;
            }
            let slot = self
                .engine()
                .slots
                .load(ACCOUNT, self.clock.now_ms(), None)
                .await
                .unwrap();
            self.engine().tick(&slot).await;
        }
        self.step_of(conversation).await
    }

    async fn conversation_result(&self, id: &str) -> Result<Value, String> {
        self.call(
            "superagent_get_conversation",
            json!({ "conversationId": id }),
        )
        .await
    }

    async fn conversation(&self, id: &str) -> Value {
        self.call(
            "superagent_get_conversation",
            json!({ "conversationId": id }),
        )
        .await
        .unwrap()
    }
}

fn build(
    root: &std::path::Path,
    fleet: &Arc<FakeFleet>,
    clock: &Arc<ManualClock>,
    directory: &Arc<FakeDirectory>,
    limits: SlotLimits,
) -> Arc<Service> {
    let store = Arc::new(Store::open(root, MASTER).unwrap());
    let slots = Arc::new(Slots::new(store, limits));
    let rpc: Arc<dyn DeviceRpc> = fleet.clone();
    let engine = Engine::new(
        slots,
        Arc::clone(&rpc),
        Arc::new(RelayModel::new(rpc)),
        clock.clone(),
        EngineConfig::default(),
    );
    Service::new(engine, directory.clone())
}

fn call(name: &str, arguments: Value) -> ModelReply {
    ModelReply {
        text: String::new(),
        tool_calls: vec![ModelToolCall {
            id: String::new(),
            name: name.into(),
            arguments,
        }],
        ..ModelReply::default()
    }
}

fn calls(list: Vec<(&str, Value)>) -> ModelReply {
    ModelReply {
        tool_calls: list
            .into_iter()
            .map(|(name, arguments)| ModelToolCall {
                id: String::new(),
                name: name.into(),
                arguments,
            })
            .collect(),
        ..ModelReply::default()
    }
}

fn say(text: &str) -> ModelReply {
    ModelReply {
        text: text.into(),
        ..ModelReply::default()
    }
}

/// Tool results the model has seen, newest last.
fn results(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .filter(|m| m["role"] == "tool")
        .map(|m| {
            serde_json::from_str(m["content"].as_str().unwrap_or("null")).unwrap_or(Value::Null)
        })
        .collect()
}

fn last(messages: &[Value]) -> Value {
    results(messages).pop().unwrap_or(Value::Null)
}

fn ws(device: &str) -> Value {
    json!({ "kind": "workspace", "workspaceId": format!("w-{device}") })
}

fn dispatch_args(target: &str, source: Value, group: &str) -> Value {
    json!({ "target": target, "source": source, "instructions": "Build and run the tests. End with OUTCOME: pass or fail.", "group": group, "label": target })
}

/// The device side rejects unknown fields (`superagent_relay::dto`): every
/// start uses exactly its field names, tool arguments as JSON text.
fn assert_relay_start_shape(request: &Value) {
    let keys = |value: &Value, allowed: &[&str]| {
        for key in value.as_object().unwrap().keys() {
            assert!(allowed.contains(&key.as_str()), "unknown relay field {key}");
        }
    };
    keys(
        request,
        &[
            "requestId",
            "model",
            "system",
            "messages",
            "tools",
            "maxOutputTokens",
        ],
    );
    for message in request["messages"].as_array().unwrap() {
        keys(
            message,
            &[
                "role",
                "content",
                "toolCalls",
                "toolCallId",
                "name",
                "isError",
            ],
        );
        for call in message["toolCalls"].as_array().into_iter().flatten() {
            keys(call, &["id", "name", "arguments"]);
            assert!(call["arguments"].is_string());
        }
    }
    for tool in request["tools"].as_array().unwrap() {
        keys(tool, &["name", "description", "parameters"]);
    }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

#[tokio::test]
async fn build_linux_then_test_matrix() {
    let fleet = FakeFleet::matrix();
    fleet.with(WIN, |d| {
        d.facts.dispatch_capabilities.push("detached_worker".into())
    });
    let h = Harness::new(Arc::clone(&fleet)).await;
    let linux_job = Arc::new(Mutex::new(String::new()));
    fleet.push(|_| call("fleet_list_runtimes", json!({})));
    fleet.push(|_| call("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "build")));
    {
        let linux_job = Arc::clone(&linux_job);
        fleet.push(move |m| {
            let id = last(m)["jobId"].as_str().unwrap().to_string();
            *linux_job.lock().unwrap() = id.clone();
            call(
                "fleet_wait",
                json!({ "jobIds": [id], "until": "all_terminal", "timeout": 600 }),
            )
        });
    }
    {
        let linux_job = Arc::clone(&linux_job);
        fleet.push(move |m| {
            assert_eq!(last(m)["jobs"][0]["state"], "done");
            let source = json!({ "kind": "job", "jobId": *linux_job.lock().unwrap() });
            calls(vec![
                ("fleet_dispatch", dispatch_args(MAC, source.clone(), "test")),
                ("fleet_dispatch", dispatch_args(WIN, source.clone(), "test")),
                ("fleet_dispatch", dispatch_args(LINUX, source, "test")),
            ])
        });
    }
    fleet.push(|m| {
        let r = results(m);
        assert!(
            r[r.len() - 3..].iter().all(|v| v["jobId"].is_string()),
            "{r:?}"
        );
        call(
            "fleet_wait",
            json!({ "groupId": "test", "until": "all_terminal", "timeout": 600 }),
        )
    });
    fleet.push(|m| {
        let jobs = last(m)["jobs"].as_array().unwrap().clone();
        assert_eq!(jobs.len(), 3);
        assert!(jobs.iter().all(|j| j["state"] == "done"), "{jobs:?}");
        calls(
            jobs.iter()
                .map(|j| ("fleet_job_result", json!({ "jobId": j["jobId"] })))
                .collect(),
        )
    });
    fleet.push(|m| {
        let r = results(m);
        assert!(r[r.len() - 3..]
            .iter()
            .all(|v| v["summary"].as_str().unwrap().contains("OUTCOME: pass")));
        say("Linux built it; macOS, Windows and Linux all pass.")
    });
    let conversation = h.send("build on linux then test everywhere").await;
    assert_eq!(h.settle(&conversation, 200).await, Step::Done);
    // Each test job imported the build job's branch from its device.
    for device in [MAC, WIN, LINUX] {
        let provisions = fleet.calls_of(device, "dispatch_target_workspace_provision_source");
        assert!(
            provisions
                .iter()
                .any(|a| a["source"]["kind"] == "job" && a["source"]["sourceDeviceId"] == LINUX),
            "{device}"
        );
    }
    assert_eq!(fleet.submits(LINUX), 2);
    assert_eq!(fleet.submits(MAC), 1);
    assert_eq!(fleet.submits(WIN), 1);
    let view = h.conversation(&conversation).await;
    assert_eq!(view["cards"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn win_without_detached_worker() {
    let fleet = FakeFleet::matrix();
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| call("fleet_list_runtimes", json!({})));
    fleet.push(|m| {
        let runtimes = last(m)["runtimes"].as_array().unwrap().clone();
        let win = runtimes.iter().find(|r| r["deviceId"] == WIN).unwrap();
        assert_eq!(win["dispatch"]["allowed"], false);
        assert_eq!(win["dispatch"]["reason"], "detached_worker_unsupported");
        assert_eq!(win["os"], "windows");
        assert_eq!(win["arch"], "x86_64");
        let mac = runtimes.iter().find(|r| r["deviceId"] == MAC).unwrap();
        assert_eq!(mac["dispatch"]["allowed"], true);
        call("fleet_dispatch", dispatch_args(WIN, ws(WIN), "g"))
    });
    fleet.push(|m| {
        assert_eq!(last(m)["error"]["code"], "detached_worker_unsupported");
        say("Windows cannot run detached jobs yet.")
    });
    let conversation = h.send("run on windows").await;
    assert_eq!(h.settle(&conversation, 50).await, Step::Done);
    assert!(fleet.calls_of(WIN, "dispatch_target_submit").is_empty());
    assert!(fleet
        .calls_of(WIN, "dispatch_target_workspace_provision_source")
        .is_empty());
    // Toggled on, the same device takes the job.
    fleet.with(WIN, |d| {
        d.facts.dispatch_capabilities.push("detached_worker".into())
    });
    fleet.push(|_| call("fleet_dispatch", dispatch_args(WIN, ws(WIN), "g")));
    fleet.push(|m| {
        assert!(last(m)["jobId"].is_string());
        say("Started on Windows.")
    });
    let again = h.call("superagent_send", json!({ "conversationId": conversation, "message": "try again", "clientMessageId": "c2" })).await.unwrap();
    assert_eq!(again["conversationId"], conversation.as_str());
    assert_eq!(h.settle(&conversation, 50).await, Step::Done);
    assert_eq!(fleet.submits(WIN), 1);
}

#[tokio::test]
async fn fan_out_and_compare() {
    let fleet = FakeFleet::matrix();
    fleet.with(WIN, |d| {
        d.facts.dispatch_capabilities.push("detached_worker".into())
    });
    fleet.with(WIN, |d| d.outcome = "fail");
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| {
        calls(vec![
            ("fleet_dispatch", dispatch_args(MAC, ws(MAC), "cmp")),
            ("fleet_dispatch", dispatch_args(WIN, ws(WIN), "cmp")),
            ("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "cmp")),
        ])
    });
    fleet.push(|_| {
        call(
            "fleet_wait",
            json!({ "groupId": "cmp", "until": "all_terminal" }),
        )
    });
    fleet.push(|m| {
        let jobs = last(m)["jobs"].as_array().unwrap().clone();
        calls(
            jobs.iter()
                .map(|j| ("fleet_job_result", json!({ "jobId": j["jobId"] })))
                .collect(),
        )
    });
    fleet.push(|m| {
        let r = results(m);
        let outcomes: Vec<String> = r[r.len() - 3..]
            .iter()
            .map(|v| {
                v["summary"]
                    .as_str()
                    .unwrap()
                    .lines()
                    .last()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(outcomes.iter().filter(|o| o.ends_with("pass")).count(), 2);
        assert_eq!(outcomes.iter().filter(|o| o.ends_with("fail")).count(), 1);
        for v in &r[r.len() - 3..] {
            assert_eq!(v["diffStat"]["filesChanged"], 2);
            assert!(v["durationMs"].is_u64());
        }
        say("macOS and Linux pass; Windows fails.")
    });
    let conversation = h.send("compare on all").await;
    assert_eq!(h.settle(&conversation, 100).await, Step::Done);
    let view = h.conversation(&conversation).await;
    let cards = view["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 3);
    assert!(cards
        .iter()
        .all(|c| c["state"] == "done" && c["diffStat"]["insertions"] == 10));
}

#[tokio::test]
async fn blocked_prompt_escalates() {
    let fleet = FakeFleet::matrix();
    fleet.with(LINUX, |d| d.prompt_on_start = true);
    let h = Harness::new(Arc::clone(&fleet)).await;
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    let mut events = slot.events.subscribe(None);
    fleet.push(|_| call("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "b")));
    fleet.push(|m| {
        call(
            "fleet_wait",
            json!({ "jobIds": [last(m)["jobId"]], "until": "any_blocked" }),
        )
    });
    fleet.push(|m| {
        let job = last(m)["jobs"][0].clone();
        assert_eq!(job["state"], "blocked");
        let prompt = job["pendingPrompt"]["requestId"]
            .as_str()
            .unwrap()
            .to_string();
        call(
            "fleet_job_answer",
            json!({ "jobId": job["jobId"], "promptId": prompt, "decision": "once" }),
        )
    });
    fleet.push(|m| {
        assert_eq!(last(m)["answered"], true);
        call(
            "fleet_wait",
            json!({ "groupId": "b", "until": "all_terminal" }),
        )
    });
    fleet.push(|_| say("It asked to run a command; I allowed it once and the job finished."));
    let conversation = h.send("run with a prompt").await;
    assert_eq!(h.settle(&conversation, 100).await, Step::Done);
    // The blocked card reached frontends, then the answer note.
    let batch = events.next_batch(10_000).await;
    let cards: Vec<&Value> = batch
        .events
        .iter()
        .filter(|e| e.event == "superagent://card-changed")
        .map(|e| &e.payload["card"])
        .collect();
    assert!(cards
        .iter()
        .any(|c| c["state"] == "blocked" && c["pendingPrompt"]["requestId"].is_string()));
    assert!(cards
        .iter()
        .any(|c| c["lastAnswer"]["answeredBy"] == "superagent"));
    let answers = fleet.calls_of(LINUX, "dispatch_target_answer");
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0]["reply"], "once");
    // A prompt the model leaves stays on the card for the user.
    fleet.push(|_| call("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "b2")));
    fleet.push(|m| {
        call(
            "fleet_wait",
            json!({ "jobIds": [last(m)["jobId"]], "until": "any_blocked" }),
        )
    });
    fleet.push(|_| say("A job is waiting for your approval."));
    let c2 = h
        .call(
            "superagent_send",
            json!({ "conversationId": conversation, "message": "again", "clientMessageId": "c3" }),
        )
        .await
        .unwrap();
    assert_eq!(
        h.settle(c2["conversationId"].as_str().unwrap(), 100).await,
        Step::Done
    );
    let view = h.conversation(&conversation).await;
    let cards = view["cards"].as_array().unwrap();
    assert!(
        cards
            .iter()
            .any(|c| c["state"] == "blocked" && c["actions"]["answer"]["allowed"] == true),
        "{cards:?}"
    );
}

#[tokio::test]
async fn offline_queue_exactly_once() {
    let fleet = FakeFleet::matrix();
    fleet.with(LINUX, |d| d.facts.online = false);
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| {
        let mut args = dispatch_args(LINUX, ws(LINUX), "q");
        args["queueIfOffline"] = json!(true);
        call("fleet_dispatch", args)
    });
    fleet.push(|m| {
        let r = last(m);
        assert_eq!(r["state"], "queued");
        assert_eq!(r["stateReason"], "waiting_for_device");
        say("Queued until the Linux host is back.")
    });
    let conversation = h.send("queue it").await;
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    for _ in 0..5 {
        h.engine().tick(&slot).await;
    }
    assert_eq!(fleet.submits(LINUX), 0);
    // The device comes back; several presence changes race.
    fleet.with(LINUX, |d| d.facts.online = true);
    let engine = Arc::clone(h.engine());
    let ticks: Vec<_> = (0..4)
        .map(|_| {
            let engine = Arc::clone(&engine);
            let slot = Arc::clone(&slot);
            tokio::spawn(async move { engine.tick(&slot).await })
        })
        .collect();
    for tick in ticks {
        tick.await.unwrap();
    }
    for _ in 0..3 {
        h.engine().tick(&slot).await;
    }
    assert_eq!(fleet.submits(LINUX), 1, "exactly one submit");
    let ids: std::collections::BTreeSet<String> = fleet
        .calls_of(LINUX, "dispatch_target_submit")
        .iter()
        .map(|a| a["jobId"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 1);
    // A queued job whose window runs out ends as failed: expired.
    fleet.with(MAC, |d| d.facts.online = false);
    fleet.push(|_| {
        let mut args = dispatch_args(MAC, ws(MAC), "q2");
        args["queueIfOffline"] = json!(true);
        call("fleet_dispatch", args)
    });
    fleet.push(|_| say("Queued."));
    h.call(
        "superagent_send",
        json!({ "conversationId": conversation, "message": "mac too", "clientMessageId": "c9" }),
    )
    .await
    .unwrap();
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    h.clock.advance(25 * 60 * 60 * 1000);
    h.engine().tick(&slot).await;
    let state = slot.state.lock().await;
    let job = state
        .ledger
        .jobs
        .values()
        .find(|j| j.device_id == MAC)
        .unwrap();
    assert_eq!(job.state, SuperagentJobState::Failed);
    assert_eq!(job.state_reason.as_deref(), Some("expired"));
    assert_eq!(fleet.submits(MAC), 0);
}

#[tokio::test]
async fn no_holder_parks() {
    let fleet = FakeFleet::matrix();
    for id in [MAC, WIN, LINUX] {
        fleet.with(id, |d| d.facts.model_configured = false);
    }
    let h = Harness::new(Arc::clone(&fleet)).await;
    let conversation = h.send("hello").await;
    let step = h.settle(&conversation, 10).await;
    assert!(matches!(step, Step::Parked { .. }), "{step:?}");
    let view = h.conversation(&conversation).await;
    let card = view["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "card")
        .unwrap()
        .clone();
    assert_eq!(card["text"], NO_HOLDER_NOTICE);
    assert_eq!(card["card"]["kind"], "no_holder");
    assert!(
        fleet.holders.lock().unwrap().is_empty(),
        "no model call while parked"
    );
    // A device with a model comes online: the turn starts by itself.
    fleet.with(LINUX, |d| d.facts.model_configured = true);
    fleet.push(|_| say("Hello!"));
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    assert_eq!(*fleet.holders.lock().unwrap(), vec![LINUX.to_string()]);
}

#[tokio::test]
async fn holder_lost_retries() {
    let fleet = FakeFleet::matrix();
    fleet.with(WIN, |d| d.facts.model_configured = false);
    fleet.with(MAC, |d| d.drop_model = true);
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| say("Answered from another device."));
    let conversation = h.send("hi").await;
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    // Both CLIs rank by latency: the Mac first; it drops, Linux answers.
    assert_eq!(
        *fleet.holders.lock().unwrap(),
        vec![MAC.to_string(), LINUX.to_string()]
    );
    let view = h.conversation(&conversation).await;
    let reply = view["messages"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|m| m["role"] == "assistant")
        .unwrap()
        .clone();
    assert_eq!(reply["text"], "Answered from another device.");
}

#[tokio::test]
async fn restart_no_duplicate() {
    let fleet = FakeFleet::matrix();
    fleet.with(LINUX, |d| d.lose_next_submit_answer = true);
    fleet.with(LINUX, |d| d.finish_after = None);
    let mut h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| call("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "r")));
    fleet.push(|m| {
        // The submit's answer was lost: still queued, not failed.
        assert_eq!(last(m)["state"], "queued");
        say("Started.")
    });
    let conversation = h.send("start a job").await;
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    assert_eq!(fleet.submits(LINUX), 1);
    // The process restarts; the watcher reconciles through status.
    h.restart();
    h.engine().recover().await;
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    for _ in 0..3 {
        h.engine().tick(&slot).await;
    }
    assert_eq!(
        fleet.submits(LINUX),
        1,
        "no duplicate submit after the restart"
    );
    let state = slot.state.lock().await;
    let job = state.ledger.jobs.values().next().unwrap();
    assert_eq!(
        job.phase,
        openbitfun_product_domains::superagent::LedgerJobPhase::Submitted
    );
    assert_eq!(job.state, SuperagentJobState::Working);
    drop(state);
    // A restart mid-turn (a tool step written but not run) re-derives the
    // same job id: still one submit per job.
    let calls_before = fleet.calls_of(LINUX, "dispatch_target_submit").len();
    h.restart();
    h.engine().recover().await;
    assert_eq!(
        fleet.calls_of(LINUX, "dispatch_target_submit").len(),
        calls_before
    );
}

#[tokio::test]
async fn frontends_gone_turn_completes() {
    let fleet = FakeFleet::matrix();
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| call("fleet_dispatch", dispatch_args(MAC, ws(MAC), "f")));
    fleet.push(|m| {
        call(
            "fleet_wait",
            json!({ "jobIds": [last(m)["jobId"]], "until": "all_terminal", "timeout": 3600 }),
        )
    });
    fleet.push(|_| say("Done while you were away."));
    let conversation = h.send("do it while I am away").await;
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    assert_eq!(slot.attached(), 0);
    // Only the watcher runs (no frontend calls).
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(5)).await;
        h.engine().tick_all().await;
        if h.step_of(&conversation).await.is_finished() {
            break;
        }
    }
    assert_eq!(h.step_of(&conversation).await, Step::Done);
    assert!(
        h.engine().watched_accounts().is_empty(),
        "nothing left to watch"
    );
}

#[tokio::test]
async fn idle_unload_reload_encrypted() {
    let fleet = FakeFleet::matrix();
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| say("The secret word is PELICAN."));
    let conversation = h.send("tell me the secret word").await;
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    assert_eq!(h.engine().slots.resident_count(), 1);
    h.clock.advance(11 * 60 * 1000);
    h.engine().tick_all().await;
    assert_eq!(
        h.engine().slots.resident_count(),
        0,
        "the idle slot unloaded"
    );
    // Nothing on disk holds the conversation, the account id or the key.
    for file in walk(&h.root) {
        let bytes = std::fs::read(&file).unwrap();
        for needle in [&b"PELICAN"[..], b"secret word", ACCOUNT.as_bytes()] {
            assert!(
                !bytes.windows(needle.len()).any(|w| w == needle),
                "{}",
                file.display()
            );
        }
        assert!(!file.display().to_string().contains(ACCOUNT));
    }
    // A reload reads it back.
    let view = h.conversation(&conversation).await;
    assert!(view["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["text"] == "The secret word is PELICAN."));
    assert_eq!(h.engine().slots.resident_count(), 1);
}

#[tokio::test]
async fn slot_memory_bound() {
    let fleet = FakeFleet::matrix();
    let limits = SlotLimits {
        max_slot_bytes: 512 * 1024,
        max_resident: 3,
        ..SlotLimits::default()
    };
    let h = Harness::with_limits(Arc::clone(&fleet), limits).await;
    let big = "x".repeat(30 * 1024);
    for index in 0..30 {
        let text = format!("{index} {big}");
        fleet.push(move |_| say(&text));
        let conversation = h
            .call("superagent_send", json!({ "message": format!("{index} {big}"), "clientMessageId": format!("big-{index}") }))
            .await
            .unwrap()["conversationId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    }
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    assert!(
        slot.resident_bytes() <= 512 * 1024,
        "{}",
        slot.resident_bytes()
    );
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert_eq!(list["conversations"].as_array().unwrap().len(), 30);
    drop(slot);
    // LRU: more accounts than resident slots unload the idle ones.
    for index in 0..5 {
        h.service
            .ensure(&format!("email-other-{index}"))
            .await
            .unwrap();
    }
    assert!(
        h.engine().slots.resident_count() <= 3,
        "{}",
        h.engine().slots.resident_count()
    );
    // A long conversation keeps its window resident and the rest in history.
    fleet.push(|_| say("ok"));
    let id = h.send("turn 0").await;
    assert_eq!(h.settle(&id, 30).await, Step::Done);
    for index in 1..25 {
        fleet.push(|_| say("ok"));
        h.call("superagent_send", json!({ "conversationId": id, "message": format!("turn {index}"), "clientMessageId": format!("t-{index}") })).await.unwrap();
        assert_eq!(h.settle(&id, 30).await, Step::Done);
    }
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    let state = slot.state.lock().await;
    let resident = state
        .conversations
        .get(&id)
        .map(|c| (c.messages.len(), c.history_count));
    drop(state);
    if let Some((window, history)) = resident {
        assert!(window <= 2 * Engine::window_turns(), "{window}");
        assert!(history >= 8, "{history}");
    }
    let page = h
        .call(
            "superagent_get_conversation",
            json!({ "conversationId": id, "cursor": 10 }),
        )
        .await
        .unwrap();
    assert_eq!(page["messages"].as_array().unwrap().len(), 10);
    assert_eq!(page["messages"][0]["text"], "turn 0");
}

#[tokio::test]
async fn delete_data_shreds() {
    let fleet = FakeFleet::matrix();
    fleet.with(LINUX, |d| d.finish_after = None);
    let h = Harness::new(Arc::clone(&fleet)).await;
    let device_id = openbitfun_superagent::crypto::cloud_device_id(&MASTER, ACCOUNT);
    assert!(h.directory.rows.lock().unwrap().contains_key(&device_id));
    fleet.push(|_| call("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "d")));
    fleet.push(|_| say("Started."));
    let conversation = h.send("start").await;
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    let backup: Vec<(std::path::PathBuf, Vec<u8>)> = walk(&h.root)
        .into_iter()
        .map(|p| {
            let b = std::fs::read(&p).unwrap();
            (p, b)
        })
        .collect();
    let answer = h
        .call("superagent_delete_data", json!({ "cancelJobs": true }))
        .await
        .unwrap();
    assert_eq!(answer["deleted"], true);
    assert_eq!(answer["jobsCancelled"], 1);
    assert_eq!(fleet.calls_of(LINUX, "dispatch_target_cancel").len(), 1);
    assert!(
        !h.directory.rows.lock().unwrap().contains_key(&device_id),
        "directory row revoked"
    );
    let error = h.call("superagent_status", json!({})).await.unwrap_err();
    assert!(error.starts_with("superagent_not_provisioned"), "{error}");
    // Restoring the old files (a backup) opens nothing: the data key is gone.
    let store = Store::open(&h.root, MASTER).unwrap();
    for (path, bytes) in &backup {
        if path.file_name().is_some_and(|n| n != "key.wrap")
            && path.to_string_lossy().contains("/accounts/")
            && !path
                .to_string_lossy()
                .contains(&store.dir_name("openbitfun-superagent:watch"))
        {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
    }
    let reborn = store.account(ACCOUNT, true).unwrap();
    assert!(reborn.read("ledger").is_err() || reborn.read("ledger").unwrap().is_none());
    assert!(reborn.read("meta").is_err());
    // The operator drops the useless restored files.
    std::fs::remove_dir_all(reborn.path()).unwrap();
    drop(reborn);
    // Turning it back on is one step (first use provisions again).
    h.service.ensure(ACCOUNT).await.unwrap();
    assert!(
        h.call("superagent_status", json!({})).await.unwrap()["enabled"]
            .as_bool()
            .unwrap()
    );
}

#[tokio::test]
async fn send_is_exactly_once_and_cancel_keeps_jobs() {
    let fleet = FakeFleet::matrix();
    fleet.with(MAC, |d| d.finish_after = None);
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| call("fleet_dispatch", dispatch_args(MAC, ws(MAC), "x")));
    fleet.push(|m| {
        call(
            "fleet_wait",
            json!({ "jobIds": [last(m)["jobId"]], "until": "all_terminal", "timeout": 3600 }),
        )
    });
    let first = h
        .call(
            "superagent_send",
            json!({ "message": "go", "clientMessageId": "same" }),
        )
        .await
        .unwrap();
    let retry = h
        .call(
            "superagent_send",
            json!({ "message": "go", "clientMessageId": "same" }),
        )
        .await
        .unwrap();
    assert_eq!(first["conversationId"], retry["conversationId"]);
    assert_eq!(retry["duplicate"], true);
    let id = first["conversationId"].as_str().unwrap().to_string();
    let step = h.settle(&id, 20).await;
    assert!(matches!(step, Step::Parked { .. }), "{step:?}");
    let cancelled = h
        .call("superagent_cancel_turn", json!({ "conversationId": id }))
        .await
        .unwrap();
    assert_eq!(cancelled["cancelled"], true);
    assert_eq!(h.step_of(&id).await, Step::Cancelled);
    assert!(
        fleet.calls_of(MAC, "dispatch_target_cancel").is_empty(),
        "cancelling a turn never cancels jobs"
    );
    let status = h.call("superagent_status", json!({})).await.unwrap();
    assert_eq!(status["liveJobs"], 1);
    // Off: sends are refused; on again: they work.
    h.call("superagent_disable", json!({})).await.unwrap();
    let refused = h
        .call(
            "superagent_send",
            json!({ "message": "x", "clientMessageId": "off" }),
        )
        .await
        .unwrap_err();
    assert!(refused.starts_with("superagent_disabled"), "{refused}");
    h.call("superagent_enable", json!({})).await.unwrap();
    let unknown = h.call("superagent_confirm", json!({})).await.unwrap_err();
    assert!(
        unknown.starts_with("unsupported_in_native_host"),
        "{unknown}"
    );
}

fn walk(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk(&path));
            } else {
                out.push(path);
            }
        }
    }
    out
}

#[tokio::test]
async fn ui_projections_and_conversation_commands() {
    let fleet = FakeFleet::matrix();
    fleet.with(LINUX, |d| d.finish_after = None);
    fleet.with(MAC, |d| d.prompt_on_start = true);
    let h = Harness::new(Arc::clone(&fleet)).await;
    let linux_job = Arc::new(Mutex::new(String::new()));
    fleet.push(|_| {
        calls(vec![
            ("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "ui")),
            ("fleet_dispatch", dispatch_args(MAC, ws(MAC), "ui")),
        ])
    });
    {
        let linux_job = Arc::clone(&linux_job);
        fleet.push(move |m| {
            let r = results(m);
            let id = r[r.len() - 2]["jobId"].as_str().unwrap().to_string();
            *linux_job.lock().unwrap() = id.clone();
            say(&format!("Started {id} on Linux and one on the Mac."))
        });
    }
    let conversation = h.send("start two jobs").await;
    assert_eq!(h.settle(&conversation, 30).await, Step::Done);
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    h.engine().tick(&slot).await;
    h.engine().tick(&slot).await;
    let linux_job = linux_job.lock().unwrap().clone();

    // (a) status
    let status = h.call("superagent_status", json!({})).await.unwrap();
    assert!(status["suggestions"].as_array().unwrap().len() <= 3);
    assert!(status["placeholder"].is_string());
    assert_eq!(status["signedIn"], true);
    assert_eq!(
        status["workingNow"]["needsYou"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        status["workingNow"]["working"][0]["jobId"],
        linux_job.as_str()
    );

    // (b) list: rollup, unread, groups, cursor
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert_eq!(list["conversations"][0]["rollup"], "needs_you");
    assert_eq!(list["conversations"][0]["unread"], true);
    assert_eq!(list["groups"][0]["id"], "today");
    assert_eq!(list["timeZone"], "UTC");
    let shanghai = h
        .call(
            "superagent_list_conversations",
            json!({ "timeZone": "Asia/Shanghai", "locale": "zh-CN" }),
        )
        .await
        .unwrap();
    assert_eq!(shanghai["timeZone"], "Asia/Shanghai");
    let bogus = h
        .call(
            "superagent_list_conversations",
            json!({ "timeZone": "Mars/Base" }),
        )
        .await
        .unwrap();
    assert_eq!(bogus["timeZone"], "UTC");
    let zh = h
        .call("superagent_status", json!({ "locale": "zh-TW" }))
        .await
        .unwrap();
    assert_eq!(zh["locale"], "zh-TW");
    let zh_tw: Value = serde_json::from_str(include_str!("../locales/zh-TW.json")).unwrap();
    assert_eq!(zh["placeholder"], zh_tw["composer.placeholder"]);
    let fallback = h
        .call("superagent_status", json!({ "locale": "fr-FR" }))
        .await
        .unwrap();
    assert_eq!(fallback["locale"], "en-US");
    assert!(list["nextCursor"].is_null());

    // (c) the conversation: a jobs message where they were dispatched,
    // citations, no raw tool messages; (d) card fields.
    let view = h.conversation(&conversation).await;
    let messages = view["messages"].as_array().unwrap();
    assert!(messages.iter().all(|m| m["role"] != "tool"));
    let jobs: Vec<&Value> = messages.iter().filter(|m| m["role"] == "jobs").collect();
    assert_eq!(jobs.len(), 2);
    assert!(jobs.iter().any(|m| m["jobIds"][0] == linux_job.as_str()));
    let reply = messages.iter().find(|m| m["role"] == "assistant").unwrap();
    assert_eq!(reply["citations"][0]["jobId"], linux_job.as_str());
    let card = view["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["jobId"] == linux_job.as_str())
        .unwrap()
        .clone();
    assert!(card["sessionId"].is_string() && card["updatedMs"].is_u64());
    assert_eq!(card["seen"], false);
    for card in view["cards"].as_array().unwrap() {
        if let Some(reason) = card["stateReason"].as_str() {
            assert!(
                [
                    "waiting_for_device",
                    "submitting",
                    "expired",
                    "device_offline"
                ]
                .contains(&reason)
                    || reason.contains(' '),
                "{reason}"
            );
        }
    }
    // Opened: the row is no longer unread, and cards read as seen.
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert_eq!(list["conversations"][0]["unread"], false);
    let again = h.conversation(&conversation).await;
    assert!(again["cards"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["seen"] == true));

    // (e) Steer from the card.
    let steered = h
        .call("superagent_job_action", json!({ "jobId": linux_job, "action": "message", "text": "also run lint", "clientMessageId": "s1" }))
        .await
        .unwrap();
    assert_eq!(steered["outcome"], "steered");
    assert_eq!(fleet.calls_of(LINUX, "dispatch_target_append").len(), 1);

    // (f) rename and delete; deleting never cancels jobs.
    h.call(
        "superagent_rename_conversation",
        json!({ "conversationId": conversation, "title": "Two jobs" }),
    )
    .await
    .unwrap();
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert_eq!(list["conversations"][0]["title"], "Two jobs");
    let deleted = h
        .call(
            "superagent_delete_conversation",
            json!({ "conversationId": conversation }),
        )
        .await
        .unwrap();
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["jobsLeftRunning"], 2);
    assert!(fleet.calls_of(LINUX, "dispatch_target_cancel").is_empty());
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert!(list["conversations"].as_array().unwrap().is_empty());
    assert!(h.conversation_result(&conversation).await.is_err());
    assert_eq!(
        h.call("superagent_status", json!({})).await.unwrap()["liveJobs"],
        2
    );
}

#[tokio::test]
async fn follow_up_message_starts_a_finished_job() {
    let fleet = FakeFleet::matrix();
    let h = Harness::new(Arc::clone(&fleet)).await;
    fleet.push(|_| call("fleet_dispatch", dispatch_args(LINUX, ws(LINUX), "f")));
    fleet.push(|m| {
        call(
            "fleet_wait",
            json!({ "jobIds": [last(m)["jobId"]], "until": "all_terminal" }),
        )
    });
    fleet.push(|_| say("Done."));
    let conversation = h.send("one job").await;
    assert_eq!(h.settle(&conversation, 50).await, Step::Done);
    let job = fleet.calls_of(LINUX, "dispatch_target_submit")[0]["jobId"]
        .as_str()
        .unwrap()
        .to_string();
    let started = h
        .call(
            "superagent_job_action",
            json!({ "jobId": job, "action": "message", "text": "now add docs" }),
        )
        .await
        .unwrap();
    assert_eq!(started["outcome"], "started");
    assert_eq!(fleet.calls_of(LINUX, "dispatch_target_continue").len(), 1);
}

#[tokio::test]
async fn fleet_digest_hints_and_prompt_payload() {
    let fleet = FakeFleet::matrix();
    fleet.with(MAC, |d| d.prompt_on_start = true);
    let h = Harness::new(Arc::clone(&fleet)).await;
    let slot = h
        .engine()
        .slots
        .load(ACCOUNT, h.clock.now_ms(), None)
        .await
        .unwrap();
    let mut events = slot.events.subscribe(Some(0));
    fleet.push(|_| {
        let mut args = dispatch_args(MAC, ws(MAC), "p");
        args["approval"] = json!("remote");
        call("fleet_dispatch", args)
    });
    fleet.push(|m| {
        call(
            "fleet_wait",
            json!({ "jobIds": [last(m)["jobId"]], "until": "any_blocked" }),
        )
    });
    fleet.push(|_| say("A job waits for your approval."));
    let conversation = h.send("needs a prompt").await;
    assert_eq!(h.settle(&conversation, 50).await, Step::Done);

    // The card carries what the prompt asks for (from the full status,
    // since the summary-only answer has no input).
    let view = h.conversation(&conversation).await;
    let card = view["cards"][0].clone();
    assert_eq!(card["state"], "blocked");
    assert_eq!(card["pendingPrompt"]["command"], "cargo test --workspace");
    assert_eq!(card["pendingPrompt"]["summary"], "cargo test --workspace");
    let full_reads = fleet
        .calls_of(MAC, "dispatch_target_status")
        .iter()
        .filter(|a| a.get("summaryOnly").is_none())
        .count();
    assert_eq!(full_reads, 1, "one full read for the new prompt");

    // The cloud partition: one assistant workspace, the conversation as a
    // waiting session, the prompt routed to the job's device.
    let digest = h.call("fleet_digest", json!({})).await.unwrap();
    let device_id = openbitfun_superagent::crypto::cloud_device_id(&MASTER, ACCOUNT);
    assert_eq!(digest["deviceId"], device_id.as_str());
    assert_eq!(digest["full"], true);
    assert_eq!(digest["workspaces"][0]["kind"], "assistant");
    assert_eq!(digest["sessions"][0]["sessionId"], conversation.as_str());
    assert_eq!(digest["sessions"][0]["status"], "waiting");
    assert_eq!(digest["sessions"][0]["needsAttention"], true);
    // Prompts stay in the job device's own partition (no duplicate here).
    assert!(digest["prompts"].as_array().unwrap().is_empty());
    let parsed: openbitfun_product_domains::fleet::FleetDigest =
        serde_json::from_value(digest.clone()).unwrap();
    assert_eq!(parsed.sessions.len(), 1);

    // Change hints with rising revisions reached the stream.
    let batch = events.next_batch(10_000).await;
    let revisions: Vec<u64> = batch
        .events
        .iter()
        .filter(|e| e.event == "fleet://digest-changed")
        .map(|e| e.payload["revision"].as_u64().unwrap())
        .collect();
    assert!(revisions.len() >= 3, "{revisions:?}");
    assert!(revisions.windows(2).all(|w| w[0] < w[1]));
    assert_eq!(
        digest["revision"].as_u64().unwrap(),
        *revisions.last().unwrap()
    );

    // Replay within this instance; another instance has no history here.
    let instance = digest["instanceId"].as_str().unwrap();
    let replay = h
        .call(
            "fleet_replay",
            json!({ "afterSeq": 0, "instanceId": instance, "max": 5 }),
        )
        .await
        .unwrap();
    assert_eq!(replay["historyGone"], false);
    assert_eq!(replay["events"].as_array().unwrap().len(), 5);
    assert_eq!(replay["events"][0]["seq"], 1);
    let other = h
        .call(
            "fleet_replay",
            json!({ "afterSeq": 0, "instanceId": "old", "max": 5 }),
        )
        .await
        .unwrap();
    assert_eq!(other["historyGone"], true);
    // A rename is a change too.
    let before = slot
        .digest_revision
        .load(std::sync::atomic::Ordering::Acquire);
    h.call(
        "superagent_rename_conversation",
        json!({ "conversationId": conversation, "title": "Approve" }),
    )
    .await
    .unwrap();
    assert!(
        slot.digest_revision
            .load(std::sync::atomic::Ordering::Acquire)
            > before
    );
}
