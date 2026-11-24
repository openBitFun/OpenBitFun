use anyhow::{ensure, Context, Result};
use openbitfun_agent::{
    AIConfig, CancellationToken, LocalAgent, PermissionReply, PermissionRequestEvent,
};
use std::{io::Read, path::Path};
use tokio::time::{timeout, Duration};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let request: serde_json::Value = if let Some(action) = std::env::args().nth(1) {
        ensure!(matches!(action.as_str(), "resume" | "conflict"));
        let url = std::env::var("OPENBITFUN_SDK_SMOKE_BASE_URL")?;
        serde_json::json!({
            "model": {
                "name": "fixture-model",
                "model": "fixture-model",
                "base_url": url,
                "request_url": format!("{url}/chat/completions"),
                "api_key": input.trim_end(),
                "format": "openai",
                "context_window": 65536,
                "inline_think_in_text": false,
                "skip_ssl_verify": false
            },
            "workspace": std::env::var("OPENBITFUN_SDK_SMOKE_WORKSPACE")?,
            "data": std::env::var("OPENBITFUN_E2E_HOME")?,
            "restore": std::env::args().nth(2).context("missing session ID")?,
            "mode": action,
            "expected_call": "call_embedded_read",
            "expected_answer": "OpenBitFun SDK session resumed"
        })
    } else {
        serde_json::from_str(&input)?
    };
    let field = |key: &str| {
        request[key]
            .as_str()
            .with_context(|| format!("missing {key}"))
    };
    let model: AIConfig = serde_json::from_value(request["model"].clone())?;
    let agent = LocalAgent::open(
        Path::new(field("workspace")?),
        Path::new(field("data")?),
        model,
    )?;
    if field("mode")? == "conflict" {
        let result = agent.restore_session(field("restore")?).await;
        ensure!(
            matches!(
                result
                    .err()
                    .as_ref()
                    .and_then(|e| e.downcast_ref::<openbitfun_agent::SessionWriteLockError>()),
                Some(openbitfun_agent::SessionWriteLockError::InUse)
            ),
            "expected a writer conflict"
        );
        return Ok(());
    }
    let expected_call = request["expected_call"].as_str().unwrap_or("export-read");
    let session = match request["restore"].as_str() {
        Some(id) => agent.restore_session(id).await?,
        None => agent.create_session("export smoke").await?,
    };
    let mode = field("mode")?;
    let cancel = CancellationToken::new();
    let mut permissions = agent.subscribe_permissions();
    let mut events = session.subscribe_events();
    let run = session.run(mode, cancel.clone());
    tokio::pin!(run);
    let mut asked = 0;
    let answer = timeout(Duration::from_secs(25), async {
        loop {
            tokio::select! {
                result = &mut run => break result,
                event = permissions.recv() => {
                    if let PermissionRequestEvent::Asked { request } = event? {
                        ensure!(
                            request.session_id == session.id() && request.tool_call_id.as_deref() == Some(expected_call),
                            "incorrect approval correlation"
                        );
                        asked += 1;
                        if mode == "cancel" {
                            cancel.cancel();
                        } else {
                            let reply = if mode == "reject" {
                                PermissionReply::Reject { feedback: None }
                            } else {
                                PermissionReply::Once
                            };
                            agent.reply(&request.request_id, reply).await?;
                        }
                    }
                }
            }
        }
    }).await?;
    let text = if mode == "cancel" {
        ensure!(answer.unwrap_err().to_string().contains("cancelled"));
        String::new()
    } else {
        answer?
    };
    timeout(Duration::from_secs(2), events.recv()).await??;
    if let Some(answer) = request["expected_answer"].as_str() {
        ensure!(asked == 1 && text == answer);
    }
    println!(
        "{}",
        serde_json::json!({"session":session.id(),"answer":text,"asked":asked})
    );
    Ok(())
}
