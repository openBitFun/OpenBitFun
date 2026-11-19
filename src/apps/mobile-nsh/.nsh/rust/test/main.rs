//! The app's headless runner (`nsh test`): its test files and the apps
//! they open, with `nsh/base` and the app's Rust components.

fn main() -> std::process::ExitCode {
    nsh_testing::runner(vec![nsh_base::registry(), set_app_openbitfun_mobile_native()], None)
}

/// The UI set of the crate openbitfun-mobile-native: the entry `#[native_module("…")]` makes in it.
fn set_app_openbitfun_mobile_native() -> nsh_core::element::Registry {
    #[allow(unused_imports)]
    use app_openbitfun_mobile_native::*;
    __nsh_native_module() // the crate openbitfun-mobile-native (nsh.json "rust")
}

// Without the entry: nsh's stand-in, which fails the build saying what to add.
#[allow(unused_imports)]
use nsh_core::element::__private::no_native_module as __nsh_native_module;

// The features the app's programs share (`.nsh/rust/hack`).
use workspace_hack as _;
