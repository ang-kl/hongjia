// P1, P2b and D1 to D4 browser check: sign in with the family password, consent, upload a sample document, then
// every family page at the owner's seven device-class viewports (light and dark). On the document page
// the management panel must sit beside the document in landscape and open as a sheet in portrait.
// Needs a release build and a PostgreSQL database.
// Run: DATABASE_URL=postgres://... node tests/browser/p1-flow.mjs [screenshot-folder]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

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
const setupContextCdp = p => p.context().newCDPSession(p);
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

// 4. D2 drawing, on a third document: Draw, Sketch (oval and arrow recognised), Shapes, Undo, the
// Eraser, a Pencil stroke with pressure, fingers scrolling after a Pencil, a finger drawing on a
// phone, and drawings keeping their place after a reload and at another width.
const SKETCH = `<!doctype html><html><head><meta charset="utf-8"><title>Sketch</title>
<style>body{font:16px system-ui;margin:24px}p{margin:0 0 24px;line-height:1.6}section{padding-bottom:900px}</style></head><body>
<h1>Sketch sample</h1><section><p id="s1">Orchard lantern meadow harbour willow ember thistle juniper saffron quill.</p>
<p id="s2">Velvet acorn sparrow tundra fennel granite lotus amber prairie copper.</p>
<p id="s3">Pebble marble cedar lantern river orchard meadow harbour willow ember.</p></section></body></html>`;
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'sketch.html', mimeType: 'text/html', buffer: Buffer.from(SKETCH) });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const sketchPath = new URL(page.url()).pathname;
await page.waitForTimeout(600);
const inkCount = (p, selector = 'li[data-kind=ink], li[data-kind=shape]') => p.locator(selector).count();
const inkAdded = (p, selector, before) => p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [selector, before], { timeout: 5000 }).then(() => true, () => false);
const startInk = async (p, tool, word) => {
  await rightClick(p, word);
  await p.click(`.anno-menu [data-act=ink][data-tool=${tool}]`);
  await p.waitForSelector('[data-ink-bar]:not([hidden])', { timeout: 3000 }).catch(() => failures.push(`${tool} did not open the drawing toolbar`));
};
const drag = async (p, points) => {
  await p.mouse.move(points[0].x, points[0].y);
  await p.mouse.down();
  for (const q of points.slice(1)) await p.mouse.move(q.x, q.y);
  await p.mouse.up();
};
const ring = (c, r, n = 40) => Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos((i / n) * 2 * Math.PI), y: c.y + 0.8 * r * Math.sin((i / n) * 2 * Math.PI) }));
const groupBox = (p, selector) => p.evaluate(sel => {
  const li = document.querySelector(sel);
  const g = li && document.querySelector(`.ink-layer g[data-id="${li.dataset.annotationId}"]`);
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}, selector);
const paraBox = async (p, id) => {
  const box = await p.locator('.doc-frame').boundingBox();
  const r = await rawFrame(p).evaluate(i => { const b = document.getElementById(i).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; }, id);
  return { x: box.x + 1 + r.x, y: box.y + 1 + r.y, w: r.w };
};

await startInk(page, 'draw', 'Orchard');
const o1 = await textPoint(page, 'Orchard');
let n = await inkCount(page, 'li[data-kind=ink]');
await drag(page, Array.from({ length: 25 }, (_, i) => ({ x: o1.x + i * 10, y: o1.y + 12 + Math.sin(i / 2) * 6 })));
if (!(await inkAdded(page, 'li[data-kind=ink][data-tool=draw]', n))) failures.push('a freehand line was not saved');
// Sketch: a rough circle becomes an oval; a line with a hook becomes an arrow.
await page.click('[data-ink-tool=sketch]');
const v = await textPoint(page, 'Velvet');
n = await inkCount(page, 'li[data-tool=oval]');
await drag(page, ring({ x: v.x + 10, y: v.y }, 45));
if (!(await inkAdded(page, 'li[data-tool=oval]', n))) failures.push('a sketched circle did not become an oval');
const c3 = await textPoint(page, 'cedar');
n = await inkCount(page, 'li[data-tool=arrow]');
await drag(page, [...Array.from({ length: 17 }, (_, i) => ({ x: c3.x + i * 10, y: c3.y + 20 })), { x: c3.x + 150, y: c3.y + 8 }, { x: c3.x + 140, y: c3.y + 2 }]);
if (!(await inkAdded(page, 'li[data-tool=arrow]', n))) failures.push('a sketched arrow was not recognised');
// Shapes: a rectangle by dragging; Undo removes it (the latest drawing).
await page.click('[data-ink-tool=rectangle]');
n = await inkCount(page, 'li[data-tool=rectangle]');
await drag(page, [{ x: o1.x - 20, y: o1.y - 40 }, { x: o1.x + 60, y: o1.y - 10 }, { x: o1.x + 120, y: o1.y + 20 }]);
if (!(await inkAdded(page, 'li[data-tool=rectangle]', n))) failures.push('a rectangle was not drawn');
await page.click('[data-ink-undo]');
await page.waitForFunction(() => !document.querySelector('li[data-tool=rectangle]'), null, { timeout: 4000 }).catch(() => failures.push('Undo did not remove the last drawing'));
// The Eraser removes the freehand line it crosses.
await page.click('[data-ink-tool=eraser]');
await drag(page, Array.from({ length: 12 }, (_, i) => ({ x: o1.x + 120, y: o1.y - 20 + i * 6 })));
await page.waitForFunction(() => !document.querySelector('li[data-kind=ink][data-tool=draw]'), null, { timeout: 4000 }).catch(() => failures.push('the Eraser did not remove the line'));
// A Pencil stroke: its pressure is kept and varies the line.
await page.click('[data-ink-tool=draw]');
{
  const cdp = await setupContextCdp(page);
  const m = await textPoint(page, 'marble');
  n = await inkCount(page, 'li[data-kind=ink]');
  const pen = (type, x, y, force) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', button: type === 'mouseMoved' ? 'left' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, force, clickCount: 1 });
  await pen('mousePressed', m.x, m.y + 14, 0.2);
  for (let i = 1; i <= 12; i++) await pen('mouseMoved', m.x + i * 12, m.y + 14 + (i % 3), Math.min(1, 0.2 + i * 0.07));
  await pen('mouseReleased', m.x + 150, m.y + 14, 0.9);
  if (!(await inkAdded(page, 'li[data-kind=ink]', n))) failures.push('a Pencil stroke was not saved');
  else {
    const pressures = await page.evaluate(() => [...document.querySelectorAll('li[data-kind=ink]')].at(-1).dataset.points.split(' ').map(t => Number(t.split(',')[2])));
    if (new Set(pressures).size < 3) failures.push(`the Pencil's pressure was not kept (${pressures.join(' ')})`);
  }
}
const tb = await page.locator('[data-ink-bar]').boundingBox();
if (!tb || tb.x < 0 || tb.y < 0 || tb.x + tb.width > 1440 || tb.y + tb.height > 900) failures.push('the drawing toolbar is outside the window');
if (shots) await page.screenshot({ path: `${shots}/notebook-drawing.png` });
await page.keyboard.press('Escape');
if (await page.isVisible('[data-ink-bar]')) failures.push('Escape did not leave drawing');
// The oval keeps its place after a reload, and at another width relative to its paragraph.
const ovalBefore = await groupBox(page, 'li[data-tool=oval]');
const paraBefore = await paraBox(page, 's2');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const ovalAfter = await groupBox(page, 'li[data-tool=oval]');
if (!ovalBefore || !ovalAfter || Math.abs(ovalBefore.x - ovalAfter.x) > 3 || Math.abs(ovalBefore.y - ovalAfter.y) > 3) failures.push(`the oval moved after a reload (${JSON.stringify(ovalBefore)} then ${JSON.stringify(ovalAfter)})`);
// At other widths each drawing stays beside its own paragraph: the oval over the second, the arrow
// drawn under the third still under the third (text reflows taller on narrow screens).
for (const [vw, vh, shot] of [[820, 1180, 'tablet-portrait-drawings.png'], [375, 667, 'phone-drawings.png']]) {
  const narrow = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: shots ? 2 : 1, storageState: await setup.storageState() });
  const np = await narrow.newPage();
  await np.goto(base + sketchPath, { waitUntil: 'networkidle' });
  await np.waitForTimeout(800);
  const para = async id => {
    const box = await np.locator('.doc-frame').boundingBox();
    const r = await rawFrame(np).evaluate(i => { const b = document.getElementById(i).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, id);
    return { x: box.x + 1 + r.x, y: box.y + 1 + r.y, w: r.w, h: r.h };
  };
  const [p2, p3] = [await para('s2'), await para('s3')];
  const oval = await groupBox(np, 'li[data-tool=oval]');
  const arrow = await groupBox(np, 'li[data-tool=arrow]');
  const middle = b => b.y + b.h / 2;
  if (!oval || middle(oval) < p2.y - 24 || middle(oval) > p2.y + p2.h + 24 || oval.x > p2.x + p2.w) failures.push(`at ${vw}px the oval left its paragraph (${JSON.stringify(oval)} vs ${JSON.stringify(p2)})`);
  if (!arrow || middle(arrow) < p3.y || middle(arrow) > p3.y + p3.h + 40) failures.push(`at ${vw}px the arrow left its paragraph (${JSON.stringify(arrow)} vs ${JSON.stringify(p3)})`);
  if (shots) await np.screenshot({ path: `${shots}/${shot}` });
  await narrow.close();
}
// After a Pencil, a finger scrolls instead of drawing (touch-capable tablet).
{
  const tablet = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, storageState: await setup.storageState() });
  const tp = await tablet.newPage();
  await tp.goto(base + sketchPath, { waitUntil: 'networkidle' });
  await tp.waitForTimeout(600);
  await startInk(tp, 'draw', 'Pebble');
  const cdp = await tablet.newCDPSession(tp);
  const at = await textPoint(tp, 'Pebble');
  let before = await inkCount(tp, 'li[data-kind=ink]');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y + 16, pointerType: 'pen', button: 'left', buttons: 1, force: 0.5, clickCount: 1 });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + i * 15, y: at.y + 16, pointerType: 'pen', button: 'left', buttons: 1, force: 0.5 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 90, y: at.y + 16, pointerType: 'pen', button: 'left', buttons: 0, force: 0.5, clickCount: 1 });
  if (!(await inkAdded(tp, 'li[data-kind=ink]', before))) failures.push('the tablet Pencil stroke was not saved');
  before = await inkCount(tp, 'li[data-kind=ink]');
  const scrolledBefore = await rawFrame(tp).evaluate(() => scrollY);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x + 40, y: at.y + 300 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + 40, y: at.y + 300 - i * 25 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tp.waitForTimeout(600);
  if ((await inkCount(tp, 'li[data-kind=ink]')) !== before) failures.push('a finger drew after a Pencil was seen');
  if ((await rawFrame(tp).evaluate(() => scrollY)) <= scrolledBefore) failures.push('a finger did not scroll the document while drawing');
  await tablet.close();
}
// On a phone without a Pencil, one finger draws.
{
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, storageState: await setup.storageState() });
  const pp = await phone.newPage();
  await pp.goto(base + sketchPath, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(600);
  await startInk(pp, 'draw', 'Velvet');
  const cdp = await phone.newCDPSession(pp);
  const at = await textPoint(pp, 'acorn');
  const before = await inkCount(pp, 'li[data-kind=ink]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x - 60, y: at.y + 30 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x - 60 + i * 12, y: at.y + 30 + (i % 2) * 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (!(await inkAdded(pp, 'li[data-kind=ink]', before))) failures.push('a finger did not draw on a phone without a Pencil');
  const bar = await pp.locator('[data-ink-bar]').boundingBox();
  if (!bar || bar.x < 0 || bar.x + bar.width > 391) failures.push('the drawing toolbar runs outside the phone screen');
  if (shots) await pp.screenshot({ path: `${shots}/phone-drawing.png` });
  await phone.close();
}
// 5. D3: a signature drawn on the pad and placed with its caption; a saved signature placed straight
// away; another member's typed signature (theirs only); the loupe; and a picture, with a sticky note
// and a drawing that keep their places after a reload and on a phone.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makePng(w, h) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * (1 + w * 3) + 1 + x * 3;
    rows[at] = 40 + (x * 180) / w; rows[at + 1] = 120 + (y * 100) / h; rows[at + 2] = 90;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const CAPTION = /^Signed by (\w+), \d\d [A-Z][a-z]{2} \d{4}, \d\d:\d\d \(SGT\)$/;
const signatures = p => p.locator('li[data-kind=signature]').count();
const signatureAdded = (p, before) => p.waitForFunction(n => document.querySelectorAll('li[data-kind=signature]').length > n, before, { timeout: 5000 }).then(() => true, () => false);
// Signing happens on its own document, with the lines far apart: a placed signature covers the
// words after it, and a right-click on a placed mark gives the browser's own menu (D1).
const SIGN = `<!doctype html><html><head><meta charset="utf-8"><title>Signing</title>
<style>body{font:16px system-ui;margin:24px}p{margin:0 0 150px}</style></head><body>
<h1>Signing sample</h1><p>Copper agreement line for the first signer.</p><p>Thistle line for signing again.</p>
<p>Velvet line for the other member.</p><p>Lantern orchard harbour meadow willow line for the loupe.</p></body></html>`;
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'signing.html', mimeType: 'text/html', buffer: Buffer.from(SIGN) });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const signPath = new URL(page.url()).pathname;
await page.waitForTimeout(800);
{
  await rightClick(page, 'Copper');
  await page.click('.anno-menu [data-act=signature]');
  if (!(await page.waitForSelector('[data-sig-pad]:not([hidden])', { timeout: 3000 }).then(() => true, () => false))) failures.push('the signature pad did not open without a saved signature');
  const pad = await page.locator('[data-sig-area]').boundingBox();
  await drag(page, Array.from({ length: 24 }, (_, i) => ({ x: pad.x + 40 + i * 14, y: pad.y + pad.height * 0.55 + Math.sin(i / 2) * 14 })));
  await drag(page, [{ x: pad.x + 140, y: pad.y + 18 }, { x: pad.x + 150, y: pad.y + pad.height * 0.5 }, { x: pad.x + 170, y: pad.y + pad.height * 0.75 }]);
  if (shots) await page.screenshot({ path: `${shots}/notebook-signature-pad.png` });
  const before = await signatures(page);
  await page.click('[data-sig-save]');
  if (!(await signatureAdded(page, before))) failures.push('the drawn signature was not placed');
  await page.waitForTimeout(400);
  const caption = (await page.locator('.ov-signature .sig-caption').first().textContent().catch(() => '')) || '';
  const who = CAPTION.exec(caption);
  if (!who || who[1] !== 'delta') failures.push(`signature caption: "${caption}"`);
  if ((await page.locator('.ov-signature .sig-svg line').count()) < 5) failures.push('the placed signature shows no strokes');
  if (await page.isVisible('[data-sig-pad]')) failures.push('the pad stayed open after saving');
  if (await page.locator('li[data-kind=signature] [data-annotation-edit]').count()) failures.push('a signature offers Edit (it is moved, never edited)');
  if (shots) await page.screenshot({ path: `${shots}/notebook-signature-placed.png` });
  // With a signature saved, Signature places it at once.
  const again = await signatures(page);
  await rightClick(page, 'Thistle');
  await page.click('.anno-menu [data-act=signature]');
  if (!(await signatureAdded(page, again))) failures.push('a saved signature was not placed straight away');
  if (await page.isVisible('[data-sig-pad]')) failures.push('the pad opened although a signature was saved');
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const bp = await signIn(ctx, 'beta');
  await bp.goto(base + signPath, { waitUntil: 'networkidle' });
  await bp.waitForTimeout(600);
  await rightClick(bp, 'Velvet');
  await bp.click('.anno-menu [data-act=signature]');
  if (!(await bp.waitForSelector('[data-sig-pad]:not([hidden])', { timeout: 3000 }).then(() => true, () => false))) failures.push('another member got no pad (they have no signature of their own)');
  await bp.click('[data-sig-tab=typed]');
  await bp.fill('[data-sig-input]', 'Invented Name');
  const before = await signatures(bp);
  await bp.click('[data-sig-save]');
  if (!(await signatureAdded(bp, before))) failures.push('the typed signature was not placed');
  await bp.waitForTimeout(400);
  const typed = bp.locator('.ov-signature', { has: bp.locator('.sig-typed', { hasText: 'Invented Name' }) });
  const caption = (await typed.locator('.sig-caption').textContent().catch(() => '')) || '';
  if (CAPTION.exec(caption)?.[1] !== 'beta') failures.push(`typed signature caption: "${caption}"`);
  if ((await bp.locator('.ov-signature[data-own=true]').count()) !== 1) failures.push('the other member could move signatures that are not theirs');
  await ctx.close();
}
// The loupe: from the menu; it follows the pointer, magnifies 3 times, and closes with Escape or a click.
{
  const lens = () => rawFrame(page).evaluate(() => {
    const l = document.querySelector('[data-hj-loupe]');
    if (!l || getComputedStyle(l).display === 'none') return null;
    const r = l.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, transform: l.firstElementChild.style.transform };
  });
  const frameBox = await page.locator('.doc-frame').boundingBox();
  await rightClick(page, 'Lantern');
  await page.click('.anno-menu [data-act=loupe]');
  await page.waitForTimeout(250);
  if (!(await page.isVisible('[data-loupe-chip]'))) failures.push('the loupe controls did not show');
  {
    const chip = await page.locator('[data-loupe-chip]').boundingBox();
    const close = await page.locator('[data-loupe-close]').boundingBox();
    if (!chip || !close || close.x + close.width > chip.x + chip.width + 1 || chip.x < 0 || chip.x + chip.width > 1440) failures.push('the loupe controls are cut off');
  }
  const a = await textPoint(page, 'orchard');
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(250);
  const first = await lens();
  if (!first || Math.abs(frameBox.x + 1 + first.x - a.x) > 3 || Math.abs(frameBox.y + 1 + first.y - a.y) > 3) failures.push(`the loupe is not under the pointer (${JSON.stringify(first)} vs ${JSON.stringify(a)})`);
  if (shots) await page.screenshot({ path: `${shots}/notebook-loupe.png` });
  const b = await textPoint(page, 'harbour');
  await page.mouse.move(b.x, b.y);
  await page.waitForTimeout(250);
  const second = await lens();
  if (!second || Math.abs(second.x - first.x) < 20) failures.push('the loupe did not follow the pointer');
  if (!/scale\(2\)/.test(second?.transform || '')) failures.push('the loupe does not start at 2 times');
  await page.click('[data-loupe-zoom="3"]');
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(250);
  if (!/scale\(3\)/.test((await lens())?.transform || '')) failures.push('3× did not magnify 3 times');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  if ((await lens()) || (await page.isVisible('[data-loupe-chip]'))) failures.push('Escape did not close the loupe');
  await rightClick(page, 'Lantern');
  await page.click('.anno-menu [data-act=loupe]');
  await page.waitForTimeout(250);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(300);
  if ((await lens()) || (await page.isVisible('[data-loupe-chip]'))) failures.push('a click in the document did not close the loupe');
  if (await page.locator('[data-loupe-chip]').isVisible()) await page.click('[data-loupe-close]');
}
// A picture: shown in the frame, with a sticky note and a drawing that keep their places.
const PICTURE = makePng(240, 160);
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'Garden plan.png', mimeType: 'image/png', buffer: PICTURE });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const picturePath = new URL(page.url()).pathname;
await page.waitForTimeout(800);
const pictureAt = async p => {
  const box = await p.locator('.doc-frame').boundingBox();
  const r = await rawFrame(p).evaluate(() => { const b = document.getElementById('picture').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  return { x: box.x + 1 + r.x, y: box.y + 1 + r.y, w: r.w, h: r.h };
};
const relTo = (o, q) => o && q && { x: (o.x - q.x) / q.w, y: (o.y - q.y) / q.h };
let notePlace = null, inkPlace = null;
{
  const natural = await rawFrame(page).evaluate(() => document.getElementById('picture')?.naturalWidth);
  if (natural !== 240) failures.push(`the picture did not show in the frame (natural width ${natural})`);
  if (!(await page.textContent('#panel')).includes('240 x 160 (PNG)')) failures.push('the panel does not report the picture size');
  let pic = await pictureAt(page);
  await page.mouse.click(pic.x + pic.w * 0.3, pic.y + pic.h * 0.4, { button: 'right' });
  await page.waitForSelector('.anno-menu:not([hidden])', { timeout: 3000 }).catch(() => failures.push('right-click on a picture opened no menu'));
  const notes = await page.locator('li[data-kind=note]').count();
  await page.click('.anno-menu [data-act=note]');
  await fill(page, 'Invented note on the picture');
  await page.waitForFunction(n => document.querySelectorAll('li[data-kind=note]').length > n, notes, { timeout: 5000 }).catch(() => failures.push('no note on the picture'));
  await page.mouse.click(pic.x + pic.w * 0.6, pic.y + pic.h * 0.7, { button: 'right' });
  await page.waitForSelector('.anno-menu:not([hidden])', { timeout: 3000 }).catch(() => {});
  await page.click('.anno-menu [data-act=ink][data-tool=draw]');
  const drawings = await inkCount(page, 'li[data-kind=ink]');
  await drag(page, Array.from({ length: 16 }, (_, i) => ({ x: pic.x + pic.w * 0.55 + i * 8, y: pic.y + pic.h * 0.7 + Math.sin(i / 2) * 8 })));
  if (!(await inkAdded(page, 'li[data-kind=ink]', drawings))) failures.push('no drawing on the picture');
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  pic = await pictureAt(page);
  notePlace = relTo(await page.locator('.ov-note').first().boundingBox(), pic);
  inkPlace = relTo(await groupBox(page, 'li[data-kind=ink]'), pic);
  if (!notePlace || Math.abs(notePlace.x - 0.3) > 0.02 || Math.abs(notePlace.y - 0.4) > 0.02) failures.push(`the note moved on the picture after a reload (${JSON.stringify(notePlace)})`);
  if (!inkPlace || inkPlace.x < 0.5 || inkPlace.x > 0.6 || inkPlace.y < 0.6 || inkPlace.y > 0.72) failures.push(`the drawing moved on the picture after a reload (${JSON.stringify(inkPlace)})`);
}
{
  const phone = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: shots ? 2 : 1, storageState: await setup.storageState() });
  const pp = await phone.newPage();
  await pp.goto(base + picturePath, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(900);
  const pic = await pictureAt(pp);
  const note = relTo(await pp.locator('.ov-note').first().boundingBox(), pic);
  const drawn = relTo(await groupBox(pp, 'li[data-kind=ink]'), pic);
  if (!note || !notePlace || Math.abs(note.x - notePlace.x) > 0.03 || Math.abs(note.y - notePlace.y) > 0.03) failures.push(`on a phone the note left its place on the picture (${JSON.stringify(note)} vs ${JSON.stringify(notePlace)})`);
  if (!drawn || !inkPlace || Math.abs(drawn.x - inkPlace.x) > 0.03 || Math.abs(drawn.y - inkPlace.y) > 0.03) failures.push(`on a phone the drawing left its place on the picture (${JSON.stringify(drawn)} vs ${JSON.stringify(inkPlace)})`);
  if (shots) await pp.screenshot({ path: `${shots}/phone-picture.png` });
  // The loupe's controls fit a phone.
  await pp.mouse.click(pic.x + pic.w * 0.5, pic.y + pic.h * 0.2, { button: 'right' });
  await pp.waitForSelector('.anno-menu:not([hidden])', { timeout: 3000 }).catch(() => failures.push('no menu on the phone picture'));
  await pp.click('.anno-menu [data-act=loupe]');
  await pp.waitForTimeout(250);
  const chip = await pp.locator('[data-loupe-chip]').boundingBox();
  const close = await pp.locator('[data-loupe-close]').boundingBox();
  if (!chip || !close || chip.x < 0 || chip.x + chip.width > 375 || close.x + close.width > chip.x + chip.width + 1) failures.push(`the loupe controls do not fit a phone (${JSON.stringify(chip)})`);
  await pp.click('[data-loupe-close]');
  await phone.close();
}

// 4. D4: redaction and attachments, on a document of their own (added by the owner).
const REDACT = `<!doctype html><html><head><meta charset="utf-8"><title>Redaction</title>
<style>body{font:16px system-ui;margin:24px}p{margin:0 0 48px}</style></head><body>
<h1>Redaction sample</h1><p id="r1">Invented contact Quillon Marsh lives at 7 Bramble Lane.</p><p id="r2">Orchard gate code 4417 for visitors.</p>
<p id="r3">Lantern place for the paperclip pin.</p><p id="r4">Meadow place for the second file.</p></body></html>`;
const PDF = Buffer.from('%PDF-1.4\n% invented test file\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const SMALL_PNG = makePng(40, 30);
await page.goto(base + '/documents/new');
await page.setInputFiles('input[name=file]', { name: 'redaction.html', mimeType: 'text/html', buffer: Buffer.from(REDACT) });
await page.click('form[action="/documents"] button[type=submit]');
await page.waitForURL(/\/documents\/\d{4}-\d{4}_\d+$/);
const redactPath = new URL(page.url()).pathname;
await page.waitForTimeout(800);
const kindCount = (p, kind) => p.locator(`li[data-kind=${kind}]`).count();
const kindAdded = (p, kind, n) => p.waitForFunction(([k, m]) => document.querySelectorAll(`li[data-kind=${k}]`).length > m, [kind, n], { timeout: 5000 }).then(() => true, () => false);
const attachAt = async (p, word, file) => {
  await rightClick(p, word);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), p.click('.anno-menu [data-act=attach]')]);
  if (!chooser) { failures.push(`Attach file opened no file picker (${file.name})`); return; }
  await chooser.setFiles(file);
};
const downloadOf = async (p, name) => {
  const link = p.locator('li[data-kind=attachment]', { hasText: name }).locator('[data-attachment-link]');
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), link.click()]);
  return download ? { name: download.suggestedFilename(), bytes: await readFile(await download.path()) } : null;
};
{
  // Another member (not the uploader, not the owner): no Redact in the menu, and the server says no.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const bp = await signIn(ctx, 'beta');
  await bp.goto(base + redactPath, { waitUntil: 'networkidle' });
  await bp.waitForTimeout(600);
  await rightClick(bp, 'Quillon Marsh', 'Quillon Marsh');
  if (!(await menuOpen(bp))) failures.push('no menu for another member');
  if (await bp.locator('.anno-menu [data-act=redaction]').count()) failures.push('Redact offered to a member who did not add the document');
  await bp.keyboard.press('Escape');
  const refused = await bp.evaluate(async path => (await fetch(`${path}/annotations`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'X-CSRF-Token': document.body.dataset.csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ kind: 'redaction', quote: 'Quillon Marsh' }).toString()
  })).status, redactPath);
  if (refused !== 403) failures.push(`another member marked a redaction (status ${refused})`);
  if (await bp.locator('form[data-redact-apply]').count()) failures.push('another member sees the apply form');
  await ctx.close();
}
{
  // The owner marks two passages: black boxes in the document, listed under Pending redactions.
  for (const words of ['Quillon Marsh', '4417']) {
    await rightClick(page, words, words);
    const n = await kindCount(page, 'redaction');
    await page.click('.anno-menu [data-act=redaction]');
    if (!(await kindAdded(page, 'redaction', n))) failures.push(`"${words}" was not marked for redaction`);
  }
  await noSelection(page);
  await page.waitForTimeout(300);
  const black = await rawFrame(page).evaluate(() => [...document.querySelectorAll('mark[data-hj-kind=redaction]')].map(m => getComputedStyle(m).backgroundColor));
  if (black.length !== 2 || !black.every(c => c === 'rgb(0, 0, 0)')) failures.push(`pending redactions not drawn as black boxes (${black.join(', ')})`);
  // A PDF pinned before the redaction is applied, to check it survives it.
  await attachAt(page, 'Lantern', { name: 'Invented ticket.pdf', mimeType: 'application/pdf', buffer: PDF });
  if (!(await kindAdded(page, 'attachment', 0))) failures.push('the PDF was not attached');
  await page.locator('#redactions').scrollIntoViewIfNeeded();
  if (shots) await page.screenshot({ path: `${shots}/notebook-redaction-pending.png` });
  // Applying needs REDACT; then the older version is gone and the words are blacked out.
  await page.fill('form[data-redact-apply] input[name=confirm]', 'REDACT');
  await Promise.all([page.waitForURL(/redacted=2/, { timeout: 8000 }).catch(() => failures.push('applying did not return to the document')), page.click('form[data-redact-apply] button[type=submit]')]);
  await page.waitForTimeout(900);
  const text = await rawFrame(page).evaluate(() => document.body.textContent);
  if (!text.includes('Invented contact ███████ █████ lives') || !text.includes('gate code ████ for') || /Quillon|Marsh|4417/.test(text)) failures.push('the applied redaction does not show blacked-out words');
  if (!(await page.textContent('.notice')).includes('Redaction applied: 2 passages blacked out')) failures.push('no notice after applying');
  const versions = await page.locator('#panel .versions li').allTextContents();
  if (versions.length !== 1 || !versions[0].startsWith('Version 2 (shown)')) failures.push(`versions after redaction: ${versions.join(' | ')}`);
  if (!/Earlier versions were removed by a redaction on .* \(SGT\) by delta\./.test(await page.textContent('.redaction-note').catch(() => ''))) failures.push('no note that earlier versions were removed');
  for (const old of ['original?v=1', 'raw?v=1']) {
    const status = await page.evaluate(async url => (await fetch(url, { credentials: 'same-origin' })).status, `${redactPath}/${old}`);
    if (status !== 404) failures.push(`the old version is still served at ${old} (${status})`);
  }
  if (await kindCount(page, 'redaction')) failures.push('pending redactions left after applying');
  if (await kindCount(page, 'attachment') !== 1) failures.push('the attachment did not survive the redaction');
  if (shots) {
    await page.locator('#panel .versions').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/notebook-redaction-applied.png` });
  }
  // A PNG, and a web page that is refused with a reason.
  await attachAt(page, 'Meadow', { name: 'Invented map.png', mimeType: 'image/png', buffer: SMALL_PNG });
  if (!(await kindAdded(page, 'attachment', 1))) failures.push('the PNG was not attached');
  await attachAt(page, 'Orchard', { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') });
  await page.waitForFunction(() => /cannot be attached/.test(document.querySelector('[data-attach-status]')?.textContent || ''), null, { timeout: 5000 }).catch(() => failures.push('a refused .html file gave no reason'));
  if (await kindCount(page, 'attachment') !== 2) failures.push('the .html file was attached');
  if ((await page.locator('.ov-attachment').count()) !== 2) failures.push('the paperclips are not shown over the document');
  const pdf = await downloadOf(page, 'Invented ticket.pdf');
  if (!pdf || pdf.name !== 'Invented ticket.pdf' || !pdf.bytes.equals(PDF)) failures.push(`the PDF did not download unchanged (${pdf?.name})`);
  const png = await downloadOf(page, 'Invented map.png');
  if (!png || png.name !== 'Invented map.png' || !png.bytes.equals(SMALL_PNG)) failures.push(`the PNG did not download unchanged (${png?.name})`);
  await page.locator('#attachments').scrollIntoViewIfNeeded();
  if (shots) await page.screenshot({ path: `${shots}/notebook-attachments.png` });
  // Pictures cannot be redacted yet: the item is there for the owner, greyed out.
  await page.goto(base + picturePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const pic = await pictureAt(page);
  await page.mouse.click(pic.x + pic.w * 0.5, pic.y + pic.h * 0.5, { button: 'right' });
  await page.waitForSelector('.anno-menu:not([hidden])', { timeout: 3000 }).catch(() => {});
  if (!(await page.isDisabled('.anno-menu [data-act=redaction]').catch(() => false))) failures.push('Redact is not greyed out on a picture');
  await page.keyboard.press('Escape');
}

await page.goto(base + sketchPath, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const expectedDrawings = await page.locator('.ink-layer g').count();

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

const PAGES = [['signin', '/', false], ['privacy', '/privacy', false], ['documents', '/documents', true], ['upload', '/documents/new', true], ['document', docPath, true], ['markup', markupPath, true], ['sketch', sketchPath, true], ['signing', signPath, true], ['picture', picturePath, true], ['redaction', redactPath, true], ['consent', '/consent', true], ['home', '/home', true], ['journal', '/journal', true], ['owner', '/owner', true]];

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
      if (label === 'sketch') {
        // The drawings are drawn over the document; the toolbar fits the window with 44px targets.
        await p.waitForTimeout(400);
        const drawn = await p.locator('.ink-layer g').count();
        if (drawn !== expectedDrawings) problems.push(`expected ${expectedDrawings} drawings, found ${drawn}`);
        await rightClick(p, 'Orchard');
        await p.click('.anno-menu [data-act=ink][data-tool=sketch]').catch(() => problems.push('no Sketch in the annotation menu'));
        const bar = await p.locator('[data-ink-bar]').boundingBox();
        if (!bar) problems.push('the drawing toolbar did not open');
        else if (bar.x < 0 || bar.y < 0 || bar.x + bar.width > width + 1 || bar.y + bar.height > height + 1) problems.push(`the drawing toolbar runs outside the window (${Math.round(bar.x)},${Math.round(bar.y)} ${Math.round(bar.width)}x${Math.round(bar.height)})`);
        const small = await p.$$eval('[data-ink-bar] button', bs => bs.filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
        if (small) problems.push(`${small} toolbar buttons smaller than 44px`);
        const capture = await p.locator('[data-ink-capture]').boundingBox();
        const frameBox = await p.locator('.doc-frame').boundingBox();
        if (!capture || Math.abs(capture.x - frameBox.x) > 1 || Math.abs(capture.width - frameBox.width) > 1) problems.push('the drawing surface does not cover the document');
        await p.keyboard.press('Escape');
        if (await p.isVisible('[data-ink-bar]')) problems.push('Escape did not leave drawing');
        const after = await p.evaluate(() => window.__csp);
        if (after.length) problems.push(`CSP while drawing: ${after.join('; ')}`);
      }
      if (label === 'redaction') {
        // D4: the blacked-out words and the two paperclips, drawn over the document.
        await p.waitForTimeout(400);
        const text = await rawFrame(p).evaluate(() => document.body.textContent);
        if (!text.includes('███████ █████') || /Quillon|4417/.test(text)) problems.push('the redacted words show');
        const pins = await p.locator('.ov-attachment:not([hidden])').count();
        if (pins !== 2) problems.push(`expected 2 paperclips over the document, found ${pins}`);
        if ((await p.locator('li[data-kind=attachment]').count()) !== 2) problems.push('the attachments are not listed');
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
