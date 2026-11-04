# hongjia.org web app, phase P0.
# Stage 1 builds and tests with Rush on Node 24. Stage 2 runs the built files on a slim Node 24
# image as the non-root "node" user, with no npm packages. Railway detects this file automatically.

FROM node:24.22.2-bookworm-slim AS build
WORKDIR /repo
COPY . .
# Railway accepts only cache mounts in RUN instructions; any other mount type fails validation
# (deployment 841268e3, 4 November 2026). apps/web/test/dockerfile.test.mjs guards this.
RUN node common/scripts/install-run-rush.js install \
 && node common/scripts/install-run-rush.js build --to @hongjia/web \
 && node common/scripts/install-run-rush.js test --to @hongjia/web

FROM node:24.22.2-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/dist ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
