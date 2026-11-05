//! Family-mode integration tests against PostgreSQL. Run with:
//! `DATABASE_URL=postgres://... cargo test --features db-tests`
//! Each test gets a fresh database with the migrations applied.
#![cfg(feature = "db-tests")]

use hongjia_web::family::{self, Config};
use sqlx::PgPool;
use std::collections::HashMap;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const FAMILY: &str = "test family password";

fn config() -> Config {
    Config {
        profiles: ["alpha", "beta", "gamma", "delta"]
            .map(String::from)
            .to_vec(),
        owner: "delta".into(),
        public_origin: None,
        family_password: FAMILY.into(),
        on_railway: false,
    }
}

async fn start(pool: PgPool, config: Config) -> u16 {
    let app = family::app(pool, config, "abc1234")
        .await
        .expect("family app");
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("serve");
    });
    port
}

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
    fn hidden(&self, name: &str) -> String {
        let marker = format!(r#"name="{name}" value=""#);
        let start = self
            .body
            .find(&marker)
            .unwrap_or_else(|| panic!("no hidden {name} in page"))
            + marker.len();
        self.body[start..start + self.body[start..].find('"').expect("quote")].to_string()
    }
}

struct Client {
    port: u16,
    cookies: HashMap<String, String>,
    origin: Option<String>,
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl Client {
    fn new(port: u16) -> Client {
        Client {
            port,
            cookies: HashMap::new(),
            origin: Some(format!("http://127.0.0.1:{port}")),
        }
    }

    async fn send(
        &mut self,
        method: &str,
        path: &str,
        body: &str,
        extra: &[(&str, &str)],
    ) -> Reply {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port))
            .await
            .expect("connect");
        let cookie = self
            .cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        let mut request = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\nUser-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1\r\n",
            self.port
        );
        if !cookie.is_empty() {
            request.push_str(&format!("Cookie: {cookie}\r\n"));
        }
        if method == "POST" {
            if let Some(origin) = &self.origin {
                request.push_str(&format!("Origin: {origin}\r\n"));
            }
            let custom_type = extra
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("content-type"));
            if !custom_type {
                request.push_str("Content-Type: application/x-www-form-urlencoded\r\n");
            }
            request.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        for (name, value) in extra {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        request.push_str("\r\n");
        request.push_str(body);
        stream.write_all(request.as_bytes()).await.expect("write");
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).await.expect("read");
        let text = String::from_utf8(bytes).expect("utf-8");
        let (head, body) = text.split_once("\r\n\r\n").expect("head");
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .unwrap()
            .split(' ')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers: Vec<(String, String)> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
            .collect();
        for (name, value) in &headers {
            if name == "set-cookie" {
                let pair = value.split(';').next().unwrap();
                let (k, v) = pair.split_once('=').unwrap();
                if v.is_empty() || value.contains("Max-Age=0") {
                    self.cookies.remove(k);
                } else {
                    self.cookies.insert(k.to_string(), v.to_string());
                }
            }
        }
        Reply {
            status,
            headers,
            body: body.to_string(),
        }
    }

    async fn get(&mut self, path: &str) -> Reply {
        self.send("GET", path, "", &[]).await
    }

    async fn post(&mut self, path: &str, form: &[(&str, &str)]) -> Reply {
        let body = form
            .iter()
            .map(|(k, v)| format!("{k}={}", urlencode(v)))
            .collect::<Vec<_>>()
            .join("&");
        self.send("POST", path, &body, &[]).await
    }

    async fn signin(&mut self, profile: &str, passphrase: &str) -> Reply {
        let page = self.get("/").await;
        let csrf = page.hidden("csrf");
        self.post(
            "/signin",
            &[
                ("csrf", &csrf),
                ("profile", profile),
                ("passphrase", passphrase),
            ],
        )
        .await
    }

    async fn consent(&mut self, location: &str) -> Reply {
        let page = self.get("/consent").await;
        let csrf = page.hidden("csrf");
        self.post(
            "/consent",
            &[
                ("csrf", &csrf),
                ("location", location),
                ("device_label", "test phone"),
            ],
        )
        .await
    }

    async fn csrf(&mut self) -> String {
        self.get("/consent").await.hidden("csrf")
    }
}

/// Signs in as the owner with the family password and saves consent; returns the client.
async fn owner(port: u16) -> Client {
    member(port, "delta").await
}

/// Signs in as a profile with the family password and saves consent; returns the client.
async fn member(port: u16, handle: &str) -> Client {
    let mut c = Client::new(port);
    let r = c.signin(handle, FAMILY).await;
    assert_eq!(r.status, 303, "{}", r.body);
    assert_eq!(r.header("location"), Some("/consent"));
    assert_eq!(c.consent("no").await.status, 303);
    c
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn family_password_signs_in_every_profile(pool: PgPool) {
    let port = start(pool, config()).await;
    for handle in ["alpha", "beta", "gamma", "delta"] {
        let mut c = member(port, handle).await;
        let home = c.get("/home").await;
        assert_eq!(home.status, 200);
        assert!(home.body.contains(&format!("Hello, {handle}")));
    }
    let page = Client::new(port).get("/").await.body;
    assert!(page.contains("Family password"));
    assert!(!page.contains("/enrol"), "no enrolment link");
    assert_eq!(
        Client::new(port).get("/enrol").await.status,
        404,
        "enrolment is gone"
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn signin_success_failure_and_rate_limit(pool: PgPool) {
    let port = start(pool, config()).await;
    let _o = owner(port).await;
    let mut c = Client::new(port);
    let wrong = c.signin("delta", "wrong passphrase entirely").await;
    assert_eq!(wrong.status, 401);
    assert!(wrong.body.contains("That did not work"));
    assert_eq!(c.signin("nobody", FAMILY).await.status, 401);
    let ok = c.signin("delta", FAMILY).await;
    assert_eq!(ok.status, 303);
    assert_eq!(
        ok.header("location"),
        Some("/consent"),
        "a new device asks for consent first"
    );

    let mut attacker = Client::new(port);
    for _ in 0..3 {
        assert_eq!(
            attacker.signin("delta", "guess guess guess").await.status,
            401
        );
    }
    let blocked = attacker.signin("delta", FAMILY).await;
    assert_eq!(
        blocked.status, 429,
        "five failures in 15 minutes block even the right passphrase"
    );
    assert!(blocked.body.contains("Too many attempts"));
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn csrf_origin_and_owner_checks(pool: PgPool) {
    let port = start(pool, config()).await;
    let mut o = owner(port).await;
    assert_eq!(o.post("/signout", &[("csrf", "wrong")]).await.status, 403);
    let csrf = o.csrf().await;
    o.origin = Some("https://evil.example".into());
    assert_eq!(
        o.post(
            "/owner/end-sessions",
            &[("csrf", &csrf), ("profile", "beta")]
        )
        .await
        .status,
        403
    );
    o.origin = Some(format!("http://127.0.0.1:{port}"));
    assert_eq!(
        o.send("POST", "/api/heartbeat", "", &[]).await.status,
        403,
        "heartbeat needs the CSRF header"
    );
    assert_eq!(
        o.send("POST", "/api/heartbeat", "", &[("X-CSRF-Token", &csrf)])
            .await
            .status,
        204
    );

    let mut b = member(port, "beta").await;
    assert_eq!(b.get("/owner").await.status, 403);
    let bcsrf = b.csrf().await;
    assert_eq!(
        b.post(
            "/owner/end-sessions",
            &[("csrf", &bcsrf), ("profile", "alpha")]
        )
        .await
        .status,
        403
    );

    let mut anonymous = Client::new(port);
    assert_eq!(anonymous.get("/home").await.status, 303);
    assert_eq!(
        anonymous
            .send("POST", "/api/heartbeat", "", &[])
            .await
            .status,
        401
    );
    let form = anonymous.get("/").await.hidden("csrf");
    anonymous.origin = None;
    assert_eq!(
        anonymous
            .post(
                "/signin",
                &[
                    ("csrf", &form),
                    ("profile", "delta"),
                    ("passphrase", FAMILY)
                ]
            )
            .await
            .status,
        403,
        "no Origin, no sign-in"
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn location_needs_consent_and_is_rounded(pool: PgPool) {
    let port = start(pool, config()).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    async fn send(c: &mut Client, csrf: &str, lat: &str, lon: &str) -> u16 {
        let body = format!("lat={lat}&lon={lon}");
        c.send("POST", "/api/location", &body, &[("X-CSRF-Token", csrf)])
            .await
            .status
    }
    assert_eq!(
        send(&mut o, &csrf, "1.3521", "103.8198").await,
        403,
        "no consent, no location"
    );
    assert_eq!(o.consent("yes").await.status, 303);
    assert!(o.get("/home").await.body.contains(r#"data-location="yes""#));
    assert_eq!(send(&mut o, &csrf, "91", "0").await, 400);
    assert_eq!(send(&mut o, &csrf, "1.3521", "103.8198").await, 204);
    let journal = o.get("/journal").await.body;
    assert!(
        journal.contains("about 1.4°N, 103.8°E"),
        "rounded to tenths"
    );
    assert!(!journal.contains("1.3521"));
    assert_eq!(o.consent("no").await.status, 303);
    let journal = o.get("/journal").await.body;
    assert!(
        !journal.contains("about 1.4°N"),
        "choosing No removes stored locations from this device"
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn heartbeat_adds_bounded_active_time(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    assert_eq!(
        o.send("POST", "/api/heartbeat", "", &[("X-CSRF-Token", &csrf)])
            .await
            .status,
        204
    );
    sqlx::query("UPDATE sessions SET last_heartbeat_at = now() - interval '45 seconds'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        o.send("POST", "/api/heartbeat", "", &[("X-CSRF-Token", &csrf)])
            .await
            .status,
        204
    );
    sqlx::query("UPDATE sessions SET last_heartbeat_at = now() - interval '10 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        o.send("POST", "/api/heartbeat", "", &[("X-CSRF-Token", &csrf)])
            .await
            .status,
        204
    );
    let seconds: i32 = sqlx::query_scalar("SELECT max(active_seconds) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        (44..=47).contains(&seconds),
        "only the recent gap counts, at most 60 seconds: {seconds}"
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn journal_captions_counts_and_owner_details(pool: PgPool) {
    let port = start(pool, config()).await;
    let mut o = owner(port).await;
    let mut b = member(port, "beta").await;
    let mut x = Client::new(port);
    assert_eq!(
        x.signin("beta", "not the passphrase at all").await.status,
        401
    );

    let jo = o.get("/journal").await.body;
    assert!(jo.contains("Profile selected, not proof of who signed in."));
    assert!(jo.contains("An open tab does not prove someone was reading."));
    assert!(jo.contains("Safari on iPhone"));
    assert!(jo.contains("test phone"));
    assert!(jo.contains("beta 1"), "failure count per profile");
    assert!(jo.contains("Unsuccessful attempts (owner only)"));
    let jb = b.get("/journal").await.body;
    assert!(
        !jb.contains("Unsuccessful attempts (owner only)"),
        "details are for the owner only"
    );
    assert!(jb.contains("beta 1"));
    assert!(!jb.contains('\u{2013}') && !jb.contains('\u{2014}'));
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn sessions_end_in_every_way(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let mut o = owner(port).await;
    let mut b1 = member(port, "beta").await;
    let mut b2 = Client::new(port);
    assert_eq!(b2.signin("beta", FAMILY).await.status, 303);

    // Sign out here only.
    let csrf = b2.csrf().await;
    assert_eq!(b2.post("/signout", &[("csrf", &csrf)]).await.status, 303);
    assert_eq!(b2.get("/home").await.status, 303);
    assert_eq!(b1.get("/home").await.status, 200);

    // Owner ends beta's sessions.
    let csrf = o.csrf().await;
    assert_eq!(
        o.post(
            "/owner/end-sessions",
            &[("csrf", &csrf), ("profile", "beta")]
        )
        .await
        .status,
        303
    );
    assert_eq!(b1.get("/home").await.status, 303);

    // Idle limit: a session unused for 15 days is no longer valid.
    let mut b3 = Client::new(port);
    assert_eq!(b3.signin("beta", FAMILY).await.status, 303);
    sqlx::query("UPDATE sessions SET last_seen_at = now() - interval '15 days' WHERE ended_at IS NULL AND profile_id = (SELECT id FROM profiles WHERE handle = 'beta')")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(b3.get("/home").await.status, 303);

    // Sign out everywhere.
    let mut o2 = Client::new(port);
    assert_eq!(o2.signin("delta", FAMILY).await.status, 303);
    let csrf = o.csrf().await;
    assert_eq!(
        o.post("/signout-everywhere", &[("csrf", &csrf)])
            .await
            .status,
        303
    );
    assert_eq!(o2.get("/home").await.status, 303);
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn retention_purges_and_settings_are_bounded(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let o = owner(port).await;
    sqlx::query("UPDATE sessions SET created_at = now() - interval '200 days'")
        .execute(&pool)
        .await
        .unwrap();
    let mut o2 = Client::new(port);
    assert_eq!(o2.signin("delta", FAMILY).await.status, 303);
    sqlx::query("UPDATE sessions SET lat_tenths = 13, lon_tenths = 1038, location_at = now() - interval '100 days' WHERE created_at > now() - interval '1 day'")
        .execute(&pool)
        .await
        .unwrap();
    let (sessions, locations, _) = family::store::run_retention(&pool).await.unwrap();
    assert_eq!(sessions, 1);
    assert_eq!(locations, 1);
    let left: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sessions WHERE lat_tenths IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(left, 0);

    let csrf = o2.csrf().await;
    let bad = o2
        .post(
            "/owner/settings",
            &[
                ("csrf", &csrf),
                ("journal_days", "10"),
                ("location_days", "5"),
            ],
        )
        .await;
    assert_eq!(bad.status, 400);
    let bad = o2
        .post(
            "/owner/settings",
            &[
                ("csrf", &csrf),
                ("journal_days", "60"),
                ("location_days", "90"),
            ],
        )
        .await;
    assert_eq!(bad.status, 400, "locations may not outlive the journal");
    assert_eq!(
        o2.post(
            "/owner/settings",
            &[
                ("csrf", &csrf),
                ("journal_days", "120"),
                ("location_days", "30")
            ]
        )
        .await
        .status,
        303
    );
    assert!(
        o2.get("/journal")
            .await
            .body
            .contains("Kept for 120 days; locations for 30 days.")
    );
    drop(o);
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn family_headers_health_and_unknown_routes(pool: PgPool) {
    let port = start(pool, config()).await;
    let mut c = Client::new(port);
    let r = c.get("/").await;
    assert_eq!(r.status, 200);
    assert_eq!(
        r.header("content-security-policy"),
        Some(family::CONTENT_SECURITY_POLICY)
    );
    assert_eq!(r.header("cache-control"), Some("no-store"));
    assert_eq!(
        r.header("referrer-policy"),
        Some("same-origin"),
        "no-referrer would make browsers send Origin: null on form posts"
    );
    assert_eq!(r.header("x-robots-tag"), Some("noindex, nofollow"));
    assert!(r.body.contains(r#"value="alpha""#) && r.body.contains(r#"value="delta""#));
    let h = c.get("/healthz").await;
    assert_eq!(
        h.body,
        r#"{"status":"ok","commit":"abc1234","mode":"family"}"#
    );
    assert_eq!(c.get("/nope").await.status, 404);
    assert_eq!(c.send("PUT", "/", "", &[]).await.status, 405);
    assert_eq!(c.get("/assets/session.mjs").await.status, 200);
    assert_eq!(c.get("/privacy").await.status, 200);
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn profiles_follow_the_environment(pool: PgPool) {
    start(pool.clone(), config()).await;
    let mut cfg = config();
    cfg.profiles = ["alpha", "delta"].map(String::from).to_vec();
    let port = start(pool, cfg).await;
    let page = Client::new(port).get("/").await.body;
    assert!(
        page.contains(r#"value="alpha""#) && !page.contains(r#"value="beta""#),
        "removed profiles are hidden, not deleted"
    );
}

const BOUNDARY: &str = "----hongjia-test-boundary";

fn multipart(fields: &[(&str, &str)], file: Option<(&str, &str)>) -> String {
    let mut body = String::new();
    for (name, value) in fields {
        body.push_str(&format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        ));
    }
    if let Some((filename, content)) = file {
        body.push_str(&format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: text/html\r\n\r\n{content}\r\n"
        ));
    }
    body.push_str(&format!("--{BOUNDARY}--\r\n"));
    body
}

async fn upload(c: &mut Client, csrf: &str, title: &str, file: Option<(&str, &str)>) -> Reply {
    send_multipart(c, "/documents", &[("csrf", csrf), ("title", title)], file).await
}

async fn send_multipart(
    c: &mut Client,
    path: &str,
    fields: &[(&str, &str)],
    file: Option<(&str, &str)>,
) -> Reply {
    let body = multipart(fields, file);
    let content_type = format!("multipart/form-data; boundary={BOUNDARY}");
    c.send("POST", path, &body, &[("Content-Type", &content_type)])
        .await
}

/// Today's date in Singapore as a filing number starts, for example 2026-1105.
async fn today(pool: &PgPool) -> String {
    sqlx::query_scalar("SELECT to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'YYYY-MMDD')")
        .fetch_one(pool)
        .await
        .unwrap()
}

const SAMPLE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sample</title></head><body><h1>Sample trip</h1><img data-src=\"https://example.org/p.jpg\" alt=\"photo\"><button id=\"retry\">Retry photos</button><script>document.getElementById('retry').onclick=()=>{};</script></body></html>";

#[sqlx::test(migrations = "../../db/migrations")]
async fn documents_upload_list_view_and_sandboxed_raw(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    let r = upload(&mut o, &csrf, "", Some(("sample-trip.html", SAMPLE))).await;
    assert_eq!(r.status, 303, "{}", r.body);
    let location = r.header("location").unwrap().to_string();
    assert!(location.starts_with("/documents/"));

    let list = o.get("/documents").await;
    assert_eq!(list.status, 200);
    assert!(list.body.contains("sample-trip") && list.body.contains("v1 · delta"));

    let view = o.get(&location).await;
    assert_eq!(view.status, 200);
    assert!(view.body.contains(
        r#"sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals""#
    ));
    assert!(!view.body.contains("allow-same-origin"));
    assert!(
        view.header("content-security-policy")
            .unwrap()
            .contains("frame-src 'self'")
    );

    let raw = o.get(&format!("{location}/raw")).await;
    assert_eq!(raw.status, 200);
    assert_eq!(raw.body, SAMPLE, "served byte for byte");
    assert_eq!(raw.header("content-type"), Some("text/html; charset=utf-8"));
    assert_eq!(
        raw.header("content-security-policy"),
        Some(hongjia_web::family::documents::DOCUMENT_CSP)
    );
    assert_eq!(raw.header("referrer-policy"), Some("no-referrer"));
    assert_eq!(raw.header("cache-control"), Some("private, no-store"));
    assert_eq!(raw.header("x-content-type-options"), Some("nosniff"));

    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM document_versions WHERE version_no = 1 AND octet_length(sha256) = 32",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 1);

    // Members can upload and read too; strangers cannot read anything.
    let mut b = member(port, "beta").await;
    assert_eq!(b.get(&format!("{location}/raw")).await.status, 200);
    let mut stranger = Client::new(port);
    assert_eq!(stranger.get(&format!("{location}/raw")).await.status, 303);
    assert_eq!(stranger.get("/documents").await.status, 303);
    assert_eq!(o.get("/documents/999999").await.status, 404);
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn document_uploads_are_checked(pool: PgPool) {
    let port = start(pool, config()).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    assert_eq!(
        upload(&mut o, "wrong", "x", Some(("a.html", SAMPLE)))
            .await
            .status,
        403,
        "CSRF token required"
    );
    assert_eq!(
        upload(&mut o, &csrf, "x", Some(("tool.exe", "MZ")))
            .await
            .status,
        400,
        "only HTML and text for now"
    );
    assert_eq!(
        upload(&mut o, &csrf, "x", Some(("empty.html", "")))
            .await
            .status,
        400
    );
    assert_eq!(
        upload(&mut o, &csrf, "x", None).await.status,
        400,
        "a file is required"
    );
    let big = "a".repeat(hongjia_web::family::documents::MAX_BYTES + 1);
    assert_eq!(
        upload(&mut o, &csrf, "x", Some(("big.txt", &big)))
            .await
            .status,
        413
    );
    o.origin = Some("https://evil.example".into());
    assert_eq!(
        upload(&mut o, &csrf, "x", Some(("a.html", SAMPLE)))
            .await
            .status,
        403,
        "Origin must match"
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn documents_are_filed_by_date_and_number(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let day = today(&pool).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    let first = upload(&mut o, &csrf, "One", Some(("one.html", SAMPLE))).await;
    assert_eq!(
        first.header("location"),
        Some(format!("/documents/{day}_1").as_str())
    );
    let second = upload(&mut o, &csrf, "Two", Some(("two.html", SAMPLE))).await;
    assert_eq!(
        second.header("location"),
        Some(format!("/documents/{day}_2").as_str())
    );

    let view = o.get(&format!("/documents/{day}_1")).await;
    assert_eq!(view.status, 200);
    assert!(
        view.body.contains(&format!("{day}_#1")),
        "label shown with #"
    );
    let list = o.get("/documents").await;
    assert!(list.body.contains(&format!("{day}_#2")) && list.body.contains(r#"class="count""#));

    // The old numeric address forwards to the filing number.
    let id: i64 = sqlx::query_scalar("SELECT id FROM documents WHERE day_no = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let old = o.get(&format!("/documents/{id}")).await;
    assert_eq!(old.status, 308);
    assert_eq!(
        old.header("location"),
        Some(format!("/documents/{day}_1").as_str())
    );
    let old_raw = o.get(&format!("/documents/{id}/raw")).await;
    assert_eq!(
        old_raw.header("location"),
        Some(format!("/documents/{day}_1/raw").as_str())
    );
    for missing in [
        "/documents/2026-1399_1",
        "/documents/abc",
        "/documents/2000-0101_1",
        "/documents/999999",
    ] {
        assert_eq!(o.get(missing).await.status, 404, "{missing}");
    }

    // A deleted number is never given out again.
    let r = o
        .post(
            &format!("/documents/{day}_2/delete"),
            &[("csrf", &csrf), ("confirm", "DELETE")],
        )
        .await;
    assert_eq!(r.status, 303);
    let third = upload(&mut o, &csrf, "Three", Some(("three.html", SAMPLE))).await;
    assert_eq!(
        third.header("location"),
        Some(format!("/documents/{day}_3").as_str())
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn only_the_uploader_and_the_owner_change_or_delete(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let day = today(&pool).await;
    let mut b = member(port, "beta").await;
    let b_csrf = b.csrf().await;
    upload(&mut b, &b_csrf, "Beta's page", Some(("b.html", SAMPLE))).await;
    let key = format!("/documents/{day}_1");

    // Another member reads it but cannot change it.
    let mut g = member(port, "gamma").await;
    let g_csrf = g.csrf().await;
    let page = g.get(&key).await;
    assert_eq!(page.status, 200);
    assert!(
        page.body
            .contains("Only beta or delta can change or delete this document.")
    );
    assert!(!page.body.contains("/rename") && !page.body.contains("/delete"));
    for (action, form) in [
        (
            "rename",
            vec![("csrf", g_csrf.as_str()), ("title", "Mine now")],
        ),
        ("tags", vec![("csrf", g_csrf.as_str()), ("tags", "#x")]),
        (
            "delete",
            vec![("csrf", g_csrf.as_str()), ("confirm", "DELETE")],
        ),
    ] {
        assert_eq!(
            g.post(&format!("{key}/{action}"), &form).await.status,
            403,
            "{action}"
        );
    }
    let version = send_multipart(
        &mut g,
        &format!("{key}/version"),
        &[("csrf", &g_csrf)],
        Some(("g.html", "<p>g</p>")),
    )
    .await;
    assert_eq!(version.status, 403);

    // The uploader can; a stale token cannot.
    let page = b.get(&key).await;
    assert!(page.body.contains(&format!(r#"action="{key}/rename""#)));
    assert_eq!(
        b.post(
            &format!("{key}/rename"),
            &[("csrf", "stale"), ("title", "x")]
        )
        .await
        .status,
        403
    );
    let r = b
        .post(
            &format!("{key}/rename"),
            &[("csrf", &b_csrf), ("title", "Renamed")],
        )
        .await;
    assert_eq!(r.status, 303);
    assert_eq!(r.header("location"), Some(format!("{key}#panel").as_str()));
    assert!(b.get(&key).await.body.contains("Renamed"));

    // The owner can too, and a delete needs the word typed exactly.
    let mut o = owner(port).await;
    let o_csrf = o.csrf().await;
    assert_eq!(
        o.post(
            &format!("{key}/tags"),
            &[("csrf", &o_csrf), ("tags", "#Owner")]
        )
        .await
        .status,
        303
    );
    let wrong = o
        .post(
            &format!("{key}/delete"),
            &[("csrf", &o_csrf), ("confirm", "delete")],
        )
        .await;
    assert_eq!(wrong.status, 400);
    assert!(wrong.body.contains("Nothing was deleted"));
    assert_eq!(b.get(&key).await.status, 200);
    let gone = o
        .post(
            &format!("{key}/delete"),
            &[("csrf", &o_csrf), ("confirm", "DELETE")],
        )
        .await;
    assert_eq!(gone.status, 303);
    assert_eq!(b.get(&key).await.status, 404);
    assert_eq!(b.get(&format!("{key}/raw")).await.status, 404);
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM document_versions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "every version is removed");
    let audit: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'document deleted'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(audit, 1);
}

const STACK: &str = r#"<!doctype html><html><head><title>Stack</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.example.net/x.js"></script></head><body><input type="checkbox"><h1>Stack</h1></body></html>"#;

#[sqlx::test(migrations = "../../db/migrations")]
async fn hashtags_versions_and_the_upload_check(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let day = today(&pool).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;

    // Typed hashtags are kept; without them, the site suggests some.
    send_multipart(
        &mut o,
        "/documents",
        &[
            ("csrf", &csrf),
            ("title", ""),
            ("tags", "#Trip, #2031 trip"),
        ],
        Some(("a.html", SAMPLE)),
    )
    .await;
    let typed = o.get(&format!("/documents/{day}_1")).await.body;
    assert!(
        typed.contains(r#"<span class="tag">#trip</span><span class="tag">#2031</span>"#),
        "order kept"
    );
    upload(&mut o, &csrf, "", Some(("sample-trip.html", SAMPLE))).await;
    let suggested = o.get(&format!("/documents/{day}_2")).await.body;
    assert!(
        suggested.contains("#sample"),
        "suggested from the title and headings"
    );

    // A new version is shown; the first stays available.
    let key = format!("/documents/{day}_1");
    let r = send_multipart(
        &mut o,
        &format!("{key}/version"),
        &[("csrf", &csrf)],
        Some(("a2.html", "<p>second</p>")),
    )
    .await;
    assert_eq!(r.status, 303, "{}", r.body);
    assert_eq!(o.get(&format!("{key}/raw")).await.body, "<p>second</p>");
    assert_eq!(o.get(&format!("{key}/raw?v=1")).await.body, SAMPLE);
    let view = o.get(&key).await.body;
    assert!(
        view.contains("Version 2</a> (shown)")
            && view.contains(r#"<h2>Versions</h2><span class="count">2</span>"#)
    );
    let bad = send_multipart(
        &mut o,
        &format!("{key}/version"),
        &[("csrf", &csrf)],
        Some(("a.exe", "MZ")),
    )
    .await;
    assert_eq!(bad.status, 400);

    // The upload check reports the design stack and what the frame blocks.
    upload(&mut o, &csrf, "Stack", Some(("stack.html", STACK))).await;
    let stack = o.get(&format!("/documents/{day}_3")).await.body;
    assert!(
        stack.contains("GSAP") && stack.contains("cdn.example.net"),
        "check shown in the panel"
    );
    assert!(stack.contains("Fillable fields"));

    // Versions from before the check are checked when the server starts.
    sqlx::query("UPDATE document_versions SET checked = false, libraries = '{}'")
        .execute(&pool)
        .await
        .unwrap();
    start(pool.clone(), config()).await;
    let libraries: Vec<String> = sqlx::query_scalar(
        "SELECT v.libraries FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.day_no = 3",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(libraries, vec!["GSAP"]);
}

const BACKSLASH: char = '\\';

fn page_with(title: &str, body: &str) -> String {
    format!(
        "<!doctype html><html><head><title>{title}</title></head><body><h1>{title}</h1>{body}</body></html>"
    )
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn search_finds_titles_hashtags_and_text(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let day = today(&pool).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    send_multipart(
        &mut o,
        "/documents",
        &[
            ("csrf", &csrf),
            ("title", "Harbour walk"),
            ("tags", "#boats #lake"),
        ],
        Some((
            "h.html",
            &page_with("Harbour walk", "<p>Morning by the water.</p>"),
        )),
    )
    .await;
    let long = format!(
        "{} The lantern festival starts at dusk. 灯笼节日 {}",
        "padding words ".repeat(40),
        "more ".repeat(60)
    );
    send_multipart(
        &mut o,
        "/documents",
        &[
            ("csrf", &csrf),
            ("title", "Festival notes"),
            ("tags", "#events"),
        ],
        Some((
            "f.html",
            &page_with(
                "Festival notes",
                &format!("<p>{long}</p><script>var hidden = 'lanternscript';</script>"),
            ),
        )),
    )
    .await;
    send_multipart(
        &mut o,
        "/documents",
        &[
            ("csrf", &csrf),
            ("title", "Quotes \"and\" <tags>"),
            ("tags", "#misc"),
        ],
        Some(("q.txt", "Plain text about gardens.")),
    )
    .await;

    let r = o.get("/api/search?q=harbour").await;
    assert_eq!(r.status, 200);
    assert_eq!(
        r.header("content-type"),
        Some("application/json; charset=utf-8")
    );
    assert!(
        r.body
            .starts_with(r#"{"query":"harbour","results":[{"key":""#),
        "{}",
        r.body
    );
    assert!(
        r.body.contains(&format!(
            r#""key":"{day}_1","label":"{day}_#1","title":"Harbour walk","tags":["boats","lake"]"#
        )),
        "{}",
        r.body
    );

    let tag = o.get("/api/search?q=%23boats").await.body;
    assert!(
        tag.contains("Harbour walk") && !tag.contains("Festival"),
        "{tag}"
    );

    let text = o.get("/api/search?q=lantern").await.body;
    assert!(text.contains("Festival notes"), "{text}");
    assert!(
        text.contains("The lantern festival starts at dusk."),
        "snippet around the match: {text}"
    );
    assert!(
        text.contains(r#""snippet":"…"#),
        "cut at the start is marked: {text}"
    );
    assert!(
        !o.get("/api/search?q=lanternscript")
            .await
            .body
            .contains("Festival"),
        "scripts are not searched"
    );

    let chinese = o.get("/api/search?q=%E7%81%AF%E7%AC%BC").await.body;
    assert!(
        chinese.contains("Festival notes"),
        "Chinese text matches: {chinese}"
    );

    let quoted = o.get("/api/search?q=gardens").await.body;
    assert!(
        quoted.contains(&format!(
            r#""title":"Quotes \"and\" {b}u003ctags{b}u003e""#,
            b = BACKSLASH
        )),
        "{quoted}"
    );

    assert!(
        o.get("/api/search?q=zzzz")
            .await
            .body
            .ends_with(r#""results":[]}"#)
    );
    assert!(
        o.get("/api/search?q=")
            .await
            .body
            .ends_with(r#""results":[]}"#)
    );
    assert!(
        o.get("/api/search?q=%23")
            .await
            .body
            .ends_with(r#""results":[]}"#)
    );
    assert!(
        o.get("/api/search?q=100%25")
            .await
            .body
            .ends_with(r#""results":[]}"#),
        "% is literal"
    );
    let too_long = format!("/api/search?q={}", "a".repeat(101));
    assert_eq!(o.get(&too_long).await.status, 400);

    let mut stranger = Client::new(port);
    let refused = stranger.get("/api/search?q=harbour").await;
    assert_eq!(refused.status, 401);
    assert!(!refused.body.contains("Harbour"));
    assert_eq!(stranger.get("/api/library").await.status, 401);

    // Members search too.
    let mut b = member(port, "beta").await;
    assert!(
        b.get("/api/search?q=harbour")
            .await
            .body
            .contains("Harbour walk")
    );
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn search_returns_at_most_twenty(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    for i in 0..22 {
        upload(
            &mut o,
            &csrf,
            &format!("Common {i}"),
            Some(("c.html", &page_with("Common", "<p>shared word</p>"))),
        )
        .await;
    }
    let body = o.get("/api/search?q=shared").await.body;
    assert_eq!(body.matches(r#""key":"#).count(), 20, "{body}");
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn library_and_contents_for_the_globe(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let day = today(&pool).await;
    let mut o = owner(port).await;
    let csrf = o.csrf().await;
    let body = r#"<section id="days"><h2>Day by day</h2><h3>Morning</h3></section><h2 id="stays">Stays</h2>"#;
    send_multipart(
        &mut o,
        "/documents",
        &[("csrf", &csrf), ("title", "Lake plan"), ("tags", "#lake")],
        Some(("l.html", &page_with("Lake plan", body))),
    )
    .await;
    let library = o.get("/api/library").await;
    assert_eq!(library.status, 200);
    let month: String = sqlx::query_scalar(
        "SELECT to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'FMMonth YYYY')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        library.body,
        format!(
            r#"{{"documents":[{{"key":"{day}_1","label":"{day}_#1","title":"Lake plan","tags":["lake"],"month":"{month}"}}]}}"#
        )
    );

    // The document page lists its headings with anchors in 📁 contents; the others are counted.
    let page = o.get(&format!("/documents/{day}_1")).await.body;
    assert!(
        page.contains(&format!(
            r#"<a href="/documents/{day}_1/raw#days" data-frame-jump="days">Day by day</a>"#
        )),
        "{page}"
    );
    assert!(page.contains(r#"data-frame-jump="stays">Stays</a>"#));
    assert!(
        page.contains("2 more headings have no anchor"),
        "the h1 and the h3"
    );
    assert!(page.contains(&format!(r#"data-doc-key="{day}_1""#)));
    // Other signed-in pages have the buttons and the library contents; the sign-in page has none.
    let list = o.get("/documents").await.body;
    assert!(list.contains("data-fab-satellite") && list.contains("data-contents-library"));
    let satellite = list.find("data-fab-satellite").unwrap();
    let globe = list.find("data-fab-globe").unwrap();
    let folder = list.find("data-fab-folder").unwrap();
    assert!(
        satellite < globe && globe < folder,
        "michi order: satellite, globe, folder"
    );
    assert!(
        !Client::new(port)
            .get("/")
            .await
            .body
            .contains("data-fab-group")
    );
    assert_eq!(o.get("/assets/explorer.mjs").await.status, 200);
    assert_eq!(o.get("/assets/globe-layout.mjs").await.status, 200);

    // Versions from before search existed are indexed when the server starts.
    sqlx::query(
        "UPDATE document_versions SET indexed = false, text_content = '', heading_ids = '{}'",
    )
    .execute(&pool)
    .await
    .unwrap();
    start(pool.clone(), config()).await;
    assert!(
        o.get("/api/search?q=morning")
            .await
            .body
            .contains("Lake plan")
    );
}
