//! Crowds for trip pages (the owner, 10 November 2026: "crowdness using best time api", with the
//! key kept on Railway).
//!
//! BestTime forecasts how busy a venue usually is in each hour of a typical week: 0 to 100%, against
//! that venue's own busiest hour, from recent weeks of anonymous phone signals. It is a pattern for a
//! weekday, not a forecast for a date or a holiday. Its day runs from 6 AM to 5 AM the next morning,
//! and day 0 is Monday.
//!
//! Only the owner may ask, from a signed-in page, because each new forecast spends BestTime credits.
//! The private key stays on the server (`BESTTIME_API_KEY_PRIVATE`, set in Railway); only the venue's
//! name and address leave with it, and no reply or log line carries it. Answers are kept for a day,
//! and the server makes at most 20 calls a minute.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::Form;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{FamilyState, handlers};

pub const DEFAULT_URL: &str = "https://besttime.app";
pub const SOURCE: &str = "BestTime";
pub const SOURCE_LINK: &str = "https://besttime.app/";
/// BestTime's day: index 0 is 6 AM, index 23 is 5 AM the next morning.
pub const FIRST_HOUR: u64 = 6;
const KEEP: Duration = Duration::from_secs(24 * 3600);
const MAX_KEPT: usize = 200;
const CALLS_PER_MINUTE: usize = 20;
const MAX_REPLY_BYTES: u64 = 512 * 1024;
const MAX_FIELD: usize = 200;

/// The private key, which never prints: `{:?}` shows only that one is set.
#[derive(Clone)]
pub struct Key(String);

impl Key {
    pub fn new(value: String) -> Key {
        Key(value)
    }
    fn reveal(&self) -> &str {
        &self.0
    }
    /// The text with the key taken out, for anything that might echo a request back.
    pub fn scrub(&self, text: &str) -> String {
        if self.0.is_empty() {
            text.to_string()
        } else {
            text.replace(&self.0, "[key]")
        }
    }
}

impl fmt::Debug for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Key([set])")
    }
}

#[derive(Deserialize)]
pub struct Ask {
    #[serde(default)]
    name: String,
    #[serde(default)]
    address: String,
}

/// A venue's name or address as BestTime should see it: trimmed, single-spaced, 2 to 200 characters,
/// no control characters.
pub fn clean(field: &str) -> Option<String> {
    let text = field.split_whitespace().collect::<Vec<_>>().join(" ");
    let n = text.chars().count();
    ((2..=MAX_FIELD).contains(&n) && !text.chars().any(char::is_control)).then_some(text)
}

/// What BestTime said: a week's pattern, or why it has none.
#[derive(Debug, PartialEq)]
pub enum Answer {
    Week(Value),
    NoData(String),
}

fn hours(v: &Value) -> Vec<u64> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_u64)
                .filter(|h| *h < 24)
                .collect()
        })
        .unwrap_or_default()
}

/// The parts of a new forecast a trip page uses: the venue, when it was read, and for each weekday
/// the 24 hourly values with BestTime's busy and quiet hours. Anything else is dropped.
pub fn answer_from(body: &str, key: &Key) -> Result<Answer, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("not JSON: {e}"))?;
    if v["status"].as_str() != Some("OK") {
        let message = v["message"]
            .as_str()
            .or_else(|| v["status"].as_str())
            .unwrap_or("no forecast");
        let message: String = key.scrub(message).chars().take(200).collect();
        return Ok(Answer::NoData(message));
    }
    let info = &v["venue_info"];
    let mut days = Vec::new();
    for day in v["analysis"].as_array().ok_or("no analysis")? {
        let n = day["day_info"]["day_int"].as_u64().ok_or("no day_int")?;
        let raw: Vec<u64> = day["day_raw"]
            .as_array()
            .ok_or("no day_raw")?
            .iter()
            .map(|x| x.as_u64().filter(|p| *p <= 100))
            .collect::<Option<_>>()
            .ok_or("a day_raw value outside 0 to 100")?;
        if n > 6 || raw.len() != 24 {
            return Err(format!("day {n} has {} values", raw.len()));
        }
        days.push(json!({
            "day_int": n,
            "day_text": day["day_info"]["day_text"].as_str().unwrap_or(""),
            "raw": raw,
            "busy_hours": hours(&day["busy_hours"]),
            "quiet_hours": hours(&day["quiet_hours"]),
        }));
    }
    let mut seen: Vec<u64> = days.iter().filter_map(|d| d["day_int"].as_u64()).collect();
    seen.sort_unstable();
    if seen != (0..7).collect::<Vec<u64>>() {
        return Err("not one of each weekday".into());
    }
    days.sort_by_key(|d| d["day_int"].as_u64());
    Ok(Answer::Week(json!({
        "available": true,
        "venue": {
            "id": info["venue_id"].as_str().unwrap_or(""),
            "name": info["venue_name"].as_str().unwrap_or(""),
            "address": info["venue_address"].as_str().unwrap_or(""),
            "timezone": info["venue_timezone"].as_str().unwrap_or(""),
        },
        "updated": v["forecast_updated_on"].as_str().unwrap_or(""),
        "first_hour": FIRST_HOUR,
        "days": days,
        "source": SOURCE,
        "link": SOURCE_LINK,
    })))
}

/// Whether a "no data" answer is about the venue, and so worth keeping for the day (BestTime charges
/// for it too), rather than about our account (a bad key, no credits, a limit), which is asked again
/// once fixed (Codex, 10 November 2026).
pub fn lasting_no_data(status: u16, message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    let account = [
        "key",
        "credit",
        "quota",
        "limit",
        "subscription",
        "unauthor",
        "payment",
        "plan",
    ]
    .iter()
    .any(|w| m.contains(w));
    ((200..300).contains(&status) || status == 404) && !account
}

/// Asks BestTime for a new forecast, returning its HTTP status and body. The key goes in the query
/// string, the only place BestTime takes it, and is scrubbed from any error.
fn fetch(base: &str, key: &Key, name: &str, address: &str) -> Result<(u16, String), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(40)))
        .http_status_as_error(false)
        .build()
        .into();
    let mut reply = agent
        .post(format!("{base}/api/v1/forecasts"))
        .header("User-Agent", "hongjia.org family site")
        .query("api_key_private", key.reveal())
        .query("venue_name", name)
        .query("venue_address", address)
        .send_empty()
        .map_err(|e| key.scrub(&e.to_string()))?;
    let status = reply.status().as_u16();
    reply
        .body_mut()
        .with_config()
        .limit(MAX_REPLY_BYTES)
        .read_to_string()
        .map(|body| (status, body))
        .map_err(|e| key.scrub(&e.to_string()))
}

struct Kept {
    at: Instant,
    json: String,
}

fn kept() -> &'static Mutex<HashMap<String, Kept>> {
    static KEPT: OnceLock<Mutex<HashMap<String, Kept>>> = OnceLock::new();
    KEPT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn recall(key: &str) -> Option<String> {
    let map = kept().lock().ok()?;
    map.get(key)
        .filter(|k| k.at.elapsed() < KEEP)
        .map(|k| k.json.clone())
}

fn keep(key: String, json: String) {
    if let Ok(mut map) = kept().lock() {
        map.retain(|_, k| k.at.elapsed() < KEEP);
        if map.len() >= MAX_KEPT
            && let Some(oldest) = map
                .iter()
                .min_by_key(|(_, k)| k.at)
                .map(|(key, _)| key.clone())
        {
            map.remove(&oldest);
        }
        map.insert(
            key,
            Kept {
                at: Instant::now(),
                json,
            },
        );
    }
}

fn may_call() -> bool {
    static CALLS: OnceLock<Mutex<VecDeque<Instant>>> = OnceLock::new();
    let Ok(mut calls) = CALLS.get_or_init(|| Mutex::new(VecDeque::new())).lock() else {
        return false;
    };
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

fn reply(status: StatusCode, body: String) -> Response {
    (
        status,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

fn error(status: StatusCode, message: &str) -> Response {
    reply(status, json!({ "error": message }).to_string())
}

/// `POST /api/crowd` with `name` and `address` (and the page's `x-csrf-token`): how busy one venue
/// usually is, hour by hour, for each weekday. The owner only.
pub async fn forecast(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(ask): Form<Ask>,
) -> Result<Response, handlers::Fail> {
    let Some(session) = handlers::current_session(&state, &headers).await? else {
        return Ok(error(StatusCode::UNAUTHORIZED, "Sign in first."));
    };
    if !session.is_owner {
        return Ok(error(
            StatusCode::FORBIDDEN,
            "Only the owner can ask for crowd data.",
        ));
    }
    if !handlers::api_ok(&state, &headers, &session) {
        return Ok(error(
            StatusCode::FORBIDDEN,
            "Refresh the page and try again.",
        ));
    }
    let Some(key) = state.config.besttime_key.clone() else {
        return Ok(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Crowd data is not set up: BESTTIME_API_KEY_PRIVATE is not set.",
        ));
    };
    let (Some(name), Some(address)) = (clean(&ask.name), clean(&ask.address)) else {
        return Ok(error(
            StatusCode::BAD_REQUEST,
            "Give the venue's name and address (2 to 200 characters each).",
        ));
    };
    let asked = format!("{name}\n{address}");
    if let Some(json) = recall(&asked) {
        return Ok(reply(StatusCode::OK, json));
    }
    if !may_call() {
        return Ok(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Crowd data is busy. Please try again in a minute.",
        ));
    }
    let base = state.config.besttime_url.clone();
    let k = key.clone();
    let fetched = tokio::task::spawn_blocking(move || fetch(&base, &k, &name, &address))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    match fetched.and_then(|(status, body)| answer_from(&body, &key).map(|a| (status, a))) {
        Ok((_, Answer::Week(week))) => {
            let body = week.to_string();
            keep(asked, body.clone());
            Ok(reply(StatusCode::OK, body))
        }
        Ok((status, Answer::NoData(message))) => {
            let body = json!({ "available": false, "message": message, "source": SOURCE, "link": SOURCE_LINK })
                .to_string();
            if lasting_no_data(status, &message) {
                keep(asked, body.clone());
            }
            Ok(reply(StatusCode::OK, body))
        }
        Err(problem) => {
            eprintln!("crowd: {}", key.scrub(&problem));
            Ok(error(
                StatusCode::BAD_GATEWAY,
                "BestTime could not answer just now.",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn week(days: usize, len: usize) -> String {
        let analysis: Vec<Value> = (0..days)
            .map(|d| {
                json!({
                    "day_info": { "day_int": d, "day_text": "Day", "venue_open": 10 },
                    "day_raw": vec![d as u64 * 10; len],
                    "busy_hours": [12, 13, 99],
                    "quiet_hours": [6, 7],
                    "hour_analysis": [{ "hour": 6, "intensity_txt": "Low" }],
                })
            })
            .collect();
        json!({
            "status": "OK",
            "epoch_analysis": 1,
            "forecast_updated_on": "2026-11-10T04:00:00+08:00",
            "venue_info": { "venue_id": "ven_1", "venue_name": "Hall", "venue_address": "1 Road",
                            "venue_timezone": "Europe/London", "venue_dwell_time_min": 30 },
            "analysis": analysis,
        })
        .to_string()
    }

    #[test]
    fn the_key_never_prints() {
        let key = Key::new("pri_0123456789abcdef0123456789abcdef".into());
        assert_eq!(format!("{key:?}"), "Key([set])");
        assert_eq!(
            key.scrub("GET /x?api_key_private=pri_0123456789abcdef0123456789abcdef&y=1"),
            "GET /x?api_key_private=[key]&y=1"
        );
    }

    #[test]
    fn names_and_addresses_are_checked() {
        assert_eq!(clean("  Harbour   Hall "), Some("Harbour Hall".into()));
        assert_eq!(clean("x"), None);
        assert_eq!(clean(&"a".repeat(201)), None);
        assert_eq!(clean("a\u{7}b"), None);
    }

    #[test]
    fn only_the_week_pattern_is_passed_on() {
        let key = Key::new("pri_k".into());
        let Answer::Week(v) = answer_from(&week(7, 24), &key).unwrap() else {
            panic!("expected a week")
        };
        assert_eq!(v["days"].as_array().unwrap().len(), 7);
        assert_eq!(v["days"][3]["raw"].as_array().unwrap().len(), 24);
        assert_eq!(v["days"][3]["raw"][0], 30);
        assert_eq!(v["days"][0]["busy_hours"], json!([12, 13]));
        assert_eq!(v["first_hour"], 6);
        assert_eq!(v["venue"]["timezone"], "Europe/London");
        assert!(v["days"][0].get("hour_analysis").is_none());
        assert!(v["venue"].get("venue_dwell_time_min").is_none());
        assert!(!v.to_string().contains("pri_k"));
    }

    #[test]
    fn a_broken_week_is_refused() {
        let key = Key::new("pri_k".into());
        assert!(answer_from(&week(6, 24), &key).is_err());
        assert!(answer_from(&week(7, 23), &key).is_err());
        assert!(
            answer_from(
                &week(7, 24).replace("\"day_raw\":[60", "\"day_raw\":[160"),
                &key
            )
            .is_err()
        );
        assert!(answer_from("<html>", &key).is_err());
    }

    #[test]
    fn only_a_venue_without_data_is_kept() {
        assert!(lasting_no_data(200, "Venue not found"));
        assert!(lasting_no_data(404, "Could not find the venue"));
        assert!(!lasting_no_data(402, "Not enough API credits"));
        assert!(!lasting_no_data(200, "Invalid private API key"));
        assert!(!lasting_no_data(429, "Too many requests"));
        assert!(!lasting_no_data(500, "Server error"));
    }

    #[test]
    fn no_data_says_why_without_the_key() {
        let key = Key::new("pri_secret".into());
        let body =
            json!({ "status": "Error", "message": "Venue not found for pri_secret" }).to_string();
        assert_eq!(
            answer_from(&body, &key).unwrap(),
            Answer::NoData("Venue not found for [key]".into())
        );
    }
}
