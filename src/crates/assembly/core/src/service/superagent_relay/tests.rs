//! The model relay with a scripted provider: start, resumable poll, cancel,
//! idempotent restart, validation, and usage recording.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::StreamExt;
use openbitfun_ai_adapters::{UnifiedResponse, UnifiedTokenUsage, UnifiedToolCall};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::provider::BoxFuture;
use super::*;

/// What the scripted provider saw and the stream it hands out.
#[derive(Default)]
struct Seen {
    requests: Vec<ProviderRequest>,
}

/// A provider whose stream is fed by the test through a channel.
struct ScriptedProvider {
    seen: Arc<Mutex<Seen>>,
    feed: Mutex<Option<mpsc::UnboundedReceiver<Result<UnifiedResponse, String>>>>,
    refuse: Option<RelayError>,
}

impl ModelProvider for ScriptedProvider {
    fn open(&self, request: ProviderRequest) -> BoxFuture<Result<ProviderStream, RelayError>> {
        self.seen.lock().unwrap().requests.push(request);
        let refused = self.refuse.clone();
        let feed = self.feed.lock().unwrap().take();
        Box::pin(async move {
            if let Some(error) = refused {
                return Err(error);
            }
            let feed = feed.expect("one stream per scripted provider");
            let stream = futures::stream::unfold(feed, |mut feed| async move {
                feed.recv().await.map(|item| (item, feed))
            })
            .boxed();
            Ok(ProviderStream {
                model_id: "model-a".into(),
                model_name: "scripted-1".into(),
                stream,
            })
        })
    }
}

#[derive(Default)]
struct RecordingSink {
    records: Mutex<Vec<(String, String, String, RelayUsage)>>,
}

impl ModelUsageSink for Arc<RecordingSink> {
    fn record(
        &self,
        request_id: String,
        model_id: String,
        model_name: String,
        usage: RelayUsage,
    ) -> BoxFuture<()> {
        self.records
            .lock()
            .unwrap()
            .push((request_id, model_id, model_name, usage));
        Box::pin(async {})
    }
}

struct Harness {
    relay: Arc<ModelRelay>,
    seen: Arc<Mutex<Seen>>,
    feed: mpsc::UnboundedSender<Result<UnifiedResponse, String>>,
    sink: Arc<RecordingSink>,
}

fn harness(refuse: Option<RelayError>) -> Harness {
    let (feed, receiver) = mpsc::unbounded_channel();
    let seen = Arc::new(Mutex::new(Seen::default()));
    let sink = Arc::new(RecordingSink::default());
    let relay = ModelRelay::new(
        Arc::new(ScriptedProvider {
            seen: Arc::clone(&seen),
            feed: Mutex::new(Some(receiver)),
            refuse,
        }),
        Arc::new(Arc::clone(&sink)),
        RelayLimits::default(),
    );
    Harness {
        relay,
        seen,
        feed,
        sink,
    }
}

fn text(value: &str) -> UnifiedResponse {
    UnifiedResponse {
        text: Some(value.to_string()),
        ..UnifiedResponse::default()
    }
}

fn start_args(request_id: &str) -> Value {
    json!({ "request": {
        "requestId": request_id,
        "system": "You are the OpenBitFun agent.",
        "messages": [
            { "role": "user", "content": "build on linux" },
            { "role": "assistant", "toolCalls": [
                { "id": "c0", "name": "fleet_list_runtimes", "arguments": "{}" }
            ] },
            { "role": "tool", "toolCallId": "c0", "content": "{\"devices\":[]}" }
        ],
        "tools": [
            { "name": "fleet_dispatch", "description": "Dispatch a job",
              "parameters": { "type": "object" } }
        ],
        "maxOutputTokens": 2048
    } })
}

async fn poll(relay: &Arc<ModelRelay>, request_id: &str, after: u64, wait_ms: u64) -> Value {
    relay
        .handle(
            FLEET_MODEL_POLL,
            json!({ "request": { "requestId": request_id, "afterSeq": after, "waitMs": wait_ms } }),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn model_relay_start_poll_and_resume_with_a_fake_provider() {
    let h = harness(None);
    let started = h
        .relay
        .handle(FLEET_MODEL_START, start_args("round-1"))
        .await
        .unwrap();
    assert_eq!(started, json!({ "requestId": "round-1", "resumed": false }));

    // A poll with nothing new waits and returns empty, not done.
    let empty = poll(&h.relay, "round-1", 0, 20).await;
    assert_eq!(empty["chunks"], json!([]));
    assert_eq!(empty["done"], false);

    h.feed.send(Ok(text("Dispatching "))).unwrap();
    let first = poll(&h.relay, "round-1", 0, 5_000).await;
    assert_eq!(first["chunks"][0]["seq"], 1);
    assert_eq!(first["chunks"][0]["text"], "Dispatching ");
    assert_eq!(first["nextSeq"], 1);

    // The provider got the converted conversation and the tool definitions;
    // nothing ran on the device.
    {
        let seen = h.seen.lock().unwrap();
        let request = &seen.requests[0];
        assert_eq!(request.max_output_tokens, Some(2048));
        assert_eq!(request.model, None);
        let roles: Vec<&str> = request.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, ["system", "user", "assistant", "tool"]);
        assert_eq!(request.messages[3].tool_call_id.as_deref(), Some("c0"));
        assert_eq!(
            request.messages[2].tool_calls.as_ref().unwrap()[0].name,
            "fleet_list_runtimes"
        );
        assert_eq!(request.tools[0].name, "fleet_dispatch");
    }

    h.feed
        .send(Ok(UnifiedResponse {
            tool_call: Some(UnifiedToolCall {
                tool_call_index: Some(0),
                id: Some("call-1".into()),
                name: Some("fleet_dispatch".into()),
                arguments: Some("{\"target\":".into()),
                arguments_is_snapshot: false,
            }),
            ..UnifiedResponse::default()
        }))
        .unwrap();
    h.feed
        .send(Ok(UnifiedResponse {
            tool_call: Some(UnifiedToolCall {
                tool_call_index: Some(0),
                id: None,
                name: None,
                arguments: Some("\"linux\"}".into()),
                arguments_is_snapshot: false,
            }),
            usage: Some(UnifiedTokenUsage {
                prompt_token_count: 120,
                candidates_token_count: 30,
                total_token_count: 150,
                reasoning_token_count: None,
                cached_content_token_count: Some(100),
                cache_creation_token_count: None,
            }),
            finish_reason: Some("tool_calls".into()),
            ..UnifiedResponse::default()
        }))
        .unwrap();
    drop(h.feed);

    // Resumable: a poller that lost the answer to its last poll re-reads
    // from its own cursor; the same chunks come back.
    let mut cursor = 1;
    let mut deltas = Vec::new();
    let finished = loop {
        let page = poll(&h.relay, "round-1", cursor, 5_000).await;
        for chunk in page["chunks"].as_array().unwrap() {
            deltas.push(chunk.clone());
        }
        cursor = page["nextSeq"].as_u64().unwrap();
        if page["done"] == true {
            break page;
        }
    };
    assert_eq!(deltas[0]["toolCall"]["id"], "call-1");
    assert_eq!(deltas[0]["toolCall"]["name"], "fleet_dispatch");
    assert_eq!(deltas[1]["toolCall"]["argumentsDelta"], "\"linux\"}");
    let result = &finished["result"];
    assert_eq!(result["text"], "Dispatching ");
    assert_eq!(result["model"], "scripted-1");
    assert_eq!(result["finishReason"], "tool_calls");
    assert_eq!(
        result["toolCalls"],
        json!([{ "id": "call-1", "name": "fleet_dispatch", "arguments": "{\"target\":\"linux\"}" }])
    );
    assert_eq!(
        result["usage"],
        json!({ "inputTokens": 120, "outputTokens": 30, "cachedTokens": 100 })
    );
    assert!(result.get("error").is_none());
    let replay = poll(&h.relay, "round-1", 0, 0).await;
    assert_eq!(replay["chunks"].as_array().unwrap().len(), 3);
    assert_eq!(replay["done"], true);

    // Usage is recorded once on this device, keyed by the request.
    let records = h.sink.records.lock().unwrap().clone();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].0, "round-1");
    assert_eq!(records[0].1, "model-a");
    assert_eq!(records[0].3.input_tokens, 120);

    // A repeated start with the same body resumes; a different body under
    // the same id is refused.
    let again = h
        .relay
        .handle(FLEET_MODEL_START, start_args("round-1"))
        .await
        .unwrap();
    assert_eq!(again["resumed"], true);
    let mut other = start_args("round-1");
    other["request"]["system"] = json!("something else");
    let conflict = h.relay.handle(FLEET_MODEL_START, other).await.unwrap_err();
    assert!(
        conflict.starts_with("fleet_model_request_conflict:"),
        "{conflict}"
    );
    assert_eq!(h.seen.lock().unwrap().requests.len(), 1);
}

#[tokio::test]
async fn model_relay_cancel_ends_the_round_and_is_idempotent() {
    let h = harness(None);
    h.relay
        .handle(FLEET_MODEL_START, start_args("round-c"))
        .await
        .unwrap();
    h.feed.send(Ok(text("partial"))).unwrap();
    let first = poll(&h.relay, "round-c", 0, 5_000).await;
    assert_eq!(first["chunks"][0]["text"], "partial");

    // A waiting poller wakes up when the round is cancelled.
    let relay = Arc::clone(&h.relay);
    let waiter = tokio::spawn(async move { poll(&relay, "round-c", 1, 20_000).await });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let cancelled = h
        .relay
        .handle(
            FLEET_MODEL_CANCEL,
            json!({ "request": { "requestId": "round-c" } }),
        )
        .await
        .unwrap();
    assert_eq!(cancelled["cancelled"], true);
    let woken = tokio::time::timeout(Duration::from_secs(5), waiter)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(woken["done"], true);
    assert_eq!(woken["result"]["finishReason"], "cancelled");
    assert_eq!(woken["result"]["error"]["code"], "fleet_model_cancelled");

    // Output after the cancel is dropped; a second cancel answers false.
    let _ = h.feed.send(Ok(text("late")));
    tokio::time::sleep(Duration::from_millis(20)).await;
    let after = poll(&h.relay, "round-c", 0, 0).await;
    assert_eq!(after["chunks"].as_array().unwrap().len(), 1);
    let again = h
        .relay
        .handle(FLEET_MODEL_CANCEL, json!({ "requestId": "round-c" }))
        .await
        .unwrap();
    assert_eq!(again["cancelled"], false);
    let unknown = h
        .relay
        .handle(FLEET_MODEL_CANCEL, json!({ "requestId": "never-started" }))
        .await
        .unwrap();
    assert_eq!(unknown["cancelled"], false);
    assert!(h.sink.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn model_relay_reports_provider_failures_and_validation_errors() {
    let refused = harness(Some(RelayError::new(
        "fleet_model_unavailable",
        "no usable model 'primary' is configured on this device",
    )));
    refused
        .relay
        .handle(FLEET_MODEL_START, start_args("round-x"))
        .await
        .unwrap();
    let page = poll(&refused.relay, "round-x", 0, 5_000).await;
    assert_eq!(page["done"], true);
    assert_eq!(page["result"]["error"]["code"], "fleet_model_unavailable");

    let h = harness(None);
    h.relay
        .handle(FLEET_MODEL_START, start_args("round-s"))
        .await
        .unwrap();
    h.feed.send(Ok(text("a"))).unwrap();
    h.feed.send(Err("connection reset".into())).unwrap();
    let mut cursor = 0;
    let finished = loop {
        let page = poll(&h.relay, "round-s", cursor, 5_000).await;
        cursor = page["nextSeq"].as_u64().unwrap();
        if page["done"] == true {
            break page;
        }
    };
    assert_eq!(
        finished["result"]["error"]["code"],
        "fleet_model_provider_error"
    );
    assert_eq!(finished["result"]["text"], "a");

    let unknown = h
        .relay
        .handle(FLEET_MODEL_POLL, json!({ "requestId": "nope" }))
        .await
        .unwrap_err();
    assert!(
        unknown.starts_with("fleet_model_unknown_request:"),
        "{unknown}"
    );

    for (args, needle) in [
        (
            json!({ "requestId": "bad id!", "messages": [{ "role": "user" }] }),
            "requestId",
        ),
        (json!({ "requestId": "r", "messages": [] }), "messages"),
        (
            json!({ "requestId": "r", "messages": [{ "role": "system", "content": "x" }] }),
            "role 'system'",
        ),
        (
            json!({ "requestId": "r", "messages": [{ "role": "tool", "content": "x" }] }),
            "toolCallId",
        ),
        (
            json!({ "requestId": "r", "messages": [{ "role": "user" }], "maxOutputTokens": 0 }),
            "maxOutputTokens",
        ),
        // A field this version does not know is refused, not ignored.
        (
            json!({ "requestId": "r", "messages": [{ "role": "user" }], "temperature": 1 }),
            "unknown field",
        ),
    ] {
        let error = h.relay.handle(FLEET_MODEL_START, args).await.unwrap_err();
        assert!(error.starts_with("fleet_model_invalid_request:"), "{error}");
        assert!(error.contains(needle), "{needle}: {error}");
    }
    assert!(h
        .relay
        .handle("fleet_model_other", json!({}))
        .await
        .unwrap_err()
        .starts_with("fleet_model_unknown_command:"));
}

#[tokio::test]
async fn model_relay_bounds_concurrent_rounds() {
    let mut feeds = Vec::new();
    struct Pending(Mutex<Vec<mpsc::UnboundedReceiver<Result<UnifiedResponse, String>>>>);
    impl ModelProvider for Pending {
        fn open(&self, _: ProviderRequest) -> BoxFuture<Result<ProviderStream, RelayError>> {
            let feed = self.0.lock().unwrap().pop().unwrap();
            Box::pin(async move {
                Ok(ProviderStream {
                    model_id: "m".into(),
                    model_name: "m".into(),
                    stream: futures::stream::unfold(feed, |mut feed| async move {
                        feed.recv().await.map(|item| (item, feed))
                    })
                    .boxed(),
                })
            })
        }
    }
    let mut receivers = Vec::new();
    for _ in 0..3 {
        let (sender, receiver) = mpsc::unbounded_channel();
        feeds.push(sender);
        receivers.push(receiver);
    }
    let relay = ModelRelay::new(
        Arc::new(Pending(Mutex::new(receivers))),
        Arc::new(Arc::new(RecordingSink::default())),
        RelayLimits {
            max_active: 2,
            ..RelayLimits::default()
        },
    );
    relay
        .handle(FLEET_MODEL_START, start_args("a"))
        .await
        .unwrap();
    relay
        .handle(FLEET_MODEL_START, start_args("b"))
        .await
        .unwrap();
    let busy = relay
        .handle(FLEET_MODEL_START, start_args("c"))
        .await
        .unwrap_err();
    assert!(busy.starts_with("fleet_model_busy:"), "{busy}");
    // Finishing one frees a slot.
    feeds.remove(0);
    feeds.remove(0);
    tokio::time::sleep(Duration::from_millis(50)).await;
    relay
        .handle(FLEET_MODEL_START, start_args("c"))
        .await
        .unwrap();
}

#[test]
fn device_settings_default_and_read_tolerantly() {
    let defaults = SuperagentDeviceSettings::default();
    assert!(defaults.accept_dispatch);
    assert!(defaults.allow_auto_approval);
    assert_eq!(SuperagentDeviceSettings::from_config_value(None), defaults);
    assert_eq!(
        SuperagentDeviceSettings::from_config_value(Some(&json!("garbage"))),
        defaults
    );
    let off = SuperagentDeviceSettings::from_config_value(Some(
        &json!({ "acceptDispatch": false, "allowAutoApproval": false, "future": 1 }),
    ));
    assert!(!off.accept_dispatch && !off.allow_auto_approval);
    // A wrongly typed value keeps the default; snake_case is read too.
    let odd = SuperagentDeviceSettings::from_config_value(Some(
        &json!({ "allowAutoApproval": "false", "accept_dispatch": false }),
    ));
    assert!(odd.allow_auto_approval && !odd.accept_dispatch);
    assert!(is_fleet_model_command("fleet_model_poll"));
    assert!(!is_fleet_model_command("fleet_digest"));
}

#[test]
fn the_persisted_section_is_what_the_device_enforces() {
    use crate::service::config::settings_mutations::{
        set_superagent_settings, SuperagentSettingsRequest,
    };
    use crate::service::config::types::SuperagentConfig;

    // What the typed mutation writes reads back as the same switches.
    let written = set_superagent_settings(
        &Value::Null,
        &SuperagentSettingsRequest {
            accept_dispatch: Some(false),
            allow_auto_approval: None,
        },
    )
    .unwrap();
    let read = SuperagentDeviceSettings::from_config_value(Some(&written));
    let typed: SuperagentConfig = serde_json::from_value(written).unwrap();
    assert_eq!(read, SuperagentDeviceSettings::from(typed));
    assert!(!read.accept_dispatch && read.allow_auto_approval);
    // The default section (always serialized) is the default switches.
    let section = serde_json::to_value(SuperagentConfig::default()).unwrap();
    assert_eq!(
        SuperagentDeviceSettings::from_config_value(Some(&section)),
        SuperagentDeviceSettings::default()
    );
}
