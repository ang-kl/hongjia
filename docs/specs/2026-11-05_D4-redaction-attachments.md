---
flow: spec
title: "D4 - Redaction and file attachments"
act: "directive"
force: "MUST"
status: "Built on the owner's instruction \"continue, merge when green\" (5 November 2026), on top of D3 (PR #13). The open choices in chat № 38 (4 and 5) were not answered, so the owner's stated defaults are used."
scope:
  - "crates/web/**"
  - "db/migrations/0009_d4_redaction_attachments.sql"
  - "web/assets/doc-view.mjs"
  - "web/assets/frame-helper.js"
  - "web/assets/site.css"
  - "web/test/redaction-attachments.test.mjs"
  - "tests/browser/p1-flow.mjs"
  - "docs/specs/2026-11-05_D4-redaction-attachments.md"
  - "README.md"
---

# D4 - Redaction and file attachments

Version 0.1 · 5 November 2026 · Asia/Singapore · follows D3 (signatures, the loupe and pictures). This is the last slice of the annotation suite.

## Owner request and decisions

From the owner's list in chat (5 November 2026):

- "Redaction: Permanently black out and remove sensitive text or content upon saving."
- "File Attachments: Embed external files or author headshots directly into specific points."

The owner said "continue, merge when green" without answering choices 4 and 5 of chat № 38, so the defaults stated there are used:

- **Redaction.** Only the document's uploader or the owner marks and applies redactions, and applying needs the word REDACT typed in capitals. Applying permanently deletes every older version of the document, because those still contain the words. There are no backups.
- **Attachments.** Any family member may attach a file; the person who attached it, or the owner, deletes it. Files are stored on the site and are only ever downloaded, never opened inside the site. The limit is 10 MB, and the types are JPEG, PNG, WebP, PDF, Word, Excel and PowerPoint (docx, xlsx, pptx and the older doc, xls, ppt), plain text and CSV.

## What is built

### Redaction, in two steps

- **Mark.** The annotation menu (right-click, a long press, two Pencil taps, or Shift+F10) has **Redact**, after Replace. It is shown only to the uploader and the owner, and needs selected text.
  - On a picture it is shown greyed out as "Redact (not for pictures yet)"; the server refuses it there too (422).
  - A mark of the new kind `redaction` keeps the passage and up to 32 characters either side, like a highlight. Anyone else is refused (403), and a redaction carries no words of its own and no place.
  - Until applied, the passage shows as a black box in the document (drawn by the helper, like a highlight). The words stay in the stored file until then.
  - The panel lists the passages under **Pending redactions**, for everyone when there are some. Their author or the owner deletes them.
- **Apply.** The uploader or the owner types REDACT and presses **Apply redactions permanently** in the panel. `POST /documents/{key}/redactions/apply` then:
  - finds every pending passage in the latest stored file, read the way a browser reads it (below);
  - refuses, changing nothing, if any passage is not in the stored file or appears in more than one place that the saved words around it cannot tell apart. The message names the passage ("Passage 2 of 3") and says what to do;
  - in **one transaction**, with the document locked: adds a new version with every passage blacked out; permanently deletes every older version's row (content, search text and headings); replaces the blacked-out words in what other marks saved (their quote and the words before and after it, comment and note words, inserted and replacement words, field labels on comments) and in saved fields' labels; deletes the pending marks it applied (one added meanwhile stays pending); records when and by whom on the document; and writes an audit entry that names the document, the version and the counts, never the words;
  - returns to the document with a notice: how many passages were blacked out, how many times the same words still appear elsewhere (counted, never guessed at), and a reminder that the title, hashtags and attached file names are not changed.
- **Version numbers keep counting.** After redacting version 2, the document has only version 3. The Versions section says "Earlier versions were removed by a redaction on DATE (SGT) by NAME." "org" and the frame return 404 for the deleted versions.

### How a passage is found

The passage people selected comes from the live page (the text of the body, as the helper sees it). The server reads the stored file the same way, in `family/redact.rs`:

- Only text between tags counts. Nothing inside a tag or an attribute, a comment, a doctype, or the content of `script`, `style`, `textarea`, `title`, `noscript` or `template` is read or changed (the helper skips the same). The content of `xmp`, `iframe`, `noembed`, `noframes` and `plaintext` counts as written, without decoding, as a browser keeps it.
- Text before the body starts (the head's spaces) is left out, as in a browser. A file without a `<body>` tag starts its body at the first content.
- Character references are decoded: numeric ones (with the browser's Windows-1252 mapping for 128 to 159), the legacy names without a semicolon (`&amp`, `&copy` and five more), and 131 common names. An unknown name is left as written, so a passage across it is not found and nothing is applied (never a wrong place).
- CR LF and a lone CR read as one line feed, and the first line feed after `<pre>` is dropped, as in a browser.
- Each character remembers the bytes it came from, so blacking out rewrites exactly those bytes.
- When the words appear more than once, the saved words before and after decide: the place where the most of them agree wins. A tie is refused.

**Blacking out keeps the length.** Every letter, digit or sign becomes `█`; spaces and line breaks stay, so long passages still wrap and the page's text keeps the same number of characters. Because of that, other marks keep their places: each is found in the old text and read again from the new one at the same place. A mark that cannot be found (a page that writes its own text) has whole appearances of the words replaced instead, plus a passage cut off at either end of the words before or after it (four characters or more).

### File attachments

- **Attach.** **Attach file…** in the annotation menu (after My signature) opens the file picker; the file is pinned at the point that was right-clicked, like a sticky note.
  - `POST /documents/{key}/attachments` (multipart, with the form token and the Origin check) takes the file and the place. It replies with the new mark as JSON, or `{"error": "..."}` with the reason, which the page shows in the Attachments section.
  - A mark of the new kind `attachment` holds the place and the file's name; the file is in the new table `document_attachments`: the bytes, their SHA-256, the size, the cleaned name, the type, who and when. At most 100 per document.
  - It moves like a note (its author only), is deleted by its author or the owner (the file goes with it), and is never edited. A plain mark of this kind is refused: a file always comes with it.
- **Checked by name and by first bytes.** Both must agree on an allowed type:
  - JPEG `FF D8 FF`; PNG's eight-byte signature; WebP `RIFF....WEBP`; PDF `%PDF-`;
  - docx, xlsx, pptx: a ZIP archive whose central directory lists `[Content_Types].xml` and `word/`, `xl/` or `ppt/` parts (a plain ZIP, or a ZIP renamed, is refused);
  - doc, xls, ppt: the OLE2 compound file signature;
  - txt and csv: UTF-8 (a byte-order mark is fine) with no control characters but tab, line breaks and form feed, and not starting like a web page, SVG, XML, a script (`#!`) or a comment.
  - Everything else is refused, including HTML, SVG, scripts, programs (they match no allowed signature) and anything over 10 MB.
- **Names.** The last part of a path only, without control characters or the invisible characters that reverse text direction (so `invoice` + U+202E + `fdp.txt` cannot pose as a PDF), without leading dots, and at most 200 characters with the extension kept.
- **Downloads only.** `GET /documents/{key}/attachments/{id}` is for signed-in members (others go to sign-in) and only for an attachment of that document. It sends `Content-Disposition: attachment` with an ASCII name and the exact name in RFC 5987 form, `application/octet-stream` (pictures keep `image/jpeg`, `image/png` or `image/webp` but are still saved, not shown), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy: same-origin`.
- **In the panel.** An **Attachments** section lists each file: its name, a Download link, its type and size, who attached it and when (SGT). Over the document, a paperclip with the file's name marks the point; pressing it opens the entry.
- **Deleting the document** deletes its attachments (the rows cascade with the document and with each mark).

### Database (migration `0009`)

- `annotations_kind_check` adds `redaction` and `attachment`. A new `annotations_d4_check` gives a redaction a passage and nothing else, and an attachment a place and a name of 1 to 200 characters.
- `documents.redacted_at` and `documents.redacted_by` record the last redaction.
- `document_attachments` as above, with `ON DELETE CASCADE` from both the document and the mark.

`DOCUMENT_CSP`, `IFRAME_SANDBOX` and the family CSP are unchanged. Text people write still never enters the document frame; the paperclips are drawn by the page over it.

## Invariants and checks

| Invariant | Check |
|---|---|
| Only the uploader or the owner marks or applies a redaction; never on a picture | `redactions_mark_a_passage_and_attachments_need_their_file` (unit); `redactions_are_marked_and_applied_only_by_the_uploader_or_the_owner`, `a_passage_that_cannot_be_placed_applies_nothing` (database); the browser check (no Redact for another member, 403 from the server, greyed out on a picture) |
| Applying needs REDACT typed in capitals | database test: empty, lowercase and DELETE are refused and nothing changes |
| Only text is changed: never inside tags, attributes, comments, scripts or styles; entities decoded; the saved words pick the place | `the_model_reads_text_as_a_browser_does`, `redaction_touches_text_only`, `entities_and_lines_are_matched_decoded_and_spaces_kept`, `prefix_and_suffix_pick_the_right_place`, `without_a_body_tag_the_body_starts_at_the_first_content`, `text_files_and_overlapping_passages` (unit) |
| A passage that is missing or unclear applies nothing | `a_missing_or_unclear_passage_applies_nothing` (unit); `a_passage_that_cannot_be_placed_applies_nothing` (database: one version, the file and both marks unchanged) |
| Older versions are deleted and not served; the new version has no trace of the words | database test: only version 3 left, `original?v=1`, `raw?v=1` and `v=2` return 404; no stored file, search text, heading, mark, field label or audit entry holds the words; browser check |
| Other marks keep their place without the words | `other_marks_lose_the_words_but_keep_their_place` (unit); database test (a highlight's saved words before it) |
| The audit entry never contains the words | database test (`traces` over `audit_log`) |
| Attachments: allowed types only, by name and first bytes; 10 MB | `each_allowed_type_is_recognised_by_its_first_bytes`, `everything_else_is_refused` (unit); database test (HTML, SVG, EXE, HTML named .txt, EXE named .png, ZIP, ZIP named .docx, oversize) and the browser check (.html refused with a reason) |
| Downloads are attachments only, for members, with the safe headers | database test (each header, byte for byte, RFC 5987 name, signed-out goes to sign-in, another document's address 404); browser check (PDF and PNG download unchanged) |
| Any member attaches; only the attacher moves it; the attacher or the owner deletes it; nobody edits it; it goes with the document | database test |
| All seven device classes, light and dark, with no CSP breach and no sideways scroll | `tests/browser/p1-flow.mjs`: 14 pages × 7 classes × 2 schemes |

## Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 66 unit (16 new), 33 database (3 new), 2 Dockerfile and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features --locked -- -D warnings` and `cargo fmt --check` are clean.
- `node --test "web/test/**/*.test.mjs"`: 57 of 57 (5 new: sizes, type names, who sees Redact, the helper's new kinds, the picker's types).
- `tests/browser/p1-flow.mjs` (release build): 196 of 196 (14 pages × 7 classes × 2 schemes, plus the steps before the sweep). It marks two passages as the owner (black boxes), checks another member gets no Redact and a 403, attaches a PDF, applies with REDACT (blacked-out words, one version left, 404 for the old one, the attachment kept), attaches a PNG, is refused an `.html` file with a reason, downloads both files unchanged, and checks Redact is greyed out on a picture.

## Limits

- Pictures cannot be redacted yet: upload an edited picture as a new version instead.
- Words a page writes with its own script are not in the stored file, so they cannot be redacted; applying says so and changes nothing.
- Attribute values (a link's address, an image's alt text, a tooltip), the page's own `<title>` and the content of scripts and styles are never changed, by design. If the same words are there, they stay; the notice counts only the page's text.
- Plain-text documents are shown without the helper (as before D4), so the annotation menu does not open on them and passages are marked in HTML documents in practice. The server handles text files too.
- Spaces are kept, so the number of words in a passage and their lengths can be seen, as with a printed black-out.
- The title, the hashtags and attached files' names are not changed by a redaction; the notice reminds the person to check them.
- Uncommon named character references (about 2100 of HTML's names) are not decoded; a passage across one is refused rather than guessed.
- doc, xls and ppt are recognised by the shared OLE2 signature, so the three cannot be told apart from each other; they are only ever downloaded.
- Attachments are not scanned for viruses; they are never opened inside the site.
- Touch and the Pencil were simulated in Chromium, not tried on a real iPad.
