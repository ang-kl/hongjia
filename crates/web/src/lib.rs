//! hongjia.org web server, phase P0R: the same behaviour as the P0 placeholder, written in Rust.
//!
//! Routes are matched exactly as received (never decoded), the browser files are compiled into the
//! binary, and every response carries the same security headers as P0.

use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use std::sync::Arc;

pub mod family;

/// The placeholder page loads only its own stylesheet and scripts; nothing else is allowed.
pub const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Every powerful browser feature is switched off (only features browsers recognise, so the header
/// itself causes no console warnings).
pub const PERMISSIONS_POLICY: &str = "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()";

const ROBOTS: &str = "User-agent: *\nDisallow: /\n";
const TEXT: &str = "text/plain; charset=utf-8";
const JAVASCRIPT: &str = "text/javascript; charset=utf-8";
const ASSET_CACHE: &str = "public, max-age=300";

static INDEX_HTML: &[u8] = include_bytes!("../../../web/index.html");
static SITE_CSS: &[u8] = include_bytes!("../../../web/assets/site.css");
static SITE_MJS: &[u8] = include_bytes!("../../../web/assets/site.mjs");
static DEVICE_PROFILE_MJS: &[u8] = include_bytes!("../../../web/assets/device-profile.mjs");
static SESSION_MJS: &[u8] = include_bytes!("../../../web/assets/session.mjs");
static EXPLORER_MJS: &[u8] = include_bytes!("../../../web/assets/explorer.mjs");
static GLOBE_LAYOUT_MJS: &[u8] = include_bytes!("../../../web/assets/globe-layout.mjs");

/// A compiled-in browser file (served in placeholder mode except session.mjs, explorer.mjs and
/// globe-layout.mjs, which are family-only).
pub(crate) fn asset(name: &str) -> Response {
    match name {
        "site.css" => file(SITE_CSS, "text/css; charset=utf-8", ASSET_CACHE),
        "site.mjs" => file(SITE_MJS, JAVASCRIPT, ASSET_CACHE),
        "device-profile.mjs" => file(DEVICE_PROFILE_MJS, JAVASCRIPT, ASSET_CACHE),
        "session.mjs" => file(SESSION_MJS, JAVASCRIPT, ASSET_CACHE),
        "explorer.mjs" => file(EXPLORER_MJS, JAVASCRIPT, ASSET_CACHE),
        "globe-layout.mjs" => file(GLOBE_LAYOUT_MJS, JAVASCRIPT, ASSET_CACHE),
        _ => plain(StatusCode::NOT_FOUND, "Not found\n"),
    }
}

pub(crate) fn robots() -> Response {
    file(ROBOTS.as_bytes(), TEXT, "public, max-age=3600")
}

#[derive(Clone)]
struct AppState {
    health: Arc<str>,
}

/// Builds the router. `commit` is the short commit label shown by `/healthz`.
pub fn app(commit: &str) -> Router {
    let state = AppState {
        health: Arc::from(format!(
            r#"{{"status":"ok","commit":"{}"}}"#,
            commit_label(Some(commit))
        )),
    };
    Router::new()
        .route(
            "/",
            get(|| async { file(INDEX_HTML, "text/html; charset=utf-8", "no-cache") }),
        )
        .route("/healthz", get(healthz))
        .route(
            "/robots.txt",
            get(|| async { file(ROBOTS.as_bytes(), TEXT, "public, max-age=3600") }),
        )
        .route(
            "/assets/site.css",
            get(|| async { file(SITE_CSS, "text/css; charset=utf-8", ASSET_CACHE) }),
        )
        .route(
            "/assets/site.mjs",
            get(|| async { file(SITE_MJS, JAVASCRIPT, ASSET_CACHE) }),
        )
        .route(
            "/assets/device-profile.mjs",
            get(|| async { file(DEVICE_PROFILE_MJS, JAVASCRIPT, ASSET_CACHE) }),
        )
        .fallback(|| async { plain(StatusCode::NOT_FOUND, "Not found\n") })
        .with_state(state)
        .layer(middleware::from_fn(guard_and_headers))
}

async fn healthz(State(state): State<AppState>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        state.health.to_string(),
    )
        .into_response()
}

fn file(body: &'static [u8], content_type: &'static str, cache: &'static str) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache),
        ],
        Body::from(body),
    )
        .into_response()
}

pub(crate) fn plain(status: StatusCode, body: &'static str) -> Response {
    (
        status,
        [
            (header::CONTENT_TYPE, TEXT),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

/// Refuses every method except GET and HEAD (before routing, as P0 did), then adds the security
/// headers to whatever response comes back, including 404 and 405.
async fn guard_and_headers(request: Request, next: Next) -> Response {
    let mut response = if request.method() == Method::GET || request.method() == Method::HEAD {
        next.run(request).await
    } else {
        let mut refused = plain(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed\n");
        refused
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        refused
    };
    apply_security_headers(response.headers_mut());
    response
}

/// The security headers sent on every response.
pub fn security_headers() -> [(&'static str, &'static str); 8] {
    [
        ("content-security-policy", CONTENT_SECURITY_POLICY),
        ("strict-transport-security", "max-age=31536000"),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        ("permissions-policy", PERMISSIONS_POLICY),
        ("cross-origin-opener-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
        ("x-robots-tag", "noindex, nofollow"),
    ]
}

fn apply_security_headers(headers: &mut HeaderMap) {
    for (name, value) in security_headers() {
        headers.insert(name, HeaderValue::from_static(value));
    }
}

/// Short commit label for `/healthz`: the first seven characters of a hexadecimal commit, else "local".
pub fn commit_label(sha: Option<&str>) -> String {
    match sha {
        Some(s) if (7..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit()) => {
            s[..7].to_ascii_lowercase()
        }
        _ => "local".to_string(),
    }
}

/// Ports to listen on: `$PORT` (Railway injects it) and the extra port from `HONGJIA_ALSO_LISTEN`
/// (default 8080, the target port of hongjia.up.railway.app; empty disables it), each once.
pub fn listen_ports(port: Option<&str>, also: Option<&str>) -> Vec<u16> {
    let parse = |value: &str| value.trim().parse::<u16>().ok().filter(|p| *p > 0);
    let primary = port.and_then(parse).unwrap_or(8080);
    let extra = match also {
        None => Some(8080),
        Some(value) if value.trim().is_empty() => None,
        Some(value) => parse(value),
    };
    let mut ports = vec![primary];
    if let Some(p) = extra
        && p != primary
    {
        ports.push(p);
    }
    ports
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_label_accepts_only_hexadecimal() {
        assert_eq!(commit_label(Some("60a5806abcdef0123456789")), "60a5806");
        assert_eq!(commit_label(Some("ABCDEF1234")), "abcdef1");
        assert_eq!(commit_label(Some("<script>")), "local");
        assert_eq!(commit_label(Some("abc")), "local");
        assert_eq!(commit_label(None), "local");
    }

    #[test]
    fn listens_on_port_and_8080_once_each() {
        assert_eq!(listen_ports(Some("3000"), None), vec![3000, 8080]);
        assert_eq!(listen_ports(Some("8080"), None), vec![8080]);
        assert_eq!(listen_ports(None, None), vec![8080]);
        assert_eq!(listen_ports(Some("abc"), None), vec![8080]);
        assert_eq!(listen_ports(Some("70000"), None), vec![8080]);
        assert_eq!(listen_ports(Some("3000"), Some("")), vec![3000]);
        assert_eq!(listen_ports(Some("3000"), Some("9000")), vec![3000, 9000]);
    }
}
