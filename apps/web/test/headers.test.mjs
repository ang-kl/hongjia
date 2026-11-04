import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBuiltApp, raw } from './helpers.mjs';

let app;
before(async () => { app = await startBuiltApp(); });
after(async () => { await app.close(); });

const EXPECTED = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow'
};

const CASES = [
  ['GET', '/', 200],
  ['HEAD', '/', 200],
  ['GET', '/healthz', 200],
  ['GET', '/robots.txt', 200],
  ['GET', '/assets/site.css', 200],
  ['GET', '/assets/site.mjs', 200],
  ['GET', '/missing', 404],
  ['POST', '/', 405]
];

for (const [method, path, status] of CASES) {
  test(`${method} ${path} (${status}) carries every security header`, async () => {
    const res = await raw(app.port, method, path);
    assert.equal(res.status, status);
    for (const [name, value] of Object.entries(EXPECTED)) assert.equal(res.headers[name], value, name);
    const permissions = res.headers['permissions-policy'];
    assert.ok(permissions, 'permissions-policy missing');
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      assert.match(permissions, new RegExp(`(^|, )${feature}=\\(\\)`), feature);
    }
    assert.equal(res.headers['x-powered-by'], undefined);
  });
}
