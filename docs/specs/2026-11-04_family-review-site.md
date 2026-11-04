---
flow: spec
title: "Family document review site - draft plan"
act: "directive"
force: "MUST"
status: "DRAFT - not approved. Every assumption is pending. No build, deploy, account or message is authorised by this file."
scope:
  - "apps/web/**"
  - "packages/profiler/**"
  - "packages/review-bridge/**"
  - "packages/fab-globe/**"
  - "packages/shared/**"
  - "db/migrations/**"
  - "tests/**"
  - "rush.json"
  - "common/config/rush/**"
  - "railway.json"
  - ".env.example"
verify: ""
---

# Hongjia family review site - draft plan

Version 0.1 (draft) · 4 November 2026 · Asia/Singapore · prepared in Claude Code for the owner's review.
This is a plan only. Nothing here has been built, deployed, configured or sent.

## 0. Privacy note for this public repository

This repository is public. This plan therefore leaves out, on purpose:

- the proposed starter password, and any hint that narrows it;
- the family members' names (the four profiles are seeded from configuration, see D16);
- the content of the first document (dates, places, bookings). Only its structure is described here. The detailed analysis profile is kept outside the repository.

No family file has been committed, uploaded or deployed.

## 1. Intent

- Outcome: a private, phone-friendly website at hongjia.org where four family profiles open shared documents (HTML, text, pictures), review them together in a Word-style comment panel, mark each version as read, and see a shared dashboard with a login journal and neutral unusual-access alerts.
- Force: MUST for the safeguards (sandboxing, consent, no silent re-attachment of comments, no external messages); SHOULD for the review features; MAY for later extras (ink, suggestions, AI keyword help).
- Done when: every acceptance criterion in section 13 passes its named test, the INVARIANTS REPORT shows no Failed row, and the owner has replied with `APPROVE` for each phase and, separately, for go-live.

## 2. Interpretation

### UNDERSTANDING

1. Four built-in profiles, shown in lowercase. A shared starter password is proposed for local development only; individual, stronger credentials are required before the site goes online (the owner's own recommendation, adopted here).
2. A shared password with a name picker cannot prove who signed in. Anyone who knows it can choose any name. Every record the site keeps is "profile selected", never "person present".
3. Documents: many HTML files, text documents and pictures over time, added by any family member, readable on phones and computers.
4. Review: a comment panel beside the document, like Word's Review pane, with comments on selected text, comments on pictures, replies and resolved threads. The owner also wants post-it notes, circles, Apple Pencil ink, highlights, emoji and attachments ("clips"), with Slack-like threads and reactions.
5. Versions are immutable. Replacing a file creates a new version; comments are re-anchored with a visible status and never silently moved.
6. Reading is explicit: opening a document is logged as "opened"; only the reader's own button marks a version as read.
7. Uploaded HTML runs in a locked-down sandbox so that useful scripts (for example the first document's photo loader and Retry button) work, while the document cannot touch the family's session, data or other pages.
8. A shared dashboard shows the latest comments, who last opened each document, who marked each version read, a login journal, and alerts. An open tab does not prove reading.
9. Location is collected only with consent, can be declined, and is approximate (never precise GPS).
10. No email, SMS or push alerts. In-app only, unless the owner later approves recipients and a channel.
11. PostgreSQL holds application data; files live in object storage. Hosting is compared on the owner's existing Railway and Vercel plans by additional usage, not by new subscriptions.
12. Layout follows the owner's device profile from 2026-0313_AI-JS (as ported into michi): notebook, tablet, mini tablet, phone max, phone small.
13. Navigation follows michi's floating button group: 🛰️ satellite (search), globe, 📁 folder (contents), driven by a keyword profile built from each document.
14. "Build using Rush" is read as Rush (rushjs.io), Microsoft's monorepo manager. See G1.

### GAPS (could change the outcome; owner to resolve)

- **G1 "Rush".** (a) Rush.js monorepo manager (this plan's working reading); (b) Rust, the language; (c) "rush" meaning "quickly, as an MVP". (a) shapes the repository layout; (b) would change the whole server stack; (c) would change scope and order.
- **G2 "second HTML".** (a) The first document is analysed deeply to build and calibrate the profiler; every later upload is document 2, 3 and so on, profiled by the same rules. (b) Every upload keeps its original ("first HTML") and the site generates a reviewed rendition ("second HTML") with the globe and comments around it. This plan does both, without ever editing the stored original, but the owner should confirm which was meant.
- **G3 Owner role.** Which profile is the owner (uploads settings, retention, deletions, credential resets)?
- **G4 "Change using iPad pencil".** Read as drawing ink marks and suggesting changes, not editing the stored file. Applying a suggestion creates a new version made by the uploader.
- **G5 "Text documents".** TXT and Markdown are assumed. Word (.docx) and PDF would add converters (D13).

## 3. Assumptions

| ID | Assumption | Status | Note |
|----|------------|--------|------|
| A1 | Rush means Rush.js (G1) | pending | |
| A2 | Railway is the host; Vercel is not used for this site | pending | evidence in section 7 |
| A3 | All four profiles see all documents and the whole dashboard | pending | per-document privacy is D12 |
| A4 | Any profile may upload; only the uploader or owner may replace or delete | pending | D12 |
| A5 | Go-live credentials are passkeys with a per-profile passphrase fallback | pending | D4 |
| A6 | The sandbox origin is a subdomain, view.hongjia.org | pending | D5; needs a DNS record at go-live |
| A7 | Journal retention 180 days; location retention 90 days | pending | D9 |
| A8 | Real-time updates use Server-Sent Events from one Node process | pending | fits Railway, not Vercel functions |
| A9 | The michi globe and device-profile code may be reused here | pending | both are the owner's repositories |
| A10 | Family names are seeded from configuration, not hard-coded | pending | D16 |

Only the owner confirms an assumption.

## 4. The shared password: assessment and recommendation

**Verdict: acceptable only on a developer's own machine with fixture data. Not acceptable on hongjia.org, even briefly.**

- The proposed password is very short and guessable from public information about the family. An automated guesser would find it in minutes; a person who knows the family may simply guess it. (Exact keyspace and reasoning are in the private notes.)
- A shared password plus a name picker gives no attribution. Anyone holding it can sign in as any of the four names, so the journal, read marks and comments can be impersonated. Alerts can show that something unusual happened; they cannot show who did it.
- The domain is already attached to the Railway service, so anything deployed is reachable from the internet at once.

**Recommendation**

1. Development: the shared-password mode exists only behind `HJ_AUTH_MODE=shared-dev`, and the server refuses that mode when it detects a production host (Railway variables present or the request host is hongjia.org).
2. Go-live: one credential per profile.
   - Primary: **passkeys** (WebAuthn): Face ID, Touch ID or the phone's screen lock. Nothing to remember, cannot be phished, works on iPhone, iPad, Android and notebooks. Each profile can register several devices.
   - Fallback: a per-profile **passphrase** of at least 16 characters (four random words is fine), stored as a scrypt hash (built into Node, no extra package), never logged, never sent back to the browser.
   - Recovery: the owner creates a one-time recovery code (valid 24 hours, shown once) and gives it in person. The site sends no email or SMS.
3. In every mode: login rate limits per IP and per profile with growing delays, the same error for every failure, and every attempt written to the journal.
4. A production boot check refuses to start if any passphrase policy is weaker than the above, if the session secret is shorter than 32 bytes, or if shared-password mode is switched on.

## 5. Architecture

### 5.1 Overview

```
 Family browser (phone / tablet / notebook)
 ┌──────────────────────────────────────────────────────────────┐
 │ hongjia.org  (app origin: UI, API, dashboard, comment panel)  │
 │   strict CSP, HttpOnly session cookie, CSRF token             │
 │   ┌───────────────────────────────────────────────┐  🛰️ 🌐 📁 │
 │   │ <iframe sandbox> from view.hongjia.org        │           │
 │   │   uploaded HTML runs here (opaque origin)     │  comment  │
 │   │   + review bridge (markers, ink, selection)   │  panel    │
 │   └──────────────┬────────────────────────────────┘           │
 │                  │ MessageChannel (markers and anchors only)  │
 └──────────────────┼────────────────────────────────────────────┘
                    │ HTTPS
 Railway project "hongjia" (region asia-southeast1, Singapore)
 ┌──────────────────┴────────────────────────────────────────────┐
 │ web service (Node 22): app routes, API, SSE, sandbox host,     │
 │   profiler, image pipeline, scheduled jobs (purge, backups)    │
 │        │ private network               │ public HTTPS (S3 API) │
 │ PostgreSQL service + volume      Railway Bucket (private)      │
 │   all application data             original files, renditions  │
 │   scheduled volume backups         images, attachments, dumps  │
 └────────────────────────────────────────────────────────────────┘
```

### 5.2 Components

| Component | Role |
|---|---|
| `apps/web` | One Node 22 server: pages, JSON API, Server-Sent Events for live comments, the sandbox host for view.hongjia.org (chosen by Host header), upload handling, scheduled jobs. Vanilla ES modules in the browser, like michi, so no front-end framework to maintain. |
| `packages/profiler` | Deep analysis of each upload: structure, key words, word forms, interactive features, risk flags, and up to six globe islands. Deterministic; no AI call by default. |
| `packages/review-bridge` | Small script injected into each rendition at serve time (never into the stored file): reports selections and anchor positions, draws highlights, markers, sticky notes and ink, scrolls to sections. |
| `packages/fab-globe` | The 🛰️ globe 📁 button group and globe, ported from michi's `claude-explorer` with its rules (six islands, satellite search closed until pressed, Escape order, reduced motion, focus trap). |
| `packages/shared` | Device profile (michi `device-profile.mjs`, profile `v2-template-rin3-1`, rules unchanged), W3C Web Annotation types, validation. |
| PostgreSQL | Profiles, credentials, sessions, devices, journal, documents, versions, profiles of documents, annotations, replies, reactions, opens, read marks, alerts, settings, audit log. Full-text search with `tsvector` and `pg_trgm`. |
| Railway Bucket | Files (section 5.3). |

### 5.3 Where uploaded files are stored

- **Railway Bucket** (S3-compatible, private). Per Railway's documentation: buckets are private only (presigned URLs supported), encrypted at rest, reachable over public networking only (no private network), and have **no versioning, lifecycle rules or automatic backups**.
- Object keys are random or content hashes (`sha256/ab/cd...`), never file names or family names. The original file name lives only in PostgreSQL.
- Stored once, never overwritten: every version is a new object. Deletion is a soft delete, purged after 30 days.
- Recommended (D8): **app-level encryption** of each object with AES-256-GCM, key held in a Railway variable. A leaked bucket key then exposes nothing readable. Files are streamed through the app rather than by presigned link, which suits family-scale traffic.
- Uploaded photos are re-encoded to strip EXIF metadata, including GPS position, before storage.
- PostgreSQL stores no file bodies, only metadata, hashes, extracted text for search and the analysis profile.

### 5.4 Previewing uploaded HTML safely

**Design**

1. The stored HTML is never changed. At view time the server builds a rendition: the original bytes plus the injected review bridge, served from **view.hongjia.org**, a separate origin that never receives the family's session cookie (the cookie is `__Host-` scoped to hongjia.org).
2. The rendition loads only through a short-lived signed address (5 minutes, bound to the version and the viewer's session), with `Referrer-Policy: no-referrer` so the address does not leak.
3. The iframe is sandboxed **without** `allow-same-origin`, so the document runs in an opaque origin:
   `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals"` and `allow=""` (no camera, microphone, location or other device features).
4. The rendition carries its own header policy, so it stays sandboxed even if opened directly:
   `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'unsafe-inline' <optional CDN allowlist>; style-src 'unsafe-inline' <optional font hosts>; img-src https: data: blob:; media-src https:; font-src https: data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors https://hongjia.org`
   plus `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`.
5. The app and the bridge talk over a `MessageChannel` handed to the iframe at load, checked against a one-time nonce. The bridge receives only markers, colours and positions, never comment text, names or tokens, so even a hostile document has nothing worth stealing from the review layer.

**What keeps working (checked against the first document's code)**

| Feature in document 1 | Works? | Why |
|---|---|---|
| 33 online photos (loaded by the page's own script from `data-src`) | Yes | `allow-scripts` and `img-src https:` |
| Retry photos button and online/offline notice | Yes | runs inside the document only |
| Print / save PDF button | Yes | `allow-modals` permits `window.print()` |
| Official-site and map links opening in a new tab | Yes | `allow-popups` and `allow-popups-to-escape-sandbox` |
| In-page contents links and sticky top bar | Yes | normal scrolling inside the frame |
| Booking checkboxes | Tick, but reset on reload | the file never saved them; the sandbox also blocks storage |

Important finding: if scripts were stripped instead, **no photo would load**, because every photo sits in `data-src` until the page script copies it. A "static safe mode" would have to rewrite `data-src` to `src`.

**What cannot safely run, and why**

| Blocked | Reason |
|---|---|
| `fetch`, XHR, WebSocket, beacons to any server | stops a document from reading or sending data; live-data widgets and AI calls inside documents will not work |
| Cookies, localStorage, sessionStorage, IndexedDB | opaque origin; a document cannot keep state or read the family's session |
| Form submission | `form-action 'none'` |
| Redirecting or replacing the whole site | no `allow-top-navigation` |
| Embedded frames (video, map embeds) | `frame-src 'none'`, unless a host is allowlisted (D6) |
| Downloads started by the document | no `allow-downloads` (D6) |
| Clipboard copy buttons, geolocation, camera, notifications | no device permissions inside the frame |
| External script libraries (common in AI-generated pages) | blocked unless the owner allowlists named CDNs (D6) |

Remaining risk, stated plainly: images load straight from their own websites, so those sites see the viewer's IP address and the time. A document could also leak its own content through image addresses. It still cannot reach family data. D7 offers a server-side image cache that removes both.

### 5.5 Review layer (Word Review, post-its and pencil)

Annotations follow the W3C Web Annotation model (the same model as Hypothesis and Annotorious), so anchors survive edits and can be exported.

| Kind | How it is made | Anchor |
|---|---|---|
| Comment on text | select text, then 💬 | TextQuote (exact text plus 32 characters before and after) + TextPosition + CSS path |
| Highlight | select text, pick a colour | same as above |
| Suggest a change | select text, type the replacement | same; shows old → new like Word's tracked change |
| Comment on a picture | tap a picture, pin or drag a box | image hash + element path + box as percentages |
| Sticky note (post-it) | 🗒️ then tap anywhere | element path + offset |
| Circle, box, arrow | shape tool | element path + shape in relative units |
| Ink (Apple Pencil, stylus, finger) | ✏️ draw mode; Pointer Events with pressure; "pen only" setting for palm rejection | element path + smoothed vector strokes |
| Emoji stamp | ❤️ 👍 ✅ ❓ on a spot | element path + offset |
| Reactions | emoji on any comment or reply | the comment |
| Clip (attachment) | 📎 on a comment: picture or small file | stored like uploads, same checks |

Threads have replies, @mentions shown in-app, edit (marked "edited"), soft delete, resolve and reopen. The panel filters open, resolved, mine and "mentions me". iPad Scribble works in the comment box because it is a normal text field.

### 5.6 Versions without silent re-attachment

- A document has immutable versions. Each comment belongs to the version it was made on.
- On a new upload the server tries to re-anchor each open thread and gives it a visible status:
  - **exact** - the same text and context found once;
  - **moved** - found once at a new place;
  - **needs check** - only a close match; shown with a yellow flag until a person confirms or dismisses it;
  - **stayed on version N** - not found; the thread stays on the old version and is listed in a banner.
- Carried threads are linked copies; resolved threads stay on their own version. The banner reads like: "3 comments carried over, 1 needs your check, 1 stayed on version 1."
- Any version can be opened. A text comparison between versions is a later extra.

### 5.7 Opened versus read

- "Opened" is recorded when a version is shown, with active time (section 5.11).
- "Read" is recorded only when the reader presses **Mark version N as read**. Opening never marks anything read.
- A new version starts unread for everyone; earlier marks stay with their version ("read v1, not yet v2").

### 5.8 Universal contents: 🛰️ satellite, globe, 📁 folder

The button group sits at the bottom right of every page, in michi's order: 🛰️ satellite, globe, 📁 folder. On a document page it lives in the app, outside the sandbox, so it is the same for every document.

- 🛰️ **Satellite**: search across document titles, text, key words and comments (PostgreSQL full-text search). The field stays closed until pressed, then docks on the globe; Enter opens the first result.
- **Globe**: up to six islands per document, built from its analysis profile; pins for sections, key words, word forms, places, pictures and sources; routes between related pins. A library globe groups whole documents the same way.
- 📁 **Folder**: contents of the current document (sections and subsections), then the family library.
- Selecting a pin or contents entry tells the bridge to scroll the document to it.

**Deep analysis profile (applied to document 1 first, then to every upload)**

1. Parse the HTML with a standards parser; record landmarks, the heading tree, ids, articles and figures.
2. Give every section an anchor. Sections without an id get a runtime anchor from their heading text; the stored file is not changed.
3. Extract text per section, leaving out scripts, styles, link labels and photo captions.
4. Find key words **structure first**: headings, card titles, groups, `<time>` elements and repeated proper nouns rank above body-text frequency. Word forms come from michi's stemmer.
5. Inventory interactive features (scripts, event handlers, buttons, lazy images, external hosts) and risk flags (forms, frames, network calls, storage, external scripts). This drives the sandbox and tells the uploader what will and will not work.
6. Propose up to six islands from the document's own top-level sections; the uploader can rename or merge them before publishing.
7. Save the profile with the version; the globe and the satellite read from it.

**Document 1, structure only** (exact counts from the file; content kept private):
one 176 KB self-contained HTML file; 9 sections (2 without ids); 8 day plans; 32 place cards in 4 groups; 24 sources; 31 machine-readable times; 33 online photos from 16 external hosts; 491 links (246 to an external maps site, 28 in-page); 2 inline scripts and 1 inline handler; no forms, frames, network calls, storage or external scripts.

Why "structure first": plain word counting on this file ranks interface words such as "photo" (170) and "original" (70) above every place name. Counting by structure avoids that.

### 5.9 Device-sensitive layout

The owner's device profile (`v2-template-rin3-1`) decides layout from geometry; the browser's reported brand is descriptive only, and the layout viewport is used so an on-screen keyboard cannot flip a phone to landscape.

| Owner's class | Profile tier | Test viewport(s) | Document and panel |
|---|---|---|---|
| Notebook | desktop | 1440 × 900 | document centre, comment rail on the right (about 360 px), comments aligned to their anchors |
| Tablet | tablet-standard / tablet-large | 1180 × 820, 820 × 1180 | landscape: rail; portrait: rail collapses to a drawer |
| Mini tablet | tablet-small | 744 × 1133, 1133 × 744 | drawer from the right; full-width document |
| Phone max | phone-large | 430 × 932 | full-screen document; comments in a bottom sheet (half or full); selection pops a small toolbar |
| Phone small | phone-standard / phone-compact | 375 × 667, 360 × 740 | as phone max, with tighter spacing; toolbar icons only |

Every tier: touch targets at least 44 px, no sideways page scroll, safe-area padding, reduced-motion respected, and the 🛰️ 🌐 📁 group never covering the comment sheet's controls.

### 5.10 Shared dashboard 🎛️

Visible to all four profiles:

1. **Unusual access** - open alerts first, each with "seen by" marks.
2. **Latest comments** - newest 20 across documents, with document, version and anchor link.
3. **Documents** - title, current version, uploaded by and when; for each profile: last opened (time) and read mark for the current version (✓ v2, ✓ v1 only, or not yet).
4. **Login journal** - filterable by profile and date.
5. **What we collect** - link to the notice in section 5.13 and the current retention period.

A fixed caption under activity figures: "Active time is an estimate from a visible tab with recent interaction. An open tab does not prove someone was reading."

### 5.11 Login journal and active time

| Field | Source |
|---|---|
| Selected profile | the sign-in form ("profile selected", not "person") |
| Date and time | server clock, stored in UTC, shown in Singapore time by default |
| Result | success or failure, with the reason class (wrong credential, rate limited) |
| Device and browser | parsed User-Agent (for example "Safari on iPhone"), plus a device label the member chooses |
| Device code | a random device identifier in a long-lived HttpOnly cookie, shown as a short code; no fingerprinting |
| Approximate location | only with consent (section 5.13); otherwise "not shared" |
| Estimated active time | heartbeat each minute while the tab is visible and there was a tap, scroll or key in the last 2 minutes |
| End | sign-out, expiry or last activity |

### 5.12 Unusual access alerts (in-app only)

| Rule | Fires when | Default |
|---|---|---|
| New device | a profile signs in from a device code it has not used before | on |
| Meaningful location change | both this and earlier locations were shared, and this one is farther than the threshold from every location that profile used recently | 300 km, 90 days |
| Improbable travel | the implied speed between two shared locations is above the threshold | 900 km/h |

- Shown to the other members on the dashboard, with a badge in the header. No email, SMS or push.
- Wording is neutral: "Unusual sign-in - please check", never "unauthorised", "hacked" or "intruder". A location change alone is never called unauthorised.
- Each alert lists the usual innocent causes: **travel, a VPN, a shared device, a new browser, private browsing or cleared cookies**. Each member can mark it seen; the named profile can add "this was me", which is recorded as a statement, not proof.
- Without location consent only the new-device rule can fire.

### 5.13 Consent and what is collected

Before first use on each device, a plain screen explains the table below. Location defaults to **Don't share**. The choice can be changed at any time; turning it off can also delete that profile's past locations.

| Data | When collected | Visible to | Kept for |
|---|---|---|---|
| Selected profile, sign-in time, result | every sign-in | all four profiles | journal retention (default 180 days) |
| Device and browser summary, device code, device label | every sign-in | all four profiles | journal retention |
| Approximate location (nearest town, about 10 to 25 km) | only if that profile allowed it on that device | all four profiles | location retention (default 90 days) |
| Estimated active time, documents opened | while signed in | all four profiles | journal retention |
| Read marks, comments, reactions, uploads | when a member acts | all four profiles | until deleted |
| IP address | every request | nobody in the app; truncated before storage, used only for rate limits | 90 days |

How location works: the browser's own location prompt with low accuracy; the coordinates are rounded on the device to one decimal place (about 11 km) before sending; the town name comes from an offline list of towns (GeoNames, CC BY 4.0), so no outside service sees the position. Precise GPS is never requested. IP-based location is not used by default because it needs a third-party database account (D-list).

### 5.14 Data model (PostgreSQL)

`profiles`, `credentials` (passkeys and passphrase hashes), `recovery_codes`, `devices`, `sessions` (hashed id, profile, device, times, active seconds), `login_attempts`, `consents` (profile, device, kind, choice, notice version), `locations` (session, rounded lat/lon, town, country), `documents`, `document_versions` (number, uploader, object key, sha256, type, size, original name, status), `version_profiles` (analysis JSON, islands, search vector), `assets`, `annotations` (version, author, kind, W3C target JSON, body, style, anchor status, carried-from, resolved by/at), `replies`, `reactions`, `attachments`, `document_opens`, `read_marks` (unique per version and profile), `alerts`, `alert_acks`, `settings` (retention days, thresholds), `audit_log` (owner actions).

## 6. Safeguards

**Access control**
- Every route needs a signed-in session except sign-in, health and the "what we collect" notice.
- Owner: settings, retention, profile and credential management, any deletion. Member: read, comment, upload, replace or delete own uploads and own comments.
- `X-Robots-Tag: noindex, nofollow` everywhere; robots.txt disallows all. The hongjia.up.railway.app address redirects to hongjia.org so there is one cookie origin.

**Sessions**
- Server-side sessions in PostgreSQL: 256-bit random id, stored hashed; cookie `__Host-hj_sid`, HttpOnly, Secure, SameSite=Lax.
- Idle timeout 14 days, absolute 30 days; owner actions ask for a fresh passkey or passphrase check.
- Sign out, sign out everywhere, and owner can end any session. Changing a credential ends that profile's sessions.
- CSRF token on every change plus Origin and `Sec-Fetch-Site` checks (the michi pattern).

**Headers on the app origin**
`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src https://view.hongjia.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` allowing location only for the app itself, `Cross-Origin-Opener-Policy: same-origin`.

**Documents and credentials**
- Uploads: type allowlist with magic-byte checks; size caps (HTML 10 MB, pictures 25 MB, clips 25 MB); SVG treated as active content (sandbox only); pictures re-encoded to strip metadata; text and Markdown shown escaped or sanitised.
- Secrets only as Railway variables; `.env.example` holds placeholders; GitHub secret scanning and push protection on the public repository.
- Passphrases hashed with scrypt; passkey public keys only; recovery codes hashed and single-use; no credential ever logged.
- Application logs hold no request bodies, comment text or credentials.

**Backups**
- PostgreSQL: Railway scheduled volume backups (per Railway's documentation: daily kept 6 days, weekly kept 1 month, monthly kept 3 months), plus a nightly encrypted `pg_dump` to the bucket (30 daily, 12 monthly).
- Bucket: no platform backups exist, so objects are immutable and soft-deleted, plus a weekly encrypted copy to a second place the owner chooses (D14).
- A monthly restore drill on a local or staging copy: restore, compare row counts and file hashes, record the result.

**Retention**
- `journal_retention_days` (default 180, allowed 30 to 730) and `location_retention_days` (default 90, never longer than the journal), set by the owner on a settings page and shown on the dashboard.
- A daily job deletes expired journal rows, locations, heartbeats (raw kept 7 days, then hourly totals), failed attempts and acknowledged alerts, and writes the counts to the audit log.

## 7. Hosting: Railway versus Vercel (additional usage on existing plans)

**Read-only checks made on 4 November 2026**
- Railway: project "hongjia" exists in the owner's workspace, one production environment, one service "hongjia" building from this repository's `main` branch with Railpack, region asia-southeast1 (Singapore), domains hongjia.up.railway.app and hongjia.org attached. Latest deployment FAILED (the repository has no app yet). No database, volume or bucket yet. **A merge to `main` will start a Railway deployment.**
- Vercel: the owner's team exists; no Vercel project is linked to this repository, so pushes here do not deploy on Vercel.

| | Railway (recommended) | Vercel |
|---|---|---|
| Already set up | project, service, Singapore region, both domains | nothing for this repo |
| Extra pieces needed | PostgreSQL service + volume, Bucket | new project, Neon Postgres (Marketplace), Vercel Blob |
| Runtime fit | one long-running Node process: Server-Sent Events, scheduled jobs, streaming uploads | request-scoped functions: live comments need polling or a separate realtime service; large uploads must go straight from browser to Blob |
| Published rates | RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB; Bucket $0.015/GB-month with free egress and free operations | Pro $20/month includes $20 usage credit; active CPU from $0.128/hour; memory from $0.0106/GB-hour; Blob $0.023/GB-month, uploads $5 per million; Neon free plan 100 CU-hours and 1 GB per project, paid from $0.106/CU-hour and $0.35/GB-month |
| Included usage | Hobby $5/month includes $5; Pro $20/month includes $20, shared across the workspace's projects | Pro includes $20 credit and 1 TB transfer, shared across the team's projects |
| Vendors holding family data | Railway only | Vercel and Neon |
| Notable limits | Hobby: 5 GB volume per service; buckets have no versioning or backups and no private networking | function duration and body limits; Blob private files are delivered through a function (extra transfer) |

**Recommendation: Railway.** It is already wired to this repository and domain, keeps all data with one vendor in Singapore, and suits real-time comments. Vercel could host it for about the same money but needs more moving parts.

## 8. Estimated running costs and limits

Estimated additional Railway usage per month (rates above; computed, not measured):

| Scenario | App + database memory | CPU | Volume | Bucket | Egress | Total |
|---|---|---|---|---|---|---|
| Low (quiet month) | 0.27 GB → $2.70 | 0.02 vCPU → $0.40 | 1 GB → $0.15 | 1 GB → $0.02 | 2 GB → $0.10 | **about $3.40** |
| Typical | 0.55 GB → $5.50 | 0.05 vCPU → $1.00 | 2 GB → $0.30 | 5 GB → $0.08 | 10 GB → $0.50 | **about $7.40** |
| Busy | 1.0 GB → $10.00 | 0.13 vCPU → $2.60 | 5 GB → $0.75 | 20 GB → $0.30 | 40 GB → $2.00 | **about $15.70** |

- Whether this costs anything extra depends on how much of the plan's included usage the workspace's other projects already use. That figure is on the Railway usage page and was not visible to this review.
- Volume backup storage pricing was not stated on the pages checked.
- A separate sandbox domain (D5 option b) would add a yearly domain fee (not priced here).
- Set a Railway usage alert and a hard limit before go-live; Railway suspends bucket access when the hard limit is reached.

## 9. Family workflow

1. Open **hongjia.org** on any phone, tablet or computer; tap your profile; sign in with your passkey.
2. First time on a device: read the "what we collect" screen, choose location sharing (default: don't share) and name the device.
3. The dashboard shows new documents, latest comments and any alerts.
4. Open a document. Tap 💬 for comments. Select words to comment, highlight, suggest a change or react. Tap a picture to pin a comment. Use 🗒️ for a sticky note and ✏️ to draw with the Pencil.
5. Reply, add emoji, attach a clip, resolve when settled.
6. When finished, press **Mark version N as read**.
7. To add something: ➕ Upload, choose the file, check the suggested title and islands, publish to the family. To update it: **Upload new version**, then check any comments flagged "needs check".
8. Find anything with 🛰️ search, explore with the globe, or browse with 📁 contents.

## 10. Implementation plan (each phase gets its own spec and APPROVE)

Repository layout under Rush (if G1 is confirmed): `apps/web`, `packages/profiler`, `packages/review-bridge`, `packages/fab-globe`, `packages/shared`, `db/migrations`, `tests`; `rush.json` with pnpm; `railway.json` sets the build to `node common/scripts/install-run-rush.js install && node common/scripts/install-run-rush.js build` and the start command. Node 22, the same as michi.

| Phase | Delivers | Deploys? |
|---|---|---|
| P0 Foundations | Rush workspace, test runner, migrations, security headers, health route, CI with a PostgreSQL service, fixture mode with no hosted storage | no |
| P1 Sign-in and journal | dev shared mode (refused in production), server sessions, device codes, consent screens, journal, rate limits, retention job | no |
| P2 Documents | uploads, checks, bucket adapter (with a local fake), versions, sandbox origin, renditions, review bridge handshake | no |
| P3 Review | text comments, highlights, replies, reactions, resolve, picture comments, sticky notes; rail, drawer and bottom sheet layouts | no |
| P4 Pencil and extras | ink, shapes, emoji stamps, suggestions, clips | no |
| P5 Contents | profiler, 🛰️ search, globe islands, 📁 contents, library globe | no |
| P6 Dashboard and alerts | dashboard cards, alert rules, acknowledgements | no |
| P7 Versions | re-anchoring with statuses, banner, per-version read marks | no |
| P8 Go-live readiness | passkeys and passphrases, recovery codes, backups and restore drill, owner runbook, privacy notice, security review | only after a separate `APPROVE deploy` |

The first document is used only as a local test fixture until go-live; the public repository gets a synthetic stand-in with the same structure.

## 11. Testing plan

- **Unit** (`node --test`): constant-time comparison, session expiry and rotation, rate limits, CSRF, alert rules (distance, speed, new device), retention purge, upload checks (magic bytes, metadata stripped), profiler counts on the synthetic fixture, anchoring outcomes (exact, moved, needs check, stayed).
- **Integration**: migrations up and down against PostgreSQL in CI; bucket adapter against a local S3 fake; end-to-end upload, render, comment, new version, re-anchor.
- **Sandbox attack suite**: a hostile fixture page tries top-level navigation, reading the parent, cookies, storage, `fetch` to the API, form posts, frames, `window.opener`, meta refresh, `<base>` hijack and forged bridge messages. Each must be blocked and the family session untouched.
- **Browser** (Playwright, Chromium and WebKit) at every viewport in section 5.9: tier attributes, panel mode, button group order and visibility, no sideways scroll, 44 px targets, document 1's photos and Retry button inside the sandbox, print allowed, links open new tabs, offline placeholder.
- **Accessibility**: keyboard paths through the globe, panel and toolbar; focus trap and return; screen-reader status lines; reduced motion; hyphens only in interface text (michi rule).
- **Manual on real devices** before go-live: the owner's iPad with Pencil, an iPhone, an Android phone and a notebook. These cannot be proven in CI and will be reported as Not Verifiable until done.

## 12. Invariants

| ID | Maxim | Scope | Limit | Contrary | Check |
|----|-------|-------|-------|----------|-------|
| I1 | No uploaded HTML runs on the app origin | every rendition | none | convenience of `srcdoc` or same-origin frames | sandbox attack suite; header test |
| I2 | The rendition never receives session cookies, tokens, names or comment text | review bridge | none | richer in-frame labels | bridge message schema test |
| I3 | A comment is never moved to a new version without a visible status | re-anchoring | none | "smart" silent carry-over | anchoring tests; banner test |
| I4 | Opening a document never marks it read | read tracking | none | auto-read on scroll | read-mark test |
| I5 | Location is collected only after consent on that device, and only rounded | journal | none | better alerts | consent test; payload rounding test |
| I6 | Alerts never say "unauthorised" or similar | alert copy | none | urgency | copy lint test |
| I7 | No email, SMS or push is sent | whole app | until the owner approves a channel | convenience | no mail/SMS dependency; network egress test |
| I8 | Shared-password mode cannot run in production | auth | local development only | speed of setup | boot-check test |
| I9 | Stored originals are never modified | storage | none | "fixing" documents | hash-on-read test |
| I10 | Expired journal and location rows are purged daily | retention | settings range 30 to 730 days | keeping history | purge job test |
| I11 | No family file, name or password is committed to this public repository | repo | none | realistic fixtures | secret scan; fixture review in PR |
| I12 | Layout follows geometry tiers, not reported brand | front end | none | device sniffing | device-profile tests (michi rules) |
| I13 | Every control is reachable by keyboard and at least 44 px on touch | front end | where space allows | dense toolbars | browser and accessibility suite |
| I14 | A merge to `main` happens only with the owner's approval, because it deploys | git and Railway | none | quick fixes | PR review |

## 13. Acceptance criteria

- [ ] Shared-password mode refuses to start on a production host → `auth-boot.test`
- [ ] Each of the four profiles signs in with its own credential; a wrong one is rate-limited → `auth.test`, `rate-limit.test`
- [ ] Document 1 (local fixture) shows its photos, Retry and Print inside the sandbox at all viewports → `render-browser.py`
- [ ] Every hostile-page attempt is blocked → `sandbox-attack-browser.py`
- [ ] Text, picture, sticky, ink and suggestion annotations save, reload and anchor correctly → `annotations.test`, `review-browser.py`
- [ ] A new version shows exact, moved, needs-check and stayed statuses as appropriate → `reanchor.test`
- [ ] Read marks exist only after the button is pressed → `read-marks.test`
- [ ] Dashboard shows latest comments, last opened per profile and read marks per version → `dashboard.test`
- [ ] Alerts fire for new device and large location change with neutral wording → `alerts.test`
- [ ] Location is absent unless consented and is rounded → `consent.test`
- [ ] Retention purge removes expired rows → `retention.test`
- [ ] 🛰️ 🌐 📁 group behaves to the michi standard on every tier → `fab-browser.py`

## 14. Decisions the owner needs to make

| ID | Decision | Recommendation |
|----|----------|----------------|
| D1 | What "Rush" means (G1) | Rush.js if a monorepo is wanted; plain npm workspaces would be lighter |
| D2 | What "second HTML" means (G2) | both readings, original never edited |
| D3 | Which profile is owner (G3) | the person who maintains the site |
| D4 | Go-live credentials | passkeys with passphrase fallback |
| D5 | Sandbox origin | (a) view.hongjia.org, no cost; (b) a separate domain, stronger isolation, yearly fee |
| D6 | Allow named CDNs, font hosts, embeds or downloads inside documents | allow cdnjs, jsDelivr, unpkg and Google Fonts; keep embeds and downloads off |
| D7 | Online pictures loaded directly or through a server cache | direct at first; cache later if privacy or broken links matter |
| D8 | App-level encryption of stored files | yes |
| D9 | Journal and location retention | 180 days and 90 days |
| D10 | Alert thresholds | 300 km, 90 days, 900 km/h |
| D11 | Failed sign-in details visible to all or owner only | counts to all, details to owner |
| D12 | Upload, delete and per-document privacy | everyone uploads; all documents family-wide |
| D13 | Text formats | TXT and Markdown first; DOCX later; PDF later |
| D14 | Off-platform backup destination | the owner's own cloud drive, encrypted |
| D15 | Host | Railway |
| D16 | Family names in the public repo | keep them in configuration only, or make the repository private |
| D17 | Build or buy (section 16) | build, reusing open standards and michi |
| D18 | Optional AI help for key words (would send document text to an AI provider) | off |
| D19 | IP-based approximate location (needs a third-party geo database account) | off |

## 15. Not yet verified

- Which Railway plan (Hobby or Pro) the workspace is on, and how much included usage the other projects already consume.
- The Vercel team's plan (the API returned no plan field).
- Whether Railway pull-request environments are switched on for this project (only a production environment exists today).
- Railway volume backup pricing.
- Vercel's function request-body limit (from memory, not re-checked).
- HEIC (iPhone photo) decoding in the image pipeline.
- `window.print()` in a sandboxed frame on iPadOS and iOS Safari, and Apple Pencil pressure through Pointer Events: real-device tests needed.
- Who manages DNS for hongjia.org, and whether it sits behind a proxy such as Cloudflare.
- Current Rush version and Railpack's handling of a Rush workspace.
- Prices and features of the products in section 16 (vendor claims, not tested).
- Legal position under Singapore's PDPA for a family site: not legal advice. The design asks for consent regardless.

## 16. Similar products (build versus buy)

No single product found combines: safe running of AI-generated, script-driven HTML; Word-style anchored comments on text and pictures; Pencil ink and post-its; a family login journal. Closest options:

| Product | What it does well | Gap for this family |
|---|---|---|
| Hypothesis (open source) | highlights and comments on web pages and PDFs, private groups, W3C annotations | no drawing, no post-its, no hosting of your own HTML |
| Recogito / Annotorious (open-source libraries) | text and image annotation building blocks on the W3C model | libraries, not an app; would be parts of this build |
| Markup.io, Pastel, Ruttl, BugHerd, Marker.io | pin comments and some drawing on live websites; review rounds | built for agencies; paid seats; proxies or snapshots; no journal |
| Vercel Comments (Toolbar) | threaded comments on Vercel preview deployments | every commenter needs a Vercel account; made for teams reviewing builds |
| Velt, Liveblocks | SDKs adding comments, presence and notifications to your own app | family content passes through a third-party service; monthly-user pricing |
| tldraw, Excalidraw | whiteboards with stylus support | not document review |
| Apple Freeform, GoodNotes, Notability | Pencil-first boards and notes with stickies and files | cannot run interactive HTML; Apple-centred |
| Google Docs, Word for the web, Notion | comments, suggestions, reactions | cannot run interactive HTML |

Recommendation: build, using the W3C Web Annotation model (as Hypothesis does) and the owner's michi globe, so family data stays in the family's own database.

## 17. Out of scope for this change

- Any build, deployment, account, credential, database, bucket, DNS change or message.
- Uploading or committing any family file.
- Merging to `main` (which would start a Railway deployment).

## 18. Evidence

Read-only checks and sources used for this draft (4 November 2026):

- Railway project, environment and service configuration read through the Railway connector (no changes made).
- Vercel team and project list read through the Vercel connector (no changes made).
- Railway pricing: https://docs.railway.com/pricing/plans
- Railway buckets: https://docs.railway.com/storage-buckets and https://docs.railway.com/storage-buckets/billing
- Railway volume backups: https://docs.railway.com/volumes/backups and https://docs.railway.com/guides/postgres-backups-restores
- Vercel pricing: https://vercel.com/pricing ; Vercel Blob pricing: https://vercel.com/docs/vercel-blob/usage-and-pricing
- Neon pricing: https://neon.com/pricing
- Owner's repositories read for patterns: ang-kl/michi (`docs/CLASS_STANDARD.md`, `docs/CLAUDE_EXPLORER_0_9_1.md`, `src/auth.mjs`, `assets/device-profile.mjs`) and ang-kl/2026-0313_AI-JS (`v3.1/src/responsive/deviceProfile.js`, `.claude/flow/spec.template.md`, `.claude/rules/flow.md`).
- Document 1 analysed locally with a deterministic parser; counts above are exact for that file.

INVARIANTS REPORT for the build: to be filled at the end of each approved phase.
