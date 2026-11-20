//! OpenBitFun fork: the upstream Windows thunk/DLL link setup (TUN, WinDivert)
//! and the `git log` version suffix are removed; see ../OPENBITFUN-PATCH.md.
use cfg_aliases::cfg_aliases;

fn check_locale() {
    let workdir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| "./".to_string());
    let locale_path = format!("{workdir}/locales/**/*");
    if let Ok(globs) = globwalk::glob(locale_path) {
        for entry in globs.flatten() {
            println!("cargo:rerun-if-changed={}", entry.into_path().display());
        }
    }
}

fn main() {
    cfg_aliases! {
        mobile: {
            any(
                target_os = "android",
                target_os = "ios",
                target_env = "ohos"
            )
        }
    }
    check_locale();
    println!("cargo:rustc-env=EASYTIER_COMMIT_DATE=-openbitfun");
    println!("cargo:rerun-if-changed=build/main.rs");
}
