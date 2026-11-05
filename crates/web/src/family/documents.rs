//! Documents (P2a, P2b): upload, list and view HTML or text files, each filed under a dated number
//! (`2026-1105_1`, shown as `2026-1105_#1`), with a management panel beside it: hashtags, versions,
//! the upload check, rename and permanent delete. Only the person who added a document, or the
//! owner, may change or delete it; every family member may read it.
//!
//! Uploaded HTML never runs with the site's own powers. It is served with a `sandbox` Content
//! Security Policy (an opaque origin: no cookies, no storage, no forms, no top-level navigation)
//! and shown inside an `<iframe sandbox>` without `allow-same-origin`. Its own scripts, scripts and
//! styles from a few public library sites (the owner's design stack), images from https sites,
//! pop-up links and printing still work.

use super::doccheck::{self, Filing};
use super::pages::{self, Nav};
use super::picture;
use super::store::Session;
use super::{FamilyState, auth, review, store, web};
use axum::{
    Form,
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode, Uri, header},
    response::{IntoResponse, Redirect, Response},
};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};

pub const MAX_BYTES: usize = 10 * 1024 * 1024;

/// The policy for uploaded documents: sandboxed; inline scripts and styles; scripts, styles and
/// fetches only from the library sites in `doccheck`; pictures and media from https sites.
pub const DOCUMENT_CSP: &str = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; img-src https: data: blob:; media-src https: blob:; font-src https: data:; connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; form-action 'none'; frame-src https://maps.google.com/maps https://www.google.com/maps/ https://www.instagram.com/ https://www.tiktok.com/embed/; base-uri 'none'; frame-ancestors 'self'";

/// The iframe's own sandbox, matching the policy above. `allow-same-origin` is never given.
pub const IFRAME_SANDBOX: &str =
    "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals";

/// The word a person types to confirm a permanent delete.
pub const DELETE_WORD: &str = "DELETE";

/// Which kind of document a file name is, or None if it is not accepted yet. A picture's name is
/// only a first guess: its first bytes must also be a JPEG, PNG or WebP (`picture::info`).
pub fn kind_for(filename: &str) -> Option<&'static str> {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        Some("html")
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        Some("text")
    } else if [".jpg", ".jpeg", ".png", ".webp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        Some("picture")
    } else {
        None
    }
}

/// A safe title: trimmed, no control characters, at most 120 characters; falls back to the file name.
pub fn clean_title(title: &str, filename: &str) -> String {
    let source = if title.trim().is_empty() {
        filename
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(filename)
    } else {
        title
    };
    let cleaned: String = source
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    if cleaned.is_empty() {
        "Untitled".into()
    } else {
        cleaned
    }
}

#[derive(Debug, FromRow)]
pub struct DocumentRow {
    pub id: i64,
    /// The address form of the filing number, for example 2026-1105_1.
    pub key: String,
    /// The month it was filed, for grouping the list, for example "November 2026".
    pub month: String,
    pub title: String,
    pub created_by: Option<i16>,
    pub added_by: Option<String>,
    pub version_no: i32,
    pub filename: String,
    pub kind: String,
    pub size_bytes: i32,
    pub uploaded_by: Option<String>,
    pub uploaded_at: String,
    pub tags: Vec<String>,
    /// Whether what people fill in is one family copy ("shared") or kept per person ("personal").
    pub fields_mode: String,
    /// The last change in Singapore time, as the owner asked: "03:15PM 05-11" (hh:mmAM/PM DD-MM).
    /// A new version, a comment, or a shared saved field counts; personal answers and a page's own
    /// browser storage do not.
    pub changed: String,
}

#[derive(Debug, FromRow)]
pub struct VersionRow {
    pub version_no: i32,
    pub filename: String,
    pub kind: String,
    pub size_bytes: i32,
    pub uploaded_by: Option<String>,
    pub uploaded_at: String,
    pub libraries: Vec<String>,
    pub style_guess: Option<String>,
    pub warnings: Vec<String>,
    pub field_count: i32,
    pub heading_levels: Vec<i16>,
    pub heading_ids: Vec<String>,
    pub heading_texts: Vec<String>,
    /// D3: a picture's type and size (None for other kinds).
    pub image_type: Option<String>,
    pub image_width: Option<i32>,
    pub image_height: Option<i32>,
}

pub(super) async fn list(pool: &PgPool) -> sqlx::Result<Vec<DocumentRow>> {
    sqlx::query_as(
        "SELECT d.id, to_char(d.filed_on, 'YYYY-MMDD') || '_' || d.day_no AS key,
                to_char(d.filed_on, 'FMMonth YYYY') AS month, d.title, d.created_by, c.handle AS added_by,
                v.version_no, v.filename, v.kind, v.size_bytes, p.handle AS uploaded_by,
                to_char(v.uploaded_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS uploaded_at,
                COALESCE((SELECT array_agg(t.tag ORDER BY t.pos, t.tag) FROM document_tags t WHERE t.document_id = d.id), '{}') AS tags,
                d.fields_mode,
                to_char(GREATEST(v.uploaded_at,
                    COALESCE((SELECT max(a.created_at) FROM annotations a WHERE a.document_id = d.id), v.uploaded_at),
                    COALESCE((SELECT max(f.updated_at) FROM document_fields f
                              WHERE f.document_id = d.id AND f.scope_profile_id IS NULL AND f.kind = 'field'), v.uploaded_at))
                    AT TIME ZONE 'Asia/Singapore', 'HH12:MIAM DD-MM') AS changed
         FROM documents d
         JOIN LATERAL (SELECT * FROM document_versions WHERE document_id = d.id ORDER BY version_no DESC LIMIT 1) v ON TRUE
         LEFT JOIN profiles p ON p.id = v.uploaded_by
         LEFT JOIN profiles c ON c.id = d.created_by
         WHERE d.deleted_at IS NULL
         ORDER BY d.filed_on DESC, d.day_no DESC",
    )
    .fetch_all(pool)
    .await
}

async fn find(pool: &PgPool, filing: &Filing) -> sqlx::Result<Option<DocumentRow>> {
    sqlx::query_as(
        "SELECT d.id, to_char(d.filed_on, 'YYYY-MMDD') || '_' || d.day_no AS key,
                to_char(d.filed_on, 'FMMonth YYYY') AS month, d.title, d.created_by, c.handle AS added_by,
                v.version_no, v.filename, v.kind, v.size_bytes, p.handle AS uploaded_by,
                to_char(v.uploaded_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS uploaded_at,
                COALESCE((SELECT array_agg(t.tag ORDER BY t.pos, t.tag) FROM document_tags t WHERE t.document_id = d.id), '{}') AS tags,
                d.fields_mode,
                to_char(GREATEST(v.uploaded_at,
                    COALESCE((SELECT max(a.created_at) FROM annotations a WHERE a.document_id = d.id), v.uploaded_at),
                    COALESCE((SELECT max(f.updated_at) FROM document_fields f
                              WHERE f.document_id = d.id AND f.scope_profile_id IS NULL AND f.kind = 'field'), v.uploaded_at))
                    AT TIME ZONE 'Asia/Singapore', 'HH12:MIAM DD-MM') AS changed
         FROM documents d
         JOIN LATERAL (SELECT * FROM document_versions WHERE document_id = d.id ORDER BY version_no DESC LIMIT 1) v ON TRUE
         LEFT JOIN profiles p ON p.id = v.uploaded_by
         LEFT JOIN profiles c ON c.id = d.created_by
         WHERE d.deleted_at IS NULL AND d.filed_on = $1::date AND d.day_no = $2",
    )
    .bind(&filing.date)
    .bind(filing.no)
    .fetch_optional(pool)
    .await
}

/// The filing number of a document known by its old numeric address (`/documents/1`).
async fn key_for_id(pool: &PgPool, id: i64) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT to_char(filed_on, 'YYYY-MMDD') || '_' || day_no FROM documents WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

async fn versions(pool: &PgPool, document_id: i64) -> sqlx::Result<Vec<VersionRow>> {
    sqlx::query_as(
        "SELECT v.version_no, v.filename, v.kind, v.size_bytes, p.handle AS uploaded_by,
                to_char(v.uploaded_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS uploaded_at,
                v.libraries, v.style_guess, v.warnings, v.field_count,
                v.heading_levels, v.heading_ids, v.heading_texts,
                v.image_type, v.image_width, v.image_height
         FROM document_versions v LEFT JOIN profiles p ON p.id = v.uploaded_by
         WHERE v.document_id = $1 ORDER BY v.version_no DESC",
    )
    .bind(document_id)
    .fetch_all(pool)
    .await
}

/// A stored version's bytes, with what is needed to send it.
#[derive(FromRow)]
struct Stored {
    filename: String,
    kind: String,
    content: Vec<u8>,
    image_type: Option<String>,
    image_width: Option<i32>,
    image_height: Option<i32>,
}

async fn content(
    pool: &PgPool,
    document_id: i64,
    version: Option<i32>,
) -> sqlx::Result<Option<Stored>> {
    sqlx::query_as(
        "SELECT filename, kind, content, image_type, image_width, image_height FROM document_versions
         WHERE document_id = $1 AND ($2::int IS NULL OR version_no = $2)
         ORDER BY version_no DESC LIMIT 1",
    )
    .bind(document_id)
    .bind(version)
    .fetch_optional(pool)
    .await
}

/// The media type a stored version is sent with, when downloaded as it is.
fn media_type(kind: &str, image_type: Option<&str>) -> &'static str {
    match kind {
        "html" => "text/html; charset=utf-8",
        "picture" => picture::mime(image_type.unwrap_or("jpeg")),
        _ => "text/plain; charset=utf-8",
    }
}

/// What is kept for 🛰️ search and 📁 contents: the plain text and the headings.
struct Index {
    text: String,
    levels: Vec<i16>,
    ids: Vec<String>,
    texts: Vec<String>,
}

fn index_for(kind: &str, bytes: &[u8], filename: &str) -> Index {
    if kind == "picture" {
        // A picture has no text of its own: its file name is searched (titles and hashtags are
        // searched as for every document).
        let stem = filename
            .rsplit_once('.')
            .map(|(s, _)| s)
            .unwrap_or(filename);
        return Index {
            text: stem.replace(['-', '_', '.'], " "),
            levels: Vec::new(),
            ids: Vec::new(),
            texts: Vec::new(),
        };
    }
    let content = String::from_utf8_lossy(bytes);
    let headings = doccheck::headings(&content, kind);
    Index {
        text: doccheck::plain_text(&content, kind),
        levels: headings.iter().map(|h| h.level).collect(),
        ids: headings.iter().map(|h| h.id.clone()).collect(),
        texts: headings.into_iter().map(|h| h.text).collect(),
    }
}

/// The upload check for a file, or an empty one for text.
fn check_for(kind: &str, bytes: &[u8]) -> doccheck::Check {
    if kind == "html" {
        doccheck::check_html(&String::from_utf8_lossy(bytes))
    } else {
        doccheck::Check::default()
    }
}

pub(super) struct NewFile<'a> {
    pub filename: &'a str,
    pub kind: &'a str,
    pub bytes: &'a [u8],
    pub profile_id: i16,
    /// D3: a picture's type and size, read from its first bytes.
    pub image: Option<picture::Info>,
}

pub(super) async fn insert_version(
    tx: &mut sqlx::PgConnection,
    document_id: i64,
    version_no: i32,
    file: &NewFile<'_>,
) -> sqlx::Result<()> {
    let check = check_for(file.kind, file.bytes);
    let index = index_for(file.kind, file.bytes, file.filename);
    sqlx::query(
        "INSERT INTO document_versions (document_id, version_no, filename, kind, size_bytes, sha256, content, uploaded_by,
                                        libraries, style_guess, warnings, field_count, checked,
                                        text_content, heading_levels, heading_ids, heading_texts, indexed,
                                        image_type, image_width, image_height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15, $16, true, $17, $18, $19)",
    )
    .bind(document_id)
    .bind(version_no)
    .bind(file.filename)
    .bind(file.kind)
    .bind(file.bytes.len() as i32)
    .bind(auth::sha256(file.bytes))
    .bind(file.bytes)
    .bind(file.profile_id)
    .bind(&check.libraries)
    .bind(&check.style_guess)
    .bind(&check.warnings)
    .bind(check.field_count)
    .bind(&index.text)
    .bind(&index.levels)
    .bind(&index.ids)
    .bind(&index.texts)
    .bind(file.image.map(|i| i.kind))
    .bind(file.image.map(|i| i.width as i32))
    .bind(file.image.map(|i| i.height as i32))
    .execute(tx)
    .await?;
    Ok(())
}

async fn write_tags(
    tx: &mut sqlx::PgConnection,
    document_id: i64,
    tags: &[String],
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM document_tags WHERE document_id = $1")
        .bind(document_id)
        .execute(&mut *tx)
        .await?;
    for (pos, tag) in tags.iter().enumerate() {
        sqlx::query("INSERT INTO document_tags (document_id, tag, pos) VALUES ($1, $2, $3)")
            .bind(document_id)
            .bind(tag)
            .bind(pos as i16)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

/// Files a new document under today's next number (Singapore time); returns its key.
async fn insert(
    pool: &PgPool,
    title: &str,
    file: &NewFile<'_>,
    tags: &[String],
) -> sqlx::Result<String> {
    let mut tx = pool.begin().await?;
    let (filed_on, day_no): (String, i32) = sqlx::query_as(
        "INSERT INTO filing_counters (filed_on, last_no) VALUES ((now() AT TIME ZONE 'Asia/Singapore')::date, 1)
         ON CONFLICT (filed_on) DO UPDATE SET last_no = filing_counters.last_no + 1
         RETURNING filed_on::text, last_no",
    )
    .fetch_one(&mut *tx)
    .await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO documents (title, created_by, filed_on, day_no) VALUES ($1, $2, $3::date, $4) RETURNING id",
    )
    .bind(title)
    .bind(file.profile_id)
    .bind(&filed_on)
    .bind(day_no)
    .fetch_one(&mut *tx)
    .await?;
    insert_version(&mut tx, id, 1, file).await?;
    write_tags(&mut tx, id, tags).await?;
    tx.commit().await?;
    Ok(format!(
        "{}{}_{day_no}",
        &filed_on[..5],
        filed_on[5..].replace('-', "")
    ))
}

/// Checks and indexes versions uploaded before the upload check, search or contents existed.
/// Runs when the server starts; returns how many versions were brought up to date.
/// The upload check's rules. When they change, this number goes up and every version is checked
/// again at the next start, so each panel shows the current findings (not the ones from the day
/// the file was uploaded).
pub const CHECK_VERSION: i32 = 3;

/// Marks every version for a fresh check when the rules changed since the last start.
async fn recheck_when_rules_change(pool: &PgPool) -> sqlx::Result<()> {
    let stored: Option<i32> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'upload_check_version'")
            .fetch_optional(pool)
            .await?;
    if stored.unwrap_or(1) < CHECK_VERSION {
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE document_versions SET checked = false")
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES ('upload_check_version', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(CHECK_VERSION)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub async fn backfill_versions(pool: &PgPool) -> sqlx::Result<u64> {
    recheck_when_rules_change(pool).await?;
    let pending: Vec<(i64, String, Vec<u8>, String)> = sqlx::query_as(
        "SELECT id, kind, content, filename FROM document_versions WHERE NOT checked OR NOT indexed ORDER BY id LIMIT 500",
    )
    .fetch_all(pool)
    .await?;
    for (id, kind, bytes, filename) in &pending {
        let check = check_for(kind, bytes);
        let index = index_for(kind, bytes, filename);
        sqlx::query(
            "UPDATE document_versions SET libraries = $2, style_guess = $3, warnings = $4, field_count = $5, checked = true,
                    text_content = $6, heading_levels = $7, heading_ids = $8, heading_texts = $9, indexed = true
             WHERE id = $1",
        )
        .bind(id)
        .bind(&check.libraries)
        .bind(&check.style_guess)
        .bind(&check.warnings)
        .bind(check.field_count)
        .bind(&index.text)
        .bind(&index.levels)
        .bind(&index.ids)
        .bind(&index.texts)
        .execute(pool)
        .await?;
    }
    Ok(pending.len() as u64)
}

pub(super) fn page(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        body,
    )
        .into_response()
}

pub(super) fn see_other(path: &str) -> Response {
    Redirect::to(path).into_response()
}

pub(super) async fn signed_in(
    state: &FamilyState,
    headers: &HeaderMap,
) -> Result<Option<Session>, super::handlers::Fail> {
    super::handlers::current_session(state, headers).await
}

pub(super) fn nav(session: &Session) -> Nav<'_> {
    super::handlers::nav(session)
}

pub(super) fn not_found() -> Response {
    page(
        StatusCode::NOT_FOUND,
        pages::message(
            "Not found",
            "That document does not exist, or it was deleted.",
            ("/documents", "Documents"),
        ),
    )
}

fn out_of_date(back: &str) -> Response {
    page(
        StatusCode::FORBIDDEN,
        pages::message(
            "Please try again",
            "This page was out of date. Reload it and try again.",
            (back, "Back"),
        ),
    )
}

/// The person who added a document and the owner may change or delete it.
pub(super) fn can_manage(session: &Session, doc: &DocumentRow) -> bool {
    session.is_owner || doc.created_by == Some(session.profile_id)
}

pub(super) fn form_ok(
    state: &FamilyState,
    headers: &HeaderMap,
    session: &Session,
    csrf: &str,
) -> bool {
    web::same_origin(headers, &state.expected_origin(headers))
        && auth::ct_eq(session.csrf.as_bytes(), csrf.as_bytes())
}

/// How an address names a document.
enum Address {
    Filing(Filing),
    /// The old numeric address of P2a, forwarded to the filing number.
    Legacy(i64),
}

fn address(key: &str) -> Option<Address> {
    if let Some(filing) = doccheck::parse_filing(key) {
        return Some(Address::Filing(filing));
    }
    if !key.is_empty() && key.len() <= 18 && key.bytes().all(|b| b.is_ascii_digit()) {
        return key.parse().ok().map(Address::Legacy);
    }
    None
}

/// Finds the document an address names, or returns the response to send instead (a forward from
/// an old address, or not found).
pub(super) async fn resolve(
    state: &FamilyState,
    key: &str,
    suffix: &str,
) -> Result<Result<DocumentRow, Response>, super::handlers::Fail> {
    match address(key) {
        Some(Address::Filing(filing)) => {
            Ok(find(&state.pool, &filing).await?.ok_or_else(not_found))
        }
        Some(Address::Legacy(id)) => Ok(Err(match key_for_id(&state.pool, id).await? {
            Some(new_key) => {
                Redirect::permanent(&format!("/documents/{new_key}{suffix}")).into_response()
            }
            None => not_found(),
        })),
        None => Ok(Err(not_found())),
    }
}

pub async fn index(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    let rows = list(&state.pool).await?;
    Ok(page(
        StatusCode::OK,
        pages::documents(&nav(&session), &rows),
    ))
}

/// "Latest document" in the menu: the newest filing, or the list when there is none.
pub async fn latest(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    if signed_in(&state, &headers).await?.is_none() {
        return Ok(see_other("/"));
    }
    let key: Option<String> = sqlx::query_scalar(
        "SELECT to_char(filed_on, 'YYYY-MMDD') || '_' || day_no FROM documents
         WHERE deleted_at IS NULL ORDER BY filed_on DESC, day_no DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await?;
    Ok(see_other(&match key {
        Some(key) => format!("/documents/{key}"),
        None => "/documents".to_string(),
    }))
}

pub async fn new_form(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    Ok(page(
        StatusCode::OK,
        pages::document_upload(&nav(&session), None),
    ))
}

/// A file field read from a multipart form, with the other fields it came with.
#[derive(Default)]
struct Upload {
    csrf: String,
    title: String,
    tags: String,
    filename: String,
    bytes: Vec<u8>,
}

/// Reads an upload form; Err holds the message to show when the file cannot be read.
async fn read_upload(multipart: &mut Multipart) -> Result<Upload, &'static str> {
    let mut upload = Upload::default();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => return Err("That file could not be read. Files can be up to 10 MB."),
        };
        match field.name().unwrap_or("") {
            "csrf" => upload.csrf = field.text().await.unwrap_or_default(),
            "title" => upload.title = field.text().await.unwrap_or_default(),
            "tags" => upload.tags = field.text().await.unwrap_or_default(),
            "file" => {
                upload.filename = field
                    .file_name()
                    .unwrap_or("")
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or("")
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(200)
                    .collect();
                match field.bytes().await {
                    Ok(data) => upload.bytes = data.to_vec(),
                    Err(_) => return Err("That file is too large. Files can be up to 10 MB."),
                }
            }
            _ => {}
        }
    }
    Ok(upload)
}

/// The file's kind (and a picture's type and size), or the message to show when it cannot be
/// accepted.
fn accept_file(
    upload: &Upload,
) -> Result<(&'static str, Option<picture::Info>), (StatusCode, &'static str)> {
    let Some(kind) = kind_for(&upload.filename) else {
        return Err((
            StatusCode::BAD_REQUEST,
            "Choose an HTML (.html, .htm), text (.txt, .md) or picture (.jpg, .png, .webp) file.",
        ));
    };
    if upload.bytes.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "That file is empty."));
    }
    if upload.bytes.len() > MAX_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "That file is too large. Files can be up to 10 MB.",
        ));
    }
    if kind == "picture" {
        // The first bytes decide, not the name.
        return match picture::info(&upload.bytes) {
            Some(info) => Ok((kind, Some(info))),
            None => Err((
                StatusCode::BAD_REQUEST,
                "That file is not a JPEG, PNG or WebP picture. On an iPhone, choose the photo from the library; Safari sends it as a JPEG.",
            )),
        };
    }
    Ok((kind, None))
}

pub async fn upload(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    let retry = |status, message: &str| {
        page(
            status,
            pages::document_upload(&nav(&session), Some(message)),
        )
    };
    let upload = match read_upload(&mut multipart).await {
        Ok(upload) => upload,
        Err(message) => return Ok(retry(StatusCode::PAYLOAD_TOO_LARGE, message)),
    };
    if !form_ok(&state, &headers, &session, &upload.csrf) {
        return Ok(out_of_date("/documents/new"));
    }
    let (kind, image) = match accept_file(&upload) {
        Ok(found) => found,
        Err((status, message)) => return Ok(retry(status, message)),
    };
    let title = clean_title(&upload.title, &upload.filename);
    let typed = doccheck::normalize_tags(&upload.tags);
    let tags = if typed.is_empty() {
        // A picture's hashtags come from its file name only.
        let text = if kind == "picture" {
            String::new()
        } else {
            String::from_utf8_lossy(&upload.bytes).into_owned()
        };
        doccheck::suggest_tags(&text, kind, &upload.filename)
    } else {
        typed
    };
    let file = NewFile {
        filename: &upload.filename,
        kind,
        bytes: &upload.bytes,
        profile_id: session.profile_id,
        image,
    };
    let key = insert(&state.pool, &title, &file, &tags).await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document uploaded",
        &format!(
            "{} ({} bytes)",
            doccheck::filing_label(&key),
            upload.bytes.len()
        ),
    )
    .await?;
    Ok(see_other(&format!("/documents/{key}")))
}

pub(super) async fn show(
    state: &FamilyState,
    session: &Session,
    doc: &DocumentRow,
    status: StatusCode,
    notice: Option<&str>,
) -> Result<Response, super::handlers::Fail> {
    let versions = versions(&state.pool, doc.id).await?;
    let review = review::page_data(&state.pool, doc, session).await?;
    Ok(page(
        status,
        pages::document_view(
            &nav(session),
            doc,
            &versions,
            can_manage(session, doc),
            &state.config.owner,
            notice,
            &review,
        ),
    ))
}

pub async fn view(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    uri: Uri,
    Path(key): Path<String>,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    let notice = redaction_notice(uri.query().unwrap_or(""));
    match resolve(&state, &key, "").await? {
        Ok(doc) => show(&state, &session, &doc, StatusCode::OK, notice.as_deref()).await,
        Err(response) => Ok(response),
    }
}

/// After redactions were applied (`?redacted=2&remaining=1`): what was done, and what to check.
pub fn redaction_notice(query: &str) -> Option<String> {
    let number = |name: &str| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
            .and_then(|v| v.parse::<u32>().ok())
    };
    let count = number("redacted").filter(|n| *n > 0)?;
    let remaining = number("remaining").unwrap_or(0);
    let mut text = format!(
        "Redaction applied: {count} {} blacked out in a new version, and every earlier version was deleted for good.",
        if count == 1 { "passage" } else { "passages" }
    );
    if remaining > 0 {
        text.push_str(&format!(
            " The same words still appear {remaining} more {} in the document; mark {} too if {} should go.",
            if remaining == 1 { "time" } else { "times" },
            if remaining == 1 { "it" } else { "them" },
            if remaining == 1 { "it" } else { "they" },
        ));
    }
    text.push_str(" A redaction does not change the title, the hashtags or the names of attached files; check them too.");
    Some(text)
}

/// The original file exactly as uploaded (the latest version, or `?v=2`), as a download. Members
/// only. No helper is added and nothing is changed; it carries the sandbox policy in case a browser
/// opens it instead of saving it.
pub async fn original(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    uri: Uri,
    Path(key): Path<String>,
) -> Result<Response, super::handlers::Fail> {
    if signed_in(&state, &headers).await?.is_none() {
        return Ok(see_other("/"));
    }
    let doc = match resolve(&state, &key, "/original").await? {
        Ok(doc) => doc,
        Err(response) => return Ok(response),
    };
    let version = uri
        .query()
        .unwrap_or("")
        .split('&')
        .find_map(|pair| pair.strip_prefix("v="))
        .and_then(|v| v.parse::<i32>().ok());
    let Some(stored) = content(&state.pool, doc.id, version).await? else {
        return Ok(not_found());
    };
    let content_type = media_type(&stored.kind, stored.image_type.as_deref());
    let (filename, bytes) = (stored.filename, stored.content);
    let disposition = axum::http::HeaderValue::from_str(&attachment(&filename))
        .unwrap_or(axum::http::HeaderValue::from_static("attachment"));
    let mut response = (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_SECURITY_POLICY, DOCUMENT_CSP),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::CACHE_CONTROL, "private, no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    Ok(response)
}

/// A Content-Disposition value that saves the file under its own name: a plain ASCII fallback and
/// the exact name in RFC 5987 form for names with other characters.
pub fn attachment(filename: &str) -> String {
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._- ()".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = filename
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"._-".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

/// The document itself, for the sandboxed frame (`?v=2` for an earlier version). Members only.
pub async fn raw(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    uri: Uri,
    Path(key): Path<String>,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    let doc = match resolve(&state, &key, "/raw").await? {
        Ok(doc) => doc,
        Err(response) => return Ok(response),
    };
    let version = uri
        .query()
        .unwrap_or("")
        .split('&')
        .find_map(|pair| pair.strip_prefix("v="))
        .and_then(|v| v.parse::<i32>().ok());
    let Some(stored) = content(&state.pool, doc.id, version).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let (content_type, bytes) = match stored.kind.as_str() {
        "html" | "picture" => {
            // A picture is shown as a small page with the picture in it, so marks and drawings
            // work on it. The helper for saved fields, the storage stand-in and annotations is
            // added as the page is sent; the stored file never changes.
            let html = if stored.kind == "picture" {
                picture::page(
                    &doc.title,
                    stored.image_type.as_deref().unwrap_or("jpeg"),
                    stored.image_width.unwrap_or(1) as u32,
                    stored.image_height.unwrap_or(1) as u32,
                    &stored.content,
                )
                .into_bytes()
            } else {
                stored.content
            };
            let data = review::frame_data(&state.pool, &doc, &session).await?;
            (
                "text/html; charset=utf-8",
                review::inject(&html, &review::helper_script(&data)),
            )
        }
        _ => ("text/plain; charset=utf-8", stored.content),
    };
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_SECURITY_POLICY, DOCUMENT_CSP),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::CACHE_CONTROL, "private, no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

/// Loads the document for a change and checks the form and the person's right to change it.
pub(super) async fn for_change(
    state: &FamilyState,
    headers: &HeaderMap,
    key: &str,
    csrf: &str,
) -> Result<Result<(Session, DocumentRow), Response>, super::handlers::Fail> {
    let Some(session) = signed_in(state, headers).await? else {
        return Ok(Err(see_other("/")));
    };
    let doc = match resolve(state, key, "").await? {
        Ok(doc) => doc,
        Err(response) => return Ok(Err(response)),
    };
    if !form_ok(state, headers, &session, csrf) {
        return Ok(Err(out_of_date(&format!("/documents/{}", doc.key))));
    }
    if !can_manage(&session, &doc) {
        return Ok(Err(page(
            StatusCode::FORBIDDEN,
            pages::message(
                "Not allowed",
                "Only the person who added this document, or the owner, can change or delete it.",
                (&format!("/documents/{}", doc.key), "Back to the document"),
            ),
        )));
    }
    Ok(Ok((session, doc)))
}

pub(super) fn back_to_panel(doc: &DocumentRow) -> Response {
    see_other(&format!("/documents/{}#panel", doc.key))
}

#[derive(Deserialize)]
pub struct RenameForm {
    csrf: String,
    title: String,
}

pub async fn rename(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<RenameForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match for_change(&state, &headers, &key, &form.csrf).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let title = clean_title(&form.title, &doc.filename);
    sqlx::query("UPDATE documents SET title = $2 WHERE id = $1")
        .bind(doc.id)
        .bind(&title)
        .execute(&state.pool)
        .await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document renamed",
        &doccheck::filing_label(&doc.key),
    )
    .await?;
    Ok(back_to_panel(&doc))
}

#[derive(Deserialize)]
pub struct TagsForm {
    csrf: String,
    tags: String,
}

pub async fn tags(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<TagsForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match for_change(&state, &headers, &key, &form.csrf).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let tags = doccheck::normalize_tags(&form.tags);
    let mut tx = state.pool.begin().await?;
    write_tags(&mut tx, doc.id, &tags).await?;
    tx.commit().await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document hashtags changed",
        &format!(
            "{} ({} hashtags)",
            doccheck::filing_label(&doc.key),
            tags.len()
        ),
    )
    .await?;
    Ok(back_to_panel(&doc))
}

pub async fn new_version(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    mut multipart: Multipart,
) -> Result<Response, super::handlers::Fail> {
    let upload = match read_upload(&mut multipart).await {
        Ok(upload) => upload,
        Err(message) => {
            let Some(session) = signed_in(&state, &headers).await? else {
                return Ok(see_other("/"));
            };
            return match resolve(&state, &key, "").await? {
                Ok(doc) => {
                    show(
                        &state,
                        &session,
                        &doc,
                        StatusCode::PAYLOAD_TOO_LARGE,
                        Some(message),
                    )
                    .await
                }
                Err(response) => Ok(response),
            };
        }
    };
    let (session, doc) = match for_change(&state, &headers, &key, &upload.csrf).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let (kind, image) = match accept_file(&upload) {
        Ok(found) => found,
        Err((status, message)) => return show(&state, &session, &doc, status, Some(message)).await,
    };
    let file = NewFile {
        filename: &upload.filename,
        kind,
        bytes: &upload.bytes,
        profile_id: session.profile_id,
        image,
    };
    let mut tx = state.pool.begin().await?;
    // Lock the document so two uploads at once cannot take the same version number.
    sqlx::query("SELECT id FROM documents WHERE id = $1 FOR UPDATE")
        .bind(doc.id)
        .execute(&mut *tx)
        .await?;
    let next: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(version_no), 0) + 1 FROM document_versions WHERE document_id = $1",
    )
    .bind(doc.id)
    .fetch_one(&mut *tx)
    .await?;
    insert_version(&mut tx, doc.id, next, &file).await?;
    tx.commit().await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document version added",
        &format!(
            "{} version {next} ({} bytes)",
            doccheck::filing_label(&doc.key),
            upload.bytes.len()
        ),
    )
    .await?;
    Ok(back_to_panel(&doc))
}

#[derive(Deserialize)]
pub struct DeleteForm {
    csrf: String,
    confirm: String,
}

/// Deletes a document, all its versions and its hashtags for good (there are no backups).
pub async fn delete(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<DeleteForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match for_change(&state, &headers, &key, &form.csrf).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    if form.confirm.trim() != DELETE_WORD {
        return show(
            &state,
            &session,
            &doc,
            StatusCode::BAD_REQUEST,
            Some("Nothing was deleted. To delete, type DELETE in capitals."),
        )
        .await;
    }
    sqlx::query("DELETE FROM documents WHERE id = $1")
        .bind(doc.id)
        .execute(&state.pool)
        .await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document deleted",
        &format!(
            "{} ({} versions)",
            doccheck::filing_label(&doc.key),
            doc.version_no
        ),
    )
    .await?;
    Ok(see_other("/documents"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepted_kinds() {
        assert_eq!(kind_for("Trip.HTML"), Some("html"));
        assert_eq!(kind_for("notes.htm"), Some("html"));
        assert_eq!(kind_for("list.md"), Some("text"));
        assert_eq!(kind_for("IMG_0042.JPEG"), Some("picture"));
        assert_eq!(kind_for("map.png"), Some("picture"));
        assert_eq!(kind_for("photo.webp"), Some("picture"));
        assert_eq!(kind_for("anim.gif"), None);
        assert_eq!(kind_for("photo.jpg"), Some("picture"));
        assert_eq!(kind_for("tool.exe"), None);
        assert_eq!(kind_for("no-extension"), None);
    }

    #[test]
    fn the_redaction_notice_says_what_was_done() {
        assert_eq!(redaction_notice(""), None);
        assert_eq!(redaction_notice("redacted=0"), None);
        assert_eq!(redaction_notice("redacted=x"), None);
        let one = redaction_notice("redacted=1&remaining=0").unwrap();
        assert!(one.starts_with("Redaction applied: 1 passage blacked out"));
        assert!(!one.contains("still appear"));
        let two = redaction_notice("redacted=2&remaining=3").unwrap();
        assert!(
            two.contains("2 passages")
                && two.contains("3 more times")
                && two.contains("mark them too")
        );
        assert!(!two.contains('\u{2014}') && !two.contains('\u{2013}'));
    }

    #[test]
    fn titles_are_cleaned() {
        assert_eq!(clean_title("", "family-trip.html"), "family-trip");
        assert_eq!(clean_title("  My\u{0}trip  ", "x.html"), "Mytrip");
        assert_eq!(clean_title(&"a".repeat(200), "x.html").chars().count(), 120);
        assert_eq!(clean_title("", ".html"), "Untitled");
    }

    #[test]
    fn downloads_keep_their_name_safely() {
        assert_eq!(
            attachment("Trip plan.html"),
            "attachment; filename=\"Trip plan.html\"; filename*=UTF-8''Trip%20plan.html"
        );
        let odd = attachment("a\"b\r\n家.html");
        assert!(
            odd.starts_with(
                "attachment; filename=\"a_b___.html\"; filename*=UTF-8''a%22b%0D%0A%E5%AE%B6.html"
            ),
            "{odd}"
        );
        assert!(axum::http::HeaderValue::from_str(&odd).is_ok());
    }

    #[test]
    fn addresses() {
        assert!(matches!(address("2026-1105_1"), Some(Address::Filing(_))));
        assert!(matches!(address("7"), Some(Address::Legacy(7))));
        assert!(address("2026-1105").is_none() && address("x").is_none() && address("").is_none());
        assert!(address("99999999999999999999").is_none());
    }

    #[test]
    fn sandbox_never_grants_same_origin() {
        assert!(!IFRAME_SANDBOX.contains("allow-same-origin"));
        assert!(!DOCUMENT_CSP.contains("allow-same-origin"));
        assert!(DOCUMENT_CSP.starts_with("sandbox allow-scripts"));
        assert!(
            DOCUMENT_CSP.contains("form-action 'none'")
                && DOCUMENT_CSP.contains(
                    "frame-src https://maps.google.com/maps https://www.google.com/maps/ https://www.instagram.com/ https://www.tiktok.com/embed/;"
                )
        );
        assert!(
            !IFRAME_SANDBOX.contains("allow-top-navigation")
                && !IFRAME_SANDBOX.contains("allow-forms")
        );
    }

    #[test]
    fn frame_policy_lists_exactly_the_library_sites() {
        let directive = |name: &str| {
            DOCUMENT_CSP
                .split(';')
                .map(str::trim)
                .find(|d| d.starts_with(name))
                .unwrap_or_else(|| panic!("{name} missing"))
                .to_string()
        };
        let sources = |name: &str| -> Vec<String> {
            directive(name)
                .split_whitespace()
                .skip(1)
                .map(String::from)
                .collect()
        };
        let with_https = |hosts: &[&str]| -> Vec<String> {
            hosts.iter().map(|h| format!("https://{h}")).collect()
        };
        let mut scripts = vec!["'unsafe-inline'".to_string()];
        scripts.extend(with_https(&doccheck::SCRIPT_HOSTS));
        assert_eq!(sources("script-src"), scripts);
        let mut styles = vec!["'unsafe-inline'".to_string()];
        styles.extend(with_https(&doccheck::STYLE_HOSTS));
        assert_eq!(sources("style-src"), styles);
        assert_eq!(sources("connect-src"), with_https(&doccheck::CONNECT_HOSTS));
        assert!(!directive("script-src").contains("unsafe-eval"));
        assert_eq!(
            sources("frame-src"),
            doccheck::FRAME_SOURCES.map(String::from).to_vec(),
            "Google Maps, Instagram and TikTok embeds only"
        );
    }
}
