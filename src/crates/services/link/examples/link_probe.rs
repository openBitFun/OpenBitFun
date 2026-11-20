//! Live probe for OpenBitFun Link: runs one device node from a credentials
//! document (as `openbitfun-link-node issue` writes it) and either serves an
//! echo on the OBP port or measures a peer.
//!
//! ```sh
//! cargo run -p openbitfun-link --example link_probe -- <credentials.json> <device-id> serve
//! cargo run -p openbitfun-link --example link_probe -- <credentials.json> <device-id> ping <peer-device-id>
//! cargo run -p openbitfun-link --example link_probe -- <credentials.json> <device-id> soak <peer-device-id> <secs> [flap-secs]
//! cargo run -p openbitfun-link --example link_probe -- <credentials.json> <device-id> fair <peer-device-id> <secs>
//! ```
//!
//! `OPENBITFUN_MESH_DISABLE_P2P=1` forces the relay path; `LINK_PROBE_NO_LISTENER=1`
//! runs without direct listeners. Prints routes and timings, never secrets.

use std::time::{Duration, Instant};

use openbitfun_link::config::DeviceNodeConfig;
use openbitfun_link::{LinkNode, MeshCredentials, NodeOptions, MESH_OBP_PORT_FIRST};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn summary(node: &openbitfun_link::MeshStatus) -> String {
    let peers: Vec<String> = node
        .peers
        .iter()
        .map(|peer| {
            format!(
                "{}@{} {:?} {:?}ms via {:?}",
                peer.hostname,
                peer.virtual_ip,
                peer.route,
                peer.latency_ms.map(|ms| (ms * 10.0).round() / 10.0),
                peer.tunnel
            )
        })
        .collect();
    let relays: Vec<String> = node
        .relay_nodes
        .iter()
        .map(|relay| format!("{} {:?}ms {:?}", relay.name, relay.latency_ms, relay.tunnel))
        .collect();
    format!(
        "self={:?} nat={:?} peers=[{}] relays=[{}]",
        node.virtual_ip,
        node.nat_type,
        peers.join("; "),
        relays.join("; ")
    )
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        return Err(
            "usage: link_probe <credentials.json> <device-id> serve|ping <peer>|idle <secs>".into(),
        );
    }
    let credentials: MeshCredentials =
        serde_json::from_slice(&std::fs::read(&args[0]).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let device = args[1].clone();
    let no_listener = std::env::var("LINK_PROBE_NO_LISTENER").is_ok_and(|value| value == "1");
    let config = DeviceNodeConfig {
        instance_name: format!("probe-{device}"),
        hostname: device.clone(),
        credentials: credentials.clone(),
        listener_port: if no_listener {
            None
        } else {
            Some(openbitfun_link::session::free_listener_port(11010).map_err(|e| e.to_string())?)
        },
        inbound_tcp_ports: (MESH_OBP_PORT_FIRST, openbitfun_link::MESH_OBP_PORT_LAST),
        disable_p2p: std::env::var("OPENBITFUN_MESH_DISABLE_P2P").is_ok_and(|value| value == "1"),
    };
    let started = Instant::now();
    let node = LinkNode::start(NodeOptions {
        config_toml: config.render()?,
        network_name: credentials.network_name.clone(),
        hostname: device.clone(),
        join_token: credentials.join_token.clone(),
        status_interval: Duration::from_secs(2),
    })
    .await?;
    eprintln!("node started in {:?}", started.elapsed());

    match args[2].as_str() {
        "serve" => {
            node.wait_for_address(Duration::from_secs(60)).await?;
            let status_node = std::sync::Arc::clone(&node);
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    eprintln!("{}", summary(&status_node.refresh_status().await));
                }
            });
            loop {
                let mut listener = node
                    .bind(MESH_OBP_PORT_FIRST, Duration::from_secs(60))
                    .await?;
                eprintln!("serving echo on {}", listener.local_addr());
                while let Ok(mut stream) = listener.accept().await {
                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 64 * 1024];
                        while let Ok(read) = stream.read(&mut buf).await {
                            if read == 0 || stream.write_all(&buf[..read]).await.is_err() {
                                break;
                            }
                        }
                    });
                }
                eprintln!("listener closed; binding again");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
        "ping" => {
            let peer = args.get(3).ok_or("ping needs a peer device id")?;
            let deadline = Instant::now() + Duration::from_secs(90);
            while node.refresh_status().await.peer(peer).is_none() {
                if Instant::now() > deadline {
                    return Err(format!(
                        "{peer} never appeared: {}",
                        summary(&node.status())
                    ));
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            eprintln!("peer visible after {:?}", started.elapsed());
            for round in 0..4 {
                let status = node.refresh_status().await;
                eprintln!("round {round}: {}", summary(&status));
                let connect_started = Instant::now();
                let mut stream = node
                    .connect(peer, MESH_OBP_PORT_FIRST, Duration::from_secs(20))
                    .await?;
                let connect = connect_started.elapsed();
                let mut rtts = Vec::new();
                let mut buf = [0u8; 64];
                for _ in 0..20 {
                    let at = Instant::now();
                    stream
                        .write_all(&[7u8; 64])
                        .await
                        .map_err(|e| e.to_string())?;
                    stream
                        .read_exact(&mut buf)
                        .await
                        .map_err(|e| e.to_string())?;
                    rtts.push(at.elapsed().as_secs_f64() * 1000.0);
                }
                rtts.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let payload = vec![9u8; 1 << 20];
                let at = Instant::now();
                let mut echoed = vec![0u8; payload.len()];
                let (written, read) = {
                    let (mut reader, mut writer_half) = tokio::io::split(&mut stream);
                    let write = async { writer_half.write_all(&payload).await };
                    let read = async { reader.read_exact(&mut echoed).await };
                    tokio::join!(write, read)
                };
                written.map_err(|e| e.to_string())?;
                read.map_err(|e| e.to_string())?;
                let elapsed = at.elapsed().as_secs_f64();
                eprintln!(
                    "round {round}: connect={:.1}ms rtt_p50={:.1}ms rtt_min={:.1}ms rtt_max={:.1}ms echo_1MiB={:.0}ms ({:.2} MiB/s each way)",
                    connect.as_secs_f64() * 1000.0,
                    rtts[rtts.len() / 2],
                    rtts[0],
                    rtts[rtts.len() - 1],
                    elapsed * 1000.0,
                    1.0 / elapsed
                );
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
            node.stop().await;
            Ok(())
        }
        "soak" => {
            // soak <peer> <secs> [flap_secs]: one stream, 1 KiB echoes every
            // 20 ms with every byte checked; prints route changes; with
            // `flap_secs`, closes the direct paths to the peer that often
            // (forcing direct -> relay; P2P comes back on its own).
            let peer = args.get(3).ok_or("soak needs a peer device id")?.clone();
            let seconds: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(60);
            let flap: Option<u64> = args.get(5).and_then(|s| s.parse().ok());
            let deadline = Instant::now() + Duration::from_secs(90);
            while node.refresh_status().await.peer(&peer).is_none() {
                if Instant::now() > deadline {
                    return Err(format!("{peer} never appeared"));
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            let mut stream = node
                .connect(&peer, MESH_OBP_PORT_FIRST, Duration::from_secs(20))
                .await?;
            let soak_started = Instant::now();
            let end = soak_started + Duration::from_secs(seconds);
            let mut next_flap = flap.map(|secs| soak_started + Duration::from_secs(secs));
            let mut last_route = None;
            let mut switches = 0u32;
            let mut flaps = 0u32;
            let mut worst = 0f64;
            let mut count = 0u64;
            let mut frame = vec![0u8; 1024];
            let mut echoed = vec![0u8; 1024];
            while Instant::now() < end {
                let route = node.status().peer(&peer).and_then(|p| p.route);
                if route != last_route {
                    eprintln!(
                        "t={:.1}s route {:?} -> {:?}",
                        soak_started.elapsed().as_secs_f64(),
                        last_route,
                        route
                    );
                    if last_route.is_some() {
                        switches += 1;
                    }
                    last_route = route;
                }
                if next_flap.is_some_and(|at| Instant::now() >= at) {
                    let closed = node.close_direct_paths(&peer).await;
                    if closed > 0 {
                        flaps += 1;
                        eprintln!(
                            "t={:.1}s closed {closed} direct path(s)",
                            soak_started.elapsed().as_secs_f64()
                        );
                    }
                    next_flap = flap.map(|secs| Instant::now() + Duration::from_secs(secs));
                }
                for (index, byte) in frame.iter_mut().enumerate() {
                    *byte = (count as usize).wrapping_mul(31).wrapping_add(index) as u8;
                }
                let at = Instant::now();
                stream
                    .write_all(&frame)
                    .await
                    .map_err(|e| format!("DROP: write after {count} echoes: {e}"))?;
                stream
                    .read_exact(&mut echoed)
                    .await
                    .map_err(|e| format!("DROP: read after {count} echoes: {e}"))?;
                if echoed != frame {
                    return Err(format!("DROP: echo #{count} corrupted"));
                }
                let rtt = at.elapsed().as_secs_f64() * 1000.0;
                if rtt > 1500.0 {
                    eprintln!(
                        "t={:.1}s slow echo #{count}: {rtt:.0}ms",
                        soak_started.elapsed().as_secs_f64()
                    );
                }
                worst = worst.max(rtt);
                count += 1;
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            eprintln!(
                "soak ok: {count} echoes, worst rtt {worst:.1}ms, route switches {switches}, forced flaps {flaps}, final route {last_route:?}"
            );
            node.stop().await;
            Ok(())
        }
        "fair" => {
            // fair <peer> <secs>: control-message round trips (1 KiB every
            // 200 ms on their own stream) while another stream moves bulk
            // data both ways, compared with the same probe on an idle path.
            let peer = args.get(3).ok_or("fair needs a peer device id")?.clone();
            let seconds: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(30);
            let deadline = Instant::now() + Duration::from_secs(90);
            while node.refresh_status().await.peer(&peer).is_none() {
                if Instant::now() > deadline {
                    return Err(format!("{peer} never appeared"));
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            let route = node.status().peer(&peer).and_then(|p| p.route);
            async fn control_rtts(
                stream: &mut openbitfun_link::LinkStream,
                seconds: u64,
            ) -> Result<Vec<f64>, String> {
                let mut rtts = Vec::new();
                let end = Instant::now() + Duration::from_secs(seconds);
                let mut buf = vec![0u8; 1024];
                while Instant::now() < end {
                    let at = Instant::now();
                    stream
                        .write_all(&[5u8; 1024])
                        .await
                        .map_err(|e| e.to_string())?;
                    stream
                        .read_exact(&mut buf)
                        .await
                        .map_err(|e| e.to_string())?;
                    rtts.push(at.elapsed().as_secs_f64() * 1000.0);
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                rtts.sort_by(|a, b| a.partial_cmp(b).unwrap());
                Ok(rtts)
            }
            fn describe(rtts: &[f64]) -> String {
                if rtts.is_empty() {
                    return "no samples".into();
                }
                let at = |q: f64| rtts[((rtts.len() - 1) as f64 * q) as usize];
                format!(
                    "n={} p50={:.0}ms p95={:.0}ms max={:.0}ms",
                    rtts.len(),
                    at(0.5),
                    at(0.95),
                    rtts[rtts.len() - 1]
                )
            }
            let mut control = node
                .connect(&peer, MESH_OBP_PORT_FIRST, Duration::from_secs(20))
                .await?;
            let idle = control_rtts(&mut control, seconds / 2).await?;
            eprintln!("route {route:?}; idle control: {}", describe(&idle));
            let bulk = node
                .connect(&peer, MESH_OBP_PORT_FIRST, Duration::from_secs(20))
                .await?;
            let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let moved = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let (mut reader, mut writer) = tokio::io::split(bulk);
            let (stop_w, stop_r) = (stop.clone(), stop.clone());
            let moved_r = moved.clone();
            let writer_task = tokio::spawn(async move {
                let chunk = vec![7u8; 64 * 1024];
                while !stop_w.load(std::sync::atomic::Ordering::Acquire) {
                    if writer.write_all(&chunk).await.is_err() {
                        break;
                    }
                }
            });
            let reader_task = tokio::spawn(async move {
                let mut buf = vec![0u8; 64 * 1024];
                while !stop_r.load(std::sync::atomic::Ordering::Acquire) {
                    match reader.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(read) => {
                            moved_r.fetch_add(read as u64, std::sync::atomic::Ordering::AcqRel);
                        }
                    }
                }
            });
            tokio::time::sleep(Duration::from_secs(3)).await;
            let started = Instant::now();
            let before = moved.load(std::sync::atomic::Ordering::Acquire);
            let loaded = control_rtts(&mut control, seconds / 2).await?;
            let rate = (moved.load(std::sync::atomic::Ordering::Acquire) - before) as f64
                / started.elapsed().as_secs_f64()
                / (1024.0 * 1024.0);
            stop.store(true, std::sync::atomic::Ordering::Release);
            writer_task.abort();
            reader_task.abort();
            eprintln!(
                "route {:?}; control under bulk ({rate:.2} MiB/s echoed): {}",
                node.status().peer(&peer).and_then(|p| p.route),
                describe(&loaded)
            );
            node.stop().await;
            Ok(())
        }
        "idle" => {
            let seconds: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(60);
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            eprintln!("{}", summary(&node.refresh_status().await));
            node.stop().await;
            Ok(())
        }
        other => Err(format!("unknown mode {other}")),
    }
}
