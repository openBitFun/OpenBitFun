//! Where the module's diagnostics go.
//!
//! The host owns the `log` facade: NSH installs its logger before any
//! module runs (Android: `JNI_OnLoad` sets a logcat logger, tag `nsh`, info
//! and up; iOS: the unified log, warnings and errors in release builds and
//! everything from info up under `nsh run`). A second `log` logger
//! (`android_logger`, `oslog`) could never be installed, so this module's
//! own `log` lines and `openbitfun-link`'s go there.
//!
//! What the host does not take is `tracing`, which OpenBitFun Link's
//! EasyTier core logs through. [`init`] installs a `tracing` subscriber that
//! writes each event to:
//!
//! - Android: logcat under the tag `OpenBitFun` (`adb logcat -s OpenBitFun nsh`),
//!   at any level the filter lets through (the host's logger stops at info);
//! - iOS and others: the host's `log` logger (the unified log, and stderr
//!   under `nsh run` or a debugger).
//!
//! The filter is `warn` for everything (`error` for EasyTier's event bus
//! and route sync, which warn routinely), `info` for OpenBitFun's own crates.
//! `OPENBITFUN_MOBILE_LOG` (and on Android the system property
//! `debug.openbitfun.log`, settable with `adb shell setprop`) changes it:
//! `target=level` directives apply on top of the default
//! (`easytier_core=info`); an override with a bare level replaces the default
//! (`debug`, `warn,openbitfun_link=trace`).
//!
//! Lines are English. Fields whose names say they carry secrets (tokens,
//! secrets, passwords, credentials, keys, authorization) are written as
//! `<redacted>`; the module's own lines never include them.

use std::fmt::{self, Write as _};
use std::sync::Once;

use tracing::field::{Field, Visit};
use tracing::level_filters::LevelFilter;
use tracing::subscriber::Interest;
use tracing::{span, Event, Level, Metadata, Subscriber};

/// The filter before any override.
/// EasyTier's event bus warns on every event nobody subscribes to, and its
/// route sync warns on routine session resets: errors only there.
const DEFAULT_FILTER: &str = "warn,easytier::common::global_ctx=error,\
easytier_core::peers::route=error,openbitfun_mobile_native=info,openbitfun_link=info,\
openbitfun_services_core=info";

/// Installs the `tracing` subscriber and the panic hook once per process.
pub(crate) fn init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let override_spec = override_spec();
        let filter = Filter::parse(DEFAULT_FILTER, override_spec.as_deref());
        let installed = tracing::subscriber::set_global_default(Bridge { filter }).is_ok();
        install_panic_hook();
        tracing::info!(
            target: "openbitfun_mobile_native",
            version = env!("CARGO_PKG_VERSION"),
            os = std::env::consts::OS,
            arch = std::env::consts::ARCH,
            filter_override = override_spec.as_deref().unwrap_or("none"),
            tracing_subscriber = if installed { "installed" } else { "already set by the host" },
            "OpenBitFun phone controller module logging ready"
        );
    });
}

/// `OPENBITFUN_MOBILE_LOG`, else (Android) `debug.openbitfun.log`.
fn override_spec() -> Option<String> {
    let from_env = std::env::var("OPENBITFUN_MOBILE_LOG")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    #[cfg(target_os = "android")]
    let from_env = from_env.or_else(|| crate::device::android_property("debug.openbitfun.log"));
    from_env
}

/// Panics on a phone have no stderr to land on: write them to the log too,
/// then run the previous hook.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|text| (*text).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-text panic payload".to_string());
        let thread = std::thread::current();
        write_line(
            Level::ERROR,
            "openbitfun_mobile_native::panic",
            &format!(
                "Panic on thread {}: {} at {}",
                thread.name().unwrap_or("unnamed"),
                payload,
                location
            ),
        );
        previous(info);
    }));
}

/// One directive: a target prefix (empty: every target) and its level.
#[derive(Debug, Clone, PartialEq)]
struct Directive {
    target: String,
    level: LevelFilter,
}

/// Targets' levels; the longest matching target wins, then the later one.
#[derive(Debug, Clone)]
struct Filter {
    directives: Vec<Directive>,
    max: LevelFilter,
}

fn parse_level(text: &str) -> Option<LevelFilter> {
    match text.trim().to_ascii_lowercase().as_str() {
        "off" => Some(LevelFilter::OFF),
        "error" => Some(LevelFilter::ERROR),
        "warn" | "warning" => Some(LevelFilter::WARN),
        "info" => Some(LevelFilter::INFO),
        "debug" => Some(LevelFilter::DEBUG),
        "trace" => Some(LevelFilter::TRACE),
        _ => None,
    }
}

impl Filter {
    /// `default`, then `extra` on top (comma-separated `level` or
    /// `target=level`; unknown parts are skipped). An `extra` with a bare
    /// level replaces `default`.
    fn parse(default: &str, extra: Option<&str>) -> Self {
        let extra = Self::directives(extra.unwrap_or_default());
        let mut directives = if extra.iter().any(|directive| directive.target.is_empty()) {
            Vec::new()
        } else {
            Self::directives(default)
        };
        directives.extend(extra);
        let max = directives
            .iter()
            .map(|directive| directive.level)
            .max()
            .unwrap_or(LevelFilter::OFF);
        Self { directives, max }
    }

    fn directives(spec: &str) -> Vec<Directive> {
        spec.split(',')
            .filter_map(|part| {
                let part = part.trim();
                match part.split_once('=') {
                    Some((target, level)) => parse_level(level).map(|level| Directive {
                        target: target.trim().to_string(),
                        level,
                    }),
                    None => parse_level(part).map(|level| Directive {
                        target: String::new(),
                        level,
                    }),
                }
            })
            .collect()
    }

    fn level_for(&self, target: &str) -> LevelFilter {
        let mut best: Option<&Directive> = None;
        for directive in &self.directives {
            let matches = directive.target.is_empty()
                || target == directive.target
                || target
                    .strip_prefix(directive.target.as_str())
                    .is_some_and(|rest| rest.starts_with("::"));
            if matches && best.is_none_or(|current| directive.target.len() >= current.target.len())
            {
                best = Some(directive);
            }
        }
        best.map(|directive| directive.level)
            .unwrap_or(LevelFilter::OFF)
    }

    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        // Spans carry nothing this bridge writes; events only.
        metadata.is_event() && *metadata.level() <= self.level_for(metadata.target())
    }
}

/// `tracing` events to the platform log.
struct Bridge {
    filter: Filter,
}

impl Subscriber for Bridge {
    fn register_callsite(&self, metadata: &'static Metadata<'static>) -> Interest {
        if self.filter.enabled(metadata) {
            Interest::always()
        } else {
            Interest::never()
        }
    }

    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        self.filter.enabled(metadata)
    }

    fn max_level_hint(&self) -> Option<LevelFilter> {
        Some(self.filter.max)
    }

    fn new_span(&self, _: &span::Attributes<'_>) -> span::Id {
        // Spans are not tracked (see `Filter::enabled`).
        span::Id::from_u64(1)
    }

    fn record(&self, _: &span::Id, _: &span::Record<'_>) {}

    fn record_follows_from(&self, _: &span::Id, _: &span::Id) {}

    fn event(&self, event: &Event<'_>) {
        let metadata = event.metadata();
        let mut line = Line::default();
        event.record(&mut line);
        write_line(*metadata.level(), metadata.target(), &line.finish());
    }

    fn enter(&self, _: &span::Id) {}

    fn exit(&self, _: &span::Id) {}
}

/// Whether a field's name says it holds a secret.
fn secret_field(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "secret",
        "token",
        "password",
        "passwd",
        "credential",
        "authorization",
        "private_key",
        "privkey",
        "cookie",
        "psk",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

/// An event as `message key=value ...`.
#[derive(Default)]
struct Line {
    message: String,
    fields: String,
}

impl Line {
    fn field(&mut self, field: &Field, value: fmt::Arguments<'_>) {
        if field.name() == "message" {
            let _ = self.message.write_fmt(value);
        } else if secret_field(field.name()) {
            let _ = write!(self.fields, " {}=<redacted>", field.name());
        } else if !field.name().starts_with("log.") {
            let _ = write!(self.fields, " {}=", field.name());
            let _ = self.fields.write_fmt(value);
        }
    }

    fn finish(self) -> String {
        let mut text = self.message;
        text.push_str(&self.fields);
        text
    }
}

impl Visit for Line {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.field(field, format_args!("{value}"));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.field(field, format_args!("{value:?}"));
    }
}

/// Writes one line to logcat (tag `OpenBitFun`).
#[cfg(target_os = "android")]
fn write_line(level: Level, target: &str, message: &str) {
    use std::ffi::{c_char, c_int, CString};

    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(priority: c_int, tag: *const c_char, text: *const c_char) -> c_int;
    }

    let priority = match level {
        Level::ERROR => 6,
        Level::WARN => 5,
        Level::INFO => 4,
        Level::DEBUG => 3,
        Level::TRACE => 2,
    };
    let text = CString::new(format!("{target}: {message}").replace('\0', " ")).unwrap_or_default();
    // SAFETY: both pointers are valid NUL-terminated strings for the call.
    unsafe { __android_log_write(priority, c"OpenBitFun".as_ptr(), text.as_ptr()) };
}

/// Hands one line to the host's `log` logger.
#[cfg(not(target_os = "android"))]
fn write_line(level: Level, target: &str, message: &str) {
    let level = match level {
        Level::ERROR => log::Level::Error,
        Level::WARN => log::Level::Warn,
        Level::INFO => log::Level::Info,
        Level::DEBUG => log::Level::Debug,
        Level::TRACE => log::Level::Trace,
    };
    log::logger().log(
        &log::Record::builder()
            .level(level)
            .target(target)
            .args(format_args!("{message}"))
            .build(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_filter_keeps_openbitfun_at_info_and_the_rest_at_warn() {
        let filter = Filter::parse(DEFAULT_FILTER, None);
        assert_eq!(
            filter.level_for("openbitfun_link::session"),
            LevelFilter::INFO
        );
        assert_eq!(
            filter.level_for("openbitfun_mobile_native"),
            LevelFilter::INFO
        );
        assert_eq!(filter.level_for("easytier_core::peers"), LevelFilter::WARN);
        assert_eq!(filter.level_for("openbitfun_linkage"), LevelFilter::WARN);
        assert_eq!(filter.max, LevelFilter::INFO);
    }

    #[test]
    fn overrides_apply_on_top_and_bad_parts_are_skipped() {
        let filter = Filter::parse(
            DEFAULT_FILTER,
            Some("easytier_core=debug, bogus, x=loud,openbitfun_link=error"),
        );
        assert_eq!(
            filter.level_for("easytier_core::peers::rpc"),
            LevelFilter::DEBUG
        );
        assert_eq!(filter.level_for("easytier"), LevelFilter::WARN);
        assert_eq!(filter.level_for("openbitfun_link"), LevelFilter::ERROR);
        assert_eq!(filter.max, LevelFilter::DEBUG);
        // A bare level replaces the default.
        let everything = Filter::parse(DEFAULT_FILTER, Some("debug,openbitfun_link=trace"));
        assert_eq!(everything.level_for("quinn"), LevelFilter::DEBUG);
        assert_eq!(
            everything.level_for("openbitfun_mobile_native"),
            LevelFilter::DEBUG
        );
        assert_eq!(
            everything.level_for("openbitfun_link::node"),
            LevelFilter::TRACE
        );
        let quiet = Filter::parse(DEFAULT_FILTER, Some("off"));
        assert_eq!(quiet.level_for("openbitfun_link"), LevelFilter::OFF);
    }

    #[test]
    fn secret_fields_are_redacted() {
        assert!(secret_field("network_secret"));
        assert!(secret_field("access_token"));
        assert!(secret_field("Authorization"));
        assert!(!secret_field("peer_id"));
        assert!(!secret_field("network_name"));
    }
}
