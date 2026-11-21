//! Retention for the OpenBitFun 2.0 account directory.
//!
//! The 2.0 directory keeps only bounded, expiring state: identity rows,
//! device rows with their public keys, and bearer tokens. This module gives
//! each of them a TTL and eviction:
//!
//! - expired tokens are swept periodically (not only at start-up or when a
//!   token happens to be looked up);
//! - a device row with no live token whose `last_seen_at` is older than its
//!   kind's TTL is removed (controllers, which include browser sign-ins, go
//!   sooner than hosts). A row without `last_seen_at` (written before the
//!   column was filled) is never removed by age;
//! - a user with no device, token or Page left, not signed in for a year, is
//!   removed; the next sign-in recreates it;
//! - a sign-in that would hit the 64-device or 256-token account quota first
//!   frees room from dead or stale controller rows, so the quota never locks
//!   a user out of their own account.
//!
//! It is opt-in (`RELAY_PROFILE=directory`): the 1.x relay built from the
//! same crate keeps its behaviour.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use chrono::Utc;

use crate::db::DbPool;

/// The device quota enforced by the `limit_account_devices` trigger.
pub const ACCOUNT_DEVICE_QUOTA: i64 = 64;
/// The live-token quota enforced by the `limit_account_tokens` trigger.
pub const ACCOUNT_TOKEN_QUOTA: i64 = 256;

const DAY_SECS: i64 = 24 * 3600;

/// Retention settings of the 2.0 directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryHygiene {
    /// Tokenless host rows (desktop, CLI, cloud agent, unknown kind) go after
    /// this long without being seen.
    pub stale_host_secs: i64,
    /// Tokenless controller rows (`mobile`, which browser sign-ins use, and
    /// `watch`) go after this long without being seen.
    pub stale_controller_secs: i64,
    /// Users with nothing left go after this long without a sign-in.
    pub stale_user_secs: i64,
    /// How often the sweep runs.
    pub sweep_interval: Duration,
}

impl Default for DirectoryHygiene {
    fn default() -> Self {
        Self {
            stale_host_secs: 90 * DAY_SECS,
            stale_controller_secs: 30 * DAY_SECS,
            stale_user_secs: 365 * DAY_SECS,
            sweep_interval: Duration::from_secs(3600),
        }
    }
}

impl DirectoryHygiene {
    /// Reads `RELAY_STALE_DEVICE_DAYS`, `RELAY_STALE_CONTROLLER_DAYS`,
    /// `RELAY_STALE_USER_DAYS` and `RELAY_SWEEP_INTERVAL_SECS` over the
    /// defaults. A value that is not a positive integer is an error.
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let mut hygiene = Self::default();
        let positive = |name: &str| -> Result<Option<i64>> {
            match lookup(name) {
                None => Ok(None),
                Some(value) if value.trim().is_empty() => Ok(None),
                Some(value) => match value.trim().parse::<i64>() {
                    Ok(number) if number > 0 => Ok(Some(number)),
                    _ => Err(anyhow!("{name} must be a positive integer, got {value:?}")),
                },
            }
        };
        if let Some(days) = positive("RELAY_STALE_DEVICE_DAYS")? {
            hygiene.stale_host_secs = days * DAY_SECS;
        }
        if let Some(days) = positive("RELAY_STALE_CONTROLLER_DAYS")? {
            hygiene.stale_controller_secs = days * DAY_SECS;
        }
        if let Some(days) = positive("RELAY_STALE_USER_DAYS")? {
            hygiene.stale_user_secs = days * DAY_SECS;
        }
        if let Some(secs) = positive("RELAY_SWEEP_INTERVAL_SECS")? {
            hygiene.sweep_interval = Duration::from_secs(secs as u64);
        }
        Ok(hygiene)
    }
}

/// What one sweep removed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepReport {
    pub expired_tokens: u64,
    pub stale_devices: u64,
    pub stale_users: u64,
}

/// Runs one retention pass at `now` (Unix seconds) in one transaction.
pub async fn sweep(pool: &DbPool, hygiene: &DirectoryHygiene, now: i64) -> Result<SweepReport> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| anyhow!("begin directory sweep: {error}"))?;
    let expired_tokens = sqlx::query("DELETE FROM auth_tokens WHERE expires_at <= ?")
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|error| anyhow!("sweep expired tokens: {error}"))?
        .rows_affected();
    let stale_devices = sqlx::query(
        "DELETE FROM devices \
         WHERE last_seen_at IS NOT NULL \
           AND last_seen_at < CASE WHEN device_kind IN ('mobile', 'watch') THEN ? ELSE ? END \
           AND NOT EXISTS (SELECT 1 FROM auth_tokens t \
                           WHERE t.user_id = devices.user_id AND t.device_id = devices.device_id)",
    )
    .bind(now - hygiene.stale_controller_secs)
    .bind(now - hygiene.stale_host_secs)
    .execute(&mut *tx)
    .await
    .map_err(|error| anyhow!("sweep stale devices: {error}"))?
    .rows_affected();
    let stale_users = sqlx::query(
        "DELETE FROM users \
         WHERE updated_at < ? \
           AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = users.user_id) \
           AND NOT EXISTS (SELECT 1 FROM auth_tokens t WHERE t.user_id = users.user_id) \
           AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.user_id = users.user_id)",
    )
    .bind(now - hygiene.stale_user_secs)
    .execute(&mut *tx)
    .await
    .map_err(|error| anyhow!("sweep stale users: {error}"))?
    .rows_affected();
    tx.commit()
        .await
        .map_err(|error| anyhow!("commit directory sweep: {error}"))?;
    Ok(SweepReport {
        expired_tokens,
        stale_devices,
        stale_users,
    })
}

/// Sweeps once now, then every `hygiene.sweep_interval`. Failures are logged
/// and retried on the next tick.
pub fn spawn_sweeper(pool: Arc<DbPool>, hygiene: DirectoryHygiene) -> tokio::task::JoinHandle<()> {
    tracing::info!(
        "Directory retention enabled: stale_host_days={}, stale_controller_days={}, stale_user_days={}, sweep_interval_secs={}",
        hygiene.stale_host_secs / DAY_SECS,
        hygiene.stale_controller_secs / DAY_SECS,
        hygiene.stale_user_secs / DAY_SECS,
        hygiene.sweep_interval.as_secs()
    );
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(hygiene.sweep_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            match sweep(&pool, &hygiene, Utc::now().timestamp()).await {
                Ok(report) => tracing::info!(
                    "Directory sweep: expired_tokens={}, stale_devices={}, stale_users={}",
                    report.expired_tokens,
                    report.stale_devices,
                    report.stale_users
                ),
                Err(error) => tracing::warn!("Directory sweep failed: {error}"),
            }
        }
    })
}

/// What [`make_room`] freed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RoomReport {
    pub devices_removed: u64,
    pub tokens_revoked: u64,
}

/// Frees quota before a sign-in of `device_id` on `user_id`:
///
/// - a new device id on an account at the device quota removes the dead row
///   seen longest ago (no live token), else the controller row seen longest
///   ago (its tokens are revoked; that browser or phone signs in again).
///   Hosts and the cloud agent are never removed here;
/// - an account at the live-token quota revokes the oldest tokens of this
///   same device first, then of controller rows.
///
/// When only live hosts fill the account, nothing is removed and the quota
/// error stands: that account really has that many hosts.
pub async fn make_room(
    pool: &DbPool,
    user_id: &str,
    device_id: &str,
    now: i64,
) -> Result<RoomReport> {
    let mut report = RoomReport::default();
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| anyhow!("begin directory admission: {error}"))?;
    let known: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?")
            .bind(user_id)
            .bind(device_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|error| anyhow!("read device row: {error}"))?;
    if known.is_none() {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM devices WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| anyhow!("count devices: {error}"))?;
        let excess = count - ACCOUNT_DEVICE_QUOTA + 1;
        if excess > 0 {
            let victims: Vec<String> = sqlx::query_scalar(
                "SELECT device_id FROM devices d WHERE d.user_id = ? \
                   AND (d.device_kind IN ('mobile', 'watch') \
                        OR (d.device_kind IS NOT 'cloud_agent' AND NOT EXISTS \
                            (SELECT 1 FROM auth_tokens t WHERE t.user_id = d.user_id \
                               AND t.device_id = d.device_id AND t.expires_at > ?))) \
                 ORDER BY EXISTS (SELECT 1 FROM auth_tokens t WHERE t.user_id = d.user_id \
                                    AND t.device_id = d.device_id AND t.expires_at > ?), \
                          COALESCE(d.last_seen_at, 0), d.device_id \
                 LIMIT ?",
            )
            .bind(user_id)
            .bind(now)
            .bind(now)
            .bind(excess)
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| anyhow!("pick devices to free: {error}"))?;
            for victim in victims {
                report.tokens_revoked +=
                    sqlx::query("DELETE FROM auth_tokens WHERE user_id = ? AND device_id = ?")
                        .bind(user_id)
                        .bind(&victim)
                        .execute(&mut *tx)
                        .await
                        .map_err(|error| anyhow!("revoke freed device tokens: {error}"))?
                        .rows_affected();
                report.devices_removed +=
                    sqlx::query("DELETE FROM devices WHERE user_id = ? AND device_id = ?")
                        .bind(user_id)
                        .bind(&victim)
                        .execute(&mut *tx)
                        .await
                        .map_err(|error| anyhow!("free device row: {error}"))?
                        .rows_affected();
            }
        }
    }
    let live: i64 =
        sqlx::query_scalar("SELECT count(*) FROM auth_tokens WHERE user_id = ? AND expires_at > ?")
            .bind(user_id)
            .bind(now)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| anyhow!("count tokens: {error}"))?;
    let excess = live - ACCOUNT_TOKEN_QUOTA + 1;
    if excess > 0 {
        report.tokens_revoked += sqlx::query(
            "DELETE FROM auth_tokens WHERE token IN ( \
               SELECT t.token FROM auth_tokens t \
               LEFT JOIN devices d ON d.user_id = t.user_id AND d.device_id = t.device_id \
               WHERE t.user_id = ? AND t.expires_at > ? \
                 AND (t.device_id = ? OR d.device_kind IN ('mobile', 'watch')) \
               ORDER BY (t.device_id = ?) DESC, t.created_at, t.token \
               LIMIT ?)",
        )
        .bind(user_id)
        .bind(now)
        .bind(device_id)
        .bind(device_id)
        .bind(excess)
        .execute(&mut *tx)
        .await
        .map_err(|error| anyhow!("revoke tokens over the quota: {error}"))?
        .rows_affected();
    }
    tx.commit()
        .await
        .map_err(|error| anyhow!("commit directory admission: {error}"))?;
    if report != RoomReport::default() {
        tracing::info!(
            "Directory quota room made: devices_removed={}, tokens_revoked={}",
            report.devices_removed,
            report.tokens_revoked
        );
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{connect, AuthToken, DeviceRow, UserRow};

    const NOW: i64 = 1_800_000_000;

    async fn device(pool: &DbPool, user: &str, id: &str, kind: Option<&str>, seen: Option<i64>) {
        sqlx::query(
            "INSERT INTO devices (device_id, user_id, device_name, device_kind, last_seen_at) \
             VALUES (?, ?, 'd', ?, ?)",
        )
        .bind(id)
        .bind(user)
        .bind(kind)
        .bind(seen)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn token(pool: &DbPool, user: &str, id: &str, created: i64, expires: i64) -> String {
        let token = format!("{:064x}", rand::random::<u128>());
        sqlx::query(
            "INSERT INTO auth_tokens (token, user_id, device_id, token_kind, created_at, expires_at) \
             VALUES (?, ?, ?, 'device', ?, ?)",
        )
        .bind(&token)
        .bind(user)
        .bind(id)
        .bind(created)
        .bind(expires)
        .execute(pool)
        .await
        .unwrap();
        token
    }

    async fn ids(pool: &DbPool, user: &str) -> Vec<String> {
        let mut ids: Vec<String> =
            sqlx::query_scalar("SELECT device_id FROM devices WHERE user_id = ?")
                .bind(user)
                .fetch_all(pool)
                .await
                .unwrap();
        ids.sort();
        ids
    }

    #[test]
    fn settings_read_from_the_environment_and_refuse_bad_values() {
        let hygiene = DirectoryHygiene::from_lookup(|_| None).unwrap();
        assert_eq!(hygiene, DirectoryHygiene::default());
        let hygiene = DirectoryHygiene::from_lookup(|name| match name {
            "RELAY_STALE_DEVICE_DAYS" => Some("60".into()),
            "RELAY_SWEEP_INTERVAL_SECS" => Some("600".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(hygiene.stale_host_secs, 60 * DAY_SECS);
        assert_eq!(hygiene.stale_controller_secs, 30 * DAY_SECS);
        assert_eq!(hygiene.sweep_interval, Duration::from_secs(600));
        assert!(DirectoryHygiene::from_lookup(|name| {
            (name == "RELAY_STALE_USER_DAYS").then(|| "0".into())
        })
        .is_err());
    }

    #[tokio::test]
    async fn the_sweep_removes_expired_tokens_and_stale_rows_only() {
        let pool = connect(":memory:").await.unwrap();
        let hygiene = DirectoryHygiene::default();
        UserRow::create(&pool, "u1", "alice").await.unwrap();
        let old = NOW - 100 * DAY_SECS;
        let recent = NOW - 10 * DAY_SECS;
        // Stale, tokenless rows of every kind.
        device(&pool, "u1", "old-desk", Some("desktop"), Some(old)).await;
        device(
            &pool,
            "u1",
            "old-browser",
            Some("mobile"),
            Some(NOW - 40 * DAY_SECS),
        )
        .await;
        device(&pool, "u1", "old-cloud", Some("cloud_agent"), Some(old)).await;
        // Kept: a live token, recently seen, a legacy row without last_seen,
        // and a 40-day-old host (under the 90-day host TTL).
        device(&pool, "u1", "live-desk", Some("desktop"), Some(old)).await;
        let live = token(&pool, "u1", "live-desk", old, NOW + DAY_SECS).await;
        device(&pool, "u1", "live-cloud", Some("cloud_agent"), Some(old)).await;
        token(&pool, "u1", "live-cloud", old, NOW + DAY_SECS).await;
        device(&pool, "u1", "recent-browser", Some("mobile"), Some(recent)).await;
        device(&pool, "u1", "legacy", None, None).await;
        device(
            &pool,
            "u1",
            "cli-40d",
            Some("cli"),
            Some(NOW - 40 * DAY_SECS),
        )
        .await;
        // An expired token on a stale row: the token goes, then the row.
        device(&pool, "u1", "expired-desk", Some("desktop"), Some(old)).await;
        token(&pool, "u1", "expired-desk", old, NOW - DAY_SECS).await;

        let report = sweep(&pool, &hygiene, NOW).await.unwrap();
        assert_eq!(
            report,
            SweepReport {
                expired_tokens: 1,
                stale_devices: 4,
                stale_users: 0
            }
        );
        assert_eq!(
            ids(&pool, "u1").await,
            vec![
                "cli-40d",
                "legacy",
                "live-cloud",
                "live-desk",
                "recent-browser"
            ]
        );
        assert!(AuthToken::find(&pool, &live).await.unwrap().is_some());
        // Idempotent.
        assert_eq!(
            sweep(&pool, &hygiene, NOW).await.unwrap(),
            SweepReport::default()
        );
    }

    #[tokio::test]
    async fn a_user_with_nothing_left_goes_after_a_year() {
        let pool = connect(":memory:").await.unwrap();
        let hygiene = DirectoryHygiene::default();
        for user in ["empty-old", "empty-new", "with-device"] {
            UserRow::create(&pool, user, user).await.unwrap();
        }
        sqlx::query(
            "UPDATE users SET updated_at = ? WHERE user_id IN ('empty-old', 'with-device')",
        )
        .bind(NOW - 400 * DAY_SECS)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE users SET updated_at = ? WHERE user_id = 'empty-new'")
            .bind(NOW - DAY_SECS)
            .execute(&pool)
            .await
            .unwrap();
        device(&pool, "with-device", "legacy", None, None).await;
        let report = sweep(&pool, &hygiene, NOW).await.unwrap();
        assert_eq!(report.stale_users, 1);
        assert!(UserRow::find_by_user_id(&pool, "empty-old")
            .await
            .unwrap()
            .is_none());
        assert!(UserRow::find_by_user_id(&pool, "empty-new")
            .await
            .unwrap()
            .is_some());
        assert!(UserRow::find_by_user_id(&pool, "with-device")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn a_full_account_frees_a_dead_row_then_a_controller_never_a_live_host() {
        let pool = connect(":memory:").await.unwrap();
        UserRow::create(&pool, "u1", "alice").await.unwrap();
        // 60 live hosts, 2 live browsers, 1 dead CLI row and the cloud agent.
        for index in 0..60 {
            let id = format!("desk-{index:02}");
            device(&pool, "u1", &id, Some("desktop"), Some(NOW - 5)).await;
            token(&pool, "u1", &id, NOW - 5, NOW + DAY_SECS).await;
        }
        for (id, seen) in [("browser-a", NOW - 50), ("browser-b", NOW - 100)] {
            device(&pool, "u1", id, Some("mobile"), Some(seen)).await;
            token(&pool, "u1", id, seen, NOW + DAY_SECS).await;
        }
        device(&pool, "u1", "dead-cli", Some("cli"), Some(NOW - 1)).await;
        device(
            &pool,
            "u1",
            "cloud-1",
            Some("cloud_agent"),
            Some(NOW - 1000),
        )
        .await;
        assert_eq!(ids(&pool, "u1").await.len(), 64);

        // Without room the trigger refuses the sign-in.
        assert!(
            DeviceRow::upsert(&pool, "new-1", "u1", "n", Some("mobile"), Some("k"))
                .await
                .is_err()
        );
        // The dead row goes first, even though it was seen more recently.
        let report = make_room(&pool, "u1", "new-1", NOW).await.unwrap();
        assert_eq!(report.devices_removed, 1);
        assert!(!ids(&pool, "u1").await.contains(&"dead-cli".to_string()));
        DeviceRow::upsert(&pool, "new-1", "u1", "n", Some("mobile"), Some("k"))
            .await
            .unwrap();
        // The sign-in then issues its token (seen now, on the test clock).
        token(&pool, "u1", "new-1", NOW, NOW + DAY_SECS).await;
        sqlx::query("UPDATE devices SET last_seen_at = ? WHERE device_id = 'new-1'")
            .bind(NOW)
            .execute(&pool)
            .await
            .unwrap();
        // Next, the controller seen longest ago (with its tokens).
        let report = make_room(&pool, "u1", "new-2", NOW).await.unwrap();
        assert_eq!(
            report,
            RoomReport {
                devices_removed: 1,
                tokens_revoked: 1
            }
        );
        assert!(!ids(&pool, "u1").await.contains(&"browser-b".to_string()));
        DeviceRow::upsert(&pool, "new-2", "u1", "n", Some("mobile"), Some("k"))
            .await
            .unwrap();
        // A known device needs no room.
        assert_eq!(
            make_room(&pool, "u1", "desk-00", NOW).await.unwrap(),
            RoomReport::default()
        );
        // Only hosts and the cloud agent left: nothing is removed.
        sqlx::query("DELETE FROM devices WHERE device_kind = 'mobile'")
            .execute(&pool)
            .await
            .unwrap();
        for index in 60..63 {
            let id = format!("desk-{index:02}");
            device(&pool, "u1", &id, Some("desktop"), Some(NOW)).await;
            token(&pool, "u1", &id, NOW, NOW + DAY_SECS).await;
        }
        let before = ids(&pool, "u1").await;
        assert_eq!(before.len(), 64);
        assert_eq!(
            make_room(&pool, "u1", "new-3", NOW).await.unwrap(),
            RoomReport::default()
        );
        assert_eq!(ids(&pool, "u1").await, before);
    }

    #[tokio::test]
    async fn repeated_sign_ins_never_hit_the_token_quota() {
        let pool = connect(":memory:").await.unwrap();
        UserRow::create(&pool, "u1", "alice").await.unwrap();
        device(&pool, "u1", "desk", Some("desktop"), Some(NOW)).await;
        let desk = token(&pool, "u1", "desk", NOW - 10, NOW + DAY_SECS).await;
        device(&pool, "u1", "browser", Some("mobile"), Some(NOW)).await;
        for index in 0..(ACCOUNT_TOKEN_QUOTA - 1) {
            token(&pool, "u1", "browser", NOW + index, NOW + DAY_SECS).await;
        }
        assert!(AuthToken::create(&pool, "u1", "browser").await.is_err());
        let report = make_room(&pool, "u1", "browser", NOW).await.unwrap();
        assert_eq!(report.tokens_revoked, 1);
        AuthToken::create(&pool, "u1", "browser").await.unwrap();
        // The desktop's token was never touched.
        assert!(AuthToken::find(&pool, &desk).await.unwrap().is_some());
    }
}
