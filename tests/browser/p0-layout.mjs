// Browser check across the owner's device classes (plan section 5.9), against the Rust server.
// Run after `cargo build --release`:  node tests/browser/p0-layout.mjs [screenshot-folder]
// Needs Playwright with Chromium installed on the machine; it is not a project dependency.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const freePort = () => new Promise((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); });
});

const port = await freePort();
const server = spawn(resolve('target/release/hongjia-web'), [], {
  env: { ...process.env, PORT: String(port), HONGJIA_ALSO_LISTEN: '', RAILWAY_GIT_COMMIT_SHA: '' },
  stdio: ['ignore', 'inherit', 'inherit']
});
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(base + 'healthz')).ok) break; } catch { /* not up yet */ }
  await new Promise(done => setTimeout(done, 100));
}

const shots = process.argv[2] ? resolve(process.argv[2]) : '';
if (shots) await mkdir(shots, { recursive: true });

const CLASSES = [
  ['notebook', 1440, 900, 'desktop', 'desktop', false],
  ['tablet-landscape', 1180, 820, 'tablet', 'tablet-standard', true],
  ['tablet-portrait', 820, 1180, 'tablet', 'tablet-standard', true],
  ['mini-tablet', 744, 1133, 'tablet', 'tablet-small', true],
  ['phone-max', 430, 932, 'phone', 'phone-large', true],
  ['phone-small', 375, 667, 'phone', 'phone-standard', true],
  ['phone-small-compact', 360, 740, 'phone', 'phone-compact', true]
];

const browser = await chromium.launch();
const failures = [];
for (const scheme of ['light', 'dark']) {
  for (const [name, width, height, formFactor, sizeTier, touch] of CLASSES) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, colorScheme: scheme });
    const page = await context.newPage();
    const problems = [];
    page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) problems.push(`console ${msg.type()}: ${msg.text()}`); });
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('requestfailed', request => problems.push(`request failed: ${request.url()}`));
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', event => window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    const response = await page.goto(base, { waitUntil: 'networkidle' });
    const result = await page.evaluate(() => {
      const root = document.documentElement;
      const box = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
      };
      return {
        formFactor: root.dataset.formFactor,
        sizeTier: root.dataset.sizeTier,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        h1: box('h1'),
        p: box('p'),
        csp: window.__csp,
        title: document.title
      };
    });
    const label = `${scheme} ${name} ${width}x${height}`;
    if (response.status() !== 200) problems.push(`status ${response.status()}`);
    if (result.formFactor !== formFactor || result.sizeTier !== sizeTier) problems.push(`tier ${result.formFactor}/${result.sizeTier}, expected ${formFactor}/${sizeTier}`);
    if (result.scrollWidth > result.clientWidth) problems.push(`sideways scroll: ${result.scrollWidth} > ${result.clientWidth}`);
    for (const key of ['h1', 'p']) {
      const b = result[key];
      if (!(b.width > 0 && b.height > 0 && b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= height)) problems.push(`${key} not fully visible: ${JSON.stringify(b)}`);
    }
    if (result.csp.length) problems.push(`CSP violations: ${result.csp.join('; ')}`);
    if (result.title !== '洪家 · hongjia') problems.push(`title "${result.title}"`);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-${name}.png` });
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${label} ${result.formFactor}/${result.sizeTier}`);
    for (const problem of problems) console.log(`     ${problem}`);
    if (problems.length) failures.push(label);
    await context.close();
  }
}
await browser.close();
server.kill('SIGTERM');
console.log(failures.length ? `\n${failures.length} of ${CLASSES.length * 2} checks failed` : `\nall ${CLASSES.length * 2} checks passed`);
process.exit(failures.length ? 1 : 0);
