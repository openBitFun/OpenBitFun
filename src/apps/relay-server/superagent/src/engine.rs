//! The thin turn loop and the watcher.
//!
//! The superagent is an input box, a model and a set of management tools.
//! The loop is only: a model round, the tool calls it asked for, parking on
//! `fleet_wait`, and finishing. Which device does the work, how work fans
//! out and how results compare is the model's decision through the tools.
//! The one answer that does not come from the model is the infrastructure
//! fact that no device can run the model now: the turn ends at once with a
//! notice naming the devices and what to do (it never waits on a device;
//! queued jobs for offline devices are unaffected).
//!
//! A conversation runs on Auto (the backend picks the holder: the last one,
//! then a desktop, then the lowest latency, with that device's primary
//! model) or on the device and model the user picked
//! (`Conversation::pinned_holder` + `model_id`).
//!
//! Every step is persisted before the next one starts, so a restart resumes
//! a turn where it stopped. Dispatches are written ahead to the ledger with
//! deterministic job ids (from the turn, the tool call and the target), so a
//! repeated step reconciles through status instead of submitting twice.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Weak};

use openbitfun_product_domains::superagent::{
    self as contract, no_holder_notice, pinned_model_holder, project_job_card, project_job_state,
    rank_model_holders, wait_satisfied, HolderChoice, JobCardFacts, JobPendingPrompt,
    JobStateFacts, LedgerJobPhase, ModelHolderCandidate, RuntimeFacts, SuperagentJobState,
    SuperagentTool, SuperagentToolCall, TargetJobState, SUPERAGENT_CARD_CHANGED_EVENT,
    SUPERAGENT_TURN_DELTA_EVENT,
};
use serde_json::{json, Value};
use tokio::sync::{Notify, Semaphore};

use crate::conversation::{
    truncate_text, Conversation, Message, Role, Step, Turn, Wait, MAX_MESSAGE_TEXT_BYTES,
    MAX_TOOL_RESULT_BYTES, WINDOW_TURNS,
};
use crate::device::{DeviceRpc, DeviceSnapshot, RpcError};
use crate::ledger::{JobRecord, DEFAULT_QUEUE_TTL_MS};
use crate::model::{DeltaSink, ModelError, ModelHolder, ModelReply, ModelRequest, ModelToolCall};
use crate::slots::{Slot, SlotState, Slots};
use crate::wire;

pub trait Clock: Send + Sync + 'static {
    fn now_ms(&self) -> u64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        openbitfun_obp::now_ms()
    }
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Model rounds one turn may use (a user-visible quota).
    pub max_rounds_per_turn: u32,
    /// Jobs one turn may submit (a quota as well).
    pub max_dispatch_per_turn: u32,
    pub max_output_tokens: u32,
    /// Concurrent model rounds in the process.
    pub model_rounds_global: usize,
    /// How long a job queued for an offline device waits by default.
    pub queue_ttl_ms: u64,
    pub system_prompt: String,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            max_rounds_per_turn: 64,
            max_dispatch_per_turn: 64,
            max_output_tokens: 8192,
            model_rounds_global: 64,
            queue_ttl_ms: DEFAULT_QUEUE_TTL_MS,
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        }
    }
}

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are Super Agent, the OpenBitFun agent for all of the user's devices. \
The user's desktops and command-line hosts are runtimes that do the real work: you plan, hand work to them with \
fleet_dispatch, follow it with fleet_wait and fleet_job_status, read results with fleet_job_result, and report back. \
Look at the runtimes with fleet_list_runtimes before you choose one. Fan out to several runtimes when it helps and \
compare their results yourself. Permission prompts of a job are answered by the user on their devices, never by you. \
Read a job transcript only when the user asks for it.";

/// The no-holder card (the one answer that is not the model's); its text
/// is `policy::no_holder_notice`.
pub const NO_HOLDER_CARD: &str = "no_holder";

/// Accounts that need the watcher (live jobs or unfinished turns).
const WATCH_ACCOUNT: &str = "openbitfun-superagent:watch";
const WATCH_RECORD: &str = "watch";

pub struct Engine {
    pub slots: Arc<Slots>,
    pub rpc: Arc<dyn DeviceRpc>,
    pub model: Arc<dyn ModelHolder>,
    pub clock: Arc<dyn Clock>,
    pub config: EngineConfig,
    global_rounds: Arc<Semaphore>,
    watch: std::sync::Mutex<BTreeSet<String>>,
    submitting: std::sync::Mutex<BTreeSet<(String, String)>>,
    cancels: std::sync::Mutex<HashMap<(String, String), Arc<Notify>>>,
    this: Weak<Engine>,
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}

/// A job id that a repeated step derives again (exactly-once dispatch).
pub fn derived_job_id(turn_id: &str, tool_call_id: &str, target: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("{turn_id}\n{tool_call_id}\n{target}").as_bytes());
    format!("sa-{}", crate::crypto::hex(&digest[..16]))
}

fn derived_uuid(seed: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(seed.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).to_string()
}

fn tool_error(code: &str, message: impl Into<String>) -> Value {
    json!({ "error": { "code": code, "message": message.into() } })
}

fn facts_by_id<'a>(devices: &'a [DeviceSnapshot], device_id: &str) -> Option<&'a DeviceSnapshot> {
    devices
        .iter()
        .find(|device| device.facts.device_id == device_id)
}

fn has(capabilities: &[String], wanted: &str) -> bool {
    capabilities.iter().any(|capability| capability == wanted)
}

impl Engine {
    pub fn new(
        slots: Arc<Slots>,
        rpc: Arc<dyn DeviceRpc>,
        model: Arc<dyn ModelHolder>,
        clock: Arc<dyn Clock>,
        config: EngineConfig,
    ) -> Arc<Self> {
        slots.set_clock(Arc::clone(&clock));
        let watch = slots
            .store()
            .account(WATCH_ACCOUNT, true)
            .ok()
            .and_then(|store| store.read_json::<Vec<String>>(WATCH_RECORD).ok().flatten())
            .unwrap_or_default();
        Arc::new_cyclic(|this| Self {
            global_rounds: Arc::new(Semaphore::new(config.model_rounds_global.max(1))),
            slots,
            rpc,
            model,
            clock,
            config,
            watch: std::sync::Mutex::new(watch.into_iter().collect()),
            submitting: std::sync::Mutex::new(BTreeSet::new()),
            cancels: std::sync::Mutex::new(HashMap::new()),
            this: this.clone(),
        })
    }

    pub fn now(&self) -> u64 {
        self.clock.now_ms()
    }

    fn arc(&self) -> Arc<Self> {
        self.this.upgrade().expect("the engine outlives its tasks")
    }

    // ------------------------------------------------------------------
    // Watch set
    // ------------------------------------------------------------------

    pub fn watched_accounts(&self) -> Vec<String> {
        self.watch
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .cloned()
            .collect()
    }

    fn set_watched(&self, account_id: &str, watched: bool) {
        let changed = {
            let mut watch = self.watch.lock().unwrap_or_else(|p| p.into_inner());
            if watched {
                watch.insert(account_id.to_string())
            } else {
                watch.remove(account_id)
            }
        };
        if changed {
            let list = self.watched_accounts();
            if let Ok(store) = self.slots.store().account(WATCH_ACCOUNT, true) {
                if let Err(error) = store.write_json(WATCH_RECORD, &list) {
                    log::warn!("Superagent watch list not saved: {}", error);
                }
            }
        }
    }

    fn needs_watch(state: &SlotState) -> bool {
        // History waiting for a device is watched too (`archive`).
        !state.outbox.is_empty()
            || state.legacy_pending
            || state.ledger.has_live_jobs()
            || state
                .conversations
                .values()
                .any(|conversation| conversation.active_turn().is_some())
    }

    fn update_watch(&self, slot: &Slot, state: &SlotState) {
        self.set_watched(&slot.account_id, Self::needs_watch(state));
    }

    pub fn forget_account(&self, account_id: &str) {
        self.set_watched(account_id, false);
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    /// The fleet change hint for entries following this node: the index
    /// refreshes its cloud partition (`fleet_digest`) on it.
    pub fn digest_changed(&self, slot: &Slot) {
        let revision = slot
            .digest_revision
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
            + 1;
        slot.events.publish(
            openbitfun_product_domains::fleet::FLEET_DIGEST_CHANGED_EVENT,
            json!({ "revision": revision }),
        );
    }

    fn publish_turn(&self, slot: &Slot, conversation: &Conversation, delta: Option<&str>) {
        if delta.is_none() {
            self.digest_changed(slot);
        }
        let turn = conversation.turn.as_ref();
        slot.events.publish(
            SUPERAGENT_TURN_DELTA_EVENT,
            json!({
                "conversationId": conversation.id,
                "turnId": turn.map(|turn| turn.id.clone()),
                "step": turn.map(|turn| turn.step.name()),
                "text": delta,
                "messageCount": conversation.messages.len() as u64 + conversation.history_count,
            }),
        );
    }

    pub fn job_card(&self, job: &JobRecord, devices: Option<&[DeviceSnapshot]>) -> Value {
        self.job_card_seen(job, devices, None)
    }

    /// The card, with `seen` against the conversation's last view.
    pub fn job_card_seen(
        &self,
        job: &JobRecord,
        devices: Option<&[DeviceSnapshot]>,
        seen_ms: Option<u64>,
    ) -> Value {
        let device = devices
            .and_then(|devices| facts_by_id(devices, &job.device_id))
            .map(|device| device.facts.clone())
            .unwrap_or_else(|| RuntimeFacts {
                device_id: job.device_id.clone(),
                ..RuntimeFacts::default()
            });
        let facts = JobCardFacts {
            job_id: job.job_id.clone(),
            state: JobStateFacts {
                ledger: job.phase,
                target: (job.target_state != TargetJobState::Unknown).then_some(job.target_state),
                device_online: device.online,
                pending_prompts: u32::from(job.pending_prompt.is_some()),
            },
            device,
            title: job.title.clone(),
            branch: job.branch.clone(),
            group_id: job.group_id.clone(),
            label: job.label.clone(),
            diff_stat: job.diff_stat.clone(),
            pending_prompts: job.pending_prompt.iter().cloned().collect(),
            last_answer: job.last_answer.clone(),
        };
        let mut card = serde_json::to_value(project_job_card(&facts)).unwrap_or(Value::Null);
        // The ledger's own terminal reasons (refused submit, expiry) win.
        if job.state.is_terminal() || job.phase == LedgerJobPhase::Expired {
            card["state"] = serde_json::to_value(job.state).unwrap_or(Value::Null);
            match &job.state_reason {
                Some(reason) => card["stateReason"] = Value::String(reason.clone()),
                None => {
                    if let Some(card) = card.as_object_mut() {
                        card.remove("stateReason");
                    }
                }
            }
        }
        // Additive fields (frontends ignore what they do not know).
        if let Some(reason) = card.get("stateReason").and_then(Value::as_str) {
            card["stateReason"] = Value::String(state_reason_for_display(reason, job));
        }
        if let (Some(prompt), Some(summary)) = (
            card.get_mut("pendingPrompt").filter(|p| p.is_object()),
            job.pending_prompt_summary.as_ref(),
        ) {
            if prompt.get("requestId").and_then(Value::as_str) == Some(summary.request_id.as_str())
            {
                prompt["summary"] = Value::String(summary.summary.clone());
                if let Some(command) = &summary.command {
                    prompt["command"] = Value::String(command.clone());
                }
            }
        }
        card["sessionId"] = Value::String(job.session_id.clone());
        card["updatedMs"] = json!(job.updated_ms);
        card["summaryLine"] = json!(summary_line(job));
        card["seen"] = json!(seen_ms.is_some_and(|seen| seen >= job.updated_ms));
        card
    }

    fn publish_card(&self, slot: &Slot, job: &JobRecord, devices: Option<&[DeviceSnapshot]>) {
        self.digest_changed(slot);
        slot.events.publish(
            SUPERAGENT_CARD_CHANGED_EVENT,
            json!({ "card": self.job_card(job, devices), "conversationId": job.conversation_id }),
        );
    }

    // ------------------------------------------------------------------
    // Frontend entry points
    // ------------------------------------------------------------------

    /// `superagent_send` keeping the conversation's model choice.
    pub async fn send(
        &self,
        slot: &Arc<Slot>,
        conversation_id: Option<&str>,
        message: &str,
        client_message_id: &str,
    ) -> Result<Value, String> {
        self.send_with_model(slot, conversation_id, message, client_message_id, None)
            .await
    }

    /// `superagent_set_model`: the conversation's model choice (`None`:
    /// Auto). It applies from the next model round.
    pub async fn set_model(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        pick: Option<contract::SuperagentModelPick>,
    ) -> Result<(), String> {
        self.ensure_conversation(slot, conversation_id).await?;
        let now = self.now();
        let mut state = slot.state.lock().await;
        let conversation = slot
            .conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "not_found: no such conversation".to_string())?;
        if conversation.model_pick() == pick {
            return Ok(());
        }
        conversation.set_model_pick(pick);
        conversation.updated_ms = now;
        let snapshot = conversation.clone();
        slot.save_conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?;
        drop(state);
        self.publish_turn(slot, &snapshot, None);
        Ok(())
    }

    /// `superagent_send`: exactly once per `clientMessageId`. `model`
    /// (`Some`) sets the conversation's model choice first (`Some(None)`:
    /// Auto); a new conversation starts with it.
    pub async fn send_with_model(
        &self,
        slot: &Arc<Slot>,
        conversation_id: Option<&str>,
        message: &str,
        client_message_id: &str,
        model: Option<Option<contract::SuperagentModelPick>>,
    ) -> Result<Value, String> {
        if message.trim().is_empty() {
            return Err("invalid_request: the message is empty".into());
        }
        if message.len() > contract::MAX_MESSAGE_BYTES {
            return Err("invalid_request: the message is too long".into());
        }
        if client_message_id.is_empty() || client_message_id.len() > 128 {
            return Err("invalid_request: clientMessageId is required".into());
        }
        // A conversation that left the working set comes back from the
        // devices first.
        if let Some(id) = conversation_id {
            self.ensure_conversation(slot, id).await?;
        }
        let now = self.now();
        let mut state = slot.state.lock().await;
        if !state.meta.enabled {
            return Err("superagent_disabled: Super Agent is turned off for this account".into());
        }
        let id = match conversation_id {
            Some(id) => id.to_string(),
            None => {
                // A retried first send finds the conversation it created.
                let existing = state
                    .conversations
                    .values()
                    .find(|conversation| conversation.client_ids.contains_key(client_message_id))
                    .map(|conversation| conversation.id.clone());
                match existing {
                    Some(id) => id,
                    None => {
                        let id = derived_uuid(&format!("{}\n{client_message_id}", slot.account_id));
                        let title = truncate_text(message.lines().next().unwrap_or("").trim(), 80);
                        if slot
                            .conversation(&mut state, &id)
                            .map_err(|e| e.to_string())?
                            .is_none()
                        {
                            state
                                .conversations
                                .insert(id.clone(), Conversation::new(id.clone(), title, now));
                        }
                        id
                    }
                }
            }
        };
        let conversation = slot
            .conversation(&mut state, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "not_found: no such conversation".to_string())?;
        if let Some(message_id) = conversation.client_ids.get(client_message_id) {
            let turn_id = conversation.turn.as_ref().map(|turn| turn.id.clone());
            return Ok(
                json!({ "conversationId": id, "messageId": message_id, "turnId": turn_id, "duplicate": true }),
            );
        }
        if conversation.active_turn().is_some() {
            return Err("turn_in_progress: wait for the current turn or cancel it".into());
        }
        if let Some(pick) = model {
            conversation.set_model_pick(pick);
        }
        let message_id = new_id("m");
        let turn = Turn {
            id: new_id("t"),
            step: Step::ModelRound,
            started_ms: now,
            updated_ms: now,
            max_rounds: self.config.max_rounds_per_turn,
            ..Turn::default()
        };
        let turn_id = turn.id.clone();
        conversation.messages.push(Message {
            id: message_id.clone(),
            role: Role::User,
            text: message.to_string(),
            client_message_id: Some(client_message_id.to_string()),
            turn_id: Some(turn_id.clone()),
            at_ms: now,
            ..Message::default()
        });
        conversation
            .client_ids
            .insert(client_message_id.to_string(), message_id.clone());
        conversation.turn = Some(turn);
        conversation.updated_ms = now;
        let snapshot = conversation.clone();
        slot.save_conversation(&mut state, &id)
            .map_err(|e| e.to_string())?;
        // A new conversation may push an idle one out of the working set.
        crate::archive::enforce_working_set(slot, &mut state, now);
        self.update_watch(slot, &state);
        drop(state);
        self.publish_turn(slot, &snapshot, None);
        self.spawn_driver(slot, &id);
        Ok(json!({ "conversationId": id, "messageId": message_id, "turnId": turn_id }))
    }

    /// `superagent_cancel_turn`: ends the turn; jobs keep running on their
    /// devices (cancelling a turn never cancels jobs).
    pub async fn cancel_turn(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
    ) -> Result<Value, String> {
        let now = self.now();
        let mut state = slot.state.lock().await;
        let conversation = slot
            .conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "not_found: no such conversation".to_string())?;
        let Some(turn) = conversation
            .turn
            .as_mut()
            .filter(|turn| !turn.step.is_finished())
        else {
            return Ok(json!({ "cancelled": false }));
        };
        turn.step = Step::Cancelled;
        turn.updated_ms = now;
        conversation.updated_ms = now;
        let snapshot = conversation.clone();
        slot.save_conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?;
        self.update_watch(slot, &state);
        drop(state);
        if let Some(notify) = self
            .cancels
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&(slot.account_id.clone(), conversation_id.to_string()))
        {
            notify.notify_waiters();
        }
        self.publish_turn(slot, &snapshot, None);
        Ok(json!({ "cancelled": true }))
    }

    // ------------------------------------------------------------------
    // The driver
    // ------------------------------------------------------------------

    pub fn spawn_driver(&self, slot: &Arc<Slot>, conversation_id: &str) {
        if !slot.claim_driver(conversation_id) {
            return;
        }
        let engine = self.arc();
        let slot = Arc::clone(slot);
        let id = conversation_id.to_string();
        tokio::spawn(async move {
            loop {
                match engine.step(&slot, &id).await {
                    Ok(true) => continue,
                    Ok(false) => break,
                    Err(error) => {
                        log::warn!("Superagent step failed: error={}", error);
                        break;
                    }
                }
            }
            slot.release_driver(&id);
            // A step that became runnable while the driver was releasing.
            let runnable = {
                let state = slot.state.lock().await;
                state
                    .conversations
                    .get(&id)
                    .and_then(|c| c.active_turn())
                    .is_some_and(|turn| matches!(turn.step, Step::ModelRound | Step::Tools))
            };
            if runnable {
                engine.spawn_driver(&slot, &id);
            }
        });
    }

    /// Runs one step; `Ok(true)` when another step is runnable now.
    async fn step(&self, slot: &Arc<Slot>, conversation_id: &str) -> Result<bool, String> {
        let (step, turn) = {
            let mut state = slot.state.lock().await;
            let Some(conversation) = slot
                .conversation(&mut state, conversation_id)
                .map_err(|e| e.to_string())?
            else {
                return Ok(false);
            };
            let Some(turn) = conversation.active_turn() else {
                return Ok(false);
            };
            (turn.step.clone(), turn.clone())
        };
        match step {
            Step::ModelRound => self.model_round(slot, conversation_id, &turn).await,
            Step::Tools => self.tool_step(slot, conversation_id, &turn).await,
            _ => Ok(false),
        }
    }

    fn model_messages(conversation: &Conversation) -> Vec<Value> {
        conversation
            .messages
            .iter()
            .filter_map(|message| match message.role {
                Role::User => Some(json!({ "role": "user", "content": message.text })),
                Role::Assistant => {
                    let mut value = json!({ "role": "assistant", "content": message.text });
                    if !message.tool_calls.is_empty() {
                        value["toolCalls"] = Value::Array(
                            message
                                .tool_calls
                                .iter()
                                .map(crate::model::relay_tool_call)
                                .collect(),
                        );
                    }
                    Some(value)
                }
                Role::Tool => {
                    let mut value = json!({
                        "role": "tool",
                        "toolCallId": message.tool_call_id.clone().unwrap_or_default(),
                        "content": message.text,
                    });
                    if let Some(name) = &message.tool_name {
                        value["name"] = Value::String(name.clone());
                    }
                    if message.text.starts_with("{\"error\"") {
                        value["isError"] = Value::Bool(true);
                    }
                    Some(value)
                }
                Role::Card | Role::Unknown => None,
            })
            .collect()
    }

    pub fn tool_definitions() -> Vec<Value> {
        SuperagentTool::ALL
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name(),
                    "description": tool_description(*tool),
                    "parameters": contract::tool_input_schema(*tool),
                })
            })
            .collect()
    }

    pub async fn holder_candidates(&self, account_id: &str) -> Vec<ModelHolderCandidate> {
        match self.rpc.devices(account_id).await {
            Ok(devices) => devices
                .iter()
                .map(DeviceSnapshot::holder_candidate)
                .collect(),
            Err(error) => {
                log::warn!("Superagent device list failed: {}", error);
                Vec::new()
            }
        }
    }

    async fn finish(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        turn_id: &str,
        step: Step,
        notice: Option<Message>,
    ) -> Result<(), String> {
        let now = self.now();
        let mut state = slot.state.lock().await;
        let Some(conversation) = slot
            .conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?
        else {
            return Ok(());
        };
        let Some(turn) = conversation
            .turn
            .as_mut()
            .filter(|turn| turn.id == turn_id && !turn.step.is_finished())
        else {
            return Ok(());
        };
        turn.step = step;
        turn.updated_ms = now;
        if let Some(notice) = notice {
            conversation.messages.push(notice);
        }
        conversation.updated_ms = now;
        let snapshot = conversation.clone();
        slot.save_conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?;
        self.update_watch(slot, &state);
        drop(state);
        self.publish_turn(slot, &snapshot, None);
        Ok(())
    }

    fn card_message(&self, kind: &str, text: &str, extra: Value) -> Message {
        let mut card = json!({ "kind": kind });
        if let (Some(card), Some(extra)) = (card.as_object_mut(), extra.as_object()) {
            card.extend(extra.clone());
        }
        Message {
            id: new_id("m"),
            role: Role::Card,
            text: text.to_string(),
            card,
            at_ms: self.now(),
            ..Message::default()
        }
    }

    async fn model_round(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        turn: &Turn,
    ) -> Result<bool, String> {
        if turn.rounds >= turn.max_rounds.max(1) {
            let notice = self.card_message(
                "quota_reached",
                "This request used its model rounds; send a message to continue.",
                json!({ "rounds": turn.rounds }),
            );
            self.finish(
                slot,
                conversation_id,
                &turn.id,
                Step::Failed {
                    reason: "round_quota".into(),
                },
                Some(notice),
            )
            .await?;
            return Ok(false);
        }
        let (messages, pick, last_holder) = {
            let mut state = slot.state.lock().await;
            let Some(conversation) = slot
                .conversation(&mut state, conversation_id)
                .map_err(|e| e.to_string())?
            else {
                return Ok(false);
            };
            (
                Self::model_messages(conversation),
                conversation.model_pick(),
                conversation.last_holder.clone(),
            )
        };
        let candidates = self.holder_candidates(&slot.account_id).await;
        let choice = match pick.as_ref() {
            // That device and that model, never another one; a pinned
            // holder lost this round is not retried elsewhere.
            Some(pick) if turn.lost_holders.contains(&pick.device_id) => HolderChoice::NoHolder {
                reason: contract::model_reason::PINNED_HOLDER_OFFLINE.to_string(),
            },
            Some(pick) => pinned_model_holder(&candidates, pick),
            None => rank_model_holders(&candidates, last_holder.as_deref(), &turn.lost_holders),
        };
        let ranked = match choice {
            HolderChoice::Chosen { ranked } => ranked,
            HolderChoice::NoHolder { .. } => {
                // No model round waits on a device: the turn ends now with
                // what failed and what to do.
                let notice = no_holder_notice(&candidates, pick.as_ref());
                let card = self.card_message(
                    NO_HOLDER_CARD,
                    &notice.text,
                    json!({
                        "reason": notice.reason,
                        "offline": notice.offline,
                        "noModel": notice.no_model,
                        "requiresUpdate": notice.requires_update,
                    }),
                );
                self.finish(
                    slot,
                    conversation_id,
                    &turn.id,
                    Step::Failed {
                        reason: notice.reason.clone(),
                    },
                    Some(card),
                )
                .await?;
                return Ok(false);
            }
        };
        let holder = ranked[0].clone();
        let request = ModelRequest {
            request_id: format!("{}-r{}", turn.id, turn.rounds),
            // Auto runs the holder's primary model.
            model: pick.map(|pick| pick.model_id),
            system: self.config.system_prompt.clone(),
            messages,
            tools: Self::tool_definitions(),
            max_output_tokens: self.config.max_output_tokens,
        };
        let _global = Arc::clone(&self.global_rounds)
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        let _account = Arc::clone(&slot.model_permits)
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        let key = (slot.account_id.clone(), conversation_id.to_string());
        let cancel = Arc::new(Notify::new());
        self.cancels
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(key.clone(), Arc::clone(&cancel));
        let sink: DeltaSink = {
            let events = Arc::clone(&slot.events);
            let conversation_id = conversation_id.to_string();
            let turn_id = turn.id.clone();
            Arc::new(move |text: &str| {
                events.publish(
                    SUPERAGENT_TURN_DELTA_EVENT,
                    json!({ "conversationId": conversation_id, "turnId": turn_id, "step": "model_round", "text": text }),
                );
            })
        };
        let outcome = tokio::select! {
            outcome = self.model.run(&slot.account_id, &holder, &request, sink) => Some(outcome),
            _ = cancel.notified() => None,
        };
        self.cancels
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&key);
        let Some(outcome) = outcome else {
            self.model
                .cancel(&slot.account_id, &holder, &request.request_id)
                .await;
            return Ok(false);
        };
        self.apply_round(slot, conversation_id, &turn.id, &holder, outcome)
            .await
    }

    async fn apply_round(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        turn_id: &str,
        holder: &str,
        outcome: Result<ModelReply, ModelError>,
    ) -> Result<bool, String> {
        let now = self.now();
        let mut state = slot.state.lock().await;
        let Some(conversation) = slot
            .conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?
        else {
            return Ok(false);
        };
        let Some(turn) = conversation
            .turn
            .as_mut()
            .filter(|t| t.id == turn_id && t.step == Step::ModelRound)
        else {
            // Cancelled meanwhile.
            return Ok(false);
        };
        let more = match outcome {
            Ok(reply) => {
                turn.rounds += 1;
                turn.lost_holders.clear();
                turn.updated_ms = now;
                let calls: Vec<ModelToolCall> = reply
                    .tool_calls
                    .into_iter()
                    .enumerate()
                    .map(|(index, mut call)| {
                        if call.id.is_empty() {
                            call.id = format!("{}-r{}-c{index}", turn.id, turn.rounds);
                        }
                        call
                    })
                    .collect();
                let done = calls.is_empty();
                turn.calls = calls.clone();
                turn.next_call = 0;
                turn.step = if done { Step::Done } else { Step::Tools };
                conversation.messages.push(Message {
                    id: new_id("m"),
                    role: Role::Assistant,
                    text: truncate_text(&reply.text, MAX_MESSAGE_TEXT_BYTES),
                    tool_calls: calls,
                    turn_id: Some(turn_id.to_string()),
                    at_ms: now,
                    ..Message::default()
                });
                conversation.last_holder = Some(holder.to_string());
                !done
            }
            Err(ModelError::HolderLost(message)) => {
                log::info!(
                    "Superagent model holder lost; retrying elsewhere: holder={}, error={}",
                    holder,
                    message
                );
                turn.lost_holders.push(holder.to_string());
                turn.updated_ms = now;
                true
            }
            Err(ModelError::Failed(message)) => {
                turn.step = Step::Failed {
                    reason: "model_failed".into(),
                };
                turn.updated_ms = now;
                conversation.messages.push(Message {
                    id: new_id("m"),
                    role: Role::Card,
                    text: truncate_text(&message, 2048),
                    card: json!({ "kind": "model_failed", "holder": holder }),
                    at_ms: now,
                    ..Message::default()
                });
                false
            }
        };
        conversation.updated_ms = now;
        let snapshot = conversation.clone();
        slot.save_conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?;
        self.update_watch(slot, &state);
        drop(state);
        self.publish_turn(slot, &snapshot, None);
        Ok(more)
    }

    async fn tool_step(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        turn: &Turn,
    ) -> Result<bool, String> {
        let Some(call) = turn.calls.get(turn.next_call).cloned() else {
            // Every call answered: the next model round.
            let mut state = slot.state.lock().await;
            if let Some(turn) = slot
                .conversation(&mut state, conversation_id)
                .map_err(|e| e.to_string())?
                .and_then(|c| c.turn.as_mut())
                .filter(|t| t.id == turn.id && t.step == Step::Tools)
            {
                turn.step = Step::ModelRound;
                turn.updated_ms = self.now();
            }
            slot.save_conversation(&mut state, conversation_id)
                .map_err(|e| e.to_string())?;
            return Ok(true);
        };
        let run = self.run_tool(slot, conversation_id, turn, &call).await;
        let now = self.now();
        let mut state = slot.state.lock().await;
        let Some(conversation) = slot
            .conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?
        else {
            return Ok(false);
        };
        let Some(live) = conversation
            .turn
            .as_mut()
            .filter(|t| t.id == turn.id && t.step == Step::Tools && t.next_call == turn.next_call)
        else {
            return Ok(false);
        };
        live.next_call += 1;
        live.updated_ms = now;
        let mut resumable = true;
        match run {
            ToolRun::Result {
                result,
                dispatched,
                visible,
            } => {
                live.dispatched += dispatched;
                conversation
                    .messages
                    .push(tool_message(&call, &result, now));
                if let Some(card) = visible {
                    conversation.messages.push(card);
                }
            }
            ToolRun::Park { wait, deadline_ms } => {
                live.step = Step::Parked {
                    wait,
                    since_ms: now,
                    deadline_ms,
                };
                resumable = false;
            }
        }
        conversation.updated_ms = now;
        let snapshot = conversation.clone();
        slot.save_conversation(&mut state, conversation_id)
            .map_err(|e| e.to_string())?;
        self.update_watch(slot, &state);
        drop(state);
        self.publish_turn(slot, &snapshot, None);
        Ok(resumable)
    }

    // ------------------------------------------------------------------
    // Tools
    // ------------------------------------------------------------------

    async fn run_tool(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        turn: &Turn,
        call: &ModelToolCall,
    ) -> ToolRun {
        let parsed = match contract::parse_tool_call(&call.name, &call.arguments) {
            Ok(parsed) => parsed,
            Err(error) => return ToolRun::result(tool_error(&error.code, error.message)),
        };
        match parsed {
            SuperagentToolCall::FleetListRuntimes(input) => {
                ToolRun::result(self.list_runtimes(slot, input.include_offline).await)
            }
            SuperagentToolCall::FleetDispatch(input) => {
                if turn.dispatched >= self.config.max_dispatch_per_turn {
                    return ToolRun::result(tool_error(
                        "dispatch_quota",
                        "this request reached its job quota",
                    ));
                }
                let result = self
                    .dispatch(slot, conversation_id, turn, call, input)
                    .await;
                let dispatched = u32::from(result.get("jobId").is_some());
                ToolRun::Result {
                    result,
                    dispatched,
                    visible: None,
                }
            }
            SuperagentToolCall::FleetWait(input) => self.wait(slot, call, input).await,
            SuperagentToolCall::FleetJobStatus(input) => {
                let ids = self
                    .select_jobs(slot, input.job_ids.as_deref(), input.group_id.as_deref())
                    .await;
                self.refresh_jobs(slot, &ids).await;
                ToolRun::result(self.job_statuses(slot, &ids).await)
            }
            SuperagentToolCall::FleetJobResult(input) => {
                ToolRun::result(self.job_result(slot, &input.job_id).await)
            }
            SuperagentToolCall::FleetJobTranscript(input) => {
                let result = self.job_transcript(slot, &input.job_id).await;
                let visible = self.card_message(
                    "transcript_read",
                    "The agent read this job's transcript.",
                    json!({ "jobId": input.job_id }),
                );
                ToolRun::Result {
                    result,
                    dispatched: 0,
                    visible: Some(visible),
                }
            }
            SuperagentToolCall::FleetJobMessage(input) => {
                ToolRun::result(self.job_message(slot, turn, call, input).await)
            }
            SuperagentToolCall::FleetJobCancel(input) => {
                ToolRun::result(self.job_cancel(slot, &input.job_id).await)
            }
            SuperagentToolCall::FleetJobAnswer(input) => {
                ToolRun::result(self.job_answer(slot, input).await)
            }
            SuperagentToolCall::FleetPublishBranch(input) => {
                let result = self
                    .publish_branch(slot, &input.job_id, input.remote.as_deref())
                    .await;
                let visible = self.card_message(
                    "branch_published",
                    "The agent published a job's branch.",
                    json!({ "jobId": input.job_id, "result": result }),
                );
                ToolRun::Result {
                    result,
                    dispatched: 0,
                    visible: Some(visible),
                }
            }
        }
    }

    pub async fn devices(&self, account_id: &str) -> Vec<DeviceSnapshot> {
        self.rpc.devices(account_id).await.unwrap_or_else(|error| {
            log::warn!("Superagent device list failed: {}", error);
            Vec::new()
        })
    }

    async fn list_runtimes(&self, slot: &Arc<Slot>, include_offline: bool) -> Value {
        let devices = self.devices(&slot.account_id).await;
        let required = [
            contract::WORKSPACE_TARGET_SOURCE_CAPABILITY,
            contract::STATUS_SUMMARY_ONLY_CAPABILITY,
            contract::JOB_SUBMITTER_CAPABILITY,
        ];
        let mut state = slot.state.lock().await;
        let runtimes: Vec<Value> = devices
            .iter()
            .filter(|device| include_offline || device.facts.online)
            .map(|device| {
                let gate = contract::dispatch_gate(&device.facts, &required);
                let active: Vec<Value> = state
                    .ledger
                    .live_jobs()
                    .filter(|job| job.device_id == device.facts.device_id)
                    .map(|job| json!({ "jobId": job.job_id, "title": job.title, "state": job.state }))
                    .collect();
                json!({
                    "deviceId": device.facts.device_id,
                    "name": device.facts.name,
                    "hostKind": device.facts.host_kind,
                    "os": device.facts.os,
                    "arch": device.facts.arch,
                    "version": device.version,
                    "state": if device.facts.online { "online" } else { "offline" },
                    "dispatch": {
                        "allowed": gate.allowed,
                        "reason": gate.reason,
                        "missing": gate.missing,
                        "queueable": gate.is_queueable(),
                        "capabilities": device.facts.dispatch_capabilities,
                    },
                    "models": device.models,
                    "modelConfigured": device.facts.model_configured,
                    "workspaces": device.workspaces,
                    "activeJobs": active,
                })
            })
            .collect();
        let result = json!({ "runtimes": runtimes });
        if let Err(error) = slot.save_index(&mut state, result.clone()) {
            log::warn!("Superagent index not saved: {}", error);
        }
        result
    }

    async fn dispatch(
        &self,
        slot: &Arc<Slot>,
        conversation_id: &str,
        turn: &Turn,
        call: &ModelToolCall,
        input: contract::DispatchInput,
    ) -> Value {
        let job_id = derived_job_id(&turn.id, &call.id, &input.target);
        // A repeated step (restart) finds its write-ahead record.
        let existing = slot.state.lock().await.ledger.jobs.get(&job_id).cloned();
        let devices = self.devices(&slot.account_id).await;
        if existing.is_none() {
            let Some(device) = facts_by_id(&devices, &input.target) else {
                return tool_error(
                    "unknown_target",
                    format!("no runtime with device id '{}'", input.target),
                );
            };
            let required = contract::required_dispatch_capabilities(&input.source);
            let gate = contract::dispatch_gate(&device.facts, &required);
            if !gate.allowed && !(input.queue_if_offline && gate.is_queueable()) {
                return json!({
                    "error": { "code": gate.reason.clone().unwrap_or_default(), "message": "this runtime cannot take the job now", "missing": gate.missing },
                    "deviceId": input.target,
                });
            }
            if input.approval == contract::ApprovalChoice::Auto {
                let auto = contract::auto_approval_gate(&device.facts);
                if !auto.allowed {
                    return json!({
                        "error": { "code": auto.reason.unwrap_or_default(), "message": "this runtime does not allow full access for agent jobs; use approval remote or another runtime" },
                        "deviceId": input.target,
                    });
                }
            }
            let now = self.now();
            let record = JobRecord {
                job_id: job_id.clone(),
                device_id: input.target.clone(),
                session_id: derived_uuid(&job_id),
                conversation_id: conversation_id.to_string(),
                turn_id: turn.id.clone(),
                title: input.title.clone().unwrap_or_else(|| {
                    truncate_text(input.instructions.lines().next().unwrap_or(""), 80)
                }),
                group_id: input.group.clone(),
                label: input.label.clone(),
                source: serde_json::to_value(&input.source).unwrap_or(Value::Null),
                instructions: input.instructions.clone(),
                agent: input.agent.clone(),
                model: input.model.clone(),
                reasoning_preset: input.reasoning_preset.clone(),
                approval: serde_json::to_value(input.approval)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_else(|| "remote".into()),
                phase: LedgerJobPhase::Pending,
                queued_until_ms: (!device.facts.online).then(|| now + self.config.queue_ttl_ms),
                state: SuperagentJobState::Queued,
                state_reason: Some(
                    if device.facts.online {
                        contract::reason::SUBMITTING
                    } else {
                        contract::reason::WAITING_FOR_DEVICE
                    }
                    .to_string(),
                ),
                created_ms: now,
                updated_ms: now,
                ..JobRecord::default()
            };
            let mut state = slot.state.lock().await;
            state.ledger.jobs.insert(job_id.clone(), record.clone());
            if let Err(error) = slot.save_ledger(&mut state) {
                state.ledger.jobs.remove(&job_id);
                return tool_error("ledger_unavailable", error.to_string());
            }
            self.update_watch(slot, &state);
            drop(state);
            self.publish_card(slot, &record, Some(&devices));
        }
        self.try_submit(slot, &job_id, &devices).await;
        let state = slot.state.lock().await;
        let Some(job) = state.ledger.jobs.get(&job_id) else {
            return tool_error("ledger_unavailable", "the job record is gone");
        };
        json!({
            "jobId": job.job_id,
            "deviceId": job.device_id,
            "state": job.state,
            "stateReason": job.state_reason,
            "branch": job.branch,
            "baseCommit": job.base_commit,
            "error": job.last_error.as_ref().filter(|_| job.state == SuperagentJobState::Failed),
        })
    }

    /// Submits a write-ahead job once its device is online. Exactly once:
    /// one submit in flight per job, and an unknown outcome is reconciled
    /// through status before any new submit.
    pub async fn try_submit(&self, slot: &Arc<Slot>, job_id: &str, devices: &[DeviceSnapshot]) {
        let key = (slot.account_id.clone(), job_id.to_string());
        let job = {
            let state = slot.state.lock().await;
            let Some(job) = state.ledger.jobs.get(job_id) else {
                return;
            };
            if job.phase != LedgerJobPhase::Pending || job.state.is_terminal() {
                return;
            }
            job.clone()
        };
        let online = facts_by_id(devices, &job.device_id).is_some_and(|device| device.facts.online);
        if !online {
            return;
        }
        if !self
            .submitting
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(key.clone())
        {
            return;
        }
        let advertises = |capability: &str| {
            facts_by_id(devices, &job.device_id)
                .is_some_and(|device| has(&device.facts.dispatch_capabilities, capability))
        };
        let fields = wire::SubmitFields {
            submitter: advertises(contract::JOB_SUBMITTER_CAPABILITY),
            // A worker question lands in the job's mailbox, where the user
            // (Inbox) or the agent (`fleet_job_answer`) answers it.
            user_questions: advertises(contract::USER_QUESTION_MAILBOX_CAPABILITY),
        };
        let outcome = self.submit_once(slot, &job, fields).await;
        let now = self.now();
        let mut state = slot.state.lock().await;
        if let Some(record) = state.ledger.jobs.get_mut(job_id) {
            record.updated_ms = now;
            match outcome {
                SubmitOutcome::Accepted {
                    state: target,
                    workspace,
                    branch,
                    base_commit,
                } => {
                    record.phase = LedgerJobPhase::Submitted;
                    record.target_state = target;
                    record.submitted_ms = Some(now);
                    record.queued_until_ms = None;
                    record.workspace_path = workspace.or(record.workspace_path.take());
                    record.branch = branch.or(record.branch.take());
                    record.base_commit = base_commit.or(record.base_commit.take());
                    let (projected, reason) = project_job_state(&JobStateFacts {
                        ledger: record.phase,
                        target: Some(target),
                        device_online: true,
                        pending_prompts: 0,
                    });
                    record.state = projected;
                    record.state_reason = reason.map(str::to_string);
                }
                SubmitOutcome::Refused(message) => {
                    record.state = SuperagentJobState::Failed;
                    record.state_reason = Some("submit_refused".into());
                    record.last_error = Some(truncate_text(&message, 2048));
                    record.finished_ms = Some(now);
                }
                SubmitOutcome::Unknown(message) | SubmitOutcome::Pending(message) => {
                    record.last_error = Some(truncate_text(&message, 2048));
                }
            }
            let record = record.clone();
            let _ = slot.save_ledger(&mut state);
            self.update_watch(slot, &state);
            drop(state);
            self.publish_card(slot, &record, Some(devices));
        }
        self.submitting
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&key);
    }

    async fn submit_once(
        &self,
        slot: &Arc<Slot>,
        job: &JobRecord,
        fields: wire::SubmitFields,
    ) -> SubmitOutcome {
        let account = &slot.account_id;
        // A submit that was sent before with an unknown outcome: the target
        // may have it (it dedupes on the id); ask first.
        if job.submit_attempts > 0 {
            if let Ok(status) = self
                .rpc
                .call(
                    account,
                    &job.device_id,
                    "dispatch_target_status",
                    wire::status_args(&job.job_id, 0, true),
                )
                .await
            {
                let parsed = wire::parse_status(&status);
                return SubmitOutcome::Accepted {
                    state: parsed.state,
                    workspace: None,
                    branch: None,
                    base_commit: None,
                };
            }
        }
        {
            let mut state = slot.state.lock().await;
            if let Some(record) = state.ledger.jobs.get_mut(&job.job_id) {
                record.submit_attempts += 1;
            }
            if let Err(error) = slot.save_ledger(&mut state) {
                return SubmitOutcome::Pending(error.to_string());
            }
        }
        let source: contract::DispatchSourceInput = match serde_json::from_value(job.source.clone())
        {
            Ok(source) => source,
            Err(error) => return SubmitOutcome::Refused(format!("unreadable job source: {error}")),
        };
        let origin = match &source {
            contract::DispatchSourceInput::Job { job_id } => {
                let state = slot.state.lock().await;
                match state.ledger.jobs.get(job_id) {
                    Some(origin) if origin.branch.is_some() => Some(origin.clone()),
                    Some(_) => {
                        return SubmitOutcome::Refused(format!(
                            "{}: job {job_id} has no result branch yet",
                            contract::reason::NO_RESULT_BRANCH
                        ))
                    }
                    None => {
                        return SubmitOutcome::Refused(format!("no job {job_id} in this account"))
                    }
                }
            }
            _ => None,
        };
        let source_args = wire::provision_args(&job.job_id, &source, origin.as_ref());
        let mut provisioned = None;
        for _ in 0..wire::PROVISION_POLLS {
            match self
                .rpc
                .call(
                    account,
                    &job.device_id,
                    "dispatch_target_workspace_provision_source",
                    source_args.clone(),
                )
                .await
            {
                Ok(answer) => {
                    let answer = match wire::parse_provision(&answer) {
                        Ok(answer) => answer,
                        Err(error) => return SubmitOutcome::Refused(error),
                    };
                    if answer.pending {
                        tokio::time::sleep(wire::PROVISION_POLL_INTERVAL).await;
                        continue;
                    }
                    if !answer.provisioned {
                        return SubmitOutcome::Refused(
                            answer.fetch_error.unwrap_or_else(|| {
                                "the target could not provide the source".into()
                            }),
                        );
                    }
                    provisioned = Some(answer);
                    break;
                }
                Err(RpcError::Refused(message)) => return SubmitOutcome::Refused(message),
                Err(error) => return SubmitOutcome::Unknown(error.message().to_string()),
            }
        }
        let Some(provisioned) = provisioned else {
            return SubmitOutcome::Pending("the source is still being prepared".into());
        };
        let args = wire::submit_args(job, &provisioned.workspace_path, fields);
        match self
            .rpc
            .call(account, &job.device_id, "dispatch_target_submit", args)
            .await
        {
            Ok(answer) => SubmitOutcome::Accepted {
                state: wire::parse_submit(&answer),
                workspace: Some(provisioned.workspace_path),
                branch: provisioned.branch,
                base_commit: provisioned.base_commit,
            },
            Err(RpcError::Refused(message)) => SubmitOutcome::Refused(message),
            Err(error) => SubmitOutcome::Unknown(error.message().to_string()),
        }
    }

    async fn select_jobs(
        &self,
        slot: &Arc<Slot>,
        job_ids: Option<&[String]>,
        group_id: Option<&str>,
    ) -> Vec<String> {
        let state = slot.state.lock().await;
        match (job_ids, group_id) {
            (Some(ids), _) => ids.to_vec(),
            (None, Some(group)) => state
                .ledger
                .group(group)
                .into_iter()
                .map(|job| job.job_id.clone())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Polls the status of submitted jobs (summary only) and updates their
    /// projection; returns whether any state changed.
    pub async fn refresh_jobs(&self, slot: &Arc<Slot>, job_ids: &[String]) -> bool {
        let devices = self.devices(&slot.account_id).await;
        let jobs: Vec<JobRecord> = {
            let state = slot.state.lock().await;
            job_ids
                .iter()
                .filter_map(|id| state.ledger.jobs.get(id).cloned())
                .collect()
        };
        let mut changed = false;
        for job in jobs {
            if job.phase == LedgerJobPhase::Pending {
                self.try_submit(slot, &job.job_id, &devices).await;
                continue;
            }
            if job.phase != LedgerJobPhase::Submitted || job.state.is_terminal() {
                continue;
            }
            let online = facts_by_id(&devices, &job.device_id).is_some_and(|d| d.facts.online);
            let summary_only = facts_by_id(&devices, &job.device_id).is_some_and(|d| {
                has(
                    &d.facts.dispatch_capabilities,
                    contract::STATUS_SUMMARY_ONLY_CAPABILITY,
                )
            });
            let status = if online {
                self.rpc
                    .call(
                        &slot.account_id,
                        &job.device_id,
                        "dispatch_target_status",
                        wire::status_args(&job.job_id, job.status_cursor, summary_only),
                    )
                    .await
                    .ok()
                    .map(|value| wire::parse_status(&value))
            } else {
                None
            };
            // A summary-only answer carries no prompt input: read the full
            // status once for a blocked job whose first prompt is new.
            let mut prompt_summary = status
                .as_ref()
                .and_then(|status| status.pending_summaries.first().cloned().flatten());
            if let Some(first) = status.as_ref().and_then(|status| status.pending.first()) {
                let known = job
                    .pending_prompt_summary
                    .as_ref()
                    .filter(|known| known.request_id == first.request_id)
                    .cloned();
                if prompt_summary.is_none() {
                    prompt_summary = match known {
                        Some(known) => Some(known),
                        None if summary_only => self
                            .rpc
                            .call(
                                &slot.account_id,
                                &job.device_id,
                                "dispatch_target_status",
                                wire::status_args(
                                    &job.job_id,
                                    status.as_ref().map_or(0, |s| s.cursor),
                                    false,
                                ),
                            )
                            .await
                            .ok()
                            .and_then(|full| {
                                wire::parse_status(&full)
                                    .pending_summaries
                                    .into_iter()
                                    .flatten()
                                    .find(|summary| summary.request_id == first.request_id)
                            }),
                        None => None,
                    };
                }
            }
            let now = self.now();
            let mut state = slot.state.lock().await;
            let Some(record) = state.ledger.jobs.get_mut(&job.job_id) else {
                continue;
            };
            let mut prompt_changed = false;
            // The device answered: the job is not lost (persisted at most
            // once a day when nothing else changed).
            let seen_stale = status.is_some()
                && now.saturating_sub(record.status_seen_ms) >= 24 * 60 * 60 * 1000;
            if status.is_some() {
                record.status_seen_ms = now;
            }
            if let Some(status) = &status {
                record.target_state = status.state;
                record.status_cursor = status.cursor.max(record.status_cursor);
                let pending = status.pending.first().map(|first| JobPendingPrompt {
                    more: status.pending.len().saturating_sub(1) as u32,
                    ..first.clone()
                });
                prompt_changed = pending != record.pending_prompt;
                record.pending_prompt = pending;
                record.pending_prompt_summary = if record.pending_prompt.is_some() {
                    prompt_summary
                } else {
                    None
                };
                if status.last_error.is_some() {
                    record.last_error = status.last_error.clone();
                }
            }
            let (projected, reason) = project_job_state(&JobStateFacts {
                ledger: record.phase,
                target: (record.target_state != TargetJobState::Unknown)
                    .then_some(record.target_state),
                device_online: online && status.is_some(),
                pending_prompts: u32::from(record.pending_prompt.is_some()),
            });
            if prompt_changed
                || projected != record.state
                || reason.map(str::to_string) != record.state_reason
            {
                record.state = projected;
                record.state_reason = reason.map(str::to_string);
                if projected.is_terminal() {
                    record.finished_ms = Some(now);
                }
                record.updated_ms = now;
                changed = true;
                let record = record.clone();
                let _ = slot.save_ledger(&mut state);
                drop(state);
                self.publish_card(slot, &record, Some(&devices));
            } else if seen_stale {
                let _ = slot.save_ledger(&mut state);
            }
        }
        changed
    }

    async fn job_statuses(&self, slot: &Arc<Slot>, job_ids: &[String]) -> Value {
        let state = slot.state.lock().await;
        let jobs: Vec<Value> = job_ids
            .iter()
            .map(|id| match state.ledger.jobs.get(id) {
                Some(job) => json!({
                    "jobId": job.job_id,
                    "deviceId": job.device_id,
                    "title": job.title,
                    "groupId": job.group_id,
                    "label": job.label,
                    "state": job.state,
                    "stateReason": job.state_reason,
                    "branch": job.branch,
                    "pendingPrompt": job.pending_prompt,
                    "lastError": job.last_error,
                }),
                None => json!({ "jobId": id, "error": { "code": "unknown_job", "message": "no such job in this account" } }),
            })
            .collect();
        json!({ "jobs": jobs })
    }

    async fn wait(
        &self,
        slot: &Arc<Slot>,
        call: &ModelToolCall,
        input: contract::WaitInput,
    ) -> ToolRun {
        let ids = self
            .select_jobs(slot, input.job_ids.as_deref(), input.group_id.as_deref())
            .await;
        if ids.is_empty() {
            return ToolRun::result(tool_error("no_jobs", "no jobs match"));
        }
        self.refresh_jobs(slot, &ids).await;
        let states = self.states_of(slot, &ids).await;
        let immediate = input.until != contract::WaitUntil::StateChange
            && wait_satisfied(input.until, &states, &states);
        if immediate {
            return ToolRun::result(self.job_statuses(slot, &ids).await);
        }
        let timeout = u64::from(input.timeout.min(contract::MAX_WAIT_SECONDS)) * 1000;
        ToolRun::Park {
            wait: Wait::Jobs {
                tool_call_id: call.id.clone(),
                job_ids: ids,
                until: input.until,
                before: states,
            },
            deadline_ms: Some(self.now() + timeout),
        }
    }

    async fn states_of(&self, slot: &Arc<Slot>, ids: &[String]) -> Vec<SuperagentJobState> {
        let state = slot.state.lock().await;
        ids.iter()
            .map(|id| {
                state
                    .ledger
                    .jobs
                    .get(id)
                    .map(|job| job.state)
                    .unwrap_or(SuperagentJobState::Unknown)
            })
            .collect()
    }

    async fn job_on_device(
        &self,
        slot: &Arc<Slot>,
        job_id: &str,
    ) -> Result<(JobRecord, Vec<DeviceSnapshot>), Value> {
        let job = slot.state.lock().await.ledger.jobs.get(job_id).cloned();
        let Some(job) = job else {
            return Err(tool_error("unknown_job", "no such job in this account"));
        };
        if job.phase != LedgerJobPhase::Submitted {
            return Err(tool_error(
                job.state_reason
                    .as_deref()
                    .unwrap_or(contract::reason::WAITING_FOR_DEVICE),
                "the job is not on its device yet",
            ));
        }
        let devices = self.devices(&slot.account_id).await;
        if !facts_by_id(&devices, &job.device_id).is_some_and(|d| d.facts.online) {
            return Err(tool_error(
                contract::reason::DEVICE_OFFLINE,
                "the job's device is offline",
            ));
        }
        Ok((job, devices))
    }

    async fn job_result(&self, slot: &Arc<Slot>, job_id: &str) -> Value {
        let (job, devices) = match self.job_on_device(slot, job_id).await {
            Ok(found) => found,
            Err(error) => return error,
        };
        if !facts_by_id(&devices, &job.device_id).is_some_and(|d| {
            has(
                &d.facts.dispatch_capabilities,
                contract::QUERY_RESULT_SUMMARY_CAPABILITY,
            )
        }) {
            return tool_error(
                contract::reason::CAPABILITY_MISSING,
                contract::QUERY_RESULT_SUMMARY_CAPABILITY,
            );
        }
        match self
            .rpc
            .call(
                &slot.account_id,
                &job.device_id,
                "dispatch_target_query",
                wire::result_summary_args(job_id),
            )
            .await
        {
            Ok(answer) => {
                let summary = wire::parse_result_summary(&answer);
                let mut state = slot.state.lock().await;
                if let Some(record) = state.ledger.jobs.get_mut(job_id) {
                    record.summary = summary.summary.clone();
                    record.diff_stat = summary.diff_stat.clone();
                    if summary.branch.is_some() {
                        record.branch = summary.branch.clone();
                    }
                    let _ = slot.save_ledger(&mut state);
                }
                let mut value = answer;
                if let Some(text) = value.get("summary").and_then(Value::as_str) {
                    value["summary"] = Value::String(truncate_text(text, MAX_TOOL_RESULT_BYTES));
                }
                value["state"] = serde_json::to_value(job.state).unwrap_or(Value::Null);
                value["durationMs"] = json!(job.duration_ms());
                value
            }
            Err(error) => tool_error("device_error", error.message()),
        }
    }

    async fn job_transcript(&self, slot: &Arc<Slot>, job_id: &str) -> Value {
        let (job, _) = match self.job_on_device(slot, job_id).await {
            Ok(found) => found,
            Err(error) => return error,
        };
        match self
            .rpc
            .call(
                &slot.account_id,
                &job.device_id,
                "dispatch_target_status",
                wire::status_args(job_id, 0, false),
            )
            .await
        {
            Ok(answer) => {
                json!({ "jobId": job_id, "transcript": wire::transcript_text(&answer, MAX_TOOL_RESULT_BYTES) })
            }
            Err(error) => tool_error("device_error", error.message()),
        }
    }

    async fn job_message(
        &self,
        slot: &Arc<Slot>,
        turn: &Turn,
        call: &ModelToolCall,
        input: contract::JobMessageInput,
    ) -> Value {
        // Deterministic ids: a repeated step cannot send twice.
        let op_id = derived_job_id(&turn.id, &call.id, &input.job_id);
        match self
            .message_job(slot, &input.job_id, &input.message, input.mode, &op_id)
            .await
        {
            Ok((outcome, answer)) => json!({
                "jobId": input.job_id,
                "mode": if outcome == "steered" { "steer" } else { "followUp" },
                "outcome": outcome,
                "answer": answer,
            }),
            Err(error) => error,
        }
    }

    /// Sends a job a message (steer a running turn, or start a follow-up
    /// turn of a finished one). `op_id` makes a retry idempotent on the
    /// target. The outcome is `steered`, `started` or `queued` (the target
    /// accepted the follow-up and has not started it yet).
    pub async fn message_job(
        &self,
        slot: &Arc<Slot>,
        job_id: &str,
        text: &str,
        mode: contract::JobMessageMode,
        op_id: &str,
    ) -> Result<(&'static str, Value), Value> {
        if text.trim().is_empty() || text.len() > contract::MAX_MESSAGE_BYTES {
            return Err(tool_error(
                "invalid_request",
                "the message is empty or too long",
            ));
        }
        let (job, _) = self.job_on_device(slot, job_id).await?;
        if job.state == SuperagentJobState::Cancelled {
            return Err(tool_error(
                contract::reason::JOB_CANCELLED,
                "the job was cancelled",
            ));
        }
        let steer = match mode {
            contract::JobMessageMode::Steer => true,
            contract::JobMessageMode::FollowUp => false,
            contract::JobMessageMode::Auto => !job.state.is_terminal(),
        };
        let (command, args) = if steer {
            (
                "dispatch_target_append",
                wire::append_args(job_id, op_id, text),
            )
        } else {
            (
                "dispatch_target_continue",
                wire::continue_args(job_id, op_id, text),
            )
        };
        match self
            .rpc
            .call(&slot.account_id, &job.device_id, command, args)
            .await
        {
            Ok(answer) => {
                if steer {
                    return Ok(("steered", answer));
                }
                let target = wire::parse_submit(&answer);
                let now = self.now();
                let mut state = slot.state.lock().await;
                if let Some(record) = state.ledger.jobs.get_mut(job_id) {
                    record.target_state = target;
                    record.state = if target == TargetJobState::Running {
                        SuperagentJobState::Working
                    } else {
                        SuperagentJobState::Queued
                    };
                    record.state_reason = None;
                    record.finished_ms = None;
                    record.updated_ms = now;
                    let record = record.clone();
                    let _ = slot.save_ledger(&mut state);
                    self.update_watch(slot, &state);
                    drop(state);
                    self.publish_card(slot, &record, None);
                }
                let outcome = if target == TargetJobState::Running {
                    "started"
                } else {
                    "queued"
                };
                Ok((outcome, answer))
            }
            Err(error) => Err(tool_error("device_error", error.message())),
        }
    }

    pub async fn job_cancel(&self, slot: &Arc<Slot>, job_id: &str) -> Value {
        let job = slot.state.lock().await.ledger.jobs.get(job_id).cloned();
        let Some(job) = job else {
            return tool_error("unknown_job", "no such job in this account");
        };
        if job.state.is_terminal() {
            return tool_error(contract::reason::JOB_TERMINAL, "the job already finished");
        }
        if job.phase == LedgerJobPhase::Pending && job.submit_attempts == 0 {
            // Never left the ledger: cancel it here.
            let now = self.now();
            let mut state = slot.state.lock().await;
            if let Some(record) = state.ledger.jobs.get_mut(job_id) {
                record.state = SuperagentJobState::Cancelled;
                record.state_reason = None;
                record.finished_ms = Some(now);
                record.updated_ms = now;
                let record = record.clone();
                let _ = slot.save_ledger(&mut state);
                self.update_watch(slot, &state);
                drop(state);
                self.publish_card(slot, &record, None);
            }
            return json!({ "jobId": job_id, "cancelled": true });
        }
        match self
            .rpc
            .call(
                &slot.account_id,
                &job.device_id,
                "dispatch_target_cancel",
                json!({ "jobId": job_id }),
            )
            .await
        {
            Ok(answer) => {
                self.refresh_jobs(slot, &[job_id.to_string()]).await;
                json!({ "jobId": job_id, "cancelled": answer.get("cancelled").and_then(Value::as_bool).unwrap_or(true) })
            }
            Err(error) => tool_error("device_error", error.message()),
        }
    }

    /// `fleet_job_answer`: the agent answers a job's waiting prompt. The
    /// device decides whether it accepts answers from the cloud agent; the
    /// card records `answeredBy: superagent`.
    async fn job_answer(&self, slot: &Arc<Slot>, input: contract::JobAnswerInput) -> Value {
        let (job, devices) = match self.job_on_device(slot, &input.job_id).await {
            Ok(found) => found,
            Err(error) => return error,
        };
        let Some(decision) = input.decision else {
            return self.job_answer_question(slot, &job, &devices, input).await;
        };
        let reply = match decision {
            contract::AnswerDecision::Once => "once",
            contract::AnswerDecision::Always => "always",
            contract::AnswerDecision::Reject => "reject",
        };
        let args = wire::answer_args(
            &input.job_id,
            &input.prompt_id,
            reply,
            input.feedback.as_deref(),
        );
        match self
            .rpc
            .call(
                &slot.account_id,
                &job.device_id,
                "dispatch_target_answer",
                args,
            )
            .await
        {
            Ok(answer) => {
                let now = self.now();
                let mut state = slot.state.lock().await;
                if let Some(record) = state.ledger.jobs.get_mut(&input.job_id) {
                    record.last_answer = Some(contract::JobAnswerNote {
                        prompt_id: input.prompt_id.clone(),
                        answered_by: contract::ANSWERED_BY_SUPERAGENT.to_string(),
                        decision: Some(reply.to_string()),
                        at_ms: Some(now),
                    });
                    if record
                        .pending_prompt
                        .as_ref()
                        .is_some_and(|p| p.request_id == input.prompt_id)
                    {
                        record.pending_prompt = None;
                    }
                    record.updated_ms = now;
                    let record = record.clone();
                    let _ = slot.save_ledger(&mut state);
                    drop(state);
                    self.publish_card(slot, &record, None);
                }
                self.refresh_jobs(slot, &[input.job_id.clone()]).await;
                json!({ "jobId": input.job_id, "promptId": input.prompt_id, "answered": true, "answer": answer })
            }
            Err(error) => tool_error("device_error", error.message()),
        }
    }

    /// A worker question (`user_question_mailbox_v1`): the answers go to the
    /// job's question mailbox on its device, which resumes the job.
    async fn job_answer_question(
        &self,
        slot: &Arc<Slot>,
        job: &JobRecord,
        devices: &[DeviceSnapshot],
        input: contract::JobAnswerInput,
    ) -> Value {
        if !facts_by_id(devices, &job.device_id).is_some_and(|d| {
            has(
                &d.facts.dispatch_capabilities,
                contract::USER_QUESTION_MAILBOX_CAPABILITY,
            )
        }) {
            return tool_error(
                contract::reason::CAPABILITY_MISSING,
                contract::USER_QUESTION_MAILBOX_CAPABILITY,
            );
        }
        let Some(answers) = input.answers.as_deref().filter(|a| !a.is_empty()) else {
            return tool_error(
                "invalid_input",
                "answer a question with `answers`, a permission with `decision`",
            );
        };
        let args = wire::question_answer_args(
            &input.job_id,
            &input.prompt_id,
            wire::question_answers(answers),
        );
        match self
            .rpc
            .call(
                &slot.account_id,
                &job.device_id,
                "dispatch_target_answer",
                args,
            )
            .await
        {
            Ok(answer) => {
                let now = self.now();
                let mut state = slot.state.lock().await;
                if let Some(record) = state.ledger.jobs.get_mut(&input.job_id) {
                    record.last_answer = Some(contract::JobAnswerNote {
                        prompt_id: input.prompt_id.clone(),
                        answered_by: contract::ANSWERED_BY_SUPERAGENT.to_string(),
                        decision: Some("answered".to_string()),
                        at_ms: Some(now),
                    });
                    if record
                        .pending_prompt
                        .as_ref()
                        .is_some_and(|p| p.request_id == input.prompt_id)
                    {
                        record.pending_prompt = None;
                    }
                    record.updated_ms = now;
                    let record = record.clone();
                    let _ = slot.save_ledger(&mut state);
                    drop(state);
                    self.publish_card(slot, &record, None);
                }
                self.refresh_jobs(slot, &[input.job_id.clone()]).await;
                json!({ "jobId": input.job_id, "promptId": input.prompt_id, "answered": true, "answer": answer })
            }
            Err(error) => tool_error("device_error", error.message()),
        }
    }

    async fn publish_branch(&self, slot: &Arc<Slot>, job_id: &str, remote: Option<&str>) -> Value {
        let (job, devices) = match self.job_on_device(slot, job_id).await {
            Ok(found) => found,
            Err(error) => return error,
        };
        if !facts_by_id(&devices, &job.device_id).is_some_and(|d| {
            has(
                &d.facts.dispatch_capabilities,
                contract::WORKSPACE_PUBLISH_CAPABILITY,
            )
        }) {
            return tool_error(
                contract::reason::CAPABILITY_MISSING,
                contract::WORKSPACE_PUBLISH_CAPABILITY,
            );
        }
        if job.branch.as_deref().is_none_or(str::is_empty) {
            return tool_error(
                contract::reason::NO_RESULT_BRANCH,
                "the job has no result branch",
            );
        }
        match self
            .rpc
            .call(
                &slot.account_id,
                &job.device_id,
                "dispatch_target_workspace_publish",
                wire::publish_args(job_id, remote),
            )
            .await
        {
            Ok(answer) => answer,
            Err(error) => tool_error("device_error", error.message()),
        }
    }

    // ------------------------------------------------------------------
    // The watcher
    // ------------------------------------------------------------------

    /// One watcher pass over an account: submits queued jobs whose device
    /// came back (once), expires queued jobs, refreshes live jobs, and
    /// resumes parked turns whose condition holds or whose deadline passed.
    pub async fn tick(&self, slot: &Arc<Slot>) {
        let now = self.now();
        // Expire queued jobs past their window.
        {
            let mut state = slot.state.lock().await;
            let mut expired = Vec::new();
            for job in state.ledger.jobs.values_mut() {
                if job.phase == LedgerJobPhase::Pending
                    && !job.state.is_terminal()
                    && job.submit_attempts == 0
                    && job.queued_until_ms.is_some_and(|until| until <= now)
                {
                    job.phase = LedgerJobPhase::Expired;
                    job.state = SuperagentJobState::Failed;
                    job.state_reason = Some(contract::reason::EXPIRED.to_string());
                    job.finished_ms = Some(now);
                    job.updated_ms = now;
                    expired.push(job.clone());
                }
            }
            if !expired.is_empty() {
                let _ = slot.save_ledger(&mut state);
                drop(state);
                for job in &expired {
                    self.publish_card(slot, job, None);
                }
            }
        }
        let live: Vec<String> = slot
            .state
            .lock()
            .await
            .ledger
            .live_jobs()
            .map(|job| job.job_id.clone())
            .collect();
        if !live.is_empty() {
            self.refresh_jobs(slot, &live).await;
        }
        self.resume_parked(slot).await;
        // History to the devices, then the time-to-live pass (`archive`).
        crate::archive::pump(self, slot, false).await;
        self.sweep_slot(slot, false).await;
        let state = slot.state.lock().await;
        self.update_watch(slot, &state);
    }

    /// The time-to-live pass of one account (at most every ten minutes
    /// unless `force`): finished jobs after 7 days, live jobs silent for 30
    /// days marked lost, the conversation working set, the outbox bounds.
    pub async fn sweep_slot(&self, slot: &Arc<Slot>, force: bool) {
        let now = self.now();
        let mut state = slot.state.lock().await;
        if !force && state.outbox.next_sweep_ms > now {
            return;
        }
        state.outbox.next_sweep_ms = now + 10 * 60 * 1000;
        let (lost, dropped) = state.ledger.expire(now);
        if !lost.is_empty() || dropped > 0 {
            log::info!(
                "Superagent ledger time to live: lost={}, dropped={}",
                lost.len(),
                dropped
            );
            let _ = slot.save_ledger(&mut state);
        }
        crate::archive::enforce_working_set(slot, &mut state, now);
        slot.save_outbox(&mut state, now);
        let lost_jobs: Vec<JobRecord> = lost
            .iter()
            .filter_map(|id| state.ledger.jobs.get(id).cloned())
            .collect();
        drop(state);
        for job in &lost_jobs {
            self.publish_card(slot, job, None);
        }
        slot.prune_device_facts(None).await;
    }

    /// Brings a conversation that left the working set back from the
    /// account's devices before a command acts on it (`archive::resume`).
    pub async fn ensure_conversation(&self, slot: &Arc<Slot>, id: &str) -> Result<bool, String> {
        crate::archive::resume(self, slot, id).await
    }

    async fn resume_parked(&self, slot: &Arc<Slot>) {
        let now = self.now();
        let parked: Vec<(String, Wait, Option<u64>)> = {
            let state = slot.state.lock().await;
            state
                .conversations
                .values()
                .filter_map(|conversation| {
                    match conversation.active_turn().map(|turn| &turn.step) {
                        Some(Step::Parked {
                            wait, deadline_ms, ..
                        }) => Some((conversation.id.clone(), wait.clone(), *deadline_ms)),
                        _ => None,
                    }
                })
                .collect()
        };
        for (conversation_id, wait, deadline) in parked {
            let resume = match &wait {
                // A turn parked on holder availability by an earlier build:
                // the next model round runs now, or ends with the notice.
                Wait::Holder => true,
                Wait::Jobs {
                    job_ids,
                    until,
                    before,
                    ..
                } => {
                    let now_states = self.states_of(slot, job_ids).await;
                    wait_satisfied(*until, before, &now_states)
                        || deadline.is_some_and(|d| d <= now)
                }
                Wait::Confirmation { .. } => false,
            };
            if !resume {
                continue;
            }
            let tool_answer = match &wait {
                Wait::Jobs {
                    tool_call_id,
                    job_ids,
                    ..
                } => {
                    let mut statuses = self.job_statuses(slot, job_ids).await;
                    let timed_out = deadline.is_some_and(|d| d <= now);
                    statuses["resumedBy"] =
                        Value::String(if timed_out { "timeout" } else { "condition" }.into());
                    Some((tool_call_id.clone(), statuses))
                }
                _ => None,
            };
            let mut state = slot.state.lock().await;
            let Ok(Some(conversation)) = slot.conversation(&mut state, &conversation_id) else {
                continue;
            };
            let Some(turn) = conversation
                .turn
                .as_mut()
                .filter(|t| matches!(t.step, Step::Parked { .. }))
            else {
                continue;
            };
            match tool_answer {
                Some((tool_call_id, statuses)) => {
                    turn.step = Step::Tools;
                    let call = turn
                        .calls
                        .iter()
                        .find(|call| call.id == tool_call_id)
                        .cloned()
                        .unwrap_or(ModelToolCall {
                            id: tool_call_id,
                            name: SuperagentTool::FleetWait.name().into(),
                            arguments: Value::Null,
                        });
                    conversation
                        .messages
                        .push(tool_message(&call, &statuses, now));
                }
                None => turn.step = Step::ModelRound,
            }
            if let Some(turn) = conversation.turn.as_mut() {
                turn.updated_ms = now;
            }
            conversation.updated_ms = now;
            let snapshot = conversation.clone();
            let _ = slot.save_conversation(&mut state, &conversation_id);
            drop(state);
            self.publish_turn(slot, &snapshot, None);
            self.spawn_driver(slot, &conversation_id);
        }
    }

    /// A watcher pass over every watched or resident account.
    pub async fn tick_all(&self) {
        let mut accounts: BTreeSet<String> = self.watched_accounts().into_iter().collect();
        accounts.extend(self.slots.resident_accounts());
        for account in accounts {
            // A resident slot is ticked without touching it, so the watcher
            // never keeps an idle slot loaded.
            let loaded = match self.slots.resident(&account) {
                Some(slot) => Ok(slot),
                None => self.slots.load(&account, self.now(), None).await,
            };
            match loaded {
                Ok(slot) => {
                    if !slot.state.lock().await.meta.enabled {
                        continue;
                    }
                    self.tick(&slot).await;
                }
                Err(crate::slots::SlotError::NotProvisioned) => self.forget_account(&account),
                Err(error) => log::warn!("Superagent watcher could not load a slot: {}", error),
            }
        }
        let unloaded = self.slots.unload_idle(self.now());
        if unloaded > 0 {
            log::info!(
                "Superagent slots unloaded: count={}, resident={}",
                unloaded,
                self.slots.resident_count()
            );
        }
    }

    /// After a restart: resume every turn that was mid-step.
    pub async fn recover(&self) {
        for account in self.watched_accounts() {
            let Ok(slot) = self.slots.load(&account, self.now(), None).await else {
                continue;
            };
            let runnable: Vec<String> = {
                let state = slot.state.lock().await;
                state
                    .conversations
                    .values()
                    .filter(|c| {
                        c.active_turn()
                            .is_some_and(|t| matches!(t.step, Step::ModelRound | Step::Tools))
                    })
                    .map(|c| c.id.clone())
                    .collect()
            };
            for id in runnable {
                self.spawn_driver(&slot, &id);
            }
            self.tick(&slot).await;
        }
    }

    pub fn window_turns() -> usize {
        WINDOW_TURNS
    }
}

enum SubmitOutcome {
    Accepted {
        state: TargetJobState,
        workspace: Option<String>,
        branch: Option<String>,
        base_commit: Option<String>,
    },
    Refused(String),
    /// The call broke: the target may or may not have the job.
    Unknown(String),
    /// Not sent yet (source still provisioning, store unavailable).
    Pending(String),
}

enum ToolRun {
    Result {
        result: Value,
        dispatched: u32,
        visible: Option<Message>,
    },
    Park {
        wait: Wait,
        deadline_ms: Option<u64>,
    },
}

impl ToolRun {
    fn result(result: Value) -> Self {
        Self::Result {
            result,
            dispatched: 0,
            visible: None,
        }
    }
}

fn tool_message(call: &ModelToolCall, result: &Value, now: u64) -> Message {
    let text = serde_json::to_string(result).unwrap_or_default();
    Message {
        id: new_id("m"),
        role: Role::Tool,
        text: truncate_text(&text, MAX_TOOL_RESULT_BYTES),
        tool_call_id: Some(call.id.clone()),
        tool_name: Some(call.name.clone()),
        at_ms: now,
        ..Message::default()
    }
}

/// Reason codes frontends localize; every other reason reaches them as a
/// sentence.
pub const DISPLAY_REASON_CODES: &[&str] = &[
    contract::reason::WAITING_FOR_DEVICE,
    contract::reason::SUBMITTING,
    contract::reason::EXPIRED,
    contract::reason::DEVICE_OFFLINE,
];

pub fn state_reason_for_display(reason: &str, job: &JobRecord) -> String {
    if DISPLAY_REASON_CODES.contains(&reason) {
        return reason.to_string();
    }
    let error = job.last_error.as_deref().map(|e| truncate_text(e, 300));
    match reason {
        "prompt_pending" => "Waiting for an answer to a prompt on the device.".to_string(),
        "submit_refused" => match error {
            Some(error) => format!("The device refused the job: {error}"),
            None => "The device refused the job.".to_string(),
        },
        "unknown_target_state" => {
            "The device reported a state this version does not know.".to_string()
        }
        other if other.contains(' ') => other.to_string(),
        other => format!("Not available: {}.", other.replace('_', " ")),
    }
}

/// One line for the card: the result summary's last non-empty line, else
/// the last error, else nothing.
pub fn summary_line(job: &JobRecord) -> Option<String> {
    let from_summary = job.summary.as_deref().and_then(|summary| {
        summary
            .lines()
            .map(str::trim)
            .rev()
            .find(|line| !line.is_empty() && !line.to_ascii_lowercase().starts_with("outcome"))
            .map(|line| truncate_text(line, 200))
    });
    from_summary.or_else(|| {
        job.last_error
            .as_deref()
            .map(|error| truncate_text(error.lines().next().unwrap_or(error), 200))
    })
}

pub fn tool_description(tool: SuperagentTool) -> &'static str {
    match tool {
        SuperagentTool::FleetListRuntimes => "List the account's runtimes (desktops and CLI hosts): os, arch, version, online state, whether each can take a job now and why not, models, workspaces with repository facts, and active jobs.",
        SuperagentTool::FleetDispatch => "Start a job on one runtime: its source (a workspace of that runtime, a Git remote, or an earlier job's result), instructions, and options. Returns the job id. queueIfOffline queues it until the runtime is online.",
        SuperagentTool::FleetWait => "Wait for jobs (by ids or group) until a state change, any blocked, any finished or all finished, or the timeout. Costs nothing while waiting.",
        SuperagentTool::FleetJobStatus => "The state of jobs: queued, working, blocked (waiting on the user), idle (device unreachable), done, failed or cancelled.",
        SuperagentTool::FleetJobResult => "A finished job's result: summary, branch, commits, diff stat, duration and last error. End job instructions with a line OUTCOME: pass or OUTCOME: fail when you want to compare results.",
        SuperagentTool::FleetJobTranscript => "A job's transcript. Only when the user asks for it; the user sees that you read it.",
        SuperagentTool::FleetJobMessage => "Send a job a message: steer its running turn, or start a follow-up turn of a finished job.",
        SuperagentTool::FleetJobCancel => "Cancel a job.",
        SuperagentTool::FleetJobAnswer => "Answer a job's waiting prompt yourself so the job keeps going: a permission with `decision` (allow once, always, or reject with feedback), or a worker question (tool AskUserQuestion) with `answers`, one per question: `questionId` is the question's index from its summary, `answer` the chosen option label (labels joined by `;` for a multi-select question). Leave it for the user when the decision is theirs.",
        SuperagentTool::FleetPublishBranch => "Push a finished job's result branch from its device to its workspace's remote (never forced, only dispatch branches); the answer says what was pushed. A job imported from another device's job has no remote there: publish the source job instead.",
    }
}
