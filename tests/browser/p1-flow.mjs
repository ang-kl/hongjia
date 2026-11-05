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
<section id="stays"><h2>Stays</h2><p>Two bedrooms.</p><p id="visits"></p></section>
<script>document.body.dataset.ran = 'yes';
var n = Number(localStorage.getItem('visits') || 0) + 1; localStorage.setItem('visits', String(n));
document.getElementById('visits').textContent = 'Visits: ' + n;</script></body></html>`;
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'sample-trip.html', mimeType: 'text/html', buffer: Buffer.from(SAMPLE) });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const docPath = new URL(page.url()).pathname;

// 2. Saved fields, the storage stand-in and annotations (P2b C), as the owner at notebook size.
async function signIn(context, profile) {
  const p = await context.newPage();
  await p.goto(base + '/');
  await p.check(`input[name=profile][value=${profile}]`);
  await p.fill('input[name=passphrase]', FAMILY);
  await p.click('form[action="/signin"] button[type=submit]');
  await p.waitForURL(base + '/consent');
  await p.click('form[action="/consent"] button[type=submit]');
  await p.waitForURL(base + '/home');
  return p;
}
const frameOf = p => p.frameLocator('.doc-frame');
const box = () => frameOf(page).locator('input[type=checkbox]');
const settle = () => page.waitForTimeout(1500);
const openDoc = async (p = page) => { await p.goto(base + docPath, { waitUntil: 'networkidle' }); await p.waitForTimeout(300); };
const visits = async () => Number(((await frameOf(page).locator('#visits').textContent()) || '').replace(/\D/g, ''));
const selectText = (p, text) => p.frames().find(f => f.url().includes('/raw')).evaluate(wanted => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = n.data.indexOf(wanted);
    if (at !== -1) {
      const r = document.createRange();
      r.setStart(n, at); r.setEnd(n, at + wanted.length);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      return true;
    }
  }
  return false;
}, text);
const annotate = async (p, body) => {
  await p.waitForSelector('[data-comment]:not([hidden])', { timeout: 4000 });
  await p.click('[data-comment]');
  await p.fill('[data-composer-body]', body);
  await p.click('form[data-composer] button[type=submit]');
  await p.waitForFunction(text => [...document.querySelectorAll('li[data-annotation-id] .annotation-body')].some(el => el.textContent === text), body, { timeout: 4000 });
};
const marks = p => frameOf(p).locator('mark[data-hj-id]').count();

await openDoc();
const firstVisits = await visits();
await box().check();
await settle();
await openDoc();
if (!(await box().isChecked())) failures.push('a tick was not saved across a reload');
if (await visits() !== firstVisits + 1) failures.push(`the storage stand-in did not keep counting (${firstVisits} then ${await visits()})`);
await selectText(page, 'Two bedrooms');
await annotate(page, 'Invented note to delete');
if (await marks(page) !== 1) failures.push('no highlight for the new annotation');
await page.click('li[data-annotation-id] form[data-annotation-delete] button');
await page.waitForFunction(() => !document.querySelector('li[data-annotation-id]'), null, { timeout: 4000 }).catch(() => failures.push('delete did not remove the annotation'));
if (await marks(page) !== 0) failures.push('the highlight stayed after the delete');
// Two that stay, for the pages below: one on a passage, one on the field.
await selectText(page, 'Two bedrooms');
await annotate(page, 'Ask for a quiet room');
await box().focus();
await page.waitForFunction(() => document.querySelector('[data-comment]')?.textContent === 'Comment on this field', null, { timeout: 4000 }).catch(() => failures.push('Comment on this field was not offered'));
await annotate(page, 'Booked');
await openDoc();
if (await page.locator('li[data-annotation-id]').count() !== 2 || await marks(page) !== 1) failures.push('annotations or highlight missing after a reload');
if ((await frameOf(page).locator('input[type=checkbox][data-hj-field]').count()) !== 1) failures.push('the annotated field is not outlined');
// Personal mode: each person sees only their own; the shared copy comes back untouched.
const setMode = async mode => {
  await page.check(`form[action$="/fields-mode"] input[value=${mode}]`);
  await page.click('form[action$="/fields-mode"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
};
await setMode('personal');
if (await box().isChecked()) failures.push('personal mode showed the shared tick');
await box().check();
await settle();
const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const beta = await signIn(other, 'beta');
await openDoc(beta);
if (await frameOf(beta).locator('input[type=checkbox]').isChecked()) failures.push('another member saw a personal tick');
await other.close();
await setMode('shared');
if (!(await box().isChecked())) failures.push('the shared tick did not come back');
if (shots) {
  await page.locator('#annotations').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/notebook-annotations.png` });
  const phone = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, storageState: await setup.storageState() });
  const pp = await phone.newPage();
  await openDoc(pp);
  await pp.click('[data-menu-details] > summary');
  await pp.click('[data-sidebar-toggle]');
  await pp.waitForTimeout(400);
  await pp.locator('#annotations').scrollIntoViewIfNeeded();
  await pp.screenshot({ path: `${shots}/phone-annotations.png` });
  await phone.close();
}
// 3. D1 annotation tools, on a second document (the first keeps the checks above).
const MARKUP = `<!doctype html><html><head><meta charset="utf-8"><title>Markup</title>
<style>body{font:16px system-ui;margin:24px}p{margin:0 0 16px}</style></head><body>
<h1>Markup sample</h1><section><p id="p1">Lantern river orchard meadow harbour.</p><p id="p2">Copper willow ember thistle juniper.</p>
<p id="p3">Pebble saffron quill marble cedar.</p><p id="p4">Velvet acorn sparrow tundra fennel.</p><p id="p5">Granite lotus amber prairie.</p></section></body></html>`;
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'markup.html', mimeType: 'text/html', buffer: Buffer.from(MARKUP) });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const markupPath = new URL(page.url()).pathname;
const rawFrame = p => p.frames().find(f => f.url().includes('/raw'));
const textPoint = async (p, wanted) => {
  const f = rawFrame(p);
  const box = await p.locator('.doc-frame').boundingBox();
  const at = await f.evaluate(text => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.data.indexOf(text);
      if (i !== -1) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
    }
    return null;
  }, wanted);
  return { x: box.x + 1 + at.x, y: box.y + 1 + at.y };
};
const noSelection = p => rawFrame(p).evaluate(() => getSelection().removeAllRanges());
const menuOpen = p => p.isVisible('.anno-menu');
const rightClick = async (p, wanted, select) => {
  if (select) await selectText(p, select); else await noSelection(p);
  const at = await textPoint(p, wanted);
  await p.mouse.click(at.x, at.y, { button: 'right' });
  await p.waitForSelector('.anno-menu:not([hidden])', { timeout: 3000 }).catch(() => {});
};
const entryCount = p => p.locator('li[data-annotation-id]').count();
const added = async (p, before) => p.waitForFunction(n => document.querySelectorAll('li[data-annotation-id]').length > n, before, { timeout: 4000 }).then(() => true, () => false);
const frameMarks = (p, selector) => rawFrame(p).evaluate(sel => document.querySelectorAll(sel).length, selector);
const fill = async (p, words) => { await p.fill('.anno-form textarea', words); await p.click('.anno-form button[type=submit]'); };

await page.waitForTimeout(500);
await rawFrame(page).evaluate(() => document.addEventListener('contextmenu', e => { window.__prevented = e.defaultPrevented; }));
await rightClick(page, 'river orchard', 'river orchard');
if (!(await menuOpen(page))) failures.push('right-click did not open the annotation menu');
if (await rawFrame(page).evaluate(() => window.__prevented) !== true) failures.push("right-click still showed the browser's own menu");
let before = await entryCount(page);
await page.click('.anno-menu .swatch[data-color=green]');
if (!(await added(page, before)) || await frameMarks(page, 'mark[data-hj-kind=highlight][data-hj-color=green]') < 1) failures.push('green highlight not drawn');
const markWith = async (selectWords, act, words, colorCheck) => {
  await rightClick(page, selectWords, selectWords);
  const n = await entryCount(page);
  await page.click(`.anno-menu [data-act=${act}]`);
  if (words) await fill(page, words);
  if (!(await added(page, n))) failures.push(`${act} was not saved`);
  if (colorCheck && await frameMarks(page, colorCheck) < 1) failures.push(`${act} not drawn in the document`);
};
await markWith('meadow', 'underline', '', 'mark[data-hj-kind=underline]');
await markWith('harbour', 'strike', '', 'mark[data-hj-kind=strike]');
await markWith('willow', 'insert', 'weeping', 'hj-caret');
await markWith('ember', 'replace', 'flame', 'mark[data-hj-kind=replace]');
if ((await page.textContent('.ov-insert').catch(() => '')).trim() !== '‸ weeping') failures.push('inserted words not shown over the document');
if ((await page.textContent('.ov-replace').catch(() => '')).trim() !== 'flame') failures.push('replacement words not shown over the document');
// A sticky note in pink, dragged, then kept in place across a reload.
await rightClick(page, 'saffron');
before = await entryCount(page);
await page.click('.anno-menu [data-act=note]');
await page.check('.anno-colors input[value=pink]', { force: true });
await fill(page, 'Invented note for @beta');
if (!(await added(page, before))) failures.push('sticky note was not saved');
const note = page.locator('.ov-note');
await page.waitForTimeout(400);
const noteBefore = await note.boundingBox();
if (!noteBefore || (await note.getAttribute('data-color')) !== 'pink') failures.push('sticky note not shown in pink');
else {
  await page.mouse.move(noteBefore.x + 10, noteBefore.y + 8);
  await page.mouse.down();
  await page.mouse.move(noteBefore.x + 80, noteBefore.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForResponse(r => r.url().includes('/update') && r.status() === 200, { timeout: 4000 }).catch(() => failures.push('the dragged note was not saved'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const noteAfter = await page.locator('.ov-note').boundingBox();
  if (!noteAfter || Math.abs(noteAfter.x - (noteBefore.x + 70)) > 8 || Math.abs(noteAfter.y - (noteBefore.y + 52)) > 8) failures.push(`the note did not keep its new place (${JSON.stringify(noteBefore)} then ${JSON.stringify(noteAfter)})`);
}
await rightClick(page, 'sparrow');
before = await entryCount(page);
await page.click('.anno-menu [data-act=textbox]');
await fill(page, 'Invented text box');
if (!(await added(page, before)) || !(await page.isVisible('.ov-textbox'))) failures.push('text box not shown');
await rightClick(page, 'lotus');
before = await entryCount(page);
await page.click('.anno-menu [data-act=stamps]');
await page.click('.anno-menu [data-stamp=approved]');
if (!(await added(page, before)) || (await page.textContent('.ov-stamp').catch(() => '')) !== 'Approved') failures.push('Approved stamp not shown');
// Keyboard: Shift+F10 in the document opens the menu, arrows move, Escape closes.
await page.locator('.doc-frame').focus();
await rawFrame(page).evaluate(() => document.body.focus());
await page.keyboard.press('Shift+F10');
await page.waitForTimeout(300);
if (!(await menuOpen(page))) failures.push('Shift+F10 did not open the menu');
else {
  const first = await page.evaluate(() => document.activeElement?.getAttribute('role'));
  await page.keyboard.press('ArrowDown');
  if (first !== 'menuitem') failures.push('the menu did not take focus');
  await page.keyboard.press('Escape');
  if (await menuOpen(page)) failures.push('Escape did not close the menu');
}
// A comment that mentions another member shows on their Home.
await rightClick(page, 'Granite lotus', 'Granite lotus');
await page.click('.anno-menu [data-act=comment]');
await page.fill('[data-composer-body]', '@beta please check this');
await page.click('form[data-composer] button[type=submit]');
await page.waitForFunction(() => [...document.querySelectorAll('.annotation-body')].some(el => el.textContent.includes('please check')), null, { timeout: 4000 }).catch(() => failures.push('the mention comment was not saved'));
{
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const b = await signIn(other, 'beta');
  const home = await b.textContent('main');
  if (!home.includes('Mentioned you') || !home.includes('markup')) failures.push('the mention is not on the other member\'s Home');
  await b.goto(base + markupPath, { waitUntil: 'networkidle' });
  if ((await b.locator('li.mentions-me').count()) < 1) failures.push('the panel does not mark mentions of the viewer');
  if ((await b.locator('li[data-can-edit=true]').count()) !== 0) failures.push('another member may edit marks that are not theirs');
  await other.close();
}
if (shots) {
  await rightClick(page, 'quill marble', 'quill marble');
  await page.screenshot({ path: `${shots}/notebook-markup-menu.png` });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${shots}/notebook-markup-marks.png` });
}
// A long press on a touch screen, and two quick taps with a Pencil, open the menu too.
{
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, storageState: await setup.storageState() });
  const tp = await touch.newPage();
  await tp.goto(base + markupPath, { waitUntil: 'networkidle' });
  await tp.waitForTimeout(500);
  const at = await textPoint(tp, 'cedar');
  const cdp = await touch.newCDPSession(tp);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
  await tp.waitForTimeout(750);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tp.waitForTimeout(300);
  if (!(await menuOpen(tp))) failures.push('a long press did not open the menu');
  else {
    const m = await tp.locator('.anno-menu').boundingBox();
    if (m.x < 0 || m.y < 0 || m.x + m.width > 390 + 1 || m.y + m.height > 844 + 1) failures.push('the long-press menu runs outside the phone screen');
    if (shots) await tp.screenshot({ path: `${shots}/phone-long-press-menu.png` });
  }
  await touch.close();
  const pen = await browser.newContext({ viewport: { width: 1180, height: 820 }, storageState: await setup.storageState() });
  const pp = await pen.newPage();
  await pp.goto(base + markupPath, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(500);
  const pt = await textPoint(pp, 'Markup sample');
  const pcdp = await pen.newCDPSession(pp);
  const penEvent = (type, extra = {}) => pcdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, pointerType: 'pen', button: 'left', clickCount: 1, ...extra });
  await penEvent('mouseMoved', { button: 'none' });
  await pp.waitForTimeout(100);
  if (!(await rawFrame(pp).evaluate(() => getComputedStyle(document.querySelector('[data-hj-ring]') || document.body).display === 'block'))) failures.push('Pencil hover did not show the tool ring');
  await penEvent('mousePressed'); await penEvent('mouseReleased');
  await pp.waitForTimeout(120);
  await penEvent('mousePressed', { clickCount: 2 }); await penEvent('mouseReleased', { clickCount: 2 });
  await pp.waitForTimeout(300);
  if (!(await menuOpen(pp))) failures.push('two Pencil taps did not open the menu');
  await pen.close();
}

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
  {
    const m = await box('[data-menu-details] > summary');
    const g = await box('[data-fab-group]');
    if (!m) problems.push('menu button missing');
    else if (g && m.x < g.x + g.width && m.x + m.width > g.x && m.y < g.y + g.height && m.y + m.height > g.y) problems.push('the right buttons cover the menu button');
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

const PAGES = [['signin', '/', false], ['privacy', '/privacy', false], ['documents', '/documents', true], ['upload', '/documents/new', true], ['document', docPath, true], ['markup', markupPath, true], ['consent', '/consent', true], ['home', '/home', true], ['journal', '/journal', true], ['owner', '/owner', true]];

// The menu button (bottom left) on every signed-in page: inside the window, at least 44px, and its
// panel lists Latest document, Documents (which folds open to the documents), Journal and Settings
// (which folds open to Sign out); Escape closes it.
async function checkMenu(p, label, width, height, problems) {
  const button = p.locator('[data-menu-details] > summary');
  const b = await button.boundingBox();
  if (!b) { problems.push('menu button missing'); return; }
  if (b.x < 0 || b.y + b.height > height + 1 || b.width < 44 || b.height < 44) problems.push('menu button outside the window or too small');
  if (await p.locator('header.bar nav').count()) problems.push('the header still has its own links');
  if (!['documents', 'document', 'home'].includes(label)) return;
  await button.click();
  const panel = await p.locator('.menu-panel').boundingBox();
  if (!panel || panel.x < 0 || panel.y < 0 || panel.x + panel.width > width + 1) problems.push('menu panel outside the window');
  const text = (await p.textContent('.menu-panel')).replace(/\s+/g, ' ');
  for (const item of ['Latest document', 'Documents', 'Journal', 'Settings']) if (!text.includes(item)) problems.push(`menu has no ${item}`);
  if ((label === 'document') !== text.includes('Sidebar')) problems.push('the Sidebar switch belongs to document pages only');
  await p.click('[data-menu-documents] > summary');
  await p.waitForSelector('[data-menu-docs] .menu-doc', { timeout: 3000 }).catch(() => problems.push('Documents did not list the documents'));
  // The owner's table: name and last change (hh:mmAM/PM DD-MM) | org, which downloads the original.
  const when = await p.textContent('[data-menu-docs] .menu-doc-when').catch(() => '');
  if (!/^\d\d:\d\d[AP]M \d\d-\d\d$/.test(when || '')) problems.push(`last change not in hh:mmAM/PM DD-MM form: "${when}"`);
  const org = p.locator('[data-menu-docs] a.menu-org').first();
  if ((await org.textContent()) !== 'org') problems.push('no org link');
  if (label === 'document' && width >= 720) {
    const sampleOrg = p.locator('[data-menu-docs] tr', { hasText: 'sample-trip' }).locator('a.menu-org');
    const [download] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), sampleOrg.click()]);
    if (!download) problems.push('org did not download');
    else if (download.suggestedFilename() !== 'sample-trip.html') problems.push(`download named ${download.suggestedFilename()}`);
  }
  await p.click('.menu-group:not([data-menu-documents]) > summary');
  if (!(await p.isVisible('text=Sign out delta'))) problems.push('Settings did not show Sign out');
  await p.keyboard.press('Escape');
  if (await p.isVisible('.menu-panel')) problems.push('Escape did not close the menu');
}

// The document page: the frame fills the window; the panel is beside it (landscape or square and at
// least 720px wide), closes with × and comes back with the menu's Sidebar switch (Ö on, ø off); in
// portrait it is a sheet that the Sidebar switch opens and × shuts.
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
    await p.click('[data-sidebar-close]');
    await p.waitForTimeout(300);
    if (await p.isVisible('#panel')) problems.push('× did not close the sidebar');
    const wide = await box('.doc-frame');
    if (!wide || wide.width < width * 0.9) problems.push('the document did not take the freed space');
    await p.click('[data-menu-details] > summary');
    if ((await p.textContent('[data-sidebar-glyph]')) !== 'ø') problems.push('the switch does not show ø when the sidebar is off');
    await p.click('[data-sidebar-toggle]');
    await p.waitForTimeout(300);
    if (!(await visible())) problems.push('the Sidebar switch did not bring the sidebar back');
    if ((await p.textContent('[data-sidebar-glyph]')) !== 'Ö') problems.push('the switch does not show Ö when the sidebar is on');
  } else {
    if (await visible()) problems.push('sheet open before the Sidebar switch was used');
    if (frame.width < width * 0.85) problems.push(`frame only ${Math.round(frame.width)}px wide`);
    await p.click('[data-menu-details] > summary');
    await p.click('[data-sidebar-toggle]');
    await p.waitForTimeout(400);
    if (!(await visible())) problems.push('the Sidebar switch did not open the sheet');
    if (await p.isVisible('[data-fab-globe]')) problems.push('the buttons cover the open sheet');
    if (await p.isVisible('[data-menu-details] > summary')) problems.push('the menu button covers the open sheet');
    if (shot) await p.screenshot({ path: shot });
    await p.click('[data-sidebar-close]');
    await p.waitForTimeout(400);
    if (await visible()) problems.push('× did not shut the sheet');
  }
  const ran = await p.frameLocator('.doc-frame').locator('body').getAttribute('data-ran');
  if (ran !== 'yes') problems.push('document script did not run in the frame');
  // Saved fields and annotations (P2b C).
  if (!(await p.frameLocator('.doc-frame').locator('input[type=checkbox]').isChecked())) problems.push('the saved tick is not shown');
  if ((await p.frameLocator('.doc-frame').locator('mark[data-hj-id]').count()) !== 1) problems.push('the highlight is not shown');
  if ((await p.locator('li[data-annotation-id]').count()) !== 2) problems.push('the annotations are not listed');
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
      if (label === 'markup') {
        // Right-click opens the annotation menu inside the window; the marks are all drawn.
        await p.waitForTimeout(300);
        await rightClick(p, 'Pebble');
        const m = await p.locator('.anno-menu').boundingBox();
        if (!m) problems.push('right-click did not open the annotation menu');
        else if (m.x < 0 || m.y < 0 || m.x + m.width > width + 1 || m.y + m.height > height + 1) problems.push(`the annotation menu runs outside the window (${Math.round(m.x)},${Math.round(m.y)} ${Math.round(m.width)}x${Math.round(m.height)})`);
        await p.keyboard.press('Escape');
        if (await p.isVisible('.anno-menu')) problems.push('Escape did not close the annotation menu');
        if ((await p.locator('.ov').count()) !== 5) problems.push(`expected 5 marks over the document, found ${await p.locator('.ov').count()}`);
        if ((await frameMarks(p, 'mark[data-hj-id]')) < 4) problems.push('the coloured marks are not drawn');
      }
      if (label === 'document') await checkViewer(p, width, height, problems, shots && scheme === 'light' ? `${shots}/${name}-document-panel.png` : '');
      if (signedIn) await checkFabs(p, label, width, height, problems, shots && scheme === 'light' && label === 'documents' && ['notebook', 'phone-small'].includes(name) ? `${shots}/${name}-globe.png` : '');
      if (signedIn) await checkMenu(p, label, width, height, problems);
      if (signedIn && shots && scheme === 'light' && label === 'document' && ['notebook', 'phone-small'].includes(name)) {
        await p.click('[data-menu-details] > summary');
        await p.$$eval('.menu-group', groups => groups.forEach(g => { g.open = g.matches('[data-menu-documents]'); }));
        await p.waitForTimeout(500);
        await p.screenshot({ path: `${shots}/${name}-menu.png` });
        await p.keyboard.press('Escape');
      }
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
// Problems found before the device loop (sign-in, saved fields, annotation tools) are listed too.
for (const failure of failures) if (!/^(light|dark) /.test(failure)) console.log(`FAIL ${failure}`);
console.log(failures.length ? `\n${failures.length} of ${total} checks failed` : `\nall ${total} checks passed`);
process.exit(failures.length ? 1 : 0);
