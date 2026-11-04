//! Raw-HTTP tests against a running server: the same cases as P0's Node.js tests, so the Rust
//! server is shown to behave like the live placeholder. Paths are sent exactly as written.

use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

struct Reply {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

async fn start() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        axum::serve(listener, hongjia_web::app("abc1234"))
            .await
            .expect("serve");
    });
    port
}

async fn raw(port: u16, method: &str, path: &str) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connect");
    let request =
        format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.expect("write");
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).await.expect("read");
    let text = String::from_utf8(bytes).expect("utf-8 response");
    let (head, body) = text.split_once("\r\n\r\n").expect("header end");
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .expect("status line")
        .split(' ')
        .nth(1)
        .expect("status")
        .parse()
        .expect("number");
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    Reply {
        status,
        headers,
        body: body.to_string(),
    }
}

fn visible_text(html: &str) -> Vec<String> {
    let body = &html[html.find("</head>").expect("head end") + "</head>".len()..];
    let without_spans = body
        .replace("<span lang=\"zh\">", "")
        .replace("</span>", "");
    let mut text = String::new();
    let mut in_tag = false;
    for c in without_spans.chars() {
        match c {
            '<' => {
                in_tag = true;
                text.push('\n');
            }
            '>' => in_tag = false,
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

#[tokio::test]
async fn home_page_shows_only_the_approved_copy() {
    let port = start().await;
    let reply = raw(port, "GET", "/").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.headers["content-type"], "text/html; charset=utf-8");
    assert!(reply.body.contains("<title>洪家 · hongjia</title>"));
    assert_eq!(
        visible_text(&reply.body),
        vec!["洪家 · hongjia", "A private family space. Coming soon."]
    );
}

#[tokio::test]
async fn home_page_has_no_form_and_no_outside_address() {
    let port = start().await;
    let body = raw(port, "GET", "/").await.body.to_ascii_lowercase();
    assert!(!body.contains("<form"));
    assert!(!body.contains("http://") && !body.contains("https://"));
}

#[tokio::test]
async fn served_text_uses_hyphens_only() {
    let port = start().await;
    for path in [
        "/",
        "/assets/site.css",
        "/assets/site.mjs",
        "/assets/device-profile.mjs",
        "/robots.txt",
    ] {
        let body = raw(port, "GET", path).await.body;
        assert!(
            !body.contains('\u{2013}') && !body.contains('\u{2014}'),
            "en or em dash in {path}"
        );
    }
}

#[tokio::test]
async fn health_route_reports_status_and_commit() {
    let port = start().await;
    let reply = raw(port, "GET", "/healthz").await;
    assert_eq!(reply.status, 200);
    assert_eq!(
        reply.headers["content-type"],
        "application/json; charset=utf-8"
    );
    assert_eq!(reply.body, r#"{"status":"ok","commit":"abc1234"}"#);
    assert_eq!(reply.headers["cache-control"], "no-store");
}

#[tokio::test]
async fn robots_txt_disallows_everything() {
    let port = start().await;
    let reply = raw(port, "GET", "/robots.txt").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, "User-agent: *\nDisallow: /\n");
}

#[tokio::test]
async fn static_assets_are_served_with_the_right_types() {
    let port = start().await;
    let css = raw(port, "GET", "/assets/site.css").await;
    assert_eq!(css.status, 200);
    assert!(css.headers["content-type"].starts_with("text/css"));
    let site = raw(port, "GET", "/assets/site.mjs").await;
    assert_eq!(site.status, 200);
    assert!(site.headers["content-type"].starts_with("text/javascript"));
    assert!(site.body.contains("from './device-profile.mjs'"));
    let profile = raw(port, "GET", "/assets/device-profile.mjs").await;
    assert_eq!(profile.status, 200);
    assert!(
        profile
            .body
            .contains("export function classifyDeviceProfile")
    );
    assert!(profile.body.contains("v2-template-rin3-1"));
}

#[tokio::test]
async fn query_strings_do_not_change_routing() {
    let port = start().await;
    assert_eq!(raw(port, "GET", "/?utm=x").await.status, 200);
    assert_eq!(raw(port, "GET", "/healthz?x=1").await.status, 200);
}

#[tokio::test]
async fn unknown_paths_are_404() {
    let port = start().await;
    for path in [
        "/nope",
        "/index.html",
        "/assets/",
        "/assets/other.js",
        "/web/index.html",
        "/Cargo.toml",
        "/healthz/",
        "/robots.txt/x",
    ] {
        assert_eq!(raw(port, "GET", path).await.status, 404, "{path}");
    }
}

#[tokio::test]
async fn dotted_and_encoded_path_tricks_are_404() {
    let port = start().await;
    for path in [
        "/assets/../Cargo.toml",
        "/assets/%2e%2e/Cargo.toml",
        "/assets/..%2fCargo.toml",
        "/%2e%2e/%2e%2e/etc/passwd",
        "/assets/site.css%00",
        "//assets/site.css",
        "/ASSETS/site.css",
    ] {
        assert_eq!(raw(port, "GET", path).await.status, 404, "{path}");
    }
}

#[tokio::test]
async fn methods_other_than_get_and_head_are_405() {
    let port = start().await;
    for method in ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"] {
        for path in ["/", "/nope"] {
            let reply = raw(port, method, path).await;
            assert_eq!(reply.status, 405, "{method} {path}");
            assert_eq!(reply.headers["allow"], "GET, HEAD");
        }
    }
}

#[tokio::test]
async fn head_returns_headers_without_a_body() {
    let port = start().await;
    let reply = raw(port, "HEAD", "/").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, "");
    assert!(
        reply
            .headers
            .get("content-length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
            > 0
    );
}

#[tokio::test]
async fn every_response_carries_every_security_header() {
    let port = start().await;
    let cases = [
        ("GET", "/", 200),
        ("HEAD", "/", 200),
        ("GET", "/healthz", 200),
        ("GET", "/robots.txt", 200),
        ("GET", "/assets/site.css", 200),
        ("GET", "/assets/site.mjs", 200),
        ("GET", "/assets/device-profile.mjs", 200),
        ("GET", "/missing", 404),
        ("POST", "/", 405),
    ];
    for (method, path, status) in cases {
        let reply = raw(port, method, path).await;
        assert_eq!(reply.status, status, "{method} {path}");
        for (name, value) in hongjia_web::security_headers() {
            assert_eq!(
                reply.headers.get(name).map(String::as_str),
                Some(value),
                "{name} on {method} {path}"
            );
        }
        assert!(!reply.headers.contains_key("x-powered-by"));
    }
}
