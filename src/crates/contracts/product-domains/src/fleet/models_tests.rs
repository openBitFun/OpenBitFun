use super::*;
use crate::fleet::{FleetDeviceFacts, FleetDigest};

fn facts(id: &str, name: &str, kind: FleetHostKind, state: FleetDeviceState) -> FleetDeviceFacts {
    FleetDeviceFacts {
        device_id: id.to_string(),
        name: name.to_string(),
        host_kind: kind,
        state,
        ..FleetDeviceFacts::default()
    }
}

fn model(id: &str, primary: bool) -> FleetModel {
    FleetModel {
        model_id: id.to_string(),
        display_name: id.to_uppercase(),
        provider: "openai".to_string(),
        capabilities: vec!["text_chat".to_string()],
        primary,
        ..FleetModel::default()
    }
}

fn digest(models: Option<Vec<FleetModel>>) -> FleetDigest {
    FleetDigest {
        instance_id: "i".to_string(),
        revision: 2,
        full: true,
        models,
        ..FleetDigest::default()
    }
}

#[test]
fn references_are_device_qualified_and_plain_ones_stay_local() {
    let qualified = device_model_ref("desk-2", "model-a");
    assert_eq!(qualified, "fleet:desk-2/model-a");
    assert_eq!(
        parse_model_ref(&qualified),
        FleetModelRef::Device {
            device_id: "desk-2",
            model_id: "model-a"
        }
    );
    // Every selection stored before the catalog reads as local.
    assert_eq!(parse_model_ref("model-a"), FleetModelRef::Local("model-a"));
    assert_eq!(
        parse_model_ref(" primary "),
        FleetModelRef::Local("primary")
    );
    assert_eq!(
        parse_model_ref("sdk:openai:fixture"),
        FleetModelRef::Local("sdk:openai:fixture")
    );
    // A model id may itself contain a slash.
    assert_eq!(
        parse_model_ref("fleet:desk-2/openrouter/claude"),
        FleetModelRef::Device {
            device_id: "desk-2",
            model_id: "openrouter/claude"
        }
    );
    // Malformed qualified references are never routed.
    assert_eq!(
        parse_model_ref("fleet:/m"),
        FleetModelRef::Local("fleet:/m")
    );
    assert_eq!(
        parse_model_ref("fleet:desk"),
        FleetModelRef::Local("fleet:desk")
    );
    assert_eq!(local_model_id("fleet:desk-1/m", "desk-1"), Some("m"));
    assert_eq!(local_model_id("fleet:desk-2/m", "desk-1"), None);
    assert_eq!(local_model_id("m", "desk-1"), Some("m"));
    assert_eq!(
        device_offline_message("GPT", "Laptop"),
        "fleet_model_device_offline: GPT lives on Laptop, which is offline"
    );
}

#[test]
fn an_older_digest_without_a_catalog_reads_and_a_new_one_round_trips() {
    let old = serde_json::json!({
        "deviceId": "d", "instanceId": "i", "revision": 3, "full": true,
        "workspaces": [], "sessions": [], "prompts": [], "sessionsTruncated": false
    });
    let parsed: FleetDigest = serde_json::from_value(old).unwrap();
    assert_eq!(parsed.models, None);
    assert!(serde_json::to_value(&parsed)
        .unwrap()
        .get("models")
        .is_none());

    let new = digest(Some(vec![model("a", true)]));
    let encoded = serde_json::to_value(&new).unwrap();
    assert_eq!(encoded["models"][0]["modelId"], "a");
    assert_eq!(encoded["models"][0]["primary"], true);
    let back: FleetDigest = serde_json::from_value(encoded).unwrap();
    assert_eq!(back, new);
    // A null catalog entry field reads as its default.
    let tolerant: FleetModel = serde_json::from_value(
        serde_json::json!({"modelId": "x", "capabilities": null, "future": 1}),
    )
    .unwrap();
    assert_eq!(tolerant.model_id, "x");
    assert!(tolerant.capabilities.is_empty());
}

#[test]
fn the_catalog_is_bounded_with_one_primary_kept() {
    let mut models: Vec<FleetModel> = (0..80).map(|i| model(&format!("m{i}"), false)).collect();
    models.push(model("m3", true)); // duplicate id dropped
    models[70].primary = true;
    models[75].primary = true;
    models.insert(0, model("", false));
    bound_catalog(&mut models);
    assert_eq!(models.len(), MAX_MODELS_PER_DEVICE);
    assert_eq!(models.iter().filter(|m| m.primary).count(), 1);
    assert_eq!(models[0].model_id, "m70");
}

#[test]
fn the_picker_lists_this_device_first_and_offers_only_reachable_catalogs() {
    let this = facts(
        "desk-1",
        "Studio",
        FleetHostKind::Desktop,
        FleetDeviceState::Online,
    );
    let laptop = facts(
        "desk-2",
        "laptop",
        FleetHostKind::Desktop,
        FleetDeviceState::Online,
    );
    let server = facts(
        "cli-1",
        "Build box",
        FleetHostKind::Cli,
        FleetDeviceState::Offline,
    );
    let old = facts(
        "cli-2",
        "Old box",
        FleetHostKind::Cli,
        FleetDeviceState::Online,
    );
    let cloud = facts(
        "cloud-1",
        "Super Agent",
        FleetHostKind::Cloud,
        FleetDeviceState::Online,
    );
    let this_digest = digest(Some(vec![model("local", true)]));
    let laptop_digest = digest(Some(vec![model("fast", false), model("big", true)]));
    let server_digest = digest(Some(vec![model("srv", true)]));
    let old_digest = digest(None);
    let input = |facts, partition| FleetDeviceInput {
        facts,
        partition,
        changed_revision: 0,
    };
    let devices = [
        input(&server, Some(&server_digest)),
        input(&cloud, None),
        input(&old, Some(&old_digest)),
        input(&laptop, Some(&laptop_digest)),
        input(&this, Some(&this_digest)),
    ];
    let view = project_fleet_models(9, "desk-1", &devices);
    assert_eq!(view.revision, 9);
    let ids: Vec<&str> = view.devices.iter().map(|d| d.device_id.as_str()).collect();
    assert_eq!(ids, ["desk-1", "desk-2", "cli-2", "cli-1"]);

    let first = &view.devices[0];
    assert!(first.is_this_device && first.online);
    assert_eq!(first.models[0].model_ref, "local");
    assert!(first.models[0].selectable);

    let laptop = &view.devices[1];
    assert_eq!(laptop.unavailable_reason, None);
    assert_eq!(laptop.models[1].model_ref, "fleet:desk-2/big");
    assert!(laptop.models[1].model.primary);
    assert!(laptop.models.iter().all(|m| m.selectable));

    assert_eq!(
        view.devices[2].unavailable_reason.as_deref(),
        Some(MODEL_REASON_DEVICE_REQUIRES_UPDATE)
    );
    assert!(view.devices[2].models.is_empty());

    let offline = &view.devices[3];
    assert!(!offline.online);
    assert_eq!(
        offline.unavailable_reason.as_deref(),
        Some(MODEL_REASON_DEVICE_OFFLINE)
    );
    assert_eq!(offline.models.len(), 1);
    assert!(!offline.models[0].selectable);

    // Relative to another device: its models become plain, ours qualified.
    let view = project_fleet_models(9, "desk-2", &devices);
    assert_eq!(view.devices[0].device_id, "desk-2");
    assert_eq!(view.devices[0].models[0].model_ref, "fast");
    let studio = view
        .devices
        .iter()
        .find(|d| d.device_id == "desk-1")
        .unwrap();
    assert_eq!(studio.models[0].model_ref, "fleet:desk-1/local");
}
