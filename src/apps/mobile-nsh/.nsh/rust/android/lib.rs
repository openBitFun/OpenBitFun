//! The app's `libnsh.so`: the Android runtime with `nsh/base` and the
//! app's Rust components.

#[cfg(target_os = "android")]
nsh::ui_sets!(vec![nsh_base::registry(), set_app_openbitfun_mobile_native()]);

/// The UI set of the crate openbitfun-mobile-native: the entry `#[native_module("…")]` makes in it.
#[cfg(target_os = "android")]
fn set_app_openbitfun_mobile_native() -> nsh_core::element::Registry {
    #[allow(unused_imports)]
    use app_openbitfun_mobile_native::*;
    __nsh_native_module() // the crate openbitfun-mobile-native (nsh.json "rust")
}

// Without the entry: nsh's stand-in, which fails the build saying what to add.
#[cfg(target_os = "android")]
#[allow(unused_imports)]
use nsh_core::element::__private::no_native_module as __nsh_native_module;
