//! Route handlers for family mode.

use super::pages::{self, Nav};
use super::store::{self, Attempt, Session};
use super::{FamilyState, auth, web};
use axum::{
    extract::{ConnectInfo, Form, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use serde::Deserialize;
use std::net::{IpAddr, SocketAddr};

const DEVICE_MAX_AGE: u64 = 400 * 24 * 3600;
const SESSION_MAX_AGE: u64 = store::SESSION_MAX_DAYS as u64 * 24 * 3600;
const FORM_TOKEN_MAX_AGE: u64 = 2 * 3600;

/// A database failure becomes a plain 500 page; the error goes to the log, never to the visitor.
pub struct Fail(sqlx::Error);

impl From<sqlx::Error> for Fail {
    fn from(error: sqlx::Error) -> Self {
        Fail(error)
    }
}

impl IntoResponse for Fail {
    fn into_response(self) -> Response {
        eprintln!("database error: {}", self.0);
        page(
            StatusCode::INTERNAL_SERVER_ERROR,
            pages::message(
                "Something went wrong",
                "Please try again in a moment.",
                ("/", "Back"),
            ),
        )
    }
}

type Result<T = Response> = std::result::Result<T, Fail>;

fn page(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        body,
    )
        .into_response()
}

fn see_other(path: &str) -> Response {
    Redirect::to(path).into_response()
}

fn add_cookie(response: &mut Response, value: HeaderValue) {
    response.headers_mut().append(header::SET_COOKIE, value);
}

fn refused() -> Response {
    page(
        StatusCode::FORBIDDEN,
        pages::message(
            "Please try again",
            "This page was out of date. Reload it and try again.",
            ("/", "Back"),
        ),
    )
}

/// The device cookie: (token, hash of token, whether it is new and must be set).
fn device(state: &FamilyState, headers: &HeaderMap) -> (String, Vec<u8>, bool) {
    match web::cookie(headers, &state.config.cookie_name("hj_dev")).filter(|t| auth::valid_token(t))
    {
        Some(token) => {
            let hash = auth::sha256(token.as_bytes());
            (token, hash, false)
        }
        None => {
            let token = auth::new_token();
            let hash = auth::sha256(token.as_bytes());
            (token, hash, true)
        }
    }
}

fn set_device(state: &FamilyState, response: &mut Response, token: &str) {
    add_cookie(
        response,
        web::set_cookie(
            &state.config.cookie_name("hj_dev"),
            token,
            DEVICE_MAX_AGE,
            state.config.secure_cookies(),
        ),
    );
}

/// The pre-session form token (double-submit cookie) for the sign-in and enrolment forms.
fn form_token(state: &FamilyState, headers: &HeaderMap) -> (String, bool) {
    match web::cookie(headers, &state.config.cookie_name("hj_form"))
        .filter(|t| auth::valid_token(t))
    {
        Some(token) => (token, false),
        None => (auth::new_token(), true),
    }
}

fn form_ok(state: &FamilyState, headers: &HeaderMap, submitted: &str) -> bool {
    let cookie = web::cookie(headers, &state.config.cookie_name("hj_form")).unwrap_or_default();
    web::same_origin(headers, &state.expected_origin(headers))
        && auth::valid_token(&cookie)
        && auth::ct_eq(cookie.as_bytes(), submitted.as_bytes())
}

fn session_form_ok(
    state: &FamilyState,
    headers: &HeaderMap,
    session: &Session,
    submitted: &str,
) -> bool {
    web::same_origin(headers, &state.expected_origin(headers))
        && auth::ct_eq(session.csrf.as_bytes(), submitted.as_bytes())
}

async fn current(state: &FamilyState, headers: &HeaderMap) -> Result<Option<Session>> {
    match web::cookie(headers, &state.config.cookie_name("hj_sid")).filter(|t| auth::valid_token(t))
    {
        Some(token) => Ok(store::live_session(&state.pool, &token).await?),
        None => Ok(None),
    }
}

fn nav(session: &Session) -> Nav<'_> {
    Nav {
        handle: &session.handle,
        is_owner: session.is_owner,
        csrf: &session.csrf,
    }
}

/// The client's network, from Railway's X-Real-IP header when running on Railway, else the socket.
fn net_hash(state: &FamilyState, headers: &HeaderMap, peer: SocketAddr) -> Vec<u8> {
    let ip: IpAddr = if state.config.on_railway {
        headers
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(peer.ip())
    } else {
        peer.ip()
    };
    auth::hmac_sha256(&state.net_key, web::net_prefix(ip).as_bytes())
}

async fn signin_page(
    state: &FamilyState,
    headers: &HeaderMap,
    status: StatusCode,
    message: Option<&str>,
) -> Result {
    let profiles = store::active_profiles(&state.pool).await?;
    let (token, new_token) = form_token(state, headers);
    let mut response = page(status, pages::signin(&profiles, &token, message));
    if new_token {
        add_cookie(
            &mut response,
            web::set_cookie(
                &state.config.cookie_name("hj_form"),
                &token,
                FORM_TOKEN_MAX_AGE,
                state.config.secure_cookies(),
            ),
        );
    }
    let (device_token, _, new_device) = device(state, headers);
    if new_device {
        set_device(state, &mut response, &device_token);
    }
    Ok(response)
}

pub async fn start(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    if current(&state, &headers).await?.is_some() {
        return Ok(see_other("/home"));
    }
    signin_page(&state, &headers, StatusCode::OK, None).await
}

#[derive(Deserialize)]
pub struct SigninForm {
    #[serde(default)]
    profile: String,
    #[serde(default)]
    passphrase: String,
    #[serde(default)]
    csrf: String,
}

pub async fn signin(
    State(state): State<FamilyState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Form(form): Form<SigninForm>,
) -> Result {
    if !form_ok(&state, &headers, &form.csrf) {
        return Ok(refused());
    }
    let (device_token, device_hash, new_device) = device(&state, &headers);
    let net = net_hash(&state, &headers, peer);
    let ua = web::ua_summary(&headers);
    let profile = store::profile_by_handle(&state.pool, &form.profile).await?;
    let profile_id = profile.as_ref().map(|p| p.id);
    let attempt = |result| Attempt {
        kind: "signin",
        profile_id,
        result,
        net_hash: &net,
        device_hash: Some(&device_hash),
        ua_summary: &ua,
    };

    if store::recent_failures(&state.pool, &net, profile_id).await? >= store::FAILURE_LIMIT {
        store::record_attempt(&state.pool, attempt("rate_limited")).await?;
        return signin_page(
            &state,
            &headers,
            StatusCode::TOO_MANY_REQUESTS,
            Some("Too many attempts. Please wait 15 minutes and try again."),
        )
        .await;
    }

    let ok = match (&state.config.dev_password, &profile) {
        (Some(dev), Some(_)) => auth::ct_eq(dev.as_bytes(), form.passphrase.as_bytes()),
        (Some(_), None) => false,
        (None, _) => {
            let stored = match profile_id {
                Some(id) => store::credential(&state.pool, id).await?,
                None => None,
            };
            let verified = auth::verify_passphrase(
                &form.passphrase,
                stored.as_deref().unwrap_or(auth::dummy_hash()),
            );
            verified && stored.is_some()
        }
    };
    store::record_attempt(&state.pool, attempt(if ok { "success" } else { "failure" })).await?;
    let Some(profile) = profile.filter(|_| ok) else {
        return signin_page(&state, &headers, StatusCode::UNAUTHORIZED, Some("That did not work. Check the profile and passphrase, or ask for a new enrolment code.")).await;
    };

    store::touch_device(&state.pool, &device_hash).await?;
    let token = store::create_session(&state.pool, profile.id, &device_hash, &ua).await?;
    let has_consent = store::live_session(&state.pool, &token)
        .await?
        .is_some_and(|s| s.location_allowed.is_some());
    let mut response = see_other(if has_consent { "/home" } else { "/consent" });
    add_cookie(
        &mut response,
        web::set_cookie(
            &state.config.cookie_name("hj_sid"),
            &token,
            SESSION_MAX_AGE,
            state.config.secure_cookies(),
        ),
    );
    if new_device {
        set_device(&state, &mut response, &device_token);
    }
    Ok(response)
}

pub async fn enrol_page(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    let (token, new_token) = form_token(&state, &headers);
    let mut response = page(StatusCode::OK, pages::enrol(&token, None));
    if new_token {
        add_cookie(
            &mut response,
            web::set_cookie(
                &state.config.cookie_name("hj_form"),
                &token,
                FORM_TOKEN_MAX_AGE,
                state.config.secure_cookies(),
            ),
        );
    }
    let (device_token, _, new_device) = device(&state, &headers);
    if new_device {
        set_device(&state, &mut response, &device_token);
    }
    Ok(response)
}

#[derive(Deserialize)]
pub struct EnrolForm {
    #[serde(default)]
    code: String,
    #[serde(default)]
    passphrase: String,
    #[serde(default)]
    confirm: String,
    #[serde(default)]
    csrf: String,
}

pub async fn enrol(
    State(state): State<FamilyState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Form(form): Form<EnrolForm>,
) -> Result {
    if !form_ok(&state, &headers, &form.csrf) {
        return Ok(refused());
    }
    let (device_token, device_hash, new_device) = device(&state, &headers);
    let net = net_hash(&state, &headers, peer);
    let ua = web::ua_summary(&headers);
    let retry = |status, message: String| page(status, pages::enrol(&form.csrf, Some(&message)));

    if store::recent_failures(&state.pool, &net, None).await? >= store::FAILURE_LIMIT {
        store::record_attempt(
            &state.pool,
            Attempt {
                kind: "enrol",
                profile_id: None,
                result: "rate_limited",
                net_hash: &net,
                device_hash: Some(&device_hash),
                ua_summary: &ua,
            },
        )
        .await?;
        return Ok(retry(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Please wait 15 minutes and try again.".into(),
        ));
    }

    // Which profile does this code belong to? The bootstrap code works only for the owner, and
    // only until the owner has a passphrase. Ordinary codes are checked before being used up, so a
    // passphrase that breaks the rules does not waste the code.
    let owner = store::owner(&state.pool).await?;
    let owner_name = owner
        .as_ref()
        .map(|o| o.handle.clone())
        .unwrap_or_else(|| "the owner".into());
    let mut bootstrap = false;
    let mut profile = None;
    if let (Some(code), Some(owner)) = (&state.config.bootstrap_code, &owner)
        && auth::ct_eq(code.as_bytes(), form.code.trim().as_bytes())
        && store::credential(&state.pool, owner.id).await?.is_none()
    {
        bootstrap = true;
        profile = Some(owner.clone());
    }
    if profile.is_none()
        && let Some(id) = store::peek_enrolment_code(&state.pool, &form.code).await?
    {
        profile = store::profile_by_id(&state.pool, id).await?;
    }
    let Some(profile) = profile else {
        store::record_attempt(
            &state.pool,
            Attempt {
                kind: "enrol",
                profile_id: None,
                result: "failure",
                net_hash: &net,
                device_hash: Some(&device_hash),
                ua_summary: &ua,
            },
        )
        .await?;
        return Ok(retry(
            StatusCode::UNAUTHORIZED,
            format!(
                "That code did not work. It may have expired or been used. Ask {owner_name} for a new one."
            ),
        ));
    };
    if let Some(problem) =
        auth::passphrase_problem(&form.passphrase, &form.confirm, &profile.handle)
    {
        return Ok(retry(StatusCode::BAD_REQUEST, problem.to_string()));
    }
    if !bootstrap && store::use_enrolment_code(&state.pool, &form.code).await? != Some(profile.id) {
        return Ok(retry(
            StatusCode::UNAUTHORIZED,
            format!("That code did not work. Ask {owner_name} for a new one."),
        ));
    }

    let had_credential = store::credential(&state.pool, profile.id).await?.is_some();
    store::set_credential(
        &state.pool,
        profile.id,
        &auth::hash_passphrase(&form.passphrase),
    )
    .await?;
    store::end_profile_sessions(&state.pool, profile.id, "new passphrase").await?;
    let action = if bootstrap {
        "owner enrolled with bootstrap code"
    } else if had_credential {
        "passphrase reset with code"
    } else {
        "enrolled with code"
    };
    store::audit(&state.pool, Some(profile.id), action, "").await?;
    store::record_attempt(
        &state.pool,
        Attempt {
            kind: "enrol",
            profile_id: Some(profile.id),
            result: "success",
            net_hash: &net,
            device_hash: Some(&device_hash),
            ua_summary: &ua,
        },
    )
    .await?;

    store::touch_device(&state.pool, &device_hash).await?;
    let token = store::create_session(&state.pool, profile.id, &device_hash, &ua).await?;
    let mut response = see_other("/consent");
    add_cookie(
        &mut response,
        web::set_cookie(
            &state.config.cookie_name("hj_sid"),
            &token,
            SESSION_MAX_AGE,
            state.config.secure_cookies(),
        ),
    );
    if new_device {
        set_device(&state, &mut response, &device_token);
    }
    Ok(response)
}

pub async fn consent_page(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    let Some(session) = current(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    let label = match &session.device_hash {
        Some(hash) => store::device_label(&state.pool, hash)
            .await?
            .unwrap_or_default(),
        None => String::new(),
    };
    Ok(page(
        StatusCode::OK,
        pages::consent(&nav(&session), &label, session.location_allowed),
    ))
}

#[derive(Deserialize)]
pub struct ConsentForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    device_label: String,
}

pub async fn consent(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<ConsentForm>,
) -> Result {
    let Some(session) = current(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    if !session_form_ok(&state, &headers, &session, &form.csrf) {
        return Ok(refused());
    }
    let Some(device_hash) = &session.device_hash else {
        return Ok(see_other("/"));
    };
    let label: String = form
        .device_label
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect();
    store::save_consent(
        &state.pool,
        session.profile_id,
        device_hash,
        form.location == "yes",
        Some(&label),
    )
    .await?;
    Ok(see_other("/home"))
}

pub async fn home(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    let Some(session) = current(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    if session.location_allowed.is_none() {
        return Ok(see_other("/consent"));
    }
    let device = match &session.device_hash {
        Some(hash) => store::device_label(&state.pool, hash).await?,
        None => None,
    }
    .unwrap_or_else(|| web::ua_summary(&headers));
    let pending = session.location_allowed == Some(true) && !session.has_location;
    Ok(page(
        StatusCode::OK,
        pages::home(&nav(&session), &device, pending),
    ))
}

pub async fn journal(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    let Some(session) = current(&state, &headers).await? else {
        return Ok(see_other("/"));
    };
    let rows = store::journal(&state.pool).await?;
    let counts = store::failure_counts(&state.pool).await?;
    let details = if session.is_owner {
        Some(store::failure_details(&state.pool).await?)
    } else {
        None
    };
    let journal_days = store::setting(&state.pool, "journal_retention_days").await?;
    let location_days = store::setting(&state.pool, "location_retention_days").await?;
    Ok(page(
        StatusCode::OK,
        pages::journal(
            &nav(&session),
            &rows,
            &counts,
            details.as_deref(),
            journal_days,
            location_days,
        ),
    ))
}

async fn owner_session(
    state: &FamilyState,
    headers: &HeaderMap,
) -> Result<std::result::Result<Session, Response>> {
    match current(state, headers).await? {
        None => Ok(Err(see_other("/"))),
        Some(s) if !s.is_owner => Ok(Err(page(
            StatusCode::FORBIDDEN,
            pages::message(
                "Owner only",
                "This page is for the site owner.",
                ("/home", "Home"),
            ),
        ))),
        Some(s) => Ok(Ok(s)),
    }
}

pub async fn owner_page(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    let session = match owner_session(&state, &headers).await? {
        Ok(s) => s,
        Err(response) => return Ok(response),
    };
    let statuses = store::profile_statuses(&state.pool).await?;
    let journal_days = store::setting(&state.pool, "journal_retention_days").await?;
    let location_days = store::setting(&state.pool, "location_retention_days").await?;
    let audit = store::recent_audit(&state.pool).await?;
    Ok(page(
        StatusCode::OK,
        pages::owner(
            &nav(&session),
            &statuses,
            journal_days,
            location_days,
            &audit,
        ),
    ))
}

#[derive(Deserialize)]
pub struct ProfileForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    profile: String,
}

pub async fn owner_code(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<ProfileForm>,
) -> Result {
    let session = match owner_session(&state, &headers).await? {
        Ok(s) => s,
        Err(response) => return Ok(response),
    };
    if !session_form_ok(&state, &headers, &session, &form.csrf) {
        return Ok(refused());
    }
    let Some(profile) = store::profile_by_handle(&state.pool, &form.profile).await? else {
        return Ok(see_other("/owner"));
    };
    let (code, expires) = store::create_enrolment_code(&state.pool, profile.id).await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "enrolment code created",
        &profile.handle,
    )
    .await?;
    Ok(page(
        StatusCode::OK,
        pages::code_issued(&nav(&session), &profile.handle, &code, &expires),
    ))
}

pub async fn owner_end_sessions(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<ProfileForm>,
) -> Result {
    let session = match owner_session(&state, &headers).await? {
        Ok(s) => s,
        Err(response) => return Ok(response),
    };
    if !session_form_ok(&state, &headers, &session, &form.csrf) {
        return Ok(refused());
    }
    if let Some(profile) = store::profile_by_handle(&state.pool, &form.profile).await? {
        let ended = store::end_profile_sessions(&state.pool, profile.id, "ended by owner").await?;
        store::audit(
            &state.pool,
            Some(session.profile_id),
            "sessions ended",
            &format!("{} ({ended})", profile.handle),
        )
        .await?;
    }
    Ok(see_other("/owner"))
}

#[derive(Deserialize)]
pub struct SettingsForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    journal_days: String,
    #[serde(default)]
    location_days: String,
}

pub async fn owner_settings(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<SettingsForm>,
) -> Result {
    let session = match owner_session(&state, &headers).await? {
        Ok(s) => s,
        Err(response) => return Ok(response),
    };
    if !session_form_ok(&state, &headers, &session, &form.csrf) {
        return Ok(refused());
    }
    let journal_days: i32 = form.journal_days.trim().parse().unwrap_or(0);
    let location_days: i32 = form.location_days.trim().parse().unwrap_or(0);
    if !(30..=730).contains(&journal_days) || !(1..=journal_days).contains(&location_days) {
        return Ok(page(
            StatusCode::BAD_REQUEST,
            pages::message(
                "Not saved",
                "The journal must be kept 30 to 730 days, and locations no longer than the journal.",
                ("/owner", "Back to Owner"),
            ),
        ));
    }
    store::set_retention(&state.pool, journal_days, location_days).await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "retention changed",
        &format!("journal {journal_days} days, locations {location_days} days"),
    )
    .await?;
    Ok(see_other("/owner"))
}

#[derive(Deserialize)]
pub struct CsrfForm {
    #[serde(default)]
    csrf: String,
}

pub async fn signout(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<CsrfForm>,
) -> Result {
    if let Some(session) = current(&state, &headers).await? {
        if !session_form_ok(&state, &headers, &session, &form.csrf) {
            return Ok(refused());
        }
        store::end_session(&state.pool, session.id, "signed out").await?;
    }
    let mut response = see_other("/");
    add_cookie(
        &mut response,
        web::clear_cookie(
            &state.config.cookie_name("hj_sid"),
            state.config.secure_cookies(),
        ),
    );
    Ok(response)
}

pub async fn signout_everywhere(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<CsrfForm>,
) -> Result {
    if let Some(session) = current(&state, &headers).await? {
        if !session_form_ok(&state, &headers, &session, &form.csrf) {
            return Ok(refused());
        }
        store::end_profile_sessions(&state.pool, session.profile_id, "signed out everywhere")
            .await?;
    }
    let mut response = see_other("/");
    add_cookie(
        &mut response,
        web::clear_cookie(
            &state.config.cookie_name("hj_sid"),
            state.config.secure_cookies(),
        ),
    );
    Ok(response)
}

pub async fn privacy(State(state): State<FamilyState>) -> Result {
    let journal_days = store::setting(&state.pool, "journal_retention_days").await?;
    let location_days = store::setting(&state.pool, "location_retention_days").await?;
    Ok(page(
        StatusCode::OK,
        pages::privacy(&state.config.owner, journal_days, location_days),
    ))
}

fn api_ok(state: &FamilyState, headers: &HeaderMap, session: &Session) -> bool {
    let token = headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    web::same_origin(headers, &state.expected_origin(headers))
        && auth::ct_eq(session.csrf.as_bytes(), token.as_bytes())
}

pub async fn heartbeat(State(state): State<FamilyState>, headers: HeaderMap) -> Result {
    let Some(session) = current(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if !api_ok(&state, &headers, &session) {
        return Ok(StatusCode::FORBIDDEN.into_response());
    }
    store::heartbeat(&state.pool, session.id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
pub struct LocationForm {
    #[serde(default)]
    lat: String,
    #[serde(default)]
    lon: String,
}

pub async fn location(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Form(form): Form<LocationForm>,
) -> Result {
    let Some(session) = current(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if !api_ok(&state, &headers, &session) || session.location_allowed != Some(true) {
        return Ok(StatusCode::FORBIDDEN.into_response());
    }
    let lat = form
        .lat
        .trim()
        .parse::<f64>()
        .ok()
        .and_then(|v| web::tenths(v, 90.0));
    let lon = form
        .lon
        .trim()
        .parse::<f64>()
        .ok()
        .and_then(|v| web::tenths(v, 180.0));
    let (Some(lat), Some(lon)) = (lat, lon) else {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    };
    store::save_location(&state.pool, session.id, lat, lon).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn healthz(State(state): State<FamilyState>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        state.health.to_string(),
    )
        .into_response()
}
