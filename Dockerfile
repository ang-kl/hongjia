# hongjia.org web server (Rust), phase P0R.
# Stage 1 tests and builds on Rust 1.99.1. Stage 2 is a distroless image with no shell that runs
# the single binary as a non-root user. Railway detects this file automatically and accepts only
# cache mounts in RUN steps, so no other mount is used (crates/web/tests/dockerfile.rs checks this).

FROM rust:1.99.1-slim-trixie AS build
WORKDIR /src
COPY . .
RUN cargo test --locked --release \
 && cargo build --locked --release

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1
COPY --from=build /src/target/release/hongjia-web /hongjia-web
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/hongjia-web"]
