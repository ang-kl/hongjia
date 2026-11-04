import { request } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';

// Builds dist into a temporary folder and starts the built server on a free port.
export async function startBuiltApp() {
  const outDir = pathToFileURL(join(await mkdtemp(join(tmpdir(), 'hongjia-web-')), '/'));
  await build(outDir);
  const { createApp, loadFiles } = await import(new URL('server.mjs', outDir));
  const files = await loadFiles(new URL('public/', outDir));
  const server = createApp({ files, commit: 'abc1234' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { port, outDir, close: () => new Promise(resolve => server.close(resolve)) };
}

// Raw HTTP request, so paths are sent exactly as written (fetch would normalise them).
export function raw(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}
