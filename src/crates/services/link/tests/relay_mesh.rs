//! Two in-process Link nodes over an in-process relay node (loopback
//! WebSocket, the production transport), with the join gate installed.
//!
//! The fork's admission gate and join-token registry are process-wide, so
//! the scenarios share one test function and run in order.

use std::sync::Arc;
use std::time::{Duration, Instant};

use openbitfun_link::config::{DeviceNodeConfig, RelayNodeConfig};
use openbitfun_link::{LinkNode, MeshCredentials, MeshRoute, NodeOptions, NodeProfile, NodeRole};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn random_hex(len: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| format!("{:x}", rng.gen_range(0..16u8)))
        .collect()
}

fn good_token(network: &str, device: &str) -> String {
    format!("test-token.{network}.{device}")
}

async fn start_device(
    network: &str,
    secret: &str,
    relay_url: &str,
    device: &str,
    token: Option<String>,
    listener_port: Option<u16>,
    disable_p2p: bool,
) -> Arc<LinkNode> {
    start_member(
        network,
        secret,
        relay_url,
        device,
        token,
        listener_port,
        disable_p2p,
        NodeRole::Device,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn start_member(
    network: &str,
    secret: &str,
    relay_url: &str,
    device: &str,
    token: Option<String>,
    listener_port: Option<u16>,
    disable_p2p: bool,
    role: NodeRole,
) -> Arc<LinkNode> {
    let credentials = MeshCredentials {
        version: 1,
        network_name: network.to_string(),
        network_secret: secret.to_string(),
        peers: vec![relay_url.to_string()],
        easytier_version: None,
        issued_at: None,
        join_token: token.clone(),
        join_token_expires_at: None,
    };
    let config = DeviceNodeConfig {
        instance_name: format!("test-{device}"),
        hostname: device.to_string(),
        credentials,
        listener_port,
        inbound_tcp_ports: (
            openbitfun_link::MESH_OBP_PORT_FIRST,
            openbitfun_link::MESH_OBP_PORT_LAST,
        ),
        disable_p2p,
    };
    LinkNode::start_with(
        NodeOptions {
            config_toml: config.render_as(role).unwrap(),
            network_name: network.to_string(),
            hostname: device.to_string(),
            join_token: token,
            status_interval: Duration::from_millis(500),
        },
        NodeProfile {
            role,
            display_name: role.is_controller().then(|| format!("{device} (test)")),
        },
    )
    .await
    .unwrap()
}

async fn wait_for_peer(node: &LinkNode, device: &str, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        let status = node.refresh_status().await;
        if status
            .peer(device)
            .is_some_and(|peer| !peer.virtual_ip.is_empty())
            && status.virtual_ip.is_some()
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    false
}

async fn echo_round_trip(from: &LinkNode, to: &LinkNode, to_device: &str) -> Duration {
    let mut listener = to
        .bind(
            openbitfun_link::MESH_OBP_PORT_FIRST,
            Duration::from_secs(10),
        )
        .await
        .unwrap();
    let server = tokio::spawn(async move {
        let mut stream = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let read = stream.read(&mut buf).await.unwrap();
            if read == 0 {
                break;
            }
            stream.write_all(&buf[..read]).await.unwrap();
        }
    });
    let mut stream = from
        .connect(
            to_device,
            openbitfun_link::MESH_OBP_PORT_FIRST,
            Duration::from_secs(15),
        )
        .await
        .unwrap();
    assert_eq!(stream.peer_device(), Some(to_device));
    let payload: Vec<u8> = (0..200_000u32).map(|value| (value % 251) as u8).collect();
    let started = Instant::now();
    stream.write_all(&payload).await.unwrap();
    let mut echoed = vec![0u8; payload.len()];
    stream.read_exact(&mut echoed).await.unwrap();
    let elapsed = started.elapsed();
    assert_eq!(echoed, payload);
    stream.shutdown().await.unwrap();
    drop(stream);
    let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    elapsed
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn devices_meet_through_a_gated_relay_and_exchange_streams() {
    // Gate: only `test-token.<network>.<device>` joins `<network>`.
    openbitfun_link::relay::install_join_gate(Arc::new(|network: &str, token: &str| {
        let rest = token
            .strip_prefix("test-token.")
            .ok_or_else(|| "not a test token".to_string())?;
        let (token_network, device) = rest
            .rsplit_once('.')
            .ok_or_else(|| "malformed".to_string())?;
        if token_network != network {
            return Err("token for another network".into());
        }
        Ok(device.to_string())
    }));

    let relay_port = free_port();
    let relay_url = format!("ws://127.0.0.1:{relay_port}/");
    let relay = openbitfun_link::relay::start_relay(&RelayNodeConfig {
        hostname: "test-relay".into(),
        listeners: vec![relay_url.clone()],
        network_name: format!("relay-{}", random_hex(8)),
        network_secret: random_hex(32),
        foreign_relay_bps_limit: 64 << 20,
    })
    .await
    .unwrap();

    let network = format!("obf-{}", random_hex(24));
    let secret = random_hex(32);

    // 1. Relay path: no listeners, P2P off.
    let a = start_device(
        &network,
        &secret,
        &relay_url,
        "dev-a",
        Some(good_token(&network, "dev-a")),
        None,
        true,
    )
    .await;
    let b = start_device(
        &network,
        &secret,
        &relay_url,
        "dev-b",
        Some(good_token(&network, "dev-b")),
        None,
        true,
    )
    .await;
    assert!(
        wait_for_peer(&a, "dev-b", Duration::from_secs(40)).await,
        "dev-a never saw dev-b through the relay: {:?}",
        a.status()
    );
    let status = a.refresh_status().await;
    let peer = status.peer("dev-b").unwrap();
    assert_eq!(peer.route, Some(MeshRoute::RelayedServer), "{status:?}");
    assert_eq!(status.relay_nodes.len(), 1, "{status:?}");
    let relayed = echo_round_trip(&a, &b, "dev-b").await;
    eprintln!("relayed 200 KB echo: {relayed:?}");

    // 1b. The server-side gateway joins the account network as its own
    // member and opens a stream to a device (the browser path).
    struct Networks {
        network: String,
        secret: String,
        relay_url: String,
    }
    impl openbitfun_link::gateway::GatewayNetworks for Networks {
        fn member(&self, account_id: &str, member_id: &str) -> Result<MeshCredentials, String> {
            if account_id != "acct-1" {
                return Err("unknown account".into());
            }
            Ok(MeshCredentials {
                version: 1,
                network_name: self.network.clone(),
                network_secret: self.secret.clone(),
                peers: vec![self.relay_url.clone()],
                easytier_version: None,
                issued_at: None,
                join_token: Some(good_token(&self.network, member_id)),
                join_token_expires_at: None,
            })
        }
    }
    let gateway = openbitfun_link::gateway::LinkGateway::new(
        Arc::new(Networks {
            network: network.clone(),
            secret: secret.clone(),
            relay_url: relay_url.clone(),
        }),
        "gateway-test",
        openbitfun_link::gateway::GatewayLimits {
            max_streams_per_account: 1,
            ..Default::default()
        },
    )
    .unwrap();
    let mut listener = b
        .bind(
            openbitfun_link::MESH_OBP_PORT_FIRST,
            Duration::from_secs(10),
        )
        .await
        .unwrap();
    let served = tokio::spawn(async move {
        let mut stream = listener.accept().await.unwrap();
        let mut buf = [0u8; 5];
        stream.read_exact(&mut buf).await.unwrap();
        stream.write_all(&buf).await.unwrap();
        // Keep the stream until the gateway closes it.
        let _ = stream.read(&mut buf).await;
    });
    let mut via_gateway = gateway.open("acct-1", "dev-b", None).await.unwrap();
    via_gateway.write_all(b"hello").await.unwrap();
    let mut echoed = [0u8; 5];
    via_gateway.read_exact(&mut echoed).await.unwrap();
    assert_eq!(&echoed, b"hello");
    // Per-account stream cap, and accounts the provider refuses.
    assert!(matches!(
        gateway.open("acct-1", "dev-b", None).await,
        Err(openbitfun_link::gateway::GatewayError::Busy(_))
    ));
    assert!(matches!(
        gateway.open("acct-2", "dev-b", None).await,
        Err(openbitfun_link::gateway::GatewayError::Unavailable(_))
    ));
    // The gateway lists the account's online members cheaply.
    let online = gateway.peers("acct-1").await.unwrap();
    let dev_b = online.iter().find(|peer| peer.hostname == "dev-b").unwrap();
    assert_eq!(dev_b.route, Some(MeshRoute::RelayedServer));
    assert_eq!(dev_b.role, NodeRole::Device);
    assert!(online.iter().all(|peer| peer.hostname != "gateway-test"));
    assert!(matches!(
        gateway.peers("acct-2").await,
        Err(openbitfun_link::gateway::GatewayError::Unavailable(_))
    ));
    // Devices list the gateway member as a controller.
    let b_status = b.refresh_status().await;
    assert_eq!(
        b_status.peer("gateway-test").map(|peer| peer.role),
        Some(NodeRole::Controller),
        "{b_status:?}"
    );
    drop(via_gateway);
    let _ = tokio::time::timeout(Duration::from_secs(5), served).await;
    assert_eq!(gateway.joined_accounts().await, 1);
    gateway.shutdown().await;

    // 1c. A controller-only member (the phone app): devices list it as a
    // controller and refuse to open streams to it; it opens streams to
    // devices; it forwards nothing for others.
    let phone = start_member(
        &network,
        &secret,
        &relay_url,
        "phone-1",
        Some(good_token(&network, "phone-1")),
        None,
        true,
        NodeRole::Controller,
    )
    .await;
    assert_eq!(phone.role(), NodeRole::Controller);
    assert!(wait_for_peer(&a, "phone-1", Duration::from_secs(40)).await);
    let a_status = a.refresh_status().await;
    assert_eq!(a_status.role, NodeRole::Device);
    assert_eq!(
        a_status.peer("phone-1").map(|peer| peer.role),
        Some(NodeRole::Controller),
        "{a_status:?}"
    );
    assert_eq!(
        a_status.peer("dev-b").map(|peer| peer.role),
        Some(NodeRole::Device)
    );
    // The controller's advertised name reaches the devices.
    assert_eq!(
        a_status
            .peer("phone-1")
            .and_then(|peer| peer.display_name.as_deref()),
        Some("phone-1 (test)")
    );
    assert_eq!(
        a_status
            .peer("dev-b")
            .and_then(|peer| peer.display_name.as_deref()),
        None
    );
    assert!(a_status.devices().all(|peer| peer.hostname != "phone-1"));
    let refused = a
        .connect(
            "phone-1",
            openbitfun_link::MESH_OBP_PORT_FIRST,
            Duration::from_secs(5),
        )
        .await;
    assert!(
        matches!(&refused, Err(error) if error.starts_with("mesh_controller:")),
        "{:?}",
        refused.err()
    );
    assert!(wait_for_peer(&phone, "dev-b", Duration::from_secs(40)).await);
    assert_eq!(phone.refresh_status().await.role, NodeRole::Controller);
    let from_phone = echo_round_trip(&phone, &b, "dev-b").await;
    eprintln!("controller 200 KB echo: {from_phone:?}");
    phone.stop().await;

    // 2. Inbound virtual TCP reaches only the OBP port range: a service on
    // this machine's loopback is not exposed through the node.
    let exposed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let exposed_port = exposed.local_addr().unwrap().port();
    let refused = tokio::time::timeout(
        Duration::from_secs(8),
        a.connect("dev-b", exposed_port, Duration::from_secs(5)),
    )
    .await;
    assert!(
        !matches!(refused, Ok(Ok(_))),
        "a virtual stream reached a loopback port outside the OBP range"
    );

    // 3. Without a token (or with another network's token) the relay
    // refuses the device: it never meets the others.
    let intruder = start_device(&network, &secret, &relay_url, "dev-x", None, None, true).await;
    let forged = start_device(
        &network,
        &secret,
        &relay_url,
        "dev-y",
        Some(good_token("obf-someone-else", "dev-y")),
        None,
        true,
    )
    .await;
    assert!(!wait_for_peer(&intruder, "dev-a", Duration::from_secs(8)).await);
    assert!(!wait_for_peer(&forged, "dev-a", Duration::from_secs(2)).await);
    let a_status = a.refresh_status().await;
    assert!(a_status.peer("dev-x").is_none() && a_status.peer("dev-y").is_none());
    assert!(intruder.refresh_status().await.relay_nodes.is_empty());
    intruder.stop().await;
    forged.stop().await;

    // 4. Direct path: with listeners and P2P on, two devices on one machine
    // connect directly (LAN) after meeting through the relay.
    let c = start_device(
        &network,
        &secret,
        &relay_url,
        "dev-c",
        Some(good_token(&network, "dev-c")),
        Some(free_port()),
        false,
    )
    .await;
    let d = start_device(
        &network,
        &secret,
        &relay_url,
        "dev-d",
        Some(good_token(&network, "dev-d")),
        Some(free_port()),
        false,
    )
    .await;
    assert!(wait_for_peer(&c, "dev-d", Duration::from_secs(40)).await);
    let deadline = Instant::now() + Duration::from_secs(40);
    let mut route = None;
    while Instant::now() < deadline {
        route = c
            .refresh_status()
            .await
            .peer("dev-d")
            .and_then(|peer| peer.route);
        if matches!(route, Some(MeshRoute::DirectLan)) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(route, Some(MeshRoute::DirectLan), "{:?}", c.status());
    let direct = echo_round_trip(&d, &c, "dev-c").await;
    eprintln!("direct 200 KB echo: {direct:?}");

    for node in [a, b, c, d, relay] {
        node.stop().await;
    }
    openbitfun_link::relay::remove_join_gate();
}
