---
flow: spec
title: "P2b - Filing numbers, the management panel, hashtags, the upload check and the full-window viewer"
act: "directive"
force: "MUST"
status: "Pull requests A, B and C, built on the owner's instruction \"execute\" (5 November 2026). Each merge needs the owner's go-ahead."
scope:
  - "crates/web/**"
  - "db/migrations/0003_p2b_documents_panel.sql"
  - "db/migrations/0004_p2b_search_contents.sql"
  - "db/migrations/0005_p2b_annotations_fields.sql"
  - "web/assets/frame-helper.js"
  - "web/assets/doc-view.mjs"
  - "web/test/frame-helper.test.mjs"
  - "web/test/doc-view.test.mjs"
  - "web/assets/explorer.mjs"
  - "web/assets/globe-layout.mjs"
  - "web/test/globe-layout.test.mjs"
  - "web/assets/site.css"
  - "tests/browser/p1-flow.mjs"
  - "docs/specs/2026-11-05_P2b-documents-panel.md"
  - "README.md"
---

# P2b - Documents: filing, management and the viewer

Version 0.1 · 5 November 2026 · Asia/Singapore · parent plan: sections 5.4, 5.8 and P2.

## Owner decisions (chat, 5 November 2026)

- Addresses follow `yyyy-mmdd_#N`: the day filed (Singapore time) and the number that day, restarting daily. The address is `/documents/2026-1105_1` because browsers cut everything after `#`; pages show `2026-1105_#1`. Old numeric addresses forward.
- Any family member may annotate (pull request C). Only the person who added a document, or the owner, may rename, retag, replace or delete it.
- Annotations are Word-style (select text, then comment), in pull request C.
- Delete is permanent, after typing DELETE. There are no backups (owner decision, 5 November 2026).
- Hashtags are suggested from each upload and are editable by the uploader and the owner.
- Delivery in three pull requests: A (this spec), B (🛰️ satellite search, globe and 📁 contents) and C (annotations and saved form fields).
- For HTML uploads, the owner's design specification ("UI/UX & Creative Development System Specification", Styles A to E) is considered in three ways: (a) documents built with that stack run in the frame; (b) each upload is checked and the result shown in its panel; (c) the site's own interface follows Style D. Next.js and Tailwind are not used for the site itself, which keeps the earlier decision (Rust server, plain JavaScript, no build step).
- Saved form fields (pull request C): the uploader chooses per document whether ticks are shared or personal, and every family member may fill in.
- Uploads come from the family, not from Claude; only the first document was added by Claude, on the owner's instruction.

## What pull request A builds

- Migration `0003`: `filing_counters` (a per-day counter, so a number is never given out twice, even after a delete), `documents.filed_on` and `day_no` (back-filled for existing documents), `document_tags` (ordered hashtags), and the upload check on `document_versions` (`libraries`, `style_guess`, `warnings`, `field_count`, `checked`). Versions from before the check are checked when the server starts.
- Routes: `/documents/{key}` and `/documents/{key}/raw` (`?v=N` for an earlier version); `POST /documents/{key}/rename`, `/tags`, `/version` (multipart, 10 MB) and `/delete`. Every change checks the session, the form token, the Origin and the person's right to change the document; refusals are 403, a wrong confirmation word is 400, and every change is written to the audit log.
- The frame policy now allows scripts from cdnjs, jsDelivr, unpkg and the Tailwind CDN, stylesheets from Google Fonts, cdnjs, jsDelivr and unpkg, and fetches from cdnjs, jsDelivr and unpkg (3D models and textures). It stays sandboxed with an opaque origin; `allow-same-origin`, `unsafe-eval`, forms and embedded frames stay off. A unit test pins the policy to the host lists the upload check uses.
- The upload check (`family/doccheck.rs`, rule-based, no network or AI): libraries used (Three.js, GSAP, ScrollTrigger, MotionPathPlugin, SplitText, Lenis, Tailwind, Next.js), the closest of Styles A to E (labelled a rough guess, or "no clear match"), fillable fields, and warnings for scripts or styles from other sites, http links, files missing from a single upload (for example `model.glb`), calls to other sites, browser storage, embedded frames, outside form targets and checkboxes drawn without real form fields.
- Hashtag suggestions: from the title, meta keywords and description, h1 and h2 headings, and the file name; capitalised pairs become one tag (`laketown`), never across punctuation; month and year become one tag (`april2031`). Typed hashtags keep letters and digits in any script, lowercased, at most 20 of 40 characters.
- The viewer fills the window. The panel (Details, Hashtags, Versions, Upload check, Manage) sits beside the document when the window is landscape or square and at least 720 px wide, and otherwise opens as a bottom sheet with Manage (CSS `:target`, no script). The device tiers from `site.mjs` set the panel width (desktop, tablet, phone). The documents list follows Style D: grouped by month, serif section headers with count badges, hairline rows, pill hovers of 150 ms with `cubic-bezier(0.22, 1, 0.36, 1)`, and no motion under reduced-motion settings.

## Invariants and checks

| Invariant | Check |
|---|---|
| Only the uploader or the owner can rename, retag, replace or delete | `only_the_uploader_and_the_owner_change_or_delete` (database test) |
| Filing numbers are unique, dated in Singapore time, never reused; old addresses forward | `documents_are_filed_by_date_and_number` |
| The stored original is never changed; earlier versions stay readable | `hashtags_versions_and_the_upload_check`, `documents_upload_list_view_and_sandboxed_raw` (byte-for-byte) |
| The frame never gets `allow-same-origin`, and its policy lists exactly the library sites | `sandbox_never_grants_same_origin`, `frame_policy_lists_exactly_the_library_sites` |
| No family names, hashtags or document text in the repository | test data uses invented names and places; grep before every push |
| Panel beside in landscape, sheet in portrait; no sideways scroll; no CSP breach | `tests/browser/p1-flow.mjs`, 7 device classes, light and dark |

## Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 26 unit, 15 database (3 new), 2 Dockerfile and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` are clean.
- `tests/browser/p1-flow.mjs`: 126 of 126 checks pass (9 pages × 7 device classes × light and dark), including the document page: the frame is at least 55% of the window's height, the panel is beside it on the notebook and landscape tablet, Manage opens and Close shuts the sheet on the portrait tablet, mini tablet and phones, and the document's own script runs in the frame.
- The upload check was run locally on the owner's first document (not committed): no warnings, 6 fillable fields, closest style D.

## Not in this pull request

- 🛰️ satellite search, the globe and 📁 contents (pull request B).
- Annotations, saved form fields and the storage stand-in for documents that use browser storage (pull request C).

## Pull request B: 🛰️ satellite search, the globe and 📁 contents

Version 0.2 · 5 November 2026 · Asia/Singapore. Built on the owner's instruction "execute" (№ 26 and № 27); merge needs the owner's go-ahead.

### What pull request B builds

- **Buttons.** Every signed-in page has the michi button group at the bottom right, in the michi 0.9.1 order: 🛰️ satellite, globe, 📁 folder. They are plain JavaScript modules (`web/assets/explorer.mjs`, `web/assets/globe-layout.mjs`) with no build step, served by the Rust binary. The family pages' CSP is unchanged (`script-src 'self'`, `style-src 'self'`, `connect-src 'self'`). Positions are set through the CSSOM, never with style attributes.
- **🛰️ Satellite.** It searches the title, the hashtags and the plain text of every document's latest version on the server (`GET /api/search?q=`; signed-in members only; at most 100 characters; at most 20 results). Ranking puts title matches first, then hashtag matches, then PostgreSQL `simple` text rank, then the newest; an `ILIKE` match is also accepted, so Chinese text is found. Each result carries a plain-text snippet around the first match, which the browser inserts with `textContent` only. The field stays closed until the satellite is pressed; while the globe is open it docks above the globe. Typing lights matching pins; Enter opens the first result's card, which lists up to five other results.
- **Globe.** A library globe ported from michi's globe (`GET /api/library`). Islands are the most common hashtags shared by two or more documents, up to six; documents without a shared hashtag go to an "Other" island, which takes one of the six places. Each document is a pin. The card shows the filing label, title, hashtags, the snippet when searching, and an Open link. On a document page the globe turns to that document's pin and shows its card. The globe turns by drag, by the arrow keys or with an idle turn (double-tap or a long press starts or stops it; never under reduced motion). Wheel, pinch and plus and minus zoom it. Escape closes the field, then the card, then the globe. Tab stays inside the globe and its buttons, focus returns to the button that opened it, and a status line speaks to screen readers.
- **📁 Contents.** On a document page it lists that document's headings that have anchors; choosing one moves the frame to `/documents/{key}/raw#anchor` by fragment navigation, with no script added to the frame. Headings without an anchor are counted, with a note that jumping to them comes with annotations. On every other page it lists all documents by the month they were filed.
- **Index.** Migration `0004` adds `text_content` (HTML without title, scripts, styles and templates; tags dropped; entities decoded; whitespace collapsed; at most 200,000 characters) and the headings (levels, anchors and texts as parallel arrays) to each version. Versions uploaded earlier are indexed when the server starts, together with the upload check.
- **Layout.** The buttons never cover Manage. Beside a document, the panel leaves room for them at its end. The open sheet hides them, and every other page leaves room for them at the bottom. On phones, the slide-out search field opens above the buttons, so it stays inside the window.

### Decisions made while building (not specified by the owner)

- A heading's anchor is its own `id`, or else the `id` of a section, article, div, header or main element that opens between the previous heading and this one (a section's first heading names the section). Headings of levels 1 to 3 are listed.
- When no hashtag is shared by two or more documents, each document's first hashtag names its island, so a library of one document still shows named land rather than only "Other".
- The page's `<title>` is left out of the indexed text because the title is searched on its own; otherwise every snippet would start with it.

### Invariants and checks (pull request B)

| Invariant | Check |
|---|---|
| Search and the library are for signed-in members only | `search_finds_titles_hashtags_and_text` (401 for a stranger, nothing leaked) |
| Search finds titles, hashtags, body text and Chinese text, never script text; `%` is literal; at most 100 characters and 20 results | `search_finds_titles_hashtags_and_text`, `search_returns_at_most_twenty`, `like_patterns_are_literal` |
| JSON is escaped (quotes, backslashes, control characters, `<`, `>`, `&`, line separators) and inserted with `textContent` only | `strings_are_escaped`, `lists_and_objects`; `explorer.mjs` uses no `innerHTML` |
| Contents lists anchored headings and moves the frame without reloading it | `headings_for_contents`, `library_and_contents_for_the_globe`; browser walk (hash `#stays`, scrolled, the frame's own script state kept) |
| Button order and michi rules: field closed until pressed, Enter opens the first result, Escape order, focus return, 44 px targets | browser walk on the documents list and the document page, 7 device classes, light and dark |
| No CSP breach, no sideways scroll, buttons never cover Manage or the open sheet | `tests/browser/p1-flow.mjs` |
| Islands: at most six, every document on the globe once | `web/test/globe-layout.test.mjs` |
| No family names or document text in the repository | invented test data; grep of the staged diff before committing |

### Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 32 unit, 18 database (3 new), 2 Dockerfile and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` are clean.
- `node --test "web/test/**/*.test.mjs"`: 21 of 21 (6 new for the globe layout).
- `tests/browser/p1-flow.mjs`: 126 of 126 checks pass (9 pages × 7 device classes × light and dark). The button walk runs on the documents list and the document page in all 28 of those combinations, and the button presence and order check runs on every signed-in page.

## Pull request C: annotations, saved fields and the storage stand-in

Built on the owner's decisions in № 26 and № 28 (5 November 2026): every family member may fill in fields and annotate; people delete their own annotations and the owner may delete any; annotations are Word-style (select text, then comment) and may attach to a form field; the uploader or the owner chooses per document whether fields are shared or personal; documents that use browser storage work through a stand-in.

### What it builds

- **The helper in the frame.** When an HTML document is shown, one inline script (`web/assets/frame-helper.js`) is inserted just after the opening `<head ...>` tag if one starts in the first 64 KB (comments skipped, nothing after `<body>`), else after the doctype, else at the start (after a byte-order mark). The stored file and its SHA-256 never change; the frame policy and the iframe sandbox are unchanged (the policy already allows inline scripts). Text documents are sent exactly as stored. The script removes itself from the page as it starts, embeds this viewer's saved values as JSON escaped with `family::json` (so `</script` cannot end it), and talks only to the parent page.
- **Storage stand-in.** `window.localStorage` and `window.sessionStorage` are replaced (verified in Chromium in the opaque-origin sandbox) by synchronous in-memory stores that also support property access (`localStorage.visits`). `localStorage` starts with the saved values and its writes are saved on the site; `sessionStorage` stays in memory.
- **Saved fields.** Checkboxes, radio buttons, text, number and date fields, drop-downs and text areas are restored when the page loads (and again after it has loaded, for fields that its own scripts build) and changes are sent to the parent. Password, file and hidden fields are never read or sent. A field's key is its radio group name, else its `id`, else `check:name=value` for named checkboxes, else its `name`, else its position in the page plus a short hash of its label text.
- **Annotations.** When text is selected in the frame (a quote plus up to 32 characters either side) or a field is focused, the page shows **Comment** (or **Comment on this field**). The comment is typed only in the panel's Annotations section and saved with Save; a document cannot create one by itself. The panel lists each annotation with its quote or field, text, author, time and version, and Delete where allowed. Highlights are drawn in the live page only (`<mark data-hj-id>`, and an outline on annotated fields); choosing a highlight focuses its item in the panel, and choosing an item's quote scrolls the frame to it. A comment on the whole document is also possible, including on text documents, and the composer works as a plain form without the page's script.
- **Saved fields section.** It shows the mode; in shared mode, the latest eight changes (label or key, value with ticks in words, who, when); in personal mode, how many answers the viewer has saved. The uploader and the owner see a form to switch modes. Switching keeps both sets; each mode shows its own.
- **Server.** Migration `0005`: `documents.fields_mode` (`shared` or `personal`), `document_fields` (a shared copy or one per person; `field` or `storage`; unique per document, copy, kind and key, `NULLS NOT DISTINCT`), and `annotations`. Endpoints: `POST /documents/{key}/fields` (fetch with the form token header only), `GET` and `POST /documents/{key}/annotations` (the POST also accepts a plain form), `POST /documents/{key}/annotations/{id}/delete` (the author or the owner), and `POST /documents/{key}/fields-mode` (the uploader or the owner). Every change checks the session, the form token and the Origin. Mode changes and annotation deletes go to the audit log.
- **The page module.** `web/assets/doc-view.mjs` accepts a message only if it comes from the frame's window, has one of six known types and carries strings within limits (key 200, field value 4000, storage value 8000, label 200, quote 1000, words around 64); writes are limited to 120 per 10 seconds and other messages to 60 per second. Every text it shows is inserted with `textContent`; there is no `innerHTML`.

### Deviations from the design given to this pull request, and why

- Radio buttons with a name share one key, the group name, whose value is the chosen option. A key per button would leave the old choice marked as chosen, because browsers do not report a radio button being cleared. Named checkboxes add their value (or position) to the key, so several checkboxes sharing a name do not overwrite one another.
- Storage values may be up to 8000 characters (fields 4000), because pages often keep their state as one JSON text.
- Storage writes follow the document's mode, as fields do.
- Saved values are visible to the document's own scripts while it is open (they are its own fields), and a document's scripts can write to its own saved fields. They cannot reach other documents, comments, the session or the panel.
- The 📁 contents note for headings without an anchor now says they cannot be jumped to yet, instead of promising it with annotations, because this pull request does not add that.

### Invariants and checks (pull request C)

| Invariant | Check |
|---|---|
| The stored file and its hash never change; the shown file is the stored file plus one helper | `saved_fields_are_shared_or_personal`, `documents_upload_list_view_and_sandboxed_raw`, `injection_keeps_every_original_byte` |
| A saved value cannot end the helper's script | `the_helper_script_is_safe_to_inline`, `field_and_storage_writes_are_checked` (`</script><b>` stored and sent escaped) |
| The helper goes after `<head>`, else after the doctype, else at the start | `the_helper_goes_after_head_or_the_doctype` |
| Any member fills in; shared mode shows one copy, personal mode only one's own; only the uploader or the owner switches | `saved_fields_are_shared_or_personal`; browser check (another member does not see a personal tick) |
| Writes need the form token header and this site's Origin; sizes and the 500-key limit hold | `field_and_storage_writes_are_checked` |
| Any member annotates; the author or the owner deletes; others are refused; bodies are escaped | `annotations_by_any_member_deleted_by_author_or_owner` |
| Only known, bounded messages from the frame are accepted, and no message creates an annotation | `web/test/doc-view.test.mjs` |
| Anchors find the right passage | `web/test/frame-helper.test.mjs` |
| Ticks survive a reload; the storage stand-in keeps counting; select, Comment, Save, highlight, Delete; no CSP breach or sideways scroll | `tests/browser/p1-flow.mjs`, 7 device classes, light and dark |
| No family names or document text in the repository | invented test data; grep of the staged diff before committing |

### Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 35 unit (3 new), 21 database (3 new), 2 Dockerfile and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features --locked -- -D warnings` and `cargo fmt --check` are clean.
- `node --test "web/test/**/*.test.mjs"`: 31 of 31 (10 new).
- `tests/browser/p1-flow.mjs`: 126 of 126 checks pass. Before the page loop it ticks a checkbox and sees it ticked after a reload, sees a `localStorage` visit counter keep counting, selects text, comments, sees the highlight, deletes it and sees the highlight go, comments on a field, switches to personal mode and confirms another member does not see the personal tick, and switches back to the shared copy. On every document page in the loop the saved tick, the highlight and both annotations are shown.


## Owner follow-up: the menu button and the sidebar's × (5 November 2026, afternoon)

Owner request in chat: "sidebar can close (×)"; "left FAB should be the menu: Latest Document, Turn (Ö) on / off (ø) Sidebar, Documents ▲/▼, Journal, Setting {Owner} ▲/▼ with Sign out {user}"; the right side keeps 🛰️ satellite, globe and 📁 contents (michi). Shipped with pull request C.

- **Menu button, bottom left, on every signed-in page.** Its items are Latest document (`/documents/latest`, the newest filing), Sidebar (document pages only: Ö when shown, ø when hidden), Documents (folds open to the twelve newest documents and All documents), Journal, and Settings (folds open to Owner, for the owner only, and Sign out *name*). It is built from nested `<details>`, so it works without script. `menu.mjs` adds closing on Escape or a tap outside, loads the document list, and runs the sidebar switch. Opening the menu folds away 📁 contents and the 🛰️ field, so only one panel is open at a time.
- **The header's links moved into the menu.** The header keeps only the name, and a document page drops the header so the document fills the window. This is a choice the owner can reverse.
- **The sidebar's ×.** It replaces Close and Manage. In landscape it hides the sidebar, the document takes the freed width, and the choice is remembered on that device. The menu's Sidebar switch, or pressing Comment, brings the sidebar back. In portrait the switch opens the sheet and × shuts it. The open sheet hides both button groups.
- **Checks.** A unit test covers the menu replacing the header links, with Owner shown only to the owner. A database test covers `/documents/latest` (the newest filing, the list when empty, and strangers sent to sign in). `tests/browser/p1-flow.mjs` checks the menu on every signed-in page in all 7 device classes, light and dark: it is inside the window, at least 44 px, lists its items, Documents lists the documents, Settings shows Sign out, and Escape closes it. On the document page it checks that × hides the sidebar, that the frame then takes at least 90% of the width, and that the switch shows ø and then Ö. All 126 pass.

## Owner follow-up: originals in the menu (5 November 2026, late afternoon)

Owner request in chat: "the original copy of the HTML in the document menu allow people to download and the latest changes. Use a table style with two columns: document name (date, time last change 00:00AM/PM DD-MM), right column be org (hyperlink to download)".

- **Table:** the menu's Documents group is now a two-column table showing the twelve newest documents, followed by All documents. The left column has the document's name, linking to it, with its last change below as `hh:mmAM/PM DD-MM` in Singapore time (for example `03:42PM 05-11`). The right column has **org**, which downloads the original file.
- **Last change:** the latest of a new version, a comment, or a change to a shared saved field. Personal answers and a page's own browser storage are left out, so they reveal nothing about one person's activity and a visit counter does not count as a change.
- **Download route:** `GET /documents/{key}/original` (or `?v=N` for an earlier version) returns the stored file byte for byte, with no helper added. It is sent as an attachment under its own file name, with an ASCII fallback and the exact name in RFC 5987 form. It carries the document sandbox policy, `nosniff` and `no-store`. Members only.
- **Reading of "and the latest changes":** this is taken to mean the last-change time in the left column. A download that bakes comments and saved ticks into a copy is not built. It can be added if the owner wants it.
- **Checks:** a unit test covers the file name header, including quotes, line breaks and Chinese. A database test covers the latest and first versions downloaded unchanged, the header, the policy, strangers and a missing document, and the `changed` field in `/api/library`. The browser check confirms the `hh:mmAM/PM DD-MM` form and the org link, and that org downloads `sample-trip.html` on the document page. All 126 checks pass.

## Owner follow-up: Google Maps inside documents (5 November 2026, evening)

Owner decision in chat: "show embedded Google Map".

- **Frame policy:** the document frame's `frame-src` changes from `'none'` to `https://maps.google.com/maps https://www.google.com/maps/`. `maps.google.com/maps` matches only that path. Google redirects it to `www.google.com/maps/embed`, and only paths under `/maps/` on `www.google.com` are allowed. Every other site stays blocked in frames, YouTube included. The map frame inherits the document's sandbox, so it never gets `allow-same-origin`.
- **Tested** in Chromium on a sandboxed copy of the frame. A `maps.google.com/maps?...&output=embed` map rendered fully (pin, labels, Open in Maps), and a YouTube frame on the same page was refused by the policy.
- **Privacy:** when a document shows a map, Google receives the viewer's internet address and the place being looked up. Photos from other websites already work this way.
- **Upload check:** it now lists "Google Maps (embedded)" and "Leaflet" among the libraries a document uses. It warns only about frames from other sites, and frames whose address a script fills in later are not judged. The storage warning now says the site keeps such values, since pull request C added the storage stand-in.
- **Checks:** a unit test covers allowed and refused frames and the two new library names, including the look-alike `maps.google.com/mapsevil`, which is refused. The policy unit test pins `frame-src` to `FRAME_SOURCES`.
