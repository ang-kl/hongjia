import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBuiltApp, raw } from './helpers.mjs';
import { commitLabel, listenPorts } from '../src/server.mjs';

let app;
before(async () => { app = await startBuiltApp(); });
after(async () => { await app.close(); });

const APPROVED_TITLE = '洪家 · hongjia';
const APPROVED_TEXT = ['洪家 · hongjia', 'A private family space. Coming soon.'];

const visibleText = html => html
  .replace(/<head>[\s\S]*<\/head>/i, '')
  .replace(/<\/?span[^>]*>/gi, '') // inline element: keep its text on the same line
  .replace(/<[^>]+>/g, '\n')
  .split('\n').map(line => line.trim()).filter(Boolean);

test('home page shows only the approved copy', async () => {
  const res = await raw(app.port, 'GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html; charset=utf-8$/);
  assert.match(res.body, new RegExp(`<title>${APPROVED_TITLE}</title>`));
  assert.deepEqual(visibleText(res.body), APPROVED_TEXT);
});

test('home page has no form and no outside address', async () => {
  const { body } = await raw(app.port, 'GET', '/');
  assert.doesNotMatch(body, /<form/i);
  assert.doesNotMatch(body, /https?:\/\//i);
});

test('served text uses hyphens only (no en or em dashes)', async () => {
  for (const path of ['/', '/assets/site.css', '/assets/site.mjs', '/robots.txt']) {
    const { body } = await raw(app.port, 'GET', path);
    assert.doesNotMatch(body, /[\u2013\u2014]/, `dash found in ${path}`);
  }
});

test('health route reports status and commit', async () => {
  const res = await raw(app.port, 'GET', '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { status: 'ok', commit: 'abc1234' });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('robots.txt disallows everything', async () => {
  const res = await raw(app.port, 'GET', '/robots.txt');
  assert.equal(res.status, 200);
  assert.equal(res.body, 'User-agent: *\nDisallow: /\n');
});

test('static assets are served with the right types', async () => {
  const css = await raw(app.port, 'GET', '/assets/site.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /^text\/css/);
  const js = await raw(app.port, 'GET', '/assets/site.mjs');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /^text\/javascript/);
  assert.match(js.body, /classifyDeviceProfile/);
  assert.doesNotMatch(js.body, /^\s*import\s/m, 'built script must not import anything');
});

test('query strings do not change routing', async () => {
  assert.equal((await raw(app.port, 'GET', '/?utm=x')).status, 200);
  assert.equal((await raw(app.port, 'GET', '/healthz?x=1')).status, 200);
});

test('unknown paths are 404', async () => {
  for (const path of ['/nope', '/index.html', '/assets/', '/assets/other.js', '/server.mjs', '/public/index.html']) {
    assert.equal((await raw(app.port, 'GET', path)).status, 404, path);
  }
});

test('dotted and encoded path tricks are 404', async () => {
  for (const path of ['/assets/../server.mjs', '/assets/%2e%2e/server.mjs', '/assets/..%2fserver.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/assets/site.css%00', '//assets/site.css', '/assets\\site.css']) {
    assert.equal((await raw(app.port, 'GET', path)).status, 404, path);
  }
});

test('methods other than GET and HEAD are 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const res = await raw(app.port, method, '/');
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.allow, 'GET, HEAD');
  }
});

test('HEAD returns headers without a body', async () => {
  const res = await raw(app.port, 'HEAD', '/');
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
  assert.ok(Number(res.headers['content-length']) > 0);
});

test('commit label accepts only a hexadecimal commit', () => {
  assert.equal(commitLabel({ RAILWAY_GIT_COMMIT_SHA: '60a5806abcdef0123456789' }), '60a5806');
  assert.equal(commitLabel({ RAILWAY_GIT_COMMIT_SHA: '<script>' }), 'local');
  assert.equal(commitLabel({}), 'local');
});

test('listens on PORT and on 8080, once each', () => {
  assert.deepEqual(listenPorts({ PORT: '3000' }), [3000, 8080]);
  assert.deepEqual(listenPorts({ PORT: '8080' }), [8080]);
  assert.deepEqual(listenPorts({}), [8080]);
  assert.deepEqual(listenPorts({ PORT: 'abc' }), [8080]);
  assert.deepEqual(listenPorts({ PORT: '70000' }), [8080]);
});
