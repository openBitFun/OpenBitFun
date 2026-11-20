fn main() {
    // Keep the shared screen-capture provider optional on macOS older than
    // ScreenCaptureKit (applies to the backend dylib the native runner loads).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
    println!("cargo:rerun-if-env-changed=OPENBITFUN_UPDATER_PRIMARY_ENDPOINT");
    println!("cargo:rerun-if-env-changed=OPENBITFUN_UPDATER_FALLBACK_ENDPOINT");
}
