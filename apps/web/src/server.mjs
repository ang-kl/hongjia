// hongjia.org web server, phase P0: a placeholder page, a health route and robots.txt.
// Node built-in modules only, so the runtime container carries no npm packages.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './headers.mjs';

// The only files the server will ever send. Paths are matched exactly as received, without
// decoding, so encoded or dotted paths can never reach another file.
export const ROUTES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8', cache: 'no-cache' }],
  ['/assets/site.css', { file: 'assets/site.css', type: 'text/css; charset=utf-8', cache: 'public, max-age=300' }],
  ['/assets/site.mjs', { file: 'assets/site.mjs', type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }]
]);

const ROBOTS = 'User-agent: *\nDisallow: /\n';
const TEXT = 'text/plain; charset=utf-8';

export async function loadFiles(publicDir) {
  const files = new Map();
  for (const [path, route] of ROUTES) files.set(path, await readFile(new URL(route.file, publicDir)));
  return files;
}

export function commitLabel(env = process.env) {
  const sha = String(env.RAILWAY_GIT_COMMIT_SHA || '');
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : 'local';
}

export function createApp({ files, commit = 'local' }) {
  return createServer((req, res) => handle(req, res, files, commit));
}

function send(req, res, status, type, body, extra) {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, { ...securityHeaders(), 'Content-Type': type, 'Content-Length': payload.length, ...extra });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function handle(req, res, files, commit) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, TEXT, 'Method not allowed\n', { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
  }
  const raw = req.url || '/';
  const query = raw.indexOf('?');
  const path = query === -1 ? raw : raw.slice(0, query);

  if (path === '/healthz') {
    return send(req, res, 200, 'application/json; charset=utf-8', JSON.stringify({ status: 'ok', commit }), { 'Cache-Control': 'no-store' });
  }
  if (path === '/robots.txt') {
    return send(req, res, 200, TEXT, ROBOTS, { 'Cache-Control': 'public, max-age=3600' });
  }
  const route = ROUTES.get(path);
  if (route) return send(req, res, 200, route.type, files.get(path), { 'Cache-Control': route.cache });
  return send(req, res, 404, TEXT, 'Not found\n', { 'Cache-Control': 'no-store' });
}

// Railway injects PORT, and hongjia.up.railway.app targets port 8080. Listening on both (once each)
// keeps every domain working without changing any Railway setting.
export function listenPorts(env = process.env) {
  const port = Number(env.PORT);
  const primary = Number.isInteger(port) && port > 0 && port < 65536 ? port : 8080;
  return [...new Set([primary, 8080])];
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      if (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL') {
        server.listen({ port, host: '0.0.0.0' }, resolve);
      } else reject(error);
    };
    server.once('error', onError);
    server.listen({ port, host: '::' }, () => { server.off('error', onError); resolve(); });
  });
}

async function main() {
  const files = await loadFiles(new URL('./public/', import.meta.url));
  const commit = commitLabel();
  const ports = listenPorts();
  const servers = ports.map(() => createApp({ files, commit }));
  await Promise.all(servers.map((server, i) => listen(server, ports[i])));
  console.log(`hongjia web ${commit} listening on ${ports.join(', ')}`);
  const stop = () => { for (const server of servers) server.close(); setTimeout(() => process.exit(0), 3000).unref(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => '') : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
