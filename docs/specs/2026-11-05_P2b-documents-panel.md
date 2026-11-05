---
flow: spec
title: "P2b - Filing numbers, the management panel, hashtags, the upload check and the full-window viewer"
act: "directive"
force: "MUST"
status: "Pull request A of three, built on the owner's instruction \"execute\" (5 November 2026). Merge needs the owner's go-ahead."
scope:
  - "crates/web/**"
  - "db/migrations/0003_p2b_documents_panel.sql"
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
