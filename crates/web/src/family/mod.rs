//! P1 family mode: individual sign-in, sessions, devices, consent and the login journal.
//! Active only when a database is configured; otherwise the server stays the P0 placeholder.

pub mod auth;
pub mod doccheck;
pub mod documents;
mod explore;
mod handlers;
pub mod json;
mod pages;
mod review;
pub mod store;
pub mod web;

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use sqlx::PgPool;
use std::sync::Arc;

pub const NOTICE_VERSION: &str = "p1-2026-11-05";

/// Settings read from the environment. Family names come only from here, never from the code.
#[derive(Clone, Debug)]
pub struct Config {
    pub profiles: Vec<String>,
    pub owner: String,
    pub public_origin: Option<String>,
    /// The one family password (the owner's choice, 5 November 2026). Set in Railway, never committed.
    pub family_password: String,
    pub on_railway: bool,
}

impl Config {
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Result<Config, String> {
        let present = |key: &str| {
            get(key)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let on_railway = present("RAILWAY_ENVIRONMENT").is_some();
        let profiles: Vec<String> = present("HONGJIA_PROFILES")
            .ok_or("HONGJIA_PROFILES is required (comma-separated lowercase names)")?
            .split(',')
            .map(|p| p.trim().to_string())
            .collect();
        if profiles.is_empty() || profiles.len() > 8 {
            return Err("HONGJIA_PROFILES must name 1 to 8 profiles".into());
        }
        for (i, p) in profiles.iter().enumerate() {
            if p.is_empty() || p.len() > 20 || !p.bytes().all(|b| b.is_ascii_lowercase()) {
                return Err(format!(
                    "profile {} must be 1 to 20 lowercase letters",
                    i + 1
                ));
            }
            if profiles[..i].contains(p) {
                return Err("profile names must be unique".into());
            }
        }
        let owner = present("HONGJIA_OWNER").ok_or("HONGJIA_OWNER is required")?;
        if !profiles.contains(&owner) {
            return Err("HONGJIA_OWNER must be one of HONGJIA_PROFILES".into());
        }
        let public_origin = present("HONGJIA_PUBLIC_ORIGIN");
        if let Some(origin) = &public_origin {
            if !(origin.starts_with("https://") || origin.starts_with("http://"))
                || origin.ends_with('/')
            {
                return Err("HONGJIA_PUBLIC_ORIGIN must look like https://hongjia.org".into());
            }
            if on_railway && !origin.starts_with("https://") {
                return Err("HONGJIA_PUBLIC_ORIGIN must use https on Railway".into());
            }
        } else if on_railway {
            return Err("HONGJIA_PUBLIC_ORIGIN is required on Railway".into());
        }
        let family_password = get("HONGJIA_FAMILY_PASSWORD")
            .filter(|v| !v.is_empty())
            .ok_or("HONGJIA_FAMILY_PASSWORD is required")?;
        Ok(Config {
            profiles,
            owner,
            public_origin,
            family_password,
            on_railway,
        })
    }

    /// Cookies are marked Secure (and use the __Host- prefix) whenever the site is served over https.
    pub fn secure_cookies(&self) -> bool {
        self.public_origin
            .as_deref()
            .is_some_and(|o| o.starts_with("https://"))
    }

    pub fn cookie_name(&self, base: &str) -> String {
        if self.secure_cookies() {
            format!("__Host-{base}")
        } else {
            base.to_string()
        }
    }
}

#[derive(Clone)]
pub struct FamilyState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub net_key: Arc<Vec<u8>>,
    pub health: Arc<str>,
}

impl FamilyState {
    /// The origin forms must come from: the configured public origin, or this request's own host.
    pub fn expected_origin(&self, headers: &HeaderMap) -> String {
        match &self.config.public_origin {
            Some(origin) => origin.clone(),
            None => format!(
                "http://{}",
                headers
                    .get(header::HOST)
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or("")
            ),
        }
    }
}

pub const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
pub const PERMISSIONS_POLICY: &str = "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(self), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()";

/// The security headers in family mode (P0R's set, with forms, same-origin fetch, same-origin
/// referrers and the consented location prompt allowed).
pub fn security_headers() -> [(&'static str, &'static str); 8] {
    let mut headers = crate::security_headers();
    for entry in headers.iter_mut() {
        match entry.0 {
            "content-security-policy" => entry.1 = CONTENT_SECURITY_POLICY,
            "permissions-policy" => entry.1 = PERMISSIONS_POLICY,
            // Browsers send `Origin: null` on form posts under no-referrer, which would defeat the
            // origin check; same-origin still sends nothing to other sites.
            "referrer-policy" => entry.1 = "same-origin",
            _ => {}
        }
    }
    headers
}

/// Prepares the database (profiles from the environment, the internal network key) and builds the router.
pub async fn app(pool: PgPool, config: Config, commit: &str) -> Result<Router, sqlx::Error> {
    store::sync_profiles(&pool, &config.profiles, &config.owner).await?;
    let updated = documents::backfill_versions(&pool).await?;
    if updated > 0 {
        eprintln!(
            "upload check and search index brought up to date for {updated} earlier document versions"
        );
    }
    let net_key = store::net_key(&pool).await?;
    let state = FamilyState {
        pool,
        config: Arc::new(config),
        net_key: Arc::new(net_key),
        health: Arc::from(format!(
            r#"{{"status":"ok","commit":"{}","mode":"family"}}"#,
            crate::commit_label(Some(commit))
        )),
    };
    Ok(Router::new()
        .route("/", get(handlers::start))
        .route("/signin", post(handlers::signin))
        .route(
            "/consent",
            get(handlers::consent_page).post(handlers::consent),
        )
        .route("/home", get(handlers::home))
        .route("/journal", get(handlers::journal))
        .route("/owner", get(handlers::owner_page))
        .route("/owner/end-sessions", post(handlers::owner_end_sessions))
        .route("/owner/settings", post(handlers::owner_settings))
        .route("/signout", post(handlers::signout))
        .route("/signout-everywhere", post(handlers::signout_everywhere))
        .route("/privacy", get(handlers::privacy))
        .route("/api/heartbeat", post(handlers::heartbeat))
        .route("/api/location", post(handlers::location))
        .route("/api/search", get(explore::search))
        .route("/api/library", get(explore::library))
        .route(
            "/documents",
            get(documents::index).post(documents::upload).layer(
                axum::extract::DefaultBodyLimit::max(documents::MAX_BYTES + 64 * 1024),
            ),
        )
        .route("/documents/new", get(documents::new_form))
        .route("/documents/{key}", get(documents::view))
        .route("/documents/{key}/raw", get(documents::raw))
        .route("/documents/{key}/rename", post(documents::rename))
        .route("/documents/{key}/tags", post(documents::tags))
        .route(
            "/documents/{key}/version",
            post(documents::new_version).layer(axum::extract::DefaultBodyLimit::max(
                documents::MAX_BYTES + 64 * 1024,
            )),
        )
        .route("/documents/{key}/delete", post(documents::delete))
        .route("/documents/{key}/fields", post(review::save_field))
        .route("/documents/{key}/fields-mode", post(review::set_mode))
        .route(
            "/documents/{key}/annotations",
            get(review::list_annotations).post(review::create_annotation),
        )
        .route(
            "/documents/{key}/annotations/{id}/delete",
            post(review::delete_annotation),
        )
        .route("/healthz", get(handlers::healthz))
        .route("/robots.txt", get(|| async { crate::robots() }))
        .route(
            "/assets/site.css",
            get(|| async { crate::asset("site.css") }),
        )
        .route(
            "/assets/site.mjs",
            get(|| async { crate::asset("site.mjs") }),
        )
        .route(
            "/assets/device-profile.mjs",
            get(|| async { crate::asset("device-profile.mjs") }),
        )
        .route(
            "/assets/session.mjs",
            get(|| async { crate::asset("session.mjs") }),
        )
        .route(
            "/assets/explorer.mjs",
            get(|| async { crate::asset("explorer.mjs") }),
        )
        .route(
            "/assets/globe-layout.mjs",
            get(|| async { crate::asset("globe-layout.mjs") }),
        )
        .route(
            "/assets/doc-view.mjs",
            get(|| async { crate::asset("doc-view.mjs") }),
        )
        .fallback(|| async { crate::plain(StatusCode::NOT_FOUND, "Not found\n") })
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, guard)))
}

/// Sends other hosts to the public origin, refuses unexpected methods, and adds the security
/// headers and no-store caching to every response.
async fn guard(State(state): State<FamilyState>, request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let mut response = if let Some(target) = canonical_redirect(&state, &request) {
        let mut r = StatusCode::PERMANENT_REDIRECT.into_response();
        r.headers_mut().insert(header::LOCATION, target);
        r
    } else if method == Method::GET || method == Method::HEAD || method == Method::POST {
        next.run(request).await
    } else {
        let mut refused = crate::plain(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed\n");
        refused
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD, POST"));
        refused
    };
    let headers = response.headers_mut();
    // A handler may set a stricter policy of its own (uploaded documents do); keep it.
    for (name, value) in security_headers() {
        headers
            .entry(name)
            .or_insert(HeaderValue::from_static(value));
    }
    if !path.starts_with("/assets/")
        && path != "/robots.txt"
        && !headers.contains_key(header::CACHE_CONTROL)
    {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

fn canonical_redirect(state: &FamilyState, request: &Request) -> Option<HeaderValue> {
    let origin = state.config.public_origin.as_deref()?;
    let public_host = origin.split_once("://")?.1;
    let host = request.headers().get(header::HOST)?.to_str().ok()?;
    if host.eq_ignore_ascii_case(public_host) || request.uri().path() == "/healthz" {
        return None;
    }
    let path = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    HeaderValue::from_str(&format!("{origin}{path}")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(pairs: &[(&str, &str)]) -> Result<Config, String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_env(|k| map.get(k).cloned())
    }

    #[test]
    fn profiles_and_owner_come_from_the_environment() {
        let c = config(&[
            ("HONGJIA_PROFILES", "alpha, beta,gamma"),
            ("HONGJIA_OWNER", "gamma"),
            ("HONGJIA_FAMILY_PASSWORD", "x"),
        ])
        .unwrap();
        assert_eq!(c.profiles, vec!["alpha", "beta", "gamma"]);
        assert_eq!(c.owner, "gamma");
        assert!(!c.secure_cookies());
        assert!(
            config(&[
                ("HONGJIA_PROFILES", "alpha,Beta"),
                ("HONGJIA_OWNER", "alpha")
            ])
            .is_err()
        );
        assert!(
            config(&[
                ("HONGJIA_PROFILES", "alpha,alpha"),
                ("HONGJIA_OWNER", "alpha")
            ])
            .is_err()
        );
        assert!(config(&[("HONGJIA_PROFILES", "alpha"), ("HONGJIA_OWNER", "beta")]).is_err());
        assert!(config(&[("HONGJIA_OWNER", "alpha")]).is_err());
    }

    #[test]
    fn family_password_is_required() {
        let base = [("HONGJIA_PROFILES", "alpha"), ("HONGJIA_OWNER", "alpha")];
        let err = config(&base).unwrap_err();
        assert!(err.contains("HONGJIA_FAMILY_PASSWORD"), "{err}");
        let mut ok = base.to_vec();
        ok.push(("HONGJIA_FAMILY_PASSWORD", "family"));
        assert_eq!(config(&ok).unwrap().family_password, "family");
    }

    #[test]
    fn railway_needs_an_https_public_origin() {
        let base = [
            ("HONGJIA_PROFILES", "alpha"),
            ("HONGJIA_OWNER", "alpha"),
            ("HONGJIA_FAMILY_PASSWORD", "family"),
            ("RAILWAY_ENVIRONMENT", "production"),
        ];
        assert!(config(&base).is_err());
        let mut ok = base.to_vec();
        ok.push(("HONGJIA_PUBLIC_ORIGIN", "https://hongjia.org"));
        let c = config(&ok).unwrap();
        assert!(c.secure_cookies());
        assert_eq!(c.cookie_name("hj_sid"), "__Host-hj_sid");
        let mut http = base.to_vec();
        http.push(("HONGJIA_PUBLIC_ORIGIN", "http://hongjia.org"));
        assert!(config(&http).is_err());
    }

    #[test]
    fn family_headers_differ_from_the_placeholder_only_where_intended() {
        let placeholder = crate::security_headers();
        let family = security_headers();
        for (a, b) in placeholder.iter().zip(family.iter()) {
            assert_eq!(a.0, b.0);
            match a.0 {
                "content-security-policy" | "permissions-policy" => {}
                "referrer-policy" => assert_eq!(b.1, "same-origin"),
                _ => assert_eq!(a.1, b.1),
            }
        }
        assert!(CONTENT_SECURITY_POLICY.contains("form-action 'self'"));
        assert!(PERMISSIONS_POLICY.contains("geolocation=(self)"));
        assert!(PERMISSIONS_POLICY.contains("camera=()"));
    }
}
