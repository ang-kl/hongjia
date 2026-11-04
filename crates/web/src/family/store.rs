//! Database access. Queries are plain SQL with bound parameters; times are formatted in Singapore
//! time by PostgreSQL so the server needs no date library.

use super::auth;
use sqlx::{FromRow, PgPool};

pub const SESSION_IDLE_DAYS: i32 = 14;
pub const SESSION_MAX_DAYS: i32 = 30;
pub const FAILURE_WINDOW_MINUTES: i32 = 15;
pub const FAILURE_LIMIT: i64 = 5;

#[derive(Clone, Debug, FromRow)]
pub struct Profile {
    pub id: i16,
    pub handle: String,
    pub is_owner: bool,
}

#[derive(Clone, Debug, FromRow)]
pub struct Session {
    pub id: i64,
    pub profile_id: i16,
    pub handle: String,
    pub is_owner: bool,
    pub csrf: String,
    pub device_hash: Option<Vec<u8>>,
    pub location_allowed: Option<bool>,
    pub has_location: bool,
}

pub async fn sync_profiles(pool: &PgPool, profiles: &[String], owner: &str) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE profiles SET active = FALSE, is_owner = FALSE")
        .execute(&mut *tx)
        .await?;
    for (position, handle) in profiles.iter().enumerate() {
        sqlx::query(
            "INSERT INTO profiles (handle, position, is_owner, active) VALUES ($1, $2, $3, TRUE)
             ON CONFLICT (handle) DO UPDATE SET position = EXCLUDED.position, is_owner = EXCLUDED.is_owner, active = TRUE",
        )
        .bind(handle)
        .bind(position as i16)
        .bind(handle == owner)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// The internal key for hashing network prefixes: created once inside the database, never sent anywhere.
pub async fn net_key(pool: &PgPool) -> sqlx::Result<Vec<u8>> {
    sqlx::query(
        "INSERT INTO server_keys (name, key) VALUES ('net', $1) ON CONFLICT (name) DO NOTHING",
    )
    .bind(auth::random_bytes::<32>().to_vec())
    .execute(pool)
    .await?;
    sqlx::query_scalar("SELECT key FROM server_keys WHERE name = 'net'")
        .fetch_one(pool)
        .await
}

pub async fn active_profiles(pool: &PgPool) -> sqlx::Result<Vec<Profile>> {
    sqlx::query_as("SELECT id, handle, is_owner FROM profiles WHERE active ORDER BY position")
        .fetch_all(pool)
        .await
}

pub async fn profile_by_handle(pool: &PgPool, handle: &str) -> sqlx::Result<Option<Profile>> {
    sqlx::query_as("SELECT id, handle, is_owner FROM profiles WHERE active AND handle = $1")
        .bind(handle)
        .fetch_optional(pool)
        .await
}

pub async fn owner(pool: &PgPool) -> sqlx::Result<Option<Profile>> {
    sqlx::query_as("SELECT id, handle, is_owner FROM profiles WHERE active AND is_owner")
        .fetch_optional(pool)
        .await
}

pub async fn credential(pool: &PgPool, profile_id: i16) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT passphrase_hash FROM credentials WHERE profile_id = $1")
        .bind(profile_id)
        .fetch_optional(pool)
        .await
}

pub async fn recent_failures(
    pool: &PgPool,
    net_hash: &[u8],
    profile_id: Option<i16>,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM login_attempts
         WHERE result <> 'success' AND at > now() - make_interval(mins => $3)
           AND (net_hash = $1 OR ($2::smallint IS NOT NULL AND profile_id = $2))",
    )
    .bind(net_hash)
    .bind(profile_id)
    .bind(FAILURE_WINDOW_MINUTES)
    .fetch_one(pool)
    .await
}

pub struct Attempt<'a> {
    pub kind: &'a str,
    pub profile_id: Option<i16>,
    pub result: &'a str,
    pub net_hash: &'a [u8],
    pub device_hash: Option<&'a [u8]>,
    pub ua_summary: &'a str,
}

pub async fn record_attempt(pool: &PgPool, a: Attempt<'_>) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO login_attempts (kind, profile_id, result, net_hash, device_hash, ua_summary) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(a.kind)
    .bind(a.profile_id)
    .bind(a.result)
    .bind(a.net_hash)
    .bind(a.device_hash)
    .bind(a.ua_summary)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn touch_device(pool: &PgPool, device_hash: &[u8]) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO devices (id_hash) VALUES ($1) ON CONFLICT (id_hash) DO UPDATE SET last_seen = now()")
        .bind(device_hash)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn device_label(pool: &PgPool, device_hash: &[u8]) -> sqlx::Result<Option<String>> {
    Ok(
        sqlx::query_scalar::<_, Option<String>>("SELECT label FROM devices WHERE id_hash = $1")
            .bind(device_hash)
            .fetch_optional(pool)
            .await?
            .flatten(),
    )
}

/// Starts a session and returns its token (only its hash is stored).
pub async fn create_session(
    pool: &PgPool,
    profile_id: i16,
    device_hash: &[u8],
    ua_summary: &str,
) -> sqlx::Result<String> {
    let token = auth::new_token();
    sqlx::query(
        "INSERT INTO sessions (token_hash, profile_id, device_hash, csrf, ua_summary, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))",
    )
    .bind(auth::sha256(token.as_bytes()))
    .bind(profile_id)
    .bind(device_hash)
    .bind(auth::new_token())
    .bind(ua_summary)
    .bind(SESSION_MAX_DAYS)
    .execute(pool)
    .await?;
    Ok(token)
}

/// A live session for this token (not ended, not past its absolute or idle limit), touched as seen.
pub async fn live_session(pool: &PgPool, token: &str) -> sqlx::Result<Option<Session>> {
    sqlx::query_as(
        "WITH s AS (
             UPDATE sessions SET last_seen_at = now()
             WHERE token_hash = $1 AND ended_at IS NULL AND expires_at > now()
               AND last_seen_at > now() - make_interval(days => $2)
             RETURNING id, profile_id, csrf, device_hash, lat_tenths
         )
         SELECT s.id, s.profile_id, p.handle, p.is_owner, s.csrf, s.device_hash,
                c.location_allowed, (s.lat_tenths IS NOT NULL) AS has_location
         FROM s JOIN profiles p ON p.id = s.profile_id AND p.active
         LEFT JOIN consents c ON c.profile_id = s.profile_id AND c.device_hash = s.device_hash",
    )
    .bind(auth::sha256(token.as_bytes()))
    .bind(SESSION_IDLE_DAYS)
    .fetch_optional(pool)
    .await
}

pub async fn end_session(pool: &PgPool, session_id: i64, reason: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE sessions SET ended_at = now(), end_reason = $2 WHERE id = $1 AND ended_at IS NULL",
    )
    .bind(session_id)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn end_profile_sessions(
    pool: &PgPool,
    profile_id: i16,
    reason: &str,
) -> sqlx::Result<u64> {
    Ok(sqlx::query("UPDATE sessions SET ended_at = now(), end_reason = $2 WHERE profile_id = $1 AND ended_at IS NULL")
        .bind(profile_id)
        .bind(reason)
        .execute(pool)
        .await?
        .rows_affected())
}

pub async fn set_credential(
    pool: &PgPool,
    profile_id: i16,
    passphrase_hash: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO credentials (profile_id, passphrase_hash) VALUES ($1, $2)
         ON CONFLICT (profile_id) DO UPDATE SET passphrase_hash = EXCLUDED.passphrase_hash, updated_at = now()",
    )
    .bind(profile_id)
    .bind(passphrase_hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn create_enrolment_code(
    pool: &PgPool,
    profile_id: i16,
) -> sqlx::Result<(String, String)> {
    let code = auth::new_enrolment_code();
    let expires: String = sqlx::query_scalar(
        "INSERT INTO enrolment_codes (code_hash, profile_id, expires_at) VALUES ($1, $2, now() + interval '24 hours')
         RETURNING to_char(expires_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI')"
    )
    .bind(auth::sha256(auth::normalise_code(&code).as_bytes()))
    .bind(profile_id)
    .fetch_one(pool)
    .await?;
    Ok((code, expires))
}

/// The profile a one-time code belongs to, if it is valid, without using it up.
pub async fn peek_enrolment_code(pool: &PgPool, code: &str) -> sqlx::Result<Option<i16>> {
    sqlx::query_scalar("SELECT profile_id FROM enrolment_codes WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()")
        .bind(auth::sha256(auth::normalise_code(code).as_bytes()))
        .fetch_optional(pool)
        .await
}

/// Uses a one-time code (marks it used) and returns its profile, if it is valid.
pub async fn use_enrolment_code(pool: &PgPool, code: &str) -> sqlx::Result<Option<i16>> {
    sqlx::query_scalar(
        "UPDATE enrolment_codes SET used_at = now()
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING profile_id",
    )
    .bind(auth::sha256(auth::normalise_code(code).as_bytes()))
    .fetch_optional(pool)
    .await
}

pub async fn profile_by_id(pool: &PgPool, id: i16) -> sqlx::Result<Option<Profile>> {
    sqlx::query_as("SELECT id, handle, is_owner FROM profiles WHERE active AND id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn save_consent(
    pool: &PgPool,
    profile_id: i16,
    device_hash: &[u8],
    location: bool,
    label: Option<&str>,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO consents (profile_id, device_hash, location_allowed, notice_version) VALUES ($1, $2, $3, $4)
         ON CONFLICT (profile_id, device_hash) DO UPDATE
         SET location_allowed = EXCLUDED.location_allowed, notice_version = EXCLUDED.notice_version, decided_at = now()",
    )
    .bind(profile_id)
    .bind(device_hash)
    .bind(location)
    .bind(super::NOTICE_VERSION)
    .execute(&mut *tx)
    .await?;
    if let Some(label) = label {
        sqlx::query("UPDATE devices SET label = NULLIF($2, '') WHERE id_hash = $1")
            .bind(device_hash)
            .bind(label)
            .execute(&mut *tx)
            .await?;
    }
    if !location {
        // Turning sharing off also removes this profile's stored locations from this device.
        sqlx::query("UPDATE sessions SET lat_tenths = NULL, lon_tenths = NULL, location_at = NULL WHERE profile_id = $1 AND device_hash = $2")
            .bind(profile_id)
            .bind(device_hash)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

/// Adds active time: at most 60 seconds per heartbeat, and only when the previous one was recent.
pub async fn heartbeat(pool: &PgPool, session_id: i64) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE sessions SET
             active_seconds = active_seconds + CASE
                 WHEN last_heartbeat_at IS NOT NULL AND last_heartbeat_at > now() - interval '130 seconds'
                 THEN LEAST(60, GREATEST(0, EXTRACT(EPOCH FROM now() - last_heartbeat_at)::int))
                 ELSE 0 END,
             last_heartbeat_at = now()
         WHERE id = $1",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn save_location(
    pool: &PgPool,
    session_id: i64,
    lat: i16,
    lon: i16,
) -> sqlx::Result<bool> {
    Ok(sqlx::query(
        "UPDATE sessions SET lat_tenths = $2, lon_tenths = $3, location_at = now() WHERE id = $1 AND lat_tenths IS NULL",
    )
    .bind(session_id)
    .bind(lat)
    .bind(lon)
    .execute(pool)
    .await?
    .rows_affected()
        == 1)
}

pub async fn setting(pool: &PgPool, key: &str) -> sqlx::Result<i32> {
    sqlx::query_scalar("SELECT value FROM settings WHERE key = $1")
        .bind(key)
        .fetch_one(pool)
        .await
}

pub async fn set_retention(
    pool: &PgPool,
    journal_days: i32,
    location_days: i32,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    for (key, value) in [
        ("journal_retention_days", journal_days),
        ("location_retention_days", location_days),
    ] {
        sqlx::query("UPDATE settings SET value = $2 WHERE key = $1")
            .bind(key)
            .bind(value)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

pub async fn audit(
    pool: &PgPool,
    actor: Option<i16>,
    action: &str,
    detail: &str,
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO audit_log (actor_profile_id, action, detail) VALUES ($1, $2, $3)")
        .bind(actor)
        .bind(action)
        .bind(detail)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, FromRow)]
pub struct JournalRow {
    pub handle: String,
    pub started: String,
    pub device_label: Option<String>,
    pub device_code: Option<String>,
    pub ua_summary: String,
    pub lat_tenths: Option<i16>,
    pub lon_tenths: Option<i16>,
    pub active_seconds: i32,
    pub ended: Option<String>,
    pub end_reason: Option<String>,
    pub open: bool,
}

pub async fn journal(pool: &PgPool) -> sqlx::Result<Vec<JournalRow>> {
    sqlx::query_as(
        "SELECT p.handle,
                to_char(s.created_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS started,
                d.label AS device_label,
                upper(encode(substring(s.device_hash from 1 for 3), 'hex')) AS device_code,
                s.ua_summary, s.lat_tenths, s.lon_tenths, s.active_seconds,
                to_char(s.ended_at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS ended,
                s.end_reason,
                (s.ended_at IS NULL AND s.expires_at > now()
                    AND s.last_seen_at > now() - make_interval(days => $1)) AS open
         FROM sessions s
         JOIN profiles p ON p.id = s.profile_id
         LEFT JOIN devices d ON d.id_hash = s.device_hash
         ORDER BY s.created_at DESC
         LIMIT 200",
    )
    .bind(SESSION_IDLE_DAYS)
    .fetch_all(pool)
    .await
}

#[derive(Debug, FromRow)]
pub struct FailureCount {
    pub handle: String,
    pub failures: i64,
}

pub async fn failure_counts(pool: &PgPool) -> sqlx::Result<Vec<FailureCount>> {
    sqlx::query_as(
        "SELECT p.handle, count(a.id) AS failures
         FROM profiles p
         LEFT JOIN login_attempts a ON a.profile_id = p.id AND a.result <> 'success' AND a.at > now() - interval '7 days'
         WHERE p.active GROUP BY p.handle, p.position ORDER BY p.position",
    )
    .fetch_all(pool)
    .await
}

#[derive(Debug, FromRow)]
pub struct FailureDetail {
    pub at: String,
    pub kind: String,
    pub handle: Option<String>,
    pub result: String,
    pub ua_summary: String,
}

pub async fn failure_details(pool: &PgPool) -> sqlx::Result<Vec<FailureDetail>> {
    sqlx::query_as(
        "SELECT to_char(a.at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS at, a.kind, p.handle, a.result, a.ua_summary
         FROM login_attempts a LEFT JOIN profiles p ON p.id = a.profile_id
         WHERE a.result <> 'success' ORDER BY a.at DESC LIMIT 50"
    )
    .fetch_all(pool)
    .await
}

#[derive(Debug, FromRow)]
pub struct ProfileStatus {
    pub id: i16,
    pub handle: String,
    pub is_owner: bool,
    pub enrolled: bool,
    pub last_signin: Option<String>,
}

pub async fn profile_statuses(pool: &PgPool) -> sqlx::Result<Vec<ProfileStatus>> {
    sqlx::query_as(
        "SELECT p.id, p.handle, p.is_owner, (c.profile_id IS NOT NULL) AS enrolled,
                (SELECT to_char(max(s.created_at) AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') FROM sessions s WHERE s.profile_id = p.id) AS last_signin
         FROM profiles p LEFT JOIN credentials c ON c.profile_id = p.id
         WHERE p.active ORDER BY p.position"
    )
    .fetch_all(pool)
    .await
}

#[derive(Debug, FromRow)]
pub struct AuditRow {
    pub at: String,
    pub handle: Option<String>,
    pub action: String,
    pub detail: String,
}

pub async fn recent_audit(pool: &PgPool) -> sqlx::Result<Vec<AuditRow>> {
    sqlx::query_as(
        "SELECT to_char(a.at AT TIME ZONE 'Asia/Singapore', 'FMDD Mon YYYY, HH24:MI') AS at, p.handle, a.action, a.detail
         FROM audit_log a LEFT JOIN profiles p ON p.id = a.actor_profile_id ORDER BY a.at DESC LIMIT 20"
    )
    .fetch_all(pool)
    .await
}

/// Deletes journal data older than the owner's settings. Returns (sessions, locations, attempts, codes).
pub async fn run_retention(pool: &PgPool) -> sqlx::Result<(u64, u64, u64, u64)> {
    let journal_days = setting(pool, "journal_retention_days").await?;
    let location_days = setting(pool, "location_retention_days").await?;
    let sessions =
        sqlx::query("DELETE FROM sessions WHERE created_at < now() - make_interval(days => $1)")
            .bind(journal_days)
            .execute(pool)
            .await?
            .rows_affected();
    let locations = sqlx::query(
        "UPDATE sessions SET lat_tenths = NULL, lon_tenths = NULL, location_at = NULL
         WHERE location_at < now() - make_interval(days => $1)",
    )
    .bind(location_days)
    .execute(pool)
    .await?
    .rows_affected();
    let attempts = sqlx::query(
        "DELETE FROM login_attempts WHERE at < now() - make_interval(days => LEAST($1, 90))",
    )
    .bind(journal_days)
    .execute(pool)
    .await?
    .rows_affected();
    let codes =
        sqlx::query("DELETE FROM enrolment_codes WHERE expires_at < now() - interval '7 days'")
            .execute(pool)
            .await?
            .rows_affected();
    audit(
        pool,
        None,
        "retention",
        &format!("sessions {sessions}, locations {locations}, attempts {attempts}, codes {codes}"),
    )
    .await?;
    Ok((sessions, locations, attempts, codes))
}
