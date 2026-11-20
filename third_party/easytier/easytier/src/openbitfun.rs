//! OpenBitFun Link entry points (fork addition; see ../../OPENBITFUN-PATCH.md).
//!
//! OpenBitFun embeds the native host runtime in its own processes (desktop
//! backend, CLI host, relay node): an instance runs on the caller's Tokio
//! runtime instead of starting its own executor threads, with the full native
//! host configuration (UDP/TCP hole punching, UPnP, WebSocket tunnels).

use std::sync::Arc;

use easytier_core::{config::toml::TomlConfig, process_runtime::CoreProcessRuntime};

pub use easytier_core::openbitfun::{
    ForeignJoinRequest, ForeignNetworkAdmission, MAX_DISPLAY_NAME_LEN, MAX_JOIN_TOKEN_LEN,
    display_name, is_controller, join_token, set_controller, set_display_name,
    set_foreign_network_admission, set_join_token,
};

pub use crate::instance::factory::NativeCoreInstance;

/// Creates (does not start) an instance whose tasks run on the current Tokio
/// runtime. Must be called inside a runtime context.
pub fn create_instance_on_current_runtime(
    config: TomlConfig,
) -> anyhow::Result<Arc<NativeCoreInstance>> {
    tokio::runtime::Handle::try_current()
        .map_err(|_| anyhow::anyhow!("an EasyTier instance needs a Tokio runtime"))?;
    crate::instance::composition::compose_native_core_instance_on_current_runtime(
        config,
        CoreProcessRuntime::new(),
    )
}

/// Public resolvers for `txt:` STUN entries in builds without the
/// `dns-resolver` feature: mainland China first (AliDNS, DNSPod,
/// Volcengine), Cloudflare for everyone else. Queried in parallel; the
/// first answer wins.
const TXT_RESOLVERS: &[&str] = &[
    "223.5.5.5:53",
    "119.29.29.29:53",
    "180.184.1.1:53",
    "1.1.1.1:53",
];
const TXT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Resolves the first character-string of `name`'s TXT record over plain
/// UDP DNS (OpenBitFun: lets `txt:stun.easytier.cn`, EasyTier's mainland
/// STUN list, work without linking a full resolver).
pub async fn resolve_txt_udp(name: &str) -> anyhow::Result<String> {
    let servers = TXT_RESOLVERS
        .iter()
        .map(|server| server.parse())
        .collect::<Result<Vec<std::net::SocketAddr>, _>>()?;
    resolve_txt_udp_via(name, &servers).await
}

/// [`resolve_txt_udp`] through the given resolvers (IPv4).
pub async fn resolve_txt_udp_via(
    name: &str,
    servers: &[std::net::SocketAddr],
) -> anyhow::Result<String> {
    let id: u16 = rand::random();
    let query = build_txt_query(id, name)?;
    let mut lookups = tokio::task::JoinSet::new();
    for server in servers.iter().copied() {
        let query = query.clone();
        lookups.spawn(async move {
            let bind: std::net::SocketAddr = if server.ip().is_loopback() {
                ([127, 0, 0, 1], 0).into()
            } else {
                ([0, 0, 0, 0], 0).into()
            };
            let socket = tokio::net::UdpSocket::bind(bind).await?;
            socket.send_to(&query, server).await?;
            let mut buf = vec![0u8; 1500];
            loop {
                let (len, from) = socket.recv_from(&mut buf).await?;
                if from == server {
                    return parse_txt_answer(id, &buf[..len]);
                }
            }
        });
    }
    let result = tokio::time::timeout(TXT_TIMEOUT, async {
        let mut last = anyhow::anyhow!("no resolver answered");
        while let Some(joined) = lookups.join_next().await {
            match joined {
                Ok(Ok(text)) => return Ok(text),
                Ok(Err(error)) => last = error,
                Err(error) => last = error.into(),
            }
        }
        Err(last)
    })
    .await
    .map_err(|_| anyhow::anyhow!("TXT lookup of {name} timed out"))?;
    lookups.abort_all();
    result
}

fn build_txt_query(id: u16, name: &str) -> anyhow::Result<Vec<u8>> {
    let mut query = Vec::with_capacity(32 + name.len());
    query.extend_from_slice(&id.to_be_bytes());
    // Recursion desired; one question.
    query.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
    for label in name.trim_end_matches('.').split('.') {
        anyhow::ensure!(
            !label.is_empty() && label.len() < 64,
            "invalid DNS name: {name}"
        );
        query.push(label.len() as u8);
        query.extend_from_slice(label.as_bytes());
    }
    query.push(0);
    // QTYPE TXT, QCLASS IN.
    query.extend_from_slice(&[0, 16, 0, 1]);
    Ok(query)
}

fn skip_name(packet: &[u8], mut at: usize) -> anyhow::Result<usize> {
    loop {
        let len = *packet
            .get(at)
            .ok_or_else(|| anyhow::anyhow!("truncated name"))?;
        match len {
            0 => return Ok(at + 1),
            // A compression pointer ends the name.
            len if len & 0xc0 == 0xc0 => return Ok(at + 2),
            len => at += 1 + usize::from(len),
        }
    }
}

fn parse_txt_answer(id: u16, packet: &[u8]) -> anyhow::Result<String> {
    anyhow::ensure!(packet.len() >= 12, "short DNS answer");
    anyhow::ensure!(packet[0..2] == id.to_be_bytes(), "DNS answer id mismatch");
    anyhow::ensure!(packet[3] & 0x0f == 0, "DNS error code {}", packet[3] & 0x0f);
    let questions = u16::from_be_bytes([packet[4], packet[5]]);
    let answers = u16::from_be_bytes([packet[6], packet[7]]);
    let mut at = 12;
    for _ in 0..questions {
        at = skip_name(packet, at)? + 4;
    }
    for _ in 0..answers {
        at = skip_name(packet, at)?;
        let header = packet
            .get(at..at + 10)
            .ok_or_else(|| anyhow::anyhow!("truncated DNS record"))?;
        let kind = u16::from_be_bytes([header[0], header[1]]);
        let rdlen = usize::from(u16::from_be_bytes([header[8], header[9]]));
        at += 10;
        let data = packet
            .get(at..at + rdlen)
            .ok_or_else(|| anyhow::anyhow!("truncated DNS record data"))?;
        at += rdlen;
        if kind == 16 {
            let len = usize::from(*data.first().ok_or_else(|| anyhow::anyhow!("empty TXT"))?);
            let text = data
                .get(1..1 + len)
                .ok_or_else(|| anyhow::anyhow!("truncated TXT string"))?;
            return Ok(String::from_utf8_lossy(text).into_owned());
        }
    }
    anyhow::bail!("no TXT record in the answer")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_txt_query_and_parses_a_compressed_answer() {
        let query = build_txt_query(0x1234, "stun.easytier.cn").unwrap();
        assert_eq!(&query[..2], &[0x12, 0x34]);
        assert_eq!(&query[12..17], b"\x04stun");
        assert_eq!(&query[query.len() - 4..], &[0, 16, 0, 1]);
        assert!(build_txt_query(1, "a..b").is_err());

        let text = b"stun.example:3478 1.2.3.4:5";
        let mut answer = query.clone();
        answer[2] = 0x81;
        answer[3] = 0x80;
        answer[7] = 1;
        // Name pointer to the question, TYPE TXT, CLASS IN, TTL, RDLENGTH.
        answer.extend_from_slice(&[0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60]);
        answer.extend_from_slice(&((text.len() + 1) as u16).to_be_bytes());
        answer.push(text.len() as u8);
        answer.extend_from_slice(text);
        assert_eq!(
            parse_txt_answer(0x1234, &answer).unwrap(),
            "stun.example:3478 1.2.3.4:5"
        );
        assert!(parse_txt_answer(0x9999, &answer).is_err());
        let mut failed = answer.clone();
        failed[3] = 0x83;
        assert!(parse_txt_answer(0x1234, &failed).is_err());
        assert!(parse_txt_answer(0x1234, &answer[..answer.len() - 3]).is_err());
    }

    /// Live: `cargo test -p easytier --lib openbitfun -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn resolves_the_easytier_stun_list_live() {
        let text = resolve_txt_udp("stun.easytier.cn").await.unwrap();
        eprintln!("stun.easytier.cn TXT: {text}");
        assert!(!text.trim().is_empty());
    }
}
