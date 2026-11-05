//! D4: file attachments. Any family member may pin a file at a point of a document (a mark of
//! kind `attachment`, placed and moved like a sticky note); its author or the owner deletes it.
//!
//! Files are kept on the site and are only ever downloaded, never opened inside it: every
//! download is `Content-Disposition: attachment`, `application/octet-stream` (pictures keep their
//! own type but are still saved, not shown), `nosniff`, `no-store` and a sandbox policy. Only an
//! allow-list is accepted, and a file must be what its name says by its first bytes: pictures
//! (JPEG, PNG, WebP), PDF, Word, Excel and PowerPoint (both the current and the older formats),
//! plain text and CSV, up to 10 MB. Anything else is refused, including web pages, SVG pictures,
//! scripts and programs.

use super::documents;
use super::review;
use super::{FamilyState, auth, doccheck, json, store};
use axum::{
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};

/// The largest attachment, as for documents.
pub const MAX_BYTES: usize = documents::MAX_BYTES;
/// Attachments per document.
pub const MAX_PER_DOCUMENT: i64 = 100;
/// The longest kept file name.
pub const MAX_NAME: usize = 200;

/// What the file picker offers (the server checks again).
pub const ACCEPT: &str = ".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.txt,.csv";

/// What a refused file is told.
pub const REFUSED: &str = "That file type cannot be attached. Attach a picture (JPEG, PNG, WebP), a PDF, a Word, Excel or PowerPoint file, plain text or CSV, up to 10 MB.";

/// The type a file's name claims, by its extension.
fn claimed(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit_once('.')?.1;
    Some(match ext {
        "jpg" | "jpeg" => "jpeg",
        "png" => "png",
        "webp" => "webp",
        "pdf" => "pdf",
        "docx" => "docx",
        "xlsx" => "xlsx",
        "pptx" => "pptx",
        "doc" => "doc",
        "xls" => "xls",
        "ppt" => "ppt",
        "txt" => "txt",
        "csv" => "csv",
        _ => return None,
    })
}

const OLE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

fn le16(bytes: &[u8], at: usize) -> Option<usize> {
    let b = bytes.get(at..at + 2)?;
    Some(u16::from_le_bytes([b[0], b[1]]) as usize)
}

fn le32(bytes: &[u8], at: usize) -> Option<usize> {
    let b = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
}

/// The names of the files inside a ZIP archive, from its central directory (None when it is not
/// a readable ZIP archive).
pub fn zip_names(bytes: &[u8]) -> Option<Vec<String>> {
    if !bytes.starts_with(b"PK\x03\x04") || bytes.len() < 22 {
        return None;
    }
    // The end-of-directory record is in the last 64 KB and 22 bytes.
    let from = bytes.len().saturating_sub(22 + 65_535);
    let eocd = (from..=bytes.len() - 22)
        .rev()
        .find(|&i| bytes[i..i + 4] == *b"PK\x05\x06")?;
    let count = le16(bytes, eocd + 10)?;
    let mut at = le32(bytes, eocd + 16)?;
    let mut names = Vec::with_capacity(count.min(10_000));
    for _ in 0..count.min(10_000) {
        if bytes.get(at..at + 4)? != b"PK\x01\x02" {
            return None;
        }
        let name_len = le16(bytes, at + 28)?;
        let extra = le16(bytes, at + 30)?;
        let comment = le16(bytes, at + 32)?;
        let name = bytes.get(at + 46..at + 46 + name_len)?;
        names.push(String::from_utf8_lossy(name).into_owned());
        at += 46 + name_len + extra + comment;
    }
    Some(names)
}

/// Whether a ZIP archive is the Office file its name says: `[Content_Types].xml` and the main part.
fn office_zip(bytes: &[u8], kind: &str) -> bool {
    let Some(names) = zip_names(bytes) else {
        return false;
    };
    let part = match kind {
        "docx" => "word/",
        "xlsx" => "xl/",
        _ => "ppt/",
    };
    names.iter().any(|n| n == "[Content_Types].xml") && names.iter().any(|n| n.starts_with(part))
}

/// Plain text or CSV: UTF-8 without control characters (tabs, line breaks and form feeds aside),
/// and not a web page, SVG, script or program dressed up as text.
fn plain_text(bytes: &[u8]) -> bool {
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let Ok(text) = std::str::from_utf8(body) else {
        return false;
    };
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r' | '\x0c'))
    {
        return false;
    }
    let start: String = text
        .trim_start()
        .chars()
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase();
    ![
        "<!doctype",
        "<html",
        "<head",
        "<body",
        "<svg",
        "<?xml",
        "<script",
        "<iframe",
        "<!--",
        "#!",
    ]
    .iter()
    .any(|m| start.starts_with(m))
}

/// The file's type when its name and its first bytes agree on one of the allowed types, or the
/// message to show.
pub fn detect(name: &str, bytes: &[u8]) -> Result<&'static str, &'static str> {
    if bytes.is_empty() {
        return Err("That file is empty.");
    }
    if bytes.len() > MAX_BYTES {
        return Err("That file is too large. Attachments can be up to 10 MB.");
    }
    let Some(kind) = claimed(name) else {
        return Err(REFUSED);
    };
    let ok = match kind {
        "jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "pdf" => bytes.starts_with(b"%PDF-"),
        "docx" | "xlsx" | "pptx" => office_zip(bytes, kind),
        "doc" | "xls" | "ppt" => bytes.starts_with(&OLE),
        _ => plain_text(bytes),
    };
    if ok {
        Ok(kind)
    } else {
        Err(
            "That file is not what its name says, so it was not attached. Attach a picture (JPEG, PNG, WebP), a PDF, a Word, Excel or PowerPoint file, plain text or CSV.",
        )
    }
}

/// A file name that is safe to keep and show: the last part of a path, without control or
/// direction-changing characters, at most 200 characters, the extension kept.
pub fn clean_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let kept: Vec<char> = last
        .chars()
        .filter(|c| {
            !c.is_control()
                && !matches!(c, '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
        })
        .collect();
    let text: String = kept.iter().collect();
    let text = text.trim().trim_start_matches('.').to_string();
    if text.chars().count() <= MAX_NAME {
        return text;
    }
    // Too long: keep the start and the extension.
    let (stem, ext) = text.rsplit_once('.').unwrap_or((&text, ""));
    let ext: String = ext.chars().take(10).collect();
    let room = MAX_NAME - ext.chars().count() - 1;
    format!("{}.{ext}", stem.chars().take(room).collect::<String>())
}

/// The media type a download is sent with: pictures keep theirs, everything else is plain bytes.
pub fn media_type(kind: &str) -> &'static str {
    match kind {
        "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// What a type is called in the panel.
pub fn type_words(kind: &str) -> &'static str {
    match kind {
        "jpeg" => "JPEG picture",
        "png" => "PNG picture",
        "webp" => "WebP picture",
        "pdf" => "PDF",
        "docx" | "doc" => "Word document",
        "xlsx" | "xls" => "Excel workbook",
        "pptx" | "ppt" => "PowerPoint",
        "csv" => "CSV",
        _ => "Plain text",
    }
}

/// A size in words: "820 bytes", "12 KB", "3.4 MB".
pub fn size_words(bytes: i64) -> String {
    if bytes < 1024 {
        format!("{bytes} bytes")
    } else if bytes < 1024 * 1024 {
        format!("{} KB", (bytes + 512) / 1024)
    } else {
        let tenths = (bytes * 10 + 512 * 1024) / (1024 * 1024);
        format!("{}.{} MB", tenths / 10, tenths % 10)
    }
}

fn error(code: StatusCode, message: &str) -> Response {
    (
        code,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        json::object(&[("error", json::string(message))]),
    )
        .into_response()
}

#[derive(Default)]
struct AttachForm {
    csrf: String,
    anchor_path: String,
    anchor_x: String,
    anchor_y: String,
    filename: String,
    bytes: Vec<u8>,
}

async fn read_form(multipart: &mut Multipart) -> Result<AttachForm, ()> {
    let mut form = AttachForm::default();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => return Err(()),
        };
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                form.filename = field.file_name().unwrap_or("").to_string();
                form.bytes = field.bytes().await.map_err(|_| ())?.to_vec();
            }
            "csrf" | "anchor_path" | "anchor_x" | "anchor_y" => {
                let value: String = field
                    .text()
                    .await
                    .map_err(|_| ())?
                    .chars()
                    .take(500)
                    .collect();
                match name.as_str() {
                    "csrf" => form.csrf = value,
                    "anchor_path" => form.anchor_path = value,
                    "anchor_x" => form.anchor_x = value,
                    _ => form.anchor_y = value,
                }
            }
            _ => {}
        }
    }
    Ok(form)
}

/// Attaches a file at a point of a document: any family member, from the page (with the form
/// token). Replies with the new mark as JSON, or `{"error": ...}` saying why it was refused.
pub async fn upload(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    mut multipart: Multipart,
) -> Result<Response, super::handlers::Fail> {
    let (session, doc) = match review::session_and_doc(&state, &headers, &key).await? {
        Ok(found) => found,
        Err(response) => return Ok(response),
    };
    let Ok(form) = read_form(&mut multipart).await else {
        return Ok(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "That file could not be read. Attachments can be up to 10 MB.",
        ));
    };
    if review::checked(&state, &headers, &session, &form.csrf).is_none() {
        return Ok(error(
            StatusCode::FORBIDDEN,
            "This page was out of date. Reload it and try again.",
        ));
    }
    let Ok(Some((path, x, y))) =
        review::anchor_of(&form.anchor_path, &form.anchor_x, &form.anchor_y)
    else {
        return Ok(error(
            StatusCode::BAD_REQUEST,
            "Choose a place in the document for the file.",
        ));
    };
    let name = clean_name(&form.filename);
    if name.is_empty() {
        return Ok(error(StatusCode::BAD_REQUEST, "Choose a file to attach."));
    }
    let kind = match detect(&name, &form.bytes) {
        Ok(kind) => kind,
        Err(message) => {
            let code = if form.bytes.len() > MAX_BYTES {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            };
            return Ok(error(code, message));
        }
    };
    let (marks, files): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM annotations WHERE document_id = $1),
                (SELECT count(*) FROM document_attachments WHERE document_id = $1)",
    )
    .bind(doc.id)
    .fetch_one(&state.pool)
    .await?;
    if marks >= review::MAX_ANNOTATIONS || files >= MAX_PER_DOCUMENT {
        return Ok(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "This document already has as many marks or attachments as it can hold.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO annotations (document_id, version_no, author, body, kind, text, anchor_path, anchor_x, anchor_y)
         VALUES ($1, $2, $3, '', 'attachment', $4, $5, $6, $7) RETURNING id",
    )
    .bind(doc.id)
    .bind(doc.version_no)
    .bind(session.profile_id)
    .bind(&name)
    .bind(&path)
    .bind(x)
    .bind(y)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO document_attachments (document_id, annotation_id, filename, file_type, size_bytes, sha256, content, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(doc.id)
    .bind(id)
    .bind(&name)
    .bind(kind)
    .bind(form.bytes.len() as i32)
    .bind(auth::sha256(&form.bytes))
    .bind(&form.bytes)
    .bind(session.profile_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    store::audit(
        &state.pool,
        Some(session.profile_id),
        "attachment added",
        &format!(
            "{} annotation {id} ({kind}, {} bytes)",
            doccheck::filing_label(&doc.key),
            form.bytes.len()
        ),
    )
    .await?;
    Ok(review::created_reply(&state.pool, doc.id, id).await?)
}

/// An attached file, as a download only. Members only.
pub async fn download(
    State(state): State<FamilyState>,
    headers: HeaderMap,
    Path((key, id)): Path<(String, i64)>,
) -> Result<Response, super::handlers::Fail> {
    if documents::signed_in(&state, &headers).await?.is_none() {
        return Ok(documents::see_other("/"));
    }
    let doc = match documents::resolve(&state, &key, "").await? {
        Ok(doc) => doc,
        Err(response) => return Ok(response),
    };
    let found: Option<(String, String, Vec<u8>)> = sqlx::query_as(
        "SELECT filename, file_type, content FROM document_attachments WHERE annotation_id = $1 AND document_id = $2",
    )
    .bind(id)
    .bind(doc.id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((filename, kind, bytes)) = found else {
        return Ok(documents::not_found());
    };
    let disposition = HeaderValue::from_str(&documents::attachment(&filename))
        .unwrap_or(HeaderValue::from_static("attachment"));
    let mut response = (
        [
            (header::CONTENT_TYPE, media_type(&kind)),
            (
                header::CONTENT_SECURITY_POLICY,
                "sandbox; default-src 'none'; frame-ancestors 'none'",
            ),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::CACHE_CONTROL, "private, no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    response.headers_mut().insert(
        header::HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny ZIP archive (stored, no compression) holding the named empty files.
    pub fn zip_with(names: &[&str]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for name in names {
            let offset = out.len() as u32;
            out.extend_from_slice(b"PK\x03\x04");
            out.extend_from_slice(&[20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            out.extend_from_slice(&[0; 12]);
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&[0, 0]);
            out.extend_from_slice(name.as_bytes());
            central.extend_from_slice(b"PK\x01\x02");
            central.extend_from_slice(&[20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            central.extend_from_slice(&[0; 12]);
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0; 12]);
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let start = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(b"PK\x05\x06\0\0\0\0");
        out.extend_from_slice(&(names.len() as u16).to_le_bytes());
        out.extend_from_slice(&(names.len() as u16).to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&[0, 0]);
        out
    }

    #[test]
    fn each_allowed_type_is_recognised_by_its_first_bytes() {
        let mut webp = b"RIFF\x10\0\0\0WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0; 8]);
        let docx = zip_with(&["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
        let xlsx = zip_with(&["[Content_Types].xml", "xl/workbook.xml"]);
        let pptx = zip_with(&["[Content_Types].xml", "ppt/presentation.xml"]);
        let mut ole = OLE.to_vec();
        ole.extend_from_slice(&[0; 504]);
        let cases: [(&str, &[u8], &str); 14] = [
            ("photo.JPG", b"\xFF\xD8\xFF\xE0\0\x10JFIF", "jpeg"),
            ("photo.jpeg", b"\xFF\xD8\xFF\xDB", "jpeg"),
            ("map.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR", "png"),
            ("pic.webp", &webp, "webp"),
            ("ticket.pdf", b"%PDF-1.7\n%\xE2\xE3", "pdf"),
            ("letter.docx", &docx, "docx"),
            ("budget.xlsx", &xlsx, "xlsx"),
            ("slides.pptx", &pptx, "pptx"),
            ("old.doc", &ole, "doc"),
            ("old.xls", &ole, "xls"),
            ("old.ppt", &ole, "ppt"),
            (
                "notes.txt",
                "Packing list:\n- hats\n- 灯笼\n".as_bytes(),
                "txt",
            ),
            (
                "costs.csv",
                b"\xEF\xBB\xBFitem,cost\r\nferry,12.50\r\n",
                "csv",
            ),
            ("tabs.txt", b"a\tb\x0cc", "txt"),
        ];
        for (name, bytes, kind) in cases {
            assert_eq!(detect(name, bytes), Ok(kind), "{name}");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        let zip = zip_with(&["readme.txt", "word/fake.xml"]);
        let refused: [(&str, &[u8]); 16] = [
            ("page.html", b"<!doctype html><p>hi</p>"),
            ("page.htm", b"<html></html>"),
            (
                "logo.svg",
                b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            ),
            ("run.js", b"alert(1)"),
            ("setup.exe", b"MZ\x90\0\x03"),
            ("tool", b"\x7fELF\x02\x01"),
            ("archive.zip", &zip),
            // A ZIP archive named as Word, without the parts of a Word file.
            ("fake.docx", &zip),
            // A web page or SVG named as text, or a script.
            ("page.txt", b"  <!DOCTYPE html><script>alert(1)</script>"),
            ("logo.txt", b"<?xml version='1.0'?><svg/>"),
            ("run.txt", b"#!/bin/sh\nrm -rf /"),
            ("bin.csv", b"a,b\0c"),
            ("latin1.txt", b"caf\xE9"),
            // A program or a page named as a picture or a PDF.
            ("photo.jpg", b"MZ\x90\0"),
            ("doc.pdf", b"<html><body>%PDF-</body></html>"),
            ("empty.txt", b""),
        ];
        for (name, bytes) in refused {
            assert!(detect(name, bytes).is_err(), "{name}");
        }
        let big = vec![b'a'; MAX_BYTES + 1];
        assert!(detect("big.txt", &big).unwrap_err().contains("10 MB"));
    }

    #[test]
    fn names_are_kept_safely() {
        assert_eq!(
            clean_name("C:\\Users\\x\\Ferry ticket.pdf"),
            "Ferry ticket.pdf"
        );
        assert_eq!(clean_name("../../etc/passwd.txt"), "passwd.txt");
        assert_eq!(clean_name("invoice\u{202E}fdp.txt"), "invoicefdp.txt");
        assert_eq!(clean_name("a\u{0}b\nc.csv"), "abc.csv");
        assert_eq!(clean_name(".hidden.txt"), "hidden.txt");
        let long = format!("{}.pdf", "x".repeat(400));
        let kept = clean_name(&long);
        assert_eq!(kept.chars().count(), MAX_NAME);
        assert!(kept.ends_with(".pdf"));
    }

    #[test]
    fn downloads_are_bytes_except_pictures() {
        assert_eq!(media_type("pdf"), "application/octet-stream");
        assert_eq!(media_type("txt"), "application/octet-stream");
        assert_eq!(media_type("png"), "image/png");
        assert_eq!(size_words(820), "820 bytes");
        assert_eq!(size_words(12 * 1024 + 100), "12 KB");
        assert_eq!(size_words(3_565_158), "3.4 MB");
    }
}
