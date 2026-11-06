//! Map pictures (tiles) for trip pages (the owner, 6 November 2026: "server map").
//!
//! A trip page runs in the site's locked frame, which never sends a Referer, and OpenStreetMap's
//! tile servers refuse requests without one. So the page asks the document page for a ticket
//! (`GET /api/tile-ticket`, signed-in people only) and loads its tiles from this server
//! (`/tiles/{z}/{x}/{y}.png?t=ticket`); the server fetches each tile from OpenStreetMap once and
//! keeps it in the database. Family devices never contact OpenStreetMap.
//!
//! OpenStreetMap's tile usage policy (operations.osmfoundation.org/policies/tiles) "generally" does
//! not recommend a caching relay; when there is one it must send a clear, contactable User-Agent,
//! keep the Referer, and honour caching headers or keep each tile for at least 7 days. This relay
//! names the site in its User-Agent and Referer, keeps every tile for at least 7 days (longer if
//! the caching headers say so), never prefetches, makes at most 120 requests a minute and two at a
//! time, and the kit shows the "© OpenStreetMap contributors" credit on every map.

use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;
use tokio::sync::{Mutex, Semaphore};

use super::{FamilyState, auth, handlers, web};

pub const DEFAULT_URL: &str = "https://tile.openstreetmap.org";
pub const USER_AGENT: &str = "hongjia.org family site map relay (+https://hongjia.org/privacy)";
pub const REFERER: &str = "https://hongjia.org/";
pub const MAX_ZOOM: u32 = 19;
/// How long a ticket lasts.
pub const TICKET_SECS: u64 = 12 * 3600;
/// The least time a tile is kept (OpenStreetMap's rule for relays that ignore caching headers).
pub const KEEP_SECS: i64 = 7 * 86_400;
/// At most this many tiles are kept (about 25 to 40 KB each); the oldest go first.
pub const MAX_TILES: i64 = 3000;
const MAX_TILE_BYTES: u64 = 512 * 1024;
const CALLS_PER_MINUTE: usize = 120;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn signature(key: &[u8], expires: u64) -> String {
    let mac = auth::hmac_sha256(key, format!("map-tiles|{expires}").as_bytes());
    auth::hex(&mac[..16])
}

/// A ticket for map tiles: when it expires, and a signature over that time.
pub fn make_ticket(key: &[u8], now: u64) -> (String, u64) {
    let expires = now + TICKET_SECS;
    (format!("{expires}.{}", signature(key, expires)), expires)
}

pub fn ticket_ok(key: &[u8], ticket: &str, now: u64) -> bool {
    let Some((expires, sig)) = ticket.split_once('.') else {
        return false;
    };
    if expires.len() > 12 || sig.len() != 32 || !expires.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let Ok(expires) = expires.parse::<u64>() else {
        return false;
    };
    expires >= now
        && expires <= now + TICKET_SECS
        && auth::ct_eq(signature(key, expires).as_bytes(), sig.as_bytes())
}

/// A tile address `z/x/y.png`, checked: zoom 0 to 19 and x, y inside that zoom's grid.
pub fn tile_address(z: &str, x: &str, file: &str) -> Option<(u32, u32, u32)> {
    let y = file.strip_suffix(".png")?;
    let number = |s: &str| -> Option<u32> {
        if s.is_empty() || s.len() > 7 || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse().ok()
    };
    let (z, x, y) = (number(z)?, number(x)?, number(y)?);
    if z > MAX_ZOOM {
        return None;
    }
    let side = 1u32 << z;
    (x < side && y < side).then_some((z, x, y))
}

/// The `max-age` of a Cache-Control header, in seconds.
pub fn max_age(cache_control: Option<&str>) -> Option<i64> {
    cache_control?
        .split(',')
        .filter_map(|part| part.trim().strip_prefix("max-age="))
        .find_map(|v| v.trim().parse::<i64>().ok())
}

/// How long to keep a tile: as long as OpenStreetMap's caching headers say, and never under 7 days.
pub fn keep_secs(cache_control: Option<&str>) -> i64 {
    max_age(cache_control).unwrap_or(0).max(KEEP_SECS)
}

fn fetch(url: &str) -> Result<(Vec<u8>, Option<String>), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .build()
        .into();
    let mut reply = agent
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header("Referer", REFERER)
        .call()
        .map_err(|e| e.to_string())?;
    let kind = reply
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !kind.starts_with("image/png") {
        return Err(format!("not a picture: {kind}"));
    }
    let cache = reply
        .headers()
        .get("cache-control")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let png = reply
        .body_mut()
        .with_config()
        .limit(MAX_TILE_BYTES)
        .read_to_vec()
        .map_err(|e| e.to_string())?;
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("not a PNG".into());
    }
    Ok((png, cache))
}

/// At most `CALLS_PER_MINUTE` requests to OpenStreetMap in any minute.
async fn may_call() -> bool {
    static CALLS: OnceLock<Mutex<std::collections::VecDeque<Instant>>> = OnceLock::new();
    let mut calls = CALLS
        .get_or_init(|| Mutex::new(std::collections::VecDeque::new()))
        .lock()
        .await;
    while calls
        .front()
        .is_some_and(|t| t.elapsed() >= Duration::from_secs(60))
    {
        calls.pop_front();
    }
    if calls.len() >= CALLS_PER_MINUTE {
        return false;
    }
    calls.push_back(Instant::now());
    true
}

/// Two requests to OpenStreetMap at a time.
fn upstream() -> &'static Semaphore {
    static SLOTS: OnceLock<Semaphore> = OnceLock::new();
    SLOTS.get_or_init(|| Semaphore::new(2))
}

fn png_response(png: Vec<u8>) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("image/png")),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, max-age=86400"),
            ),
            // The trip page sits in a locked frame of its own origin, so the picture must be
            // usable across origins; it is a public map picture behind a ticket.
            (
                header::HeaderName::from_static("cross-origin-resource-policy"),
                HeaderValue::from_static("cross-origin"),
            ),
        ],
        png,
    )
        .into_response()
}

fn refuse(status: StatusCode) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        "",
    )
        .into_response()
}

/// `GET /api/tile-ticket`: a ticket for map tiles, for signed-in people.
pub async fn ticket(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, handlers::Fail> {
    if handlers::current_session(&state, &headers).await?.is_none() {
        return Ok((
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
            json!({ "error": "Sign in first." }).to_string(),
        )
            .into_response());
    }
    let (ticket, expires) = make_ticket(&state.net_key, now_secs());
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        json!({ "ticket": ticket, "expires": expires, "base": "/tiles" }).to_string(),
    )
        .into_response())
}

/// `GET /tiles/{z}/{x}/{y}.png?t=ticket`: one map tile, from the database or fetched once.
pub async fn tile(
    State(state): State<FamilyState>,
    Path((z, x, file)): Path<(String, String, String)>,
    uri: Uri,
) -> Result<Response, handlers::Fail> {
    let Some((z, x, y)) = tile_address(&z, &x, &file) else {
        return Ok(refuse(StatusCode::NOT_FOUND));
    };
    let ticket = web::query_param(uri.query(), "t").unwrap_or_default();
    if !ticket_ok(&state.net_key, &ticket, now_secs()) {
        return Ok(refuse(StatusCode::FORBIDDEN));
    }
    let kept: Option<(Vec<u8>, bool)> = sqlx::query_as(
        "SELECT png, keep_until > now() FROM map_tiles WHERE z = $1 AND x = $2 AND y = $3",
    )
    .bind(z as i16)
    .bind(x as i32)
    .bind(y as i32)
    .fetch_optional(&state.pool)
    .await?;
    if let Some((png, true)) = &kept {
        return Ok(png_response(png.clone()));
    }
    let stale = kept.map(|(png, _)| png);
    if !may_call().await {
        return Ok(stale.map_or_else(|| refuse(StatusCode::SERVICE_UNAVAILABLE), png_response));
    }
    let url = format!("{}/{z}/{x}/{y}.png", state.config.tiles_url);
    let fetched = {
        let _slot = upstream().acquire().await;
        tokio::task::spawn_blocking(move || fetch(&url))
            .await
            .unwrap_or_else(|e| Err(e.to_string()))
    };
    match fetched {
        Ok((png, cache)) => {
            let keep = keep_secs(cache.as_deref());
            sqlx::query(
                "INSERT INTO map_tiles (z, x, y, png, fetched_at, keep_until)
                 VALUES ($1, $2, $3, $4, now(), now() + make_interval(secs => $5))
                 ON CONFLICT (z, x, y) DO UPDATE
                 SET png = EXCLUDED.png, fetched_at = EXCLUDED.fetched_at, keep_until = EXCLUDED.keep_until",
            )
            .bind(z as i16)
            .bind(x as i32)
            .bind(y as i32)
            .bind(&png)
            .bind(keep as f64)
            .execute(&state.pool)
            .await?;
            sqlx::query(
                "DELETE FROM map_tiles WHERE (z, x, y) IN
                 (SELECT z, x, y FROM map_tiles ORDER BY fetched_at DESC OFFSET $1)",
            )
            .bind(MAX_TILES)
            .execute(&state.pool)
            .await?;
            Ok(png_response(png))
        }
        Err(problem) => {
            eprintln!("map tile {z}/{x}/{y}: {problem}");
            Ok(stale.map_or_else(|| refuse(StatusCode::BAD_GATEWAY), png_response))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tickets_are_signed_and_expire() {
        let key = b"test key";
        let (ticket, expires) = make_ticket(key, 1_000_000);
        assert_eq!(expires, 1_000_000 + TICKET_SECS);
        assert!(ticket_ok(key, &ticket, 1_000_000));
        assert!(ticket_ok(key, &ticket, expires));
        assert!(!ticket_ok(key, &ticket, expires + 1), "expired");
        assert!(!ticket_ok(b"other key", &ticket, 1_000_000), "another key");
        let forged = format!("{}.{}", expires + 1000, ticket.split_once('.').unwrap().1);
        assert!(
            !ticket_ok(key, &forged, 1_000_000),
            "a later expiry is not signed"
        );
        let far = make_ticket(key, 9_000_000).0;
        assert!(!ticket_ok(key, &far, 1_000_000), "too far in the future");
        for bad in [
            "",
            "abc",
            "123.",
            ".abc",
            "12x.0123456789abcdef0123456789abcdef",
        ] {
            assert!(!ticket_ok(key, bad, 1_000_000), "{bad}");
        }
    }

    #[test]
    fn tile_addresses_are_checked() {
        assert_eq!(tile_address("0", "0", "0.png"), Some((0, 0, 0)));
        assert_eq!(
            tile_address("12", "3260", "2373.png"),
            Some((12, 3260, 2373))
        );
        for (z, x, f) in [
            ("20", "0", "0.png"),
            ("1", "2", "0.png"),
            ("1", "0", "2.png"),
            ("12", "-1", "0.png"),
            ("12", "1", "1.jpg"),
            ("12", "1", "1"),
            ("a", "1", "1.png"),
            ("12", "1", "../1.png"),
        ] {
            assert_eq!(tile_address(z, x, f), None, "{z}/{x}/{f}");
        }
    }

    #[test]
    fn tiles_are_kept_at_least_a_week() {
        assert_eq!(keep_secs(None), KEEP_SECS);
        assert_eq!(keep_secs(Some("max-age=3600")), KEEP_SECS);
        assert_eq!(keep_secs(Some("public, max-age=1209600")), 1_209_600);
        assert_eq!(max_age(Some("no-cache")), None);
    }
}
