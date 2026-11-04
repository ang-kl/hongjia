# hongjia
洪家

A private family review site for hongjia.org. Updated 5 November 2026.

**Status: phase P0R.** The site shows a placeholder page only. There is no login, family content or data yet.

## Plan and specs

- [`docs/specs/2026-11-04_family-review-site.md`](docs/specs/2026-11-04_family-review-site.md): the overall plan (draft).
- [`docs/specs/2026-11-04_P0-foundations.md`](docs/specs/2026-11-04_P0-foundations.md): phase P0 (done; Node.js placeholder).
- [`docs/specs/2026-11-05_P0R-rust-server.md`](docs/specs/2026-11-05_P0R-rust-server.md): phase P0R, the Rust server.

## Layout

- `crates/web`: the Rust web server (`hongjia-web`, axum and tokio).
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
node --test "web/test/**/*.test.mjs"
```

```bash
cargo run --release
```

The server listens on `$PORT` and on 8080 (`HONGJIA_ALSO_LISTEN` changes or, if empty, disables the second port).

## Deploying

Railway builds the root `Dockerfile` from the `main` branch, so **a merge to `main` deploys**. Merges happen only with the owner's approval.

## Licence

Proprietary. See [LICENSE.MD](LICENSE.MD).
