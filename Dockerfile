# hongjia.org web app, phase P0.
# Stage 1 builds and tests with Rush on Node 24. Stage 2 runs the built files on a slim Node 24
# image as the non-root "node" user, with no npm packages. Railway detects this file automatically.

FROM node:24.22.2-bookworm-slim AS build
WORKDIR /repo
COPY . .
# The optional npm_ca secret is only for builds behind an intercepting proxy (for example a local
# check); Railway does not provide it and the step runs normally without it.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi \
 && node common/scripts/install-run-rush.js install \
 && node common/scripts/install-run-rush.js build --to @hongjia/web \
 && node common/scripts/install-run-rush.js test --to @hongjia/web

FROM node:24.22.2-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/dist ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
