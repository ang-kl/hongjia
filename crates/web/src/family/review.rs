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

use super::documents::{self, DocumentRow};
use super::store::{self, Session};
use super::{FamilyState, auth, doccheck, json, web};
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
    pub viewer_is_owner: bool,
    pub can_choose_mode: bool,
}

impl Review {
    pub fn can_delete(&self, row: &AnnotationRow) -> bool {
        self.viewer_is_owner || row.author_id == Some(self.viewer)
    }
}

async fn annotations(pool: &PgPool, document_id: i64) -> sqlx::Result<Vec<AnnotationRow>> {
    sqlx::query_as(
        "SELECT a.id, a.version_no, a.author AS author_id, p.handle AS author, a.quote, a.prefix, a.suffix,
                a.field_key, a.field_label, a.body,
                to_char(a.created_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS created
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

fn annotation_json(row: &AnnotationRow, can_delete: bool) -> String {
    json::object(&[
        ("id", json::string(&row.id.to_string())),
        ("version", row.version_no.to_string()),
        (
            "author",
            json::string(row.author.as_deref().unwrap_or("someone")),
        ),
        ("quote", json::string(&row.quote)),
        ("prefix", json::string(&row.prefix)),
        ("suffix", json::string(&row.suffix)),
        (
            "field",
            json::string(row.field_key.as_deref().unwrap_or("")),
        ),
        ("field_label", json::string(&row.field_label)),
        ("body", json::string(&row.body)),
        ("created", json::string(&row.created)),
        ("can_delete", can_delete.to_string()),
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
            )
        })
        .collect();
    Ok(reply(StatusCode::OK, format!("[{}]", items.join(","))))
}

#[derive(Deserialize)]
pub struct AnnotationForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    prefix: String,
    #[serde(default)]
    suffix: String,
    #[serde(default)]
    field_key: String,
    #[serde(default)]
    field_label: String,
    #[serde(default)]
    body: String,
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
    let body = form.body.trim();
    let valid = (1..=MAX_BODY).contains(&chars(body))
        && chars(&form.quote) <= MAX_QUOTE
        && chars(&form.prefix) <= MAX_AROUND
        && chars(&form.suffix) <= MAX_AROUND
        && chars(&form.field_key) <= MAX_KEY
        && chars(&form.field_label) <= MAX_LABEL;
    if !valid {
        return if fetch {
            Ok(status(StatusCode::BAD_REQUEST))
        } else {
            documents::show(
                &state,
                &session,
                &doc,
                StatusCode::BAD_REQUEST,
                Some("The comment was not saved. Write between 1 and 4000 characters."),
            )
            .await
        };
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM annotations WHERE document_id = $1")
        .bind(doc.id)
        .fetch_one(&state.pool)
        .await?;
    if count >= MAX_ANNOTATIONS {
        return Ok(status(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let field_key = (!form.field_key.is_empty()).then_some(form.field_key.as_str());
    let field_label = if field_key.is_some() {
        form.field_label.as_str()
    } else {
        ""
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO annotations (document_id, version_no, author, quote, prefix, suffix, field_key, field_label, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    )
    .bind(doc.id)
    .bind(doc.version_no)
    .bind(session.profile_id)
    .bind(&form.quote)
    .bind(&form.prefix)
    .bind(&form.suffix)
    .bind(field_key)
    .bind(field_label)
    .bind(body)
    .fetch_one(&state.pool)
    .await?;
    if !fetch {
        return Ok(documents::back_to_panel(&doc));
    }
    let row = annotations(&state.pool, doc.id)
        .await?
        .into_iter()
        .find(|r| r.id == id);
    Ok(match row {
        Some(row) => reply(StatusCode::CREATED, annotation_json(&row, true)),
        None => status(StatusCode::CREATED),
    })
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
