//! The host glue's pure parts: presence merging, the web UI choice and the
//! version key. The end-to-end paths (two hosts, a client, failover) are in
//! `host_e2e_tests.rs`.

use super::*;

fn peer(id: &str, role: &str, route: Option<&str>, latency: Option<f64>) -> MeshPeer {
    serde_json::from_value(json!({
        "peerId": format!("p-{id}"),
        "hostname": id,
        "virtualIp": "10.126.0.2",
        "path": if route.is_some_and(|route| route.starts_with("relayed")) { "relayed" } else { "p2p" },
        "route": route,
        "hops": 1,
        "role": role,
        "displayName": format!("{id} advertised"),
        "latencyMs": latency,
    }))
    .unwrap()
}

fn row(id: &str, name: &str, kind: Option<&str>, online: bool) -> FleetDirectoryDevice {
    FleetDirectoryDevice {
        device_id: id.into(),
        name: name.into(),
        kind: kind.map(str::to_string),
        online,
        version: Some("1.2.3".into()),
        last_seen_ms: Some(42),
    }
}

#[test]
fn presence_merges_the_device_network_with_the_directory() {
    let peers = vec![
        peer("self-dev", "device", Some("direct_lan"), Some(0.2)),
        peer("desk-mesh", "device", Some("relayed_peer"), Some(48.6)),
        peer("cli-mesh", "device", Some("direct_ipv4"), None),
        peer("phone-1", "controller", Some("relayed_server"), None),
        peer("not-listed", "device", None, None),
    ];
    let directory = vec![
        row("desk-mesh", "Studio", Some("desktop"), false),
        row("cli-mesh", "Build box", Some("cli"), false),
        row("phone-1", "Phone", Some("mobile"), true),
        row("relay-only", "Old laptop", None, true),
        row("asleep", "Tower", Some("desktop"), false),
        row("cloud-abc", "OpenBitFun", Some("cloud_agent"), true),
        row("self-dev", "This one", Some("desktop"), true),
    ];
    let presence = merge_presence("self-dev", &peers, Some(&directory), 1_000);
    let by_id = |id: &str| presence.iter().find(|p| p.device_id == id).cloned();
    let ids: Vec<&str> = presence.iter().map(|p| p.device_id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "desk-mesh",
            "cli-mesh",
            "not-listed",
            "relay-only",
            "asleep",
            "cloud-abc"
        ],
        "self and controllers are not listed; the cloud node comes from its own row"
    );
    // Without a cloud dialer the cloud node is listed unknown, never dialed.
    let cloud = by_id("cloud-abc").unwrap();
    assert_eq!(cloud.host_kind, FleetHostKind::Cloud);
    assert_eq!(
        cloud.unsupported.as_deref(),
        Some("cloud_connector_unavailable")
    );
    let dialed = merge_presence_with("self-dev", &peers, Some(&directory), 1_000, true);
    let cloud = dialed.iter().find(|p| p.device_id == "cloud-abc").unwrap();
    assert!(cloud.online && cloud.mesh && cloud.unsupported.is_none());
    assert_eq!(cloud.route, None);

    let desk = by_id("desk-mesh").unwrap();
    assert_eq!(desk.name, "Studio");
    assert_eq!(desk.host_kind, FleetHostKind::Desktop);
    assert!(desk.online && desk.mesh);
    let route = desk.route.unwrap();
    assert_eq!(route.kind, FleetRouteKind::RelayedPeer);
    assert_eq!(route.latency_ms, Some(49));
    assert_eq!(desk.version.as_deref(), Some("1.2.3"));
    assert_eq!(desk.as_of_ms, 1_000);

    assert_eq!(by_id("cli-mesh").unwrap().host_kind, FleetHostKind::Cli);
    // On the network but not (yet) in the directory: its advertised name.
    let unlisted = by_id("not-listed").unwrap();
    assert_eq!(unlisted.name, "not-listed advertised");
    assert_eq!(unlisted.route.unwrap().kind, FleetRouteKind::Unknown);

    // Online only on the legacy relay: an older host (update required).
    let relay_only = by_id("relay-only").unwrap();
    assert!(relay_only.online && !relay_only.mesh);
    assert_eq!(relay_only.host_kind, FleetHostKind::Desktop);
    // Not online anywhere: offline, not outdated.
    let asleep = by_id("asleep").unwrap();
    assert!(!asleep.online && asleep.mesh);
    assert_eq!(asleep.as_of_ms, 42);
}

#[test]
fn presence_without_the_directory_keeps_the_device_network() {
    let peers = vec![
        peer("desk-mesh", "device", Some("direct_lan"), Some(1.0)),
        peer("phone-1", "controller", None, None),
    ];
    let presence = merge_presence("self-dev", &peers, None, 7);
    assert_eq!(presence.len(), 1);
    assert_eq!(presence[0].name, "desk-mesh advertised");
    assert_eq!(presence[0].host_kind, FleetHostKind::Desktop);
}

fn manifest(version: &str, marker: &str, min_entry: Option<u64>) -> Value {
    let mut manifest = json!({
        "schema": 1,
        "product": "openbitfun",
        "version": version,
        "nsh": "0.6.1",
        "entry": "index.html",
        "files": [{ "path": "index.html", "sha256": format!("{:0>64}", marker), "size": 1 }],
    });
    if let Some(min_entry) = min_entry {
        manifest["minEntryFleetProtocol"] = json!(min_entry);
    }
    manifest
}

fn answer(manifest: Value) -> Value {
    // A wrong stated id: never trusted.
    json!({ "manifest": manifest, "bundleId": "stated-id" })
}

#[test]
fn the_newest_runnable_bundle_wins_with_every_holder() {
    let old = manifest("1.0.0", "a", None);
    let new = manifest("1.1.0", "b", Some(1));
    let future = manifest("9.0.0", "c", Some(u64::from(FLEET_PROTOCOL_VERSION) + 1));
    let answers = vec![
        ("entry".to_string(), answer(old.clone())),
        ("peer-b".to_string(), answer(new.clone())),
        ("peer-a".to_string(), answer(new.clone())),
        ("peer-z".to_string(), answer(future)),
        ("broken".to_string(), json!({ "error": "no bundle" })),
    ];
    let chosen = choose_ui_bundle("entry", &answers).unwrap();
    assert_eq!(chosen.manifest, new);
    assert_eq!(
        chosen.bundle_id,
        crate::ui_bundle::bundle_id(&new).unwrap(),
        "the id is recomputed"
    );
    assert_eq!(chosen.owner_device_id, "peer-a");
    assert_eq!(chosen.holders, ["peer-a", "peer-b"]);

    // A tie goes to the entry, which then leads the holders.
    let answers = vec![
        ("peer-a".to_string(), answer(old.clone())),
        ("entry".to_string(), answer(old.clone())),
    ];
    let chosen = choose_ui_bundle("entry", &answers).unwrap();
    assert_eq!(chosen.owner_device_id, "entry");
    assert_eq!(chosen.holders, ["entry", "peer-a"]);

    assert!(choose_ui_bundle("entry", &[]).is_none());
}

#[test]
fn versions_order_releases_after_their_prereleases() {
    assert!(parse_version("1.2.3").unwrap() > parse_version("1.2.3-beta.1").unwrap());
    assert!(parse_version("v1.10.0").unwrap() > parse_version("1.9.9").unwrap());
    assert_eq!(parse_version("1.2.3+build.7"), Some((1, 2, 3, true)));
    assert_eq!(parse_version("1.2"), None);
    assert_eq!(parse_version("1.2.3.4"), None);
    assert_eq!(parse_version("next"), None);
}

#[test]
fn fleet_verbs_and_owner_verbs_are_known() {
    for command in openbitfun_product_domains::remote_surface::fleet_entry_commands() {
        assert!(is_fleet_host_command(command), "{command}");
    }
    for verb in FLEET_OWNER_VERBS {
        assert!(is_fleet_host_command(verb));
        assert!(is_fleet_owner_verb(verb));
    }
    assert!(!is_fleet_host_command("fleet_model_start"));
    assert!(fleet_unavailable("fleet_navigator").starts_with("fleet_unavailable:"));
}

struct Listed {
    presence: Vec<FleetPeerPresence>,
    complete: bool,
}

impl FleetPresenceSource for Listed {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        let presence = self.presence.clone();
        Box::pin(async move { presence })
    }

    fn lists_every_device(&self) -> bool {
        self.complete
    }
}

fn present(id: &str, online: bool) -> FleetPeerPresence {
    FleetPeerPresence {
        device_id: id.into(),
        name: id.into(),
        host_kind: FleetHostKind::Desktop,
        online,
        mesh: true,
        as_of_ms: 1,
        ..FleetPeerPresence::default()
    }
}

#[tokio::test]
async fn devices_leave_the_index_only_when_the_directory_drops_them() {
    let index = FleetIndex::new("self-dev".into(), None, None);
    index.set_presence(&[present("gone", true), present("asleep", true)]);
    let mut ids = index.device_ids();
    ids.sort();
    assert_eq!(ids, ["asleep", "gone", "self-dev"]);

    // Without the directory nothing is dropped, whatever presence says.
    let partial = DepartedDevices {
        inner: Arc::new(Listed {
            presence: vec![],
            complete: false,
        }),
        index: Arc::clone(&index),
    };
    assert!(partial.presence().await.is_empty());
    assert_eq!(index.device_ids().len(), 3);

    // The directory still names `asleep` (offline): kept; `gone` left.
    let complete = DepartedDevices {
        inner: Arc::new(Listed {
            presence: vec![present("asleep", false)],
            complete: true,
        }),
        index: Arc::clone(&index),
    };
    assert_eq!(complete.presence().await.len(), 1);
    let mut ids = index.device_ids();
    ids.sort();
    assert_eq!(ids, ["asleep", "self-dev"]);
    let navigator = index.navigator(None);
    assert!(navigator
        .devices
        .iter()
        .all(|device| device.device_id != "gone"));
}
