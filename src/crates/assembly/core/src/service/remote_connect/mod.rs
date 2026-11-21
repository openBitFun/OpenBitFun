//! Remote Connect service module.
//!
//! OpenBitFun 2.0: the account runtime (sign-in and the device directory), IM
//! bots (Telegram / Feishu / Weixin) and the `RemoteCommand` dispatcher that
//! bots and OBP `obp_remote_command` share. Devices reach each other only over
//! OBP on OpenBitFun Link (`mesh_route`); the 1.x relay transport (Socket.IO
//! rooms, relay RPC, HostInvoke, pairing invitations, the LAN relay and host
//! streams) is not part of 2.0.

/// Account records (agents, skills, routines, MCP shapes, personas, memory,
/// quick actions, bot metadata) on the account replica.
pub mod account_records;
pub mod account_runtime;
pub mod bot;
pub mod control;
pub mod remote_server;
/// Account settings sync (Preferences and permission configuration).
pub mod settings_sync;

pub mod device {
    pub use openbitfun_services_integrations::remote_connect::device::*;
}

pub mod encryption {
    pub use openbitfun_services_integrations::remote_connect::encryption::*;
}

pub mod pairing {
    pub use openbitfun_services_integrations::remote_connect::pairing::*;
}

pub mod qr_generator {
    pub use openbitfun_services_integrations::remote_connect::qr_generator::*;
}

pub mod account {
    pub use openbitfun_services_integrations::remote_connect::account::*;
}

pub mod routing_lease {
    pub use openbitfun_services_integrations::remote_connect::routing_lease::*;
}

/// The account-device transport port (OBP over OpenBitFun Link) for hosts that
/// serve or dial same-account devices.
pub mod mesh_route {
    pub use openbitfun_services_integrations::remote_connect::mesh_route::*;
}

/// The OpenBitFun identity session (access tokens for the Link issuer).
pub mod account_identity {
    pub use openbitfun_services_integrations::account_identity::*;
}

pub mod session_records {
    pub use openbitfun_services_integrations::remote_connect::session_records::*;
}

pub mod session_store {
    pub use openbitfun_services_integrations::remote_connect::session_store::*;
}

pub use account::{validate_relay_base_url, AccountClient, AccountSession, DelegateToken};
pub use device::DeviceIdentity;
pub use pairing::PairingState;
pub use qr_generator::QrGenerator;

/// Installs the process-wide rustls crypto provider (TLS for HTTPS clients).
pub fn ensure_rustls_crypto_provider() {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
}
pub use remote_server::RemoteServer;

use anyhow::Result;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// Connection methods. `Lan` and `OpenBitFunServer` are the retired 1.x relay
/// methods: kept so older requests and persisted values still deserialize,
/// and refused by [`RemoteConnectService::start`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionMethod {
    Lan {
        ip: Option<String>,
    },
    #[serde(rename = "openbitfun_server")]
    OpenBitFunServer,
    BotFeishu,
    BotTelegram,
    BotWeixin,
}

/// Refusal for the retired 1.x relay methods (`lan`, `openbitfun_server`).
pub const RELAY_METHOD_RETIRED: &str = "unsupported: the OpenBitFun relay (phone pairing invitations and the LAN relay) was retired in OpenBitFun 2.0; control this device from the OpenBitFun app or https://<domain>/app/ signed in with the same account";

/// Configuration for Remote Connect (IM bots).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RemoteConnectConfig {
    pub bot_feishu: Option<bot::BotConfig>,
    pub bot_telegram: Option<bot::BotConfig>,
    pub bot_weixin: Option<bot::BotConfig>,
}

/// Result of starting a remote connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionResult {
    pub method: ConnectionMethod,
    pub qr_data: Option<String>,
    pub qr_svg: Option<String>,
    pub qr_url: Option<String>,
    pub bot_pairing_code: Option<String>,
    pub bot_link: Option<String>,
    pub pairing_state: PairingState,
}

/// Handle to a running bot (Telegram, Feishu, or Weixin).
struct BotHandle {
    stop_tx: tokio::sync::watch::Sender<bool>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl BotHandle {
    fn is_running(&self) -> bool {
        self.task.as_ref().is_some_and(|task| !task.is_finished())
    }

    async fn stop(mut self) {
        let _ = self.stop_tx.send(true);
        if let Some(task) = self.task.take() {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for BotHandle {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(true);
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

/// Unified Remote Connect service that orchestrates all connection methods.
pub struct RemoteConnectService {
    config: RemoteConnectConfig,
    device_identity: DeviceIdentity,
    bot_lifecycle: Arc<Mutex<()>>,
    bot_account_identity_epoch: Arc<AtomicU64>,
    bot_account_user_id: RwLock<Option<String>>,
    bot_telegram_slot: Arc<bot::BotSlotFence>,
    bot_feishu_slot: Arc<bot::BotSlotFence>,
    bot_weixin_slot: Arc<bot::BotSlotFence>,
    bot_telegram_handle: Arc<RwLock<Option<BotHandle>>>,
    bot_feishu_handle: Arc<RwLock<Option<BotHandle>>>,
    bot_weixin_handle: Arc<RwLock<Option<BotHandle>>>,
    // Keep Arc references to bots for send_message etc.
    telegram_bot: Arc<RwLock<Option<Arc<bot::telegram::TelegramBot>>>>,
    feishu_bot: Arc<RwLock<Option<Arc<bot::feishu::FeishuBot>>>>,
    weixin_bot: Arc<RwLock<Option<Arc<bot::weixin::WeixinBot>>>>,
    /// Independent bot connection state.
    /// Stores the peer description (e.g. "Telegram(7096812005)") when a bot is active.
    bot_connected_info: Arc<RwLock<Option<String>>>,
}

impl RemoteConnectService {
    pub fn new(config: RemoteConnectConfig) -> Result<Self> {
        let device_identity = DeviceIdentity::from_current_machine()?;

        Ok(Self {
            config,
            device_identity,
            bot_lifecycle: Arc::new(Mutex::new(())),
            bot_account_identity_epoch: Arc::new(AtomicU64::new(0)),
            bot_account_user_id: RwLock::new(None),
            bot_telegram_slot: Arc::new(bot::BotSlotFence::default()),
            bot_feishu_slot: Arc::new(bot::BotSlotFence::default()),
            bot_weixin_slot: Arc::new(bot::BotSlotFence::default()),
            bot_telegram_handle: Arc::new(RwLock::new(None)),
            bot_feishu_handle: Arc::new(RwLock::new(None)),
            bot_weixin_handle: Arc::new(RwLock::new(None)),
            telegram_bot: Arc::new(RwLock::new(None)),
            feishu_bot: Arc::new(RwLock::new(None)),
            weixin_bot: Arc::new(RwLock::new(None)),
            bot_connected_info: Arc::new(RwLock::new(None)),
        })
    }

    /// Account identity is supplied only by the authenticated host adapter.
    /// Replacing or removing it retires every IM channel before new work starts.
    pub async fn set_bot_account(&self, user_id: Option<String>) {
        let _lifecycle = self.bot_lifecycle.lock().await;
        if *self.bot_account_user_id.read().await == user_id {
            return;
        }
        self.bot_account_identity_epoch
            .fetch_add(1, Ordering::AcqRel);
        self.stop_bots_inner().await;
        *self.bot_account_user_id.write().await = user_id;
    }

    pub async fn clear_bot_delegated_identities(&self) {
        self.set_bot_account(None).await;
        openbitfun_services_integrations::remote_connect::bot::clear_persisted_bot_account_contexts(
        );
    }

    /// Used to reject QR completions from a retired account without exposing credentials.
    pub async fn bot_account_scope(&self) -> Option<(String, u64)> {
        let account = self.bot_account_user_id.read().await.clone()?;
        Some((
            account,
            self.bot_account_identity_epoch.load(Ordering::Acquire),
        ))
    }

    pub fn device_identity(&self) -> &DeviceIdentity {
        &self.device_identity
    }

    pub fn update_bot_config(&mut self, bot_config: bot::BotConfig) {
        match bot_config {
            bot::BotConfig::Feishu { app_id, app_secret } => {
                self.config.bot_feishu = Some(bot::BotConfig::Feishu { app_id, app_secret });
            }
            bot::BotConfig::Telegram { bot_token } => {
                self.config.bot_telegram = Some(bot::BotConfig::Telegram { bot_token });
            }
            bot::BotConfig::Weixin {
                ilink_token,
                base_url,
                bot_account_id,
            } => {
                self.config.bot_weixin = Some(bot::BotConfig::Weixin {
                    ilink_token,
                    base_url,
                    bot_account_id,
                });
            }
        }
    }

    /// The methods 2.0 offers: IM bots only.
    pub async fn available_methods(&self) -> Vec<ConnectionMethod> {
        vec![
            ConnectionMethod::BotFeishu,
            ConnectionMethod::BotTelegram,
            ConnectionMethod::BotWeixin,
        ]
    }

    /// Start a bot connection. The 1.x relay methods (`Lan`,
    /// `OpenBitFunServer`) are refused: 2.0 remote control is the fleet over
    /// OpenBitFun Link.
    pub async fn start(&self, method: ConnectionMethod) -> Result<ConnectionResult> {
        match method {
            ConnectionMethod::BotFeishu
            | ConnectionMethod::BotTelegram
            | ConnectionMethod::BotWeixin => self.start_bot_connection(&method).await,
            ConnectionMethod::Lan { .. } | ConnectionMethod::OpenBitFunServer => {
                anyhow::bail!("{RELAY_METHOD_RETIRED}")
            }
        }
    }

    async fn start_bot_connection(&self, method: &ConnectionMethod) -> Result<ConnectionResult> {
        let _lifecycle = self.bot_lifecycle.lock().await;
        device::require_remote_control()?;
        let account_user_id = self
            .bot_account_user_id
            .read()
            .await
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Sign in with GitHub before connecting a bot"))?;
        let pairing_code = pairing::generate_bot_pairing_code();

        let bot_link = match method {
            ConnectionMethod::BotTelegram => {
                match &self.config.bot_telegram {
                    Some(bot::BotConfig::Telegram { bot_token }) if !bot_token.is_empty() => {
                        // Stop any existing Telegram bot
                        let generation = self.bot_telegram_slot.advance();
                        if let Some(handle) = self.bot_telegram_handle.write().await.take() {
                            handle.stop().await;
                        }
                        let lease = bot::BotListenerLease::acquire("telegram")?;

                        let tg_bot = Arc::new(bot::telegram::TelegramBot::new_fenced(
                            bot::telegram::TelegramConfig {
                                bot_token: bot_token.clone(),
                            },
                            bot::BotRuntimeFence::new(
                                self.bot_account_identity_epoch.clone(),
                                self.bot_telegram_slot.clone(),
                                generation,
                            )
                            .with_account(account_user_id.clone()),
                        ));
                        tg_bot.register_pairing(&pairing_code).await?;

                        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);

                        let bot_connected_info = self.bot_connected_info.clone();
                        let bot_for_pair = tg_bot.clone();
                        let bot_for_loop = tg_bot.clone();
                        let tg_bot_ref = self.telegram_bot.clone();
                        let bot_lifecycle = self.bot_lifecycle.clone();
                        let bot_slot = self.bot_telegram_slot.clone();

                        *tg_bot_ref.write().await = Some(tg_bot.clone());

                        let task = tokio::spawn(async move {
                            let _listener_lease = lease;
                            let mut stop_rx = stop_rx;
                            match bot_for_pair.wait_for_pairing(&mut stop_rx).await {
                                Ok(chat_id) => {
                                    let lifecycle = bot_lifecycle.lock().await;
                                    // Guard against the race where stop_bots() cleared
                                    // bot_connected_info between pairing completing and
                                    // this task running.
                                    if !*stop_rx.borrow() && bot_slot.is_current(generation) {
                                        *bot_connected_info.write().await =
                                            Some(format!("Telegram({chat_id})"));
                                        drop(lifecycle);
                                        info!("Telegram bot paired, starting message loop");
                                        bot_for_loop.run_message_loop(stop_rx).await;
                                    } else {
                                        info!("Telegram pairing completed but bot was stopped; discarding");
                                    }
                                }
                                Err(e) => {
                                    info!("Telegram pairing ended: {e}");
                                }
                            }
                        });

                        *self.bot_telegram_handle.write().await = Some(BotHandle {
                            stop_tx,
                            task: Some(task),
                        });

                        "https://t.me/BotFather".to_string()
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "Telegram bot token not configured. Please set bot token first."
                        ));
                    }
                }
            }
            ConnectionMethod::BotFeishu => {
                match &self.config.bot_feishu {
                    Some(bot::BotConfig::Feishu { app_id, app_secret })
                        if !app_id.is_empty() && !app_secret.is_empty() =>
                    {
                        let generation = self.bot_feishu_slot.advance();
                        if let Some(handle) = self.bot_feishu_handle.write().await.take() {
                            handle.stop().await;
                        }
                        let lease = bot::BotListenerLease::acquire("feishu")?;

                        let fs_bot = Arc::new(bot::feishu::FeishuBot::new_fenced(
                            bot::feishu::FeishuConfig {
                                app_id: app_id.clone(),
                                app_secret: app_secret.clone(),
                            },
                            bot::BotRuntimeFence::new(
                                self.bot_account_identity_epoch.clone(),
                                self.bot_feishu_slot.clone(),
                                generation,
                            )
                            .with_account(account_user_id.clone()),
                        ));
                        fs_bot.register_pairing(&pairing_code).await?;

                        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);

                        let bot_connected_info = self.bot_connected_info.clone();
                        let bot_for_pair = fs_bot.clone();
                        let bot_for_loop = fs_bot.clone();
                        let fs_bot_ref = self.feishu_bot.clone();
                        let bot_lifecycle = self.bot_lifecycle.clone();
                        let bot_slot = self.bot_feishu_slot.clone();

                        *fs_bot_ref.write().await = Some(fs_bot.clone());

                        let task = tokio::spawn(async move {
                            let _listener_lease = lease;
                            let mut stop_rx = stop_rx;
                            match bot_for_pair.wait_for_pairing(&mut stop_rx).await {
                                Ok(chat_id) => {
                                    let lifecycle = bot_lifecycle.lock().await;
                                    // Guard against the race where stop_bots() cleared
                                    // bot_connected_info between pairing completing and
                                    // this task running.
                                    if !*stop_rx.borrow() && bot_slot.is_current(generation) {
                                        *bot_connected_info.write().await =
                                            Some(format!("Feishu({chat_id})"));
                                        drop(lifecycle);
                                        info!("Feishu bot paired, starting message loop");
                                        bot_for_loop.run_message_loop(stop_rx).await;
                                    } else {
                                        info!("Feishu pairing completed but bot was stopped; discarding");
                                    }
                                }
                                Err(e) => {
                                    info!("Feishu pairing ended: {e}");
                                }
                            }
                        });

                        *self.bot_feishu_handle.write().await = Some(BotHandle {
                            stop_tx,
                            task: Some(task),
                        });

                        "https://open.feishu.cn/app".to_string()
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "Feishu bot credentials not configured. \
                             Please set App ID and App Secret first."
                        ));
                    }
                }
            }
            ConnectionMethod::BotWeixin => {
                match &self.config.bot_weixin {
                    Some(bot::BotConfig::Weixin {
                        ilink_token,
                        base_url,
                        bot_account_id,
                    }) if !ilink_token.is_empty() && !bot_account_id.is_empty() => {
                        let generation = self.bot_weixin_slot.advance();
                        if let Some(handle) = self.bot_weixin_handle.write().await.take() {
                            handle.stop().await;
                        }
                        let lease = bot::BotListenerLease::acquire("weixin")?;
                        if let Some(previous_bot) = self.weixin_bot.write().await.take() {
                            if let Err(err) = previous_bot.notify_stop().await {
                                warn!("Weixin notify-stop failed during replacement: {err}");
                            }
                        }

                        let wx_cfg = bot::weixin::WeixinConfig {
                            ilink_token: ilink_token.clone(),
                            base_url: if base_url.trim().is_empty() {
                                "https://ilinkai.weixin.qq.com".to_string()
                            } else {
                                base_url.clone()
                            },
                            bot_account_id: bot_account_id.clone(),
                        };

                        let wx_bot = Arc::new(bot::weixin::WeixinBot::new_fenced(
                            wx_cfg,
                            bot::BotRuntimeFence::new(
                                self.bot_account_identity_epoch.clone(),
                                self.bot_weixin_slot.clone(),
                                generation,
                            )
                            .with_account(account_user_id.clone()),
                        ));
                        wx_bot.register_pairing(&pairing_code).await?;

                        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);

                        let bot_connected_info = self.bot_connected_info.clone();
                        let bot_for_pair = wx_bot.clone();
                        let bot_for_loop = wx_bot.clone();
                        let wx_bot_ref = self.weixin_bot.clone();
                        let bot_lifecycle = self.bot_lifecycle.clone();
                        let bot_slot = self.bot_weixin_slot.clone();

                        *wx_bot_ref.write().await = Some(wx_bot.clone());

                        let task = tokio::spawn(async move {
                            let _listener_lease = lease;
                            if let Err(err) = bot_for_pair.notify_start().await {
                                warn!("Weixin notify-start failed; continuing: {err}");
                            }
                            let mut stop_rx = stop_rx;
                            match bot_for_pair.wait_for_pairing(&mut stop_rx).await {
                                Ok(peer_id) => {
                                    let lifecycle = bot_lifecycle.lock().await;
                                    if !*stop_rx.borrow() && bot_slot.is_current(generation) {
                                        *bot_connected_info.write().await =
                                            Some(format!("Weixin({peer_id})"));
                                        drop(lifecycle);
                                        info!("Weixin bot paired, starting message loop");
                                        bot_for_loop.run_message_loop(stop_rx).await;
                                    } else {
                                        info!("Weixin pairing completed but bot was stopped; discarding");
                                    }
                                }
                                Err(e) => {
                                    info!("Weixin pairing ended: {e}");
                                }
                            }
                            if bot_slot.is_current(generation) {
                                if let Err(err) = bot_for_pair.notify_stop().await {
                                    warn!("Weixin notify-stop failed: {err}");
                                }
                            }
                        });

                        *self.bot_weixin_handle.write().await = Some(BotHandle {
                            stop_tx,
                            task: Some(task),
                        });

                        "https://www.wechat.com".to_string()
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "Weixin not linked. Complete WeChat QR login in Remote Connect first."
                        ));
                    }
                }
            }
            _ => {
                return Err(anyhow::anyhow!(
                    "start_bot_connection: unsupported method {method:?}"
                ));
            }
        };

        Ok(ConnectionResult {
            method: method.clone(),
            qr_data: None,
            qr_svg: None,
            qr_url: None,
            bot_pairing_code: Some(pairing_code),
            bot_link: Some(bot_link),
            pairing_state: PairingState::WaitingForScan,
        })
    }

    /// Restore a previously paired bot from persistence.
    /// Skips the pairing step and directly starts the message loop.
    pub async fn restore_bot(&self, saved: &bot::SavedBotConnection) -> Result<()> {
        let _lifecycle = self.bot_lifecycle.lock().await;
        device::require_remote_control()?;
        let account_user_id = self
            .bot_account_user_id
            .read()
            .await
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Sign in with GitHub before restoring a bot"))?;
        if saved.account_user_id.is_empty() || saved.account_user_id != account_user_id {
            anyhow::bail!("Saved bot belongs to a different account or requires pairing again");
        }
        match saved.config {
            bot::BotConfig::Telegram { ref bot_token } => {
                let generation = self.bot_telegram_slot.advance();
                if let Some(handle) = self.bot_telegram_handle.write().await.take() {
                    handle.stop().await;
                }
                let lease = bot::BotListenerLease::acquire("telegram")?;

                let tg_bot = Arc::new(bot::telegram::TelegramBot::new_fenced(
                    bot::telegram::TelegramConfig {
                        bot_token: bot_token.clone(),
                    },
                    bot::BotRuntimeFence::new(
                        self.bot_account_identity_epoch.clone(),
                        self.bot_telegram_slot.clone(),
                        generation,
                    )
                    .with_account(account_user_id.clone()),
                ));

                let chat_id: i64 = saved.chat_id.parse().map_err(|_| {
                    anyhow::anyhow!("invalid saved telegram chat_id: {}", saved.chat_id)
                })?;
                tg_bot
                    .restore_chat_state(chat_id, saved.chat_state.clone())
                    .await;

                let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
                *self.telegram_bot.write().await = Some(tg_bot.clone());
                *self.bot_connected_info.write().await = Some(format!("Telegram({chat_id})"));

                let bot_for_loop = tg_bot.clone();
                let task = tokio::spawn(async move {
                    let _listener_lease = lease;
                    info!("Telegram bot restored from persistence, starting message loop");
                    bot_for_loop.run_message_loop(stop_rx).await;
                });

                *self.bot_telegram_handle.write().await = Some(BotHandle {
                    stop_tx,
                    task: Some(task),
                });
                info!("Telegram bot restored for chat_id={chat_id}");
            }
            bot::BotConfig::Feishu {
                ref app_id,
                ref app_secret,
            } => {
                let generation = self.bot_feishu_slot.advance();
                if let Some(handle) = self.bot_feishu_handle.write().await.take() {
                    handle.stop().await;
                }
                let lease = bot::BotListenerLease::acquire("feishu")?;

                let fs_bot = Arc::new(bot::feishu::FeishuBot::new_fenced(
                    bot::feishu::FeishuConfig {
                        app_id: app_id.clone(),
                        app_secret: app_secret.clone(),
                    },
                    bot::BotRuntimeFence::new(
                        self.bot_account_identity_epoch.clone(),
                        self.bot_feishu_slot.clone(),
                        generation,
                    )
                    .with_account(account_user_id.clone()),
                ));

                fs_bot
                    .restore_chat_state(&saved.chat_id, saved.chat_state.clone())
                    .await;

                let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
                *self.feishu_bot.write().await = Some(fs_bot.clone());

                let cid = saved.chat_id.clone();
                *self.bot_connected_info.write().await = Some(format!("Feishu({cid})"));

                let bot_for_loop = fs_bot.clone();
                let task = tokio::spawn(async move {
                    let _listener_lease = lease;
                    info!("Feishu bot restored from persistence, starting message loop");
                    bot_for_loop.run_message_loop(stop_rx).await;
                });

                *self.bot_feishu_handle.write().await = Some(BotHandle {
                    stop_tx,
                    task: Some(task),
                });
                info!("Feishu bot restored for chat_id={}", saved.chat_id);
            }
            bot::BotConfig::Weixin {
                ref ilink_token,
                ref base_url,
                ref bot_account_id,
            } => {
                let generation = self.bot_weixin_slot.advance();
                if let Some(handle) = self.bot_weixin_handle.write().await.take() {
                    handle.stop().await;
                }
                let lease = bot::BotListenerLease::acquire("weixin")?;
                if let Some(previous_bot) = self.weixin_bot.write().await.take() {
                    if let Err(err) = previous_bot.notify_stop().await {
                        warn!("Weixin notify-stop failed during restore replacement: {err}");
                    }
                }

                let wx_cfg = bot::weixin::WeixinConfig {
                    ilink_token: ilink_token.clone(),
                    base_url: if base_url.trim().is_empty() {
                        "https://ilinkai.weixin.qq.com".to_string()
                    } else {
                        base_url.clone()
                    },
                    bot_account_id: bot_account_id.clone(),
                };

                let wx_bot = Arc::new(bot::weixin::WeixinBot::new_fenced(
                    wx_cfg,
                    bot::BotRuntimeFence::new(
                        self.bot_account_identity_epoch.clone(),
                        self.bot_weixin_slot.clone(),
                        generation,
                    )
                    .with_account(account_user_id.clone()),
                ));
                wx_bot
                    .restore_chat_state(&saved.chat_id, saved.chat_state.clone())
                    .await;

                let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
                *self.weixin_bot.write().await = Some(wx_bot.clone());

                let cid = saved.chat_id.clone();
                *self.bot_connected_info.write().await = Some(format!("Weixin({cid})"));

                let bot_for_loop = wx_bot.clone();
                let bot_for_notify = wx_bot.clone();
                let bot_slot = self.bot_weixin_slot.clone();
                let task = tokio::spawn(async move {
                    let _listener_lease = lease;
                    if let Err(err) = bot_for_notify.notify_start().await {
                        warn!("Weixin notify-start failed during restore; continuing: {err}");
                    }
                    info!("Weixin bot restored from persistence, starting message loop");
                    bot_for_loop.run_message_loop(stop_rx).await;
                    if bot_slot.is_current(generation) {
                        if let Err(err) = bot_for_notify.notify_stop().await {
                            warn!("Weixin notify-stop failed after restored loop: {err}");
                        }
                    }
                });

                *self.bot_weixin_handle.write().await = Some(BotHandle {
                    stop_tx,
                    task: Some(task),
                });
                info!("Weixin bot restored for chat_id={}", saved.chat_id);
            }
        }
        Ok(())
    }

    /// Stop all bot connections.
    pub async fn stop_bots(&self) {
        let _lifecycle = self.bot_lifecycle.lock().await;
        self.stop_bots_inner().await;
    }

    /// Stop only this provider; other bots keep running.
    pub async fn stop_bot(&self, bot_type: &str) -> Result<()> {
        let _lifecycle = self.bot_lifecycle.lock().await;
        match bot_type {
            "telegram" => {
                self.bot_telegram_slot.advance();
                if let Some(handle) = self.bot_telegram_handle.write().await.take() {
                    handle.stop().await;
                }
                *self.telegram_bot.write().await = None;
            }
            "feishu" => {
                self.bot_feishu_slot.advance();
                if let Some(handle) = self.bot_feishu_handle.write().await.take() {
                    handle.stop().await;
                }
                *self.feishu_bot.write().await = None;
            }
            "weixin" => {
                self.bot_weixin_slot.advance();
                if let Some(handle) = self.bot_weixin_handle.write().await.take() {
                    handle.stop().await;
                }
                if let Some(bot) = self.weixin_bot.write().await.take() {
                    if let Err(error) = bot.notify_stop().await {
                        warn!("Weixin notify-stop failed: {error}");
                    }
                }
            }
            _ => anyhow::bail!("Unknown bot type"),
        }
        let mut info = self.bot_connected_info.write().await;
        if info
            .as_deref()
            .is_some_and(|info| info.to_ascii_lowercase().starts_with(bot_type))
        {
            *info = None;
        }
        Ok(())
    }

    async fn stop_bots_inner(&self) {
        self.bot_telegram_slot.advance();
        if let Some(handle) = self.bot_telegram_handle.write().await.take() {
            handle.stop().await;
        }
        *self.telegram_bot.write().await = None;

        self.bot_feishu_slot.advance();
        if let Some(handle) = self.bot_feishu_handle.write().await.take() {
            handle.stop().await;
        }
        *self.feishu_bot.write().await = None;

        self.bot_weixin_slot.advance();
        if let Some(handle) = self.bot_weixin_handle.write().await.take() {
            handle.stop().await;
        }
        if let Some(weixin_bot) = self.weixin_bot.write().await.take() {
            if let Err(err) = weixin_bot.notify_stop().await {
                warn!("Weixin notify-stop failed during bot shutdown: {err}");
            }
        }
        *self.bot_connected_info.write().await = None;

        info!("Bot connections stopped");
    }

    /// Stop everything this service runs (the bots).
    pub async fn stop_all(&self) {
        self.stop_bots().await;
    }

    /// Check whether a specific bot type is currently running.
    pub async fn is_bot_running(&self, bot_type: &str) -> bool {
        match bot_type {
            "telegram" => self
                .bot_telegram_handle
                .read()
                .await
                .as_ref()
                .is_some_and(BotHandle::is_running),
            "feishu" => self
                .bot_feishu_handle
                .read()
                .await
                .as_ref()
                .is_some_and(BotHandle::is_running),
            "weixin" => self
                .bot_weixin_handle
                .read()
                .await
                .as_ref()
                .is_some_and(BotHandle::is_running),
            _ => false,
        }
    }

    pub async fn bot_requires_login(&self, bot_type: &str) -> bool {
        match bot_type {
            "weixin" => self
                .weixin_bot
                .read()
                .await
                .as_ref()
                .is_some_and(|bot| bot.requires_login()),
            _ => false,
        }
    }

    pub async fn bot_connected_info(&self) -> Option<String> {
        self.bot_connected_info.read().await.clone()
    }
}

/// Live session-list state is runtime-owned but not always a metadata write.
/// Only semantic lifecycle facts invalidate the catalog; output chunks do not.
pub fn notify_session_catalog_event(event: &openbitfun_events::AgenticEvent) {
    use openbitfun_events::AgenticEvent;
    if matches!(
        event,
        AgenticEvent::SessionCreated { .. }
            | AgenticEvent::SessionDeleted { .. }
            | AgenticEvent::SessionTitleGenerated { .. }
            | AgenticEvent::SessionStateChanged { .. }
            | AgenticEvent::DialogTurnStarted { .. }
            | AgenticEvent::DialogTurnCompleted { .. }
            | AgenticEvent::DialogTurnFailed { .. }
            | AgenticEvent::DialogTurnCancelled { .. }
    ) {
        crate::service::session::SessionMetadataStore::notify_catalog_changed();
    }
}

#[cfg(test)]
mod listener_lifecycle_tests {
    use super::BotHandle;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    struct Released(Arc<AtomicBool>);
    impl Drop for Released {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn stop_waits_for_listener_release_before_restart() {
        let released = Arc::new(AtomicBool::new(false));
        let guard = Released(released.clone());
        let (stop_tx, _stop_rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(async move {
            let _guard = guard;
            std::future::pending::<()>().await;
        });
        let handle = BotHandle {
            stop_tx,
            task: Some(task),
        };
        assert!(handle.is_running());
        handle.stop().await;
        assert!(released.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn completed_listener_is_reported_stopped() {
        let (stop_tx, _stop_rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(async {});
        while !task.is_finished() {
            tokio::task::yield_now().await;
        }
        let handle = BotHandle {
            stop_tx,
            task: Some(task),
        };
        assert!(!handle.is_running());
        handle.stop().await;
    }
}
