//! Request helpers: cookies, origin checks, network prefixes, user-agent summaries and escaping.

use axum::http::{HeaderMap, HeaderValue, header};
use std::net::IpAddr;

/// The value of a cookie, if exactly one cookie of that name is present.
pub fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut found = None;
    for value in headers.get_all(header::COOKIE) {
        for pair in value.to_str().ok()?.split(';') {
            if let Some((key, val)) = pair.trim().split_once('=')
                && key == name
            {
                if found.is_some() {
                    return None;
                }
                found = Some(val.to_string());
            }
        }
    }
    found
}

pub fn set_cookie(name: &str, value: &str, max_age_seconds: u64, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_seconds}{secure}"
    ))
    .expect("cookie characters are safe")
}

pub fn clear_cookie(name: &str, secure: bool) -> HeaderValue {
    set_cookie(name, "", 0, secure)
}

/// True when the request comes from the site itself: `Origin` must match exactly, and
/// `Sec-Fetch-Site`, when sent, must say same-origin.
pub fn same_origin(headers: &HeaderMap, expected_origin: &str) -> bool {
    let origin_ok = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|origin| origin == expected_origin);
    let fetch_site_ok = headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .is_none_or(|site| site == "same-origin");
    origin_ok && fetch_site_ok
}

/// The network a request came from, coarsened (IPv4 /24, IPv6 /48) so the address itself is never kept.
pub fn net_prefix(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            format!("{}.{}.{}.0/24", o[0], o[1], o[2])
        }
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => net_prefix(IpAddr::V4(v4)),
            None => {
                let s = v6.segments();
                format!("{:x}:{:x}:{:x}::/48", s[0], s[1], s[2])
            }
        },
    }
}

/// A short, human description of the browser, such as "Safari on iPhone". Descriptive only.
pub fn ua_summary(headers: &HeaderMap) -> String {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let browser = if ua.contains("Edg/") || ua.contains("EdgiOS") {
        "Edge"
    } else if ua.contains("SamsungBrowser") {
        "Samsung Internet"
    } else if ua.contains("Firefox/") || ua.contains("FxiOS") {
        "Firefox"
    } else if ua.contains("CriOS") || ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "a browser"
    };
    let system = if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") {
        "iPad"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("CrOS") {
        "ChromeOS"
    } else if ua.contains("Macintosh") {
        "Mac or iPad"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "an unknown system"
    };
    format!("{browser} on {system}")
}

/// HTML escaping for text and attribute values.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// The step locations are rounded to: 0.4 of a degree (about 40 km), held as tenths of a degree.
pub const ROUGH_STEP_TENTHS: i16 = 4;

/// Rounds a coordinate to the nearest 0.4 of a degree (about 40 km), as a whole number of tenths of a
/// degree (always a multiple of 4). The owner's choice of 7 November 2026; it was about 11 km before.
pub fn rough_tenths(value: f64, limit: f64) -> Option<i16> {
    if !value.is_finite() || value.abs() > limit {
        return None;
    }
    let step = f64::from(ROUGH_STEP_TENTHS);
    Some(((value * 10.0 / step).round() * step) as i16)
}

/// One value from a URL query string, percent-decoded (`+` is a space). Invalid escapes are kept
/// as they are; invalid UTF-8 becomes the replacement character.
pub fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == name {
            return Some(percent_decode(value));
        }
    }
    None
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let decoded = (bytes[i] == b'%' && i + 2 < bytes.len())
            .then(|| std::str::from_utf8(&bytes[i + 1..i + 3]).ok())
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], decoded) {
            (b'%', Some(b)) => {
                out.push(b);
                i += 3;
                continue;
            }
            (b'+', _) => out.push(b' '),
            (b, _) => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {

    #[test]
    fn query_values_are_decoded() {
        assert_eq!(
            query_param(Some("q=lake+town&x=1"), "q").as_deref(),
            Some("lake town")
        );
        assert_eq!(
            query_param(Some("a=1&q=%E7%81%AF%23b"), "q").as_deref(),
            Some("灯#b")
        );
        assert_eq!(
            query_param(Some("q=100%25&q2=x"), "q").as_deref(),
            Some("100%")
        );
        assert_eq!(query_param(Some("q=%zz%2"), "q").as_deref(), Some("%zz%2"));
        assert_eq!(query_param(Some("q"), "q").as_deref(), Some(""));
        assert_eq!(query_param(Some("x=1"), "q"), None);
        assert_eq!(query_param(None, "q"), None);
    }

    use super::*;

    #[test]
    fn cookies_are_read_once_only() {
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; hj_sid=abc; b=2"),
        );
        assert_eq!(cookie(&h, "hj_sid").as_deref(), Some("abc"));
        h.append(header::COOKIE, HeaderValue::from_static("hj_sid=def"));
        assert_eq!(cookie(&h, "hj_sid"), None, "two values are refused");
    }

    #[test]
    fn origin_checks() {
        let mut h = HeaderMap::new();
        assert!(!same_origin(&h, "https://hongjia.org"));
        h.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://hongjia.org"),
        );
        assert!(same_origin(&h, "https://hongjia.org"));
        h.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(!same_origin(&h, "https://hongjia.org"));
        h.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        assert!(!same_origin(&h, "https://hongjia.org"));
    }

    #[test]
    fn networks_are_coarsened() {
        assert_eq!(
            net_prefix("203.0.113.77".parse().unwrap()),
            "203.0.113.0/24"
        );
        assert_eq!(
            net_prefix("2001:db8:abcd:12::1".parse().unwrap()),
            "2001:db8:abcd::/48"
        );
        assert_eq!(
            net_prefix("::ffff:198.51.100.9".parse().unwrap()),
            "198.51.100.0/24"
        );
    }

    #[test]
    fn user_agent_summaries() {
        let mut h = HeaderMap::new();
        let mut check = |ua: &'static str, expected: &str| {
            h.insert(header::USER_AGENT, HeaderValue::from_static(ua));
            assert_eq!(ua_summary(&h), expected);
        };
        check(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
            "Safari on iPhone",
        );
        check(
            "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
            "Chrome on Android",
        );
        check(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0",
            "Edge on Windows",
        );
        check(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
            "Safari on Mac or iPad",
        );
        check("curl/8.0", "a browser on an unknown system");
    }

    #[test]
    fn escaping_and_rounding() {
        assert_eq!(
            escape(r#"<b a="x">&'"#),
            "&lt;b a=&quot;x&quot;&gt;&amp;&#39;"
        );
        assert_eq!(rough_tenths(1.3521, 90.0), Some(12));
        assert_eq!(rough_tenths(103.8198, 180.0), Some(1040));
        assert_eq!(rough_tenths(-31.97, 90.0), Some(-320));
        assert_eq!(rough_tenths(-33.86, 90.0), Some(-340));
        assert_eq!(rough_tenths(90.0, 90.0), Some(900));
        assert_eq!(rough_tenths(-180.0, 180.0), Some(-1800));
        assert_eq!(rough_tenths(91.0, 90.0), None);
        assert_eq!(rough_tenths(f64::NAN, 90.0), None);
        for v in [-179.99, -45.3, -0.21, 0.0, 0.19, 12.6, 89.9] {
            let t = rough_tenths(v, 180.0).unwrap();
            assert_eq!(
                t % ROUGH_STEP_TENTHS,
                0,
                "{v} rounds to a multiple of 0.4 degree"
            );
            assert!(
                (f64::from(t) / 10.0 - v).abs() <= 0.2 + 1e-9,
                "{v} moves at most 0.2 degree"
            );
        }
    }
}
