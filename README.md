# hongjia
洪家

A private family review site for hongjia.org. Updated 5 November 2026.

**Status: phase D3.** Without a database the site shows the placeholder page. With one (`DATABASE_URL`) and a family password, family members tap their name and type the family password; the site then offers documents (HTML pages, text and pictures in JPEG, PNG or WebP, viewed in a locked-down frame that fills the window), the login journal and location consent. Each document is filed under a dated number (`2026-1105_#1`) and has a management panel beside it: hashtags, versions, an upload check, rename and permanent delete (the uploader and the owner only). Every signed-in page has the 🛰️ satellite (search across all documents), the globe (documents as pins on islands of shared hashtags) and the 📁 folder (the open document's headings, or all documents). Family members can mark up any document: right-click it (press and hold on a touch screen, or tap twice with the Pencil) to highlight in five colours, underline, strike through, insert or replace words, add a sticky note, a text box or a stamp, or comment, or draw on it (Draw, Sketch that turns rough circles, boxes, lines and arrows into clean shapes, Shapes, Eraser and Undo, with a mouse, a finger or the Apple Pencil and its pressure), sign it with their own saved signature (drawn or typed; the caption shows who signed and when), or magnify it with the loupe; @mentions show under "Mentioned you" on Home. What they fill in is saved, shared or personal as the uploader chooses; pages that keep their own progress in browser storage keep working.

## Plan and specs

- [`docs/specs/2026-11-04_family-review-site.md`](docs/specs/2026-11-04_family-review-site.md): the overall plan (draft).
- [`docs/specs/2026-11-04_P0-foundations.md`](docs/specs/2026-11-04_P0-foundations.md): phase P0 (done; Node.js placeholder).
- [`docs/specs/2026-11-05_P0R-rust-server.md`](docs/specs/2026-11-05_P0R-rust-server.md): phase P0R, the Rust server (done).
- [`docs/specs/2026-11-05_P1-signin-journal.md`](docs/specs/2026-11-05_P1-signin-journal.md): phase P1, sign-in and the login journal.
- [`docs/specs/2026-11-05_P2a-documents.md`](docs/specs/2026-11-05_P2a-documents.md): phase P2a, upload and view documents.
- [`docs/specs/2026-11-05_P2b-documents-panel.md`](docs/specs/2026-11-05_P2b-documents-panel.md): phase P2b, filing numbers, the management panel and the full-window viewer.
- [`docs/specs/2026-11-05_D1-annotation-tools.md`](docs/specs/2026-11-05_D1-annotation-tools.md): D1, the annotation tools (right-click, long press and Pencil menu).
- [`docs/specs/2026-11-05_D2-ink-and-shapes.md`](docs/specs/2026-11-05_D2-ink-and-shapes.md): D2, drawing over documents: Draw, Sketch, Shapes, Eraser and Undo.
- [`docs/specs/2026-11-05_D3-signatures-loupe-pictures.md`](docs/specs/2026-11-05_D3-signatures-loupe-pictures.md): D3, signatures, the loupe and pictures.

## Layout

- `crates/web`: the Rust web server (`hongjia-web`: axum, tokio, sqlx).
- `db/migrations`: PostgreSQL schema, applied by the server at start.
- `web`: browser files (plain JavaScript, no build step). They are compiled into the server binary.
- `web/test`: tests for the browser JavaScript, run with Node.js (a test tool only, never shipped).
- `tests/browser`: browser checks across the owner's device classes.

## Working on it

Rust 1.99.1 is pinned in `rust-toolchain.toml`; `rustup` installs it automatically.

```bash
cargo test --locked
```

```bash
cargo clippy --all-targets --locked -- -D warnings
```

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres cargo test --locked --features db-tests
```

```bash
node --test "web/test/**/*.test.mjs"
```

```bash
cargo run --release
```

The server listens on `$PORT` and on 8080 (`HONGJIA_ALSO_LISTEN` changes or, if empty, disables the second port).

Family mode settings (Railway variables, never committed): `DATABASE_URL`, `HONGJIA_PROFILES` (comma-separated lowercase names), `HONGJIA_OWNER`, `HONGJIA_PUBLIC_ORIGIN` (required on Railway, for example `https://hongjia.org`) and `HONGJIA_FAMILY_PASSWORD` (the one family password). Sign-in is: tap your name, type the family password. If the family password is not set, the site keeps showing the placeholder.

## Deploying

Railway builds the root `Dockerfile` from the `main` branch, so **a merge to `main` deploys**. Merges happen only with the owner's approval.

## Licence

Proprietary. See [LICENSE.MD](LICENSE.MD).
