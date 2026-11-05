//! P2a documents: upload an HTML or text file, list documents, and view one in a sandboxed frame.
//!
//! Uploaded HTML never runs with the site's own powers. It is served with a `sandbox` Content
//! Security Policy (an opaque origin: no cookies, no storage, no network calls, no forms, no
//! top-level navigation) and shown inside an `<iframe sandbox>` without `allow-same-origin`. Its
//! own scripts, images from https sites, pop-up links and printing still work.

use super::pages::{self, Nav};
use super::store::Session;
use super::{FamilyState, auth, store, web};
use axum::{
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use sqlx::{FromRow, PgPool};

pub const MAX_BYTES: usize = 10 * 1024 * 1024;

/// The policy for uploaded documents: sandboxed, inline scripts and styles allowed, pictures from
/// https sites, nothing else.
pub const DOCUMENT_CSP: &str = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data: blob:; media-src https:; font-src https: data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'self'";

/// The iframe's own sandbox, matching the policy above. `allow-same-origin` is never given.
pub const IFRAME_SANDBOX: &str =
    "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals";

/// Which kind of document a file name is, or None if it is not accepted yet.
pub fn kind_for(filename: &str) -> Option<&'static str> {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        Some("html")
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        Some("text")
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
    pub title: String,
    pub version_no: i32,
    pub filename: String,
    pub kind: String,
    pub size_bytes: i32,
    pub uploaded_by: Option<String>,
    pub uploaded_at: String,
}

async fn list(pool: &PgPool) -> sqlx::Result<Vec<DocumentRow>> {
    sqlx::query_as(
        "SELECT d.id, d.title, v.version_no, v.filename, v.kind, v.size_bytes, p.handle AS uploaded_by,
                to_char(v.uploaded_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS uploaded_at
         FROM documents d
         JOIN LATERAL (SELECT * FROM document_versions WHERE document_id = d.id ORDER BY version_no DESC LIMIT 1) v ON TRUE
         LEFT JOIN profiles p ON p.id = v.uploaded_by
         WHERE d.deleted_at IS NULL
         ORDER BY v.uploaded_at DESC",
    )
    .fetch_all(pool)
    .await
}

async fn one(pool: &PgPool, id: i64) -> sqlx::Result<Option<DocumentRow>> {
    sqlx::query_as(
        "SELECT d.id, d.title, v.version_no, v.filename, v.kind, v.size_bytes, p.handle AS uploaded_by,
                to_char(v.uploaded_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS uploaded_at
         FROM documents d
         JOIN LATERAL (SELECT * FROM document_versions WHERE document_id = d.id ORDER BY version_no DESC LIMIT 1) v ON TRUE
         LEFT JOIN profiles p ON p.id = v.uploaded_by
         WHERE d.deleted_at IS NULL AND d.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

async fn content(pool: &PgPool, id: i64) -> sqlx::Result<Option<(String, Vec<u8>)>> {
    sqlx::query_as(
        "SELECT v.kind, v.content FROM documents d
         JOIN document_versions v ON v.document_id = d.id
         WHERE d.deleted_at IS NULL AND d.id = $1
         ORDER BY v.version_no DESC LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

async fn insert(
    pool: &PgPool,
    title: &str,
    filename: &str,
    kind: &str,
    bytes: &[u8],
    profile_id: i16,
) -> sqlx::Result<i64> {
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO documents (title, created_by) VALUES ($1, $2) RETURNING id",
    )
    .bind(title)
    .bind(profile_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO document_versions (document_id, version_no, filename, kind, size_bytes, sha256, content, uploaded_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(filename)
    .bind(kind)
    .bind(bytes.len() as i32)
    .bind(auth::sha256(bytes))
    .bind(bytes)
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(id)
}

fn page(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        body,
    )
        .into_response()
}

async fn signed_in(
    state: &FamilyState,
    headers: &HeaderMap,
) -> Result<Option<Session>, super::handlers::Fail> {
    super::handlers::current_session(state, headers).await
}

fn nav(session: &Session) -> Nav<'_> {
    Nav {
        handle: &session.handle,
        is_owner: session.is_owner,
        csrf: &session.csrf,
    }
}

pub async fn index(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(Redirect::to("/").into_response());
    };
    let rows = list(&state.pool).await?;
    Ok(page(
        StatusCode::OK,
        pages::documents(&nav(&session), &rows),
    ))
}

pub async fn new_form(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(Redirect::to("/").into_response());
    };
    Ok(page(
        StatusCode::OK,
        pages::document_upload(&nav(&session), None),
    ))
}

pub async fn upload(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(Redirect::to("/").into_response());
    };
    let retry = |status, message: &str| {
        page(
            status,
            pages::document_upload(&nav(&session), Some(message)),
        )
    };
    let (mut csrf, mut title, mut filename, mut bytes) =
        (String::new(), String::new(), String::new(), Vec::new());
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => {
                return Ok(retry(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "That file could not be read. Files can be up to 10 MB.",
                ));
            }
        };
        match field.name().unwrap_or("") {
            "csrf" => csrf = field.text().await.unwrap_or_default(),
            "title" => title = field.text().await.unwrap_or_default(),
            "file" => {
                filename = field
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
                    Ok(data) => bytes = data.to_vec(),
                    Err(_) => {
                        return Ok(retry(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "That file is too large. Files can be up to 10 MB.",
                        ));
                    }
                }
            }
            _ => {}
        }
    }
    if !web::same_origin(&headers, &state.expected_origin(&headers))
        || !auth::ct_eq(session.csrf.as_bytes(), csrf.as_bytes())
    {
        return Ok(page(
            StatusCode::FORBIDDEN,
            pages::message(
                "Please try again",
                "This page was out of date. Reload it and try again.",
                ("/documents/new", "Back"),
            ),
        ));
    }
    let Some(kind) = kind_for(&filename) else {
        return Ok(retry(
            StatusCode::BAD_REQUEST,
            "Choose an HTML (.html, .htm) or text (.txt, .md) file. Pictures and other files come later.",
        ));
    };
    if bytes.is_empty() {
        return Ok(retry(StatusCode::BAD_REQUEST, "That file is empty."));
    }
    if bytes.len() > MAX_BYTES {
        return Ok(retry(
            StatusCode::PAYLOAD_TOO_LARGE,
            "That file is too large. Files can be up to 10 MB.",
        ));
    }
    let title = clean_title(&title, &filename);
    let id = insert(
        &state.pool,
        &title,
        &filename,
        kind,
        &bytes,
        session.profile_id,
    )
    .await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "document uploaded",
        &format!("#{id} ({} bytes)", bytes.len()),
    )
    .await?;
    Ok(Redirect::to(&format!("/documents/{id}")).into_response())
}

pub async fn view(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = signed_in(&state, &headers).await? else {
        return Ok(Redirect::to("/").into_response());
    };
    match one(&state.pool, id).await? {
        Some(doc) => Ok(page(
            StatusCode::OK,
            pages::document_view(&nav(&session), &doc),
        )),
        None => Ok(page(
            StatusCode::NOT_FOUND,
            pages::message(
                "Not found",
                "That document does not exist.",
                ("/documents", "Documents"),
            ),
        )),
    }
}

/// The document itself, for the sandboxed frame. Signed-in members only.
pub async fn raw(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, super::handlers::Fail> {
    if signed_in(&state, &headers).await?.is_none() {
        return Ok(Redirect::to("/").into_response());
    }
    let Some((kind, bytes)) = content(&state.pool, id).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let content_type = if kind == "html" {
        "text/html; charset=utf-8"
    } else {
        "text/plain; charset=utf-8"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepted_kinds() {
        assert_eq!(kind_for("Trip.HTML"), Some("html"));
        assert_eq!(kind_for("notes.htm"), Some("html"));
        assert_eq!(kind_for("list.md"), Some("text"));
        assert_eq!(kind_for("photo.jpg"), None);
        assert_eq!(kind_for("tool.exe"), None);
        assert_eq!(kind_for("no-extension"), None);
    }

    #[test]
    fn titles_are_cleaned() {
        assert_eq!(clean_title("", "family-trip.html"), "family-trip");
        assert_eq!(clean_title("  My\u{0}trip  ", "x.html"), "Mytrip");
        assert_eq!(clean_title(&"a".repeat(200), "x.html").chars().count(), 120);
        assert_eq!(clean_title("", ".html"), "Untitled");
    }

    #[test]
    fn sandbox_never_grants_same_origin() {
        assert!(!IFRAME_SANDBOX.contains("allow-same-origin"));
        assert!(!DOCUMENT_CSP.contains("allow-same-origin"));
        assert!(DOCUMENT_CSP.starts_with("sandbox allow-scripts"));
        assert!(
            DOCUMENT_CSP.contains("connect-src 'none'")
                && DOCUMENT_CSP.contains("form-action 'none'")
        );
        assert!(
            !IFRAME_SANDBOX.contains("allow-top-navigation")
                && !IFRAME_SANDBOX.contains("allow-forms")
        );
    }
}
