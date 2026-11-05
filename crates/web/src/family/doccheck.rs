//! Pure helpers for documents: dated filing numbers, hashtags and the upload check.
//!
//! The upload check reads an HTML file once, when it is uploaded, and reports what it uses (the
//! owner's design stack: Three.js, GSAP and its plugins, Lenis, Tailwind), which of the owner's
//! design styles A to E it is closest to (a rough guess), and what will not work inside the locked
//! document frame. It never changes the file and makes no network or AI calls.

/// Library sites a document may load scripts from inside the frame (the owner's choice, № 27 (a)).
pub const SCRIPT_HOSTS: [&str; 4] = [
    "cdnjs.cloudflare.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdn.tailwindcss.com",
];
/// Sites a document may load stylesheets from.
pub const STYLE_HOSTS: [&str; 4] = [
    "fonts.googleapis.com",
    "cdnjs.cloudflare.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
];
/// Sites a document may fetch from (3D models, textures, fonts for Three.js and similar).
pub const CONNECT_HOSTS: [&str; 3] = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];

pub const MAX_TAGS: usize = 20;
pub const MAX_TAG_CHARS: usize = 40;

/// A filing number: the day the document was filed (Singapore time) and its number that day.
#[derive(Debug, PartialEq, Eq)]
pub struct Filing {
    /// ISO date, for example 2026-11-05.
    pub date: String,
    pub no: i32,
}

/// Reads `2026-1105_1` (the address form). The `#` of the label `2026-1105_#1` is accepted too,
/// in case it arrives percent-encoded.
pub fn parse_filing(key: &str) -> Option<Filing> {
    let key = key.replace("%23", "").replace('#', "");
    let (date, no) = key.split_once('_')?;
    let (year, monthday) = date.split_once('-')?;
    if year.len() != 4
        || monthday.len() != 4
        || !year.bytes().all(|b| b.is_ascii_digit())
        || !monthday.bytes().all(|b| b.is_ascii_digit())
        || no.is_empty()
        || no.len() > 6
        || !no.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let y: u32 = year.parse().ok()?;
    let m: u32 = monthday[..2].parse().ok()?;
    let d: u32 = monthday[2..].parse().ok()?;
    let no: i32 = no.parse().ok()?;
    if !(2000..=2999).contains(&y) || !(1..=12).contains(&m) || no < 1 {
        return None;
    }
    let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
    let days = match m {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if !(1..=days).contains(&d) {
        return None;
    }
    Some(Filing {
        date: format!("{y:04}-{m:02}-{d:02}"),
        no,
    })
}

/// The label shown to people: `2026-1105_#1` for the address `2026-1105_1`.
pub fn filing_label(key: &str) -> String {
    match key.split_once('_') {
        Some((date, no)) => format!("{date}_#{no}"),
        None => key.to_string(),
    }
}

/// Hashtags typed by a person: `#Lakeside, #2031 trip` becomes `lakeside`, `2031`, `trip`. Letters and
/// digits in any script are kept (and `_`), lowercased; duplicates dropped; at most 20 of 40 chars.
pub fn normalize_tags(input: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for raw in input.split(|c: char| c.is_whitespace() || c == ',' || c == '#' || c == ';') {
        let tag: String = raw
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .flat_map(char::to_lowercase)
            .take(MAX_TAG_CHARS)
            .collect();
        if !tag.is_empty() && !tags.contains(&tag) {
            tags.push(tag);
        }
        if tags.len() == MAX_TAGS {
            break;
        }
    }
    tags
}

const STOPWORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "with",
    "from",
    "your",
    "you",
    "our",
    "this",
    "that",
    "into",
    "over",
    "under",
    "about",
    "after",
    "before",
    "more",
    "less",
    "than",
    "then",
    "them",
    "they",
    "their",
    "there",
    "here",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "why",
    "how",
    "all",
    "any",
    "each",
    "every",
    "some",
    "such",
    "only",
    "own",
    "same",
    "too",
    "very",
    "can",
    "will",
    "just",
    "should",
    "now",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "day",
    "days",
    "night",
    "nights",
    "week",
    "weeks",
    "time",
    "times",
    "page",
    "pages",
    "html",
    "htm",
    "txt",
    "document",
    "doc",
    "docs",
    "file",
    "files",
    "version",
    "draft",
    "final",
    "copy",
    "new",
    "old",
    "untitled",
    "index",
    "home",
    "main",
    "part",
    "plus",
    "also",
    "not",
    "but",
    "are",
    "was",
    "were",
    "been",
    "being",
    "have",
    "has",
    "had",
    "its",
    "his",
    "her",
    "him",
    "she",
    "enough",
    "place",
    "places",
    "easy",
    "gentle",
    "room",
    "keep",
    "simple",
    "good",
    "best",
    "real",
    "get",
    "got",
    "see",
    "open",
    "make",
    "made",
    "take",
    "let",
    "use",
    "used",
    "using",
    "without",
    "within",
    "across",
    "between",
    "through",
    "back",
    "way",
    "ways",
    "first",
    "last",
    "next",
    "still",
    "even",
    "much",
    "many",
    "most",
    "other",
    "others",
    "another",
    "both",
    "few",
    "little",
    "well",
    "like",
    "near",
    "around",
    "again",
    "guide",
    "photos",
    "photo",
    "pictures",
    "picture",
    "notes",
    "note",
    "list",
    "info",
    "information",
    "details",
    "overview",
    "plan",
    "plans",
    "things",
    "thing",
    "lot",
    "lots",
    "per",
    "via",
    "etc",
    "ready",
    "comfortable",
    "together",
    "enjoy",
    "rest",
    "views",
    "view",
    "stops",
    "stop",
    "space",
    "family",
];

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// Up to eight hashtags suggested from a document's title, keywords, description and headings, and
/// its file name. Deterministic; people edit them afterwards.
pub fn suggest_tags(content: &str, kind: &str, filename: &str) -> Vec<String> {
    let parts = if kind == "html" {
        html_parts(content)
    } else {
        text_parts(content)
    };
    let stem = filename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(filename);
    let mut scored: Vec<(String, u32, usize)> = Vec::new();
    let mut order = 0usize;
    let mut add = |tag: String, weight: u32, scored: &mut Vec<(String, u32, usize)>| {
        if let Some(entry) = scored.iter_mut().find(|e| e.0 == tag) {
            entry.1 += weight;
        } else {
            scored.push((tag, weight, order));
            order += 1;
        }
    };
    for keyword in &parts.keywords {
        let tag = normalize_tags(&keyword.replace(' ', ""));
        if let Some(tag) = tag.into_iter().next() {
            add(tag, 4, &mut scored);
        }
    }
    // File names are usually capitalised word by word, so only real text forms pairs.
    let stem_words = [stem.replace(['-', '_', '.'], " ")];
    let sources: [(&[String], u32, bool); 5] = [
        (&parts.title, 3, true),
        (&parts.h1, 3, true),
        (&stem_words, 2, false),
        (&parts.description, 2, true),
        (&parts.h2, 1, true),
    ];
    let mut joined: Vec<String> = Vec::new();
    for (texts, weight, pairs) in sources {
        for text in texts {
            for (tag, w, parts_used) in candidates(text, pairs) {
                joined.extend(parts_used);
                add(tag, weight * w, &mut scored);
            }
        }
    }
    // A pair such as "Lake Town" beats its separate words.
    scored.retain(|(tag, _, _)| !joined.contains(tag));
    scored.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)));
    scored
        .into_iter()
        .filter(|(_, score, _)| *score >= 2)
        .take(8)
        .map(|(tag, _, _)| tag)
        .collect()
}

/// Candidate tags in one piece of text: (tag, weight, words that a joined pair replaces).
fn candidates(text: &str, pairs: bool) -> Vec<(String, u32, Vec<String>)> {
    // Pairs never cross punctuation: "Rome, Paris" is two places, not one.
    text.split(|c: char| !(c.is_alphanumeric() || c.is_whitespace()))
        .flat_map(|clause| clause_candidates(clause, pairs))
        .collect()
}

fn clause_candidates(clause: &str, pairs: bool) -> Vec<(String, u32, Vec<String>)> {
    let words: Vec<&str> = clause.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let word = words[i];
        let lower = word.to_lowercase();
        let next = words.get(i + 1);
        // Month and year: "March 2027" becomes march2027.
        if let Some(month) = MONTHS.iter().find(|m| **m == lower)
            && let Some(year) = next.filter(|n| is_year(n))
        {
            out.push((format!("{month}{year}"), 1, vec![lower.clone()]));
            i += 2;
            continue;
        }
        // Two capitalised words together: a place or a name.
        if pairs
            && let Some(next) = next
            && starts_upper(word)
            && starts_upper(next)
            && keep_word(&lower)
            && keep_word(&next.to_lowercase())
        {
            let second = next.to_lowercase();
            out.push((
                format!("{lower}{second}"),
                1,
                vec![lower.clone(), second.clone()],
            ));
            i += 2;
            continue;
        }
        if is_year(word) {
            out.push((word.to_string(), 1, vec![]));
        } else if keep_word(&lower) {
            out.push((lower, 1, vec![]));
        }
        i += 1;
    }
    out
}

fn is_year(word: &str) -> bool {
    word.len() == 4 && word.starts_with("20") && word.bytes().all(|b| b.is_ascii_digit())
}

fn starts_upper(word: &str) -> bool {
    word.chars().next().is_some_and(char::is_uppercase)
}

fn keep_word(lower: &str) -> bool {
    let ascii = lower.is_ascii();
    let long_enough = if ascii {
        lower.len() >= 3
    } else {
        lower.chars().count() >= 2
    };
    long_enough
        && lower.chars().count() <= MAX_TAG_CHARS
        && !lower.chars().any(|c| c.is_ascii_digit())
        && !STOPWORDS.contains(&lower)
}

#[derive(Default)]
struct Parts {
    title: Vec<String>,
    keywords: Vec<String>,
    description: Vec<String>,
    h1: Vec<String>,
    h2: Vec<String>,
}

fn html_parts(html: &str) -> Parts {
    let lower = html.to_ascii_lowercase();
    let mut parts = Parts {
        title: element_texts(html, &lower, "title", 1),
        h1: element_texts(html, &lower, "h1", 3),
        h2: element_texts(html, &lower, "h2", 12),
        ..Parts::default()
    };
    for tag in start_tags(html, &lower, "meta") {
        let name = attr(tag, "name").unwrap_or_default().to_ascii_lowercase();
        let content = decode_entities(&attr(tag, "content").unwrap_or_default());
        match name.as_str() {
            "keywords" => parts.keywords.extend(
                content
                    .split(',')
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .take(10),
            ),
            "description" => parts.description.push(content),
            _ => {}
        }
    }
    parts
}

fn text_parts(text: &str) -> Parts {
    let mut parts = Parts::default();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(400)
    {
        if let Some(h) = line.strip_prefix("## ") {
            parts.h2.push(h.to_string());
        } else if let Some(h) = line.strip_prefix("# ") {
            parts.h1.push(h.to_string());
        } else if parts.title.is_empty() {
            parts.title.push(line.chars().take(200).collect());
        }
    }
    parts
}

/// Each start tag `<name ...>` (the text between `<` and `>`), found case-insensitively.
fn start_tags<'a>(html: &'a str, lower: &str, name: &str) -> Vec<&'a str> {
    let needle = format!("<{name}");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find(&needle) {
        let start = from + pos;
        let after = start + needle.len();
        let boundary = lower[after..]
            .chars()
            .next()
            .is_some_and(|c| c.is_whitespace() || c == '>' || c == '/');
        let end = lower[after..]
            .find('>')
            .map(|e| after + e)
            .unwrap_or(lower.len());
        if boundary {
            found.push(&html[start + 1..end]);
        }
        from = end.max(after);
        if found.len() > 5000 {
            break;
        }
    }
    found
}

/// An attribute's value from a start tag's text, quoted or not.
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(pos) = lower[from..].find(name) {
        let start = from + pos;
        let before_ok = start == 0
            || lower[..start]
                .chars()
                .last()
                .is_some_and(|c| c.is_whitespace() || c == '"' || c == '\'');
        let mut rest = lower[start + name.len()..].char_indices();
        let mut eq = None;
        for (i, c) in rest.by_ref() {
            if c == '=' {
                eq = Some(start + name.len() + i + 1);
                break;
            }
            if !c.is_whitespace() {
                break;
            }
        }
        if before_ok && let Some(value_start) = eq {
            let value = tag[value_start..].trim_start();
            return Some(match value.chars().next() {
                Some(q @ ('"' | '\'')) => value[1..].split(q).next().unwrap_or("").to_string(),
                _ => value
                    .split(|c: char| c.is_whitespace() || c == '>')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            });
        }
        from = start + name.len();
    }
    None
}

/// The plain text of up to `limit` elements such as `<h1>...</h1>`.
fn element_texts(html: &str, lower: &str, name: &str, limit: usize) -> Vec<String> {
    let open = format!("<{name}");
    let close = format!("</{name}");
    let mut out = Vec::new();
    let mut from = 0;
    while out.len() < limit {
        let Some(pos) = lower[from..].find(&open) else {
            break;
        };
        let start = from + pos;
        let after = start + open.len();
        if !lower[after..]
            .chars()
            .next()
            .is_some_and(|c| c.is_whitespace() || c == '>')
        {
            from = after;
            continue;
        }
        let Some(gt) = lower[after..].find('>') else {
            break;
        };
        let body_start = after + gt + 1;
        let Some(end) = lower[body_start..].find(&close) else {
            break;
        };
        let inner = &html[body_start..body_start + end];
        // Line breaks inside headings separate words ("the<br>hills" is two words).
        let spaced = inner.replace("<br", " <br");
        let text = decode_entities(&strip_tags(&spaced));
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() {
            out.push(text);
        }
        from = body_start + end;
    }
    out
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut inside = false;
    for c in html.chars() {
        match c {
            '<' => inside = true,
            '>' => {
                inside = false;
                out.push(' ');
            }
            _ if !inside => out.push(c),
            _ => {}
        }
    }
    out
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let Some(semi) = tail[..tail.len().min(12)].find(';') else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "rsquo" | "lsquo" => Some('\''),
            "ndash" | "mdash" => Some('-'),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// What the upload check found in one HTML file.
#[derive(Debug, Default, PartialEq)]
pub struct Check {
    pub libraries: Vec<String>,
    pub style_guess: Option<String>,
    pub warnings: Vec<String>,
    pub field_count: i32,
}

/// The upload check for an HTML file (text files have nothing to check).
pub fn check_html(html: &str) -> Check {
    let lower = html.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));
    let mut check = Check::default();
    let libraries: [(&str, &[&str]); 7] = [
        (
            "Three.js",
            &[
                "three@",
                "three.module",
                "three.min.js",
                "three.webglrenderer",
                "from 'three'",
                "from \"three\"",
                "\"three\":",
                "three/addons",
                "three/examples",
            ],
        ),
        (
            "GSAP",
            &[
                "gsap.min.js",
                "gsap@",
                "/gsap/",
                "gsap.to(",
                "gsap.from(",
                "gsap.timeline(",
                "gsap.registerplugin(",
                "from 'gsap'",
                "from \"gsap\"",
                "\"gsap\":",
            ],
        ),
        ("ScrollTrigger", &["scrolltrigger"]),
        ("MotionPathPlugin", &["motionpathplugin"]),
        ("SplitText", &["splittext"]),
        (
            "Lenis",
            &[
                "lenis@",
                "lenis.min.js",
                "new lenis(",
                "@studio-freight/lenis",
                "from 'lenis'",
                "from \"lenis\"",
                "\"lenis\":",
            ],
        ),
        (
            "Tailwind CSS",
            &[
                "cdn.tailwindcss.com",
                "@tailwindcss/browser",
                "tailwindcss@",
            ],
        ),
    ];
    for (name, needles) in libraries {
        if has(needles) {
            check.libraries.push(name.to_string());
        }
    }

    let mut blocked_scripts: Vec<String> = Vec::new();
    let mut blocked_styles: Vec<String> = Vec::new();
    let mut insecure = false;
    let mut local: Vec<String> = Vec::new();
    let note_local = |value: &str, local: &mut Vec<String>| {
        let value = value.trim();
        let name: String = value.chars().take(80).collect();
        if is_relative(value) && !local.contains(&name) {
            local.push(name);
        }
    };
    for tag in start_tags(html, &lower, "script") {
        if let Some(src) = attr(tag, "src") {
            classify_url(&src, &SCRIPT_HOSTS, &mut blocked_scripts, &mut insecure);
            note_local(&src, &mut local);
        }
    }
    for tag in start_tags(html, &lower, "link") {
        let rel = attr(tag, "rel").unwrap_or_default().to_ascii_lowercase();
        if rel.split_whitespace().any(|r| r == "stylesheet")
            && let Some(href) = attr(tag, "href")
        {
            classify_url(&href, &STYLE_HOSTS, &mut blocked_styles, &mut insecure);
            note_local(&href, &mut local);
        }
    }
    for name in ["img", "video", "audio", "source", "track", "embed"] {
        for tag in start_tags(html, &lower, name) {
            for key in ["src", "poster"] {
                if let Some(value) = attr(tag, key) {
                    if value
                        .trim_start()
                        .to_ascii_lowercase()
                        .starts_with("http://")
                    {
                        insecure = true;
                    }
                    note_local(&value, &mut local);
                }
            }
        }
    }
    // Module imports and import maps load scripts too.
    for marker in [
        "from \"",
        "from '",
        "import(\"",
        "import('",
        "import \"",
        "import '",
    ] {
        let mut from = 0;
        while let Some(pos) = lower[from..].find(marker) {
            let start = from + pos + marker.len();
            let end = lower[start..]
                .find(['"', '\''])
                .map(|e| start + e)
                .unwrap_or(start);
            let url = &html[start..end];
            if url.contains("://") || url.starts_with("//") {
                classify_url(url, &SCRIPT_HOSTS, &mut blocked_scripts, &mut insecure);
            }
            from = end.max(start);
        }
    }
    for tag_start in lower.match_indices("type=\"importmap\"").map(|(i, _)| i) {
        if let Some(body_start) = lower[tag_start..].find('>').map(|i| tag_start + i + 1) {
            let body_end = lower[body_start..]
                .find("</script")
                .map(|i| body_start + i)
                .unwrap_or(lower.len());
            for (i, _) in lower[body_start..body_end].match_indices("https://") {
                let start = body_start + i;
                let end = lower[start..]
                    .find(['"', '\''])
                    .map(|e| start + e)
                    .unwrap_or(body_end);
                classify_url(
                    &html[start..end],
                    &SCRIPT_HOSTS,
                    &mut blocked_scripts,
                    &mut insecure,
                );
            }
        }
    }
    // 3D models and videos named inside scripts.
    for ext in [
        ".glb", ".gltf", ".mp4", ".webm", ".mov", ".hdr", ".obj", ".fbx",
    ] {
        for quote in ['"', '\''] {
            let needle = format!("{ext}{quote}");
            for (i, _) in lower.match_indices(&needle) {
                let end = i + ext.len();
                let start = lower[..i].rfind(quote).map(|s| s + 1).unwrap_or(i);
                let value = &html[start..end];
                if end - start < 200 && !value.contains(char::is_whitespace) {
                    note_local(value, &mut local);
                }
            }
        }
    }

    if lower.contains("__next_data__") || lower.contains("/_next/static") {
        check.libraries.push("Next.js".to_string());
        check.warnings.push(
            "Built as a Next.js app: that is many files, and only this one was uploaded, so parts will be missing. Export it as a single HTML file instead."
                .to_string(),
        );
    }
    if !blocked_scripts.is_empty() {
        check.warnings.push(format!(
            "Scripts from {} are blocked in the frame. Scripts can come from {}.",
            blocked_scripts.join(", "),
            SCRIPT_HOSTS.join(", ")
        ));
    }
    if !blocked_styles.is_empty() {
        check.warnings.push(format!(
            "Stylesheets from {} are blocked in the frame. Stylesheets can come from {}.",
            blocked_styles.join(", "),
            STYLE_HOSTS.join(", ")
        ));
    }
    if insecure {
        check.warnings.push(
            "Some files are linked with http:// instead of https://, so browsers will not load them."
                .to_string(),
        );
    }
    if !local.is_empty() {
        let shown: Vec<&str> = local.iter().take(5).map(String::as_str).collect();
        let more = if local.len() > 5 {
            format!(" and {} more", local.len() - 5)
        } else {
            String::new()
        };
        check.warnings.push(format!(
            "This page refers to files that were not part of the upload, so they will not load: {}{more}.",
            shown.join(", ")
        ));
    }
    let fetch_hosts = other_fetch_hosts(html, &lower);
    if !fetch_hosts.is_empty() {
        check.warnings.push(format!(
            "Calls to {} are blocked; documents can only fetch from {}.",
            fetch_hosts.join(", "),
            CONNECT_HOSTS.join(", ")
        ));
    }
    if has(&["localstorage", "sessionstorage", "indexeddb"]) {
        check.warnings.push(
            "This page saves things in browser storage, which the locked frame blocks, so that part may not work yet."
                .to_string(),
        );
    }
    if !start_tags(html, &lower, "iframe").is_empty() {
        check.warnings.push(
            "Embedded frames (for example maps or videos from other sites) are blocked; links to them still work."
                .to_string(),
        );
    }
    if start_tags(html, &lower, "form")
        .iter()
        .any(|t| attr(t, "action").is_some_and(|a| !a.trim().is_empty()))
    {
        check
            .warnings
            .push("Sending this page's forms to another site is blocked.".to_string());
    }

    let mut fields = start_tags(html, &lower, "input")
        .iter()
        .filter(|t| {
            let kind = attr(t, "type").unwrap_or_default().to_ascii_lowercase();
            !matches!(
                kind.as_str(),
                "hidden" | "password" | "file" | "submit" | "button" | "reset" | "image"
            )
        })
        .count();
    fields += start_tags(html, &lower, "textarea").len();
    fields += start_tags(html, &lower, "select").len();
    check.field_count = fields.min(i32::MAX as usize) as i32;
    let custom =
        lower.matches("role=\"checkbox\"").count() + lower.matches("role=\"switch\"").count();
    if custom > 0 {
        check.warnings.push(format!(
            "{custom} control{} drawn as a checkbox without a real form field; {} state cannot be saved.",
            if custom == 1 { " is" } else { "s are" },
            if custom == 1 { "its" } else { "their" }
        ));
    }

    check.style_guess = style_guess(&lower, &check.libraries);
    check
}

fn is_relative(value: &str) -> bool {
    let v = value.trim().to_ascii_lowercase();
    !(v.is_empty()
        || v.starts_with("http:")
        || v.starts_with("https:")
        || v.starts_with("//")
        || v.starts_with("data:")
        || v.starts_with("blob:")
        || v.starts_with('#')
        || v.starts_with("mailto:")
        || v.starts_with("tel:")
        || v.starts_with("javascript:")
        || v.starts_with("about:")
        || v.starts_with("${")
        || v.contains('{'))
}

fn host_of(url: &str) -> Option<(String, bool)> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let (rest, secure) = if let Some(r) = lower.strip_prefix("https://") {
        (r, true)
    } else if let Some(r) = lower.strip_prefix("http://") {
        (r, false)
    } else {
        (lower.strip_prefix("//")?, true)
    };
    let host: String = rest
        .chars()
        .take_while(|c| !matches!(c, '/' | '?' | '#' | ':' | '"' | '\''))
        .collect();
    (!host.is_empty()).then_some((host, secure))
}

fn classify_url(url: &str, allowed: &[&str], blocked: &mut Vec<String>, insecure: &mut bool) {
    if let Some((host, secure)) = host_of(url) {
        if !secure {
            *insecure = true;
        } else if !allowed.contains(&host.as_str()) && !blocked.contains(&host) {
            blocked.push(host);
        }
    }
}

fn other_fetch_hosts(html: &str, lower: &str) -> Vec<String> {
    let mut hosts = Vec::new();
    for marker in [
        "fetch(\"",
        "fetch('",
        "fetch(`",
        ".open(\"get\", \"",
        ".open('get', '",
    ] {
        for (i, _) in lower.match_indices(marker) {
            let start = i + marker.len();
            let end = (start + 200).min(html.len());
            let Some(slice) = html.get(start..end) else {
                continue;
            };
            if let Some((host, _)) = host_of(slice)
                && !CONNECT_HOSTS.contains(&host.as_str())
                && !hosts.contains(&host)
            {
                hosts.push(host);
            }
        }
    }
    hosts
}

/// The closest of the owner's design styles A to E, or None when nothing is clear. A rough guess
/// from what the file contains; it is shown as a guess.
fn style_guess(lower: &str, libraries: &[String]) -> Option<String> {
    let has = |n: &str| lower.contains(n);
    let lib = |n: &str| libraries.iter().any(|l| l == n);
    let three = lib("Three.js");
    let mut scores = [0u32; 5];
    // A: editorial portfolio.
    scores[0] += 2 * ["#f5f0e8", "#141413", "#d9381e"]
        .iter()
        .filter(|c| has(c))
        .count() as u32;
    scores[0] += u32::from(lib("SplitText"))
        + u32::from(has("marquee") || has("ticker"))
        + u32::from(has("magnetic"))
        + u32::from(has("preloader"));
    // B: curved 3D gallery.
    if three {
        scores[1] += u32::from(has("cylindergeometry") || has("spheregeometry"))
            + u32::from(has("planegeometry"))
            + u32::from(has("pointermove") || has("mousemove"))
            + u32::from(has("wheel"))
            + u32::from(has("gallery"));
    }
    // C: scroll-driven isometric storytelling.
    if three {
        scores[2] += 2 * u32::from(has("orthographiccamera"))
            + u32::from(lib("ScrollTrigger"))
            + 2 * u32::from(has("unrealbloompass") || has("bloom"))
            + u32::from(has("emissive"))
            + u32::from(has("tubegeometry") || has("catmullromcurve3"));
    }
    // D: high-density directory.
    let links = lower.matches("<a ").count() + lower.matches("<a\n").count();
    scores[3] += 2 * u32::from(links >= 60)
        + u32::from(links >= 150)
        + u32::from(has("1px solid"))
        + u32::from(has("badge") || has("count"));
    // E: conversion hero.
    scores[4] += u32::from(has("hero"))
        + u32::from(has("cta"))
        + u32::from(has("avatar"))
        + u32::from(has("rating") || has("★"))
        + u32::from(has("get started") || has("start free") || has("sign up"));
    let names = [
        "A · Editorial portfolio",
        "B · Curved 3D gallery",
        "C · 3D isometric storytelling",
        "D · High-density directory",
        "E · Conversion hero",
    ];
    let (best, score) = scores
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(&a.0)))?;
    (*score >= 3).then(|| names[best].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filing_numbers_parse_and_label() {
        assert_eq!(
            parse_filing("2026-1105_1"),
            Some(Filing {
                date: "2026-11-05".into(),
                no: 1
            })
        );
        assert_eq!(parse_filing("2026-1105_%231").map(|f| f.no), Some(1));
        assert_eq!(parse_filing("2028-0229_12").map(|f| f.no), Some(12));
        for bad in [
            "2027-0229_1",
            "2026-1305_1",
            "2026-1100_1",
            "2026-0431_1",
            "2026-1105_0",
            "2026-1105_",
            "2026-115_1",
            "26-1105_1",
            "1",
            "2026-1105_1x",
            "2026-1105_-1",
        ] {
            assert_eq!(parse_filing(bad), None, "{bad}");
        }
        assert_eq!(filing_label("2026-1105_1"), "2026-1105_#1");
    }

    #[test]
    fn typed_hashtags_are_normalised() {
        assert_eq!(
            normalize_tags("#Lakeside, #2031  trip;#lakeside #家庭 #a-b"),
            vec!["lakeside", "2031", "trip", "家庭", "ab"]
        );
        assert!(normalize_tags("# , ##").is_empty());
        let many: String = (0..30).map(|i| format!("#t{i} ")).collect();
        assert_eq!(normalize_tags(&many).len(), MAX_TAGS);
        assert_eq!(
            normalize_tags(&"x".repeat(60))[0].chars().count(),
            MAX_TAG_CHARS
        );
    }

    #[test]
    fn hashtags_are_suggested_from_the_document() {
        let html = r#"<html><head><title>Lake Town &amp; the hills</title>
<meta name="description" content="A slow April 2031 week in Lake Town and Green Valley for the Example family.">
<meta name="keywords" content="Lakes, Hiking trips"></head>
<body><h1>Lake Town &amp; the<br>quiet hills.</h1><h2>Green Valley walks</h2><h2>Where to stay</h2></body></html>"#;
        let tags = suggest_tags(html, "html", "Example-Lake-Town-April-2031.html");
        let listed = suggest_tags("<title>Rome, Paris and Lake Town</title>", "html", "x.html");
        assert!(listed.contains(&"rome".to_string()) && listed.contains(&"laketown".to_string()));
        assert!(!listed.contains(&"romeparis".to_string()), "{listed:?}");
        for expected in [
            "laketown",
            "april2031",
            "greenvalley",
            "lakes",
            "hikingtrips",
        ] {
            assert!(
                tags.contains(&expected.to_string()),
                "{expected} in {tags:?}"
            );
        }
        assert!(!tags.contains(&"the".to_string()) && !tags.contains(&"lake".to_string()));
        assert!(tags.len() <= 8);
        let text = suggest_tags(
            "# Garden notes\n## Tomatoes\nwater daily",
            "text",
            "garden.md",
        );
        assert!(text.contains(&"garden".to_string()), "{text:?}");
        assert!(suggest_tags("", "html", "a.html").is_empty());
    }

    #[test]
    fn the_check_finds_the_design_stack() {
        let html = r#"<!doctype html><html><head>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="https://cdn.example.net/lib.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="stylesheet" href="styles.css">
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","lenis":"https://esm.example.org/lenis"}}</script>
</head><body>
<input type="checkbox" id="a"><input type="text"><input type="hidden"><input type="password"><select></select><textarea></textarea>
<div role="checkbox" aria-checked="false"></div>
<script type="module">
import * as THREE from 'three';
const cam = new THREE.OrthographicCamera(); const m = { emissive: 1 };
new GLTFLoader().load('models/city.glb');
fetch("https://api.example.com/x"); fetch("https://unpkg.com/a.json");
localStorage.setItem('k', 'v');
</script></body></html>"#;
        let check = check_html(html);
        assert_eq!(
            check.libraries,
            vec!["Three.js", "GSAP", "ScrollTrigger", "Lenis"]
        );
        let all = check.warnings.join("\n");
        assert!(
            all.contains("cdn.example.net") && all.contains("esm.example.org"),
            "{all}"
        );
        assert!(!all.contains("Scripts from cdn.jsdelivr.net"), "{all}");
        assert!(
            all.contains("styles.css") && all.contains("models/city.glb"),
            "{all}"
        );
        assert!(
            all.contains("api.example.com") && !all.contains("Calls to unpkg.com"),
            "{all}"
        );
        assert!(all.contains("browser storage"), "{all}");
        assert!(all.contains("1 control is drawn as a checkbox"), "{all}");
        assert_eq!(check.field_count, 4, "checkbox, text, select, textarea");
        assert_eq!(
            check.style_guess.as_deref(),
            Some("C · 3D isometric storytelling")
        );
    }

    #[test]
    fn a_self_contained_page_has_no_warnings() {
        let html = r##"<html><head><style>body{color:#123}</style></head><body><h1>Hi</h1>
<img src="https://example.org/p.jpg"><a href="https://example.org">x</a><a href="#top">top</a>
<input type="checkbox"><script>document.body.dataset.ok = 1;</script></body></html>"##;
        let check = check_html(html);
        assert!(
            check.libraries.is_empty() && check.warnings.is_empty(),
            "{check:?}"
        );
        assert_eq!(check.field_count, 1);
        assert_eq!(check.style_guess, None);
        assert!(
            check_html("<a href='http://x.org'>x</a><img src='http://x.org/a.png'>")
                .warnings
                .iter()
                .any(|w| w.contains("http://"))
        );
        let next = check_html(
            r#"<script id="__NEXT_DATA__"></script><script src="/_next/static/a.js"></script>"#,
        );
        assert!(next.libraries.contains(&"Next.js".to_string()));
    }

    #[test]
    fn attributes_and_entities() {
        assert_eq!(
            attr(r#"script src="a.js" defer"#, "src").as_deref(),
            Some("a.js")
        );
        assert_eq!(
            attr("img data-src='x' src=y.png", "src").as_deref(),
            Some("y.png")
        );
        assert_eq!(attr("img data-src='x'", "src"), None);
        assert_eq!(
            decode_entities("a &amp; b &#39;c&#x27; &bogus; &"),
            "a & b 'c' &bogus; &"
        );
    }
}
