---
flow: spec
title: "P2a - Upload, list and view documents in a sandboxed frame"
act: "directive"
force: "MUST"
status: "Built on the owner's instruction \"upload the html to see\" (5 November 2026); shipped together with the one-family-password change. Merge needs the owner's go-ahead."
scope:
  - "crates/web/**"
  - "db/migrations/0002_p2a_documents.sql"
  - "web/assets/site.css"
  - "docs/specs/2026-11-05_P2a-documents.md"
---

# P2a - Documents (first slice)

Version 0.1 · 5 November 2026 · Asia/Singapore · parent plan: section 5.4 (safe HTML preview) and P2.

## Intent

- Outcome: any signed-in member uploads an HTML or text file (up to 10 MB), sees it listed, and opens it in a locked-down frame where its own scripts, online pictures, Retry and Print buttons still work, but it cannot reach the family's session, data or other pages.
- Done when: the tests below pass, CI is green and, after the merge, a member can upload the first document on hongjia.org.

## What is built

- Migration `0002`: `documents` and immutable `document_versions` (file name, kind, size, SHA-256, bytes, uploader, time). Files are stored in PostgreSQL for now; a bucket can replace this when pictures arrive.
- Routes: `/documents` (list, and upload by POST), `/documents/new`, `/documents/{id}` (viewer), `/documents/{id}/raw` (the document itself, members only).
- The raw document carries `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data: blob:; ...; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'self'`, plus `no-referrer`, `nosniff` and `private, no-store`. The viewer's iframe uses the same sandbox and never `allow-same-origin`.
- The family pages allow `frame-src 'self'` so the viewer can show the frame.

## Differences from the plan, stated plainly

- The plan (D5) recommends serving documents from a separate origin (view.hongjia.org). This slice serves them from hongjia.org under a `sandbox` policy, which gives them an opaque origin: verified in a real browser that the document cannot read the parent page, cookies or storage, and cannot make network requests. A separate origin remains the stronger option and needs a DNS record from the owner.
- Comments, versions after the first, read marks and the globe come in later slices.

## Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 21 unit, 2 Dockerfile, 12 placeholder parity, 13 database tests (2 new: upload, list, view, raw headers, member and stranger access; CSRF, Origin, file type, empty, missing and oversize refusals). Clippy with all features clean. Browser JavaScript tests 15 of 15.
- Real browser, with the owner's itinerary uploaded to a local test database only (never committed): the page's own script ran (it filled its photo counter), the Retry and Print buttons were present, the frame could not reach the parent page, cookies, storage or the network, and the viewer had no sideways scroll at 430, 375 and 744 pixels wide. Photos showed as waiting because the test browser had no internet access.


### Amendment (7 November 2026): hide and unhide, the version tag, and ⋯ on All documents

- **Owner request:** "document control like delete or hide isn't there". The owner was asked who a hidden document is hidden from and where the controls go, and did not answer; the recommended choices were taken and are named here so they can be changed.
- **Hide:** applies to everyone. A hidden document leaves All documents, the menu's list, the globe, search and the landing page, but is kept with every version, mark and hashtag. `documents.hidden_at` and `hidden_by` (migration 0012) record when and by whom; each hide and unhide is in the audit log. Only whoever added the document and the owner can hide or unhide it, as with rename and delete.
- **Show hidden:** All documents ends with "Show hidden (n)" when there are any; that view lists them with a Hidden tag, and "Hide them" goes back.
- **⋯ on each row of All documents:** for whoever may manage that document, Hide or Unhide, and Delete…, which opens the document's side panel at Manage (deleting still asks for the typed confirmation there).
- **Version tag:** the owner asked for "(middle dot) v.##" after the filing number, before the title. The header reads *filing number* · v.NN *title*. NN is the number after a `v` in the file's own name (the 13 in `…-Coffee-Table-v13-final.html`), or else the document's version on this site; hovering shows both.
- **Checks:** a database test: a member cannot hide; the owner hides; the document leaves the list, `/api/library`, `/api/search` and the landing page; `?hidden=1` shows it; its page says it is hidden; Unhide brings it back. A unit test for the version tag. A local browser walk on a phone: ⋯ → Hide → Show hidden (1) → ⋯ → Unhide, and the header reading "· v.14".
