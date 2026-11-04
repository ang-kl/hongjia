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

const BOOTSTRAP: &str = "bootstrap-code-for-tests-0123456789";
const OWNER_PASS: &str = "river lantern cobalt sparrow";
const MEMBER_PASS: &str = "quiet harbour violet ember";

fn config() -> Config {
    Config {
        profiles: ["alpha", "beta", "gamma", "delta"]
            .map(String::from)
            .to_vec(),
        owner: "delta".into(),
        public_origin: None,
        bootstrap_code: Some(BOOTSTRAP.into()),
        dev_password: None,
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
    fn code(&self) -> String {
        let start = self.body.find(r#"<p class="code">"#).expect("code shown")
            + r#"<p class="code">"#.len();
        self.body[start..start + self.body[start..].find('<').expect("end")].to_string()
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
            request.push_str(&format!(
                "Content-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n",
                body.len()
            ));
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

    async fn enrol(&mut self, code: &str, passphrase: &str) -> Reply {
        let page = self.get("/enrol").await;
        let csrf = page.hidden("csrf");
        self.post(
            "/enrol",
            &[
                ("csrf", &csrf),
                ("code", code),
                ("passphrase", passphrase),
                ("confirm", passphrase),
            ],
        )
        .await
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

/// Owner enrols with the bootstrap code and saves consent; returns the signed-in client.
async fn owner(port: u16) -> Client {
    let mut c = Client::new(port);
    let r = c.enrol(BOOTSTRAP, OWNER_PASS).await;
    assert_eq!(r.status, 303, "{}", r.body);
    assert_eq!(r.header("location"), Some("/consent"));
    assert_eq!(c.consent("no").await.status, 303);
    c
}

async fn member(port: u16, owner: &mut Client, handle: &str, pass: &str) -> Client {
    let csrf = owner.csrf().await;
    let issued = owner
        .post("/owner/code", &[("csrf", &csrf), ("profile", handle)])
        .await;
    assert_eq!(issued.status, 200);
    let code = issued.code();
    let mut c = Client::new(port);
    let r = c.enrol(&code, pass).await;
    assert_eq!(r.status, 303, "{}", r.body);
    assert_eq!(c.consent("no").await.status, 303);
    c
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn bootstrap_then_codes_then_member_enrols(pool: PgPool) {
    let port = start(pool.clone(), config()).await;
    let mut o = owner(port).await;
    let home = o.get("/home").await;
    assert_eq!(home.status, 200);
    assert!(home.body.contains("Hello, delta"));

    // The bootstrap code stops working once the owner has a passphrase.
    let mut stranger = Client::new(port);
    assert_eq!(
        stranger
            .enrol(BOOTSTRAP, "another long passphrase here")
            .await
            .status,
        401
    );

    // Owner issues a code; it is shown once and works once.
    let csrf = o.csrf().await;
    let issued = o
        .post("/owner/code", &[("csrf", &csrf), ("profile", "beta")])
        .await;
    let code = issued.code();
    assert_eq!(code.len(), 24);
    let mut b = Client::new(port);
    let weak = b.enrol(&code, "short").await;
    assert_eq!(
        weak.status, 400,
        "a rule-breaking passphrase does not use up the code"
    );
    assert_eq!(b.enrol(&code, MEMBER_PASS).await.status, 303);
    let mut again = Client::new(port);
    assert_eq!(
        again.enrol(&code, MEMBER_PASS).await.status,
        401,
        "a used code does not work twice"
    );

    let stored: String = sqlx::query_scalar("SELECT passphrase_hash FROM credentials c JOIN profiles p ON p.id = c.profile_id WHERE p.handle = 'beta'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(stored.starts_with("argon2id$") && !stored.contains(MEMBER_PASS));
    let codes_plain: i64 = sqlx::query_scalar("SELECT count(*) FROM enrolment_codes WHERE encode(code_hash, 'escape') LIKE '%' || $1 || '%'")
        .bind(code.replace('-', ""))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(codes_plain, 0, "codes are stored only as hashes");
}

#[sqlx::test(migrations = "../../db/migrations")]
async fn signin_success_failure_and_rate_limit(pool: PgPool) {
    let port = start(pool, config()).await;
    let _o = owner(port).await;
    let mut c = Client::new(port);
    let wrong = c.signin("delta", "wrong passphrase entirely").await;
    assert_eq!(wrong.status, 401);
    assert!(wrong.body.contains("That did not work"));
    assert_eq!(c.signin("nobody", OWNER_PASS).await.status, 401);
    let ok = c.signin("delta", OWNER_PASS).await;
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
    let blocked = attacker.signin("delta", OWNER_PASS).await;
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
        o.post("/owner/code", &[("csrf", &csrf), ("profile", "beta")])
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

    let mut b = member(port, &mut o, "beta", MEMBER_PASS).await;
    assert_eq!(b.get("/owner").await.status, 403);
    let bcsrf = b.csrf().await;
    assert_eq!(
        b.post("/owner/code", &[("csrf", &bcsrf), ("profile", "alpha")])
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
                    ("passphrase", OWNER_PASS)
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
    let mut b = member(port, &mut o, "beta", MEMBER_PASS).await;
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
    let mut b1 = member(port, &mut o, "beta", MEMBER_PASS).await;
    let mut b2 = Client::new(port);
    assert_eq!(b2.signin("beta", MEMBER_PASS).await.status, 303);

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
    assert_eq!(b3.signin("beta", MEMBER_PASS).await.status, 303);
    sqlx::query("UPDATE sessions SET last_seen_at = now() - interval '15 days' WHERE ended_at IS NULL AND profile_id = (SELECT id FROM profiles WHERE handle = 'beta')")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(b3.get("/home").await.status, 303);

    // Sign out everywhere.
    let mut o2 = Client::new(port);
    assert_eq!(o2.signin("delta", OWNER_PASS).await.status, 303);
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
    assert_eq!(o2.signin("delta", OWNER_PASS).await.status, 303);
    sqlx::query("UPDATE sessions SET lat_tenths = 13, lon_tenths = 1038, location_at = now() - interval '100 days' WHERE created_at > now() - interval '1 day'")
        .execute(&pool)
        .await
        .unwrap();
    let (sessions, locations, _, _) = family::store::run_retention(&pool).await.unwrap();
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
async fn shared_dev_mode_signs_in_any_profile_locally(pool: PgPool) {
    let mut cfg = config();
    cfg.dev_password = Some("local-dev-only".into());
    let port = start(pool, cfg).await;
    let mut c = Client::new(port);
    assert_eq!(c.signin("alpha", "local-dev-only").await.status, 303);
    let mut d = Client::new(port);
    assert_eq!(d.signin("alpha", "wrong").await.status, 401);
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
