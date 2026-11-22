//! The EasyTier fork never prints the account network's secret
//! (`third_party/easytier/OPENBITFUN-PATCH.md`, "Secrets never reach a log line").

use easytier_core::config::NetworkIdentity;

#[test]
fn network_identity_debug_never_prints_the_secret() {
    let identity = NetworkIdentity::new("obf-net".into(), "s3cr3t-value-xyz".into());
    let printed = format!("{identity:?}");
    assert!(printed.contains("obf-net"));
    assert!(!printed.contains("s3cr3t-value-xyz"));
    let toml: easytier_core::config::toml::NetworkIdentity = identity.into();
    assert!(!format!("{toml:?}").contains("s3cr3t-value-xyz"));
}
