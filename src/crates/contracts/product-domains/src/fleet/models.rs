//! The account-wide model catalog (`fleet_models`).
//!
//! Every runtime device publishes the models it has configured (id, display
//! name, provider, capabilities, which one is its primary) in its fleet
//! digest (`FleetDigest::models`; a digest from a build before the catalog
//! has none). The entry projects the catalog grouped by device, with each
//! device's online state, so a session model picker only draws it.
//!
//! A session may run on any device's model: picking a model of another
//! device stores a device-qualified reference, `fleet:<deviceId>/<modelId>`,
//! and the session's model calls then run through that device's model relay
//! over Link (`fleet_model_start` / `_poll` / `_cancel`). Credentials never
//! leave the owner. A plain reference is a model of the device that runs the
//! session, so every selection stored before the catalog reads the same.
//!
//! A device that publishes a catalog also admits the `account-device` scope
//! to its model relay (both ship in the same build), so the catalog itself
//! is the negotiation: a device without one is listed as needing an update
//! and its models are never offered.

use serde::{Deserialize, Serialize};

use super::dto::{null_default, FleetDeviceState, FleetHostKind};
use super::policy::FleetDeviceInput;

/// The prefix of a device-qualified model reference.
pub const FLEET_MODEL_REF_PREFIX: &str = "fleet:";
/// The provider id of the runtime model entries that stand for another
/// device's model on the device that runs a session. Such entries hold no
/// credentials and are never persisted or published.
pub const FLEET_RELAY_PROVIDER: &str = "fleet_relay";
/// Models one device publishes (the rest are dropped, primary kept).
pub const MAX_MODELS_PER_DEVICE: usize = 64;

/// Why a device's models cannot be picked now (`unavailableReason`).
pub const MODEL_REASON_DEVICE_OFFLINE: &str = "device_offline";
/// The device's build publishes no catalog (and its relay does not admit
/// other devices); the user updates it.
pub const MODEL_REASON_DEVICE_REQUIRES_UPDATE: &str = "device_requires_update";
/// The device has no model configured.
pub const MODEL_REASON_NO_MODEL: &str = "no_model";

/// The error prefix of a model round whose owner device is offline.
pub const FLEET_MODEL_DEVICE_OFFLINE: &str = "fleet_model_device_offline";
/// The error prefix of a model round whose owner device is unknown or no
/// longer publishes the model.
pub const FLEET_MODEL_UNAVAILABLE: &str = "fleet_model_unavailable";

/// One configured model of a device, as its digest publishes it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetModel {
    /// The owner's configured model id (`AIModelConfig.id`).
    #[serde(deserialize_with = "null_default")]
    pub model_id: String,
    #[serde(deserialize_with = "null_default")]
    pub display_name: String,
    #[serde(deserialize_with = "null_default")]
    pub provider: String,
    /// The upstream model name (`AIModelConfig.model_name`).
    #[serde(
        deserialize_with = "null_default",
        skip_serializing_if = "String::is_empty"
    )]
    pub model_name: String,
    /// Capability ids (`text_chat`, `image_understanding`, ...).
    #[serde(deserialize_with = "null_default")]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    /// The device's primary model.
    #[serde(deserialize_with = "null_default")]
    pub primary: bool,
    /// What every list shows first: the model ([`configured_model_label`]).
    /// Absent from a digest of a build before the rule; the projection fills
    /// it ([`fill_model_labels`]).
    #[serde(
        deserialize_with = "null_default",
        skip_serializing_if = "String::is_empty"
    )]
    pub label: String,
    /// The secondary text beside the label: the provider, with an ordinal
    /// when two models of one device would read the same.
    #[serde(
        deserialize_with = "null_default",
        skip_serializing_if = "String::is_empty"
    )]
    pub detail: String,
}

// ---------------------------------------------------------------------------
// How a configured model reads (one rule for every list)
// ---------------------------------------------------------------------------

/// A configured model as every picker, list and badge shows it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelLabel {
    /// The model: its upstream name (`gpt-5`), else the configuration's name,
    /// else its id.
    pub label: String,
    /// The provider: the configuration's name (the provider the user set it
    /// up under, `OpenAI`) without a trailing ` - <model>` or `/<model>`,
    /// else the request format (`openai`). Empty when it would only repeat
    /// the label.
    pub detail: String,
}

/// The label of one configured model (`AIModelConfig`: `name`,
/// `model_name`, `provider`, `id`). A configuration's name is the provider
/// the user set the model up under (the model editor and the provider
/// presets name it so), so the model leads and the name follows, as the
/// 1.x model selector and the TUI read it.
pub fn configured_model_label(
    config_name: &str,
    model_name: &str,
    provider: &str,
    model_id: &str,
) -> ModelLabel {
    let model = model_name.trim();
    let name = config_name.trim();
    let provider_name = if model.is_empty() {
        name
    } else {
        name.strip_suffix(model)
            .and_then(|rest| rest.strip_suffix(" - ").or_else(|| rest.strip_suffix('/')))
            .map(str::trim)
            .filter(|rest| !rest.is_empty())
            .unwrap_or(name)
    };
    let label = [model, name, model_id.trim()]
        .into_iter()
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    let detail = [provider_name, provider.trim()]
        .into_iter()
        .find(|value| !value.is_empty() && !value.eq_ignore_ascii_case(&label))
        .unwrap_or_default()
        .to_string();
    ModelLabel { label, detail }
}

/// Makes the labels of one device's models distinguishable: models that
/// would read the same (label and detail) carry an ordinal in their detail,
/// `#1`, `#2`, ... in the order given (the configuration's order).
pub fn disambiguate_model_labels(labels: &mut [ModelLabel]) {
    let key = |label: &ModelLabel| (label.label.to_lowercase(), label.detail.to_lowercase());
    let mut counts = std::collections::BTreeMap::new();
    for label in labels.iter() {
        *counts.entry(key(label)).or_insert(0usize) += 1;
    }
    let mut seen = std::collections::BTreeMap::new();
    for label in labels.iter_mut() {
        let key = key(label);
        if counts.get(&key).copied().unwrap_or(0) < 2 {
            continue;
        }
        let ordinal = seen.entry(key).or_insert(0usize);
        *ordinal += 1;
        label.detail = if label.detail.is_empty() {
            format!("#{ordinal}")
        } else {
            format!("{} #{ordinal}", label.detail)
        };
    }
}

/// The labels of a device's configured models, in order: the rule, then
/// duplicates made distinguishable. `models` yields `(name, model_name,
/// provider, id)`.
pub fn label_configured_models<'a>(
    models: impl IntoIterator<Item = (&'a str, &'a str, &'a str, &'a str)>,
) -> Vec<ModelLabel> {
    let mut labels: Vec<ModelLabel> = models
        .into_iter()
        .map(|(name, model_name, provider, id)| {
            configured_model_label(name, model_name, provider, id)
        })
        .collect();
    disambiguate_model_labels(&mut labels);
    labels
}

impl FleetModel {
    /// The label as published, or the rule applied to what a digest of an
    /// older build carries (its `displayName` is the configuration's name).
    pub fn model_label(&self) -> ModelLabel {
        if self.label.trim().is_empty() {
            configured_model_label(
                &self.display_name,
                &self.model_name,
                &self.provider,
                &self.model_id,
            )
        } else {
            ModelLabel {
                label: self.label.clone(),
                detail: self.detail.clone(),
            }
        }
    }
}

/// Fills the label of every model a digest of an older build published
/// without one, then makes the device's labels distinguishable (a no-op for
/// a catalog its device already labelled).
pub fn fill_model_labels(models: &mut [FleetModel]) {
    let mut labels: Vec<ModelLabel> = models.iter().map(FleetModel::model_label).collect();
    disambiguate_model_labels(&mut labels);
    for (model, label) in models.iter_mut().zip(labels) {
        model.label = label.label;
        model.detail = label.detail;
    }
}

/// A stored session model reference, read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FleetModelRef<'a> {
    /// A model of the device that runs the session (every reference stored
    /// before the catalog, and the role names `primary` / `fast`).
    Local(&'a str),
    /// A model of another device of the account.
    Device {
        device_id: &'a str,
        model_id: &'a str,
    },
}

/// `fleet:<deviceId>/<modelId>`.
pub fn device_model_ref(device_id: &str, model_id: &str) -> String {
    format!("{FLEET_MODEL_REF_PREFIX}{device_id}/{model_id}")
}

/// Reads a stored reference. A malformed qualified reference (no device or
/// no model) reads as local, verbatim, so it fails as an unknown model
/// instead of being routed anywhere.
pub fn parse_model_ref(raw: &str) -> FleetModelRef<'_> {
    let trimmed = raw.trim();
    let Some(rest) = trimmed.strip_prefix(FLEET_MODEL_REF_PREFIX) else {
        return FleetModelRef::Local(trimmed);
    };
    match rest.split_once('/') {
        Some((device_id, model_id)) if !device_id.is_empty() && !model_id.is_empty() => {
            FleetModelRef::Device {
                device_id,
                model_id,
            }
        }
        _ => FleetModelRef::Local(trimmed),
    }
}

/// The model of `raw` on `self_device_id` when the reference names a model
/// of that device (plain, or qualified with its own id); `None` for a model
/// of another device.
pub fn local_model_id<'a>(raw: &'a str, self_device_id: &str) -> Option<&'a str> {
    match parse_model_ref(raw) {
        FleetModelRef::Local(model_id) => Some(model_id),
        FleetModelRef::Device {
            device_id,
            model_id,
        } if device_id == self_device_id => Some(model_id),
        FleetModelRef::Device { .. } => None,
    }
}

/// The English sentence of a round that cannot start because the model's
/// device is offline (the turn fails at once with it; it never waits).
pub fn device_offline_message(model: &str, device: &str) -> String {
    format!("{FLEET_MODEL_DEVICE_OFFLINE}: {model} lives on {device}, which is offline")
}

/// Bounds and cleans one device's published catalog: models without an id
/// are dropped, ids are de-duplicated, at most one model is primary (the
/// first), the list is bounded with the primary kept, and every model has
/// a label ([`fill_model_labels`]).
pub fn bound_catalog(models: &mut Vec<FleetModel>) {
    let mut seen = std::collections::BTreeSet::new();
    models.retain(|model| !model.model_id.trim().is_empty() && seen.insert(model.model_id.clone()));
    let mut primary_seen = false;
    for model in models.iter_mut() {
        if model.primary {
            if primary_seen {
                model.primary = false;
            }
            primary_seen = true;
        }
    }
    if models.len() > MAX_MODELS_PER_DEVICE {
        if let Some(index) = models.iter().position(|model| model.primary) {
            if index >= MAX_MODELS_PER_DEVICE {
                let primary = models.remove(index);
                models.insert(0, primary);
            }
        }
        models.truncate(MAX_MODELS_PER_DEVICE);
    }
    fill_model_labels(models);
}

// ---------------------------------------------------------------------------
// The catalog view (`fleet_models`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetModelsRequest {
    /// The device that runs the session the picker is for (its models are
    /// plain references, every other device's are qualified). Absent or
    /// empty: the serving host.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
}

/// One model as the picker offers it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetModelChoice {
    #[serde(flatten)]
    pub model: FleetModel,
    /// What the picker stores (`update_session_model {modelName}`).
    #[serde(deserialize_with = "null_default")]
    pub model_ref: String,
    #[serde(deserialize_with = "null_default")]
    pub selectable: bool,
}

/// One device's group in the picker.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetModelsDevice {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    #[serde(deserialize_with = "null_default")]
    pub state: FleetDeviceState,
    #[serde(deserialize_with = "null_default")]
    pub online: bool,
    /// The device that runs the session ("this device"; listed first).
    #[serde(deserialize_with = "null_default")]
    pub is_this_device: bool,
    /// Why this device's models cannot be picked now; absent when they can.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub models: Vec<FleetModelChoice>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetModels {
    /// The index revision the catalog was projected at.
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub devices: Vec<FleetModelsDevice>,
}

fn holds_models(kind: FleetHostKind) -> bool {
    matches!(kind, FleetHostKind::Desktop | FleetHostKind::Cli)
}

/// The catalog grouped by device: the device that runs the session first,
/// then online devices, then by name (case-insensitive) and id. The cloud
/// node holds no models and is not listed. A device's models are offered
/// when it is that device, or it is online and publishes a catalog.
pub fn project_fleet_models(
    revision: u64,
    this_device_id: &str,
    devices: &[FleetDeviceInput<'_>],
) -> FleetModels {
    let mut groups: Vec<FleetModelsDevice> = devices
        .iter()
        .filter(|input| {
            holds_models(input.facts.host_kind) || input.facts.device_id == this_device_id
        })
        .map(|input| {
            let facts = input.facts;
            let is_this_device = facts.device_id == this_device_id;
            let online = facts.state == FleetDeviceState::Online || is_this_device;
            let catalog = input
                .partition
                .and_then(|partition| partition.models.clone());
            let mut models = catalog.clone().unwrap_or_default();
            bound_catalog(&mut models);
            let unavailable_reason = if is_this_device {
                models.is_empty().then(|| MODEL_REASON_NO_MODEL.to_string())
            } else if !online {
                Some(MODEL_REASON_DEVICE_OFFLINE.to_string())
            } else if catalog.is_none() {
                Some(MODEL_REASON_DEVICE_REQUIRES_UPDATE.to_string())
            } else if models.is_empty() {
                Some(MODEL_REASON_NO_MODEL.to_string())
            } else {
                None
            };
            let selectable = unavailable_reason.is_none();
            let models = models
                .into_iter()
                .map(|model| FleetModelChoice {
                    model_ref: if is_this_device {
                        model.model_id.clone()
                    } else {
                        device_model_ref(&facts.device_id, &model.model_id)
                    },
                    selectable,
                    model,
                })
                .collect();
            FleetModelsDevice {
                device_id: facts.device_id.clone(),
                name: facts.name.clone(),
                host_kind: facts.host_kind,
                state: facts.state,
                online,
                is_this_device,
                unavailable_reason,
                models,
            }
        })
        .collect();
    groups.sort_by(|a, b| {
        b.is_this_device
            .cmp(&a.is_this_device)
            .then_with(|| b.online.cmp(&a.online))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.device_id.cmp(&b.device_id))
    });
    FleetModels {
        revision,
        devices: groups,
    }
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
