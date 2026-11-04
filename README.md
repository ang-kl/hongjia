# hongjia
洪家

A private family review site for hongjia.org. Updated 4 November 2026.

**Status: phase P0.** The site shows a placeholder page only. There is no login, family content or data yet.

## Plan and specs

- [`docs/specs/2026-11-04_family-review-site.md`](docs/specs/2026-11-04_family-review-site.md): the overall plan (draft).
- [`docs/specs/2026-11-04_P0-foundations.md`](docs/specs/2026-11-04_P0-foundations.md): phase P0, approved by the owner.

## Working on it

Needs Node 22.12 or later (production runs Node 24). Rush runs through the checked-in script, so no global install is needed:

```bash
node common/scripts/install-run-rush.js install
```

```bash
node common/scripts/install-run-rush.js build
```

```bash
node common/scripts/install-run-rush.js test
```

```bash
node apps/web/dist/server.mjs
```

The server listens on `$PORT` and on 8080.

## Layout

- `apps/web`: the web app (`@hongjia/web`).
- `packages/shared`: code shared between projects (`@hongjia/shared`), starting with the owner's device profile.
- `tests/browser`: browser checks across the owner's device classes.

## Deploying

Railway builds the root `Dockerfile` from the `main` branch, so **a merge to `main` deploys**. Merges happen only with the owner's approval.

## Licence

Proprietary. See [LICENSE.MD](LICENSE.MD).
