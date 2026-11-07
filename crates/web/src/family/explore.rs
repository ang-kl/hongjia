//! Read-only data for the 🛰️ satellite search, the globe and 📁 contents (P2b, pull request B).
//! Both endpoints are for signed-in family members only and return JSON built by `json`.

use super::doccheck::filing_label;
use super::{FamilyState, documents, json, web};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use sqlx::FromRow;

pub const MAX_QUERY_CHARS: usize = 100;
pub const MAX_RESULTS: i64 = 20;

fn reply(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        body,
    )
        .into_response()
}

fn error(status: StatusCode, message: &str) -> Response {
    reply(status, json::object(&[("error", json::string(message))]))
}

/// A pattern for ILIKE that matches the text anywhere, with `\`, `%` and `_` taken literally.
pub fn like_pattern(text: &str) -> String {
    let mut out = String::from("%");
    for c in text.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}

#[derive(Debug, FromRow)]
struct Hit {
    key: String,
    title: String,
    tags: Vec<String>,
    snippet: String,
    cut_start: bool,
    cut_end: bool,
}

/// `GET /api/search?q=`: documents whose title, hashtags or text match, best first (title, then
/// hashtag, then text rank, then newest), at most 20, each with a plain-text snippet.
pub async fn search(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    uri: Uri,
) -> Result<Response, super::handlers::Fail> {
    if super::handlers::current_session(&state, &headers)
        .await?
        .is_none()
    {
        return Ok(error(StatusCode::UNAUTHORIZED, "Sign in first."));
    }
    let raw = web::query_param(uri.query(), "q").unwrap_or_default();
    let q = raw.trim();
    if q.chars().count() > MAX_QUERY_CHARS {
        return Ok(error(
            StatusCode::BAD_REQUEST,
            "Searches can be up to 100 characters.",
        ));
    }
    let bare = q.trim_start_matches('#').trim();
    if bare.is_empty() {
        return Ok(reply(
            StatusCode::OK,
            json::object(&[("query", json::string(q)), ("results", "[]".into())]),
        ));
    }
    let first_word = bare.split_whitespace().next().unwrap_or(bare);
    let hits: Vec<Hit> = sqlx::query_as(
        "WITH latest AS (
             SELECT DISTINCT ON (document_id) document_id, text_content
             FROM document_versions ORDER BY document_id, version_no DESC
         ), hits AS (
             SELECT d.id, d.filed_on, d.day_no, to_char(d.filed_on, 'YYYY-MMDD') || '_' || d.day_no AS key,
                    d.title, l.text_content,
                    d.title ILIKE $2 ESCAPE '\\' AS in_title,
                    EXISTS (SELECT 1 FROM document_tags t WHERE t.document_id = d.id AND t.tag ILIKE $3 ESCAPE '\\') AS in_tags,
                    ts_rank(to_tsvector('simple', d.title || ' ' || l.text_content), plainto_tsquery('simple', $1)) AS rank,
                    strpos(lower(l.text_content), lower($4)) AS at
             FROM documents d JOIN latest l ON l.document_id = d.id
             WHERE d.deleted_at IS NULL AND d.hidden_at IS NULL
         )
         SELECT key, title,
                COALESCE((SELECT array_agg(t.tag ORDER BY t.pos, t.tag) FROM document_tags t WHERE t.document_id = hits.id), '{}') AS tags,
                CASE WHEN at > 0 THEN substr(text_content, greatest(1, at - 80), 220) ELSE substr(text_content, 1, 180) END AS snippet,
                at > 81 AS cut_start,
                char_length(text_content) > CASE WHEN at > 0 THEN greatest(1, at - 80) + 219 ELSE 180 END AS cut_end
         FROM hits
         WHERE in_title OR in_tags OR at > 0 OR text_content ILIKE $2 ESCAPE '\\'
            OR to_tsvector('simple', title || ' ' || text_content) @@ plainto_tsquery('simple', $1)
         ORDER BY in_title DESC, in_tags DESC, rank DESC, filed_on DESC, day_no DESC
         LIMIT $5",
    )
    .bind(bare)
    .bind(like_pattern(bare))
    .bind(like_pattern(&bare.to_lowercase()))
    .bind(first_word)
    .bind(MAX_RESULTS)
    .fetch_all(&state.pool)
    .await?;
    let results: Vec<String> = hits
        .iter()
        .map(|h| {
            let mut snippet = h.snippet.trim().to_string();
            if h.cut_start {
                snippet = format!("…{snippet}");
            }
            if h.cut_end {
                snippet.push('…');
            }
            json::object(&[
                ("key", json::string(&h.key)),
                ("label", json::string(&filing_label(&h.key))),
                ("title", json::string(&h.title)),
                ("tags", json::strings(&h.tags)),
                ("snippet", json::string(&snippet)),
            ])
        })
        .collect();
    Ok(reply(
        StatusCode::OK,
        json::object(&[
            ("query", json::string(q)),
            ("results", format!("[{}]", results.join(","))),
        ]),
    ))
}

/// `GET /api/library`: every document for the globe and for 📁 contents, newest first.
pub async fn library(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    if super::handlers::current_session(&state, &headers)
        .await?
        .is_none()
    {
        return Ok(error(StatusCode::UNAUTHORIZED, "Sign in first."));
    }
    let rows = documents::list(&state.pool).await?;
    let items: Vec<String> = rows
        .iter()
        .take(500)
        .map(|d| {
            json::object(&[
                ("key", json::string(&d.key)),
                ("label", json::string(&filing_label(&d.key))),
                ("title", json::string(&d.title)),
                ("tags", json::strings(&d.tags)),
                ("month", json::string(&d.month)),
                ("changed", json::string(&d.changed)),
            ])
        })
        .collect();
    Ok(reply(
        StatusCode::OK,
        json::object(&[("documents", format!("[{}]", items.join(",")))]),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_patterns_are_literal() {
        assert_eq!(like_pattern("lake"), "%lake%");
        assert_eq!(like_pattern("100%_a\\b"), "%100\\%\\_a\\\\b%");
        assert_eq!(like_pattern("灯笼"), "%灯笼%");
    }
}
