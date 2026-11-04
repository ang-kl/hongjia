---
flow: spec
title: "P0R - Rust server with the same behaviour as the live P0; plain JavaScript in the browser; Rush.js removed"
act: "directive"
force: "MUST"
status: "DRAFT for the owner's review. Building starts only after: APPROVE docs/specs/2026-11-05_P0R-rust-server.md. Deploying (merge to main) needs a separate APPROVE merge PR #3."
scope:
  - "Cargo.toml"
  - "Cargo.lock"
  - "rust-toolchain.toml"
  - "crates/web/**"
  - "web/**"
  - "tests/browser/**"
  - "Dockerfile"
  - ".dockerignore"
  - ".gitignore"
  - ".gitattributes"
  - ".github/workflows/ci.yml"
  - "README.md"
  - "rush.json (delete)"
  - "common/** (delete)"
  - "apps/** (delete)"
  - "packages/** (delete)"
  - "docs/specs/2026-11-05_P0R-rust-server.md"
  - "docs/specs/2026-11-04_P0-foundations.md (append evidence only)"
  - "docs/specs/2026-11-04_family-review-site.md"
verify: "cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked && node --test \"web/test/**/*.test.mjs\""
---

# P0R - Rust server

Version 0.1 (draft) · 5 November 2026 · Asia/Singapore · parent plan: `docs/specs/2026-11-04_family-review-site.md` (v0.4), phase P0R.

## Intent

- Outcome: hongjia.org is served by a Rust program that behaves exactly like today's live P0 page (same routes, status codes, headers, health check and page copy). The browser files are plain JavaScript with no build step, and Rush.js and the Node.js server are removed.
- Force: MUST. Every later phase (database, login journal, documents) will be written on this server, so the language change happens now, while the site holds nothing.
- Done when: every acceptance criterion passes on the branch; after the owner's separate `APPROVE merge PR #3`, Railway deploys successfully and the live checks match today's.

## Interpretation

- UNDERSTANDING: The owner chose option (a) on 5 November 2026: Rust server, plain JavaScript in the browser, no Rush.js. P0R swaps the engine and keeps the same behaviour. It adds no features. The live Node.js placeholder stays up until the Rust version is approved and merged.
- GAPS: none that change P0R. The parent plan's G2 ("second HTML") and D16 (names in a public repository) matter from P1 onwards.

## Evidence gathered before drafting (read-only, 5 November 2026)

| Check | Result |
|---|---|
| Rust stable release (static.rust-lang.org) | 1.99.1, released 13 October 2026; Rust 1.97 is installed in this workspace and can be updated |
| axum on crates.io | 0.8.9 (14 April 2026) |
| tokio on crates.io | 1.54.1 (21 October 2026) |
| Runtime image | `gcr.io/distroless/cc-debian13:nonroot`, digest `sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1`, user 65532, no shell |
| Railway Dockerfile rules | only `type=cache` mounts are accepted (deployment `841268e3` failed on a secret mount); Railway's cache mounts also need the service ID in their id |
| Live P0 baseline (5 November 2026, 05:39 SGT) | both addresses: `/` 200, `/healthz` 200, `/robots.txt` 200, assets 200, unknown 404, POST 405, all eight security headers, `http` redirects to `https` (Railway edge) |

## Assumptions

| ID | Assumption | Status | Note |
|----|------------|--------|------|
| A1 | The server is written in Rust | confirmed | owner, option (a), 5 November 2026 |
| A2 | Rush.js and all npm packages are removed. Node.js remains only as a test runner for the browser JavaScript, in CI and locally, never shipped | pending | browser code still needs a JavaScript runtime for its tests |
| A3 | Direct runtime dependencies are axum 0.8 and tokio 1.x only; versions locked in `Cargo.lock` | pending | |
| A4 | Rust 1.99.1 pinned in `rust-toolchain.toml`; build image `rust:1.99.1-slim-trixie`; runtime image distroless cc-debian13 nonroot, pinned by the digest above | pending | |
| A5 | Browser files are compiled into the binary. Served files: `/assets/site.css`, `/assets/site.mjs`, `/assets/device-profile.mjs` | pending | three files instead of P0's two, because with no build step `site.mjs` imports the profile |
| A6 | Behaviour parity with the live P0: same routes, codes, headers, health JSON, robots.txt and page copy | pending | the only deliberate difference is A5 |
| A7 | The server listens on `$PORT` and on 8080. A test-only setting, `HONGJIA_ALSO_LISTEN` (default `8080`, empty to disable), lets tests avoid port clashes. Railway is not changed | pending | |
| A8 | No Railway cache mounts at first; a Rust build on Railway may take a few minutes | pending | avoids writing the service ID into the public Dockerfile |
| A9 | Work continues on this session's branch with a new PR (#3) carrying this spec and then the build | pending | |
| A10 | The device profile stays exactly as in michi and keeps its 480-row parity test | pending | |

Only the owner confirms an assumption. Approving this file confirms every pending row as written.

## What gets built

```
Cargo.toml                    workspace (members: crates/web), release profile tuned for size
Cargo.lock                    committed
rust-toolchain.toml           channel 1.99.1, components rustfmt and clippy
crates/web/
  Cargo.toml                  hongjia-web; axum, tokio
  src/main.rs                 reads PORT and HONGJIA_ALSO_LISTEN, binds, graceful shutdown on SIGTERM
  src/lib.rs                  router, exact-path routes, method guard, security headers, commit label
  tests/http.rs               raw-HTTP tests against a running server (parity with P0's tests)
  tests/dockerfile.rs         only cache mounts; pinned images; non-root runtime
web/
  index.html                  unchanged copy
  assets/site.css             unchanged
  assets/site.mjs             applies the device tiers; imports ./device-profile.mjs
  assets/device-profile.mjs   unchanged rules (michi)
  test/device-profile.test.mjs, test/fixtures/michi-parity.json   moved from packages/shared
tests/browser/p0-layout.mjs   now starts the Rust binary
Dockerfile                    rust:1.99.1-slim-trixie build and test; distroless nonroot runtime; binary only
.github/workflows/ci.yml      fmt, clippy, cargo test, node --test, container job
```

Removed: `rush.json`, `common/`, `apps/`, `packages/`, and the pnpm lines in `.gitattributes`.

**Routes** (as P0): `GET /` page; `GET /healthz` returns `{"status":"ok","commit":"<short commit>"}`; `GET /robots.txt` disallows all; `GET /assets/<the three files>`; anything else 404; any method other than GET and HEAD 405 with `Allow: GET, HEAD`. Paths are matched exactly as received, never decoded.

**Headers on every response** (as P0): the same Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy and X-Robots-Tag values.

## Invariants

| ID | Maxim | Scope | Limit | Contrary | Check |
|----|-------|-------|-------|----------|-------|
| I1 | The Rust server behaves like the live P0 | every route and error | the third asset file (A5) | "while we are here" changes | `tests/http.rs` parity cases; live checks after merge |
| I2 | Nothing from npm is shipped or needed at runtime | container | Node.js as a test runner only | convenience packages | container holds one binary; CI image check |
| I3 | P0R changes no Railway setting, variable or service | Railway project | none | quick fixes | variable list and environment identical before and after |
| I4 | Nothing reaches `main` without `APPROVE merge PR #3` | git, Railway | none | speed | PR remains a draft until approval |
| I5 | Every response carries the security headers | server | none | framework defaults | `tests/http.rs` header cases over all routes and errors |
| I6 | The runtime image has no shell and runs as non-root | Dockerfile | none | easier debugging | `tests/dockerfile.rs`; CI `docker inspect` user 65532 |
| I7 | Dockerfile uses only cache mounts | Dockerfile | none | local-build shortcuts | `tests/dockerfile.rs` |
| I8 | Device profile rules identical to michi | browser JavaScript | none | refactoring | `web/test/device-profile.test.mjs` (480 rows) |
| I9 | Hyphens only in served text; no family information | page and repo | owner's name in LICENSE.MD | typographic dashes, realistic copy | `tests/http.rs` dash and copy cases; repository scan |
| I10 | Reproducible builds | toolchain, crates, images | none | floating tags | `rust-toolchain.toml`, `Cargo.lock` with `--locked`, digest-pinned runtime |

## Acceptance criteria

- [ ] `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings` are clean → CI `rust`
- [ ] `cargo test --locked`: page copy, health, robots, assets, 404, 405 with `Allow`, HEAD without a body, query strings, dotted and encoded paths 404, every header on every case, commit label, ports → `crates/web/tests/http.rs`
- [ ] Dockerfile guard: only cache mounts, pinned images, non-root → `crates/web/tests/dockerfile.rs`
- [ ] Device profile parity with michi still passes → `node --test "web/test/**/*.test.mjs"` (CI `browser-js`)
- [ ] Browser check, seven viewports, light and dark, against the Rust binary: correct tier, no sideways scroll, no console or CSP errors → `tests/browser/p0-layout.mjs` (local; reported in the PR)
- [ ] Container builds from a clean checkout, answers on `$PORT` and 8080, runs as user 65532, and contains only the binary (image well under 60 MB) → CI `container`, plus a local run
- [ ] After `APPROVE merge PR #3` only: Railway deployment succeeds; both addresses return the same codes and headers as the 5 November baseline; `/healthz` shows the merge commit; live browser check 7 of 7 → evidence appended here

## Out of scope

- Any new feature: login, database, uploads, globe, review layer.
- Any Railway setting, variable, healthcheck path or cache-mount change.
- Merging to `main`.

## Rollback

Railway can roll back to deployment `0d357c5a` (the live Node.js placeholder), or the merge commit can be reverted. No data exists to lose.

## Evidence

To be filled after building: INVARIANTS REPORT, verify output, CI links and, after the merge, the live checks.

### Evidence, build stage (appended 5 November 2026, before merge)

Approval: the owner replied `APPROVE docs/specs/2026-11-05_P0R-rust-server.md` on 5 November 2026. Nothing above this heading was changed after approval.

**Verify command** (local, Rust 1.99.1 installed from `rust-toolchain.toml`): `cargo fmt --check` clean; `cargo clippy --all-targets --locked -- -D warnings` clean; `cargo test --locked` 16 of 16 (2 unit, 2 Dockerfile guard, 12 HTTP); `node --test "web/test/**/*.test.mjs"` 12 of 12 (device profile parity with michi, 480 rows). `Cargo.lock` holds 42 packages; direct dependencies are axum 0.8.9 and tokio 1.54.1 only.

**Parity with the live P0** (the Rust binary against https://hongjia.org, 13 cases: page, health, robots, both shared assets, unknown path, POST on known and unknown paths, HEAD, dotted and encoded paths, double slash, query string): status codes and 11 header values identical in every case. The only intended difference is the third asset, `/assets/device-profile.mjs` (A5), which returns 200 as JavaScript.

**Browser check** (`tests/browser/p0-layout.mjs` against the Rust binary, Chromium, light and dark): 14 of 14 passed at the seven viewports.

**Runtime image** (local; the repository Dockerfile's runtime stage with a host-built binary, because this workspace's proxy blocks crate downloads inside a container build): answers on `PORT=3000` and 8080, runs as `65532:65532`, has no shell, sends all eight security headers, is 44.7 MB, and stops cleanly on SIGTERM (exit 0). The release binary is 1.1 MB. The build image `rust:1.99.1-slim-trixie` exists (checked through Google's Docker Hub mirror). The full Dockerfile build is proven by CI's `container` job.

**Railway**: variable names unchanged (only Railway's own); live deployment still `0d357c5a` (Node.js placeholder).

**INVARIANTS REPORT (build stage)**

| ID | Result | Evidence |
|----|--------|----------|
| I1 | Passed | 13-case live comparison: no differences; `tests/http.rs` |
| I2 | Passed | runtime image holds one binary; no npm packages anywhere in the repository |
| I3 | Passed | Railway variables and deployment unchanged |
| I4 | Passed | PR #3 still a draft |
| I5 | Passed | `every_response_carries_every_security_header` (9 cases including 404 and 405) |
| I6 | Passed | `tests/dockerfile.rs`; local runtime: user 65532, no shell |
| I7 | Passed | `only_cache_mounts_which_railway_accepts` |
| I8 | Passed | `web/test/device-profile.test.mjs` 12 of 12 |
| I9 | Passed | `served_text_uses_hyphens_only`, approved-copy test; repository scan of 25 files clean |
| I10 | Passed | toolchain 1.99.1 pinned; `--locked` everywhere; runtime image pinned by digest |

Still to come: CI on the PR, then, after `APPROVE merge PR #3`, the live checks.
