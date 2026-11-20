//! HTTP side of the listeners: the WebSocket upgrade at `/obp`, LAN pairing,
//! the owner launch link, and the NSH web bundle at `/`.
//!
//! The mesh listener (`mesh.rs`) mounts the same routes for phones and
//! browsers that joined the account mesh with the EasyTier app
//! (`ListenerKind::Mesh`): they pair with a one-time QR code exactly as on
//! the LAN and get the `paired-client` scope. An upgrade that carries the
//! account-device handshake (`Authorization: ObpMesh …`) goes to the
//! device-to-device path instead.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use super::connection::{self, ConnectionContext};
use super::scope::Scope;
use super::store::secrets_equal;
use super::{ObpServer, OBP_PROTOCOL_VERSION};

/// Largest inbound message (a call carrying an attachment).
const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;

/// The page's Content-Security-Policy. NSH's web runtime needs
/// `script-src 'self' 'wasm-unsafe-eval'` and `img-src 'self' blob: data:`.
pub(crate) const CONTENT_SECURITY_POLICY: &str =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; \
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; \
connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; \
base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ListenerKind {
    Loopback {
        port: u16,
    },
    Lan {
        port: u16,
    },
    /// The account-mesh listener, reached on this device's mesh virtual IP.
    Mesh {
        port: u16,
    },
}

impl ListenerKind {
    fn scheme(self) -> &'static str {
        match self {
            Self::Loopback { .. } => "http",
            Self::Lan { .. } | Self::Mesh { .. } => "https",
        }
    }

    fn cookie_name(self) -> String {
        match self {
            Self::Loopback { port } => format!("obf_owner_{port}"),
            Self::Lan { port } => format!("obf_client_{port}"),
            Self::Mesh { port } => format!("obf_mesh_client_{port}"),
        }
    }

    /// Listeners where phones and browsers pair with a QR code.
    fn pairs_clients(self) -> bool {
        matches!(self, Self::Lan { .. } | Self::Mesh { .. })
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::Loopback { .. } => "loopback",
            Self::Lan { .. } => "lan",
            Self::Mesh { .. } => "mesh",
        }
    }
}

#[derive(Clone)]
struct ListenerState {
    server: Arc<ObpServer>,
    kind: ListenerKind,
}

pub(crate) fn router(server: Arc<ObpServer>, kind: ListenerKind) -> Router {
    let mut router = Router::new()
        .route("/obp", get(upgrade))
        .route("/obp/session", get(session))
        .route("/obp/pair", post(pair_json))
        .route("/pair", get(pair_browser));
    if matches!(kind, ListenerKind::Mesh { .. }) {
        router = router.route("/obp/mesh/info", get(mesh_info));
    }
    router
        .fallback(get(static_files))
        .layer(axum::middleware::map_response(security_headers))
        .with_state(ListenerState { server, kind })
}

async fn security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        "cross-origin-opener-policy",
        HeaderValue::from_static("same-origin"),
    );
    response
}

fn problem(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
        .into_response()
}

fn page(status: StatusCode, title: &str, message: &str) -> Response {
    let escape = |text: &str| {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{}</title></head><body style=\"font-family: system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5\"><h1 style=\"font-size: 1.25rem\">{}</h1><p>{}</p></body></html>",
        escape(title),
        escape(title),
        escape(message)
    );
    let mut response = (status, html).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn header_str<'a>(headers: &'a HeaderMap, name: header::HeaderName) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

impl ListenerState {
    /// Loopback answers only to loopback host names (DNS rebinding guard).
    fn check_host(&self, headers: &HeaderMap) -> Result<(), Response> {
        let ListenerKind::Loopback { port } = self.kind else {
            return Ok(());
        };
        let host = header_str(headers, header::HOST).unwrap_or_default();
        let allowed = [
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
            format!("[::1]:{port}"),
        ];
        if allowed
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(host))
        {
            Ok(())
        } else {
            log::warn!(
                "OBP loopback request with a foreign Host refused: host={}",
                host
            );
            Err(problem(
                StatusCode::MISDIRECTED_REQUEST,
                "bad_host",
                "this listener only answers to 127.0.0.1 or localhost",
            ))
        }
    }

    /// A browser request must come from this listener's own origin.
    fn check_origin(&self, headers: &HeaderMap) -> Result<(), Response> {
        let Some(origin) = header_str(headers, header::ORIGIN) else {
            // Non-browser clients send no Origin; they authenticate by header.
            return Ok(());
        };
        let host = header_str(headers, header::HOST).unwrap_or_default();
        let expected = format!("{}://{}", self.kind.scheme(), host);
        if origin.eq_ignore_ascii_case(&expected) {
            Ok(())
        } else {
            log::warn!(
                "OBP request from a foreign origin refused: origin={}, expected={}",
                origin,
                expected
            );
            Err(problem(
                StatusCode::FORBIDDEN,
                "bad_origin",
                "cross-origin requests are refused",
            ))
        }
    }

    fn presented_secret(&self, headers: &HeaderMap) -> Option<String> {
        if let Some(bearer) = header_str(headers, header::AUTHORIZATION)
            .and_then(|value| value.strip_prefix("Bearer "))
        {
            return Some(bearer.trim().to_string());
        }
        let name = self.kind.cookie_name();
        headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(';'))
            .filter_map(|pair| pair.trim().split_once('='))
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.to_string())
    }

    /// The scope a request's credentials grant on this listener.
    fn authenticate(&self, headers: &HeaderMap) -> Option<Scope> {
        let secret = self.presented_secret(headers)?;
        match self.kind {
            ListenerKind::Loopback { .. } => {
                secrets_equal(&secret, &self.server.owner_token()).then_some(Scope::Owner)
            }
            ListenerKind::Lan { .. } | ListenerKind::Mesh { .. } => {
                let store = super::lock(&self.server.store);
                store
                    .client_for_credential(&secret)
                    .map(|client| Scope::PairedClient {
                        client_id: client.id.clone(),
                    })
            }
        }
    }

    fn session_cookie(&self, secret: &str) -> HeaderValue {
        let secure = match self.kind {
            ListenerKind::Lan { .. } | ListenerKind::Mesh { .. } => "; Secure; Max-Age=31536000",
            ListenerKind::Loopback { .. } => "",
        };
        let cookie = format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax{}",
            self.kind.cookie_name(),
            secret,
            secure
        );
        HeaderValue::from_str(&cookie).unwrap_or_else(|_| HeaderValue::from_static(""))
    }

    /// The certificate fingerprint a pairing client pins on this listener.
    fn fingerprint(&self) -> Option<String> {
        match self.kind {
            ListenerKind::Lan { .. } => super::lock(&self.server.lan_fingerprint).clone(),
            ListenerKind::Mesh { .. } => self.server.mesh_fingerprint(),
            ListenerKind::Loopback { .. } => None,
        }
    }
}

/// `/obp/mesh/info` on the mesh listener.
async fn mesh_info(State(state): State<ListenerState>) -> Response {
    super::mesh::mesh_info_response(&state.server)
}

/// True when an upgrade carries the account-device handshake.
fn is_account_device_upgrade(headers: &HeaderMap) -> bool {
    header_str(headers, header::AUTHORIZATION).is_some_and(|value| {
        value
            .trim_start()
            .starts_with(openbitfun_mesh_service::handshake::AUTH_SCHEME)
    })
}

async fn upgrade(
    State(state): State<ListenerState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if matches!(state.kind, ListenerKind::Mesh { .. }) && is_account_device_upgrade(&headers) {
        return super::mesh::account_device_upgrade(Arc::clone(&state.server), headers, upgrade)
            .await;
    }
    if let Err(response) = state.check_host(&headers) {
        return response;
    }
    if let Err(response) = state.check_origin(&headers) {
        return response;
    }
    let Some(scope) = state.authenticate(&headers) else {
        return problem(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            match state.kind {
                ListenerKind::Loopback { .. } => {
                    "open this page from OpenBitFun (Devices > Open in browser) to get a session"
                }
                ListenerKind::Lan { .. } | ListenerKind::Mesh { .. } => {
                    "pair this device by scanning the QR code in OpenBitFun Devices"
                }
            },
        );
    };
    let server = Arc::clone(&state.server);
    let (id, stop) = server.register_connection_via(
        scope.clone(),
        matches!(state.kind, ListenerKind::Mesh { .. }),
    );
    let context = ConnectionContext {
        backend: Arc::clone(&server.backend),
        scope,
        instance_id: server.instance_id.clone(),
        registry_digest: server.registry_digest.clone(),
        limits: server.options.limits.clone(),
        stop,
    };
    upgrade
        .max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| async move {
            connection::serve(socket, context).await;
            server.unregister_connection(id);
        })
}

/// Whether this browser holds a session, so a client can explain a refused
/// upgrade (browsers hide the upgrade response).
async fn session(State(state): State<ListenerState>, headers: HeaderMap) -> Response {
    if let Err(response) = state.check_host(&headers) {
        return response;
    }
    if let Err(response) = state.check_origin(&headers) {
        return response;
    }
    let scope = state.authenticate(&headers);
    let mut response = Json(serde_json::json!({
        "protocol": OBP_PROTOCOL_VERSION,
        "authorized": scope.is_some(),
        "scope": scope.as_ref().map(Scope::wire_name),
        "listener": state.kind.wire_name(),
    }))
    .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Debug, Deserialize)]
struct PairQuery {
    code: Option<String>,
    name: Option<String>,
}

fn device_name_from_agent(headers: &HeaderMap) -> Option<String> {
    let agent = header_str(headers, header::USER_AGENT)?;
    let device = [
        ("iPhone", "iPhone"),
        ("iPad", "iPad"),
        ("Android", "Android device"),
        ("Macintosh", "Mac"),
        ("Windows", "Windows PC"),
        ("Linux", "Linux PC"),
    ]
    .into_iter()
    .find(|(needle, _)| agent.contains(needle))
    .map(|(_, name)| name)?;
    Some(format!("{device} browser"))
}

async fn pair_browser(
    State(state): State<ListenerState>,
    headers: HeaderMap,
    Query(query): Query<PairQuery>,
) -> Response {
    if !state.kind.pairs_clients() {
        return page(
            StatusCode::NOT_FOUND,
            "Not found",
            "Pairing happens on the LAN or device-mesh address.",
        );
    }
    let Some(code) = query.code.filter(|code| !code.is_empty()) else {
        return page(
            StatusCode::BAD_REQUEST,
            "Pairing code missing",
            "Scan the QR code shown in OpenBitFun Devices to pair this device.",
        );
    };
    let name = query.name.or_else(|| device_name_from_agent(&headers));
    let issued = super::lock(&state.server.store).redeem_code(&code, name);
    match issued {
        Ok(issued) => {
            log::info!(
                "OBP client paired from a browser: client_id={}, listener={}",
                issued.client_id,
                state.kind.wire_name()
            );
            let mut response = (StatusCode::SEE_OTHER, "").into_response();
            response
                .headers_mut()
                .insert(header::LOCATION, HeaderValue::from_static("/"));
            response
                .headers_mut()
                .insert(header::SET_COOKIE, state.session_cookie(&issued.credential));
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(message) => page(StatusCode::FORBIDDEN, "Pairing failed", &message),
    }
}

#[derive(Debug, Deserialize)]
struct PairRequest {
    code: String,
    #[serde(default)]
    name: Option<String>,
}

/// Pairing for native clients: the credential goes into `Authorization: Bearer`.
async fn pair_json(
    State(state): State<ListenerState>,
    headers: HeaderMap,
    Json(request): Json<PairRequest>,
) -> Response {
    if !state.kind.pairs_clients() {
        return problem(
            StatusCode::NOT_FOUND,
            "not_found",
            "pairing happens on the LAN or device-mesh listener",
        );
    }
    if let Err(response) = state.check_origin(&headers) {
        return response;
    }
    let issued = super::lock(&state.server.store).redeem_code(&request.code, request.name);
    match issued {
        Ok(issued) => {
            log::info!(
                "OBP client paired: client_id={}, listener={}",
                issued.client_id,
                state.kind.wire_name()
            );
            let fingerprint = state.fingerprint();
            Json(serde_json::json!({
                "clientId": issued.client_id,
                "credential": issued.credential,
                "scope": "paired-client",
                "fingerprint": fingerprint,
                "protocol": OBP_PROTOCOL_VERSION,
            }))
            .into_response()
        }
        Err(message) => problem(StatusCode::FORBIDDEN, "pairing_failed", &message),
    }
}

#[derive(Debug, Deserialize)]
struct PageQuery {
    token: Option<String>,
}

/// The `#nsh-params` the page hands the app: where the protocol is. `url`
/// is the absolute WebSocket address the browser reached this page at.
fn params_script(url: Option<&str>) -> String {
    let params = serde_json::json!({
        "obp": { "path": "/obp", "url": url, "protocol": OBP_PROTOCOL_VERSION }
    });
    // `<` cannot occur in a script's JSON text without ending it early.
    let json = params.to_string().replace('<', "\\u003c");
    format!("<script type=\"application/json\" id=\"nsh-params\">{json}</script>")
}

/// `index.html` with the protocol parameters injected.
pub(crate) fn inject_params(index: &str, url: Option<&str>) -> String {
    let script = params_script(url);
    match index.find("</head>") {
        Some(at) => format!("{}{}\n{}", &index[..at], script, &index[at..]),
        None => format!("{script}\n{index}"),
    }
}

fn is_content_hashed(name: &str) -> bool {
    // `app.ab404372c0.js`, `nsh.9823aa2de8.wasm`, `browser.bb691213db/…`
    name.split('.').any(|part| {
        part.len() == 10
            && part
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    })
}

/// The file under `root` a request path names, refusing anything outside it.
fn resolve(root: &Path, path: &str) -> Option<PathBuf> {
    let relative = path.trim_start_matches('/');
    let decoded = urlencoding::decode(relative).ok()?;
    let mut target = root.to_path_buf();
    for component in Path::new(decoded.as_ref()).components() {
        match component {
            Component::Normal(part) => target.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    let canonical = target.canonicalize().ok()?;
    (canonical.starts_with(root) && canonical.is_file()).then_some(canonical)
}

async fn static_files(
    State(state): State<ListenerState>,
    headers: HeaderMap,
    uri: Uri,
    Query(query): Query<PageQuery>,
) -> Response {
    if let Err(response) = state.check_host(&headers) {
        return response;
    }
    // The owner launch link: trade the token for a session cookie, then drop
    // it from the address bar.
    if let (ListenerKind::Loopback { .. }, Some(token)) = (state.kind, query.token.as_deref()) {
        if !secrets_equal(token, &state.server.owner_token()) {
            return page(
                StatusCode::FORBIDDEN,
                "This link has expired",
                "Open the browser again from OpenBitFun (Devices > Open in browser); each launch issues a new link.",
            );
        }
        let mut response = (StatusCode::SEE_OTHER, "").into_response();
        let headers = response.headers_mut();
        headers.insert(header::LOCATION, HeaderValue::from_static("/"));
        headers.insert(header::SET_COOKIE, state.session_cookie(token));
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return response;
    }
    let Some(root) = state.server.web_root() else {
        return page(
            StatusCode::SERVICE_UNAVAILABLE,
            "The web UI is not bundled with this build",
            "This OpenBitFun backend is running, but it has no web UI bundle to serve. Build it with `pnpm run desktop-nsh:web` (development) or install a package that includes it.",
        );
    };
    let path = uri.path();
    if path == "/" || path == "/index.html" {
        return match tokio::fs::read_to_string(root.join("index.html")).await {
            Ok(index) => {
                let url = header_str(&headers, header::HOST).map(|host| {
                    let scheme = match state.kind {
                        ListenerKind::Loopback { .. } => "ws",
                        ListenerKind::Lan { .. } | ListenerKind::Mesh { .. } => "wss",
                    };
                    format!("{scheme}://{host}/obp")
                });
                let mut response = inject_params(&index, url.as_deref()).into_response();
                let headers = response.headers_mut();
                headers.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/html; charset=utf-8"),
                );
                headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
                response
            }
            Err(error) => page(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The web UI could not be read",
                &error.to_string(),
            ),
        };
    }
    let Some(file) = resolve(root, path) else {
        return page(
            StatusCode::NOT_FOUND,
            "Not found",
            "No such file in the web UI bundle.",
        );
    };
    let accepts = header_str(&headers, header::ACCEPT_ENCODING).unwrap_or_default();
    let mut encoded = None;
    for (token, extension) in [("br", "br"), ("gzip", "gz")] {
        if !accepts
            .split(',')
            .any(|item| item.trim().split(';').next() == Some(token))
        {
            continue;
        }
        let mut candidate = file.clone().into_os_string();
        candidate.push(format!(".{extension}"));
        let candidate = PathBuf::from(candidate);
        if candidate.is_file() {
            encoded = Some((candidate, token));
            break;
        }
    }
    let (source, encoding) = match encoded {
        Some((source, encoding)) => (source, Some(encoding)),
        None => (file.clone(), None),
    };
    let bytes = match tokio::fs::read(&source).await {
        Ok(bytes) => bytes,
        Err(error) => {
            return page(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The file could not be read",
                &error.to_string(),
            )
        }
    };
    let mime = mime_guess::from_path(&file).first_or_octet_stream();
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(mime.essence_str()) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    if let Some(encoding) = encoding {
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static(encoding));
    }
    headers.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    let name = path.rsplit('/').next().unwrap_or_default();
    let hashed = is_content_hashed(name) || path.split('/').any(is_content_hashed);
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if hashed {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        }),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_params_into_the_head() {
        let html = inject_params(
            "<html><head><title>x</title></head><body></body></html>",
            Some("ws://127.0.0.1:1/obp"),
        );
        let start = html.find("id=\"nsh-params\">").unwrap() + "id=\"nsh-params\">".len();
        let end = html[start..].find("</script>").unwrap() + start;
        let params: serde_json::Value = serde_json::from_str(&html[start..end]).unwrap();
        assert_eq!(params["obp"]["url"], "ws://127.0.0.1:1/obp");
        assert_eq!(params["obp"]["protocol"], 1);
        assert!(html[end..].starts_with("</script>\n</head>"));
        // A hostile Host cannot close the script element.
        let html = inject_params("<head></head>", Some("</script><script>x"));
        assert!(!html.contains("</script><script>x"));
    }

    #[test]
    fn resolves_only_inside_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("app.js"), "x").unwrap();
        assert!(resolve(&root, "/app.js").is_some());
        assert!(resolve(&root, "/../etc/passwd").is_none());
        assert!(resolve(&root, "/%2e%2e/etc/passwd").is_none());
        assert!(resolve(&root, "/missing.js").is_none());
    }

    #[test]
    fn hashed_names_are_recognized() {
        assert!(is_content_hashed("app.ab404372c0.js"));
        assert!(is_content_hashed("browser.bb691213db"));
        assert!(!is_content_hashed("manifest.webmanifest"));
    }
}
