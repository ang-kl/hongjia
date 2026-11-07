//! Add to calendar (the owner, 7 November 2026): a trip page's "Add" link opens `/calendar.ics` with
//! the event or events in its address, and the reply is a calendar file (iCalendar, RFC 5545) that the
//! reader's device offers to add. Signed-in readers only. Nothing is stored: the file is built from the
//! link for that one reply.
//!
//! The link carries `tz` (the trip's UTC offset, `+0800`), an optional `name` (the file's name) and
//! `u` (the trip page, `/documents/<key>`), then for each event `i` from 0: `t<i>` the title,
//! `s<i>` and `e<i>` the local start and end (`YYYYMMDDTHHMM`), `l<i>` the place and `n<i>` a note.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};

use super::weather::{civil_from_days, days_from_civil};
use super::{FamilyState, handlers, web};

pub const MAX_EVENTS: usize = 12;
const MAX_TITLE: usize = 120;
const MAX_PLACE: usize = 200;
const MAX_NOTE: usize = 600;
const MAX_NAME: usize = 80;
const MAX_LENGTH_SECONDS: i64 = 24 * 3600;

#[derive(Debug, PartialEq)]
pub struct Event {
    pub title: String,
    pub start: i64,
    pub end: i64,
    pub place: String,
    pub note: String,
}

#[derive(Debug, PartialEq)]
pub struct Calendar {
    pub file: String,
    pub body: String,
}

/// Printable text only, trimmed and cut to `max` characters.
fn clean(text: &str, max: usize) -> String {
    let flat: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let mut out: String = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.chars().count() > max {
        out = out.chars().take(max.saturating_sub(1)).collect::<String>() + "…";
    }
    out
}

/// A UTC offset such as `+0800`, in seconds (at most 14 hours either way).
pub fn offset_seconds(tz: &str) -> Option<i64> {
    let b = tz.as_bytes();
    if b.len() != 5 || !(b[0] == b'+' || b[0] == b'-') || !b[1..].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let hours = i64::from(b[1] - b'0') * 10 + i64::from(b[2] - b'0');
    let minutes = i64::from(b[3] - b'0') * 10 + i64::from(b[4] - b'0');
    if hours > 14 || minutes > 59 || (hours == 14 && minutes > 0) {
        return None;
    }
    let seconds = hours * 3600 + minutes * 60;
    Some(if b[0] == b'-' { -seconds } else { seconds })
}

/// A local time `YYYYMMDDTHHMM` at the given offset, as Unix seconds (so `20270230T1000` is refused).
pub fn local_to_utc(stamp: &str, offset: i64) -> Option<i64> {
    let b = stamp.as_bytes();
    if b.len() != 13 || b[8] != b'T' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<i64> {
        let part = &stamp[r];
        part.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| part.parse().ok())
            .flatten()
    };
    let (y, m, d) = (digits(0..4)?, digits(4..6)?, digits(6..8)?);
    let (hh, mm) = (digits(9..11)?, digits(11..13)?);
    if !(2000..=2100).contains(&y) || hh > 23 || mm > 59 {
        return None;
    }
    let day = days_from_civil(y, m, d);
    if civil_from_days(day) != (y, m, d) {
        return None;
    }
    Some(day * 86400 + hh * 3600 + mm * 60 - offset)
}

/// Unix seconds as an iCalendar UTC time, `YYYYMMDDTHHMMSSZ`.
pub fn utc_stamp(seconds: i64) -> String {
    let (day, rest) = (seconds.div_euclid(86400), seconds.rem_euclid(86400));
    let (y, m, d) = civil_from_days(day);
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Text as an iCalendar value: backslash, semicolon, comma and line breaks escaped.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            _ => out.push(c),
        }
    }
    out
}

/// One content line, folded at 75 bytes without splitting a character, ended with CRLF.
fn line(out: &mut String, text: &str) {
    let mut width = 0;
    for c in text.chars() {
        let n = c.len_utf8();
        if width + n > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(c);
        width += n;
    }
    out.push_str("\r\n");
}

/// The trip page a link names (`/documents/<key>` with a filing number such as `2026-1106_1`).
fn trip_page(path: &str) -> Option<&str> {
    let key = path.strip_prefix("/documents/")?;
    let b = key.as_bytes();
    let ok = b.len() >= 11
        && b.len() <= 20
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..9].iter().all(u8::is_ascii_digit)
        && b[9] == b'_'
        && b[10..].iter().all(u8::is_ascii_digit);
    ok.then_some(path)
}

/// A file name from the calendar's name: lower-case letters, digits and hyphens, ending in `.ics`.
fn file_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= 48 {
            break;
        }
    }
    let out = out.trim_end_matches('-');
    if out.is_empty() {
        "trip.ics".into()
    } else {
        format!("{out}.ics")
    }
}

/// The events a link names, checked.
pub fn events(query: Option<&str>) -> Result<Vec<Event>, &'static str> {
    let get = |key: &str| web::query_param(query, key);
    let offset = get("tz")
        .as_deref()
        .and_then(offset_seconds)
        .ok_or("the time zone is missing or not like +0800")?;
    let mut out = Vec::new();
    for i in 0..=MAX_EVENTS {
        let Some(title) = get(&format!("t{i}")) else {
            break;
        };
        if i == MAX_EVENTS {
            return Err("too many events in one link");
        }
        let title = clean(&title, MAX_TITLE);
        if title.is_empty() {
            return Err("an event has no title");
        }
        let start = get(&format!("s{i}"))
            .as_deref()
            .and_then(|s| local_to_utc(s, offset))
            .ok_or("an event's start is missing or not a real date and time")?;
        let end = get(&format!("e{i}"))
            .as_deref()
            .and_then(|s| local_to_utc(s, offset))
            .ok_or("an event's end is missing or not a real date and time")?;
        if end <= start || end - start > MAX_LENGTH_SECONDS {
            return Err("an event must end after it starts, within a day");
        }
        out.push(Event {
            title,
            start,
            end,
            place: clean(&get(&format!("l{i}")).unwrap_or_default(), MAX_PLACE),
            note: clean(&get(&format!("n{i}")).unwrap_or_default(), MAX_NOTE),
        });
    }
    if out.is_empty() {
        return Err("no event in the link");
    }
    Ok(out)
}

/// The calendar file for a link. `origin` (such as `https://hongjia.org`) makes the link back to the
/// trip page and the events' identifiers; `now` is the time the file is made (Unix seconds).
pub fn build(
    query: Option<&str>,
    origin: Option<&str>,
    now: i64,
) -> Result<Calendar, &'static str> {
    let events = events(query)?;
    let name = clean(
        &web::query_param(query, "name").unwrap_or_default(),
        MAX_NAME,
    );
    let back = match (
        origin,
        web::query_param(query, "u").as_deref().and_then(trip_page),
    ) {
        (Some(origin), Some(path)) => Some(format!("{origin}{path}")),
        _ => None,
    };
    let host = origin
        .and_then(|o| o.split("://").nth(1))
        .unwrap_or("hongjia.org");
    let mut body = String::new();
    for text in [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//hongjia.org//Trip calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ] {
        line(&mut body, text);
    }
    if !name.is_empty() {
        line(&mut body, &format!("X-WR-CALNAME:{}", escape(&name)));
    }
    for e in &events {
        let id = Sha256::digest(
            format!(
                "{}|{}|{}|{}",
                e.title,
                e.start,
                e.end,
                back.as_deref().unwrap_or("")
            )
            .as_bytes(),
        );
        let id: String = id[..16].iter().map(|b| format!("{b:02x}")).collect();
        line(&mut body, "BEGIN:VEVENT");
        line(&mut body, &format!("UID:{id}@{host}"));
        line(&mut body, &format!("DTSTAMP:{}", utc_stamp(now)));
        line(&mut body, &format!("DTSTART:{}", utc_stamp(e.start)));
        line(&mut body, &format!("DTEND:{}", utc_stamp(e.end)));
        line(&mut body, &format!("SUMMARY:{}", escape(&e.title)));
        if !e.place.is_empty() {
            line(&mut body, &format!("LOCATION:{}", escape(&e.place)));
        }
        let note = match &back {
            Some(url) if e.note.is_empty() => url.clone(),
            Some(url) => format!("{}\n\n{url}", e.note),
            None => e.note.clone(),
        };
        if !note.is_empty() {
            line(&mut body, &format!("DESCRIPTION:{}", escape(&note)));
        }
        if let Some(url) = &back {
            line(&mut body, &format!("URL:{url}"));
        }
        line(&mut body, "END:VEVENT");
    }
    line(&mut body, "END:VCALENDAR");
    Ok(Calendar {
        file: file_name(&name),
        body,
    })
}

pub async fn file(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    uri: Uri,
) -> Result<Response, handlers::Fail> {
    if handlers::current_session(&state, &headers).await?.is_none() {
        return Ok(handlers::see_other("/"));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    Ok(
        match build(uri.query(), state.config.public_origin.as_deref(), now) {
            Ok(c) => (
                [
                    (
                        header::CONTENT_TYPE,
                        "text/calendar; charset=utf-8".to_string(),
                    ),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("inline; filename=\"{}\"", c.file),
                    ),
                    (header::CACHE_CONTROL, "no-store".to_string()),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                ],
                c.body,
            )
                .into_response(),
            Err(why) => (
                StatusCode::BAD_REQUEST,
                [
                    (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-store"),
                ],
                format!("This calendar link does not work: {why}."),
            )
                .into_response(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: &str = "tz=%2B0800&name=Day%202%20%C2%B7%20Sun%2021%20Mar&u=%2Fdocuments%2F2026-1106_1\
&t0=Mandurah%20waterfront%20break&s0=20270321T1015&e0=20270321T1130&l0=Mandurah%20foreshore\
&n0=Seated%20coffee%3B%20early%20lunch%2C%20near%20the%20car.%20Proposed%2C%20not%20booked.\
&t1=Leave%20Como&s1=20270321T0915&e1=20270321T0945";

    #[test]
    fn offsets_and_times() {
        assert_eq!(offset_seconds("+0800"), Some(28800));
        assert_eq!(offset_seconds("-0530"), Some(-19800));
        assert_eq!(offset_seconds("+1400"), Some(50400));
        for bad in ["0800", "+08:00", "+1430", "+0860", "+1500", ""] {
            assert_eq!(offset_seconds(bad), None, "{bad}");
        }
        let t = local_to_utc("20270321T1015", 28800).unwrap();
        assert_eq!(utc_stamp(t), "20270321T021500Z");
        assert_eq!(
            utc_stamp(local_to_utc("20270320T0300", 28800).unwrap()),
            "20270319T190000Z"
        );
        for bad in [
            "20270230T1000",
            "20271301T1000",
            "20270321T2400",
            "20270321 1015",
            "2027032T11015",
            "19990101T1000",
        ] {
            assert_eq!(local_to_utc(bad, 0), None, "{bad}");
        }
    }

    #[test]
    fn a_day_becomes_a_calendar_file() {
        let c = build(Some(DAY), Some("https://hongjia.org"), 1_794_000_000).unwrap();
        assert_eq!(c.file, "day-2-sun-21-mar.ics");
        let b = &c.body;
        assert!(b.starts_with("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
        assert!(b.ends_with("END:VCALENDAR\r\n"));
        assert_eq!(b.matches("BEGIN:VEVENT").count(), 2);
        assert!(b.contains("DTSTART:20270321T021500Z\r\nDTEND:20270321T033000Z\r\n"));
        assert!(b.contains("DTSTART:20270321T011500Z\r\nDTEND:20270321T014500Z\r\n"));
        assert!(b.contains("SUMMARY:Mandurah waterfront break\r\n"));
        assert!(b.contains("LOCATION:Mandurah foreshore\r\n"));
        assert!(b.contains("X-WR-CALNAME:Day 2 · Sun 21 Mar\r\n"));
        assert!(b.contains("URL:https://hongjia.org/documents/2026-1106_1\r\n"));
        let unfolded = b.replace("\r\n ", "");
        assert!(unfolded.contains(
            "DESCRIPTION:Seated coffee\\; early lunch\\, near the car. Proposed\\, not booked.\\n\\nhttps://hongjia.org/documents/2026-1106_1\r\n"
        ));
        for l in b.split("\r\n") {
            assert!(l.len() <= 75, "folded at 75 bytes: {l}");
        }
        assert!(b.contains("@hongjia.org\r\n"));
        // The same event gets the same identifier, so adding it twice updates instead of copying.
        assert_eq!(
            b,
            &build(Some(DAY), Some("https://hongjia.org"), 1_794_000_000)
                .unwrap()
                .body
        );
    }

    #[test]
    fn links_that_do_not_work() {
        let ok = "tz=%2B0800&t0=A&s0=20270321T1015&e0=20270321T1130";
        assert!(build(Some(ok), None, 0).is_ok());
        for bad in [
            "t0=A&s0=20270321T1015&e0=20270321T1130",
            "tz=%2B0800",
            "tz=%2B0800&t0=A&s0=20270321T1130&e0=20270321T1015",
            "tz=%2B0800&t0=A&s0=20270321T1015&e0=20270323T1130",
            "tz=%2B0800&t0=A&s0=20270321T1015",
            "tz=%2B0800&t0=%20&s0=20270321T1015&e0=20270321T1130",
        ] {
            assert!(build(Some(bad), None, 0).is_err(), "{bad}");
        }
        let many: String = (0..=MAX_EVENTS)
            .map(|i| format!("&t{i}=A&s{i}=20270321T1015&e{i}=20270321T1130"))
            .collect();
        assert!(build(Some(&format!("tz=%2B0800{many}")), None, 0).is_err());
        // Line breaks and other control characters in the link cannot add lines to the file.
        let sneaky =
            "tz=%2B0800&t0=A%0D%0AATTENDEE%3Amailto%3Ax%40y&s0=20270321T1015&e0=20270321T1130";
        let b = build(Some(sneaky), None, 0).unwrap().body;
        assert!(!b.contains("\r\nATTENDEE"));
        assert!(b.contains("SUMMARY:A ATTENDEE:mailto:x@y\r\n"));
    }

    #[test]
    fn only_trip_pages_are_linked_back() {
        for (u, linked) in [
            ("%2Fdocuments%2F2026-1106_1", true),
            ("https%3A%2F%2Fexample.com%2F", false),
            ("%2Fdocuments%2F2026-1106_1%2Fraw", false),
            ("%2Fsignout", false),
        ] {
            let q = format!("tz=%2B0800&u={u}&t0=A&s0=20270321T1015&e0=20270321T1130");
            let b = build(Some(&q), Some("https://hongjia.org"), 0)
                .unwrap()
                .body;
            assert_eq!(b.contains("URL:"), linked, "{u}");
        }
        assert!(!build(Some(DAY), None, 0).unwrap().body.contains("URL:"));
    }

    #[test]
    fn names_and_folding() {
        assert_eq!(file_name(""), "trip.ics");
        assert_eq!(file_name("Day 2 · Sun 21 Mar"), "day-2-sun-21-mar.ics");
        assert_eq!(file_name("../../etc"), "etc.ics");
        let mut out = String::new();
        line(&mut out, &format!("SUMMARY:{}", "é".repeat(60)));
        for l in out.split("\r\n") {
            assert!(l.len() <= 75);
        }
        assert_eq!(
            out.replace("\r\n ", ""),
            format!("SUMMARY:{}\r\n", "é".repeat(60))
        );
    }
}
