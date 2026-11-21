//! The web UI bundle a device ships, as browsers load it from the device
//! (`docs/architecture/unified-client-architecture.md`, "Browsers load the
//! web UI from the device").
//!
//! Every web package (`nsh package src/nsh-ui --target web`, the desktop's
//! `nsh-web` resources, the CLI's embedded copy) carries `ui-bundle.json`
//! (schema 1), written at build time by `scripts/write-ui-bundle-manifest.mjs`:
//!
//! ```json
//! { "schema": 1, "product": "openbitfun", "version": "1.0.11", "nsh": "0.6.1",
//!   "entry": "index.html",
//!   "files": [ { "path": "index.html", "sha256": "<hex>", "size": 2892,
//!                "br": { "sha256": "<hex of the .br bytes>", "size": 1200 } } ] }
//! ```
//!
//! `files` lists every runtime file except the `.br`/`.gz` siblings, sorted by
//! path (UTF-16 code unit order, as JavaScript sorts); paths are POSIX and
//! relative with no `.`/`..`/empty segments. The **bundle id** is the
//! lowercase hex SHA-256 of the canonical manifest bytes ([`canonical_json`]:
//! keys sorted, no whitespace, UTF-8, integers only). Every party recomputes
//! it; a stated id is never trusted. The JavaScript twin is
//! `scripts/write-ui-bundle-manifest.mjs`; both are checked against the same
//! fixture (`ui_bundle_fixture.json`).
//!
//! A host answers `ui_bundle_manifest` with [`UiBundleSource::manifest_response`]
//! (over the end-to-end channel, so the device key authenticates it) and
//! serves the files by hash to the server's pool on the mesh listener
//! (`GET /obp-ui/v1/<sha256>`, `server::ui_fetch`). Only files whose bytes
//! match the manifest are ever served.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde_json::{json, Map, Value};

use crate::sha256_hex;

/// The manifest's file name in a web package.
pub const MANIFEST_FILE: &str = "ui-bundle.json";
/// The manifest schema this crate reads and writes.
pub const MANIFEST_SCHEMA: u64 = 1;
/// The error prefix of a host that cannot hand out its web UI.
pub const UNAVAILABLE: &str = "ui_bundle_unavailable";
/// The request path prefix of the by-hash fetch on the mesh listener.
pub const FETCH_PATH_PREFIX: &str = "/obp-ui/v1/";
/// The longest path a manifest may list.
const MAX_PATH_LEN: usize = 1024;
/// The largest integer both JavaScript and Rust represent exactly.
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

fn unavailable(reason: impl std::fmt::Display) -> String {
    format!("{UNAVAILABLE}: {reason}")
}

/// The canonical JSON text of `value`: object keys sorted by UTF-16 code
/// units (JavaScript's default sort), no whitespace, strings escaped as
/// `JSON.stringify` escapes them, numbers only as safe integers.
pub fn canonical_json(value: &Value) -> Result<String, String> {
    let mut out = String::new();
    write_canonical(value, &mut out)?;
    Ok(out)
}

fn write_canonical(value: &Value, out: &mut String) -> Result<(), String> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&canonical_number(number)?),
        Value::String(text) => write_string(text, out),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out)?;
            }
            out.push(']');
        }
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_canonical(&object[key], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn canonical_number(number: &serde_json::Number) -> Result<String, String> {
    if let Some(value) = number.as_i64() {
        if value.unsigned_abs() <= MAX_SAFE_INTEGER as u64 {
            return Ok(value.to_string());
        }
    } else if number.as_u64().is_none() {
        if let Some(value) = number.as_f64() {
            // `1.0` is the integer 1 in JavaScript.
            if value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER as f64 {
                return Ok((value as i64).to_string());
            }
        }
    }
    Err(format!(
        "number {number} is not a safe integer; manifests carry integers only"
    ))
}

/// `JSON.stringify` of a string: `"` and `\` escaped, `\b \f \n \r \t`, other
/// control characters as lowercase `\u00xx`, everything else verbatim.
fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out.push('"');
}

/// The bundle id of a manifest: SHA-256 of its canonical bytes.
pub fn bundle_id(manifest: &Value) -> Result<String, String> {
    Ok(sha256_hex(canonical_json(manifest)?.as_bytes()))
}

/// Whether `text` is a lowercase hex SHA-256.
pub fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Whether `path` is a valid manifest path: POSIX, relative, no empty, `.`
/// or `..` segment, no backslash, colon or control character.
pub fn is_valid_bundle_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_PATH_LEN
        && !path
            .chars()
            .any(|ch| ch == '\\' || ch == ':' || (ch as u32) < 0x20 || ch == '\u{7f}')
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// A compressed sibling of a manifest file (`<path>.br`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressedFile {
    pub sha256: String,
    pub size: u64,
}

/// One file of the bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub br: Option<CompressedFile>,
}

/// A parsed and validated manifest. `value` is the manifest exactly as read
/// (unknown fields included: they are part of the bundle id).
#[derive(Debug, Clone)]
pub struct Manifest {
    pub value: Value,
    pub bundle_id: String,
    pub product: String,
    pub version: String,
    pub entry: String,
    pub files: Vec<ManifestFile>,
}

fn field<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a Value, String> {
    object
        .get(key)
        .ok_or_else(|| format!("the manifest has no `{key}`"))
}

fn text_field(object: &Map<String, Value>, key: &str) -> Result<String, String> {
    field(object, key)?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("`{key}` is not a string"))
}

fn hash_and_size(object: &Map<String, Value>, what: &str) -> Result<(String, u64), String> {
    let sha256 = object
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|hash| is_sha256_hex(hash))
        .ok_or_else(|| format!("{what} has no lowercase hex `sha256`"))?;
    let size = object
        .get("size")
        .and_then(Value::as_u64)
        .filter(|size| *size <= MAX_SAFE_INTEGER as u64)
        .ok_or_else(|| format!("{what} has no integer `size`"))?;
    Ok((sha256.to_string(), size))
}

impl Manifest {
    /// Parses and validates manifest bytes. Unknown fields are kept and
    /// ignored; a schema newer than this crate reads is refused.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let value: Value = serde_json::from_slice(bytes)
            .map_err(|error| format!("the manifest is not JSON: {error}"))?;
        Self::from_value(value)
    }

    pub fn from_value(value: Value) -> Result<Self, String> {
        let object = value
            .as_object()
            .ok_or_else(|| "the manifest is not a JSON object".to_string())?;
        let schema = field(object, "schema")?
            .as_u64()
            .ok_or_else(|| "`schema` is not an integer".to_string())?;
        if schema != MANIFEST_SCHEMA {
            return Err(format!(
                "manifest schema {schema} is not supported (this build reads schema {MANIFEST_SCHEMA})"
            ));
        }
        let product = text_field(object, "product")?;
        let version = text_field(object, "version")?;
        let entry = text_field(object, "entry")?;
        let listed = field(object, "files")?
            .as_array()
            .ok_or_else(|| "`files` is not an array".to_string())?;
        let mut files = Vec::with_capacity(listed.len());
        for item in listed {
            let item = item
                .as_object()
                .ok_or_else(|| "a `files` entry is not an object".to_string())?;
            let path = item
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "a `files` entry has no `path`".to_string())?;
            if !is_valid_bundle_path(path) {
                return Err(format!("invalid file path {path:?}"));
            }
            let (sha256, size) = hash_and_size(item, &format!("file {path}"))?;
            let br = match item.get("br") {
                None | Some(Value::Null) => None,
                Some(Value::Object(br)) => {
                    let (sha256, size) = hash_and_size(br, &format!("file {path}.br"))?;
                    Some(CompressedFile { sha256, size })
                }
                Some(_) => return Err(format!("file {path}: `br` is not an object")),
            };
            files.push(ManifestFile {
                path: path.to_string(),
                sha256,
                size,
                br,
            });
        }
        for pair in files.windows(2) {
            if pair[0].path.encode_utf16().cmp(pair[1].path.encode_utf16())
                != std::cmp::Ordering::Less
            {
                return Err(format!(
                    "`files` is not sorted by path or lists {:?} twice",
                    pair[1].path
                ));
            }
        }
        if !files.iter().any(|file| file.path == entry) {
            return Err(format!("the entry {entry:?} is not one of the files"));
        }
        let bundle_id = bundle_id(&value)?;
        Ok(Self {
            value,
            bundle_id,
            product,
            version,
            entry,
            files,
        })
    }
}

/// How a served file is encoded on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileEncoding {
    /// The file itself (no `Content-Encoding`).
    Identity,
    /// Its `.br` sibling (`Content-Encoding: br`).
    Brotli,
}

/// File bytes found by hash, already checked against it.
#[derive(Debug)]
pub struct UiFile {
    pub bytes: Cow<'static, [u8]>,
    pub encoding: FileEncoding,
}

enum Store {
    Directory(PathBuf),
    Embedded(HashMap<&'static str, &'static [u8]>),
}

/// A verified bundle: its manifest, and every listed file (and `.br`
/// sibling) found by hash.
pub struct UiBundle {
    manifest: Manifest,
    by_hash: HashMap<String, (String, FileEncoding)>,
    store: Store,
}

impl std::fmt::Debug for UiBundle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("UiBundle")
            .field("bundle_id", &self.manifest.bundle_id)
            .field("files", &self.manifest.files.len())
            .finish()
    }
}

/// The on-disk name of a file (`.br` sibling included) under the bundle.
fn stored_name(path: &str, encoding: FileEncoding) -> Cow<'_, str> {
    match encoding {
        FileEncoding::Identity => Cow::Borrowed(path),
        FileEncoding::Brotli => Cow::Owned(format!("{path}.br")),
    }
}

/// `path` under `root`, refusing anything that leaves it (symlinks included).
fn resolve_under(root: &Path, path: &str) -> Option<PathBuf> {
    let mut target = root.to_path_buf();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => target.push(part),
            _ => return None,
        }
    }
    let canonical = target.canonicalize().ok()?;
    (canonical.starts_with(root) && canonical.is_file()).then_some(canonical)
}

impl UiBundle {
    fn index(manifest: &Manifest) -> HashMap<String, (String, FileEncoding)> {
        let mut by_hash = HashMap::new();
        for file in &manifest.files {
            by_hash
                .entry(file.sha256.clone())
                .or_insert_with(|| (file.path.clone(), FileEncoding::Identity));
            if let Some(br) = &file.br {
                by_hash
                    .entry(br.sha256.clone())
                    .or_insert_with(|| (file.path.clone(), FileEncoding::Brotli));
            }
        }
        by_hash
    }

    fn checked(manifest: Manifest, store: Store) -> Result<Self, String> {
        let bundle = Self {
            by_hash: Self::index(&manifest),
            manifest,
            store,
        };
        for file in &bundle.manifest.files {
            let mut expected = vec![(FileEncoding::Identity, &file.sha256, file.size)];
            if let Some(br) = &file.br {
                expected.push((FileEncoding::Brotli, &br.sha256, br.size));
            }
            for (encoding, sha256, size) in expected {
                let name = stored_name(&file.path, encoding);
                let bytes = bundle
                    .raw(&file.path, encoding)
                    .ok_or_else(|| format!("the bundle is missing {name}"))?;
                if bytes.len() as u64 != size || sha256_hex(&bytes) != *sha256 {
                    return Err(format!("{name} does not match the manifest"));
                }
            }
        }
        Ok(bundle)
    }

    /// Loads the bundle under `root` and checks every listed file against
    /// the manifest (a stale or damaged package is unavailable, never served).
    pub fn load_dir(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|error| format!("the web UI directory is unreadable: {error}"))?;
        let bytes = std::fs::read(root.join(MANIFEST_FILE)).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!("the web UI bundle has no {MANIFEST_FILE}; rebuild the package")
            } else {
                format!("{MANIFEST_FILE} is unreadable: {error}")
            }
        })?;
        let manifest = Manifest::parse(&bytes)?;
        Self::checked(manifest, Store::Directory(root))
    }

    /// A bundle compiled into the executable (the CLI): the manifest bytes
    /// and every file and `.br` sibling by path.
    pub fn from_embedded(
        manifest: &[u8],
        files: &'static [(&'static str, &'static [u8])],
    ) -> Result<Self, String> {
        let manifest = Manifest::parse(manifest)?;
        Self::checked(manifest, Store::Embedded(files.iter().copied().collect()))
    }

    fn raw(&self, path: &str, encoding: FileEncoding) -> Option<Cow<'static, [u8]>> {
        let name = stored_name(path, encoding);
        match &self.store {
            Store::Directory(root) => {
                let file = resolve_under(root, &name)?;
                std::fs::read(file).ok().map(Cow::Owned)
            }
            Store::Embedded(files) => files.get(name.as_ref()).map(|bytes| Cow::Borrowed(*bytes)),
        }
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn bundle_id(&self) -> &str {
        &self.manifest.bundle_id
    }

    /// `{manifest, bundleId}`: the answer of `ui_bundle_manifest`.
    pub fn response(&self) -> Value {
        json!({ "manifest": self.manifest.value, "bundleId": self.manifest.bundle_id })
    }

    /// The bytes whose SHA-256 is `sha256`: a listed file, or a listed
    /// file's `.br` sibling. `None` for any other hash, and for bytes on disk
    /// that no longer match (re-checked on every read).
    pub fn read(&self, sha256: &str) -> Option<UiFile> {
        let (path, encoding) = self.by_hash.get(sha256)?;
        let bytes = self.raw(path, *encoding)?;
        if sha256_hex(&bytes) != sha256 {
            log::warn!(
                "Web UI bundle file changed on disk; not served: path={}",
                stored_name(path, *encoding)
            );
            return None;
        }
        Some(UiFile {
            bytes,
            encoding: *encoding,
        })
    }
}

/// What a directory source last loaded, and the manifest file it came from.
struct Loaded {
    stamp: Option<(SystemTime, u64)>,
    bundle: Result<Arc<UiBundle>, String>,
}

enum SourceKind {
    Directory(PathBuf),
    Fixed(Result<Arc<UiBundle>, String>),
}

/// Where a host's web UI bundle comes from: a directory (reloaded when its
/// manifest changes), a bundle compiled in, or none (with the reason).
pub struct UiBundleSource {
    kind: SourceKind,
    loaded: Mutex<Option<Loaded>>,
}

impl std::fmt::Debug for UiBundleSource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.kind {
            SourceKind::Directory(root) => formatter
                .debug_tuple("UiBundleSource::Directory")
                .field(root)
                .finish(),
            SourceKind::Fixed(bundle) => formatter
                .debug_tuple("UiBundleSource::Fixed")
                .field(&bundle.as_ref().map(|bundle| bundle.bundle_id().to_string()))
                .finish(),
        }
    }
}

impl UiBundleSource {
    /// The bundle under `root` (`ui-bundle.json` and its files).
    pub fn directory(root: PathBuf) -> Self {
        Self {
            kind: SourceKind::Directory(root),
            loaded: Mutex::new(None),
        }
    }

    /// A bundle compiled into the executable.
    pub fn embedded(manifest: &[u8], files: &'static [(&'static str, &'static [u8])]) -> Self {
        let bundle = UiBundle::from_embedded(manifest, files)
            .map(Arc::new)
            .map_err(|reason| {
                unavailable(format!("the built-in web UI bundle is invalid: {reason}"))
            });
        Self {
            kind: SourceKind::Fixed(bundle),
            loaded: Mutex::new(None),
        }
    }

    /// No bundle on this host; `reason` says why (and what to do).
    pub fn unavailable(reason: impl std::fmt::Display) -> Self {
        Self {
            kind: SourceKind::Fixed(Err(unavailable(reason))),
            loaded: Mutex::new(None),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Loaded>> {
        self.loaded
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The current bundle, or `ui_bundle_unavailable: <reason>`. A directory
    /// source re-reads its manifest when the file changed; loading hashes
    /// every file, so call this off the async workers.
    pub fn current(&self) -> Result<Arc<UiBundle>, String> {
        let root = match &self.kind {
            SourceKind::Fixed(bundle) => return bundle.clone(),
            SourceKind::Directory(root) => root,
        };
        let stamp = std::fs::metadata(root.join(MANIFEST_FILE))
            .ok()
            .map(|meta| {
                (
                    meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    meta.len(),
                )
            });
        let mut loaded = self.lock();
        if let Some(current) = loaded.as_ref() {
            if current.stamp == stamp {
                return current.bundle.clone();
            }
        }
        let bundle = UiBundle::load_dir(root).map(Arc::new).map_err(unavailable);
        match &bundle {
            Ok(bundle) => log::info!(
                "Web UI bundle loaded: bundle_id={}, files={}",
                bundle.bundle_id(),
                bundle.manifest().files.len()
            ),
            Err(reason) => log::info!("Web UI bundle unavailable: {}", reason),
        }
        *loaded = Some(Loaded {
            stamp,
            bundle: bundle.clone(),
        });
        bundle
    }

    /// The bundle id last loaded, without loading (the `hello` hint).
    pub fn cached_bundle_id(&self) -> Option<String> {
        match &self.kind {
            SourceKind::Fixed(bundle) => bundle.as_ref().ok().map(|b| b.bundle_id().to_string()),
            SourceKind::Directory(_) => self
                .lock()
                .as_ref()
                .and_then(|loaded| loaded.bundle.as_ref().ok())
                .map(|bundle| bundle.bundle_id().to_string()),
        }
    }

    /// The answer of `ui_bundle_manifest`: `{manifest, bundleId}`, or
    /// `ui_bundle_unavailable: <reason>`.
    pub fn manifest_response(&self) -> Result<Value, String> {
        self.current().map(|bundle| bundle.response())
    }
}

#[cfg(test)]
#[path = "ui_bundle_tests.rs"]
pub(crate) mod tests;
