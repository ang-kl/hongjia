//! P2b (C): Word-style annotations, saved form fields and the browser-storage stand-in.
//!
//! When an HTML document is shown, a small helper (`web/assets/frame-helper.js`) is added to the
//! response just after `<head>`; the stored file never changes. Inside the locked frame the helper
//! restores and reports what people fill in, stands in for `localStorage` and `sessionStorage`,
//! reports selected text and the focused field, and draws highlights. It talks only to the parent
//! page (`web/assets/doc-view.mjs`), which checks every message and calls the endpoints here with
//! the person's session and form token. A document cannot create an annotation by itself: a person
//! types the comment in the panel and presses Save.
//!
//! Rights (owner decisions, 5 November 2026): every family member may fill in fields and annotate;
//! people delete their own annotations and the owner may delete any; the uploader or the owner
//! chooses whether fields are shared (one family copy) or personal (each person their own).
//!
//! D1 (owner's request, 5 November 2026; open choices taken at the recommended defaults): marks of
//! nine kinds (comment, highlight, underline, strike, insert, replace, note, textbox, stamp) in five
//! colours, opened from a menu by right-click, long press or a Pencil double tap. Only a mark's
//! author edits or moves it; its author or the owner deletes it. @mentions are listed inside the
//! site only. Text people write (comments, notes, text boxes, inserted and replacement text) never
//! enters the document frame: the page draws it over the frame.
//!
//! D2 (owner's request, 5 November 2026): drawings. Kind `ink` is a freehand stroke (Draw, or a
//! Sketch that was not recognised as a shape) and kind `shape` a clean rectangle, oval, line or
//! arrow (Shapes, or a recognised Sketch). A drawing is anchored to the element under its first
//! point; its points are pixels from that element's top-left corner at `ref_width`, scaled by the
//! element's current width when drawn. Drawings follow the same rules as other marks, and they are
//! drawn by the page over the frame, never inside it.
//!
//! D3 (owner's request, 5 November 2026): kind `signature` places the signer's own saved signature
//! (see `signature.rs`) at a point of the document. The server copies it when placed (drawn strokes
//! in `points`, or the typed name in `text`), so nobody can place someone else's and replacing a
//! saved signature never changes what was signed. It moves like a note; it cannot be edited.

use super::documents::{self, DocumentRow};
use super::store::{self, Session};
use super::{FamilyState, auth, doccheck, json, signature, web};
use axum::{
    Form,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};

pub const MAX_KEY: usize = 200;
pub const MAX_FIELD_VALUE: usize = 4000;
pub const MAX_STORAGE_VALUE: usize = 8000;
pub const MAX_LABEL: usize = 200;
/// Saved keys per document, per copy (shared or one person's) and per kind.
pub const MAX_KEYS: i64 = 500;
pub const MAX_QUOTE: usize = 1000;
pub const MAX_AROUND: usize = 64;
pub const MAX_BODY: usize = 4000;
pub const MAX_ANNOTATIONS: i64 = 1000;
pub const MAX_TEXT: usize = 500;
pub const MAX_PATH: usize = 400;

pub const KINDS: [&str; 12] = [
    "comment",
    "highlight",
    "underline",
    "strike",
    "insert",
    "replace",
    "note",
    "textbox",
    "stamp",
    "ink",
    "shape",
    "signature",
];
pub const COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "orange"];
pub const STAMPS: [&str; 5] = ["check", "cross", "approved", "reviewed", "signedoff"];
const PLACED: [&str; 4] = ["note", "textbox", "stamp", "signature"];
/// Drawings (D2): anchored like placed marks, with points instead of words.
pub const DRAWN: [&str; 2] = ["ink", "shape"];
pub const INK_TOOLS: [&str; 2] = ["draw", "sketch"];
pub const SHAPE_TOOLS: [&str; 4] = ["rectangle", "oval", "line", "arrow"];
/// Points in one stroke, after the page has simplified it.
pub const MAX_POINTS: usize = 600;
pub const MAX_POINTS_TEXT: usize = 16000;
/// The furthest a point may lie from its element's corner, in pixels at the reference width.
const POINT_RANGE: f64 = 100_000.0;

/// One number of a point: an optional minus sign, up to 6 digits, and up to 2 decimals.
fn point_number(text: &str) -> Option<f64> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    let (whole, decimals) = digits.split_once('.').unwrap_or((digits, ""));
    let ok = (1..=6).contains(&whole.len())
        && whole.bytes().all(|b| b.is_ascii_digit())
        && decimals.len() <= 2
        && decimals.bytes().all(|b| b.is_ascii_digit())
        && !(digits.contains('.') && decimals.is_empty());
    if !ok {
        return None;
    }
    text.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// A drawing's points: `x,y` pairs (shapes) or `x,y,p` triples with a pen pressure from 0 to 1
/// (ink), separated by single spaces. Numbers only, within range, between `min` and `max` points.
pub fn parse_points(text: &str, pressure: bool, min: usize, max: usize) -> Option<Vec<[f64; 3]>> {
    if text.is_empty() || text.len() > MAX_POINTS_TEXT {
        return None;
    }
    let mut points = Vec::new();
    for token in text.split(' ') {
        let values: Vec<&str> = token.split(',').collect();
        if values.len() != if pressure { 3 } else { 2 } || points.len() == max {
            return None;
        }
        let x = point_number(values[0]).filter(|v| v.abs() <= POINT_RANGE)?;
        let y = point_number(values[1]).filter(|v| v.abs() <= POINT_RANGE)?;
        let p = if pressure {
            point_number(values[2]).filter(|v| (0.0..=1.0).contains(v))?
        } else {
            0.5
        };
        points.push([x, y, p]);
    }
    (points.len() >= min).then_some(points)
}

/// Points written back in the one stored form: one decimal for positions, two for pressure.
pub fn format_points(points: &[[f64; 3]], pressure: bool) -> String {
    let n = |v: f64, places: usize| {
        let s = format!("{v:.places$}");
        let s = if s.contains('.') {
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            s
        };
        if s == "-0" { "0".to_string() } else { s }
    };
    points
        .iter()
        .map(|[x, y, p]| {
            if pressure {
                format!("{},{},{}", n(*x, 1), n(*y, 1), n(*p, 2))
            } else {
                format!("{},{}", n(*x, 1), n(*y, 1))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A drawing's tool, points, line width and the width its element had when it was drawn.
#[derive(Debug, PartialEq)]
pub struct Drawing {
    pub tool: String,
    pub points: String,
    pub stroke_width: f32,
    pub ref_width: f32,
    pub ref_height: Option<f32>,
}

/// Checks a drawing for its kind: ink takes Draw or Sketch and 2 to 600 points with pressure; a
/// shape takes one of the four shape tools and exactly 2 points that are not the same point.
fn check_drawing(kind: &str, form: &AnnotationForm) -> Result<Drawing, &'static str> {
    let tool = form.tool.as_str();
    let ink = kind == "ink";
    let tool_ok = if ink {
        INK_TOOLS.contains(&tool)
    } else {
        SHAPE_TOOLS.contains(&tool)
    };
    if !tool_ok {
        return Err("unknown drawing tool");
    }
    let points = if ink {
        parse_points(&form.points, true, 2, MAX_POINTS)
    } else {
        parse_points(&form.points, false, 2, 2)
    }
    .ok_or("the drawing's points are not valid")?;
    if !ink {
        let ([x1, y1, _], [x2, y2, _]) = (points[0], points[1]);
        if (x2 - x1).abs() < 2.0 && (y2 - y1).abs() < 2.0 {
            return Err("the shape has no size");
        }
    }
    let number = |text: &str, lo: f32, hi: f32| {
        text.trim()
            .parse::<f32>()
            .ok()
            .filter(|v| v.is_finite() && (lo..=hi).contains(v))
    };
    let stroke_width =
        number(&form.stroke_width, 1.0, 24.0).ok_or("the line width is not valid")?;
    let ref_width =
        number(&form.ref_width, 1.0, 100_000.0).ok_or("the reference width is not valid")?;
    let ref_height = if form.ref_height.trim().is_empty() {
        None
    } else {
        Some(number(&form.ref_height, 1.0, 100_000.0).ok_or("the reference height is not valid")?)
    };
    Ok(Drawing {
        tool: tool.to_string(),
        points: format_points(&points, ink),
        stroke_width,
        ref_width,
        ref_height,
    })
}

/// An element path inside a document, from `<body>`: `tag:index` steps joined by `/`, where the
/// index counts siblings of the same tag from 1 (for example `section:2/p:3`).
pub fn valid_path(path: &str) -> bool {
    let steps: Vec<&str> = path.split('/').collect();
    (1..=MAX_PATH).contains(&path.len())
        && steps.len() <= 25
        && steps.iter().all(|step| {
            let Some((tag, index)) = step.split_once(':') else {
                return false;
            };
            let mut chars = tag.chars();
            chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && tag.len() <= 31
                && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                && (1..=5).contains(&index.len())
                && index.bytes().all(|b| b.is_ascii_digit())
                && index.parse::<u32>().is_ok_and(|n| n >= 1)
        })
}

/// A fraction of an element's box, 0 to 1.
pub fn fraction(value: &str) -> Option<f64> {
    let v: f64 = value.trim().parse().ok()?;
    (v.is_finite() && (0.0..=1.0).contains(&v)).then_some(v)
}

/// The family handles named with @ in a text, in order, once each.
pub fn mentions(text: &str, handles: &[String]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if *c != '@' || (i > 0 && chars[i - 1].is_alphanumeric()) {
            continue;
        }
        let name: String = chars[i + 1..]
            .iter()
            .take_while(|c| c.is_ascii_alphabetic())
            .take(21)
            .collect::<String>()
            .to_ascii_lowercase();
        if handles.contains(&name) && !found.contains(&name) {
            found.push(name);
        }
    }
    found
}

/// What a stamp says. A sign-off carries its author and date, set by the server.
pub fn stamp_label(name: &str, author: &str, date: &str) -> String {
    match name {
        "check" => "✓".into(),
        "cross" => "✗".into(),
        "approved" => "Approved".into(),
        "reviewed" => "Reviewed".into(),
        "signedoff" => format!("Signed off · {author} · {date}"),
        _ => String::new(),
    }
}

/// A placed signature's caption, from its author and the time it was placed (Singapore time).
pub fn signature_caption(author: &str, when: &str) -> String {
    format!("Signed by {author}, {when} (SGT)")
}

/// A mark as submitted, checked for its kind.
#[derive(Debug, PartialEq)]
pub struct Mark {
    pub kind: String,
    pub color: String,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub field_key: Option<String>,
    pub field_label: String,
    pub body: String,
    pub text: String,
    pub anchor: Option<(String, f64, f64)>,
    /// D2: a drawing's tool, points and widths (ink and shapes only).
    pub drawing: Option<Drawing>,
}

/// A placed mark's anchor: all three values or none. Err when some are given but not valid.
fn anchor_of(path: &str, x: &str, y: &str) -> Result<Option<(String, f64, f64)>, &'static str> {
    if path.is_empty() && x.is_empty() && y.is_empty() {
        return Ok(None);
    }
    match (valid_path(path), fraction(x), fraction(y)) {
        (true, Some(x), Some(y)) => Ok(Some((path.to_string(), x, y))),
        _ => Err("the place in the document is not valid"),
    }
}

/// Checks a new mark: the kind and colour come from fixed lists, every text has a limit, and
/// each kind has what it needs (a passage, text, or a place) and nothing it does not use.
pub fn check_mark(form: &AnnotationForm) -> Result<Mark, &'static str> {
    let kind = if form.kind.is_empty() {
        "comment"
    } else {
        form.kind.as_str()
    };
    if !KINDS.contains(&kind) {
        return Err("unknown kind");
    }
    let color = if form.color.is_empty() {
        "yellow"
    } else {
        form.color.as_str()
    };
    if !COLORS.contains(&color) {
        return Err("unknown colour");
    }
    let body = form.body.trim();
    let text = form.text.trim();
    if chars(body) > MAX_BODY
        || chars(text) > MAX_TEXT
        || chars(&form.quote) > MAX_QUOTE
        || chars(&form.prefix) > MAX_AROUND
        || chars(&form.suffix) > MAX_AROUND
        || chars(&form.field_key) > MAX_KEY
        || chars(&form.field_label) > MAX_LABEL
    {
        return Err("too long");
    }
    let anchor = anchor_of(&form.anchor_path, &form.anchor_x, &form.anchor_y)?;
    let drawn = DRAWN.contains(&kind);
    let placed = PLACED.contains(&kind) || drawn;
    if placed != anchor.is_some() {
        return Err("only notes, text boxes, stamps and drawings are placed");
    }
    let drawing_fields = !(form.tool.is_empty()
        && form.points.is_empty()
        && form.stroke_width.is_empty()
        && form.ref_width.is_empty()
        && form.ref_height.is_empty());
    let drawing = if drawn {
        Some(check_drawing(kind, form)?)
    } else if drawing_fields {
        return Err("only drawings have points");
    } else {
        None
    };
    let has_quote = !form.quote.trim().is_empty();
    let ok = match kind {
        "comment" => !body.is_empty() && text.is_empty(),
        "highlight" | "underline" | "strike" => has_quote && text.is_empty(),
        "insert" => {
            !text.is_empty() && (has_quote || !form.prefix.is_empty() || !form.suffix.is_empty())
        }
        "replace" => has_quote && !text.is_empty(),
        "note" | "textbox" => !body.is_empty() && text.is_empty(),
        "stamp" => STAMPS.contains(&text),
        "ink" | "shape" => body.is_empty() && text.is_empty() && !has_quote,
        // The server fills in the signer's own saved signature.
        "signature" => body.is_empty() && text.is_empty() && !has_quote,
        _ => false,
    };
    if !ok {
        return Err("this kind of mark is missing something");
    }
    let field_key =
        (kind == "comment" && !form.field_key.is_empty()).then(|| form.field_key.clone());
    Ok(Mark {
        kind: kind.to_string(),
        color: color.to_string(),
        quote: form.quote.clone(),
        prefix: form.prefix.clone(),
        suffix: form.suffix.clone(),
        field_label: if field_key.is_some() {
            form.field_label.clone()
        } else {
            String::new()
        },
        field_key,
        body: body.to_string(),
        text: text.to_string(),
        anchor,
        drawing,
    })
}

const HELPER_JS: &str = include_str!("../../../../web/assets/frame-helper.js");
const PLACEHOLDER: &str = "__HJ_DATA__";

/// The helper as an inline script, with this viewer's saved values as JSON. `json::string`
/// escapes `<`, `>` and `&`, so a saved value cannot end the script early.
pub fn helper_script(data_json: &str) -> String {
    let at = HELPER_JS
        .rfind(PLACEHOLDER)
        .expect("frame-helper.js ends with the data placeholder");
    format!(
        "<script data-hj-helper>{}{}{}</script>",
        &HELPER_JS[..at],
        data_json,
        &HELPER_JS[at + PLACEHOLDER.len()..]
    )
}

fn starts_with_at(haystack: &[u8], at: usize, needle: &[u8]) -> bool {
    haystack.len() >= at + needle.len() && &haystack[at..at + needle.len()] == needle
}

fn find(haystack: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| from + p)
}

/// Where the helper goes: just after the opening `<head ...>` tag if one starts in the first
/// 64 KB (outside comments, before `<body>`), else just after the doctype, else at the start
/// (after a byte-order mark).
pub fn injection_point(html: &[u8]) -> usize {
    let window = html[..html.len().min(64 * 1024)].to_ascii_lowercase();
    let start = if html.starts_with(&[0xEF, 0xBB, 0xBF]) {
        3
    } else {
        0
    };
    let mut doctype_end = None;
    let mut i = start;
    while let Some(lt) = find(&window, i, b"<") {
        if starts_with_at(&window, lt, b"<!--") {
            match find(&window, lt + 4, b"-->") {
                Some(end) => {
                    i = end + 3;
                    continue;
                }
                None => break,
            }
        }
        let boundary = |at: usize| {
            window
                .get(at)
                .is_some_and(|b| b.is_ascii_whitespace() || *b == b'>' || *b == b'/')
        };
        let tag_end = || find(&window, lt, b">").map(|gt| gt + 1);
        if starts_with_at(&window, lt, b"<!doctype") {
            doctype_end = tag_end();
        } else if starts_with_at(&window, lt, b"<head") && boundary(lt + 5) {
            if let Some(end) = tag_end() {
                return end;
            }
            break;
        } else if starts_with_at(&window, lt, b"<body") && boundary(lt + 5) {
            break;
        }
        i = lt + 1;
    }
    doctype_end.unwrap_or(start)
}

/// The document as sent: the original bytes with the helper inserted once.
pub fn inject(html: &[u8], script: &str) -> Vec<u8> {
    let at = injection_point(html);
    let mut out = Vec::with_capacity(html.len() + script.len());
    out.extend_from_slice(&html[..at]);
    out.extend_from_slice(script.as_bytes());
    out.extend_from_slice(&html[at..]);
    out
}

/// A JSON object of string values.
fn json_map(pairs: &[(String, String)]) -> String {
    let items: Vec<String> = pairs
        .iter()
        .map(|(k, v)| format!("{}:{}", json::string(k), json::string(v)))
        .collect();
    format!("{{{}}}", items.join(","))
}

/// Whose copy a person sees: the shared one (None) or their own.
fn scope_for(doc: &DocumentRow, session: &Session) -> Option<i16> {
    (doc.fields_mode == "personal").then_some(session.profile_id)
}

/// The saved values the helper starts with, for this viewer: `{"mode":..,"fields":{..},"storage":{..}}`.
pub async fn frame_data(
    pool: &PgPool,
    doc: &DocumentRow,
    session: &Session,
) -> sqlx::Result<String> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT kind, key, value FROM document_fields
         WHERE document_id = $1 AND scope_profile_id IS NOT DISTINCT FROM $2 ORDER BY id",
    )
    .bind(doc.id)
    .bind(scope_for(doc, session))
    .fetch_all(pool)
    .await?;
    let (mut fields, mut storage) = (Vec::new(), Vec::new());
    for (kind, key, value) in rows {
        if kind == "field" {
            fields.push((key, value));
        } else {
            storage.push((key, value));
        }
    }
    Ok(json::object(&[
        ("mode", json::string(&doc.fields_mode)),
        ("fields", json_map(&fields)),
        ("storage", json_map(&storage)),
    ]))
}

#[derive(Debug, FromRow)]
pub struct AnnotationRow {
    pub id: i64,
    pub version_no: i32,
    pub author_id: Option<i16>,
    pub author: Option<String>,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub field_key: Option<String>,
    pub field_label: String,
    pub body: String,
    pub created: String,
    pub created_date: String,
    /// The time with a two-digit day, for a signature's caption: 05 Nov 2026, 16:19.
    pub created_full: String,
    pub kind: String,
    pub color: String,
    pub text: String,
    pub anchor_path: Option<String>,
    pub anchor_x: Option<f64>,
    pub anchor_y: Option<f64>,
    pub mentions: Vec<String>,
    pub tool: Option<String>,
    pub points: Option<String>,
    pub stroke_width: Option<f32>,
    pub ref_width: Option<f32>,
    pub ref_height: Option<f32>,
}

impl AnnotationRow {
    /// What a stamp says (empty for other kinds).
    pub fn label(&self) -> String {
        match self.kind.as_str() {
            "stamp" => stamp_label(
                &self.text,
                self.author.as_deref().unwrap_or("someone"),
                &self.created_date,
            ),
            "signature" => signature_caption(
                self.author.as_deref().unwrap_or("someone"),
                &self.created_full,
            ),
            _ => String::new(),
        }
    }
}

#[derive(Debug, FromRow)]
pub struct FieldChange {
    pub key: String,
    pub label: String,
    pub value: String,
    pub by: Option<String>,
    pub at: String,
}

/// What the panel shows about annotations and saved fields.
pub struct Review {
    pub mode: String,
    pub annotations: Vec<AnnotationRow>,
    /// In shared mode, the latest changes to the family copy.
    pub recent: Vec<FieldChange>,
    /// In personal mode, how many answers this person has saved.
    pub own_count: i64,
    pub viewer: i16,
    pub viewer_handle: String,
    pub viewer_is_owner: bool,
    pub can_choose_mode: bool,
}

impl Review {
    pub fn can_delete(&self, row: &AnnotationRow) -> bool {
        self.viewer_is_owner || row.author_id == Some(self.viewer)
    }
    /// Only a mark's author edits or moves it.
    pub fn can_edit(&self, row: &AnnotationRow) -> bool {
        row.author_id == Some(self.viewer)
    }
}

async fn annotations(pool: &PgPool, document_id: i64) -> sqlx::Result<Vec<AnnotationRow>> {
    sqlx::query_as(
        "SELECT a.id, a.version_no, a.author AS author_id, p.handle AS author, a.quote, a.prefix, a.suffix,
                a.field_key, a.field_label, a.body,
                to_char(a.created_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS created,
                to_char(a.created_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY') AS created_date,
                to_char(a.created_at AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY, HH24:MI') AS created_full,
                a.kind, a.color, a.text, a.anchor_path, a.anchor_x, a.anchor_y,
                COALESCE((SELECT array_agg(mp.handle ORDER BY mp.handle) FROM annotation_mentions m
                          JOIN profiles mp ON mp.id = m.profile_id WHERE m.annotation_id = a.id), '{}') AS mentions,
                a.tool, a.points, a.stroke_width, a.ref_width, a.ref_height
         FROM annotations a LEFT JOIN profiles p ON p.id = a.author
         WHERE a.document_id = $1 ORDER BY a.created_at, a.id",
    )
    .bind(document_id)
    .fetch_all(pool)
    .await
}

pub async fn page_data(
    pool: &PgPool,
    doc: &DocumentRow,
    session: &Session,
) -> sqlx::Result<Review> {
    let recent = if doc.fields_mode == "shared" {
        sqlx::query_as(
            "SELECT f.key, f.label, f.value, p.handle AS by,
                    to_char(f.updated_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS at
             FROM document_fields f LEFT JOIN profiles p ON p.id = f.updated_by
             WHERE f.document_id = $1 AND f.scope_profile_id IS NULL AND f.kind = 'field'
             ORDER BY f.updated_at DESC, f.id DESC LIMIT 8",
        )
        .bind(doc.id)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };
    let own_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM document_fields WHERE document_id = $1 AND scope_profile_id = $2 AND kind = 'field'",
    )
    .bind(doc.id)
    .bind(session.profile_id)
    .fetch_one(pool)
    .await?;
    Ok(Review {
        mode: doc.fields_mode.clone(),
        annotations: annotations(pool, doc.id).await?,
        recent,
        own_count,
        viewer: session.profile_id,
        viewer_handle: session.handle.clone(),
        viewer_is_owner: session.is_owner,
        can_choose_mode: documents::can_manage(session, doc),
    })
}

fn reply(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        body,
    )
        .into_response()
}

fn status(code: StatusCode) -> Response {
    code.into_response()
}

/// The form token, from the `X-CSRF-Token` header (a fetch from the page) or the `csrf` field (a
/// plain form), plus the Origin check. Some(true) for a fetch, Some(false) for a form, None when
/// the check fails.
fn checked(
    state: &FamilyState,
    headers: &HeaderMap,
    session: &Session,
    field: &str,
) -> Option<bool> {
    let from_header = headers.get("x-csrf-token").and_then(|v| v.to_str().ok());
    let token = from_header.unwrap_or(field);
    let ok = !token.is_empty()
        && web::same_origin(headers, &state.expected_origin(headers))
        && auth::ct_eq(session.csrf.as_bytes(), token.as_bytes());
    ok.then_some(from_header.is_some())
}

/// The signed-in person and the document an address names; None when either is missing.
async fn session_and_doc(
    state: &FamilyState,
    headers: &HeaderMap,
    key: &str,
) -> Result<Result<(Session, DocumentRow), Response>, super::handlers::Fail> {
    let Some(session) = documents::signed_in(state, headers).await? else {
        return Ok(Err(status(StatusCode::UNAUTHORIZED)));
    };
    match documents::resolve(state, key, "").await? {
        Ok(doc) => Ok(Ok((session, doc))),
        Err(_) => Ok(Err(status(StatusCode::NOT_FOUND))),
    }
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

#[derive(Deserialize)]
pub struct FieldForm {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    op: String,
    #[serde(default)]
    key: String,
    #[serde(default)]
    value: String,
    #[serde(default)]
    label: String,
}

/// Saves one field or storage value for this viewer's copy (fetch only, with the form token).
pub async fn save_field(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<FieldForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    if checked(&state, &headers, &session, "") != Some(true) {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    let limit = match form.kind.as_str() {
        "field" => MAX_FIELD_VALUE,
        "storage" => MAX_STORAGE_VALUE,
        _ => return Ok(status(StatusCode::BAD_REQUEST)),
    };
    let op = if form.op.is_empty() {
        "set"
    } else {
        form.op.as_str()
    };
    let key_ok = (1..=MAX_KEY).contains(&chars(&form.key));
    let scope = scope_for(&doc, &session);
    match op {
        "set" => {
            if !key_ok || chars(&form.value) > limit || chars(&form.label) > MAX_LABEL {
                return Ok(status(StatusCode::BAD_REQUEST));
            }
            let (exists, count): (bool, i64) = sqlx::query_as(
                "SELECT bool_or(key = $4), count(*) FROM document_fields
                 WHERE document_id = $1 AND scope_profile_id IS NOT DISTINCT FROM $2 AND kind = $3",
            )
            .bind(doc.id)
            .bind(scope)
            .bind(&form.kind)
            .bind(&form.key)
            .fetch_one(&state.pool)
            .await
            .map(|(e, c): (Option<bool>, i64)| (e.unwrap_or(false), c))?;
            if !exists && count >= MAX_KEYS {
                return Ok(status(StatusCode::PAYLOAD_TOO_LARGE));
            }
            let label = if form.kind == "field" {
                form.label.as_str()
            } else {
                ""
            };
            sqlx::query(
                "INSERT INTO document_fields (document_id, scope_profile_id, kind, key, label, value, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT ON CONSTRAINT document_fields_unique
                 DO UPDATE SET label = EXCLUDED.label, value = EXCLUDED.value,
                               updated_by = EXCLUDED.updated_by, updated_at = now()",
            )
            .bind(doc.id)
            .bind(scope)
            .bind(&form.kind)
            .bind(&form.key)
            .bind(label)
            .bind(&form.value)
            .bind(session.profile_id)
            .execute(&state.pool)
            .await?;
        }
        "remove" => {
            if !key_ok {
                return Ok(status(StatusCode::BAD_REQUEST));
            }
            sqlx::query(
                "DELETE FROM document_fields
                 WHERE document_id = $1 AND scope_profile_id IS NOT DISTINCT FROM $2 AND kind = $3 AND key = $4",
            )
            .bind(doc.id)
            .bind(scope)
            .bind(&form.kind)
            .bind(&form.key)
            .execute(&state.pool)
            .await?;
        }
        "clear" if form.kind == "storage" => {
            sqlx::query(
                "DELETE FROM document_fields
                 WHERE document_id = $1 AND scope_profile_id IS NOT DISTINCT FROM $2 AND kind = 'storage'",
            )
            .bind(doc.id)
            .bind(scope)
            .execute(&state.pool)
            .await?;
        }
        _ => return Ok(status(StatusCode::BAD_REQUEST)),
    }
    Ok(status(StatusCode::NO_CONTENT))
}

fn annotation_json(row: &AnnotationRow, can_delete: bool, can_edit: bool) -> String {
    let number = |v: Option<f64>| v.map(|v| v.to_string()).unwrap_or_else(|| "null".into());
    let wide = |v: Option<f32>| v.map(|v| v.to_string()).unwrap_or_else(|| "null".into());
    json::object(&[
        ("id", json::string(&row.id.to_string())),
        ("version", row.version_no.to_string()),
        (
            "author",
            json::string(row.author.as_deref().unwrap_or("someone")),
        ),
        ("kind", json::string(&row.kind)),
        ("color", json::string(&row.color)),
        ("quote", json::string(&row.quote)),
        ("prefix", json::string(&row.prefix)),
        ("suffix", json::string(&row.suffix)),
        (
            "field",
            json::string(row.field_key.as_deref().unwrap_or("")),
        ),
        ("field_label", json::string(&row.field_label)),
        ("body", json::string(&row.body)),
        ("text", json::string(&row.text)),
        ("label", json::string(&row.label())),
        (
            "path",
            json::string(row.anchor_path.as_deref().unwrap_or("")),
        ),
        ("x", number(row.anchor_x)),
        ("y", number(row.anchor_y)),
        ("mentions", json::strings(&row.mentions)),
        ("tool", json::string(row.tool.as_deref().unwrap_or(""))),
        ("points", json::string(row.points.as_deref().unwrap_or(""))),
        ("width", wide(row.stroke_width)),
        ("ref", wide(row.ref_width)),
        ("refh", wide(row.ref_height)),
        ("created", json::string(&row.created)),
        ("can_delete", can_delete.to_string()),
        ("can_edit", can_edit.to_string()),
    ])
}

/// Every annotation on a document, as JSON. Members only.
pub async fn list_annotations(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let rows = annotations(&state.pool, doc.id).await?;
    let items: Vec<String> = rows
        .iter()
        .map(|r| {
            annotation_json(
                r,
                session.is_owner || r.author_id == Some(session.profile_id),
                r.author_id == Some(session.profile_id),
            )
        })
        .collect();
    Ok(reply(StatusCode::OK, format!("[{}]", items.join(","))))
}

#[derive(Deserialize, Default)]
pub struct AnnotationForm {
    #[serde(default)]
    pub csrf: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    #[serde(default)]
    pub field_key: String,
    #[serde(default)]
    pub field_label: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub anchor_path: String,
    #[serde(default)]
    pub anchor_x: String,
    #[serde(default)]
    pub anchor_y: String,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub points: String,
    #[serde(default)]
    pub stroke_width: String,
    #[serde(default)]
    pub ref_width: String,
    #[serde(default)]
    pub ref_height: String,
}

/// The active family handles, for @mentions.
async fn family_handles(pool: &PgPool) -> sqlx::Result<Vec<String>> {
    Ok(store::active_profiles(pool)
        .await?
        .into_iter()
        .map(|p| p.handle)
        .collect())
}

/// Records who an annotation mentions (replacing any earlier list). The author is left out.
async fn save_mentions(
    pool: &PgPool,
    annotation_id: i64,
    author: i16,
    texts: &[&str],
) -> sqlx::Result<()> {
    let handles = family_handles(pool).await?;
    let mut named: Vec<String> = Vec::new();
    for text in texts {
        for handle in mentions(text, &handles) {
            if !named.contains(&handle) {
                named.push(handle);
            }
        }
    }
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM annotation_mentions WHERE annotation_id = $1")
        .bind(annotation_id)
        .execute(&mut *tx)
        .await?;
    for handle in named {
        sqlx::query(
            "INSERT INTO annotation_mentions (annotation_id, profile_id)
             SELECT $1, id FROM profiles WHERE handle = $2 AND active AND id <> $3
             ON CONFLICT DO NOTHING",
        )
        .bind(annotation_id)
        .bind(handle)
        .bind(author)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Adds an annotation: from the page's composer (fetch, JSON reply) or a plain form (back to the
/// panel). Any family member may annotate.
pub async fn create_annotation(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<AnnotationForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let Some(fetch) = checked(&state, &headers, &session, &form.csrf) else {
        return Ok(status(StatusCode::FORBIDDEN));
    };
    let mut mark = match check_mark(&form) {
        Ok(mark) => mark,
        Err(_) if fetch => return Ok(status(StatusCode::BAD_REQUEST)),
        Err(_) => {
            return documents::show(
                &state,
                &session,
                &doc,
                StatusCode::BAD_REQUEST,
                Some("The comment was not saved. Write between 1 and 4000 characters."),
            )
            .await;
        }
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM annotations WHERE document_id = $1")
        .bind(doc.id)
        .fetch_one(&state.pool)
        .await?;
    if count >= MAX_ANNOTATIONS {
        return Ok(status(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let (path, x, y) = match &mark.anchor {
        Some((path, x, y)) => (Some(path.as_str()), Some(*x), Some(*y)),
        None => (None, None, None),
    };
    // A signature is always the signer's own, as saved now.
    let mut signed_strokes: Option<String> = None;
    if mark.kind == "signature" {
        match signature::saved(&state.pool, session.profile_id).await? {
            Some((style, value)) if style == "drawn" => signed_strokes = Some(value),
            Some((_, name)) => mark.text = name,
            None => return Ok(status(StatusCode::CONFLICT)),
        }
    }
    let drawing = mark.drawing.as_ref();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO annotations (document_id, version_no, author, quote, prefix, suffix, field_key, field_label, body,
                                  kind, color, text, anchor_path, anchor_x, anchor_y, tool, points, stroke_width, ref_width, ref_height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id",
    )
    .bind(doc.id)
    .bind(doc.version_no)
    .bind(session.profile_id)
    .bind(&mark.quote)
    .bind(&mark.prefix)
    .bind(&mark.suffix)
    .bind(mark.field_key.as_deref())
    .bind(&mark.field_label)
    .bind(&mark.body)
    .bind(&mark.kind)
    .bind(&mark.color)
    .bind(&mark.text)
    .bind(path)
    .bind(x)
    .bind(y)
    .bind(drawing.map(|d| d.tool.as_str()))
    .bind(
        drawing
            .map(|d| d.points.as_str())
            .or(signed_strokes.as_deref()),
    )
    .bind(drawing.map(|d| d.stroke_width))
    .bind(drawing.map(|d| d.ref_width))
    .bind(drawing.and_then(|d| d.ref_height))
    .fetch_one(&state.pool)
    .await?;
    let words: [&str; 2] = if mark.kind == "signature" {
        ["", ""]
    } else {
        [&mark.body, &mark.text]
    };
    save_mentions(&state.pool, id, session.profile_id, &words).await?;
    if !fetch {
        return Ok(documents::back_to_panel(&doc));
    }
    let row = annotations(&state.pool, doc.id)
        .await?
        .into_iter()
        .find(|r| r.id == id);
    Ok(match row {
        Some(row) => reply(StatusCode::CREATED, annotation_json(&row, true, true)),
        None => status(StatusCode::CREATED),
    })
}

#[derive(Deserialize)]
pub struct UpdateForm {
    #[serde(default)]
    op: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    anchor_path: String,
    #[serde(default)]
    anchor_x: String,
    #[serde(default)]
    anchor_y: String,
}

/// Edits a mark's words or moves a placed mark: its author only (fetch with the form token).
pub async fn update_annotation(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path((key, id)): Path<(String, i64)>,
    Form(form): Form<UpdateForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    if checked(&state, &headers, &session, "") != Some(true) {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    let found: Option<(Option<i16>, String)> =
        sqlx::query_as("SELECT author, kind FROM annotations WHERE id = $1 AND document_id = $2")
            .bind(id)
            .bind(doc.id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((author, kind)) = found else {
        return Ok(status(StatusCode::NOT_FOUND));
    };
    if author != Some(session.profile_id) {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    match form.op.as_str() {
        "move" => {
            if !PLACED.contains(&kind.as_str()) {
                return Ok(status(StatusCode::BAD_REQUEST));
            }
            let Ok(Some((path, x, y))) =
                anchor_of(&form.anchor_path, &form.anchor_x, &form.anchor_y)
            else {
                return Ok(status(StatusCode::BAD_REQUEST));
            };
            sqlx::query(
                "UPDATE annotations SET anchor_path = $2, anchor_x = $3, anchor_y = $4, updated_at = now() WHERE id = $1",
            )
            .bind(id)
            .bind(path)
            .bind(x)
            .bind(y)
            .execute(&state.pool)
            .await?;
        }
        "edit" => {
            let body = form.body.trim();
            let text = form.text.trim();
            let ok = match kind.as_str() {
                "comment" | "note" | "textbox" => {
                    (1..=MAX_BODY).contains(&chars(body)) && text.is_empty()
                }
                "insert" | "replace" => {
                    (1..=MAX_TEXT).contains(&chars(text)) && chars(body) <= MAX_BODY
                }
                // What was signed is not edited; delete it and sign again instead.
                "signature" => false,
                _ => chars(body) <= MAX_BODY && text.is_empty(),
            };
            if !ok {
                return Ok(status(StatusCode::BAD_REQUEST));
            }
            if kind == "insert" || kind == "replace" {
                sqlx::query(
                    "UPDATE annotations SET body = $2, text = $3, updated_at = now() WHERE id = $1",
                )
                .bind(id)
                .bind(body)
                .bind(text)
                .execute(&state.pool)
                .await?;
            } else {
                sqlx::query("UPDATE annotations SET body = $2, updated_at = now() WHERE id = $1")
                    .bind(id)
                    .bind(body)
                    .execute(&state.pool)
                    .await?;
            }
            let stored: (String, String) =
                sqlx::query_as("SELECT body, text FROM annotations WHERE id = $1")
                    .bind(id)
                    .fetch_one(&state.pool)
                    .await?;
            save_mentions(&state.pool, id, session.profile_id, &[&stored.0, &stored.1]).await?;
        }
        _ => return Ok(status(StatusCode::BAD_REQUEST)),
    }
    let row = annotations(&state.pool, doc.id)
        .await?
        .into_iter()
        .find(|r| r.id == id);
    Ok(match row {
        Some(row) => reply(StatusCode::OK, annotation_json(&row, true, true)),
        None => status(StatusCode::NOT_FOUND),
    })
}

/// Undo in the drawing toolbar: deletes the person's own most recent drawing on this document
/// (fetch only, with the form token). Replies with its id, or 404 when there is none.
pub async fn undo_drawing(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    if checked(&state, &headers, &session, "") != Some(true) {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    let id: Option<i64> = sqlx::query_scalar(
        "DELETE FROM annotations WHERE id = (
             SELECT id FROM annotations
             WHERE document_id = $1 AND author = $2 AND kind IN ('ink', 'shape')
             ORDER BY created_at DESC, id DESC LIMIT 1)
         RETURNING id",
    )
    .bind(doc.id)
    .bind(session.profile_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(id) = id else {
        return Ok(status(StatusCode::NOT_FOUND));
    };
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "annotation deleted",
        &format!(
            "{} annotation {id} (drawing undone)",
            doccheck::filing_label(&doc.key)
        ),
    )
    .await?;
    Ok(reply(
        StatusCode::OK,
        json::object(&[("id", json::string(&id.to_string()))]),
    ))
}

/// The family's handles, for the @mention list. Members only.
pub async fn handles(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    if documents::signed_in(&state, &headers).await?.is_none() {
        return Ok(status(StatusCode::UNAUTHORIZED));
    }
    let handles = family_handles(&state.pool).await?;
    Ok(reply(StatusCode::OK, json::strings(&handles)))
}

#[derive(Debug, FromRow)]
pub struct MentionRow {
    pub annotation_id: i64,
    pub key: String,
    pub title: String,
    pub kind: String,
    pub quote: String,
    pub by: Option<String>,
    pub at: String,
}

/// Where a person was @mentioned, newest first (Home: "Mentioned you").
pub async fn mentions_for(pool: &PgPool, profile_id: i16) -> sqlx::Result<Vec<MentionRow>> {
    sqlx::query_as(
        "SELECT a.id AS annotation_id, to_char(d.filed_on, 'YYYY-MMDD') || '_' || d.day_no AS key, d.title,
                a.kind, a.quote, p.handle AS by,
                to_char(a.created_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS at
         FROM annotation_mentions m
         JOIN annotations a ON a.id = m.annotation_id
         JOIN documents d ON d.id = a.document_id AND d.deleted_at IS NULL
         LEFT JOIN profiles p ON p.id = a.author
         WHERE m.profile_id = $1
         ORDER BY a.created_at DESC, a.id DESC LIMIT 20",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await
}

#[derive(Deserialize)]
pub struct TokenForm {
    #[serde(default)]
    csrf: String,
}

/// Deletes an annotation: its author or the owner only.
pub async fn delete_annotation(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path((key, id)): Path<(String, i64)>,
    Form(form): Form<TokenForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let Some(fetch) = checked(&state, &headers, &session, &form.csrf) else {
        return Ok(status(StatusCode::FORBIDDEN));
    };
    let author: Option<Option<i16>> =
        sqlx::query_scalar("SELECT author FROM annotations WHERE id = $1 AND document_id = $2")
            .bind(id)
            .bind(doc.id)
            .fetch_optional(&state.pool)
            .await?;
    let Some(author) = author else {
        return Ok(status(StatusCode::NOT_FOUND));
    };
    if !(session.is_owner || author == Some(session.profile_id)) {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    sqlx::query("DELETE FROM annotations WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "annotation deleted",
        &format!("{} annotation {id}", doccheck::filing_label(&doc.key)),
    )
    .await?;
    Ok(if fetch {
        status(StatusCode::NO_CONTENT)
    } else {
        documents::back_to_panel(&doc)
    })
}

#[derive(Deserialize)]
pub struct ModeForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    mode: String,
}

/// Chooses shared or personal fields: the uploader or the owner only.
pub async fn set_mode(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<ModeForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    if checked(&state, &headers, &session, &form.csrf).is_none() {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    if !documents::can_manage(&session, &doc) {
        return Ok(status(StatusCode::FORBIDDEN));
    }
    if !matches!(form.mode.as_str(), "shared" | "personal") {
        return Ok(status(StatusCode::BAD_REQUEST));
    }
    sqlx::query("UPDATE documents SET fields_mode = $2 WHERE id = $1")
        .bind(doc.id)
        .bind(&form.mode)
        .execute(&state.pool)
        .await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document fields mode",
        &format!("{}: {}", doccheck::filing_label(&doc.key), form.mode),
    )
    .await?;
    Ok(documents::back_to_panel(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(kind: &str) -> AnnotationForm {
        AnnotationForm {
            kind: kind.into(),
            ..AnnotationForm::default()
        }
    }

    #[test]
    fn element_paths_and_fractions() {
        for good in ["body:1", "section:2/p:3", "h2:1", "my-tag:12/div:1"] {
            assert!(valid_path(good), "{good}");
        }
        for bad in [
            "",
            "p",
            "p:0",
            "P:1",
            "1p:1",
            "p:1/",
            "p:1//div:2",
            "p:x",
            "p:123456",
            "p:1 /div:2",
            "p:1;drop",
        ] {
            assert!(!valid_path(bad), "{bad}");
        }
        assert!(!valid_path("p:1/".repeat(26).trim_end_matches('/')));
        assert_eq!(fraction("0.25"), Some(0.25));
        assert_eq!(fraction("1"), Some(1.0));
        for bad in ["-0.1", "1.01", "NaN", "inf", "", "x"] {
            assert_eq!(fraction(bad), None, "{bad}");
        }
    }

    #[test]
    fn mentions_are_family_handles_only() {
        let handles: Vec<String> = ["alpha", "beta"].map(String::from).to_vec();
        assert_eq!(
            mentions(
                "Ask @Beta and @alpha, then @beta again; not mail@alpha or @gamma",
                &handles
            ),
            vec!["beta", "alpha"]
        );
        assert!(
            mentions("@alphabet", &handles).is_empty(),
            "whole names only"
        );
        assert_eq!(mentions("(@alpha)", &handles), vec!["alpha"]);
    }

    #[test]
    fn each_kind_needs_what_it_uses() {
        let mut f = form("highlight");
        assert!(check_mark(&f).is_err(), "a highlight needs a passage");
        f.quote = "Two bedrooms".into();
        f.color = "green".into();
        let mark = check_mark(&f).unwrap();
        assert_eq!(
            (mark.kind.as_str(), mark.color.as_str()),
            ("highlight", "green")
        );
        f.color = "red".into();
        assert!(check_mark(&f).is_err(), "fixed colours only");
        f.color = String::new();
        f.text = "extra".into();
        assert!(check_mark(&f).is_err(), "a highlight has no text");

        let mut insert = form("insert");
        insert.text = "very".into();
        assert!(check_mark(&insert).is_err(), "an insert needs a place");
        insert.prefix = "a ".into();
        assert!(check_mark(&insert).is_ok(), "a point is enough");

        let mut replace = form("replace");
        replace.quote = "two".into();
        assert!(check_mark(&replace).is_err());
        replace.text = "three".into();
        assert!(check_mark(&replace).is_ok());

        let mut note = form("note");
        note.body = "Remember".into();
        assert!(check_mark(&note).is_err(), "a note needs a place");
        note.anchor_path = "section:1/p:2".into();
        note.anchor_x = "0.5".into();
        assert!(check_mark(&note).is_err(), "all three anchor values");
        note.anchor_y = "0.1".into();
        assert_eq!(
            check_mark(&note).unwrap().anchor,
            Some(("section:1/p:2".into(), 0.5, 0.1))
        );
        note.anchor_y = "2".into();
        assert!(check_mark(&note).is_err());

        let mut stamp = form("stamp");
        stamp.anchor_path = "p:1".into();
        stamp.anchor_x = "0".into();
        stamp.anchor_y = "0".into();
        stamp.text = "approved".into();
        assert!(check_mark(&stamp).is_ok());
        stamp.text = "Approved by the bank".into();
        assert!(check_mark(&stamp).is_err(), "fixed stamps only");

        let mut comment = form("");
        assert!(check_mark(&comment).is_err(), "a comment needs words");
        comment.body = "Fine".into();
        comment.anchor_path = "p:1".into();
        comment.anchor_x = "0".into();
        comment.anchor_y = "0".into();
        assert!(check_mark(&comment).is_err(), "comments are not placed");
        assert!(check_mark(&form("drawing")).is_err());
        let mut long = form("textbox");
        long.body = "x".repeat(MAX_BODY + 1);
        assert!(check_mark(&long).is_err());
    }

    fn drawing(kind: &str, tool: &str, points: &str) -> AnnotationForm {
        AnnotationForm {
            kind: kind.into(),
            tool: tool.into(),
            points: points.into(),
            stroke_width: "4".into(),
            ref_width: "640".into(),
            anchor_path: "body:1/p:2".into(),
            anchor_x: "0.1".into(),
            anchor_y: "0.5".into(),
            ..AnnotationForm::default()
        }
    }

    #[test]
    fn drawing_points_are_numbers_within_limits() {
        assert_eq!(
            parse_points("1,2,0.5 -3.5,40.25,1", true, 2, MAX_POINTS),
            Some(vec![[1.0, 2.0, 0.5], [-3.5, 40.25, 1.0]])
        );
        assert_eq!(
            parse_points("0,0 10.5,-2", false, 2, 2),
            Some(vec![[0.0, 0.0, 0.5], [10.5, -2.0, 0.5]])
        );
        for bad in [
            "",
            "1,2,0.5",
            "1,2 3,4",
            "1,2,0.5  3,4,0.5",
            "1,2,1.5 3,4,0.5",
            "1,2,0.5 3,4,-0.1",
            "1e3,2,0.5 3,4,0.5",
            "1,2,0.5 3,4,0.5 ",
            "0x1,2,0.5 3,4,0.5",
            "1.,2,0.5 3,4,0.5",
            "1.234,2,0.5 3,4,0.5",
            "NaN,2,0.5 3,4,0.5",
            "1,2,0.5;3,4,0.5",
            "200000,2,0.5 3,4,0.5",
        ] {
            assert_eq!(parse_points(bad, true, 2, MAX_POINTS), None, "{bad:?}");
        }
        let many = vec!["1,1,0.5"; MAX_POINTS + 1].join(" ");
        assert_eq!(
            parse_points(&many, true, 2, MAX_POINTS),
            None,
            "at most 600 points"
        );
        assert!(
            parse_points(&vec!["1,1,0.5"; MAX_POINTS].join(" "), true, 2, MAX_POINTS).is_some()
        );
        assert_eq!(
            parse_points("0,0 1,1 2,2", false, 2, 2),
            None,
            "a shape has two points"
        );
        assert_eq!(
            format_points(&[[1.0, -0.04, 0.5], [2.26, 3.0, 1.0]], true),
            "1,0,0.5 2.3,3,1"
        );
        assert_eq!(format_points(&[[10.0, 20.0, 0.5]], false), "10,20");
    }

    #[test]
    fn drawings_need_a_tool_points_and_a_place() {
        let ink = check_mark(&drawing("ink", "draw", "0,0,0.5 10,5,0.6 20,9.96,0.7")).unwrap();
        let d = ink.drawing.unwrap();
        assert_eq!(
            (
                d.tool.as_str(),
                d.points.as_str(),
                d.stroke_width,
                d.ref_width
            ),
            ("draw", "0,0,0.5 10,5,0.6 20,10,0.7", 4.0, 640.0)
        );
        assert_eq!(d.ref_height, None, "the height is optional");
        let mut tall = drawing("ink", "draw", "0,0,0.5 10,5,0.6");
        tall.ref_height = "48".into();
        assert_eq!(
            check_mark(&tall).unwrap().drawing.unwrap().ref_height,
            Some(48.0)
        );
        tall.ref_height = "0".into();
        assert!(check_mark(&tall).is_err(), "a zero height is refused");
        let mut stray = AnnotationForm {
            kind: "note".into(),
            ..AnnotationForm::default()
        };
        stray.ref_height = "48".into();
        assert!(check_mark(&stray).is_err(), "only drawings carry a height");
        assert!(check_mark(&drawing("shape", "oval", "0,0 30,20")).is_ok());
        assert!(
            check_mark(&drawing("shape", "draw", "0,0 30,20")).is_err(),
            "ink tools are not shapes"
        );
        assert!(
            check_mark(&drawing("ink", "arrow", "0,0,0.5 3,3,0.5")).is_err(),
            "shape tools are not ink"
        );
        assert!(
            check_mark(&drawing("shape", "line", "5,5 5.5,5")).is_err(),
            "a shape needs a size"
        );
        assert!(
            check_mark(&drawing("ink", "draw", "0,0 3,3")).is_err(),
            "ink carries pressure"
        );
        let mut no_place = drawing("ink", "sketch", "0,0,0.5 3,3,0.5");
        no_place.anchor_path.clear();
        no_place.anchor_x.clear();
        no_place.anchor_y.clear();
        assert!(check_mark(&no_place).is_err(), "a drawing needs a place");
        let mut wide = drawing("ink", "draw", "0,0,0.5 3,3,0.5");
        wide.stroke_width = "40".into();
        assert!(check_mark(&wide).is_err(), "line width 1 to 24");
        wide.stroke_width = "4".into();
        wide.ref_width = "0".into();
        assert!(check_mark(&wide).is_err(), "a reference width");
        let mut words = drawing("ink", "draw", "0,0,0.5 3,3,0.5");
        words.body = "hello".into();
        assert!(check_mark(&words).is_err(), "drawings carry no words");
        let mut stray = form("highlight");
        stray.quote = "x".into();
        stray.points = "0,0 1,1".into();
        assert!(check_mark(&stray).is_err(), "only drawings have points");
    }

    #[test]
    fn stamps_say_what_they_are() {
        assert_eq!(stamp_label("check", "beta", "5 Nov 2026"), "✓");
        assert_eq!(stamp_label("approved", "beta", "5 Nov 2026"), "Approved");
        assert_eq!(
            stamp_label("signedoff", "beta", "5 Nov 2026"),
            "Signed off · beta · 5 Nov 2026"
        );
        assert_eq!(stamp_label("other", "beta", "x"), "");
    }

    #[test]
    fn the_helper_goes_after_head_or_the_doctype() {
        let at = |s: &str| injection_point(s.as_bytes());
        assert_eq!(at("<!doctype html><html><head><title>x</title>"), 27);
        assert_eq!(at("<HTML><HEAD lang=\"en\">x"), 22);
        assert_eq!(
            at("<!DOCTYPE html>\n<html><body>x"),
            15,
            "no head: after the doctype"
        );
        assert_eq!(at("<p>no head</p>"), 0);
        assert_eq!(at("\u{feff}<p>x</p>"), 3, "after a byte-order mark");
        assert_eq!(at("<!-- <head> --><head>x"), 21, "comments are skipped");
        assert_eq!(
            at("<html><header>x</header><head>"),
            30,
            "<header> is not <head>"
        );
        assert_eq!(at("<body><head>"), 0, "nothing after <body>");
        let far = format!("<!doctype html>{}<head>", " ".repeat(70 * 1024));
        assert_eq!(at(&far), 15, "only the first 64 KB are searched");
    }

    #[test]
    fn injection_keeps_every_original_byte() {
        let original = b"<!doctype html><html><head><title>t</title></head><body>b</body></html>";
        let out = inject(original, "<script>S</script>");
        assert_eq!(
            out,
            b"<!doctype html><html><head><script>S</script><title>t</title></head><body>b</body></html>"
        );
        let mut back = out.clone();
        back.drain(27..27 + "<script>S</script>".len());
        assert_eq!(back, original);
    }

    #[test]
    fn the_helper_script_is_safe_to_inline() {
        assert!(!HELPER_JS.to_ascii_lowercase().contains("</script"));
        assert_eq!(HELPER_JS.matches(PLACEHOLDER).count(), 1);
        let data = json::object(&[("fields", json_map(&[("k".into(), "</script><b>".into())]))]);
        let script = helper_script(&data);
        assert!(script.starts_with("<script data-hj-helper>") && script.ends_with("</script>"));
        assert_eq!(
            script.matches("</script").count(),
            1,
            "the data cannot end the script"
        );
        assert!(script.contains(r#"{"fields":{"k":"\u003c/script\u003e\u003cb\u003e"}}"#));
        assert!(!script.contains(PLACEHOLDER));
    }
}
