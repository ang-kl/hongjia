---
flow: spec
title: "P1 - Individual sign-in, sessions, consent and the login journal (Rust + PostgreSQL)"
act: "directive"
force: "MUST"
status: "DRAFT. The owner asked on 5 November 2026 to \"continue until the website is up\"; building proceeds on the branch with the recommendations below. Every Railway change and every merge still needs its own APPROVE line (section: Gates)."
scope:
  - "Cargo.toml"
  - "Cargo.lock"
  - "crates/web/**"
  - "db/migrations/**"
  - "web/**"
  - "tests/browser/**"
  - "Dockerfile"
  - ".github/workflows/ci.yml"
  - "README.md"
  - "docs/specs/2026-11-05_P1-signin-journal.md"
  - "docs/specs/2026-11-05_P0R-rust-server.md (append evidence only)"
  - "docs/specs/2026-11-04_family-review-site.md"
verify: "cargo fmt --check && cargo clippy --all-targets --all-features --locked -- -D warnings && cargo test --locked && DATABASE_URL=<local> cargo test --locked --features db-tests && node --test \"web/test/**/*.test.mjs\""
---

# P1 - Sign-in, sessions, consent and the login journal

Version 0.1 (draft) · 5 November 2026 · Asia/Singapore · parent plan: `docs/specs/2026-11-04_family-review-site.md`, phase P1.

## Intent

- Outcome: each of the four family profiles signs in with its **own** credential; the site keeps server-side sessions, recognises devices, asks for consent before any location is collected, and shows every signed-in member a login journal with an honest estimate of active time. Old journal rows are purged on schedule.
- Force: MUST. This is the owner's precondition for the site going online ("individual stronger credentials before the family site goes online").
- Done when: the acceptance criteria pass on the branch and in CI; after the Railway gates and `APPROVE merge PR #4`, the owner can enrol and sign in on hongjia.org.

## Interpretation

- UNDERSTANDING: P1 adds sign-in and the journal only. Documents, review, the dashboard and alerts come in later phases. The site stays the placeholder until the database exists: **with no database configured, the server serves today's placeholder**, so merging is safe even before Railway is set up.
- GAPS: D4, D9 and D16 below carry recommendations the owner has not yet confirmed. They are cheap to change later.

## Evidence gathered before drafting (read-only, 5 November 2026)

| Check | Result |
|---|---|
| sqlx on crates.io | 0.9.0 (features used: runtime-tokio, postgres, migrate, macros, derive, tls-none) |
| argon2 | 0.6.0 (RustCrypto, Argon2id) |
| hmac / sha2 / subtle | 0.13.0 / 0.11.1 / 2.6.1 |
| webauthn-rs (for passkeys, P1b) | 0.6.2 |
| Railway client IP | the edge sends `X-Real-IP` (and `X-Forwarded-Proto: https`) |
| Railway PostgreSQL | added as a database service; the app references `${{Postgres.DATABASE_URL}}`, which uses the private network (no egress charge) |
| Local PostgreSQL | 16.15 server binaries present for tests; CI uses a PostgreSQL service container |

## Assumptions

| ID | Assumption | Status | Note |
|----|------------|--------|------|
| A1 | D4: P1 uses a **per-profile passphrase** (16 or more characters, Argon2id); **passkeys follow in P1b** as the primary method, with the passphrase kept as fallback | pending | building on this recommendation |
| A2 | First credential: the owner (adrian) enrols with a one-time bootstrap code that **the owner sets as a Railway variable**, so it never passes through this session. After that, the owner issues one-time enrolment codes (single use, 24 hours, shown once) and hands them over in person | pending | no email or SMS |
| A3 | D16: profile names and the owner come from Railway variables (`HONGJIA_PROFILES`, `HONGJIA_OWNER`), never from the public repository | pending | |
| A4 | D9: journal kept 180 days, locations 90 days; the owner can change both (journal 30 to 730 days; location never longer than journal) | pending | |
| A5 | D11: failed sign-in counts visible to all; details (time, device) to the owner only | pending | |
| A6 | Location: off by default; if allowed on a device, the browser's own prompt at low accuracy, rounded on the device to one decimal place (about 11 km), shown as coordinates. Town names come with the alerts phase | pending | |
| A7 | Shared-password mode exists only for local development and the server refuses it when Railway's environment variables are present | pending | the owner's starter password is never committed |
| A8 | Rate limit: 5 failed attempts per profile or per network prefix in 15 minutes blocks further attempts for 15 minutes | pending | |
| A9 | The server keeps one internal key for hashing network prefixes, created inside the database on first start; it is not a user credential and never leaves the server | pending | |
| A10 | Work goes on this session's branch in PR #4 | pending | |

## Gates (each needs its own reply; nothing here happens without it)

| Gate | Action | Target | Reversible? |
|---|---|---|---|
| `APPROVE create Railway Postgres` | add a PostgreSQL database service (with its volume) to project hongjia, region asia-southeast1 | Railway project | yes: delete the service (data lost) |
| `APPROVE set Railway variables` | set on the web service: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `HONGJIA_PROFILES`, `HONGJIA_OWNER=adrian`, `HONGJIA_PUBLIC_ORIGIN=https://hongjia.org` | Railway web service | yes: remove the variables |
| owner action | the owner sets `HONGJIA_BOOTSTRAP_CODE` (24 or more characters) in Railway themselves | Railway web service | yes |
| `APPROVE enable Postgres backups` | turn on Railway's daily and weekly volume backups for the database | Railway database | yes |
| `APPROVE merge PR #4` | merge, which deploys | `main`, Railway | yes: revert or roll back |

## What gets built

- **Database** (`db/migrations/0001_p1.sql`, applied by the server at start): `profiles`, `credentials`, `enrolment_codes`, `devices`, `sessions`, `login_attempts`, `consents`, `settings`, `audit_log`.
- **Server** (`crates/web`): placeholder mode with no `DATABASE_URL`; with a database: sign-in, sign-out (here or everywhere), enrolment, consent, home, journal, owner page, privacy notice, heartbeat and location endpoints, retention job every 6 hours.
- **Sessions**: 256-bit random token in `__Host-hj_sid` (HttpOnly, Secure, SameSite=Lax), stored as SHA-256; idle limit 14 days, absolute 30 days; rotated at sign-in; ended by sign-out, by the owner, or by a new passphrase.
- **Devices**: random identifier in `__Host-hj_dev` (400 days), stored hashed; members can name their device. No fingerprinting.
- **CSRF**: per-session token on every form and API call, plus `Origin` and `Sec-Fetch-Site` checks.
- **Headers**: as P0R, except `form-action 'self'`, `connect-src 'self'`, `geolocation=(self)` so the consented location prompt can work, and `Referrer-Policy: same-origin` (as plan section 6), because under `no-referrer` browsers send `Origin: null` on form posts.
- **Browser** (`web/assets`): `session.mjs` sends a heartbeat each minute while the tab is visible and there was a tap, scroll or key in the last 2 minutes; and, only where consent was given, one rounded location per session.
- **Journal page**: profile selected, sign-in time (Singapore time), device, approximate location or "not shared", estimated active time, how the session ended; failed attempts as counts. Fixed captions: "Profile selected, not proof of who signed in." and "Active time is an estimate from a visible tab with recent interaction. An open tab does not prove someone was reading."

## Invariants

| ID | Maxim | Scope | Limit | Contrary | Check |
|----|-------|-------|-------|----------|-------|
| I1 | Each profile has its own credential; no shared password in production | auth | local development mode | convenience | `shared_dev_refused_on_railway`; enrolment tests |
| I2 | Passphrases are stored only as Argon2id hashes and never logged or echoed | auth | none | debugging | unit test on hash format; log review |
| I3 | Location is stored only after consent on that device, and only rounded | journal | none | better alerts | db tests `location_requires_consent`, `location_is_rounded` |
| I4 | Every state change needs a valid session and CSRF token | server | sign-in and enrolment (CSRF without session) | simpler forms | db tests `csrf_required_*` |
| I5 | Rate limits stop repeated guessing | sign-in | none | family friction | db test `rate_limit_blocks_after_five` |
| I6 | Expired journal and location data are purged | retention | owner's settings range | keeping history | db test `retention_purges` |
| I7 | No family names, codes or passwords in the repository | repo | owner name in LICENSE.MD | realistic fixtures | repository scan |
| I8 | With no database the site is exactly today's placeholder | server | none | half-configured deploys | `tests/http.rs` (unchanged P0R suite) |
| I9 | Security headers on every response | server | the three P1 changes above | framework defaults | header tests |
| I10 | No Railway change or merge without its gate reply | Railway, git | none | speed | gate table |

## Acceptance criteria

- [ ] fmt, clippy (`-D warnings`, all features) clean → CI `rust`
- [ ] `cargo test --locked`: P0R suite unchanged in placeholder mode, plus unit tests (passphrase rules, cookies, user-agent summary, network prefix, rounding, escaping, shared-dev refusal) → CI `rust`
- [ ] `cargo test --features db-tests` against PostgreSQL: bootstrap enrolment, owner issues a code, member enrols, sign-in success and failure, rate limit, sign-out everywhere, session expiry, CSRF and Origin rejection, owner-only pages, consent and location rules, heartbeat, journal contents and captions, retention purge → CI `rust-db`
- [ ] Browser JavaScript tests still pass → CI `browser-js`
- [ ] Browser check of the sign-in, enrolment, consent and journal pages at the seven viewports → `tests/browser/p1-flow.mjs` (local)
- [ ] Container builds and serves the placeholder with no database → CI `container`
- [ ] After the gates: owner enrols and signs in on hongjia.org; journal shows the sign-in; live headers correct → evidence appended here

## Out of scope

Passkeys (P1b), documents and review (P2 to P4), dashboard and alerts (P6), town names for locations, any email, SMS or push message.

## Rollback

Revert the merge or roll back the Railway deployment; the database can stay (it holds only journal data) or be deleted.

## Evidence

To be filled after building.

### Evidence, build stage (appended 5 November 2026, before merge)

Instruction: the owner wrote "continue until the website is up" and then "merge when green" (5 November 2026). Building proceeded on the recommendations in the Assumptions table; Railway changes still wait for their gate replies.

**Verify** (local; Rust 1.99.1; PostgreSQL 16.15): `cargo fmt --check` clean; `cargo clippy --all-targets --all-features --locked -- -D warnings` clean; `cargo test --locked` 32 of 32 (18 unit, 2 Dockerfile guard, 12 placeholder parity, unchanged from P0R); `cargo test --locked --features db-tests` adds 11 of 11 against PostgreSQL; `node --test "web/test/**/*.test.mjs"` 15 of 15.

**Database tests cover**: bootstrap enrolment works once and only until the owner has a passphrase; codes are single use, stored only as hashes, and not used up by a rule-breaking passphrase; passphrases stored only as Argon2id; sign-in success and failure; five failures in 15 minutes block even the right passphrase (429); CSRF, Origin and owner-only checks (403); heartbeat adds at most the recent gap; location refused without consent, rounded to tenths, removed when consent is withdrawn; journal captions, per-profile failure counts and owner-only details; sign-out here, everywhere, by the owner, and the 14-day idle limit; retention purges and bounded settings; family headers; shared-dev mode works locally; removed profiles are hidden, not deleted.

**Browser** (`tests/browser/p1-flow.mjs`, Chromium): real enrolment, consent and home, then signin, enrol, privacy, consent, home, journal and owner pages at the seven viewports in light and dark: 98 of 98 (correct tier, no sideways scroll, no console or CSP errors). The placeholder check still passes 14 of 14.

**Defects found and fixed while testing**
- Under `Referrer-Policy: no-referrer`, browsers send `Origin: null` on form posts, so real sign-ins were refused (raw-HTTP tests could not show this). Family pages now send `same-origin`, as plan section 6 specified; a database test guards it.
- The placeholder's `place-items: center` on `body` made current Chrome shrink family pages to a wide table's width on phones. Reset on family pages.
- Radio choices stacked their labels under the buttons; now one row each.

**Railway**: unchanged (only Railway's own variables; no database service yet). Merging is safe before the gates: without `DATABASE_URL` the server stays the placeholder.

**INVARIANTS REPORT (build stage)**

| ID | Result | Evidence |
|----|--------|----------|
| I1 | Passed | `shared_dev_refused_on_railway`; enrolment and sign-in tests |
| I2 | Passed | `passphrase_hash_round_trip_and_format`; database check that the stored hash holds no passphrase |
| I3 | Passed | `location_needs_consent_and_is_rounded` |
| I4 | Passed | `csrf_origin_and_owner_checks` |
| I5 | Passed | `signin_success_failure_and_rate_limit` |
| I6 | Passed | `retention_purges_and_settings_are_bounded` |
| I7 | Passed | repository scan; test profiles are alpha to delta |
| I8 | Passed | placeholder parity suite unchanged, 12 of 12 |
| I9 | Passed | `family_headers_health_and_unknown_routes`; unit test on header differences |
| I10 | Passed | no Railway change made; merge waits for green CI |

### Gates (appended 5 November 2026)

The owner replied "approve all" for the Railway gates, then "backup isn't necessary".

| Gate | Outcome |
|---|---|
| Create Railway Postgres | Done 08:12 SGT: service `Postgres` (Railway template, PostgreSQL 18, image `ghcr.io/railwayapp-templates/postgres-ssl:18`), region asia-southeast1, volume `postgres-volume` at `/var/lib/postgresql/data`. Its password was generated by Railway and never passed through this session. Status: online, deployment SUCCESS. |
| Set Railway variables | Done: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (private network), `HONGJIA_PROFILES`, `HONGJIA_OWNER=adrian`, `HONGJIA_PUBLIC_ORIGIN=https://hongjia.org`. Set without a redeploy; they take effect when P1 is deployed. The live site stayed the placeholder (`/healthz` commit `4922888`). |
| Enable Postgres backups | **Declined by the owner** ("backup isn't necessary"). Plan safeguard not applied; journal data would be lost if the volume were lost. |
| Owner action: `HONGJIA_BOOTSTRAP_CODE` | Pending: set by the owner in Railway. |
| Merge | Authorised by the owner ("merge when green"); blocked because GitHub refuses every update to the branch (`fatal error in commit_refs`, API 500) since 07:53 SGT. |

### Amendment (5 November 2026): one family password

Owner decision: "i dont want to enrol / it is meant to be simple", then "just one password". The owner also noted that enrolment had been added without permission; that is correct (A1 and A2 above were recommendations, never confirmed).

- Sign-in is now: tap your name, type the one family password (`HONGJIA_FAMILY_PASSWORD`, a Railway variable, never committed). It is compared in constant time.
- Removed: per-profile passphrases, the bootstrap code, enrolment codes, the enrolment page, the owner's code page and the Argon2 dependency. The unused `credentials` and `enrolment_codes` tables stay in the database (migration 0001 is already applied) and are not used.
- Kept, because the original brief asked for them: the four names, sessions, rate limiting (5 failures in 15 minutes), location consent, the login journal, the owner's retention settings and ending sessions.
- If `HONGJIA_FAMILY_PASSWORD` is missing the server keeps serving the placeholder instead of failing.
- Known and accepted by the owner: a shared password cannot show who really picked which name. Invariant I1 ("own credential per profile") is withdrawn by this decision.

