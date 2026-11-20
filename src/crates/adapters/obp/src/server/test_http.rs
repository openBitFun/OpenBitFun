//! A minimal HTTP/1.1 client for the listener tests (plain and TLS, no
//! redirects, any certificate: the listener's is self-signed), so the crate
//! needs no HTTP client dependency of its own.

use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Default)]
pub(super) struct Client;

impl Client {
    pub(super) fn new() -> Self {
        Self
    }

    pub(super) fn get(&self, url: impl Into<String>) -> RequestBuilder {
        RequestBuilder::new("GET", url.into())
    }

    pub(super) fn post(&self, url: impl Into<String>) -> RequestBuilder {
        RequestBuilder::new("POST", url.into())
    }
}

pub(super) struct RequestBuilder {
    method: &'static str,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
}

impl RequestBuilder {
    fn new(method: &'static str, url: String) -> Self {
        Self {
            method,
            url,
            headers: Vec::new(),
            body: None,
        }
    }

    pub(super) fn header(mut self, name: &str, value: impl AsRef<str>) -> Self {
        self.headers
            .push((name.to_string(), value.as_ref().to_string()));
        self
    }

    pub(super) fn json(mut self, value: &Value) -> Self {
        self.headers
            .push(("content-type".into(), "application/json".into()));
        self.body = Some(value.to_string().into_bytes());
        self
    }

    pub(super) async fn send(self) -> Result<Response, String> {
        let (tls, rest) = if let Some(rest) = self.url.strip_prefix("https://") {
            (true, rest)
        } else if let Some(rest) = self.url.strip_prefix("http://") {
            (false, rest)
        } else {
            return Err(format!("unsupported url {}", self.url));
        };
        let (authority, path) = match rest.find('/') {
            Some(index) => (&rest[..index], &rest[index..]),
            None => (rest, "/"),
        };
        let tcp = tokio::net::TcpStream::connect(authority)
            .await
            .map_err(|error| error.to_string())?;
        let mut request = format!(
            "{} {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n",
            self.method
        );
        for (name, value) in &self.headers {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        if let Some(body) = &self.body {
            request.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        request.push_str("\r\n");
        let mut bytes = request.into_bytes();
        if let Some(body) = &self.body {
            bytes.extend_from_slice(body);
        }
        let mut raw = Vec::new();
        if tls {
            let (mut stream, _) = crate::client::tls_connect(Box::new(tcp)).await?;
            stream.write_all(&bytes).await.map_err(|e| e.to_string())?;
            let _ = stream.read_to_end(&mut raw).await;
        } else {
            let mut stream = tcp;
            stream.write_all(&bytes).await.map_err(|e| e.to_string())?;
            let _ = stream.read_to_end(&mut raw).await;
        }
        Response::parse(&raw)
    }
}

pub(super) struct Response {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Response {
    fn parse(raw: &[u8]) -> Result<Self, String> {
        let split = raw
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .ok_or_else(|| "no HTTP head".to_string())?;
        let head = std::str::from_utf8(&raw[..split]).map_err(|e| e.to_string())?;
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .and_then(|code| StatusCode::from_u16(code).ok())
            .ok_or_else(|| "bad status line".to_string())?;
        let mut headers = HeaderMap::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                if let (Ok(name), Ok(value)) = (
                    HeaderName::from_bytes(name.trim().as_bytes()),
                    HeaderValue::from_str(value.trim()),
                ) {
                    headers.append(name, value);
                }
            }
        }
        let mut body = raw[split + 4..].to_vec();
        let chunked = headers
            .get("transfer-encoding")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.eq_ignore_ascii_case("chunked"));
        if chunked {
            body = dechunk(&body)?;
        }
        Ok(Self {
            status,
            headers,
            body,
        })
    }

    pub(super) fn status(&self) -> StatusCode {
        self.status
    }

    pub(super) fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub(super) async fn text(self) -> Result<String, String> {
        String::from_utf8(self.body).map_err(|e| e.to_string())
    }

    pub(super) async fn json<T: DeserializeOwned>(self) -> Result<T, String> {
        serde_json::from_slice(&self.body).map_err(|e| e.to_string())
    }
}

fn dechunk(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let line_end = body
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "bad chunk".to_string())?;
        let size_text = std::str::from_utf8(&body[..line_end]).map_err(|e| e.to_string())?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("0").trim(), 16)
            .map_err(|e| e.to_string())?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Ok(out);
        }
        if body.len() < size + 2 {
            return Err("truncated chunk".to_string());
        }
        out.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
    }
}
