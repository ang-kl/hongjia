import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The repository Dockerfile builds this app on Railway. Railway's validator rejects RUN mounts
// other than type=cache (deployment 841268e3 failed on a type=secret mount), so guard it here.
const dockerfile = await readFile(new URL('../../../Dockerfile', import.meta.url), 'utf8');

test('Dockerfile uses only cache mounts, which Railway accepts', () => {
  const mounts = [...dockerfile.matchAll(/--mount=([^\s\\]+)/g)].map(m => m[1]);
  for (const mount of mounts) assert.match(mount, /(^|,)type=cache(,|$)/, `unsupported mount on Railway: ${mount}`);
});

test('Dockerfile pins the Node 24 base image and runs as the node user', () => {
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map(m => m[1]);
  assert.ok(froms.length >= 2, 'expected a build stage and a runtime stage');
  for (const image of froms) assert.equal(image, 'node:24.22.2-bookworm-slim');
  assert.match(dockerfile, /^USER node$/m);
});
