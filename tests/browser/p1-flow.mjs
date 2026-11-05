// P1 and P2b browser check: sign in with the family password, consent, upload a sample document, then
// every family page at the owner's seven device-class viewports (light and dark). On the document page
// the management panel must sit beside the document in landscape and open as a sheet in portrait.
// Needs a release build and a PostgreSQL database.
// Run: DATABASE_URL=postgres://... node tests/browser/p1-flow.mjs [screenshot-folder]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (an empty test database).');
  process.exit(2);
}

const freePort = () => new Promise((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); });
});

const FAMILY = 'browser test family password';
const port = await freePort();
const server = spawn(resolve('target/release/hongjia-web'), [], {
  env: {
    ...process.env, PORT: String(port), HONGJIA_ALSO_LISTEN: '', RAILWAY_GIT_COMMIT_SHA: '',
    HONGJIA_PROFILES: 'alpha,beta,gamma,delta', HONGJIA_OWNER: 'delta', HONGJIA_FAMILY_PASSWORD: FAMILY
  },
  stdio: ['ignore', 'inherit', 'inherit']
});
// Always stop the server, even when a step fails, so it cannot hold the output open.
process.on('exit', () => server.kill('SIGTERM'));
process.on('uncaughtException', error => { console.error(error); process.exit(1); });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* not up yet */ }
  await new Promise(done => setTimeout(done, 100));
}

const shots = process.argv[2] ? resolve(process.argv[2]) : '';
if (shots) await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const failures = [];

// 1. Sign in as the owner with the family password and give consent, at notebook size.
const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await setup.newPage();
await page.goto(base + '/');
await page.check('input[name=profile][value=delta]');
await page.fill('input[name=passphrase]', FAMILY);
await page.click('form[action="/signin"] button[type=submit]');
await page.waitForURL(base + '/consent');
await page.fill('input[name=device_label]', 'browser test');
await page.click('form[action="/consent"] button[type=submit]');
await page.waitForURL(base + '/home');
if (!(await page.textContent('h1')).includes('Hello, delta')) failures.push('home greeting missing');
const SAMPLE = `<!doctype html><html><head><meta charset="utf-8"><title>Sample</title>
<style>body{font:16px system-ui;margin:24px}section{min-height:60vh}</style></head><body>
<h1 id="top">Sample trip</h1><section id="days"><h2>Day by day</h2><label><input type="checkbox"> Book the car</label></section>
<section id="stays"><h2>Stays</h2><p>Two bedrooms.</p></section>
<script>document.body.dataset.ran = 'yes';</script></body></html>`;
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'sample-trip.html', mimeType: 'text/html', buffer: Buffer.from(SAMPLE) });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const docPath = new URL(page.url()).pathname;
const state = await setup.storageState();
await setup.close();

const CLASSES = [
  ['notebook', 1440, 900, 'desktop'],
  ['tablet-landscape', 1180, 820, 'tablet-standard'],
  ['tablet-portrait', 820, 1180, 'tablet-standard'],
  ['mini-tablet', 744, 1133, 'tablet-small'],
  ['phone-max', 430, 932, 'phone-large'],
  ['phone-small', 375, 667, 'phone-standard'],
  ['phone-small-compact', 360, 740, 'phone-compact']
];
// The 🛰️ globe 📁 buttons (michi 0.9.1 rules) on every signed-in page; the full walk on the
// documents list and the document page: the field stays closed until the satellite is pressed,
// Enter opens the first result, Escape closes the field, then the card, then the globe, focus
// returns to the globe button, and 📁 lists all documents or moves the frame to a heading.
async function checkFabs(p, label, width, height, problems, shot) {
  const box = sel => p.locator(sel).first().boundingBox();
  const sat = await box('[data-fab-satellite]'), globe = await box('[data-fab-globe]'), folder = await box('[data-fab-folder]');
  if (!sat || !globe || !folder) { problems.push('buttons missing'); return; }
  if (!(sat.x < globe.x && globe.x < folder.x)) problems.push('button order is not satellite, globe, folder');
  if (folder.x + folder.width > width + 1 || globe.y + globe.height > height + 1) problems.push('buttons outside the window');
  for (const b of [sat, globe, folder]) if (b.width < 44 || b.height < 44) problems.push(`button smaller than 44px (${Math.round(b.width)}x${Math.round(b.height)})`);
  if (await p.isDisabled('[data-fab-globe]')) problems.push('buttons not enabled');
  if (label === 'document' && await p.isVisible('.manage-open')) {
    const m = await box('.manage-open');
    const g = await box('[data-fab-group]');
    if (m && g && m.x < g.x + g.width && m.x + m.width > g.x && m.y < g.y + g.height && m.y + m.height > g.y) problems.push('buttons cover Manage');
  }
  if (!['documents', 'document'].includes(label)) return;
  const hidden = sel => p.$eval(sel, el => el.hidden || getComputedStyle(el).display === 'none');
  if (!(await hidden('[data-fab-search]'))) problems.push('search field open before the satellite was pressed');
  // The slide-out field, globe closed: inside the window; Escape closes it and focus returns.
  await p.click('[data-fab-satellite]');
  const field = await box('[data-fab-search]');
  if (!field || field.x < -1 || field.x + field.width > width + 1) problems.push('search field outside the window');
  await p.keyboard.press('Escape');
  if (!(await hidden('[data-fab-search]'))) problems.push('Escape did not close the field');
  if (!(await p.evaluate(() => document.activeElement?.hasAttribute('data-fab-satellite')))) problems.push('focus did not return to the satellite');
  // The globe.
  await p.click('[data-fab-globe]');
  await p.waitForSelector('[data-globe]:not([hidden]) svg.globe-canvas', { timeout: 5000 }).catch(() => problems.push('globe did not open'));
  if (!(await hidden('[data-fab-search]'))) problems.push('field open when the globe opened');
  const pins = await p.locator('.globe-node').count();
  if (pins < 1) problems.push('no pins on the globe');
  if (label === 'document' && !(await p.isVisible('[data-globe-card]'))) problems.push('the open document\'s card is not shown');
  await p.click('[data-fab-satellite]');
  await p.fill('[data-fab-input]', 'bedrooms');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /found/.test(document.querySelector('[data-globe-status]')?.textContent || ''), null, { timeout: 5000 }).catch(() => problems.push('search gave no status'));
  const cardTitle = await p.textContent('[data-globe-card] h3').catch(() => '');
  if (cardTitle !== 'sample-trip') problems.push(`first result card shows "${cardTitle}"`);
  if (shot) await p.screenshot({ path: shot });
  await p.focus('[data-fab-input]');
  await p.keyboard.press('Escape');
  if (!(await hidden('[data-fab-search]')) || !(await p.isVisible('[data-globe-card]'))) problems.push('first Escape did not close only the field');
  await p.keyboard.press('Escape');
  if (await p.isVisible('[data-globe-card]') || await hidden('[data-globe]')) problems.push('second Escape did not close only the card');
  await p.keyboard.press('Escape');
  if (!(await hidden('[data-globe]'))) problems.push('third Escape did not close the globe');
  if (!(await p.evaluate(() => document.activeElement?.hasAttribute('data-fab-globe')))) problems.push('focus did not return to the globe button');
  // 📁 contents.
  await p.click('[data-fab-folder]');
  if (label === 'documents') {
    await p.waitForSelector('[data-fab-contents] a[href^="/documents/2"]', { timeout: 5000 }).catch(() => problems.push('contents did not list the documents'));
  } else {
    const link = p.locator('[data-fab-contents] [data-frame-jump="stays"]');
    if (!(await link.count())) problems.push('contents did not list the headings');
    else {
      await link.click();
      await p.waitForTimeout(400);
      const frame = p.frames().find(f => f.url().includes('/raw'));
      const [hash, scrolled] = frame ? await frame.evaluate(() => [location.hash, scrollY]) : ['', 0];
      if (hash !== '#stays' || scrolled <= 0) problems.push(`heading did not move the frame (${hash}, ${scrolled})`);
      const ran = await p.frameLocator('.doc-frame').locator('body').getAttribute('data-ran');
      if (ran !== 'yes') problems.push('the frame reloaded instead of moving');
    }
  }
  const csp = await p.evaluate(() => window.__csp);
  if (csp.length) problems.push(`CSP after the buttons: ${csp.join('; ')}`);
}

const PAGES = [['signin', '/', false], ['privacy', '/privacy', false], ['documents', '/documents', true], ['upload', '/documents/new', true], ['document', docPath, true], ['consent', '/consent', true], ['home', '/home', true], ['journal', '/journal', true], ['owner', '/owner', true]];

// The document page: the frame fills the window; the panel is beside it (landscape or square and at
// least 720px wide) or a sheet that Manage opens and Close shuts (portrait).
async function checkViewer(p, width, height, problems, shot) {
  const box = sel => p.locator(sel).first().boundingBox();
  const visible = () => p.$eval('#panel', el => getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().top < innerHeight - 40);
  const frame = await box('.doc-frame');
  const panel = await box('#panel');
  if (!frame || !panel) { problems.push('viewer parts missing'); return; }
  const beside = width >= height && width >= 720;
  if (frame.height < height * 0.55) problems.push(`frame only ${Math.round(frame.height)}px tall`);
  if (frame.y + frame.height > height + 1) problems.push('frame runs past the window');
  if (beside) {
    if (!(await visible())) problems.push('panel not visible beside the document');
    if (panel.x < frame.x + frame.width - 1) problems.push('panel not beside the frame');
    if (frame.width < width * 0.55) problems.push(`frame only ${Math.round(frame.width)}px wide`);
    if (await p.isVisible('.manage-open')) problems.push('Manage button shown in beside mode');
  } else {
    if (await visible()) problems.push('sheet open before Manage was tapped');
    if (frame.width < width * 0.85) problems.push(`frame only ${Math.round(frame.width)}px wide`);
    await p.click('.manage-open');
    await p.waitForTimeout(400);
    if (!(await visible())) problems.push('Manage did not open the sheet');
    if (await p.isVisible('[data-fab-globe]')) problems.push('the buttons cover the open sheet');
    if (shot) await p.screenshot({ path: shot });
    await p.click('.manage-close');
    await p.waitForTimeout(400);
    if (await visible()) problems.push('Close did not shut the sheet');
  }
  const ran = await p.frameLocator('.doc-frame').locator('body').getAttribute('data-ran');
  if (ran !== 'yes') problems.push('document script did not run in the frame');
}

for (const scheme of ['light', 'dark']) {
  for (const [name, width, height, tier] of CLASSES) {
    for (const [label, path, signedIn] of PAGES) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, ...(signedIn ? { storageState: state } : {}) });
      const p = await context.newPage();
      const problems = [];
      p.on('console', msg => { if (['error', 'warning'].includes(msg.type())) problems.push(`console ${msg.type()}: ${msg.text()}`); });
      p.on('pageerror', error => problems.push(`page error: ${error.message}`));
      await p.addInitScript(() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
      const response = await p.goto(base + path, { waitUntil: 'networkidle' });
      const result = await p.evaluate(() => ({
        tier: document.documentElement.dataset.sizeTier,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        csp: window.__csp,
        url: location.pathname,
        smallTargets: [...document.querySelectorAll('button, input[type=radio] + span, a')]
          .filter(el => el.offsetParent && el.getBoundingClientRect().height < 24).length
      }));
      if (response.status() !== 200) problems.push(`status ${response.status()}`);
      if (result.url !== path) problems.push(`redirected to ${result.url}`);
      if (result.tier !== tier) problems.push(`tier ${result.tier}, expected ${tier}`);
      if (result.scrollWidth > result.clientWidth) problems.push(`sideways scroll ${result.scrollWidth} > ${result.clientWidth}`);
      if (result.csp.length) problems.push(`CSP: ${result.csp.join('; ')}`);
      if (shots && scheme === 'light' && ['notebook', 'phone-small'].includes(name)) await p.screenshot({ path: `${shots}/${name}-${label}.png`, fullPage: label !== 'document' });
      if (label === 'document') await checkViewer(p, width, height, problems, shots && scheme === 'light' ? `${shots}/${name}-document-panel.png` : '');
      if (signedIn) await checkFabs(p, label, width, height, problems, shots && scheme === 'light' && label === 'documents' && ['notebook', 'phone-small'].includes(name) ? `${shots}/${name}-globe.png` : '');
      const tag = `${scheme} ${name} ${label}`;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${tag}`);
      for (const problem of problems) console.log(`     ${problem}`);
      if (problems.length) failures.push(tag);
      await context.close();
    }
  }
}
await browser.close();
server.kill('SIGTERM');
const total = CLASSES.length * PAGES.length * 2;
console.log(failures.length ? `\n${failures.length} of ${total} checks failed` : `\nall ${total} checks passed`);
process.exit(failures.length ? 1 : 0);
