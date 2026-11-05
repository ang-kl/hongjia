//! Server-rendered pages. Every value from the database or the request is escaped.

use super::doccheck::filing_label;
use super::documents::{DELETE_WORD, DocumentRow, IFRAME_SANDBOX, VersionRow};
use super::review::{AnnotationRow, Review};
use super::store::{AuditRow, FailureCount, FailureDetail, JournalRow, Profile, ProfileStatus};
use super::web::escape;

pub struct Nav<'a> {
    pub handle: &'a str,
    pub is_owner: bool,
    pub csrf: &'a str,
}

fn layout(title: &str, nav: Option<&Nav>, body_attrs: &str, main: &str) -> String {
    page_shell(title, nav, "app", body_attrs, r#"class="page""#, main, None)
}

/// The 📁 contents of every page except a document: all documents, filled in by explorer.mjs.
const LIBRARY_CONTENTS: &str = r#"<p class="fab-contents-head">All documents</p><div data-contents-library><p class="small">Loading the documents…</p></div>"#;

/// The 🛰️ satellite, globe and 📁 folder buttons at the bottom right of every signed-in page, in
/// the michi order, with the search field, the contents list and the globe they open.
fn explorer(contents: &str) -> String {
    format!(
        r##"<div class="fab-group" data-fab-group>
<form class="fab-search glass" id="fab-search" role="search" data-fab-search hidden><label><span class="visually-hidden">Search all documents</span><input type="search" data-fab-input placeholder="Search titles, hashtags and text" autocomplete="off" spellcheck="false" maxlength="100"></label><button type="submit" aria-label="Search">→</button></form>
<div class="fab-contents glass" id="fab-contents" role="region" aria-label="Contents" data-fab-contents hidden>{contents}</div>
<button type="button" class="fab-satellite" data-fab-satellite aria-expanded="false" aria-controls="fab-search" title="Search all documents" disabled><span aria-hidden="true">🛰️</span><span class="visually-hidden">Search all documents</span></button>
<button type="button" class="fab-globe" data-fab-globe aria-haspopup="dialog" aria-controls="globe" aria-expanded="false" title="Explore the documents" disabled><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><radialGradient id="fab-g" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".6" stop-color="#eef3fa" stop-opacity=".9"/><stop offset="1" stop-color="#c9d7ea" stop-opacity=".9"/></radialGradient></defs><circle cx="24" cy="24" r="19" fill="url(#fab-g)" stroke="#7f9bc4" stroke-opacity=".9" stroke-width="1.4"/><path d="M12 18c3-4 8-4 10-1s6 1 9-2c3 3 3 8 1 11s-7 2-9 0-6 1-9 3c-3-3-4-7-2-11z" fill="#d7e3f3" stroke="#9fb6d6" stroke-width=".8"/><circle cx="16" cy="19" r="2.2" fill="#f0b8a2"/><circle cx="31" cy="15" r="2.2" fill="#a8c8f0"/><circle cx="33" cy="30" r="2.2" fill="#f3d58b"/><circle cx="20" cy="33" r="2.2" fill="#b9e0c6"/></svg><span class="visually-hidden">Explore the documents</span></button>
<button type="button" class="fab-folder" data-fab-folder aria-expanded="false" aria-controls="fab-contents" title="Contents" disabled><span aria-hidden="true">📁</span><span class="visually-hidden">Contents</span></button>
</div>
<div class="globe-dialog" id="globe" role="dialog" aria-modal="true" aria-label="Globe of the family documents" data-globe hidden>
<div class="globe-backdrop" data-globe-close></div>
<p class="visually-hidden" role="status" aria-live="polite" data-globe-status></p>
<button type="button" class="globe-x glass" data-globe-close aria-label="Close the globe">×</button>
<div class="globe-box" data-globe-box><div class="globe-stage" data-globe-stage></div></div>
<p class="visually-hidden" id="globe-help">Each island is a hashtag shared by several documents. Select a pin to see the document. Drag or use the arrow keys to turn the globe; scroll, pinch or press plus and minus to zoom. Press Escape to close the search, then the card, then the globe.</p>
<div class="globe-card glass" role="region" aria-label="Selected document" data-globe-card hidden><button type="button" class="globe-card-x" data-globe-card-close aria-label="Close this card">×</button><div class="globe-panel" data-globe-panel></div></div>
</div>"##
    )
}

fn page_shell(
    title: &str,
    nav: Option<&Nav>,
    body_class: &str,
    body_attrs: &str,
    main_attrs: &str,
    main: &str,
    contents: Option<&str>,
) -> String {
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
        r#"<script type="module" src="/assets/session.mjs"></script>
<script type="module" src="/assets/explorer.mjs"></script>"#
    } else {
        ""
    };
    let explore = if nav.is_some() {
        explorer(contents.unwrap_or(LIBRARY_CONTENTS))
    } else {
        String::new()
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
<body class="{body_class}"{body_attrs}>
{header}
<main {main_attrs}>
{main}
</main>
{explore}
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

fn hashtags(tags: &[String]) -> String {
    tags.iter()
        .map(|t| format!("#{}", escape(t)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn kind_name(kind: &str) -> &'static str {
    if kind == "html" { "web page" } else { "text" }
}

fn kilobytes(bytes: i32) -> i32 {
    (bytes + 1023) / 1024
}

/// The documents list in the owner's Style D: grouped by the month filed, serif section headers
/// with count badges, hairline rows.
pub fn documents(nav: &Nav, rows: &[DocumentRow]) -> String {
    let mut groups: Vec<(&str, Vec<&DocumentRow>)> = Vec::new();
    for row in rows {
        match groups.last_mut() {
            Some((month, list)) if *month == row.month => list.push(row),
            _ => groups.push((&row.month, vec![row])),
        }
    }
    let body: String = if rows.is_empty() {
        r#"<p>No documents yet.</p>"#.to_string()
    } else {
        groups
            .iter()
            .map(|(month, list)| {
                let items: String = list
                    .iter()
                    .map(|d| {
                        let tags = if d.tags.is_empty() {
                            String::new()
                        } else {
                            format!(r#"<span class="row-tags">{}</span>"#, hashtags(&d.tags))
                        };
                        format!(
                            r#"<li class="row"><span class="filing">{label}</span><a class="row-title" href="/documents/{key}">{title}</a><span class="row-meta">{kind} · v{v} · {by}</span>{tags}</li>"#,
                            label = escape(&filing_label(&d.key)),
                            key = escape(&d.key),
                            title = escape(&d.title),
                            kind = kind_name(&d.kind),
                            v = d.version_no,
                            by = escape(d.added_by.as_deref().unwrap_or("someone")),
                        )
                    })
                    .collect();
                format!(
                    r#"<section class="group"><div class="section-head"><h2>{month}</h2><span class="count" aria-label="{n} documents">{n}</span></div><ul class="rows">{items}</ul></section>"#,
                    month = escape(month),
                    n = list.len()
                )
            })
            .collect()
    };
    layout(
        "Documents",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r#"<div class="list-head"><h1>Documents</h1><a class="pill solid" href="/documents/new">Add a document</a></div>{body}"#
        ),
    )
}

pub fn document_upload(nav: &Nav, message: Option<&str>) -> String {
    layout(
        "Add a document",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r##"<h1>Add a document</h1>
{notice}
<form method="post" action="/documents" enctype="multipart/form-data" class="stack">
<input type="hidden" name="csrf" value="{csrf}">
<label>Title (optional) <input type="text" name="title" maxlength="120" placeholder="Uses the file name if left empty"></label>
<label>Hashtags (optional) <input type="text" name="tags" maxlength="400" placeholder="#trip #2027"></label>
<label>File <input type="file" name="file" accept=".html,.htm,.txt,.md,text/html,text/plain,text/markdown" required></label>
<p class="small">HTML pages and text files, up to 10 MB. Leave the hashtags empty and the site suggests some from the file. The document is filed under today's date and number, for example 2026-1105_#1.</p>
<p class="small">Pages run in a locked-down frame: their own scripts, libraries from cdnjs, jsDelivr, unpkg and Tailwind, Google Fonts, online pictures, links and printing work, but they cannot reach your account, the family's data or other pages.</p>
<button type="submit">Upload</button>
</form>"##,
            notice = notice(message),
            csrf = escape(nav.csrf)
        ),
    )
}

fn section(title: &str, count: Option<usize>, body: &str) -> String {
    let badge = count
        .map(|n| format!(r#"<span class="count">{n}</span>"#))
        .unwrap_or_default();
    format!(
        r#"<section class="panel-section"><div class="section-head"><h2>{}</h2>{badge}</div>{body}</section>"#,
        escape(title)
    )
}

fn check_section(latest: Option<&VersionRow>) -> String {
    let Some(v) = latest else {
        return String::new();
    };
    if v.kind != "html" {
        return section(
            "Upload check",
            None,
            r#"<p class="small">A text file: nothing to check.</p>"#,
        );
    }
    let uses = if v.libraries.is_empty() {
        "no libraries from the design stack".to_string()
    } else {
        escape(&v.libraries.join(", "))
    };
    let style = v
        .style_guess
        .as_deref()
        .map(escape)
        .unwrap_or_else(|| "no clear match".into());
    let warnings = if v.warnings.is_empty() {
        r#"<p class="ok">Nothing found that will fail in the frame.</p>"#.to_string()
    } else {
        format!(
            r#"<ul class="warnings">{}</ul>"#,
            v.warnings
                .iter()
                .map(|w| format!("<li>{}</li>", escape(w)))
                .collect::<String>()
        )
    };
    let fields = match v.field_count {
        0 => String::new(),
        n => format!(
            r#"<dt>Fillable fields</dt><dd>{n}. What people fill in is saved; see Saved fields.</dd>"#
        ),
    };
    section(
        "Upload check",
        Some(v.warnings.len()),
        &format!(
            r#"<dl class="facts"><dt>Uses</dt><dd>{uses}</dd><dt>Closest style</dt><dd>{style} <span class="small">(rough guess)</span></dd>{fields}</dl>{warnings}"#
        ),
    )
}

/// 📁 contents of a document page: its headings with anchors, as links that move the frame.
fn document_contents(key: &str, latest: Option<&VersionRow>) -> String {
    let Some(v) = latest else {
        return LIBRARY_CONTENTS.to_string();
    };
    let key = escape(key);
    let mut items = String::new();
    let mut unanchored = 0;
    for ((level, id), text) in v
        .heading_levels
        .iter()
        .zip(&v.heading_ids)
        .zip(&v.heading_texts)
    {
        if id.is_empty() {
            unanchored += 1;
            continue;
        }
        items.push_str(&format!(
            r#"<li class="level-{level}"><a href="/documents/{key}/raw#{anchor}" data-frame-jump="{anchor}">{text}</a></li>"#,
            level = level.clamp(&1, &3),
            anchor = escape(id),
            text = escape(text),
        ));
    }
    let list = if items.is_empty() {
        r#"<p class="small">This document has no headings to jump to.</p>"#.to_string()
    } else {
        format!(r#"<ol class="fab-contents-list">{items}</ol>"#)
    };
    let note = match unanchored {
        0 => String::new(),
        1 => r#"<p class="small">1 more heading has no anchor, so it cannot be jumped to yet.</p>"#
            .to_string(),
        n => format!(
            r#"<p class="small">{n} more headings have no anchor, so they cannot be jumped to yet.</p>"#
        ),
    };
    format!(
        r#"<p class="fab-contents-head">In this document</p>{list}{note}<p class="small"><a href="/documents">All documents</a></p>"#
    )
}

/// What a saved value looks like in the panel: ticks in words, long text shortened.
fn shown_value(value: &str) -> String {
    match value {
        "true" => "ticked".into(),
        "false" => "not ticked".into(),
        "" => "cleared".into(),
        v if v.chars().count() > 80 => format!("{}…", v.chars().take(80).collect::<String>()),
        v => v.replace('\n', ", "),
    }
}

fn annotation_item(key: &str, csrf: &str, row: &AnnotationRow, can_delete: bool) -> String {
    let target = if let Some(field) = row.field_key.as_deref() {
        let label = if row.field_label.is_empty() {
            field
        } else {
            row.field_label.as_str()
        };
        format!(
            r#"<p class="annotation-quote" data-annotation-jump>On the field: {}</p>"#,
            escape(label)
        )
    } else if !row.quote.is_empty() {
        format!(
            r#"<blockquote class="annotation-quote" data-annotation-jump>“{}”</blockquote>"#,
            escape(&row.quote)
        )
    } else {
        r#"<p class="annotation-quote">On the whole document</p>"#.to_string()
    };
    let delete = if can_delete {
        format!(
            r#"<form method="post" action="/documents/{key}/annotations/{id}/delete" data-annotation-delete><input type="hidden" name="csrf" value="{csrf}"><button type="submit" class="link">Delete</button></form>"#,
            id = row.id
        )
    } else {
        String::new()
    };
    format!(
        r#"<li class="annotation" id="annotation-{id}" tabindex="-1" data-annotation-id="{id}" data-quote="{quote}" data-prefix="{prefix}" data-suffix="{suffix}" data-field="{field}">{target}<p class="annotation-body">{body}</p><p class="small">{author}, {created} (SGT) · version {version}</p>{delete}</li>"#,
        id = row.id,
        quote = escape(&row.quote),
        prefix = escape(&row.prefix),
        suffix = escape(&row.suffix),
        field = escape(row.field_key.as_deref().unwrap_or("")),
        body = escape(&row.body),
        author = escape(row.author.as_deref().unwrap_or("someone")),
        created = escape(&row.created),
        version = row.version_no,
    )
}

/// Annotations: the list, and the composer that the page's script fills when Comment is pressed
/// (it also works as a plain form for a comment on the whole document).
fn annotations_section(key: &str, csrf: &str, review: &Review) -> String {
    let items: String = review
        .annotations
        .iter()
        .map(|a| annotation_item(key, csrf, a, review.can_delete(a)))
        .collect();
    let empty = if review.annotations.is_empty() {
        ""
    } else {
        " hidden"
    };
    format!(
        r#"<section class="panel-section" id="annotations"><div class="section-head"><h2>Annotations</h2><span class="count" data-annotation-count>{n}</span></div>
<p class="small">Select text in the document, or click into a field, then press Comment. Everyone in the family can comment; you can delete your own.</p>
<ol class="annotations" data-annotations>{items}</ol><p class="small" data-annotations-empty{empty}>No annotations yet.</p>
<form method="post" action="/documents/{key}/annotations" class="stack composer" data-composer><input type="hidden" name="csrf" value="{csrf}"><input type="hidden" name="quote" value=""><input type="hidden" name="prefix" value=""><input type="hidden" name="suffix" value=""><input type="hidden" name="field_key" value=""><input type="hidden" name="field_label" value="">
<p class="composer-target" data-composer-target hidden></p>
<label>Add a comment <textarea name="body" rows="3" maxlength="4000" required data-composer-body></textarea></label>
<div class="composer-actions"><button type="submit">Save comment</button><button type="button" class="secondary" data-composer-clear hidden>On the whole document instead</button></div>
<p class="small" role="status" data-composer-status></p>
</form></section>"#,
        n = review.annotations.len(),
    )
}

/// Saved fields: who sees what people fill in, and the latest changes to the family copy.
fn fields_section(key: &str, csrf: &str, review: &Review) -> String {
    let state = if review.mode == "personal" {
        format!(
            r#"<p>Ticks and typed answers are <strong>personal</strong>: each person sees only their own. You have {} saved.</p>"#,
            review.own_count
        )
    } else {
        let changes = if review.recent.is_empty() {
            r#"<p class="small">Nothing filled in yet.</p>"#.to_string()
        } else {
            format!(
                r#"<ul class="changes">{}</ul>"#,
                review
                    .recent
                    .iter()
                    .map(|c| {
                        let label = if c.label.is_empty() { &c.key } else { &c.label };
                        format!(
                            r#"<li><span class="wrap">{}</span>: {} · {}, {}</li>"#,
                            escape(label),
                            escape(&shown_value(&c.value)),
                            escape(c.by.as_deref().unwrap_or("someone")),
                            escape(&c.at)
                        )
                    })
                    .collect::<String>()
            )
        };
        format!(
            r#"<p>Ticks and typed answers are <strong>shared</strong>: the family sees one copy. Latest changes:</p>{changes}"#
        )
    };
    let form = if review.can_choose_mode {
        let (shared, personal) = if review.mode == "personal" {
            ("", " checked")
        } else {
            (" checked", "")
        };
        format!(
            r#"<form method="post" action="/documents/{key}/fields-mode" class="stack"><input type="hidden" name="csrf" value="{csrf}"><fieldset class="choices"><legend>Who sees what people fill in?</legend><label class="choice"><input type="radio" name="mode" value="shared"{shared}><span>Shared: one family copy</span></label><label class="choice"><input type="radio" name="mode" value="personal"{personal}><span>Personal: each person their own</span></label></fieldset><p class="small">Switching keeps both sets; each choice shows its own answers.</p><button type="submit" class="secondary">Save choice</button></form>"#
        )
    } else {
        String::new()
    };
    section("Saved fields", None, &format!("{state}{form}"))
}

/// One document, filling the window: the document frame and the management panel beside it
/// (landscape) or in a sheet opened with Manage (portrait).
pub fn document_view(
    nav: &Nav,
    doc: &DocumentRow,
    versions: &[VersionRow],
    can_manage: bool,
    owner: &str,
    message: Option<&str>,
    review: &Review,
) -> String {
    let key = escape(&doc.key);
    let csrf = escape(nav.csrf);
    let label = escape(&filing_label(&doc.key));
    let added_by = doc.added_by.as_deref().unwrap_or("someone");
    let details = section(
        "Details",
        None,
        &format!(
            r#"<dl class="facts"><dt>Filing number</dt><dd class="filing">{label}</dd><dt>Added by</dt><dd>{added}</dd><dt>Latest</dt><dd>version {v} · {kind} · {kb} KB · {by}, {when} (SGT)</dd><dt>File</dt><dd class="wrap">{file}</dd></dl><p><a class="pill" href="/documents/{key}/raw" target="_blank" rel="noopener noreferrer">Open on its own</a> <a class="pill" href="/documents">All documents</a></p>"#,
            added = escape(added_by),
            v = doc.version_no,
            kind = kind_name(&doc.kind),
            kb = kilobytes(doc.size_bytes),
            by = escape(doc.uploaded_by.as_deref().unwrap_or("someone")),
            when = escape(&doc.uploaded_at),
            file = escape(&doc.filename),
        ),
    );
    let tag_list = if doc.tags.is_empty() {
        r#"<p class="small">No hashtags yet.</p>"#.to_string()
    } else {
        format!(
            r#"<p class="tags">{}</p>"#,
            doc.tags
                .iter()
                .map(|t| format!(r#"<span class="tag">#{}</span>"#, escape(t)))
                .collect::<String>()
        )
    };
    let tag_form = if can_manage {
        format!(
            r#"<form method="post" action="/documents/{key}/tags" class="stack"><input type="hidden" name="csrf" value="{csrf}"><label>Edit hashtags <input type="text" name="tags" maxlength="400" value="{value}"></label><button type="submit" class="secondary">Save hashtags</button></form>"#,
            value = hashtags(&doc.tags),
        )
    } else {
        String::new()
    };
    let tags = section(
        "Hashtags",
        Some(doc.tags.len()),
        &format!("{tag_list}{tag_form}"),
    );
    let version_items: String = versions
        .iter()
        .map(|v| {
            format!(
                r#"<li><a href="/documents/{key}/raw?v={n}" target="_blank" rel="noopener noreferrer">Version {n}</a>{shown} · <span class="wrap">{file}</span> · {kb} KB · {by}, {when}</li>"#,
                n = v.version_no,
                shown = if v.version_no == doc.version_no { " (shown)" } else { "" },
                file = escape(&v.filename),
                kb = kilobytes(v.size_bytes),
                by = escape(v.uploaded_by.as_deref().unwrap_or("someone")),
                when = escape(&v.uploaded_at),
            )
        })
        .collect();
    let version_form = if can_manage {
        format!(
            r#"<form method="post" action="/documents/{key}/version" enctype="multipart/form-data" class="stack"><input type="hidden" name="csrf" value="{csrf}"><label>Upload a new version <input type="file" name="file" accept=".html,.htm,.txt,.md,text/html,text/plain,text/markdown" required></label><button type="submit" class="secondary">Add version</button></form>"#
        )
    } else {
        String::new()
    };
    let version_section = section(
        "Versions",
        Some(versions.len()),
        &format!(r#"<ul class="versions">{version_items}</ul>{version_form}"#),
    );
    let manage = if can_manage {
        section(
            "Manage",
            None,
            &format!(
                r#"<form method="post" action="/documents/{key}/rename" class="stack"><input type="hidden" name="csrf" value="{csrf}"><label>Title <input type="text" name="title" maxlength="120" value="{title}" required></label><button type="submit" class="secondary">Rename</button></form>
<form method="post" action="/documents/{key}/delete" class="stack danger-zone"><input type="hidden" name="csrf" value="{csrf}"><p class="small">Deleting removes every version and the hashtags for good. There are no backups.</p><label>Type {word} to confirm <input type="text" name="confirm" autocomplete="off" required pattern="{word}" placeholder="{word}"></label><button type="submit" class="danger">Delete permanently</button></form>"#,
                title = escape(&doc.title),
                word = DELETE_WORD,
            ),
        )
    } else {
        let who = if added_by == owner {
            escape(owner)
        } else {
            format!("{} or {}", escape(added_by), escape(owner))
        };
        format!(r#"<p class="small">Only {who} can change or delete this document.</p>"#)
    };
    let latest = versions.iter().find(|v| v.version_no == doc.version_no);
    let main = format!(
        r##"<div class="viewer-doc">
<div class="doc-bar"><span class="filing">{label}</span><h1 class="doc-title">{title}</h1><button type="button" class="pill comment-open" data-comment hidden>Comment</button><a class="pill manage-open" href="#panel">Manage</a></div>
{notice}
<iframe class="doc-frame" src="/documents/{key}/raw" sandbox="{sandbox}" allow="" referrerpolicy="no-referrer" loading="eager" title="Document: {title}"></iframe>
</div>
<aside class="panel" id="panel" aria-label="Manage this document">
<div class="panel-head"><span class="panel-title">This document</span><a class="pill manage-close" href="#doc">Close</a></div>
{details}{annotations}{fields}{tags}{version_section}{check}{manage}
</aside>
<script type="module" src="/assets/doc-view.mjs"></script>"##,
        title = escape(&doc.title),
        notice = notice(message),
        sandbox = IFRAME_SANDBOX,
        check = check_section(latest),
        annotations = annotations_section(&key, &csrf, review),
        fields = if doc.kind == "html" {
            fields_section(&key, &csrf, review)
        } else {
            String::new()
        },
    );
    page_shell(
        &doc.title,
        Some(nav),
        "app viewer-page",
        &format!(r#" data-csrf="{csrf}" data-doc-key="{key}""#),
        r#"class="viewer" id="doc""#,
        &main,
        Some(&document_contents(&doc.key, latest)),
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
