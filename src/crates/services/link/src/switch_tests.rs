//! Streams survive route switches: relay -> direct -> relay, repeatedly,
//! while an echo stream keeps traffic flowing both ways.
//!
//! The switch is forced deterministically: both devices run with automatic
//! P2P off, and the test adds a direct (manual) connection and then closes
//! it, so the route flips between `relayed_server` and `direct_lan` exactly
//! when the test says.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::config::{DeviceNodeConfig, RelayNodeConfig};
use crate::node::{LinkNode, NodeOptions};
use crate::status::MeshRoute;
use crate::{MeshCredentials, MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};

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

async fn device(
    network: &str,
    secret: &str,
    relay_url: &str,
    name: &str,
    listener_port: Option<u16>,
) -> Arc<LinkNode> {
    let config = DeviceNodeConfig {
        instance_name: format!("switch-{name}"),
        hostname: name.to_string(),
        credentials: MeshCredentials {
            version: 1,
            network_name: network.to_string(),
            network_secret: secret.to_string(),
            peers: vec![relay_url.to_string()],
            easytier_version: None,
            issued_at: None,
            join_token: None,
            join_token_expires_at: None,
        },
        listener_port,
        inbound_tcp_ports: (MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST),
        // No automatic direct connections: the test switches the route.
        disable_p2p: true,
    };
    LinkNode::start(NodeOptions {
        config_toml: config.render().unwrap(),
        network_name: network.to_string(),
        hostname: name.to_string(),
        join_token: None,
        status_interval: Duration::from_millis(200),
    })
    .await
    .unwrap()
}

async fn wait_route(node: &LinkNode, peer: &str, want: MeshRoute, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        let status = node.refresh_status().await;
        if status.peer(peer).and_then(|peer| peer.route) == Some(want)
            && status.virtual_ip.is_some()
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

struct Pump {
    echoes: Arc<AtomicU64>,
    worst_gap_ms: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<Result<(), String>>,
}

/// Writes numbered 1 KiB frames and checks every echoed byte; records the
/// longest time between two echoes.
fn pump(mut stream: crate::LinkStream) -> Pump {
    let echoes = Arc::new(AtomicU64::new(0));
    let worst_gap_ms = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let (count, worst, stopped) = (echoes.clone(), worst_gap_ms.clone(), stop.clone());
    let task = tokio::spawn(async move {
        let mut frame = vec![0u8; 1024];
        let mut echoed = vec![0u8; 1024];
        let mut last = Instant::now();
        let mut seq = 0u64;
        while !stopped.load(Ordering::Acquire) {
            seq += 1;
            for (index, byte) in frame.iter_mut().enumerate() {
                *byte = (seq as usize).wrapping_mul(31).wrapping_add(index) as u8;
            }
            stream
                .write_all(&frame)
                .await
                .map_err(|e| format!("write #{seq}: {e}"))?;
            stream
                .read_exact(&mut echoed)
                .await
                .map_err(|e| format!("read #{seq}: {e}"))?;
            if echoed != frame {
                return Err(format!("frame #{seq} came back corrupted"));
            }
            let gap = last.elapsed().as_millis() as u64;
            worst.fetch_max(gap, Ordering::AcqRel);
            last = Instant::now();
            count.fetch_add(1, Ordering::AcqRel);
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        Ok(())
    });
    Pump {
        echoes,
        worst_gap_ms,
        stop,
        task,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn streams_survive_relay_direct_switches_both_ways() {
    let relay_port = free_port();
    let relay_url = format!("ws://127.0.0.1:{relay_port}/");
    let relay = crate::relay::start_relay(&RelayNodeConfig {
        hostname: "switch-relay".into(),
        listeners: vec![relay_url.clone()],
        network_name: format!("relay-{}", random_hex(8)),
        network_secret: random_hex(32),
        foreign_relay_bps_limit: 64 << 20,
    })
    .await
    .unwrap();
    let network = format!("obf-{}", random_hex(24));
    let secret = random_hex(32);
    let server_port = free_port();
    let server = device(
        &network,
        &secret,
        &relay_url,
        "sw-server",
        Some(server_port),
    )
    .await;
    let client = device(&network, &secret, &relay_url, "sw-client", None).await;
    assert!(
        wait_route(
            &client,
            "sw-server",
            MeshRoute::RelayedServer,
            Duration::from_secs(40)
        )
        .await,
        "{:?}",
        client.status()
    );

    let mut listener = server
        .bind(MESH_OBP_PORT_FIRST, Duration::from_secs(10))
        .await
        .unwrap();
    let echo = tokio::spawn(async move {
        let mut stream = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if stream.write_all(&buf[..read]).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
    let stream = client
        .connect("sw-server", MESH_OBP_PORT_FIRST, Duration::from_secs(15))
        .await
        .unwrap();
    let pump = pump(stream);
    tokio::time::sleep(Duration::from_secs(1)).await;

    for (round, scheme) in ["tcp", "udp", "tcp", "udp"].into_iter().enumerate() {
        let url = format!("{scheme}://127.0.0.1:{server_port}");
        eprintln!(
            "round {round} {scheme}: before direct, echoes={}",
            pump.echoes.load(Ordering::Acquire)
        );
        client.add_direct_peer(&url);
        assert!(
            wait_route(
                &client,
                "sw-server",
                MeshRoute::DirectLan,
                Duration::from_secs(20)
            )
            .await,
            "round {round}: never went direct over {scheme}: {:?}",
            client.status()
        );
        tokio::time::sleep(Duration::from_millis(1500)).await;
        eprintln!(
            "round {round} {scheme}: direct, echoes={}",
            pump.echoes.load(Ordering::Acquire)
        );
        let closed = client.drop_direct_peer(&url, "sw-server").await;
        assert!(closed > 0, "round {round}: no direct connection to close");
        assert!(
            wait_route(
                &client,
                "sw-server",
                MeshRoute::RelayedServer,
                Duration::from_secs(20)
            )
            .await,
            "round {round}: never fell back to the relay: {:?}",
            client.status()
        );
        tokio::time::sleep(Duration::from_millis(1500)).await;
        eprintln!(
            "round {round} {scheme}: relayed again, echoes={}",
            pump.echoes.load(Ordering::Acquire)
        );
        assert!(
            !pump.task.is_finished(),
            "round {round}: the stream died at a {scheme} switch"
        );
    }

    pump.stop.store(true, Ordering::Release);
    let result = tokio::time::timeout(Duration::from_secs(20), pump.task)
        .await
        .expect("pump finished")
        .expect("pump task");
    let echoes = pump.echoes.load(Ordering::Acquire);
    let worst = pump.worst_gap_ms.load(Ordering::Acquire);
    eprintln!("switches: 8, echoes: {echoes}, worst gap: {worst} ms");
    result.unwrap();
    assert!(echoes > 100, "too few echoes: {echoes}");
    assert!(worst < 2500, "a switch stalled the stream for {worst} ms");
    echo.abort();
    for node in [client, server, relay] {
        node.stop().await;
    }
}
