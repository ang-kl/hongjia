//! Weather for trip pages (the owner, 6 November 2026: "proceed with Phase 1 now, using free
//! Open-Meteo for the weather").
//!
//! A trip page names its places and dates. The document page relays each ask to
//! `GET /api/weather`, and the server asks Open-Meteo, so family devices never contact it. Only the
//! coordinates, rounded to two decimals (about 1 km), and the dates leave the server. Open-Meteo's
//! free API is for non-commercial sites, needs no key and forecasts 16 days ahead; its licence is
//! CC BY 4.0, so pages show "Weather data by Open-Meteo.com". Answers are kept for an hour, and
//! the server makes at most 60 calls a minute.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{FamilyState, handlers, web};

pub const DEFAULT_URL: &str = "https://api.open-meteo.com";
/// Open-Meteo forecasts 16 days, today included.
pub const FORECAST_DAYS: i64 = 16;
/// The longest trip one ask may cover.
pub const MAX_SPAN_DAYS: i64 = 60;
const KEEP: Duration = Duration::from_secs(3600);
const MAX_KEPT: usize = 500;
const CALLS_PER_MINUTE: usize = 60;
const MAX_REPLY_BYTES: u64 = 64 * 1024;
const DAILY: &str = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max";
pub const SOURCE: &str = "Open-Meteo.com";
pub const SOURCE_LINK: &str = "https://open-meteo.com/";

/// Days counted from 1 January 1970 (H. Hinnant's civil-date arithmetic).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if m <= 2 {
            yoe + era * 400 + 1
        } else {
            yoe + era * 400
        },
        m,
        d,
    )
}

/// A strict `YYYY-MM-DD` date as a day number, or None (so `2027-02-30` is refused).
pub fn day_number(date: &str) -> Option<i64> {
    let b = date.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<i64> {
        if b[r.clone()].iter().all(u8::is_ascii_digit) {
            date[r].parse().ok()
        } else {
            None
        }
    };
    let (y, m, d) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let n = days_from_civil(y, m, d);
    (civil_from_days(n) == (y, m, d)).then_some(n)
}

pub fn date_of(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Today, as a day number in UTC.
pub fn today() -> i64 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (secs / 86_400) as i64
}

/// One place and the trip's dates there, as asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct Ask {
    /// Rounded to two decimals.
    pub lat: f64,
    pub lon: f64,
    pub start: i64,
    pub end: i64,
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

pub fn parse_ask(query: Option<&str>) -> Result<Ask, &'static str> {
    let number = |name: &str, limit: f64| -> Option<f64> {
        let value: f64 = web::query_param(query, name)?.trim().parse().ok()?;
        (value.is_finite() && value.abs() <= limit).then_some(value)
    };
    let lat = number("lat", 90.0).ok_or("lat must be a number from -90 to 90.")?;
    let lon = number("lon", 180.0).ok_or("lon must be a number from -180 to 180.")?;
    let date = |name: &str| web::query_param(query, name).and_then(|d| day_number(&d));
    let start = date("start").ok_or("start must be a date like 2030-06-20.")?;
    let end = date("end").ok_or("end must be a date like 2030-06-27.")?;
    if end < start {
        return Err("end must not be before start.");
    }
    if end - start >= MAX_SPAN_DAYS {
        return Err("A trip can be asked for up to 60 days at a time.");
    }
    Ok(Ask {
        lat: round2(lat),
        lon: round2(lon),
        start,
        end,
    })
}

/// Which part of the trip the forecast reaches.
#[derive(Debug, PartialEq)]
pub enum Window {
    /// These days (first, last) are inside the forecast.
    Open(i64, i64),
    /// Too far ahead: the forecast first reaches the trip on this day.
    Later(i64),
    /// The trip is over.
    Past,
}

pub fn window(ask: &Ask, today: i64) -> Window {
    // Yesterday too, because the place's day can still be yesterday in UTC terms.
    let first = today - 1;
    let last = today + FORECAST_DAYS - 1;
    if ask.end < first {
        Window::Past
    } else if ask.start > last {
        Window::Later(ask.start - (FORECAST_DAYS - 1))
    } else {
        Window::Open(ask.start.max(first), ask.end.min(last))
    }
}

#[derive(Deserialize)]
struct Reply {
    daily: Daily,
}

#[derive(Deserialize)]
struct Daily {
    time: Vec<String>,
    #[serde(default)]
    weather_code: Vec<Option<f64>>,
    #[serde(default)]
    temperature_2m_max: Vec<Option<f64>>,
    #[serde(default)]
    temperature_2m_min: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_probability_max: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_sum: Vec<Option<f64>>,
    #[serde(default)]
    wind_speed_10m_max: Vec<Option<f64>>,
    #[serde(default)]
    wind_gusts_10m_max: Vec<Option<f64>>,
    #[serde(default)]
    uv_index_max: Vec<Option<f64>>,
}

/// A number kept only when it is plausible, to one decimal; anything else becomes null.
fn reading(values: &[Option<f64>], i: usize, lo: f64, hi: f64) -> Value {
    match values.get(i).copied().flatten() {
        Some(v) if v.is_finite() && (lo..=hi).contains(&v) => json!((v * 10.0).round() / 10.0),
        _ => Value::Null,
    }
}

/// Open-Meteo's answer, reduced to the days and readings trip pages use. Nothing else from the
/// answer is passed on.
pub fn days_from(body: &str) -> Result<Vec<Value>, String> {
    let reply: Reply = serde_json::from_str(body).map_err(|e| format!("not a forecast: {e}"))?;
    let d = reply.daily;
    if d.time.len() > FORECAST_DAYS as usize + 1 {
        return Err("too many days".into());
    }
    let mut out = Vec::with_capacity(d.time.len());
    for (i, date) in d.time.iter().enumerate() {
        if day_number(date).is_none() {
            return Err("a day is not a date".into());
        }
        let code = match d.weather_code.get(i).copied().flatten() {
            Some(c) if c.is_finite() && (0.0..=99.0).contains(&c) => json!(c.round() as i64),
            _ => Value::Null,
        };
        out.push(json!({
            "date": date,
            "code": code,
            "tmax": reading(&d.temperature_2m_max, i, -90.0, 60.0),
            "tmin": reading(&d.temperature_2m_min, i, -90.0, 60.0),
            "rain_pct": reading(&d.precipitation_probability_max, i, 0.0, 100.0),
            "rain_mm": reading(&d.precipitation_sum, i, 0.0, 2000.0),
            "wind_kmh": reading(&d.wind_speed_10m_max, i, 0.0, 500.0),
            "gust_kmh": reading(&d.wind_gusts_10m_max, i, 0.0, 500.0),
            "uv": reading(&d.uv_index_max, i, 0.0, 25.0),
        }));
    }
    Ok(out)
}

pub fn forecast_url(base: &str, ask: &Ask, from: i64, to: i64) -> String {
    format!(
        "{base}/v1/forecast?latitude={:.2}&longitude={:.2}&daily={DAILY}&timezone=auto&start_date={}&end_date={}",
        ask.lat,
        ask.lon,
        date_of(from),
        date_of(to)
    )
}

fn fetch(url: &str) -> Result<String, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .build()
        .into();
    let mut reply = agent
        .get(url)
        .header("User-Agent", "hongjia.org family site")
        .call()
        .map_err(|e| e.to_string())?;
    reply
        .body_mut()
        .with_config()
        .limit(MAX_REPLY_BYTES)
        .read_to_string()
        .map_err(|e| e.to_string())
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

/// At most `CALLS_PER_MINUTE` calls to Open-Meteo in any minute (its free limit is 600).
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
            (header::CACHE_CONTROL, "private, max-age=600"),
        ],
        body,
    )
        .into_response()
}

fn error(status: StatusCode, message: &str) -> Response {
    reply(status, json!({ "error": message }).to_string())
}

/// `GET /api/weather?lat=&lon=&start=&end=`: the daily forecast for one place over a trip's
/// dates, for signed-in people only.
pub async fn forecast(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    uri: Uri,
) -> Result<Response, handlers::Fail> {
    if handlers::current_session(&state, &headers).await?.is_none() {
        return Ok(error(StatusCode::UNAUTHORIZED, "Sign in first."));
    }
    let ask = match parse_ask(uri.query()) {
        Ok(ask) => ask,
        Err(message) => return Ok(error(StatusCode::BAD_REQUEST, message)),
    };
    let place = json!({ "lat": ask.lat, "lon": ask.lon });
    let (from, to) = match window(&ask, today()) {
        Window::Past => {
            let body = json!({ "available": false, "past": true, "place": place, "source": SOURCE, "link": SOURCE_LINK });
            return Ok(reply(StatusCode::OK, body.to_string()));
        }
        Window::Later(day) => {
            let body = json!({ "available": false, "from": date_of(day), "place": place, "source": SOURCE, "link": SOURCE_LINK });
            return Ok(reply(StatusCode::OK, body.to_string()));
        }
        Window::Open(from, to) => (from, to),
    };
    let url = forecast_url(&state.config.weather_url, &ask, from, to);
    if let Some(json) = recall(&url) {
        return Ok(reply(StatusCode::OK, json));
    }
    if !may_call() {
        return Ok(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "The forecast is busy. Please try again in a minute.",
        ));
    }
    let asked = url.clone();
    let fetched = tokio::task::spawn_blocking(move || fetch(&asked))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    let days = fetched.and_then(|body| days_from(&body));
    match days {
        Ok(days) => {
            let body = json!({ "available": true, "place": place, "days": days, "source": SOURCE, "link": SOURCE_LINK }).to_string();
            keep(url, body.clone());
            Ok(reply(StatusCode::OK, body))
        }
        Err(problem) => {
            eprintln!("weather: {problem}");
            Ok(error(
                StatusCode::BAD_GATEWAY,
                "The forecast could not be fetched just now.",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_strict_and_round_trip() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(
            day_number("2030-06-20").map(date_of).as_deref(),
            Some("2030-06-20")
        );
        assert_eq!(
            day_number("2028-02-29").map(date_of).as_deref(),
            Some("2028-02-29")
        );
        for bad in [
            "2027-02-30",
            "2027-13-01",
            "2027-3-20",
            "20270320",
            "2030-06-2x",
            "+027-03-20",
            "",
        ] {
            assert_eq!(day_number(bad), None, "{bad}");
        }
    }

    #[test]
    fn asks_are_checked_and_rounded() {
        let ask = parse_ask(Some(
            "lat=51.50735&lon=-0.12776&start=2030-06-20&end=2030-06-27",
        ))
        .unwrap();
        assert_eq!((ask.lat, ask.lon), (51.51, -0.13));
        assert_eq!(ask.end - ask.start, 7);
        for bad in [
            "lat=91&lon=0&start=2030-06-20&end=2030-06-20",
            "lat=0&lon=-181&start=2030-06-20&end=2030-06-20",
            "lat=NaN&lon=0&start=2030-06-20&end=2030-06-20",
            "lat=0&lon=0&start=2030-06-21&end=2030-06-20",
            "lat=0&lon=0&start=2030-06-01&end=2030-08-30",
            "lat=0&lon=0&start=2030-06-01",
        ] {
            assert!(parse_ask(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_window_is_the_part_of_the_trip_the_forecast_reaches() {
        let today = day_number("2030-06-10").unwrap();
        let ask = |s: &str, e: &str| Ask {
            lat: 0.0,
            lon: 0.0,
            start: day_number(s).unwrap(),
            end: day_number(e).unwrap(),
        };
        assert_eq!(
            window(&ask("2030-06-20", "2030-06-27"), today),
            Window::Open(
                day_number("2030-06-20").unwrap(),
                day_number("2030-06-25").unwrap()
            )
        );
        assert_eq!(
            window(&ask("2030-07-20", "2030-07-27"), today),
            Window::Later(day_number("2030-07-05").unwrap())
        );
        assert_eq!(
            window(&ask("2030-06-01", "2030-06-08"), today),
            Window::Past
        );
        assert_eq!(
            window(&ask("2030-06-09", "2030-06-11"), today),
            Window::Open(
                day_number("2030-06-09").unwrap(),
                day_number("2030-06-11").unwrap()
            )
        );
    }

    #[test]
    fn only_plausible_readings_are_passed_on() {
        let body = r#"{"latitude":51.51,"extra":"<script>","daily":{"time":["2030-06-20","2030-06-21"],
            "weather_code":[61,999],"temperature_2m_max":[31.24,null],"temperature_2m_min":[18.0,17.5],
            "precipitation_probability_max":[70,140],"precipitation_sum":[4.25,0],"wind_speed_10m_max":[24,30],
            "wind_gusts_10m_max":[45,60],"uv_index_max":[9.1,8]}}"#;
        let days = days_from(body).unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(days[0]["code"], 61);
        assert_eq!(days[0]["tmax"], 31.2);
        assert_eq!(days[0]["rain_mm"], 4.3);
        assert_eq!(days[1]["code"], Value::Null);
        assert_eq!(days[1]["tmax"], Value::Null);
        assert_eq!(days[1]["rain_pct"], Value::Null);
        assert!(!serde_json::to_string(&days).unwrap().contains("script"));
        assert!(days_from(r#"{"daily":{"time":["soon"]}}"#).is_err());
        assert!(days_from("<html>").is_err());
    }

    #[test]
    fn the_url_sends_only_rounded_places_and_dates() {
        let ask = Ask {
            lat: 51.51,
            lon: -0.13,
            start: day_number("2030-06-20").unwrap(),
            end: day_number("2030-06-27").unwrap(),
        };
        let url = forecast_url(DEFAULT_URL, &ask, ask.start, ask.end);
        assert!(url.starts_with(
            "https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&daily="
        ));
        assert!(url.ends_with("&timezone=auto&start_date=2030-06-20&end_date=2030-06-27"));
    }
}
