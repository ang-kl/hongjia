//! D3: signatures. Each person may keep one saved signature: drawn on a pad (mouse, trackpad,
//! finger or Pencil with pressure) or typed and shown in a script-style font. It is stored as
//! checked numbers or plain text, never as an uploaded image. A camera signature is not offered
//! (the owner's default, № 38: camera later; the site blocks the camera).
//!
//! Placing a signature (an annotation of kind `signature`) always uses the signer's own saved
//! signature, copied by the server at that moment: nobody can place someone else's, and replacing a
//! saved signature never changes what was already signed. The caption, "Signed by NAME, DD Mon YYYY,
//! HH:MM (SGT)", comes from the server. "Digital signature" here means this typed or drawn mark with
//! a name and a time, not a legal certificate.

use super::review::{format_points, parse_points};
use super::store::{self, Session};
use super::{FamilyState, auth, json, web};
use axum::{
    Form,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use sqlx::PgPool;

/// The pad's size; drawn points lie inside it (a little spill over the edge is clamped).
pub const PAD_WIDTH: f64 = 600.0;
pub const PAD_HEIGHT: f64 = 200.0;
pub const MAX_STROKES: usize = 60;
pub const MAX_SIGNATURE_POINTS: usize = 1200;
pub const MAX_STROKES_TEXT: usize = 16_000;
pub const MAX_TYPED: usize = 60;

/// Drawn strokes, checked and written back in one form: strokes split by `;`, each `x,y,p` points
/// split by spaces, inside the pad, with 1 to 60 strokes and at most 1200 points in all.
pub fn check_strokes(text: &str) -> Option<String> {
    if text.is_empty() || text.len() > MAX_STROKES_TEXT {
        return None;
    }
    let strokes: Vec<&str> = text.split(';').collect();
    if strokes.len() > MAX_STROKES {
        return None;
    }
    let mut total = 0;
    let mut out = Vec::new();
    for stroke in strokes {
        let points = parse_points(stroke, true, 1, MAX_SIGNATURE_POINTS)?;
        total += points.len();
        if total > MAX_SIGNATURE_POINTS {
            return None;
        }
        let inside = points.iter().all(|[x, y, _]| {
            (-2.0..=PAD_WIDTH + 2.0).contains(x) && (-2.0..=PAD_HEIGHT + 2.0).contains(y)
        });
        if !inside {
            return None;
        }
        let clamped: Vec<[f64; 3]> = points
            .iter()
            .map(|[x, y, p]| [x.clamp(0.0, PAD_WIDTH), y.clamp(0.0, PAD_HEIGHT), *p])
            .collect();
        out.push(format_points(&clamped, true));
    }
    let joined = out.join(";");
    (joined.len() <= MAX_STROKES_TEXT).then_some(joined)
}

/// A typed signature: trimmed, 1 to 60 characters, no control characters.
pub fn check_typed(text: &str) -> Option<String> {
    let name = text.trim();
    let n = name.chars().count();
    ((1..=MAX_TYPED).contains(&n) && !name.chars().any(char::is_control)).then(|| name.to_string())
}

/// A person's saved signature: ("drawn", strokes) or ("typed", name).
pub async fn saved(pool: &PgPool, profile_id: i16) -> sqlx::Result<Option<(String, String)>> {
    let row: Option<(String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT style, strokes, typed FROM signatures WHERE profile_id = $1")
            .bind(profile_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(style, strokes, typed)| {
        let value = if style == "drawn" { strokes } else { typed };
        (style, value.unwrap_or_default())
    }))
}

fn reply(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        body,
    )
        .into_response()
}

async fn session_of(
    state: &FamilyState,
    headers: &HeaderMap,
) -> Result<Option<Session>, super::handlers::Fail> {
    super::handlers::current_session(state, headers).await
}

/// `GET /api/signature`: this person's own saved signature (`{"style":""}` when there is none).
pub async fn get_signature(
    State(state): State<FamilyState>,
    headers: HeaderMap,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = session_of(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let body = match saved(&state.pool, session.profile_id).await? {
        Some((style, value)) => json::object(&[
            ("style", json::string(&style)),
            ("value", json::string(&value)),
        ]),
        None => json::object(&[("style", json::string("")), ("value", json::string(""))]),
    };
    Ok(reply(StatusCode::OK, body))
}

#[derive(Deserialize)]
pub struct SignatureForm {
    #[serde(default)]
    op: String,
    #[serde(default)]
    style: String,
    #[serde(default)]
    value: String,
}

/// `POST /api/signature`: save (`style` drawn or typed, with `value`) or delete (`op=delete`) this
/// person's own signature. Fetch only, with the form token in a header and the Origin check.
pub async fn save_signature(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<SignatureForm>,
) -> Result<Response, super::handlers::Fail> {
    let Some(session) = session_of(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let token = headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if token.is_empty()
        || !web::same_origin(&headers, &state.expected_origin(&headers))
        || !auth::ct_eq(session.csrf.as_bytes(), token.as_bytes())
    {
        return Ok(StatusCode::FORBIDDEN.into_response());
    }
    if form.op == "delete" {
        sqlx::query("DELETE FROM signatures WHERE profile_id = $1")
            .bind(session.profile_id)
            .execute(&state.pool)
            .await?;
        store::audit(
            &state.pool,
            Some(session.profile_id),
            "signature deleted",
            "",
        )
        .await?;
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let (strokes, typed) = match form.style.as_str() {
        "drawn" => match check_strokes(&form.value) {
            Some(strokes) => (Some(strokes), None),
            None => return Ok(StatusCode::BAD_REQUEST.into_response()),
        },
        "typed" => match check_typed(&form.value) {
            Some(name) => (None, Some(name)),
            None => return Ok(StatusCode::BAD_REQUEST.into_response()),
        },
        _ => return Ok(StatusCode::BAD_REQUEST.into_response()),
    };
    sqlx::query(
        "INSERT INTO signatures (profile_id, style, strokes, typed) VALUES ($1, $2, $3, $4)
         ON CONFLICT (profile_id) DO UPDATE SET style = EXCLUDED.style, strokes = EXCLUDED.strokes,
                                                typed = EXCLUDED.typed, updated_at = now()",
    )
    .bind(session.profile_id)
    .bind(&form.style)
    .bind(&strokes)
    .bind(&typed)
    .execute(&state.pool)
    .await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "signature saved",
        &form.style,
    )
    .await?;
    Ok(reply(
        StatusCode::OK,
        json::object(&[
            ("style", json::string(&form.style)),
            (
                "value",
                json::string(strokes.as_deref().or(typed.as_deref()).unwrap_or("")),
            ),
        ]),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawn_strokes_are_checked_and_tidied() {
        assert_eq!(
            check_strokes("10,20,0.5 30.26,40,0.7;100,100,1").as_deref(),
            Some("10,20,0.5 30.3,40,0.7;100,100,1")
        );
        assert_eq!(
            check_strokes("601,10,0.5 -1,201,0.5").as_deref(),
            Some("600,10,0.5 0,200,0.5"),
            "a little spill over the edge is clamped"
        );
        for bad in [
            "",
            "700,10,0.5",
            "10,10",
            "10,10,2",
            "10,10,0.5;;",
            "a,b,c",
            "10,10,0.5 ",
        ] {
            assert_eq!(check_strokes(bad), None, "{bad:?}");
        }
        let too_many: Vec<String> = (0..61).map(|i| format!("{i},10,0.5")).collect();
        assert_eq!(check_strokes(&too_many.join(";")), None, "61 strokes");
        let long: Vec<String> = (0..1201).map(|i| format!("{},10,0.5", i % 600)).collect();
        assert_eq!(check_strokes(&long.join(" ")), None, "1201 points");
    }

    #[test]
    fn typed_names_are_checked() {
        assert_eq!(
            check_typed("  Lake Example ").as_deref(),
            Some("Lake Example")
        );
        assert_eq!(check_typed("灯笼").as_deref(), Some("灯笼"));
        assert_eq!(check_typed("   "), None);
        assert_eq!(check_typed(&"x".repeat(61)), None);
        assert_eq!(check_typed("a\u{0}b"), None);
    }
}
