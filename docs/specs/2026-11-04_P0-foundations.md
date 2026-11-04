---
flow: spec
title: "P0 Foundations - Rush workspace, safe placeholder page, container build"
act: "directive"
force: "MUST"
status: "DRAFT for the owner's review. Building starts only after: APPROVE docs/specs/2026-11-04_P0-foundations.md. Deploying (merge to main) needs a separate APPROVE merge PR #1."
scope:
  - "rush.json"
  - "common/config/rush/**"
  - "common/scripts/**"
  - ".gitattributes"
  - ".gitignore"
  - "apps/web/**"
  - "packages/shared/**"
  - "tests/browser/**"
  - "Dockerfile"
  - ".dockerignore"
  - ".github/workflows/ci.yml"
  - "README.md"
  - "docs/specs/2026-11-04_P0-foundations.md"
  - "docs/specs/2026-11-04_family-review-site.md"
verify: "node common/scripts/install-run-rush.js install && node common/scripts/install-run-rush.js build && node common/scripts/install-run-rush.js test"
---

# P0 Foundations

Version 0.1 (draft) · 4 November 2026 · Asia/Singapore · parent plan: `docs/specs/2026-11-04_family-review-site.md` (v0.2), phase P0.

## Intent

- Outcome: a Rush.js workspace with one deployable app, `@hongjia/web`, that serves a safe "coming soon" page and a health route at hongjia.org, with strict security headers and no family information. It builds reproducibly in a container that Railway picks up without any change to Railway settings.
- Force: MUST. Every later phase builds on this workspace, and the first deploy replaces a failing build with a working, harmless page.
- Done when: every acceptance criterion below passes its named check on the branch; after the owner's separate `APPROVE merge PR #1`, Railway reports the deployment as successful and both addresses answer 200 with the expected headers.

## Interpretation

- UNDERSTANDING: P0 sets up the repository and pipeline, not the family features. The page says only that a private family space is coming. There is no login, database, upload or family content. The owner (adrian) approved drafting this spec; building waits for approval of this file, and deploying waits for approval of the merge.
- GAPS:
  - Placeholder wording (A2) is a draft for the owner to confirm or change.
  - Node version (A4): Node 24 is recommended over the newer Node 26 because this Rush release's own template targets Node 24.
  - G2 ("second HTML") and D16 (names in a public repo) from the parent plan do not affect P0.

## Evidence gathered before drafting (read-only spikes, 4 November 2026)

| Check | Result |
|---|---|
| `rush init` with Rush 5.182.1 in a scratch folder | works; template pins pnpm 9.15.9 and Node `>=24.22.1 <25.0.0` |
| Node release schedule (nodejs.org) | Node 24 (Krypton) maintenance LTS until 30 April 2028; Node 26 (Lithium) active LTS since 28 October 2026; Node 22 ends 30 April 2027 |
| Docker in this workspace | daemon starts; a local container build and run is possible |
| Railway build | Railway uses a root `Dockerfile` automatically ("Using detected Dockerfile!"), so no builder setting change is needed |
| Railway config files | `railway.json` (Config as Code) is deprecated, with a hard cut-off on 1 December 2026; not used here |
| Railway port | Railway injects `PORT`; hongjia.up.railway.app targets port 8080; hongjia.org has no fixed target port |
| hongjia.org | verified, certificate valid, DNS propagated; currently `404 Application not found` because nothing is deployed |
| Last deployment | failed at "Railpack failed to prepare the build" (README-only commit) |

## Assumptions

| ID | Assumption | Status | Note |
|----|------------|--------|------|
| A1 | Rush.js is the workspace tool | confirmed | owner, 4 November 2026 |
| A2 | Page copy: title "洪家 · hongjia"; text "A private family space. Coming soon."; nothing else | pending | owner may change the words |
| A3 | Build through a root `Dockerfile`, auto-detected by Railway | pending | avoids Railpack's failure and the deprecated `railway.json` |
| A4 | Production runs Node 24 LTS (image `node:24.22.2-bookworm-slim`); the workspace accepts Node 22.12 and later for local work | pending | Node 26 is the alternative |
| A5 | pnpm 9.15.9, as pinned by the Rush template | pending | |
| A6 | No PostgreSQL, migrations or bucket in P0; they move to P1 because creating them changes Railway | pending | narrows the parent plan's P0 |
| A7 | No runtime npm dependencies; the server uses only Node's built-in modules | pending | |
| A8 | GitHub Actions runs build, tests and a container smoke test on every pull request and on `main` | pending | free for public repositories |
| A9 | The server listens on `$PORT`, and also on 8080 if `$PORT` is different, so both domains work without changing Railway settings | pending | |
| A10 | P0 commits go to this session's branch, `claude/blissful-hawking-zft9jr`, so PR #1 carries the plan, the licence and P0 | pending | |
| A11 | The owner profile is adrian | confirmed | owner, 4 November 2026 |

Only the owner confirms an assumption. Approving this file confirms every pending row as written.

## What gets built

```
rush.json                     Rush 5.182.1, pnpm 9.15.9, Node >=22.12.0 <25.0.0, two projects
common/config/rush/*          Rush config; command-line.json adds bulk "test"
common/scripts/install-run-*  generated by Rush; used by CI and the Dockerfile
apps/web/                     @hongjia/web (private)
  src/server.mjs              node:http server, GET and HEAD only
  src/headers.mjs             one place for security headers
  public/index.html           the placeholder page
  public/assets/site.css      styles, device tiers via data attributes
  public/assets/site.mjs      sets data-form-factor / data-size-tier from the device profile
  scripts/build.mjs           copies public/ and the shared device profile into dist/
  test/*.test.mjs             node --test
packages/shared/              @hongjia/shared (private)
  src/device-profile.mjs      michi's port of the owner's AI-JS profile v2-template-rin3-1, rules unchanged
  test/device-profile.test.mjs
tests/browser/p0-layout.mjs   Playwright, seven viewports
Dockerfile                    two stages: Rush build on Node 24, then a slim runtime as the non-root "node" user
.dockerignore
.github/workflows/ci.yml
```

**Routes**

| Route | Response |
|---|---|
| `GET /` | the placeholder page |
| `GET /healthz` | `{"status":"ok","commit":"<short commit>"}` from Railway's `RAILWAY_GIT_COMMIT_SHA`, so the live build can be checked |
| `GET /robots.txt` | disallow everything |
| `GET /assets/*` | the two static files only; anything else 404 |
| anything else | 404; methods other than GET and HEAD get 405 |

**Headers on every response**: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` with every feature off, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow`.

**Device classes tested** (from the parent plan, section 5.9): notebook 1440 × 900; tablet 1180 × 820 and 820 × 1180; mini tablet 744 × 1133; phone max 430 × 932; phone small 375 × 667 and 360 × 740.

## Invariants

| ID | Maxim | Scope | Limit | Contrary | Check |
|----|-------|-------|-------|----------|-------|
| I1 | No family information appears in the repository or on the page | whole repo, served page | owner's name already in LICENSE.MD | realistic placeholder text | `routes.test` approved-copy assertion; PR review |
| I2 | P0 changes no Railway setting, variable or service | Railway project | none | quick fixes in the dashboard | variable list and environment description identical before and after |
| I3 | Nothing reaches `main` without `APPROVE merge PR #1` | git, Railway | none | speed | PR still a draft until approval |
| I4 | Every response carries the security headers | server | none | convenience | `headers.test` over every route and error |
| I5 | Layout follows geometry tiers exactly as in michi | front end | none | device sniffing | `device-profile.test` parity table |
| I6 | The runtime container runs as non-root and has no npm packages | Dockerfile | none | simpler single-stage image | CI container job (`id -u` not 0; no `node_modules`) |
| I7 | Hyphens only in served text | page | none | typographic dashes | `routes.test` dash scan |
| I8 | Builds are reproducible from pinned versions | Rush, pnpm, Node image | none | floating "latest" tags | `rush.json` and Dockerfile pins; clean-clone CI build |

## Acceptance criteria

- [ ] Clean clone: `rush install`, `rush build` and `rush test` pass → CI job `build-test`, plus the local log
- [ ] `/` returns 200 with only the approved copy, no form and no outside address → `apps/web/test/routes.test.mjs`
- [ ] All headers present on `/`, `/healthz`, `/robots.txt`, a 404 and a 405 → `apps/web/test/headers.test.mjs`
- [ ] `/healthz` returns 200 JSON with status and commit → `routes.test.mjs`
- [ ] `/robots.txt` disallows all; every response has `X-Robots-Tag` → `routes.test.mjs`
- [ ] Unknown paths 404; POST 405; encoded path tricks under `/assets` 404 → `routes.test.mjs`
- [ ] Device profile gives the same answers as michi's module over a grid of viewports → `packages/shared/test/device-profile.test.mjs`
- [ ] At all seven viewports: correct tier attribute, no sideways scroll, text visible, no console or CSP errors → `tests/browser/p0-layout.mjs` (run locally; reported in the PR)
- [ ] Container builds from a clean checkout, runs as non-root, answers on `$PORT` and on 8080 → CI job `container`, plus a local Docker run
- [ ] After `APPROVE merge PR #1` only: Railway log shows "Using detected Dockerfile!", the deployment succeeds, both addresses return 200 with headers, and `/healthz` shows the merge commit → post-deploy evidence in the INVARIANTS REPORT

## Out of scope

- Login, sessions, database, migrations, bucket, uploads, the sandbox origin, the globe and any family document.
- Any Railway setting, variable, healthcheck path, service, volume or DNS change.
- Installing the flow-kit hooks into this repository. They are the owner's instruments; the owner can copy them from 2026-0313_AI-JS, or approve that copy separately.
- Merging to `main`.

## Rollback

If the first deployment fails or misbehaves, revert the merge commit on `main`. Railway rebuilds, and the addresses return to today's 404. No data exists to lose.

## Evidence

To be filled after building: INVARIANTS REPORT (Passed, Failed or Not Verifiable, each with evidence), the verify output, CI links and, after the merge, the deployment checks.

### Evidence, build stage (appended 4 November 2026, before merge)

Approval: the owner replied `APPROVE docs/specs/2026-11-04_P0-foundations.md` on 4 November 2026. Nothing above this heading was changed after approval.

**Verify command** (local, Node 22.23.4): `rush install`, `rush build` and `rush test` all report SUCCESS for both projects. Tests: `@hongjia/shared` 12 of 12, `@hongjia/web` 21 of 21.

**Browser check** (`tests/browser/p0-layout.mjs`, Chromium, light and dark): 14 of 14 passed at the seven viewports, with the correct tier, no sideways scroll, text fully visible, and no console messages, failed requests or CSP violations.

**Container** (local Docker 29.9.2, same Dockerfile): the image builds; Rush ran on Node 24.22.2 and the tests passed inside the build. The container answers `{"status":"ok","commit":"60a5806"}` on both `PORT=3000` and 8080, runs as uid 1000 (`node`), has no `node_modules`, and sends the security headers. Docker Hub refused the anonymous base-image pull locally (429), so the same `node:24.22.2-bookworm-slim` image was taken from Google's Docker Hub mirror for this local check only. Railway pulls from Docker Hub itself.

**Notes on how the spec was met**
- `public/assets/site.mjs` is generated at build time from `src/client/apply-profile.mjs` plus the shared device profile, so the server still sends exactly two static files.
- One test expectation I wrote was wrong and was corrected: the device profile's fallback size, 1280 × 800, counts as a tablet under the owner's rules (as in michi). The rules were not changed.
- The README heading was corrected from "hongia" to "hongjia".

**INVARIANTS REPORT (build stage)**

| ID | Result | Evidence |
|----|--------|----------|
| I1 | Passed | approved-copy test; scan of all 33 files found no private terms |
| I2 | Passed | Railway variable names and environment description identical before and after (only Railway's own variables; latest deployment still the earlier failed one) |
| I3 | Passed | PR #1 still a draft; nothing merged |
| I4 | Passed | `headers.test.mjs`, 8 cases including 404 and 405 |
| I5 | Passed | `device-profile.test.mjs`, 480-row parity table generated from michi's module (commit fb60076) |
| I6 | Passed | local container: uid 1000, no `node_modules` |
| I7 | Passed | dash test on served files; scan of all repository files found no en or em dashes |
| I8 | Passed | `rush.json` pins Rush 5.182.1 and pnpm 9.15.9; Dockerfile pins `node:24.22.2-bookworm-slim`; CI pins Node 24.22.2 |

Still to come: CI results on the pull request, then, after `APPROVE merge PR #1`, the deployment checks.
