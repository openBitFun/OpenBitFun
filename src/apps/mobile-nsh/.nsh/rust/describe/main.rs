//! Describes the app's UI sets for `nsh`: one JSON document on standard
//! output (nsh-core `ui::description`).

fn main() {
    let sets = vec![set_app_openbitfun_mobile_native()];
    println!("{}", nsh_core::element::description::Description::of(&sets).to_json());
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
