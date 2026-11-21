//! The device side of the account-wide model catalog: what a device
//! publishes, the runtime entries it mirrors for other devices' models, and
//! a session round run end to end through a real `ModelRelay` on a fake
//! owner device (and refused at once when the owner is offline).

use std::sync::{Arc, Mutex};

use futures::StreamExt;
use openbitfun_ai_adapters::client::relay_transport::RelayStreamRequest;
use openbitfun_ai_adapters::{UnifiedResponse, UnifiedToolCall};
use openbitfun_product_domains::fleet::{FleetModelChoice, FleetModelsDevice};
use serde_json::{json, Value};

use super::*;
use crate::service::config::types::AIConfig as ConfigAIConfig;
use crate::service::superagent_relay::{
    BoxFuture, ModelProvider, ModelRelay, ModelUsageSink, ProviderRequest, ProviderStream,
    RelayError, RelayLimits, RelayUsage,
};

fn configured(id: &str, name: &str, provider: &str, caps: Vec<ModelCapability>) -> AIModelConfig {
    AIModelConfig {
        id: id.into(),
        name: name.into(),
        provider: provider.into(),
        model_name: format!("{id}-upstream"),
        base_url: "https://example.invalid/v1".into(),
        api_key: "fixture-secret".into(),
        enabled: true,
        capabilities: caps,
        context_window: Some(128_000),
        ..AIModelConfig::default()
    }
}

#[test]
fn a_device_publishes_its_enabled_chat_models_without_relay_entries_or_secrets() {
    let mut ai = ConfigAIConfig::default();
    ai.models = vec![
        configured(
            "m-chat",
            "GPT",
            "openai",
            vec![
                ModelCapability::TextChat,
                ModelCapability::ImageUnderstanding,
            ],
        ),
        configured(
            "m-embed",
            "Embed",
            "openai",
            vec![ModelCapability::Embedding],
        ),
        configured(
            "fleet:desk-2/x",
            "Remote",
            FLEET_RELAY_PROVIDER,
            vec![ModelCapability::TextChat],
        ),
        AIModelConfig {
            enabled: false,
            ..configured("m-off", "Off", "anthropic", vec![ModelCapability::TextChat])
        },
        configured("m-fast", "", "anthropic", vec![ModelCapability::TextChat]),
    ];
    ai.default_models.primary = Some("m-fast".into());
    let catalog = catalog_of(&ai);
    let ids: Vec<&str> = catalog.iter().map(|m| m.model_id.as_str()).collect();
    assert_eq!(ids, ["m-chat", "m-fast"]);
    assert_eq!(
        catalog[0].capabilities,
        ["text_chat", "image_understanding"]
    );
    assert_eq!(catalog[0].context_window, Some(128_000));
    assert!(!catalog[0].primary);
    assert!(catalog[1].primary);
    // An unnamed model shows its upstream name.
    assert_eq!(catalog[1].display_name, "m-fast-upstream");
    let wire = serde_json::to_string(&catalog).unwrap();
    assert!(!wire.contains("fixture-secret") && !wire.contains("example.invalid"));
}

fn choice(device: &str, model: &str, this: bool) -> FleetModelChoice {
    FleetModelChoice {
        model: FleetModel {
            model_id: model.into(),
            display_name: model.to_uppercase(),
            provider: "openai".into(),
            capabilities: vec!["image_understanding".into()],
            context_window: Some(64_000),
            ..FleetModel::default()
        },
        model_ref: if this {
            model.into()
        } else {
            device_model_ref(device, model)
        },
        selectable: true,
    }
}

#[test]
fn other_devices_models_become_credential_free_runtime_entries() {
    let view = FleetModels {
        revision: 1,
        devices: vec![
            FleetModelsDevice {
                device_id: "desk-1".into(),
                name: "Studio".into(),
                is_this_device: true,
                models: vec![choice("desk-1", "local", true)],
                ..FleetModelsDevice::default()
            },
            FleetModelsDevice {
                device_id: "desk-2".into(),
                name: "Laptop".into(),
                models: vec![choice("desk-2", "big", false)],
                ..FleetModelsDevice::default()
            },
            FleetModelsDevice {
                device_id: "cli-1".into(),
                name: "Box".into(),
                online: false,
                models: vec![choice("cli-1", "srv", false)],
                ..FleetModelsDevice::default()
            },
        ],
    };
    let wanted = wanted_entries(&view);
    let ids: Vec<&str> = wanted.keys().map(String::as_str).collect();
    // Offline devices too: a stored reference resolves and fails fast.
    assert_eq!(ids, ["fleet:cli-1/srv", "fleet:desk-2/big"]);
    let entry = &wanted["fleet:desk-2/big"];
    assert_eq!(entry.provider, FLEET_RELAY_PROVIDER);
    assert_eq!(entry.name, "BIG (Laptop)");
    assert!(entry.api_key.is_empty());
    assert_eq!(entry.request_url.as_deref(), Some("fleet:desk-2/big"));
    assert_eq!(
        entry.capabilities,
        [
            ModelCapability::TextChat,
            ModelCapability::ImageUnderstanding
        ]
    );
    // It converts into a client config like any configured model.
    let runtime = openbitfun_ai_adapters::AIConfig::try_from(entry.clone()).unwrap();
    assert_eq!(runtime.format, FLEET_RELAY_PROVIDER);
    assert_eq!(runtime.request_url, "fleet:desk-2/big");
    assert_eq!(runtime.context_window, 64_000);
}

#[test]
fn a_round_is_relayed_with_system_tools_and_tool_results() {
    let mut assistant = Message::assistant_with_tools(vec![crate::util::types::ToolCall {
        id: "call-1".into(),
        name: "Read".into(),
        arguments: json!({"path": "a.rs"}),
        raw_arguments: None,
    }]);
    assistant.content = Some("Reading.".into());
    let mut tool = Message::user("fn main() {}".into());
    tool.role = "tool".into();
    tool.tool_call_id = Some("call-1".into());
    tool.name = Some("Read".into());
    tool.is_error = Some(false);
    let messages = vec![
        Message::system("You are helpful.".into()),
        Message::user("Read a.rs".into()),
        assistant,
        tool,
    ];
    let tools = vec![ToolDefinition {
        name: "Read".into(),
        description: "Read a file".into(),
        parameters: json!({"type": "object"}),
    }];
    let start = relay_start_request("dev-1", "big", &messages, Some(&tools), Some(500_000));
    let request = &start["request"];
    assert_eq!(request["model"], "big");
    assert_eq!(request["system"], "You are helpful.");
    assert_eq!(request["maxOutputTokens"], 128_000);
    let roles: Vec<&str> = request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["role"].as_str().unwrap())
        .collect();
    assert_eq!(roles, ["user", "assistant", "tool"]);
    assert_eq!(
        request["messages"][1]["toolCalls"][0]["arguments"],
        "{\"path\":\"a.rs\"}"
    );
    assert_eq!(request["messages"][2]["toolCallId"], "call-1");
    assert_eq!(request["tools"][0]["name"], "Read");
    // The relay's own strict parser reads it.
    let parsed: crate::service::superagent_relay::FleetModelStartRequest =
        serde_json::from_value(request.clone()).unwrap();
    assert_eq!(parsed.messages.len(), 3);

    let error = finish_response(RelayResult {
        error: Some(RelayError::new("fleet_model_busy", "busy")),
        ..RelayResult::default()
    })
    .unwrap_err();
    let provider = error.downcast_ref::<AiProviderError>().unwrap();
    assert_eq!(provider.category, ErrorCategory::RateLimit);
    let done = finish_response(RelayResult {
        tool_calls: vec![RelayToolCall {
            id: "c".into(),
            name: "Read".into(),
            arguments: "{}".into(),
        }],
        model: "upstream".into(),
        ..RelayResult::default()
    })
    .unwrap();
    assert_eq!(done.finish_reason.as_deref(), Some("tool_calls"));
    assert_eq!(
        done.tool_call_completion,
        Some(ToolCallCompletion::NormalToolUse)
    );
}

// ---------------------------------------------------------------------------
// End to end over a fake owner
// ---------------------------------------------------------------------------

struct Scripted;

impl ModelProvider for Scripted {
    fn open(&self, request: ProviderRequest) -> BoxFuture<Result<ProviderStream, RelayError>> {
        Box::pin(async move {
            assert_eq!(request.model.as_deref(), Some("big"));
            let items: Vec<Result<UnifiedResponse, String>> = vec![
                Ok(UnifiedResponse {
                    text: Some("Hello ".into()),
                    ..UnifiedResponse::default()
                }),
                Ok(UnifiedResponse {
                    text: Some("from the laptop".into()),
                    ..UnifiedResponse::default()
                }),
                Ok(UnifiedResponse {
                    tool_call: Some(UnifiedToolCall {
                        tool_call_index: Some(0),
                        id: Some("call-9".into()),
                        name: Some("Read".into()),
                        arguments: Some("{\"path\":".into()),
                        arguments_is_snapshot: false,
                    }),
                    ..UnifiedResponse::default()
                }),
                Ok(UnifiedResponse {
                    tool_call: Some(UnifiedToolCall {
                        tool_call_index: Some(0),
                        id: None,
                        name: None,
                        arguments: Some("\"a.rs\"}".into()),
                        arguments_is_snapshot: false,
                    }),
                    finish_reason: Some("tool_calls".into()),
                    ..UnifiedResponse::default()
                }),
            ];
            Ok(ProviderStream {
                model_id: "big".into(),
                model_name: "big-upstream".into(),
                stream: futures::stream::iter(items).boxed(),
            })
        })
    }
}

struct NoUsage;

impl ModelUsageSink for NoUsage {
    fn record(&self, _: String, _: String, _: String, _: RelayUsage) -> BoxFuture<()> {
        Box::pin(async {})
    }
}

struct FakePeers {
    online: bool,
    relay: Arc<ModelRelay>,
    calls: Mutex<Vec<String>>,
}

impl FleetModelPeers for FakePeers {
    fn self_device_id(&self) -> String {
        "desk-1".into()
    }

    fn owner(&self, device_id: &str) -> Option<ModelOwner> {
        (device_id == "desk-2").then(|| ModelOwner {
            name: "Laptop".into(),
            online: self.online,
            models: Some(vec![FleetModel {
                model_id: "big".into(),
                display_name: "Big model".into(),
                ..FleetModel::default()
            }]),
        })
    }

    fn call<'a>(
        &'a self,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> PeersFuture<'a, Result<Value, String>> {
        assert_eq!(device_id, "desk-2");
        self.calls.lock().unwrap().push(command.to_string());
        Box::pin(async move { self.relay.handle(command, args).await })
    }
}

fn round_request() -> RelayStreamRequest {
    let entry = runtime_entry(
        "desk-2",
        "Laptop",
        &FleetModel {
            model_id: "big".into(),
            display_name: "Big model".into(),
            ..FleetModel::default()
        },
    );
    RelayStreamRequest {
        config: openbitfun_ai_adapters::AIConfig::try_from(entry).unwrap(),
        messages: vec![Message::user("hi".into())],
        tools: None,
    }
}

/// One test owns the process-wide peers (tests run in parallel).
#[tokio::test]
async fn a_session_round_runs_on_the_owner_and_fails_at_once_when_it_is_offline() {
    let relay = ModelRelay::new(
        Arc::new(Scripted),
        Arc::new(NoUsage),
        RelayLimits::default(),
    );
    let peers = Arc::new(FakePeers {
        online: true,
        relay: Arc::clone(&relay),
        calls: Mutex::new(Vec::new()),
    });
    install_peers(Arc::clone(&peers) as Arc<dyn FleetModelPeers>);

    // A self-qualified reference reads as the plain local model.
    assert_eq!(local_model_ref("fleet:desk-1/local"), "local");
    assert_eq!(local_model_ref("fleet:desk-2/big"), "fleet:desk-2/big");
    assert_eq!(unresolved_model_error("local"), None);

    let response = FleetRelayTransport.open(round_request()).await.unwrap();
    let items: Vec<UnifiedResponse> = response.stream.map(|item| item.unwrap()).collect().await;
    let text: String = items.iter().filter_map(|i| i.text.clone()).collect();
    assert_eq!(text, "Hello from the laptop");
    let arguments: String = items
        .iter()
        .filter_map(|i| i.tool_call.as_ref().and_then(|c| c.arguments.clone()))
        .collect();
    assert_eq!(arguments, "{\"path\":\"a.rs\"}");
    let last = items.last().unwrap();
    assert_eq!(last.finish_reason.as_deref(), Some("tool_calls"));
    assert_eq!(last.response_model.as_deref(), Some("big-upstream"));
    let calls = peers.calls.lock().unwrap().clone();
    assert_eq!(calls[0], FLEET_MODEL_START);
    assert!(calls[1..].iter().all(|c| c == FLEET_MODEL_POLL));

    // Offline owner: refused before any call, never retried.
    let offline = Arc::new(FakePeers {
        online: false,
        relay,
        calls: Mutex::new(Vec::new()),
    });
    install_peers(Arc::clone(&offline) as Arc<dyn FleetModelPeers>);
    let error = FleetRelayTransport
        .open(round_request())
        .await
        .err()
        .unwrap();
    let provider = error.downcast_ref::<AiProviderError>().unwrap();
    assert_eq!(
        provider.message,
        "fleet_model_device_offline: Big model lives on Laptop, which is offline"
    );
    assert_eq!(provider.category, ErrorCategory::InvalidRequest);
    assert!(!openbitfun_agent_stream::retry::should_retry_error(
        provider
    ));
    assert!(offline.calls.lock().unwrap().is_empty());
    assert_eq!(
        unresolved_model_error("fleet:desk-2/gone").as_deref(),
        Some("fleet_model_device_offline: gone lives on Laptop, which is offline")
    );

    // Through the AI client, exactly as a session turn sends.
    let client = openbitfun_ai_adapters::AIClient::new(round_request().config);
    let error = client
        .send_message_stream(vec![Message::user("hi".into())], None, None)
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("lives on Laptop"), "{error}");

    clear_peers();
    let error = FleetRelayTransport
        .open(round_request())
        .await
        .err()
        .unwrap();
    assert!(error
        .to_string()
        .contains("not on the account's device network"));
}
