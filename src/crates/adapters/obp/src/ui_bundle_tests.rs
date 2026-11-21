//! The manifest, the canonical bundle id (checked against the JavaScript
//! twin's fixture), the path rules, and by-hash reads.

use std::path::Path;

use serde_json::{json, Value};

use super::*;

const FIXTURE: &str = include_str!("ui_bundle_fixture.json");

#[test]
fn canonical_form_and_bundle_id_match_the_javascript_writer() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let manifest = &fixture["manifest"];
    assert_eq!(
        canonical_json(manifest).unwrap(),
        fixture["canonical"].as_str().unwrap()
    );
    assert_eq!(
        bundle_id(manifest).unwrap(),
        fixture["bundleId"].as_str().unwrap()
    );
    let parsed = Manifest::from_value(manifest.clone()).unwrap();
    assert_eq!(parsed.bundle_id, fixture["bundleId"].as_str().unwrap());
    assert_eq!(parsed.files.len(), 4);
    // Key order of the input never matters.
    let reordered: Value = serde_json::from_str(&canonical_json(manifest).unwrap()).unwrap();
    assert_eq!(bundle_id(&reordered).unwrap(), parsed.bundle_id);
}

#[test]
fn canonical_numbers_are_safe_integers_only() {
    assert_eq!(canonical_json(&json!([1.0, -0.0, -7])).unwrap(), "[1,0,-7]");
    assert!(canonical_json(&json!(1.5)).is_err());
    assert!(canonical_json(&json!(9_007_199_254_740_992u64)).is_err());
    assert!(canonical_json(&json!(i64::MIN)).is_err());
    assert_eq!(
        canonical_json(&json!({"b": "\u{1}\u{7f}", "a": "\u{2028}"})).unwrap(),
        "{\"a\":\"\u{2028}\",\"b\":\"\\u0001\u{7f}\"}"
    );
}

#[test]
fn paths_stay_inside_the_bundle() {
    for good in [
        "index.html",
        "a/b.js",
        "browser.b998e17dc5/host.js",
        "é/😀.css",
        "a b/c",
    ] {
        assert!(is_valid_bundle_path(good), "{good}");
    }
    for bad in [
        "",
        "/index.html",
        "a//b",
        "./a",
        "a/./b",
        "../a",
        "a/..",
        "a/../b",
        "a\\b",
        "C:/x",
        "a\u{0}b",
        "a\nb",
        "a\u{7f}",
        "a/",
    ] {
        assert!(!is_valid_bundle_path(bad), "{bad:?}");
    }
    assert!(!is_valid_bundle_path(&"a".repeat(1025)));
}

fn manifest_with(files: Value) -> Value {
    json!({ "schema": 1, "product": "openbitfun", "version": "1.0.0", "nsh": "0.6.1",
            "entry": "index.html", "files": files })
}

fn entry(path: &str) -> Value {
    json!({ "path": path, "sha256": "0".repeat(64), "size": 1 })
}

#[test]
fn invalid_manifests_are_refused_with_the_reason() {
    let cases = [
        (json!({"schema": 2, "files": []}), "schema 2"),
        (json!([]), "not a JSON object"),
        (
            manifest_with(json!([entry("../escape"), entry("index.html")])),
            "invalid file path",
        ),
        (
            manifest_with(json!([entry("index.html"), entry("a.js")])),
            "not sorted",
        ),
        (
            manifest_with(json!([entry("index.html"), entry("index.html")])),
            "twice",
        ),
        (manifest_with(json!([entry("a.js")])), "entry"),
        (
            manifest_with(json!([{ "path": "index.html", "sha256": "A".repeat(64), "size": 1 }])),
            "sha256",
        ),
        (
            manifest_with(json!([{ "path": "index.html", "sha256": "0".repeat(64), "size": 1.5 }])),
            "size",
        ),
        (
            manifest_with(
                json!([{ "path": "index.html", "sha256": "0".repeat(64), "size": 1, "br": { "size": 1 } }]),
            ),
            "index.html.br",
        ),
    ];
    for (manifest, expected) in cases {
        let error = Manifest::from_value(manifest).unwrap_err();
        assert!(
            error.contains(expected),
            "{error} should mention {expected}"
        );
    }
    // Unknown fields are kept (they are part of the id), never refused.
    let mut extra = manifest_with(json!([entry("index.html")]));
    extra["future"] = json!({"x": 1});
    let parsed = Manifest::from_value(extra.clone()).unwrap();
    assert_eq!(parsed.value["future"]["x"], 1);
    assert_ne!(
        parsed.bundle_id,
        Manifest::from_value(manifest_with(json!([entry("index.html")])))
            .unwrap()
            .bundle_id
    );
}

/// Writes a bundle with a manifest the way the packaging scripts do.
pub(crate) fn write_bundle(root: &Path, files: &[(&str, &[u8])]) -> Value {
    let mut listed = Vec::new();
    for (path, bytes) in files {
        let target = root.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, bytes).unwrap();
    }
    let mut paths: Vec<&str> = files
        .iter()
        .map(|(path, _)| *path)
        .filter(|path| {
            !((path.ends_with(".br") || path.ends_with(".gz"))
                && files
                    .iter()
                    .any(|(other, _)| *other == &path[..path.len() - 3]))
        })
        .collect();
    paths.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    for path in paths {
        let bytes = files.iter().find(|(p, _)| *p == path).unwrap().1;
        let mut file = json!({ "path": path, "sha256": sha256_hex(bytes), "size": bytes.len() });
        if let Some((_, br)) = files.iter().find(|(p, _)| *p == format!("{path}.br")) {
            file["br"] = json!({ "sha256": sha256_hex(br), "size": br.len() });
        }
        listed.push(file);
    }
    let manifest = manifest_with(Value::Array(listed));
    std::fs::write(
        root.join(MANIFEST_FILE),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    manifest
}

pub(crate) const INDEX: &[u8] = b"<!doctype html><title>t</title>";
pub(crate) const INDEX_BR: &[u8] = b"brotli bytes of index";
pub(crate) const APP: &[u8] = b"console.log('app')";

#[test]
fn a_directory_bundle_serves_files_and_br_siblings_by_hash_only() {
    let dir = tempfile::tempdir().unwrap();
    write_bundle(
        dir.path(),
        &[
            ("index.html", INDEX),
            ("index.html.br", INDEX_BR),
            ("index.html.gz", b"gz"),
            ("assets/app.js", APP),
        ],
    );
    let source = UiBundleSource::directory(dir.path().to_path_buf());
    assert_eq!(source.cached_bundle_id(), None);
    let response = source.manifest_response().unwrap();
    let bundle = source.current().unwrap();
    assert_eq!(response["bundleId"], bundle.bundle_id());
    assert_eq!(
        bundle_id(&response["manifest"]).unwrap(),
        bundle.bundle_id()
    );
    assert_eq!(
        source.cached_bundle_id().as_deref(),
        Some(bundle.bundle_id())
    );
    let files = response["manifest"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 2, "siblings are not listed: {files:?}");

    let raw = bundle.read(&sha256_hex(INDEX)).unwrap();
    assert_eq!(raw.encoding, FileEncoding::Identity);
    assert_eq!(&*raw.bytes, INDEX);
    let br = bundle.read(&sha256_hex(INDEX_BR)).unwrap();
    assert_eq!(br.encoding, FileEncoding::Brotli);
    assert_eq!(&*br.bytes, INDEX_BR);
    assert_eq!(&*bundle.read(&sha256_hex(APP)).unwrap().bytes, APP);
    // Unknown hashes, the `.gz` sibling and the manifest itself are not served.
    assert!(bundle.read(&"f".repeat(64)).is_none());
    assert!(bundle.read(&sha256_hex(b"gz")).is_none());
    let manifest_bytes = std::fs::read(dir.path().join(MANIFEST_FILE)).unwrap();
    assert!(bundle.read(&sha256_hex(&manifest_bytes)).is_none());

    // A file changed after loading is no longer served.
    std::fs::write(dir.path().join("assets/app.js"), b"tampered").unwrap();
    assert!(bundle.read(&sha256_hex(APP)).is_none());
}

#[test]
fn a_stale_or_missing_bundle_is_an_explicit_unavailable_state() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), INDEX).unwrap();
    let source = UiBundleSource::directory(dir.path().to_path_buf());
    let error = source.manifest_response().unwrap_err();
    assert!(error.starts_with("ui_bundle_unavailable: "), "{error}");
    assert!(error.contains(MANIFEST_FILE), "{error}");

    // The manifest appears: the source picks it up.
    write_bundle(dir.path(), &[("index.html", INDEX)]);
    let first = source.current().unwrap();

    // A file that no longer matches makes the whole bundle unavailable on
    // the next load (here: the manifest is rewritten, so it reloads).
    std::fs::write(dir.path().join("index.html"), b"other").unwrap();
    let manifest = std::fs::read(dir.path().join(MANIFEST_FILE)).unwrap();
    std::fs::write(
        dir.path().join(MANIFEST_FILE),
        [&manifest[..], b"\n"].concat(),
    )
    .unwrap();
    let error = source.current().unwrap_err();
    assert!(
        error.contains("index.html does not match the manifest"),
        "{error}"
    );

    // Rebuilt: a new bundle id.
    write_bundle(dir.path(), &[("index.html", b"other")]);
    let second = source.current().unwrap();
    assert_ne!(first.bundle_id(), second.bundle_id());

    let none = UiBundleSource::unavailable("this build ships no web UI bundle");
    assert_eq!(
        none.manifest_response().unwrap_err(),
        "ui_bundle_unavailable: this build ships no web UI bundle"
    );
    assert_eq!(none.cached_bundle_id(), None);
}

#[cfg(unix)]
#[test]
fn symlinks_out_of_the_bundle_are_not_followed() {
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret"), APP).unwrap();
    let dir = tempfile::tempdir().unwrap();
    write_bundle(dir.path(), &[("index.html", INDEX), ("app.js", APP)]);
    std::fs::remove_file(dir.path().join("app.js")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret"), dir.path().join("app.js")).unwrap();
    let error = UiBundle::load_dir(dir.path()).unwrap_err();
    assert!(error.contains("missing app.js"), "{error}");
}

static EMBEDDED: &[(&str, &[u8])] = &[("index.html", INDEX), ("index.html.br", INDEX_BR)];

#[test]
fn an_embedded_bundle_is_checked_and_served_like_a_directory() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = write_bundle(dir.path(), EMBEDDED);
    let bytes = serde_json::to_vec(&manifest).unwrap();
    let source = UiBundleSource::embedded(&bytes, EMBEDDED);
    let bundle = source.current().unwrap();
    assert_eq!(bundle.bundle_id(), bundle_id(&manifest).unwrap());
    assert_eq!(
        source.cached_bundle_id().as_deref(),
        Some(bundle.bundle_id())
    );
    assert_eq!(
        bundle.read(&sha256_hex(INDEX_BR)).unwrap().encoding,
        FileEncoding::Brotli
    );
    // A manifest that lists bytes the executable does not carry is refused.
    let broken = UiBundleSource::embedded(&bytes, &[("index.html", APP)]);
    let error = broken.manifest_response().unwrap_err();
    assert!(
        error.starts_with("ui_bundle_unavailable: the built-in web UI bundle is invalid"),
        "{error}"
    );
}
