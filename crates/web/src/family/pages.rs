//! Server-rendered pages. Every value from the database or the request is escaped.

use super::documents::{DocumentRow, IFRAME_SANDBOX};
use super::store::{AuditRow, FailureCount, FailureDetail, JournalRow, Profile, ProfileStatus};
use super::web::escape;

pub struct Nav<'a> {
    pub handle: &'a str,
    pub is_owner: bool,
    pub csrf: &'a str,
}

fn layout(title: &str, nav: Option<&Nav>, body_attrs: &str, main: &str) -> String {
    let header = match nav {
        Some(nav) => format!(
            r#"<header class="bar"><a class="brand" href="/home"><span lang="zh">洪家</span> · hongjia</a><nav><a href="/documents">Documents</a><a href="/journal">Journal</a>{owner}<form method="post" action="/signout"><input type="hidden" name="csrf" value="{csrf}"><button type="submit" class="link">Sign out {handle}</button></form></nav></header>"#,
            owner = if nav.is_owner { r#"<a href="/owner">Owner</a>"# } else { "" },
            csrf = escape(nav.csrf),
            handle = escape(nav.handle),
        ),
        None => r#"<header class="bar"><a class="brand" href="/"><span lang="zh">洪家</span> · hongjia</a></header>"#.to_string(),
    };
    let session_script = if nav.is_some() {
        r#"<script type="module" src="/assets/session.mjs"></script>"#
    } else {
        ""
    };
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>{title} · hongjia</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/assets/site.css">
<script type="module" src="/assets/site.mjs"></script>
{session_script}
</head>
<body class="app"{body_attrs}>
{header}
<main class="page">
{main}
</main>
</body>
</html>
"#,
        title = escape(title)
    )
}

fn notice(message: Option<&str>) -> String {
    message
        .map(|m| format!(r#"<p class="notice" role="alert">{}</p>"#, escape(m)))
        .unwrap_or_default()
}

pub fn signin(profiles: &[Profile], csrf: &str, message: Option<&str>) -> String {
    let choices: String = profiles
        .iter()
        .map(|p| {
            format!(
                r#"<label class="choice"><input type="radio" name="profile" value="{h}" required><span>{h}</span></label>"#,
                h = escape(&p.handle)
            )
        })
        .collect();
    layout(
        "Sign in",
        None,
        "",
        &format!(
            r#"<h1>Sign in</h1>
{notice}
<form method="post" action="/signin" class="stack">
<input type="hidden" name="csrf" value="{csrf}">
<fieldset class="choices"><legend>Who is signing in?</legend>{choices}</fieldset>
<label>Family password <input type="password" name="passphrase" autocomplete="current-password" required maxlength="256"></label>
<button type="submit">Sign in</button>
</form>
<p class="small"><a href="/privacy">What we collect</a>.</p>"#,
            notice = notice(message),
            csrf = escape(csrf)
        ),
    )
}

pub fn consent(nav: &Nav, device_label: &str, location_allowed: Option<bool>) -> String {
    let yes = if location_allowed == Some(true) {
        " checked"
    } else {
        ""
    };
    let no = if location_allowed != Some(true) {
        " checked"
    } else {
        ""
    };
    layout(
        "This device",
        Some(nav),
        "",
        &format!(
            r#"<h1>This device</h1>
<p>Before you continue on this device, here is what the site records and who can see it. The full list is on <a href="/privacy">What we collect</a>.</p>
<ul>
<li>Each sign-in: the profile chosen, the time, a short description of this browser, and a device code. All four profiles can see this in the journal.</li>
<li>While the page is open and you are using it, an estimate of active time. An open tab does not prove anyone was reading.</li>
<li>Your approximate location, <strong>only if you allow it below</strong>, rounded to about 11 km. It is off unless you choose it.</li>
</ul>
<form method="post" action="/consent" class="stack">
<input type="hidden" name="csrf" value="{csrf}">
<fieldset class="choices"><legend>Share approximate location from this device?</legend>
<label class="choice"><input type="radio" name="location" value="no"{no}><span>No, do not share</span></label>
<label class="choice"><input type="radio" name="location" value="yes"{yes}><span>Yes, share about 11 km</span></label>
</fieldset>
<label>Name this device (optional) <input type="text" name="device_label" maxlength="40" value="{label}" placeholder="for example: my phone"></label>
<button type="submit">Save and continue</button>
</form>
<p class="small">You can change this at any time from this page. Choosing No also removes locations already stored from this device.</p>"#,
            csrf = escape(nav.csrf),
            label = escape(device_label)
        ),
    )
}

pub fn home(nav: &Nav, device: &str, location_pending: bool) -> String {
    let attrs = format!(
        r#" data-csrf="{}" data-location="{}""#,
        escape(nav.csrf),
        if location_pending { "yes" } else { "no" }
    );
    layout(
        "Home",
        Some(nav),
        &attrs,
        &format!(
            r#"<h1>Hello, {handle}</h1>
<p>You are signed in on {device}.</p>
<p>Open the <a href="/documents">documents</a> or <a href="/documents/new">add one</a>. Comments and review come next. You can also see the <a href="/journal">login journal</a>, change <a href="/consent">this device's settings</a>, or read <a href="/privacy">what we collect</a>.</p>
<form method="post" action="/signout-everywhere"><input type="hidden" name="csrf" value="{csrf}"><button type="submit" class="secondary">Sign out on all devices</button></form>"#,
            handle = escape(nav.handle),
            device = escape(device),
            csrf = escape(nav.csrf)
        ),
    )
}

pub fn active_time(seconds: i32) -> String {
    match seconds {
        s if s < 60 => "under a minute".into(),
        s if s < 3600 => format!("about {} min", (s + 30) / 60),
        s => format!("about {} h {} min", s / 3600, (s % 3600) / 60),
    }
}

pub fn location_text(lat: Option<i16>, lon: Option<i16>) -> String {
    match (lat, lon) {
        (Some(lat), Some(lon)) => {
            let ns = if lat < 0 { "S" } else { "N" };
            let ew = if lon < 0 { "W" } else { "E" };
            format!(
                "about {}.{}°{ns}, {}.{}°{ew}",
                lat.unsigned_abs() / 10,
                lat.unsigned_abs() % 10,
                lon.unsigned_abs() / 10,
                lon.unsigned_abs() % 10
            )
        }
        _ => "not shared".into(),
    }
}

pub fn journal(
    nav: &Nav,
    rows: &[JournalRow],
    counts: &[FailureCount],
    details: Option<&[FailureDetail]>,
    journal_days: i32,
    location_days: i32,
) -> String {
    let body_rows: String = rows
        .iter()
        .map(|r| {
            let device = match (&r.device_label, &r.device_code) {
                (Some(label), Some(code)) => format!(
                    "{} ({}), {}",
                    escape(label),
                    escape(code),
                    escape(&r.ua_summary)
                ),
                (None, Some(code)) => format!("{} ({})", escape(&r.ua_summary), escape(code)),
                _ => escape(&r.ua_summary),
            };
            let ended = if r.open {
                "open".to_string()
            } else {
                format!(
                    "{} ({})",
                    escape(r.ended.as_deref().unwrap_or("timed out")),
                    escape(r.end_reason.as_deref().unwrap_or("expired"))
                )
            };
            format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                escape(&r.handle),
                escape(&r.started),
                device,
                escape(&location_text(r.lat_tenths, r.lon_tenths)),
                escape(&active_time(r.active_seconds)),
                ended
            )
        })
        .collect();
    let counts_text = counts
        .iter()
        .map(|c| format!("{} {}", escape(&c.handle), c.failures))
        .collect::<Vec<_>>()
        .join(" · ");
    let details_html = details
        .map(|list| {
            let items: String = list
                .iter()
                .map(|d| {
                    format!(
                        "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                        escape(&d.at),
                        escape(d.handle.as_deref().unwrap_or("none chosen")),
                        escape(&d.kind),
                        escape(&d.result),
                        escape(&d.ua_summary)
                    )
                })
                .collect();
            format!(
                r#"<h2>Unsuccessful attempts (owner only)</h2><div class="scroll"><table><thead><tr><th>When</th><th>Profile chosen</th><th>Step</th><th>Result</th><th>Browser</th></tr></thead><tbody>{items}</tbody></table></div>"#
            )
        })
        .unwrap_or_default();
    layout(
        "Journal",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r#"<h1>Login journal</h1>
<p class="caption">Profile selected, not proof of who signed in.</p>
<p class="caption">Active time is an estimate from a visible tab with recent interaction. An open tab does not prove someone was reading.</p>
<div class="scroll"><table><thead><tr><th>Profile</th><th>Signed in (SGT)</th><th>Device</th><th>Approximate location</th><th>Active time</th><th>Ended</th></tr></thead><tbody>{body_rows}</tbody></table></div>
<p class="small">Unsuccessful attempts in the last 7 days: {counts_text}.</p>
{details_html}
<p class="small">Kept for {journal_days} days; locations for {location_days} days.</p>"#
        ),
    )
}

pub fn owner(
    nav: &Nav,
    statuses: &[ProfileStatus],
    journal_days: i32,
    location_days: i32,
    audit: &[AuditRow],
) -> String {
    let rows: String = statuses
        .iter()
        .map(|s| {
            format!(
                r#"<tr><td>{h}{owner}</td><td>{last}</td><td><form method="post" action="/owner/end-sessions"><input type="hidden" name="csrf" value="{csrf}"><input type="hidden" name="profile" value="{h}"><button type="submit" class="secondary">End sessions</button></form></td></tr>"#,
                h = escape(&s.handle),
                owner = if s.is_owner { " (owner)" } else { "" },
                last = escape(s.last_signin.as_deref().unwrap_or("never")),
                csrf = escape(nav.csrf),
            )
        })
        .collect();
    let audit_rows: String = audit
        .iter()
        .map(|a| {
            format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                escape(&a.at),
                escape(a.handle.as_deref().unwrap_or("system")),
                escape(&a.action),
                escape(&a.detail)
            )
        })
        .collect();
    layout(
        "Owner",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r#"<h1>Owner</h1>
<h2>Profiles</h2>
<div class="scroll"><table><thead><tr><th>Profile</th><th>Last sign-in</th><th>Sessions</th></tr></thead><tbody>{rows}</tbody></table></div>
<h2>Retention</h2>
<form method="post" action="/owner/settings" class="stack narrow">
<input type="hidden" name="csrf" value="{csrf}">
<label>Keep the journal for (days, 30 to 730) <input type="number" name="journal_days" min="30" max="730" value="{journal_days}" required></label>
<label>Keep locations for (days, at most the journal) <input type="number" name="location_days" min="1" max="730" value="{location_days}" required></label>
<button type="submit">Save retention</button>
</form>
<h2>Recent owner and system actions</h2>
<div class="scroll"><table><thead><tr><th>When</th><th>By</th><th>Action</th><th>Detail</th></tr></thead><tbody>{audit_rows}</tbody></table></div>"#,
            csrf = escape(nav.csrf)
        ),
    )
}

pub fn privacy(owner: &str, journal_days: i32, location_days: i32) -> String {
    layout(
        "What we collect",
        None,
        "",
        &format!(
            r#"<h1>What we collect</h1>
<p>This is a private site for four family profiles. Nothing here is shared outside the family, sold, or sent by email, SMS or push messages.</p>
<div class="scroll"><table><thead><tr><th>Data</th><th>When</th><th>Who can see it</th><th>Kept for</th></tr></thead><tbody>
<tr><td>Profile chosen, time, result of each sign-in</td><td>Every sign-in</td><td>All four profiles (details of unsuccessful attempts: the owner)</td><td>{journal_days} days (attempts at most 90)</td></tr>
<tr><td>Short browser description and a device code</td><td>Every sign-in</td><td>All four profiles</td><td>{journal_days} days</td></tr>
<tr><td>Approximate location, rounded to about 11 km</td><td>Only if you allowed it on that device</td><td>All four profiles</td><td>{location_days} days</td></tr>
<tr><td>Estimated active time</td><td>While a page is visible and in use</td><td>All four profiles</td><td>{journal_days} days</td></tr>
<tr><td>Network address</td><td>Every request</td><td>Nobody; it is coarsened and hashed before storage, only to slow down password guessing</td><td>at most 90 days</td></tr>
</tbody></table></div>
<p>Choosing a profile name does not prove who signed in, and an open tab does not prove anyone was reading. Precise GPS is never requested.</p>
<p>Questions or corrections: ask {owner}.</p>
<p class="small"><a href="/">Back</a></p>"#,
            owner = escape(owner)
        ),
    )
}

pub fn documents(nav: &Nav, rows: &[DocumentRow]) -> String {
    let items: String = if rows.is_empty() {
        r#"<p>No documents yet.</p>"#.to_string()
    } else {
        let list: String = rows
            .iter()
            .map(|d| {
                format!(
                    r#"<li><a href="/documents/{id}">{title}</a><span class="small"> · version {v} · {kind} · added by {by}, {when} (SGT)</span></li>"#,
                    id = d.id,
                    title = escape(&d.title),
                    v = d.version_no,
                    kind = if d.kind == "html" { "web page" } else { "text" },
                    by = escape(d.uploaded_by.as_deref().unwrap_or("someone")),
                    when = escape(&d.uploaded_at)
                )
            })
            .collect();
        format!(r#"<ul class="documents">{list}</ul>"#)
    };
    layout(
        "Documents",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(r#"<h1>Documents</h1>{items}<p><a href="/documents/new">Add a document</a></p>"#),
    )
}

pub fn document_upload(nav: &Nav, message: Option<&str>) -> String {
    layout(
        "Add a document",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r#"<h1>Add a document</h1>
{notice}
<form method="post" action="/documents" enctype="multipart/form-data" class="stack">
<input type="hidden" name="csrf" value="{csrf}">
<label>Title (optional) <input type="text" name="title" maxlength="120" placeholder="Uses the file name if left empty"></label>
<label>File <input type="file" name="file" accept=".html,.htm,.txt,.md,text/html,text/plain,text/markdown" required></label>
<p class="small">HTML pages and text files, up to 10 MB. Pages run in a locked-down frame: their own scripts, online pictures, links and printing work, but they cannot reach your account, the family's data or other pages.</p>
<button type="submit">Upload</button>
</form>"#,
            notice = notice(message),
            csrf = escape(nav.csrf)
        ),
    )
}

pub fn document_view(nav: &Nav, doc: &DocumentRow) -> String {
    layout(
        &doc.title,
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r#"<div class="doc-head"><h1>{title}</h1><p class="small">Version {v} · {file} · {kb} KB · added by {by}, {when} (SGT) · <a href="/documents/{id}/raw" target="_blank" rel="noopener noreferrer">open on its own</a> · <a href="/documents">all documents</a></p></div>
<iframe class="doc-frame" src="/documents/{id}/raw" sandbox="{sandbox}" allow="" referrerpolicy="no-referrer" loading="eager" title="Document: {title}"></iframe>"#,
            id = doc.id,
            title = escape(&doc.title),
            v = doc.version_no,
            file = escape(&doc.filename),
            kb = (doc.size_bytes + 1023) / 1024,
            by = escape(doc.uploaded_by.as_deref().unwrap_or("someone")),
            when = escape(&doc.uploaded_at),
            sandbox = IFRAME_SANDBOX
        ),
    )
}

pub fn message(title: &str, text: &str, link: (&str, &str)) -> String {
    layout(
        title,
        None,
        "",
        &format!(
            r#"<h1>{}</h1><p>{}</p><p><a href="{}">{}</a></p>"#,
            escape(title),
            escape(text),
            escape(link.0),
            escape(link.1)
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_time_wording() {
        assert_eq!(active_time(0), "under a minute");
        assert_eq!(active_time(89), "about 1 min");
        assert_eq!(active_time(3725), "about 1 h 2 min");
    }

    #[test]
    fn location_wording() {
        assert_eq!(location_text(Some(13), Some(1038)), "about 1.3°N, 103.8°E");
        assert_eq!(
            location_text(Some(-339), Some(-1512)),
            "about 33.9°S, 151.2°W"
        );
        assert_eq!(location_text(None, None), "not shared");
    }

    #[test]
    fn pages_escape_values_and_use_hyphens_only() {
        let nav = Nav {
            handle: "<x>",
            is_owner: true,
            csrf: "\"q\"",
        };
        let page = home(&nav, "Safari on iPhone", false);
        assert!(page.contains("&lt;x&gt;") && !page.contains("<x>"));
        assert!(page.contains("&quot;q&quot;"));
        for text in [page, privacy("alpha", 180, 90), signin(&[], "t", Some("m"))] {
            assert!(!text.contains('\u{2013}') && !text.contains('\u{2014}'));
        }
    }
}
