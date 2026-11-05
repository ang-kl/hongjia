//! D4: redaction. The document's uploader or the owner marks passages (kind `redaction`), then
//! applies them: a new version is made from the latest stored HTML or text with every marked
//! passage blacked out, and every older version is deleted for good (there are no backups).
//!
//! The passages are found in the stored file itself, not in what a browser drew: the file is read
//! as the browser reads it (text of the page body only; never inside tags, attributes, comments,
//! scripts, styles, text areas or templates; character references such as `&amp;` decoded), so a
//! passage people selected in the frame is found where it really is. The words saved before and
//! after a passage pick the right place when the same words appear more than once. When any
//! passage cannot be found in the file (for example, a page's own script wrote it), or two places
//! fit equally well, nothing is applied and the person is told why.
//!
//! Blacking out keeps the length: each letter, digit or sign becomes `█`, and spaces and line
//! breaks stay, so long passages still wrap. The page's text keeps the same number of characters,
//! so the other marks on the document keep their places and have the blacked-out words replaced
//! in what they saved (their quote and the words before and after it).

use super::documents::{self, DocumentRow};
use super::store::Session;
use super::{FamilyState, doccheck};
use axum::{
    Form,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;

/// What a person types to confirm applying the redactions.
pub const REDACT_WORD: &str = "REDACT";
/// The block every redacted character becomes.
pub const BLOCK: char = '█';
/// Places a passage is looked for, at most (a guard against pathological files).
const MAX_PLACES: usize = 20_000;

/// The text of a stored file as a page's scripts see it, with where each character came from.
#[derive(Debug, Default)]
pub struct TextModel {
    pub chars: Vec<char>,
    /// The byte range of the source each character came from. A character reference (`&amp;`)
    /// is one range for its character; a line break written as CR LF is one range too.
    pub spans: Vec<(usize, usize)>,
}

impl TextModel {
    fn push(&mut self, c: char, start: usize, end: usize) {
        self.chars.push(c);
        self.spans.push((start, end));
    }
    pub fn text(&self) -> String {
        self.chars.iter().collect()
    }
}

/// A plain text file: every character as it is.
pub fn text_model(source: &str) -> TextModel {
    let mut model = TextModel::default();
    for (at, c) in source.char_indices() {
        model.push(c, at, at + c.len_utf8());
    }
    model
}

/// Elements whose content is not part of the page's text for scripts and selections, as the
/// helper skips them: scripts, styles, text areas, titles, `noscript` and templates.
const SKIPPED: [&str; 6] = [
    "script", "style", "textarea", "title", "noscript", "template",
];
/// Elements whose content a browser keeps as written (no character references, no tags inside),
/// and which the helper does count as text.
const RAW_SHOWN: [&str; 5] = ["xmp", "iframe", "noembed", "noframes", "plaintext"];
/// Elements that belong in the head; their tags do not start the body.
const HEAD_TAGS: [&str; 9] = [
    "html", "head", "meta", "link", "base", "title", "style", "script", "noscript",
];

fn starts_with_ci(bytes: &[u8], at: usize, needle: &[u8]) -> bool {
    bytes.len() >= at + needle.len() && bytes[at..at + needle.len()].eq_ignore_ascii_case(needle)
}

fn find_from(bytes: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || from >= bytes.len() {
        return None;
    }
    bytes[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| from + i)
}

/// The end (one past `>`) of a tag whose name starts at `at`, honouring quoted attribute values.
/// Also returns the tag's name in lowercase.
fn tag_end(bytes: &[u8], at: usize) -> (usize, String) {
    let mut i = at;
    while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'/' && bytes[i] != b'>'
    {
        i += 1;
    }
    let name = String::from_utf8_lossy(&bytes[at..i]).to_ascii_lowercase();
    // Attributes: a name, then perhaps `=` and a value, quoted or not.
    loop {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        if i >= bytes.len() {
            return (bytes.len(), name);
        }
        if bytes[i] == b'>' {
            return (i + 1, name);
        }
        // The attribute's name (a quote here is part of the name, as in a browser).
        i += 1;
        while i < bytes.len()
            && !bytes[i].is_ascii_whitespace()
            && !matches!(bytes[i], b'/' | b'>' | b'=')
        {
            i += 1;
        }
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let quote = bytes[i];
                i = match bytes[i + 1..].iter().position(|&b| b == quote) {
                    Some(j) => i + 1 + j + 1,
                    None => bytes.len(),
                };
            } else {
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                    i += 1;
                }
            }
        }
    }
}

/// Where the content of a raw element ends: at its end tag (`</script`), and just past it.
fn raw_content(bytes: &[u8], from: usize, name: &str) -> (usize, usize) {
    if name == "plaintext" {
        return (bytes.len(), bytes.len());
    }
    let close = format!("</{name}");
    let mut i = from;
    while let Some(at) = bytes[i.min(bytes.len())..]
        .iter()
        .position(|&b| b == b'<')
        .map(|p| i + p)
    {
        if starts_with_ci(bytes, at, close.as_bytes()) {
            let after = at + close.len();
            if after >= bytes.len()
                || bytes[after].is_ascii_whitespace()
                || matches!(bytes[after], b'/' | b'>')
            {
                return (at, tag_end(bytes, at + 2).0);
            }
        }
        i = at + 1;
    }
    (bytes.len(), bytes.len())
}

/// Named character references the model decodes. A name not listed is left as written, so a
/// passage across it is not found and nothing is applied (never a wrong place).
const NAMED: &[(&str, &str)] = &[
    ("amp", "&"),
    ("lt", "<"),
    ("gt", ">"),
    ("quot", "\""),
    ("apos", "'"),
    ("nbsp", "\u{a0}"),
    ("ensp", "\u{2002}"),
    ("emsp", "\u{2003}"),
    ("thinsp", "\u{2009}"),
    ("zwnj", "\u{200c}"),
    ("zwj", "\u{200d}"),
    ("lrm", "\u{200e}"),
    ("rlm", "\u{200f}"),
    ("shy", "\u{ad}"),
    ("ndash", "\u{2013}"),
    ("mdash", "\u{2014}"),
    ("lsquo", "‘"),
    ("rsquo", "’"),
    ("sbquo", "‚"),
    ("ldquo", "“"),
    ("rdquo", "”"),
    ("bdquo", "„"),
    ("laquo", "«"),
    ("raquo", "»"),
    ("lsaquo", "‹"),
    ("rsaquo", "›"),
    ("hellip", "…"),
    ("bull", "•"),
    ("middot", "·"),
    ("prime", "′"),
    ("Prime", "″"),
    ("dagger", "†"),
    ("Dagger", "‡"),
    ("permil", "‰"),
    ("copy", "©"),
    ("reg", "®"),
    ("trade", "™"),
    ("deg", "°"),
    ("plusmn", "±"),
    ("times", "×"),
    ("divide", "÷"),
    ("minus", "−"),
    ("frac12", "½"),
    ("frac14", "¼"),
    ("frac34", "¾"),
    ("sup1", "¹"),
    ("sup2", "²"),
    ("sup3", "³"),
    ("micro", "µ"),
    ("para", "¶"),
    ("sect", "§"),
    ("cent", "¢"),
    ("pound", "£"),
    ("yen", "¥"),
    ("euro", "€"),
    ("curren", "¤"),
    ("iexcl", "¡"),
    ("iquest", "¿"),
    ("ordf", "ª"),
    ("ordm", "º"),
    ("not", "¬"),
    ("macr", "¯"),
    ("acute", "´"),
    ("cedil", "¸"),
    ("uml", "¨"),
    ("larr", "←"),
    ("rarr", "→"),
    ("uarr", "↑"),
    ("darr", "↓"),
    ("harr", "↔"),
    ("lArr", "⇐"),
    ("rArr", "⇒"),
    ("hArr", "⇔"),
    ("le", "≤"),
    ("ge", "≥"),
    ("ne", "≠"),
    ("asymp", "≈"),
    ("infin", "∞"),
    ("check", "✓"),
    ("star", "☆"),
    ("hearts", "♥"),
    ("Agrave", "À"),
    ("Aacute", "Á"),
    ("Acirc", "Â"),
    ("Atilde", "Ã"),
    ("Auml", "Ä"),
    ("Aring", "Å"),
    ("AElig", "Æ"),
    ("Ccedil", "Ç"),
    ("Egrave", "È"),
    ("Eacute", "É"),
    ("Ecirc", "Ê"),
    ("Euml", "Ë"),
    ("Iacute", "Í"),
    ("Iuml", "Ï"),
    ("Ntilde", "Ñ"),
    ("Oacute", "Ó"),
    ("Ocirc", "Ô"),
    ("Ouml", "Ö"),
    ("Oslash", "Ø"),
    ("Uacute", "Ú"),
    ("Uuml", "Ü"),
    ("szlig", "ß"),
    ("agrave", "à"),
    ("aacute", "á"),
    ("acirc", "â"),
    ("atilde", "ã"),
    ("auml", "ä"),
    ("aring", "å"),
    ("aelig", "æ"),
    ("ccedil", "ç"),
    ("egrave", "è"),
    ("eacute", "é"),
    ("ecirc", "ê"),
    ("euml", "ë"),
    ("igrave", "ì"),
    ("iacute", "í"),
    ("icirc", "î"),
    ("iuml", "ï"),
    ("ntilde", "ñ"),
    ("ograve", "ò"),
    ("oacute", "ó"),
    ("ocirc", "ô"),
    ("otilde", "õ"),
    ("ouml", "ö"),
    ("oslash", "ø"),
    ("ugrave", "ù"),
    ("uacute", "ú"),
    ("ucirc", "û"),
    ("uuml", "ü"),
    ("yacute", "ý"),
];
/// Old names a browser also reads without the closing semicolon.
const LEGACY: [&str; 7] = ["amp", "lt", "gt", "quot", "nbsp", "copy", "reg"];

/// What a browser makes of `&#128;` to `&#159;` (Windows-1252), and of other numbers.
fn numeric(value: u32) -> char {
    const W1252: [u32; 32] = [
        0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039,
        0x152, 0x8D, 0x17D, 0x8F, 0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
        0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178,
    ];
    let value = match value {
        0x80..=0x9F => W1252[(value - 0x80) as usize],
        0 => 0xFFFD,
        v => v,
    };
    char::from_u32(value).unwrap_or('\u{FFFD}')
}

/// A character reference at `at` (which holds `&`): its characters and its length in bytes.
fn reference(bytes: &[u8], at: usize) -> Option<(String, usize)> {
    let rest = &bytes[at + 1..];
    if rest.first() == Some(&b'#') {
        let (hex, digits_from) = match rest.get(1) {
            Some(b'x' | b'X') => (true, 2),
            _ => (false, 1),
        };
        let digits = rest[digits_from..]
            .iter()
            .take(8)
            .take_while(|b| {
                if hex {
                    b.is_ascii_hexdigit()
                } else {
                    b.is_ascii_digit()
                }
            })
            .count();
        if digits == 0 {
            return None;
        }
        let text = std::str::from_utf8(&rest[digits_from..digits_from + digits]).ok()?;
        let value = u32::from_str_radix(text, if hex { 16 } else { 10 }).unwrap_or(0x110000);
        let semi = usize::from(rest.get(digits_from + digits) == Some(&b';'));
        return Some((numeric(value).to_string(), 1 + digits_from + digits + semi));
    }
    let name_len = rest
        .iter()
        .take(32)
        .take_while(|b| b.is_ascii_alphanumeric())
        .count();
    if name_len == 0 {
        return None;
    }
    let name = std::str::from_utf8(&rest[..name_len]).ok()?;
    if rest.get(name_len) == Some(&b';') {
        return NAMED
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| (v.to_string(), name_len + 2));
    }
    // `&copy` and friends without a semicolon, when not followed by `=` (as in a link's query).
    let next = rest.get(name_len).copied().unwrap_or(b' ');
    if LEGACY.contains(&name) && next != b'=' {
        return NAMED
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| (v.to_string(), name_len + 1));
    }
    None
}

/// Text between tags, appended to the model: decoded, or as written inside a raw element.
fn push_text(
    model: &mut TextModel,
    source: &str,
    (from, to): (usize, usize),
    drop_first_newline: bool,
    decode: bool,
) {
    let bytes = source.as_bytes();
    let mut i = from;
    if drop_first_newline {
        if starts_with_ci(bytes, i, b"\r\n") {
            i += 2;
        } else if i < to && (bytes[i] == b'\n' || bytes[i] == b'\r') {
            i += 1;
        }
    }
    while i < to {
        let b = bytes[i];
        if b == b'&'
            && decode
            && let Some((chars, len)) = reference(bytes, i)
        {
            let end = (i + len).min(to);
            for c in chars.chars() {
                model.push(c, i, end);
            }
            i = end;
            continue;
        }
        if b == b'\r' {
            // A browser reads CR LF, and a lone CR, as one line feed.
            let end = if i + 1 < to && bytes[i + 1] == b'\n' {
                i + 2
            } else {
                i + 1
            };
            model.push('\n', i, end);
            i = end;
            continue;
        }
        let c = source[i..].chars().next().unwrap_or('\u{FFFD}');
        let end = i + c.len_utf8();
        if c != '\0' {
            model.push(c, i, end);
        }
        i = end;
    }
}

/// An HTML file's text as the page's scripts see it: the text of the body, without anything
/// inside tags, comments or the skipped elements, character references decoded.
pub fn html_model(source: &str) -> TextModel {
    let bytes = source.as_bytes();
    let mut model = TextModel::default();
    let mut in_body = false;
    let mut after_pre = false;
    let mut i = 0;
    let mut text_from = 0;
    let flush = |model: &mut TextModel, from: usize, to: usize, in_body: &mut bool, pre: bool| {
        if from >= to {
            return;
        }
        // Before the body starts, only text with something besides spaces belongs to it (and
        // starts it, as in a browser).
        if !*in_body {
            if source[from..to].trim().is_empty() {
                return;
            }
            *in_body = true;
        }
        push_text(model, source, (from, to), pre, true);
    };
    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        let next = bytes.get(i + 1).copied().unwrap_or(b' ');
        let end_tag = next == b'/' && bytes.get(i + 2).is_some_and(|b| b.is_ascii_alphabetic());
        let markup =
            next.is_ascii_alphabetic() || end_tag || next == b'!' || next == b'?' || next == b'/';
        if !markup {
            i += 1;
            continue;
        }
        flush(&mut model, text_from, i, &mut in_body, after_pre);
        after_pre = false;
        if starts_with_ci(bytes, i, b"<!--") {
            // A comment, to `-->` (`<!-->` and `<!--->` are empty ones).
            let body = i + 4;
            i = if starts_with_ci(bytes, body, b">") {
                body + 1
            } else if starts_with_ci(bytes, body, b"->") {
                body + 2
            } else {
                match find_from(bytes, body, b"-->") {
                    Some(at) => at + 3,
                    None => bytes.len(),
                }
            };
        } else if next == b'!' || next == b'?' || (next == b'/' && !end_tag) {
            // A doctype or another declaration, to the next `>`.
            i = match bytes[i..].iter().position(|&b| b == b'>') {
                Some(p) => i + p + 1,
                None => bytes.len(),
            };
        } else if end_tag {
            i = tag_end(bytes, i + 2).0;
        } else {
            let (end, name) = tag_end(bytes, i + 1);
            i = end;
            if name == "body" || (!in_body && !HEAD_TAGS.contains(&name.as_str())) {
                in_body = true;
            }
            if SKIPPED.contains(&name.as_str()) {
                i = raw_content(bytes, i, &name).1;
            } else if RAW_SHOWN.contains(&name.as_str()) {
                let (end, after) = raw_content(bytes, i, &name);
                in_body = true;
                push_text(&mut model, source, (i, end), false, false);
                i = after;
            } else if name == "pre" || name == "listing" {
                after_pre = true;
            }
        }
        text_from = i;
    }
    flush(&mut model, text_from, bytes.len(), &mut in_body, after_pre);
    model
}

/// How many characters at the end of `a` and `b` agree.
fn common_tail(a: &[char], b: &[char]) -> usize {
    a.iter()
        .rev()
        .zip(b.iter().rev())
        .take_while(|(x, y)| x == y)
        .count()
}

/// How many characters at the start of `a` and `b` agree.
fn common_head(a: &[char], b: &[char]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

/// Why a passage could not be placed.
#[derive(Debug, PartialEq, Eq)]
pub enum Miss {
    /// The words are not in the stored file.
    NotFound,
    /// The words are in more than one place and the words around them do not say which.
    Ambiguous,
}

/// Every place `needle` starts in `hay` (at most MAX_PLACES).
fn places(hay: &[char], needle: &[char]) -> Vec<usize> {
    let mut found = Vec::new();
    if needle.is_empty() || needle.len() > hay.len() {
        return found;
    }
    for at in 0..=hay.len() - needle.len() {
        if hay[at] == needle[0] && hay[at..at + needle.len()] == *needle {
            found.push(at);
            if found.len() >= MAX_PLACES {
                break;
            }
        }
    }
    found
}

/// Where a passage is: the place whose surrounding text agrees best with the words saved before
/// and after it. Err when it is missing, or when two places agree equally well.
pub fn locate(
    text: &[char],
    quote: &str,
    prefix: &str,
    suffix: &str,
) -> Result<(usize, usize), Miss> {
    let quote: Vec<char> = quote.chars().collect();
    let prefix: Vec<char> = prefix.chars().collect();
    let suffix: Vec<char> = suffix.chars().collect();
    let found = places(text, &quote);
    if found.is_empty() {
        return Err(Miss::NotFound);
    }
    let score = |at: usize| {
        let end = at + quote.len();
        common_tail(&text[..at], &prefix) + common_head(&text[end..], &suffix)
    };
    let scores: Vec<usize> = found.iter().map(|&at| score(at)).collect();
    let best = *scores.iter().max().unwrap_or(&0);
    let mut winners = found.iter().zip(&scores).filter(|(_, s)| **s == best);
    let (&at, _) = winners.next().ok_or(Miss::NotFound)?;
    if winners.next().is_some() {
        return Err(Miss::Ambiguous);
    }
    Ok((at, at + quote.len()))
}

/// Blacks out a piece of text: every character but spaces and line breaks becomes `█`.
pub fn blackout(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_whitespace() { c } else { BLOCK })
        .collect()
}

/// A new file with the characters in `hidden` (a flag per model character) blacked out. Only text
/// is touched: tags, attributes, comments, scripts and styles are copied byte for byte.
pub fn rewrite(source: &str, model: &TextModel, hidden: &[bool]) -> String {
    let mut out = String::with_capacity(source.len() + hidden.len() * 2);
    let mut copied = 0;
    let mut i = 0;
    while i < model.chars.len() {
        let span = model.spans[i];
        let mut j = i;
        while j < model.chars.len() && model.spans[j] == span {
            j += 1;
        }
        if hidden[i..j].iter().any(|h| *h) && !model.chars[i..j].iter().all(|c| c.is_whitespace()) {
            out.push_str(&source[copied..span.0]);
            for c in &model.chars[i..j] {
                out.push(if c.is_whitespace() { *c } else { BLOCK });
            }
            copied = span.1;
        }
        i = j;
    }
    out.push_str(&source[copied..]);
    out
}

/// A passage marked for redaction, as saved.
#[derive(Debug, Clone)]
pub struct Passage {
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
}

/// The outcome of blacking out passages in a stored file.
#[derive(Debug)]
pub struct Redacted {
    pub content: String,
    /// The page's text before and after, character for character the same length.
    pub before: Vec<char>,
    pub after: Vec<char>,
    /// How many times the blacked-out words still appear elsewhere in the new file.
    pub remaining: usize,
}

/// Blacks out every passage in an HTML or text file. Err holds the number (from 1) of the first
/// passage that could not be placed, and why; nothing is changed then.
pub fn redact(source: &str, kind: &str, passages: &[Passage]) -> Result<Redacted, (usize, Miss)> {
    let model = if kind == "html" {
        html_model(source)
    } else {
        text_model(source)
    };
    let mut hidden = vec![false; model.chars.len()];
    for (n, p) in passages.iter().enumerate() {
        let (start, end) =
            locate(&model.chars, &p.quote, &p.prefix, &p.suffix).map_err(|miss| (n + 1, miss))?;
        hidden[start..end].iter_mut().for_each(|h| *h = true);
    }
    let content = rewrite(source, &model, &hidden);
    let after = if kind == "html" {
        html_model(&content)
    } else {
        text_model(&content)
    };
    // The same words left elsewhere (for example a name written twice): counted to tell the
    // person, never applied by guesswork.
    let remaining = passages
        .iter()
        .map(|p| p.quote.trim())
        .filter(|q| !q.is_empty())
        .map(|q| places(&after.chars, &q.chars().collect::<Vec<_>>()).len())
        .sum();
    Ok(Redacted {
        content,
        before: model.chars,
        after: after.chars,
        remaining,
    })
}

/// Replaces every whole appearance of the redacted words in a piece of text people wrote or the
/// site saved (a comment, a field's label).
pub fn scrub_words(text: &str, words: &[String]) -> String {
    let mut out = text.to_string();
    for w in words {
        if !w.trim().is_empty() && out.contains(w.as_str()) {
            out = out.replace(w.as_str(), &blackout(w));
        }
    }
    out
}

/// A mark's saved place in the page's text (its quote and the words before and after it), with
/// the blacked-out characters replaced. The page's text keeps its length, so the place is found
/// in the old text and read again from the new one; when it cannot be found there (a page that
/// writes its own text), every whole appearance of the redacted words is replaced instead, and a
/// redacted passage cut off at either end of the words before or after (four characters or more).
pub fn scrub_place(
    redacted: &Redacted,
    words: &[String],
    quote: &str,
    prefix: &str,
    suffix: &str,
) -> (String, String, String) {
    let (before, after) = (&redacted.before, &redacted.after);
    let slice = |from: usize, to: usize| after[from..to].iter().collect::<String>();
    let (q, p, s) = (
        quote.chars().count(),
        prefix.chars().count(),
        suffix.chars().count(),
    );
    let at = if q > 0 {
        locate(before, quote, prefix, suffix).ok().map(|(a, _)| a)
    } else {
        // An insertion point: the words before and after it, together.
        let both: Vec<char> = prefix.chars().chain(suffix.chars()).collect();
        places(before, &both).first().map(|a| a + p)
    };
    if let Some(at) = at {
        let fits = |from: isize, len: usize, saved: &str| {
            from >= 0
                && from as usize + len <= before.len()
                && before[from as usize..from as usize + len]
                    .iter()
                    .copied()
                    .eq(saved.chars())
        };
        let start = at as isize;
        let prefix_ok = fits(start - p as isize, p, prefix);
        let suffix_ok = fits(start + q as isize, s, suffix);
        if prefix_ok && suffix_ok {
            return (
                slice(at, at + q),
                slice(at - p, at),
                slice(at + q, at + q + s),
            );
        }
    }
    (
        scrub_words(quote, words),
        scrub_edges(&scrub_words(prefix, words), words),
        scrub_edges(&scrub_words(suffix, words), words),
    )
}

/// Blacks out the part of a redacted passage cut off at either end of `text`.
fn scrub_edges(text: &str, words: &[String]) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    for w in words {
        let w: Vec<char> = w.chars().collect();
        for k in (4..w.len()).rev() {
            if k <= chars.len() && chars[chars.len() - k..] == w[..k] {
                let n = chars.len();
                for c in &mut chars[n - k..] {
                    if !c.is_whitespace() {
                        *c = BLOCK;
                    }
                }
                break;
            }
        }
        for k in (4..w.len()).rev() {
            if k <= chars.len() && chars[..k] == w[w.len() - k..] {
                for c in &mut chars[..k] {
                    if !c.is_whitespace() {
                        *c = BLOCK;
                    }
                }
                break;
            }
        }
    }
    chars.into_iter().collect()
}

/// What the person is told when a passage cannot be applied.
pub fn miss_message(number: usize, total: usize, miss: &Miss) -> String {
    let which = if total == 1 {
        "The passage marked for redaction".to_string()
    } else {
        format!("Passage {number} of {total} marked for redaction")
    };
    match miss {
        Miss::NotFound => format!(
            "Nothing was applied. {which} is not in the stored file (the page may write it with its own script, or a newer version changed it). Delete that mark and try again."
        ),
        Miss::Ambiguous => format!(
            "Nothing was applied. {which} appears more than once and the words around it do not say which. Delete that mark, select a longer passage and mark it again."
        ),
    }
}

#[derive(Deserialize)]
pub struct ApplyForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    confirm: String,
}

/// A pending redaction, as loaded for applying.
#[derive(sqlx::FromRow)]
struct PendingRow {
    id: i64,
    quote: String,
    prefix: String,
    suffix: String,
}

#[derive(sqlx::FromRow)]
struct PlaceRow {
    id: i64,
    kind: String,
    quote: String,
    prefix: String,
    suffix: String,
    field_label: String,
    body: String,
    text: String,
}

/// Applies the pending redactions: the uploader or the owner, after typing REDACT. One
/// transaction makes the blacked-out version, deletes every older version, replaces the redacted
/// words in what the other marks and saved fields kept, removes the pending marks and records an
/// audit entry without the words.
pub async fn apply(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Form(form): Form<ApplyForm>,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match documents::for_change(&state, &headers, &key, &form.csrf).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let outcome = if form.confirm.trim() == REDACT_WORD {
        apply_now(&state, &session, &doc).await?
    } else {
        Err("Nothing was applied. To apply the redactions, type REDACT in capitals.".into())
    };
    match outcome {
        Ok((count, remaining)) => Ok(documents::see_other(&format!(
            "/documents/{}?redacted={count}&remaining={remaining}#panel",
            doc.key
        ))),
        Err(message) => {
            documents::show(
                &state,
                &session,
                &doc,
                StatusCode::BAD_REQUEST,
                Some(&message),
            )
            .await
        }
    }
}

async fn apply_now(
    state: &FamilyState,
    session: &Session,
    doc: &DocumentRow,
) -> Result<Result<(usize, usize), String>, super::handlers::Fail> {
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM documents WHERE id = $1 FOR UPDATE")
        .bind(doc.id)
        .execute(&mut *tx)
        .await?;
    let latest: Option<(i32, String, String, Vec<u8>)> = sqlx::query_as(
        "SELECT version_no, filename, kind, content FROM document_versions
         WHERE document_id = $1 ORDER BY version_no DESC LIMIT 1",
    )
    .bind(doc.id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((version_no, filename, kind, content)) = latest else {
        return Ok(Err(
            "Nothing was applied. This document has no stored file.".into(),
        ));
    };
    if kind == "picture" {
        return Ok(Err(
            "Nothing was applied. Pictures cannot be redacted yet; upload an edited picture as a new version instead.".into(),
        ));
    }
    let pending: Vec<PendingRow> = sqlx::query_as(
        "SELECT id, quote, prefix, suffix FROM annotations
         WHERE document_id = $1 AND kind = 'redaction' ORDER BY created_at, id",
    )
    .bind(doc.id)
    .fetch_all(&mut *tx)
    .await?;
    if pending.is_empty() {
        return Ok(Err(
            "Nothing was applied. No passages are marked for redaction.".into(),
        ));
    }
    let Ok(source) = String::from_utf8(content) else {
        return Ok(Err(
            "Nothing was applied. This file is not UTF-8 text, so it cannot be redacted here."
                .into(),
        ));
    };
    // Only the marks read here are applied and removed; one added meanwhile stays pending.
    let applied: Vec<i64> = pending.iter().map(|p| p.id).collect();
    let passages: Vec<Passage> = pending
        .into_iter()
        .map(|p| Passage {
            quote: p.quote,
            prefix: p.prefix,
            suffix: p.suffix,
        })
        .collect();
    let redacted = match redact(&source, &kind, &passages) {
        Ok(redacted) => redacted,
        Err((n, miss)) => return Ok(Err(miss_message(n, passages.len(), &miss))),
    };
    if redacted.content.len() > documents::MAX_BYTES {
        return Ok(Err(
            "Nothing was applied. The blacked-out file would be larger than 10 MB.".into(),
        ));
    }
    let next = version_no + 1;
    let file = documents::NewFile {
        filename: &filename,
        kind: &kind,
        bytes: redacted.content.as_bytes(),
        profile_id: session.profile_id,
        image: None,
    };
    documents::insert_version(&mut tx, doc.id, next, &file).await?;
    let removed =
        sqlx::query("DELETE FROM document_versions WHERE document_id = $1 AND version_no < $2")
            .bind(doc.id)
            .bind(next)
            .execute(&mut *tx)
            .await?
            .rows_affected();
    sqlx::query("DELETE FROM annotations WHERE id = ANY($1)")
        .bind(&applied)
        .execute(&mut *tx)
        .await?;
    // The words themselves, to replace in what was saved about this document.
    let words: Vec<String> = passages.iter().map(|p| p.quote.clone()).collect();
    let marks: Vec<PlaceRow> = sqlx::query_as(
        "SELECT id, kind, quote, prefix, suffix, field_label, body, text FROM annotations WHERE document_id = $1",
    )
    .bind(doc.id)
    .fetch_all(&mut *tx)
    .await?;
    for m in marks {
        let (quote, prefix, suffix) =
            if m.quote.is_empty() && m.prefix.is_empty() && m.suffix.is_empty() {
                (String::new(), String::new(), String::new())
            } else {
                scrub_place(&redacted, &words, &m.quote, &m.prefix, &m.suffix)
            };
        let field_label = scrub_words(&m.field_label, &words);
        let body = scrub_words(&m.body, &words);
        // Only words people wrote are changed; a stamp's name, a typed signature and an
        // attachment's file name are left as they are.
        let text = if m.kind == "insert" || m.kind == "replace" {
            scrub_words(&m.text, &words)
        } else {
            m.text.clone()
        };
        if (&quote, &prefix, &suffix, &field_label, &body, &text)
            != (
                &m.quote,
                &m.prefix,
                &m.suffix,
                &m.field_label,
                &m.body,
                &m.text,
            )
        {
            sqlx::query(
                "UPDATE annotations SET quote = $2, prefix = $3, suffix = $4, field_label = $5, body = $6, text = $7
                 WHERE id = $1",
            )
            .bind(m.id)
            .bind(&quote)
            .bind(&prefix)
            .bind(&suffix)
            .bind(&field_label)
            .bind(&body)
            .bind(&text)
            .execute(&mut *tx)
            .await?;
        }
    }
    let labels: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, label FROM document_fields WHERE document_id = $1 AND label <> ''",
    )
    .bind(doc.id)
    .fetch_all(&mut *tx)
    .await?;
    for (id, label) in labels {
        let clean = scrub_words(&label, &words);
        if clean != label {
            sqlx::query("UPDATE document_fields SET label = $2 WHERE id = $1")
                .bind(id)
                .bind(&clean)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("UPDATE documents SET redacted_at = now(), redacted_by = $2 WHERE id = $1")
        .bind(doc.id)
        .bind(session.profile_id)
        .execute(&mut *tx)
        .await?;
    // The audit entry says what was done, never which words.
    sqlx::query("INSERT INTO audit_log (actor_profile_id, action, detail) VALUES ($1, $2, $3)")
        .bind(session.profile_id)
        .bind("document redacted")
        .bind(format!(
            "{} version {next}: {} passages blacked out, {removed} older versions deleted",
            doccheck::filing_label(&doc.key),
            passages.len()
        ))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Ok((passages.len(), redacted.remaining)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passage(quote: &str, prefix: &str, suffix: &str) -> Passage {
        Passage {
            quote: quote.into(),
            prefix: prefix.into(),
            suffix: suffix.into(),
        }
    }

    #[test]
    fn the_model_reads_text_as_a_browser_does() {
        let html = "<!doctype html><html><head><title>Secret title</title><style>p{content:\"x\"}</style>\n<script>var a = '<p>no</p>';</script></head>\n<body>\n<p class=\"a>b\" title='Tom &amp; Ann'>Tom &amp; Ann&nbsp;met</p><!-- Tom --><textarea>Tom</textarea><template><p>Tom</p></template><pre>\nline</pre>&copy 2026 &#169; &#x41;&#150;&unknown;</body></html>";
        let model = html_model(html);
        assert_eq!(
            model.text(),
            "\nTom & Ann\u{a0}metline\u{a9} 2026 \u{a9} A\u{2013}&unknown;"
        );
        // Every character points back at the bytes it came from.
        for (c, (s, e)) in model.chars.iter().zip(&model.spans) {
            let raw = &html[*s..*e];
            assert!(
                raw.starts_with('&') || raw.contains(*c),
                "{c:?} from {raw:?}"
            );
        }
    }

    #[test]
    fn raw_elements_count_as_written() {
        let html = "<body><p>a &amp; b</p><xmp>c &amp; <b>d</b></xmp><textarea>e</textarea></body>";
        assert_eq!(html_model(html).text(), "a & bc &amp; <b>d</b>");
        let out = redact(html, "html", &[passage("&amp; <b>", "", "")]).unwrap();
        assert_eq!(
            out.content,
            "<body><p>a &amp; b</p><xmp>c █████ ███d</b></xmp><textarea>e</textarea></body>"
        );
    }

    #[test]
    fn without_a_body_tag_the_body_starts_at_the_first_content() {
        let html = "<html>\n<head>\n<meta charset=utf-8>\n</head>\n<p>Hello</p>\n";
        assert_eq!(html_model(html).text(), "Hello\n");
        assert_eq!(html_model("Just words").text(), "Just words");
        assert_eq!(html_model("a < b and c<3").text(), "a < b and c<3");
        assert_eq!(html_model("x\r\ny\rz").text(), "x\ny\nz");
    }

    #[test]
    fn prefix_and_suffix_pick_the_right_place() {
        let text: Vec<char> = "Call Ann on Monday. Call Ann on Friday.".chars().collect();
        assert_eq!(
            locate(&text, "Ann", "Monday. Call ", " on Friday"),
            Ok((25, 28))
        );
        assert_eq!(locate(&text, "Ann", "Call ", " on Monday"), Ok((5, 8)));
        assert_eq!(locate(&text, "Ann", "Call ", " on "), Err(Miss::Ambiguous));
        assert_eq!(locate(&text, "Bob", "", ""), Err(Miss::NotFound));
        // A single place needs no words around it.
        assert_eq!(locate(&text, "Friday", "", ""), Ok((32, 38)));
    }

    #[test]
    fn redaction_touches_text_only() {
        let html = r#"<html><head><title>Ann</title><script>const who = "Ann";</script><style>.Ann{}</style></head><body><p class="Ann" data-x='Ann'>Ann &amp; Bo</p><!-- Ann --><img alt="Ann"><p>Ann</p></body></html>"#;
        let out = redact(html, "html", &[passage("Ann & Bo", "", "Ann")]).unwrap();
        assert_eq!(
            out.content,
            r#"<html><head><title>Ann</title><script>const who = "Ann";</script><style>.Ann{}</style></head><body><p class="Ann" data-x='Ann'>███ █ ██</p><!-- Ann --><img alt="Ann"><p>Ann</p></body></html>"#
        );
        assert_eq!(out.before.len(), out.after.len());
        assert_eq!(out.remaining, 0);
        let out = redact(html, "html", &[passage("Ann", "Ann & Bo", "")]).unwrap();
        assert!(out.content.ends_with("<p>███</p></body></html>"));
        // "Ann" alone also stands in "Ann & Bo": it is counted, not guessed at.
        assert_eq!(out.remaining, 1);
    }

    #[test]
    fn entities_and_lines_are_matched_decoded_and_spaces_kept() {
        let html = "<body><p>Fish&nbsp;&amp; chips\r\nat 5 &lt;pm&gt;</p></body>";
        let out = redact(
            html,
            "html",
            &[passage("chips\nat 5 <pm>", "Fish\u{a0}& ", "")],
        )
        .unwrap();
        assert_eq!(
            out.content,
            "<body><p>Fish&nbsp;&amp; █████\r\n██ █ ████</p></body>"
        );
        let out = redact(html, "html", &[passage("Fish\u{a0}&", "", " chips")]).unwrap();
        assert_eq!(
            out.content,
            "<body><p>████&nbsp;█ chips\r\nat 5 &lt;pm&gt;</p></body>"
        );
    }

    #[test]
    fn a_missing_or_unclear_passage_applies_nothing() {
        let html = "<body><p>Ann</p><p>Ann</p><script>document.write('Bob')</script></body>";
        assert_eq!(
            redact(html, "html", &[passage("Ann", "", "")]).unwrap_err(),
            (1, Miss::Ambiguous)
        );
        assert_eq!(
            redact(
                html,
                "html",
                &[passage("Ann", "", "Ann"), passage("Bob", "", "")]
            )
            .unwrap_err(),
            (2, Miss::NotFound)
        );
        assert!(
            miss_message(2, 2, &Miss::NotFound).starts_with("Nothing was applied. Passage 2 of 2")
        );
        assert!(!miss_message(1, 1, &Miss::Ambiguous).contains('\u{2014}'));
    }

    #[test]
    fn text_files_and_overlapping_passages() {
        let out = redact(
            "Ann Lee, 12 Fern Road\nphone 5550 1234",
            "text",
            &[
                passage("12 Fern Road", "", ""),
                passage("Fern Road\nphone", "", ""),
            ],
        )
        .unwrap();
        assert_eq!(out.content, "Ann Lee, ██ ████ ████\n█████ 5550 1234");
    }

    #[test]
    fn other_marks_lose_the_words_but_keep_their_place() {
        let html = "<body><p>Meet Ann Lee at the pier on Sunday.</p></body>";
        let out = redact(html, "html", &[passage("Ann Lee", "Meet ", " at")]).unwrap();
        let words = vec!["Ann Lee".to_string()];
        // A highlight over "the pier", saved with "Ann Lee" in the words before it.
        assert_eq!(
            scrub_place(&out, &words, "the pier", "Meet Ann Lee at ", " on Sunday."),
            (
                "the pier".into(),
                "Meet ███ ███ at ".into(),
                " on Sunday.".into()
            )
        );
        // A highlight over part of the redacted words.
        assert_eq!(
            scrub_place(&out, &words, "Lee at", "Meet Ann ", " the"),
            ("███ at".into(), "Meet ███ ".into(), " the".into())
        );
        // A mark that cannot be placed (a page's own text): whole words and cut-off ends.
        assert_eq!(
            scrub_place(&out, &words, "said Ann Lee", "to Ann L", "n Lee, again"),
            (
                "said ███ ███".into(),
                "to ███ █".into(),
                "█ ███, again".into()
            )
        );
        assert_eq!(scrub_words("Ask Ann Lee", &words), "Ask ███ ███");
        assert_eq!(scrub_words("Ask Ann", &words), "Ask Ann");
    }

    #[test]
    fn blackout_keeps_spaces_and_length() {
        assert_eq!(blackout("Ann Lee\n42"), "███ ███\n██");
        assert_eq!(blackout("灯笼"), "██");
    }
}
