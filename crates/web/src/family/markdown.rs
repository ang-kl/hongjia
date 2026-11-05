//! Markdown documents (`.md`) are shown as formatted pages in the document frame (the owner's
//! request, 5 November 2026). The stored file never changes and its download stays the original.
//! Raw HTML in the file is shown as text and never runs; links go only to web, mail or same-page
//! addresses, and open in a new tab; pictures only from `https:` addresses.

use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, html};

/// Whether a text document's file name marks it as Markdown.
pub fn is_markdown(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// A whole page for the frame: the rendered Markdown on a white page.
pub fn page(title: &str, source: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{title}</title>
<style>{STYLE}</style>
</head>
<body>
<main class="md">
{body}</main>
</body>
</html>
"#,
        title = escape(title),
        body = render(source),
    )
}

/// The Markdown as HTML, made safe as described at the top of this file.
pub fn render(source: &str) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    let events = Parser::new_ext(source, options).map(|event| match event {
        // Raw HTML is shown as written, never run.
        Event::Html(text) | Event::InlineHtml(text) => Event::Text(text),
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) => Event::Start(Tag::Link {
            link_type,
            dest_url: if safe_link(&dest_url) {
                dest_url
            } else {
                CowStr::Borrowed("")
            },
            title,
            id,
        }),
        Event::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) => Event::Start(Tag::Image {
            link_type,
            dest_url: if dest_url.to_ascii_lowercase().starts_with("https://") {
                dest_url
            } else {
                CowStr::Borrowed("")
            },
            title,
            id,
        }),
        other => other,
    });
    let mut out = String::with_capacity(source.len() * 3 / 2);
    html::push_html(&mut out, events);
    out.replace(
        "<a href=\"http",
        "<a target=\"_blank\" rel=\"noopener\" href=\"http",
    )
    .replace("<table>", "<div class=\"table\"><table>")
    .replace("</table>", "</table></div>")
}

fn safe_link(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:")
        || lower.starts_with('#')
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// White page, serif headings that step down by level, tables that wrap long addresses.
const STYLE: &str = "\
:root{color-scheme:light}\
html,body{background:#fff}\
body{margin:0;color:#1d1b18;font:16px/1.65 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}\
main{max-width:56rem;margin:0 auto;padding:28px 20px 64px;overflow-wrap:anywhere}\
h1,h2,h3,h4,h5,h6{font-family:Georgia,'Times New Roman',serif;font-weight:600;line-height:1.2;margin:1.4em 0 .5em}\
h1{font-size:2.1rem;margin-top:.3em}\
h2{font-size:1.65rem;padding-bottom:.25em;border-bottom:1px solid #e7e1d5}\
h3{font-size:1.3rem}\
h4{font-size:1.1rem}\
h5,h6{font-size:1rem}\
p,ul,ol,dl{margin:0 0 .9em}\
li{margin:.2em 0}\
a{color:#7a5c28;overflow-wrap:anywhere}\
code{font:.9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f6f3ee;padding:.1em .3em;border-radius:4px}\
pre{background:#f6f3ee;padding:12px 14px;border-radius:8px;overflow-x:auto}\
pre code{background:none;padding:0}\
blockquote{margin:0 0 1em;padding:.2em 0 .2em 1em;border-left:3px solid #dcc8a2;color:#45413a}\
hr{border:0;border-top:1px solid #e7e1d5;margin:2em 0}\
.table{overflow-x:auto;margin:0 0 1.2em}\
table{border-collapse:collapse;width:100%;font-size:.88rem}\
th,td{border:1px solid #e7e1d5;padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}\
th{background:#faf7f1;font-weight:600;overflow-wrap:normal}\
img{max-width:100%;height:auto}\
input[type=checkbox]{margin-right:.4em}";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_files_are_recognised() {
        assert!(is_markdown("SOURCES.md") && is_markdown("notes.MARKDOWN"));
        assert!(!is_markdown("notes.txt") && !is_markdown("page.html"));
    }

    #[test]
    fn headings_tables_and_links_are_formatted() {
        let html = render(
            "# Title\n\n## Part\n\n| A | B |\n|---|---|\n| 1 | [site](https://example.org) |\n\n- [x] done\n",
        );
        assert!(html.contains("<h1>Title</h1>") && html.contains("<h2>Part</h2>"));
        assert!(html.contains("<div class=\"table\"><table>") && html.contains("</table></div>"));
        assert!(html.contains(
            "<a target=\"_blank\" rel=\"noopener\" href=\"https://example.org\">site</a>"
        ));
        assert!(html.contains("type=\"checkbox\""));
    }

    #[test]
    fn raw_html_and_unsafe_addresses_never_run() {
        let html = render(
            "<script>alert(1)</script>\n\nText <img src=x onerror=alert(2)> and [x](javascript:alert(3)) ![p](http://example.org/p.png) ![q](https://example.org/q.png)\n",
        );
        assert!(!html.contains("<script") && html.contains("&lt;script&gt;"));
        assert!(!html.contains("<img src=x") && html.contains("&lt;img src=x"));
        assert!(!html.contains("javascript:"));
        assert!(html.contains("src=\"\"") && html.contains("src=\"https://example.org/q.png\""));
    }

    #[test]
    fn the_page_is_white_and_escapes_its_title() {
        let page = page("Sources <v5>", "# Hi");
        assert!(page.contains("<title>Sources &lt;v5&gt;</title>"));
        assert!(page.contains("background:#fff") && page.contains("<h1>Hi</h1>"));
    }
}
