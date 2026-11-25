//! Configuration type definitions

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Main terminal configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    /// Default shell type to use
    pub default_shell: Option<String>,

    /// Default working directory
    pub default_cwd: Option<String>,

    /// Environment variables to set for all terminals.
    ///
    /// An explicit PATH replaces the entire inherited/composed PATH verbatim,
    /// including empty or whitespace values. Per-request PATH has final priority.
    /// Windows variants are unified deterministically with canonical `Path` winning;
    /// Unix keys and values retain their exact original overlay semantics.
    pub env: HashMap<String, String>,

    /// Scrollback buffer size (lines)
    pub scrollback: u32,

    /// Enable flow control
    pub flow_control: FlowControlConfig,

    /// Data buffering configuration
    pub buffering: BufferingConfig,

    /// Session persistence configuration
    pub persistence: PersistenceConfig,

    /// Shell integration settings
    pub shell_integration: ShellIntegrationConfig,

    /// Terminal dimensions
    pub default_cols: u16,
    pub default_rows: u16,

    /// Persistent plain-text transcript settings for user-created terminal sessions.
    #[serde(default)]
    pub transcript: TerminalTranscriptConfig,

    /// Product-managed prefix for implicit PATH of new local Windows sessions.
    ///
    /// Used only without explicit config/request PATH, ahead of the inherited
    /// custom increment and fresh OS baseline. This is an initialization snapshot;
    /// newly installed managed runtimes require host restart, as before. Ignored
    /// on other platforms, whose hosts retain their legacy merged PATH policy.
    #[serde(default)]
    pub managed_path_prefix: Vec<String>,

    /// Initialization snapshot of platform extras appended after the live OS
    /// baseline for implicit PATH of new local Windows sessions. Lowest priority;
    /// ignored on other platforms. Runtime changes to this directory set require
    /// host restart; only the OS baseline is refreshed on each session creation.
    #[serde(default)]
    pub platform_path_suffix: Vec<String>,
}

impl TerminalConfig {
    /// Store the initialization snapshot for new local Windows sessions.
    /// Hosts call this on Windows only; Unix native PATH inheritance is unchanged.
    /// Directory sets are not refreshed when managed runtimes are installed.
    pub fn set_session_path_entries(
        &mut self,
        managed_prefix: Vec<PathBuf>,
        platform_suffix: Vec<PathBuf>,
    ) {
        self.managed_path_prefix = managed_prefix
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        self.platform_path_suffix = platform_suffix
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
    }
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            default_shell: None,
            default_cwd: None,
            env: HashMap::new(),
            scrollback: 10000,
            flow_control: FlowControlConfig::default(),
            buffering: BufferingConfig::default(),
            persistence: PersistenceConfig::default(),
            shell_integration: ShellIntegrationConfig::default(),
            default_cols: 80,
            default_rows: 24,
            transcript: TerminalTranscriptConfig::default(),
            managed_path_prefix: Vec::new(),
            platform_path_suffix: Vec::new(),
        }
    }
}

/// Persistent plain-text transcript settings for user-created terminal sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalTranscriptConfig {
    /// Transcript root directory. `None` disables recording so reusable terminal-core
    /// consumers do not choose a product storage location themselves.
    #[serde(default)]
    pub root_dir: Option<PathBuf>,

    /// Maximum size of a single append-only segment before the next write rotates it.
    pub segment_size_bytes: u64,

    /// Number of recent segments retained for one terminal session.
    pub retained_segments_per_session: usize,

    /// Number of recent sessions retained unless more sessions are currently active.
    pub max_recent_sessions: usize,
}

impl Default for TerminalTranscriptConfig {
    fn default() -> Self {
        Self {
            root_dir: None,
            segment_size_bytes: 4 * 1024 * 1024,
            retained_segments_per_session: 4,
            max_recent_sessions: 10,
        }
    }
}

/// Flow control configuration (prevents data overflow)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowControlConfig {
    /// Enable flow control
    pub enabled: bool,

    /// High water mark - pause PTY when unacknowledged chars exceed this
    pub high_water_mark: usize,

    /// Low water mark - resume PTY when unacknowledged chars fall below this
    pub low_water_mark: usize,
}

impl Default for FlowControlConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            high_water_mark: 100_000, // ~100KB
            low_water_mark: 5_000,    // ~5KB
        }
    }
}

/// Data buffering configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferingConfig {
    /// Enable data buffering
    pub enabled: bool,

    /// Buffer flush interval in milliseconds
    pub flush_interval_ms: u64,

    /// Maximum buffer size before forced flush
    pub max_buffer_size: usize,
}

impl Default for BufferingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            flush_interval_ms: 5,       // 5ms
            max_buffer_size: 64 * 1024, // 64KB
        }
    }
}

/// Session persistence configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    /// Enable session persistence
    pub enabled: bool,

    /// Grace time before orphaned session is killed (seconds)
    pub grace_time_secs: u64,

    /// Short grace time for reduced reconnection window
    pub short_grace_time_secs: u64,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            grace_time_secs: 60,      // 1 minute
            short_grace_time_secs: 6, // 6 seconds
        }
    }
}

/// Shell integration configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellIntegrationConfig {
    /// Enable shell integration
    pub enabled: bool,

    /// Enable command detection
    pub command_detection: bool,

    /// Enable CWD detection
    pub cwd_detection: bool,

    /// Shell integration nonce for security
    pub nonce: Option<String>,

    /// Directory for shell integration scripts.
    /// If None, uses default location: {cache_dir}/openbitfun_terminal/scripts
    #[serde(default)]
    pub scripts_dir: Option<PathBuf>,
}

impl Default for ShellIntegrationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            command_detection: true,
            cwd_detection: true,
            nonce: None,
            scripts_dir: None,
        }
    }
}

/// Shell-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellConfig {
    /// Path to shell executable
    pub executable: String,

    /// Arguments to pass to shell
    pub args: Vec<String>,

    /// Environment variables specific to this shell
    pub env: HashMap<String, String>,

    /// Working directory
    pub cwd: Option<String>,

    /// Login shell flag
    pub login: bool,
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            executable: default_shell_executable(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: None,
            login: false,
        }
    }
}

/// Get the default shell executable for the current platform
fn default_shell_executable() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalConfig;
    use std::path::PathBuf;

    #[test]
    fn legacy_payload_without_session_path_policy_uses_empty_defaults() {
        let mut legacy = TerminalConfig::default();
        legacy.env.insert("PATH".to_string(), "  ".to_string());
        let mut payload =
            serde_json::to_value(&legacy).expect("serialize terminal config");
        let object = payload
            .as_object_mut()
            .expect("terminal config serializes to an object");
        object.remove("managed_path_prefix");
        object.remove("platform_path_suffix");

        let restored: TerminalConfig =
            serde_json::from_value(payload).expect("deserialize legacy terminal config");

        assert!(restored.managed_path_prefix.is_empty());
        assert!(restored.platform_path_suffix.is_empty());
        assert_eq!(restored.env, legacy.env);
        let round_trip: TerminalConfig = serde_json::from_value(
            serde_json::to_value(&restored).expect("serialize restored legacy config"),
        )
        .expect("round trip legacy config");
        assert_eq!(round_trip.env, legacy.env);
    }

    #[test]
    fn session_path_policy_round_trips_through_json() {
        let mut config = TerminalConfig::default();
        config.set_session_path_entries(
            vec![
                PathBuf::from("/synthetic/managed/runtime"),
                PathBuf::from("/synthetic/managed/node"),
            ],
            vec![PathBuf::from("/synthetic/platform/gui")],
        );

        assert_eq!(
            config.managed_path_prefix,
            vec![
                "/synthetic/managed/runtime".to_string(),
                "/synthetic/managed/node".to_string()
            ]
        );
        assert_eq!(
            config.platform_path_suffix,
            vec!["/synthetic/platform/gui".to_string()]
        );

        let payload = serde_json::to_string(&config).expect("serialize terminal config");
        let restored: TerminalConfig =
            serde_json::from_str(&payload).expect("deserialize terminal config");

        assert_eq!(restored.managed_path_prefix, config.managed_path_prefix);
        assert_eq!(restored.platform_path_suffix, config.platform_path_suffix);
    }
}
