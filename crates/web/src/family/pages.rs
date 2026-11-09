//! Server-rendered pages. Every value from the database or the request is escaped.

use super::attach;
use super::doccheck::filing_label;
use super::documents::{DELETE_WORD, DocumentRow, IFRAME_SANDBOX, VersionRow};
use super::redact::REDACT_WORD;
use super::review::{AnnotationRow, MentionRow, Review};
use super::store::{AuditRow, FailureCount, FailureDetail, JournalRow, Profile, ProfileStatus};
use super::web::escape;

pub struct Nav<'a> {
    pub handle: &'a str,
    pub is_owner: bool,
    pub csrf: &'a str,
    /// This device allowed one approximate location and none is saved yet this session, so the
    /// page asks for it (session.mjs). Any signed-in page can, since the landing page is a document.
    pub locate: bool,
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
        r##"<div class="fab-group" id="fab-group" data-fab-group>
<form class="fab-search glass" id="fab-search" role="search" data-fab-search hidden><label><span class="visually-hidden">Search all documents</span><input type="search" data-fab-input placeholder="Search titles, hashtags and text" autocomplete="off" spellcheck="false" maxlength="100"></label><button type="submit" aria-label="Search">→</button></form>
<div class="fab-contents glass" id="fab-contents" role="region" aria-label="Contents" data-fab-contents hidden>{contents}</div>
<button type="button" class="fab-satellite" data-fab-satellite aria-expanded="false" aria-controls="fab-search" title="Search all documents" disabled><span aria-hidden="true">🛰️</span><span class="visually-hidden">Search all documents</span></button>
<button type="button" class="fab-globe" data-fab-globe aria-haspopup="dialog" aria-controls="globe" aria-expanded="false" title="Explore the documents" disabled><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><radialGradient id="fab-g" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".6" stop-color="#eef3fa" stop-opacity=".9"/><stop offset="1" stop-color="#c9d7ea" stop-opacity=".9"/></radialGradient></defs><circle cx="24" cy="24" r="19" fill="url(#fab-g)" stroke="#7f9bc4" stroke-opacity=".9" stroke-width="1.4"/><path d="M12 18c3-4 8-4 10-1s6 1 9-2c3 3 3 8 1 11s-7 2-9 0-6 1-9 3c-3-3-4-7-2-11z" fill="#d7e3f3" stroke="#9fb6d6" stroke-width=".8"/><circle cx="16" cy="19" r="2.2" fill="#f0b8a2"/><circle cx="31" cy="15" r="2.2" fill="#a8c8f0"/><circle cx="33" cy="30" r="2.2" fill="#f3d58b"/><circle cx="20" cy="33" r="2.2" fill="#b9e0c6"/></svg><span class="visually-hidden">Explore the documents</span></button>
<button type="button" class="fab-folder" data-fab-folder aria-expanded="false" aria-controls="fab-contents" title="Contents" disabled><span aria-hidden="true">📁</span><span class="visually-hidden">Contents</span></button>
</div>
<button type="button" class="fab-scope" data-fab-scope aria-expanded="false" aria-controls="fab-group" title="Show the search, globe and contents buttons"><span aria-hidden="true">🔭</span><span class="visually-hidden">Show the search, globe and contents buttons</span></button>
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

/// The menu button at the bottom left of every signed-in page (the owner's request, 5 November
/// 2026): Latest document, the sidebar switch on a document page (Ö on, ø off), Documents (folds
/// open), Journal, Settings (folds open) with About and the owner page, and Sign out at the foot, in
/// sight as soon as the menu opens (the owner: "add logout button", 6 November 2026). It works without
/// script as nested `<details>`; menu.mjs adds closing, the document list and the sidebar switch.
fn menu(nav: &Nav, viewer: bool) -> String {
    let sidebar = if viewer {
        r##"<a class="menu-item" href="#panel" data-sidebar-toggle aria-pressed="true"><span><span class="menu-glyph" data-sidebar-glyph aria-hidden="true">Ö</span> Sidebar</span><span class="visually-hidden" data-sidebar-state>on</span></a>"##
    } else {
        ""
    };
    let owner = if nav.is_owner {
        r#"<a class="menu-sub" href="/owner">Owner</a>"#
    } else {
        ""
    };
    format!(
        r#"<nav class="menu-fab" aria-label="Menu" data-menu><details class="menu" data-menu-details><summary class="menu-button glass" title="Menu"><span aria-hidden="true">☰</span><span class="visually-hidden">Menu</span></summary><div class="menu-panel glass">
<a class="menu-item" href="/documents/latest">Latest document</a>
{sidebar}
<details class="menu-group" data-menu-documents><summary class="menu-item">Documents</summary><div class="menu-list" data-menu-docs><a class="menu-sub" href="/documents">All documents</a></div></details>
<a class="menu-item" href="/journal">Journal</a>
<details class="menu-group"><summary class="menu-item">Settings</summary><div class="menu-list"><a class="menu-sub" href="/consent">This device</a><a class="menu-sub" href="/about">About</a><a class="menu-sub" href="/version">Version</a>{owner}</div></details>
<form method="post" action="/signout" class="menu-signout"><input type="hidden" name="csrf" value="{csrf}"><button type="submit" class="menu-item" data-signout>Sign out {handle}</button></form>
</div></details></nav>"#,
        csrf = escape(nav.csrf),
        handle = escape(nav.handle),
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
    // The family's pages are reached from the menu button (bottom left), so the header keeps only
    // the name; a document page drops it to give the document the whole window.
    let viewer = body_class.split_whitespace().any(|c| c == "viewer-page");
    let header = match nav {
        Some(_) if viewer => String::new(),
        Some(_) => concat!(
            r#"<header class="bar"><div class="bar-start">"#,
            r#"<button type="button" class="back" data-back title="Back to the previous page (Esc)"><span aria-hidden="true">←</span> Back <kbd>Esc</kbd></button>"#,
            r#"<a class="brand" href="/documents/latest"><span lang="zh">洪家</span> · hongjia</a></div></header>"#
        )
        .to_string(),
        None => r#"<header class="bar"><a class="brand" href="/"><span lang="zh">洪家</span> · hongjia</a></header>"#.to_string(),
    };
    let session_script = if nav.is_some() {
        r#"<script type="module" src="/assets/session.mjs"></script>
<script type="module" src="/assets/explorer.mjs"></script>
<script type="module" src="/assets/menu.mjs"></script>"#
    } else {
        ""
    };
    let explore = match nav {
        Some(nav) => format!(
            "{}{}",
            menu(nav, viewer),
            explorer(contents.unwrap_or(LIBRARY_CONTENTS))
        ),
        None => String::new(),
    };
    let body_attrs = match nav {
        Some(nav) if nav.locate => format!(r#"{body_attrs} data-location="yes""#),
        _ => body_attrs.to_string(),
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

/// The "This device" page: shown after the first sign-in on a device, and from Settings, This device.
/// Neither answer is chosen until this device has given one (the owner, 7 November 2026);
/// `unanswered` is true when the form came back without one.
pub fn consent(
    nav: &Nav,
    device_label: &str,
    location_allowed: Option<bool>,
    unanswered: bool,
) -> String {
    let yes = if location_allowed == Some(true) {
        " checked"
    } else {
        ""
    };
    let no = if location_allowed == Some(false) {
        " checked"
    } else {
        ""
    };
    let ask = if unanswered {
        r#"<p class="notice" role="alert">Choose Yes or No to continue.</p>"#
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
<li>Your approximate location, <strong>only if you allow it below and your browser allows it</strong>, rounded to about 40 km. It is off unless you choose it.</li>
</ul>
{ask}<form method="post" action="/consent" class="stack">
<input type="hidden" name="csrf" value="{csrf}">
<fieldset class="choices"><legend>Share approximate location from this device?</legend>
<label class="choice"><input type="radio" name="location" value="yes" required{yes}><span>Yes, share about 40 km</span></label>
<label class="choice"><input type="radio" name="location" value="no" required{no}><span>No, do not share</span></label>
</fieldset>
<p class="small">If you choose Yes, your browser asks its own question first; nothing is shared unless you allow it there too.</p>
<label>Name this device (optional) <input type="text" name="device_label" maxlength="40" value="{label}" placeholder="for example: my phone"></label>
<button type="submit">Save and continue</button>
</form>
<p class="small">You can change this at any time from ☰ Settings, This device. Choosing No also removes locations already stored from this device.</p>"#,
            csrf = escape(nav.csrf),
            label = escape(device_label)
        ),
    )
}

/// What kind of mark, in words.
fn kind_word(kind: &str) -> &'static str {
    match kind {
        "highlight" => "Highlight",
        "underline" => "Underline",
        "strike" => "Strikethrough",
        "insert" => "Insert",
        "replace" => "Replace",
        "note" => "Sticky note",
        "textbox" => "Text box",
        "stamp" => "Stamp",
        "ink" => "Drawing",
        "shape" => "Shape",
        "signature" => "Signature",
        "redaction" => "Redaction",
        "attachment" => "Attachment",
        _ => "Comment",
    }
}

/// What a drawing is called in the panel: Drawing for ink, the shape's own name for a shape.
fn drawing_word(row: &AnnotationRow) -> &'static str {
    match (row.kind.as_str(), row.tool.as_deref()) {
        ("shape", Some("rectangle")) => "Rectangle",
        ("shape", Some("oval")) => "Oval",
        ("shape", Some("line")) => "Line",
        ("shape", Some("arrow")) => "Arrow",
        _ => "Drawing",
    }
}

fn mentioned_list(mentioned: &[MentionRow]) -> String {
    if mentioned.is_empty() {
        return String::new();
    }
    let items: String = mentioned
        .iter()
        .map(|m| {
            let quote = if m.quote.is_empty() {
                String::new()
            } else {
                format!(" on “{}”", escape(&m.quote.chars().take(80).collect::<String>()))
            };
            format!(
                r#"<li><a href="/documents/{key}#annotation-{id}"><span class="filing">{label}</span> {title}</a><span class="small"> · {kind}{quote} · {by}, {at} (SGT)</span></li>"#,
                key = escape(&m.key),
                id = m.annotation_id,
                label = escape(&filing_label(&m.key)),
                title = escape(&m.title),
                kind = kind_word(&m.kind),
                by = escape(m.by.as_deref().unwrap_or("someone")),
                at = escape(&m.at),
            )
        })
        .collect();
    format!(
        r#"<section class="mentioned"><div class="section-head"><h2>Mentioned you</h2><span class="count">{n}</span></div><ul class="mentioned-list">{items}</ul></section>"#,
        n = mentioned.len()
    )
}

/// The page that used to greet people after signing in; since 5 November 2026 they land on the
/// latest document and reach this from Settings, About (the owner's request).
pub fn about(nav: &Nav, device: &str, mentioned: &[MentionRow]) -> String {
    let attrs = format!(r#" data-csrf="{}""#, escape(nav.csrf));
    layout(
        "About",
        Some(nav),
        &attrs,
        &format!(
            r#"<h1>Hello, {handle}</h1>
<p>You are signed in on {device}.</p>
{mentions}
<p>Open the <a href="/documents">documents</a> or <a href="/documents/new">add one</a>. To mark up a document, right-click it (tap twice on a touch screen or with the Pencil). You can also see the <a href="/journal">login journal</a>, change <a href="/consent">this device's settings</a>, or read <a href="/privacy">what we collect</a>.</p>
<form method="post" action="/signout-everywhere"><input type="hidden" name="csrf" value="{csrf}"><button type="submit" class="secondary">Sign out on all devices</button></form>"#,
            handle = escape(nav.handle),
            device = escape(device),
            mentions = mentioned_list(mentioned),
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
<tr><td>Approximate location, rounded to about 40 km</td><td>Only if you allowed it on that device</td><td>All four profiles</td><td>{location_days} days</td></tr>
<tr><td>Estimated active time</td><td>While a page is visible and in use</td><td>All four profiles</td><td>{journal_days} days</td></tr>
<tr><td>Network address</td><td>Every request</td><td>Nobody; it is coarsened and hashed before storage, only to slow down password guessing</td><td>at most 90 days</td></tr>
</tbody></table></div>
<p>Choosing a profile name does not prove who signed in, and an open tab does not prove anyone was reading. Precise GPS is never requested.</p>
<p>Trip pages can show a weather forecast. The server then asks Open-Meteo for the trip's places, sending only their coordinates, rounded to about 1 km, and the dates. Your device, network address and documents are not sent. Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0).</p>
<p>Trip-page maps show map pictures that the server fetches from OpenStreetMap for the area on screen and keeps for at least a week. Your device, network address and documents are not sent. Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.</p>
<p>Trip pages can show Instagram and TikTok posts, in a place's panel or in the Gallery view. Each loads from Instagram or TikTok only when you open that panel or tap that post, and Instagram or TikTok then sees your device's network address, as with any visit to them. Facebook posts are links that open Facebook.</p>
<p>Trip pages can have Add to calendar buttons. The button opens a link on this site that holds the event's title, times, place and note; the site turns it into a calendar file for your device and keeps nothing.</p>
<p>Trip pages have Hungry? and Shop nearby buttons, which list the nearest food or shops. If you agree when the site asks, your device gives a rough location, used on that device only to sort the trip's places by distance. It is not sent to the site, passed to the trip page or kept.</p>
<p>Trip pages show 🤙🏼 beside each place and part. For the owner's account it opens WhatsApp with that part's name, time, address and link already typed in, and WhatsApp asks which chat; nothing is sent until the owner presses Send. This site sends nothing to WhatsApp. For everyone else 🤙🏼 is greyed.</p>
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
    match kind {
        "html" => "web page",
        "picture" => "picture",
        _ => "text",
    }
}

fn kilobytes(bytes: i32) -> i32 {
    (bytes + 1023) / 1024
}

/// The documents list in the owner's Style D: grouped by the month filed, serif section headers
/// with count badges, hairline rows.
/// The version a document page shows beside its filing number (the owner, 7 November 2026:
/// "2026-1106_#1 · v.##"): the number in the file's own name, such as the 13 in
/// `Trip-Coffee-Table-v13-final.html`, or else its version on this site.
pub fn version_tag(filename: &str, version_no: i32) -> String {
    let stem = filename.rsplit_once('.').map_or(filename, |(stem, _)| stem);
    let from_name = stem
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter_map(|word| {
            let digits = word.strip_prefix('v').or_else(|| word.strip_prefix('V'))?;
            (!digits.is_empty() && digits.len() <= 3 && digits.bytes().all(|b| b.is_ascii_digit()))
                .then(|| digits.parse::<i32>().ok())
                .flatten()
        })
        .next_back();
    format!("v.{:02}", from_name.unwrap_or(version_no))
}

/// ☰ Settings, Version: the program's version and one paragraph on what changed in it.
pub fn version(nav: &Nav, version: &str, synopsis: &str, commit: &str) -> String {
    layout(
        "Version",
        Some(nav),
        "",
        &format!(
            r#"<h1>Version {version}</h1>
<p>{synopsis}</p>
<p class="small">Build {commit}. Numbered by the date it went live in Singapore, with the count of releases that day.</p>"#,
            version = escape(version),
            synopsis = escape(synopsis),
            commit = escape(commit),
        ),
    )
}

pub fn documents(
    nav: &Nav,
    rows: &[DocumentRow],
    manageable: &dyn Fn(&DocumentRow) -> bool,
    show_hidden: bool,
    hidden: i64,
) -> String {
    // Hidden documents are listed only on asking (the owner, 7 November 2026).
    let switch = match (show_hidden, hidden) {
        (true, _) => r#"<p class="small list-switch">Showing hidden documents too. <a href="/documents">Hide them</a></p>"#.to_string(),
        (false, 0) => String::new(),
        (false, n) => format!(
            r#"<p class="small list-switch"><a href="/documents?hidden=1">Show hidden ({n})</a></p>"#
        ),
    };
    // One table for document management (the owner, 8 November 2026): the version is the file's own
    // number, as in the document's header; the page script sorts by a column, searches and filters.
    let mut all_tags: Vec<&str> = rows
        .iter()
        .flat_map(|d| d.tags.iter().map(String::as_str))
        .collect();
    all_tags.sort_unstable();
    all_tags.dedup();
    let chips: String = all_tags
        .iter()
        .take(24)
        .map(|t| {
            format!(
                r#"<button type="button" class="chip" data-tag-filter="{t}" aria-pressed="false">#{t}</button>"#,
                t = escape(t)
            )
        })
        .collect();
    let body: String = if rows.is_empty() {
        r#"<p>No documents yet.</p>"#.to_string()
    } else {
        let items: String = rows
            .iter()
            .map(|d| {
                // Hide and Delete for whoever added it and for the owner (the owner, 7 November 2026).
                // Delete opens the document's Manage section, where DELETE is typed.
                let more = if manageable(d) {
                    let (action, word) = if d.hidden { ("unhide", "Unhide") } else { ("hide", "Hide") };
                    format!(
                        r#"<details class="row-more"><summary title="More for {title}"><span aria-hidden="true">⋯</span><span class="visually-hidden">More for {title}</span></summary><div class="row-menu"><form method="post" action="/documents/{key}/{action}"><input type="hidden" name="csrf" value="{csrf}"><input type="hidden" name="back" value="list"><button type="submit" class="link">{word}</button></form><a href="/documents/{key}#panel">Delete…</a></div></details>"#,
                        title = escape(&d.title),
                        key = escape(&d.key),
                        csrf = escape(nav.csrf),
                    )
                } else {
                    String::new()
                };
                let flag = if d.hidden { r#" <span class="row-hidden">Hidden</span>"# } else { "" };
                let tag = version_tag(&d.filename, d.version_no);
                format!(
                    r#"<tr class="row{hidden_class}" data-filing="{key}" data-title="{title_key}" data-v="{v_num}" data-changed="{changed_sort}" data-by="{by}" data-tags="{tags_key}"><td class="filing">{label}</td><td class="col-title"><a class="row-title" href="/documents/{key}">{title}</a>{flag}</td><td class="col-v"><span class="doc-v" title="version {n} on this site">{tag}</span></td><td class="col-type">{kind}</td><td class="col-when">{changed}</td><td class="col-by">{by}</td><td class="col-tags">{tags}</td><td class="col-more">{more}</td></tr>"#,
                    hidden_class = if d.hidden { " is-hidden" } else { "" },
                    label = escape(&filing_label(&d.key)),
                    key = escape(&d.key),
                    title = escape(&d.title),
                    title_key = escape(&d.title.to_lowercase()),
                    v_num = tag.trim_start_matches("v.").trim_start_matches('0'),
                    n = d.version_no,
                    changed_sort = escape(&d.changed_sort),
                    changed = escape(&d.changed),
                    kind = kind_name(&d.kind),
                    by = escape(d.added_by.as_deref().unwrap_or("someone")),
                    tags = hashtags(&d.tags),
                    tags_key = escape(&d.tags.join(" ").to_lowercase()),
                )
            })
            .collect();
        format!(
            r#"<div class="list-tools" data-list-tools><label class="list-search"><span class="visually-hidden">Search the list</span><input type="search" data-list-search placeholder="Search titles and hashtags" autocomplete="off" spellcheck="false" maxlength="100"></label>{chips}</div>
<table class="doc-table" data-doc-table><thead><tr><th scope="col" data-sort="filing" aria-sort="none">Filing no.</th><th scope="col" data-sort="title" aria-sort="none">Title</th><th scope="col" data-sort="v" aria-sort="none">Version</th><th scope="col" class="col-type">Type</th><th scope="col" data-sort="changed" aria-sort="descending">Last change</th><th scope="col" class="col-by" data-sort="by" aria-sort="none">Added by</th><th scope="col" class="col-tags">Hashtags</th><th scope="col" class="col-more"><span class="visually-hidden">More</span></th></tr></thead><tbody>{items}</tbody></table>
<p class="small" data-list-none hidden>No document matches.</p>"#
        )
    };
    layout(
        "Documents",
        Some(nav),
        &format!(r#" data-csrf="{}""#, escape(nav.csrf)),
        &format!(
            r#"<div class="list-head"><h1>Documents</h1><a class="pill solid" href="/documents/new">Add a document</a></div>{switch}{body}"#
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
<label>File <input type="file" name="file" accept=".html,.htm,.txt,.md,.jpg,.jpeg,.png,.webp,text/html,text/plain,text/markdown,image/jpeg,image/png,image/webp" required></label>
<p class="small">HTML pages, text files and pictures (JPEG, PNG or WebP), up to 10 MB. On an iPhone, choose a photo from the library; Safari sends it as a JPEG. Leave the hashtags empty and the site suggests some from the file. The document is filed under today's date and number, for example 2026-1105_#1.</p>
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
    if v.kind == "picture" {
        return section(
            "Upload check",
            None,
            &format!(
                r#"<dl class="facts"><dt>Picture</dt><dd>{w} x {h} ({kind})</dd></dl><p class="ok">Shown as it is; every mark, drawing and signature works on it.</p>"#,
                w = v.image_width.unwrap_or(0),
                h = v.image_height.unwrap_or(0),
                kind = escape(
                    &v.image_type
                        .as_deref()
                        .unwrap_or("jpeg")
                        .to_ascii_uppercase()
                ),
            ),
        );
    }
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

/// Text with its @mentions of family members marked (the handles are lowercase letters only).
fn with_mentions(text: &str, mentions: &[String]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '@' && (i == 0 || !chars[i - 1].is_alphanumeric()) {
            let name: String = chars[i + 1..]
                .iter()
                .take_while(|c| c.is_ascii_alphabetic())
                .collect();
            if mentions.contains(&name.to_ascii_lowercase()) {
                out.push_str(&format!(
                    r#"<span class="mention">@{}</span>"#,
                    escape(&name)
                ));
                i += 1 + name.chars().count();
                continue;
            }
        }
        out.push_str(&escape(&chars[i].to_string()));
        i += 1;
    }
    out
}

fn annotation_item(key: &str, csrf: &str, row: &AnnotationRow, review: &Review) -> String {
    let quote = || escape(&row.quote);
    let tag = format!(
        r#"<span class="kind-tag" data-color="{color}">{word}</span>"#,
        color = escape(&row.color),
        word = kind_word(&row.kind)
    );
    let target = match row.kind.as_str() {
        "comment" => {
            if let Some(field) = row.field_key.as_deref() {
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
                    quote()
                )
            } else {
                r#"<p class="annotation-quote">On the whole document</p>"#.to_string()
            }
        }
        "highlight" | "underline" | "strike" => format!(
            r#"<blockquote class="annotation-quote" data-annotation-jump>{tag} “{}”</blockquote>"#,
            quote()
        ),
        "insert" => {
            let place = if row.quote.is_empty() {
                "here".to_string()
            } else {
                format!("after “{}”", quote())
            };
            format!(
                r#"<p class="annotation-quote" data-annotation-jump>{tag} “{}” {place}</p>"#,
                escape(&row.text)
            )
        }
        "replace" => format!(
            r#"<p class="annotation-quote" data-annotation-jump>{tag} “{}” with “{}”</p>"#,
            quote(),
            escape(&row.text)
        ),
        "stamp" | "signature" => format!(
            r#"<p class="annotation-quote" data-annotation-jump>{tag} {}</p>"#,
            escape(&row.label())
        ),
        "ink" | "shape" => format!(
            r#"<p class="annotation-quote" data-annotation-jump><span class="kind-tag" data-color="{color}">{word}</span> in {color}</p>"#,
            color = escape(&row.color),
            word = drawing_word(row)
        ),
        // D4: a passage waiting to be blacked out, and an attached file (downloaded only).
        "redaction" => format!(
            r#"<blockquote class="annotation-quote" data-annotation-jump><span class="kind-tag kind-redaction">Redaction</span> “{}”</blockquote>"#,
            quote()
        ),
        "attachment" => format!(
            r#"<p class="annotation-quote" data-annotation-jump><span class="kind-tag kind-attachment">Attachment</span> <span class="wrap">{name}</span></p><p class="attachment-file"><a href="/documents/{key}/attachments/{id}" download data-attachment-link>Download</a> · {kind} · {size}</p>"#,
            name = escape(&row.text),
            id = row.id,
            kind = attach::type_words(row.file_type.as_deref().unwrap_or("")),
            size = attach::size_words(i64::from(row.file_size.unwrap_or(0))),
        ),
        _ => format!(r#"<p class="annotation-quote" data-annotation-jump>{tag}</p>"#),
    };
    let body = if row.body.is_empty() {
        String::new()
    } else {
        format!(
            r#"<p class="annotation-body">{}</p>"#,
            with_mentions(&row.body, &row.mentions)
        )
    };
    // A signature is moved, never edited (D3); nor are redactions and attachments (D4).
    let edit = if review.can_edit(row)
        && !matches!(row.kind.as_str(), "signature" | "redaction" | "attachment")
    {
        r#"<button type="button" class="link" data-annotation-edit>Edit</button>"#
    } else {
        ""
    };
    let delete = if review.can_delete(row) {
        format!(
            r#"<form method="post" action="/documents/{key}/annotations/{id}/delete" data-annotation-delete><input type="hidden" name="csrf" value="{csrf}"><button type="submit" class="link">Delete</button></form>"#,
            id = row.id
        )
    } else {
        String::new()
    };
    let mentions_me = row.mentions.contains(&review.viewer_handle);
    let number = |v: Option<f64>| v.map(|v| v.to_string()).unwrap_or_default();
    format!(
        r#"<li class="annotation{me}" id="annotation-{id}" tabindex="-1" data-annotation-id="{id}" data-kind="{kind}" data-color="{color}" data-quote="{quote}" data-prefix="{prefix}" data-suffix="{suffix}" data-field="{field}" data-text="{text}" data-label="{label}" data-path="{path}" data-x="{x}" data-y="{y}" data-body="{body_attr}" data-can-edit="{can_edit}"{drawing}>{target}{body}<p class="small">{author}, {created} (SGT) · version {version}</p><div class="annotation-actions">{edit}{delete}</div></li>"#,
        me = if mentions_me { " mentions-me" } else { "" },
        id = row.id,
        kind = escape(&row.kind),
        color = escape(&row.color),
        quote = escape(&row.quote),
        prefix = escape(&row.prefix),
        suffix = escape(&row.suffix),
        field = escape(row.field_key.as_deref().unwrap_or("")),
        text = escape(&row.text),
        label = escape(&row.label()),
        path = escape(row.anchor_path.as_deref().unwrap_or("")),
        x = number(row.anchor_x),
        y = number(row.anchor_y),
        body_attr = escape(&row.body),
        can_edit = review.can_edit(row),
        drawing = match (&row.tool, &row.points, row.stroke_width, row.ref_width) {
            (Some(tool), Some(points), Some(width), Some(reference)) => format!(
                r#" data-tool="{}" data-points="{}" data-width="{width}" data-ref="{reference}" data-refh="{}""#,
                escape(tool),
                escape(points),
                row.ref_height.map(|h| h.to_string()).unwrap_or_default()
            ),
            // D3: a placed signature's drawn strokes (a typed one is in data-text).
            _ if row.kind == "signature" => format!(
                r#" data-points="{}""#,
                escape(row.points.as_deref().unwrap_or(""))
            ),
            _ => String::new(),
        },
        author = escape(row.author.as_deref().unwrap_or("someone")),
        created = escape(&row.created),
        version = row.version_no,
    )
}

/// Annotations: the list, and the composer that the page's script fills when Comment is pressed
/// (it also works as a plain form for a comment on the whole document).
fn annotations_section(key: &str, csrf: &str, review: &Review) -> String {
    let marks: Vec<&AnnotationRow> = review
        .annotations
        .iter()
        .filter(|a| !SEPARATE.contains(&a.kind.as_str()))
        .collect();
    let items: String = marks
        .iter()
        .map(|a| annotation_item(key, csrf, a, review))
        .collect();
    let empty = if marks.is_empty() { "" } else { " hidden" };
    format!(
        r#"<section class="panel-section" id="annotations"><div class="section-head"><h2>Annotations</h2><span class="count" data-annotation-count>{n}</span></div>
<p class="small">Right-click the document (tap twice on a touch screen or with the Pencil) to highlight, underline, strike through, insert or replace text, add a note, a text box, a stamp or your signature, or draw: Draw, Sketch (rough circles, boxes, lines and arrows become clean shapes), Shapes and Eraser. Loupe magnifies. Or select text and press Comment. Type @ and a name to mention someone. Everyone can mark up; you can edit, move and delete your own.</p>
<ol class="annotations" data-annotations>{items}</ol><p class="small" data-annotations-empty{empty}>No annotations yet.</p>
<form method="post" action="/documents/{key}/annotations" class="stack composer" data-composer><input type="hidden" name="csrf" value="{csrf}"><input type="hidden" name="quote" value=""><input type="hidden" name="prefix" value=""><input type="hidden" name="suffix" value=""><input type="hidden" name="field_key" value=""><input type="hidden" name="field_label" value="">
<p class="composer-target" data-composer-target hidden></p>
<label>Add a comment <textarea name="body" rows="3" maxlength="4000" required data-composer-body></textarea></label>
<div class="composer-actions"><button type="submit">Save comment</button><button type="button" class="secondary" data-composer-clear hidden>On the whole document instead</button></div>
<p class="small" role="status" data-composer-status></p>
</form></section>"#,
        n = marks.len(),
    )
}

/// Kinds listed in their own panel sections (D4) instead of with the annotations.
const SEPARATE: [&str; 2] = ["redaction", "attachment"];

/// The marks of one kind, as a list for its own section.
fn kind_list(key: &str, csrf: &str, review: &Review, kind: &str, none: &str) -> (usize, String) {
    let rows: Vec<&AnnotationRow> = review
        .annotations
        .iter()
        .filter(|a| a.kind == kind)
        .collect();
    let items: String = rows
        .iter()
        .map(|a| annotation_item(key, csrf, a, review))
        .collect();
    let hidden = if rows.is_empty() { "" } else { " hidden" };
    (
        rows.len(),
        format!(
            r#"<ol class="annotations" data-mark-list="{kind}">{items}</ol><p class="small" data-mark-empty="{kind}"{hidden}>{none}</p>"#
        ),
    )
}

/// D4: passages waiting to be blacked out, and (for the uploader or the owner) the form that
/// applies them for good. Shown to everyone when some are waiting.
fn redactions_section(key: &str, csrf: &str, review: &Review, doc: &DocumentRow) -> String {
    let (n, list) = kind_list(
        key,
        csrf,
        review,
        "redaction",
        "Nothing is marked for redaction.",
    );
    if !review.can_choose_mode && n == 0 {
        return String::new();
    }
    let how = if doc.kind == "picture" {
        r#"<p class="small">Pictures cannot be redacted yet. Upload an edited picture as a new version instead.</p>"#.to_string()
    } else if review.can_redact {
        format!(
            r#"<p class="small">To black out words for good, select them in the document, right-click (tap twice on a touch screen or with the Pencil) and choose Redact. Marked words show as black boxes until the redactions are applied.</p>
<form method="post" action="/documents/{key}/redactions/apply" class="stack danger-zone" data-redact-apply><input type="hidden" name="csrf" value="{csrf}"><p class="small">Applying makes a new version with every marked passage blacked out (█) and deletes every earlier version for good. There are no backups. Other marks keep their place; the blacked-out words are removed from what they saved.</p><label>Type {word} to confirm <input type="text" name="confirm" autocomplete="off" required pattern="{word}" placeholder="{word}"></label><button type="submit" class="danger">Apply redactions permanently</button></form>"#,
            word = REDACT_WORD,
        )
    } else {
        r#"<p class="small">Only the person who added this document, or the owner, can mark and apply redactions.</p>"#.to_string()
    };
    format!(
        r#"<section class="panel-section" id="redactions"><div class="section-head"><h2>Pending redactions</h2><span class="count" data-mark-count="redaction">{n}</span></div>{list}{how}</section>"#
    )
}

/// D4: files pinned to the document. Anyone in the family may attach one.
fn attachments_section(key: &str, csrf: &str, review: &Review) -> String {
    let (n, list) = kind_list(key, csrf, review, "attachment", "No files attached yet.");
    format!(
        r#"<section class="panel-section" id="attachments"><div class="section-head"><h2>Attachments</h2><span class="count" data-mark-count="attachment">{n}</span></div>
<p class="small">Right-click the document where a file belongs (tap twice on a touch screen or with the Pencil) and choose Attach file. Pictures (JPEG, PNG, WebP), PDF, Word, Excel, PowerPoint, plain text and CSV, up to 10 MB. Files are only ever downloaded, never opened in the site.</p>
{list}<input type="file" hidden data-attach-input accept="{accept}"><p class="small" role="status" data-attach-status></p></section>"#,
        accept = attach::ACCEPT,
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
            r#"<form method="post" action="/documents/{key}/version" enctype="multipart/form-data" class="stack"><input type="hidden" name="csrf" value="{csrf}"><label>Upload a new version <input type="file" name="file" accept=".html,.htm,.txt,.md,.jpg,.jpeg,.png,.webp,text/html,text/plain,text/markdown,image/jpeg,image/png,image/webp" required></label><button type="submit" class="secondary">Add version</button></form>"#
        )
    } else {
        String::new()
    };
    let redaction_note = review
        .redacted
        .as_ref()
        .map(|(on, by)| {
            format!(
                r#"<p class="small redaction-note">Earlier versions were removed by a redaction on {} (SGT) by {}.</p>"#,
                escape(on),
                escape(by.as_deref().unwrap_or("someone"))
            )
        })
        .unwrap_or_default();
    let version_section = section(
        "Versions",
        Some(versions.len()),
        &format!(r#"<ul class="versions">{version_items}</ul>{redaction_note}{version_form}"#),
    );
    let (hide_action, hide_word, hide_note) = if doc.hidden {
        (
            "unhide",
            "Unhide",
            "Hidden from the family's lists, the globe, search and the landing page. Unhide lists it again.",
        )
    } else {
        (
            "hide",
            "Hide",
            "Hiding takes it off the family's lists, the globe, search and the landing page; it is kept, and can be unhidden.",
        )
    };
    let manage = if can_manage {
        section(
            "Manage",
            None,
            &format!(
                r#"<div id="manage"></div><form method="post" action="/documents/{key}/rename" class="stack"><input type="hidden" name="csrf" value="{csrf}"><label>Title <input type="text" name="title" maxlength="120" value="{title}" required></label><button type="submit" class="secondary">Rename</button></form>
<form method="post" action="/documents/{key}/{hide_action}" class="stack"><input type="hidden" name="csrf" value="{csrf}"><p class="small">{hide_note}</p><button type="submit" class="secondary">{hide_word}</button></form>
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
    let manage_grouped = format!(r#"<div data-group="manage">{manage}</div>"#);
    let latest = versions.iter().find(|v| v.version_no == doc.version_no);
    let v_title = escape(&format!(
        "{} · version {} on this site",
        doc.filename, doc.version_no
    ));
    let hidden_notice = if doc.hidden {
        r#"<p class="notice">This document is hidden from the family's lists. Unhide it in Manage.</p>"#
    } else {
        ""
    };
    let main = format!(
        r##"<div class="viewer-doc">
<div class="doc-bar"><button type="button" class="back" data-back title="Back to the previous page (Esc)"><span aria-hidden="true">←</span> Back <kbd>Esc</kbd></button><span class="filing">{label}</span><span class="doc-v" title="{v_title}">· {v_tag}</span><h1 class="doc-title">{title}</h1><button type="button" class="pill comment-open" data-comment hidden>Comment</button><div class="doc-tabs" role="group" aria-label="This document" data-doc-tabs><button type="button" data-doc-tab="details" aria-pressed="false">Details</button><button type="button" data-doc-tab="versions" aria-pressed="false">Versions <span class="count">{n_versions}</span></button><button type="button" data-doc-tab="notes" aria-pressed="false">Notes</button><button type="button" data-doc-tab="files" aria-pressed="false">Files</button>{manage_tab}</div></div>
{notice}{hidden_notice}
<div class="doc-stage" data-doc-stage><iframe class="doc-frame" src="/documents/{key}/raw" sandbox="{sandbox}" allow="" referrerpolicy="no-referrer" loading="eager" title="Document: {title}"></iframe><div class="doc-overlay" data-doc-overlay aria-hidden="true"></div></div>
</div>
<aside class="panel" id="panel" aria-label="Manage this document">
<div class="panel-head"><span class="panel-title">This document</span><a class="panel-close" href="#doc" data-sidebar-close title="Close the sidebar"><span aria-hidden="true">×</span><span class="visually-hidden">Close the sidebar</span></a></div>
{manage_top}<div data-group="details">{details}{tags}{check}</div><div data-group="notes">{annotations}{redactions}{fields}</div><div data-group="files">{attachments}</div><div data-group="versions">{version_section}</div>{manage_foot}
</aside>
<script type="module" src="/assets/doc-view.mjs"></script>"##,
        title = escape(&doc.title),
        notice = notice(message),
        v_tag = version_tag(&doc.filename, doc.version_no),
        manage_top = if can_manage {
            manage_grouped.as_str()
        } else {
            ""
        },
        manage_foot = if can_manage {
            ""
        } else {
            manage_grouped.as_str()
        },
        n_versions = versions.len(),
        manage_tab = if can_manage {
            r#"<button type="button" data-doc-tab="manage" aria-pressed="false">Manage</button>"#
        } else {
            ""
        },
        sandbox = IFRAME_SANDBOX,
        check = check_section(latest),
        annotations = annotations_section(&key, &csrf, review),
        redactions = redactions_section(&key, &csrf, review, doc),
        attachments = attachments_section(&key, &csrf, review),
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
        &format!(
            r#" data-csrf="{csrf}" data-doc-key="{key}" data-viewer="{viewer}" data-owner="{owner}" data-doc-kind="{kind}" data-manager="{manager}" data-can-redact="{redact}""#,
            viewer = escape(nav.handle),
            owner = nav.is_owner,
            kind = escape(&doc.kind),
            manager = can_manage,
            redact = review.can_redact,
        ),
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
    fn version_tag_reads_the_file_name_first() {
        assert_eq!(version_tag("Trip-Coffee-Table-v13-final.html", 5), "v.13");
        assert_eq!(version_tag("trip_V2.html", 7), "v.02");
        assert_eq!(version_tag("sources.md", 3), "v.03");
        assert_eq!(
            version_tag("visit-v2024.html", 1),
            "v.01",
            "four digits are not a version"
        );
        assert_eq!(version_tag("overview.html", 12), "v.12");
        assert_eq!(
            version_tag("v8 then v9.html", 1),
            "v.09",
            "the last one counts"
        );
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
            locate: false,
        };
        let page = about(&nav, "Safari on iPhone", &[]);
        assert!(page.contains("&lt;x&gt;") && !page.contains("<x>"));
        assert!(page.contains("&quot;q&quot;"));
        for text in [page, privacy("alpha", 180, 90), signin(&[], "t", Some("m"))] {
            assert!(!text.contains('\u{2013}') && !text.contains('\u{2014}'));
        }
    }

    #[test]
    fn the_menu_replaces_the_header_links() {
        let owner = Nav {
            handle: "delta",
            is_owner: true,
            csrf: "t",
            locate: false,
        };
        let member = Nav {
            handle: "beta",
            is_owner: false,
            csrf: "t",
            locate: false,
        };
        let page = about(&owner, "Safari on iPhone", &[]);
        assert!(page.contains(r#"<header class="bar"><div class="bar-start"><button type="button" class="back" data-back"#));
        assert!(page.contains(r#"<a class="brand" href="/documents/latest">"#));
        assert!(!page.contains("hongjia</a><nav>"));
        assert!(!page.contains("data-location"));
        for item in [
            "/documents/latest",
            "data-menu-documents",
            r#"href="/journal""#,
            r#"href="/about""#,
            r#"href="/owner""#,
            "Sign out delta",
        ] {
            assert!(page.contains(item), "{item}");
        }
        assert!(
            !page.contains("data-sidebar-toggle"),
            "the sidebar switch is for documents only"
        );
        // Sign out sits at the foot of the menu, not folded inside Settings.
        let settings = page.find("Settings</summary>").unwrap();
        let settings_end = settings + page[settings..].find("</details>").unwrap();
        let sign_out = page.find("Sign out delta").unwrap();
        assert!(
            sign_out > settings_end,
            "Sign out is folded inside Settings"
        );
        assert!(page.contains(r#"<form method="post" action="/signout" class="menu-signout">"#));
        let other = about(&member, "Safari on iPhone", &[]);
        assert!(!other.contains(r#"href="/owner""#) && other.contains("Sign out beta"));
    }

    #[test]
    fn a_page_asks_for_the_location_only_while_one_is_wanted() {
        let mut nav = Nav {
            handle: "delta",
            is_owner: false,
            csrf: "t",
            locate: true,
        };
        assert!(
            about(&nav, "Safari on iPhone", &[]).contains(r#"data-csrf="t" data-location="yes""#)
        );
        nav.locate = false;
        assert!(!about(&nav, "Safari on iPhone", &[]).contains("data-location"));
    }
}
