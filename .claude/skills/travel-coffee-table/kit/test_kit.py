#!/usr/bin/env python3
"""Tests for the travel coffee-table kit (standard library only):  python3 kit/test_kit.py"""
import copy
import datetime
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import build  # noqa: E402

EXAMPLE = os.path.join(HERE, 'example', 'trip.json')
SCRIPT_HOSTS = {'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com'}
STYLE_HOSTS = {'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'}
FRAME_PREFIXES = ('https://maps.google.com/maps', 'https://www.google.com/maps/', 'https://www.instagram.com/', 'https://www.tiktok.com/embed/')
HTML_SINKS = re.compile(r'\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b')

PANEL_JS = r"""
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const page = process.argv[2], dir = path.dirname(page), name = path.basename(page);
fs.writeFileSync(path.join(dir, 'parent.html'), `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe src="${name}" style="border:0;width:390px;height:844px"></iframe>
<script>window.WANT=null; window.SHARE=null; window.addEventListener('message', function(e){
  if (e.data && e.data.type === 'hj:near-want') { window.WANT = e.data; var keys = e.data.places.slice(0, 2).map(function(p){ return { key: p.key, km: 1.5 }; });
    e.source.postMessage({ type: 'hj:near', ok: true, places: keys.concat([{ key: 'p-nowhere', km: 1 }]), lat: 1, lon: 2 }, '*'); }
  if (e.data && e.data.type === 'hj:share-want') { window.SHARE = e.data; e.source.postMessage({ type: 'hj:shared', ok: true, how: 'copy' }, '*'); }
});</script>`);
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await ctx.route(/^https?:/, r => r.abort());
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto('file://' + page, { waitUntil: 'load' });
    await p.waitForTimeout(400);
    const r = await p.evaluate(async () => {
      const anims = () => document.getAnimations().filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length;
      const before = anims();
      const a = [...document.querySelectorAll('.worship a.pl')][0]; a.click();
      await new Promise(f => setTimeout(f, 60));
      const sheet = document.getElementById('sheet'), ig = sheet.querySelector('.sh-ig iframe');
      const opened = { shown: !sheet.hidden, title: document.getElementById('sheet-h').textContent, focus: document.activeElement.id,
        ig: ig ? ig.getAttribute('src') : '', out: [...sheet.querySelectorAll('.sh-out a')].map(x => [x.textContent, x.target]), running: anims() - before,
        spot: (sheet.querySelector('.sh-facts') || {}).textContent || '' };
      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(f => setTimeout(f, 500));
      return Object.assign(opened, { closed: sheet.hidden, back: document.activeElement === a });
    });
    out[reduced ? 'reduced' : 'motion'] = Object.assign(r, { errors });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:/, r => r.abort());
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('file://' + path.join(dir, 'parent.html'), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  const f = p.frames().find(x => x.url().endsWith('/' + name));
  await f.evaluate(() => document.querySelector('[data-near-me]').click());
  await p.waitForTimeout(400);
  const near = await f.evaluate(() => ({ items: [...document.querySelectorAll('.near-list li')].map(li => li.textContent), text: document.querySelector('.sheet-body').textContent }));
  await f.evaluate(() => { document.querySelector('#sheet [data-sheet-close]').click(); });
  await p.waitForTimeout(400);
  await f.evaluate(() => { document.querySelector('.worship a.pl').click(); });
  await p.waitForTimeout(200);
  await f.evaluate(() => { [...document.querySelectorAll('.sh-acts button')].find(b => /Share/.test(b.textContent)).click(); });
  await p.waitForTimeout(300);
  const toast = await f.evaluate(() => { const t = document.querySelector('.toast'); return t.hidden ? '' : t.textContent; });
  const day = await f.evaluate(() => { const b = document.querySelector('[data-share-day]'); return b && !b.hidden; });
  out.framed = { want: await p.evaluate(() => window.WANT), share: await p.evaluate(() => window.SHARE), near, toast, day, errors };
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
"""

GALLERY_JS = r"""
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [name, w] of [['wide', 1180], ['phone', 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
    const asked = [];
    await ctx.route(/^https?:/, r => { asked.push(r.request().url()); return r.abort(); });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto('file://' + process.argv[2], { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const before = asked.filter(u => /instagram\.com\/(p|reel)\/|tiktok\.com\/embed\/v2/.test(u)).length;
    await p.click('.viewsw button[data-view="gallery"]');
    await p.waitForTimeout(300);
    const g = await p.evaluate(() => ({ view: document.documentElement.getAttribute('data-view'), shown: getComputedStyle(document.getElementById('gallery')).display,
      overview: getComputedStyle(document.getElementById('overview')).display, frames: document.querySelectorAll('#gallery iframe').length,
      wide: document.documentElement.scrollWidth > innerWidth + 1, pressed: document.querySelector('.viewsw [data-view="gallery"]').getAttribute('aria-pressed') }));
    await p.click('.g-social[data-kind="tiktok"] .g-play');
    await p.click('.g-social[data-kind="instagram"] .g-play');
    await p.waitForTimeout(200);
    const live = await p.evaluate(() => [...document.querySelectorAll('#gallery iframe')].map(f => f.getAttribute('src')));
    const orig = await p.evaluate(() => [...document.querySelectorAll('#gallery .g-orig')].map(a => (a.closest('.g-live') ? 'live ' : 'idle ') + getComputedStyle(a).display));
    await p.click('.viewsw button[data-view="read"]');
    await p.waitForTimeout(200);
    const back = await p.evaluate(() => ({ view: document.documentElement.getAttribute('data-view'), overview: getComputedStyle(document.getElementById('overview')).display }));
    // a link to a part of the Gallery opens the Gallery there; a link to any other part opens the reading view
    const q = await ctx.newPage(); q.on('pageerror', e => errors.push(e.message));
    await q.goto('file://' + process.argv[2] + '#g-day-1', { waitUntil: 'load' });
    await q.waitForTimeout(400);
    const hashed = await q.evaluate(() => ({ view: document.documentElement.getAttribute('data-view'),
      top: Math.round(document.getElementById('g-day-1').getBoundingClientRect().top) }));
    await q.evaluate(() => { location.hash = 'day-2'; });
    await q.waitForTimeout(400);
    hashed.after = await q.evaluate(() => document.documentElement.getAttribute('data-view'));
    // a saved copy cannot share, so the # is an ordinary link to that part
    await q.click('#days > h2 .sec-link');
    await q.waitForTimeout(200);
    hashed.clicked = await q.evaluate(() => location.hash);
    hashed.links = await q.evaluate(() => [...document.querySelectorAll('.sec-link')].filter(a => a.getClientRects().length)
      .map(a => { const r = a.getBoundingClientRect(); return [a.getAttribute('data-sec-link'), Math.round(r.width), Math.round(r.right) <= innerWidth]; }));
    out[name] = Object.assign(g, { before, live, back, errors, orig, hashed });
    await ctx.close();
  }
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
"""


CAL_JS = r'''
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [name, w] of [['wide', 1180], ['phone', 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
    await ctx.route(/^https?:/, r => r.abort());
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto('file://' + process.argv[2], { waitUntil: 'load' });
    await p.waitForTimeout(300);
    out[name] = await p.evaluate(() => {
      const sc = document.querySelector('.cal-scroll');
      const cards = [...document.querySelectorAll('.cal-day .cal-ev')];
      let overlap = 0;
      for (const col of document.querySelectorAll('.cal-day')) {
        const rs = [...col.querySelectorAll('.cal-ev')].map(e => e.getBoundingClientRect());
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i], b = rs[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
        }
      }
      return { wide: document.documentElement.scrollWidth > innerWidth + 1, scrolls: sc.scrollWidth > sc.clientWidth + 1,
        off: !document.querySelector('.cal-off').hidden, adds: getComputedStyle(document.querySelector('.cal-add')).display,
        cards: cards.length, overlap };
    });
    out[name].errors = errors;
    await ctx.close();
  }
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
'''


TOUR_JS = r'''
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route(/^https?:/, r => r.abort());
  const p = await ctx.newPage();
  await p.goto('file://' + process.argv[2], { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const f = p.frames().find(x => x.url().endsWith('page.html'));
  await f.click('#play-trip');
  await p.waitForTimeout(400);
  await f.click('#tour .tour-close');
  await p.waitForTimeout(300);
  process.stdout.write(JSON.stringify(await p.evaluate(() => window.__msgs)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
'''


def find_browser():
    import shutil
    node = shutil.which('node')
    for base in (os.environ.get('PLAYWRIGHT_NODE_PATH'), '/opt/node-tools/node_modules', os.path.expanduser('~/node_modules')):
        if node and base and os.path.isdir(os.path.join(base, 'playwright')):
            return node, base
    return None, None


NODE, PLAYWRIGHT_PATH = find_browser()
BROWSER = bool(NODE)
MEASURE_JS = r'''
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const w of [1180, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w > 600 ? 820 : 844 } });
    const page = await ctx.newPage();
    await page.route(/^https?:/, r => r.abort());
    await page.goto('file://' + process.argv[2], { waitUntil: 'load' });
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
    await page.waitForTimeout(300);
    res[w] = await page.evaluate(() => {
      const tall = [], seen = (e) => e.getClientRects().length > 0;
      const lh = (e) => { const cs = getComputedStyle(e); const v = parseFloat(cs.lineHeight); return isNaN(v) ? parseFloat(cs.fontSize) * 1.5 : v; };
      const chips = [...document.querySelectorAll('.offl .lk')].filter(seen);
      for (const e of chips) { const h = e.getBoundingClientRect().height; if (h > Math.max(48, 2 * lh(e) + 4) || h < 30) tall.push(['chip', e.textContent.trim(), h]); }
      for (const e of [...document.querySelectorAll('.offl .lk-addr, .offl p.lk-hours, .offl details.lk-hours > summary')].filter(seen)) {
        const h = e.getBoundingClientRect().height; if (innerWidth > 600 && h > Math.max(48, 2 * lh(e) + 4)) tall.push(['line', e.textContent.trim().slice(0, 60), h]);
      }
      const harbour = document.getElementById('d1-harbour');
      const tel = [...harbour.querySelectorAll('.offl .lk[data-kind=tel] .l')].find(seen);
      const addr = harbour.querySelector('.offl .lk-addr');
      return { chips: chips.length, tall, tel: tel ? tel.textContent : null, addr: addr && seen(addr) ? addr.innerText : '',
               hscroll: document.documentElement.scrollWidth > innerWidth };
    });
    await ctx.close();
  }
  await browser.close();
  process.stdout.write(JSON.stringify(res));
})().catch(e => { console.error(e); process.exit(1); });
'''

TILES_JS = r'''
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const page = process.argv[2], dir = path.dirname(page), name = path.basename(page);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X8nX0AAAAASUVORK5CYII=', 'base64');
const TICKET = '1730880000.' + '0123456789abcdef'.repeat(2);
const good = { type: 'hj:tiles', ok: true, base: 'http://127.0.0.1:9/tiles', ticket: TICKET, expires: 1730883600 };
const scenarios = {
  good: [good, 50], refused: [{ type: 'hj:tiles', ok: false }, 50], silent: [null, 0], late: [good, 9000],
  badBase: [Object.assign({}, good, { base: 'http://family.example/tiles' }), 50],
  badTicket: [Object.assign({}, good, { ticket: TICKET + '&x=1' }), 50], stranger: ['stranger', 50],
};
function parentHtml(answer, delay) {
  const stranger = answer === 'stranger'
    ? `<iframe srcdoc="<script>setTimeout(function(){ parent.frames[0].postMessage(${JSON.stringify(good).replace(/"/g, '&quot;')}, '*'); }, 1500);<\/script>"></iframe>` : '';
  const reply = answer && answer !== 'stranger'
    ? `setTimeout(function(){ e.source.postMessage(${JSON.stringify(answer)}, '*'); }, ${delay});` : '';
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe src="${name}" style="border:0;width:390px;height:844px"></iframe>${stranger}
<script>window.WANTS=0; window.addEventListener('message', function(e){ if (e.data && e.data.type === 'hj:tiles-want') { window.WANTS++; ${reply} } });</script>`;
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const reqs = {};
  await ctx.route(/^https?:/, r => {
    const u = r.request().url();
    if (u.startsWith('https://unpkg.com/leaflet@')) return r.continue();
    if (u.startsWith('http://127.0.0.1:9/tiles/')) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return r.abort();
  });
  const run = async (key, url) => {
    const p = await ctx.newPage();
    const res = { errors: [], tiles: [] };
    p.on('pageerror', e => res.errors.push(e.message));
    p.on('request', q => { const u = q.url(); if (/\/tiles\/|tile\.openstreetmap|cartocdn/.test(u)) res.tiles.push(u); });
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(key === 'late' ? 10500 : 3500);
    const f = key === 'alone' ? p.mainFrame() : p.frames().find(x => x.url().endsWith('/' + name));
    Object.assign(res, await f.evaluate(() => {
      const n = document.querySelector('.tiles-notice'), a = document.querySelector('.leaflet-control-attribution'), m = document.getElementById('leaflet');
      const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible';
      const mb = m.getBoundingClientRect(), ab = a ? a.getBoundingClientRect() : null;
      return { leaflet: !!window.L, notice: shown(n) ? n.textContent : '', plain: m.classList.contains('no-tiles'),
        credit: shown(a) ? a.textContent : '', creditHref: a && a.querySelector('a[href="https://www.openstreetmap.org/copyright"]') ? 'ok' : '',
        creditOnMap: !!ab && ab.left >= mb.left && ab.right <= mb.right + 1 && ab.top >= mb.top && ab.bottom <= mb.bottom + 1 };
    }));
    if (key !== 'alone') res.wants = await p.evaluate(() => window.WANTS);
    await p.close();
    return [key, res];
  };
  const jobs = [run('alone', 'file://' + page)];
  for (const [k, [ans, delay]] of Object.entries(scenarios)) {
    const f = path.join(dir, `parent-${k}.html`);
    fs.writeFileSync(f, parentHtml(ans, delay));
    jobs.push(run(k, 'file://' + f));
  }
  const out = Object.fromEntries(await Promise.all(jobs));
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
'''


def example():
    return build.load(EXAMPLE)


def nodes(root):
    return list(root.iter())


def find(root, tag=None, cls=None, **attrs):
    out = []
    for n in root.iter():
        if tag and n.tag != tag:
            continue
        if cls and cls not in n.classes():
            continue
        if any((n.attrs.get(k.replace('_', '-')) != v) if v is not True else (k.replace('_', '-') not in n.attrs) for k, v in attrs.items()):
            continue
        out.append(n)
    return out


def outside(n, pred):
    return n.up(pred) is None


def not_lightbox(n):
    # the photo viewer and the trip tour fill their frames from the page when they open
    return outside(n, lambda p: p.attrs.get('id') in ('lightbox', 'tour'))


class KitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = example()
        cls.html = build.build(cls.data)
        cls.root = build.parse_html(cls.html)
        cls.trip = json.loads(find(cls.root, 'script', id='trip-data')[0].text())

    # ------------------------------------------------------------ every component is there
    def test_every_component_present(self):
        r = self.root
        want = {
            'masthead': find(r, 'header', 'mast'), 'title': find(r, 'h1'), 'trip facts': find(r, 'ul', 'facts'),
            'display modes': find(r, 'button', data_set_mode='print'), 'top nav': find(r, 'nav', 'topnav'), 'day links in nav': find(r, 'a', 'tn-day'),
            'timeline rail': find(r, 'nav', 'rail'), 'rail day marks': find(r, 'a', 'day', href='#day-1'),
            'day headers': find(r, 'header', 'day-h'), 'route strip': find(r, 'button', 'chip-stop'), 'timeline': find(r, 'ol', 'timeline'),
            'numbered stops': find(r, 'article', 'stop'), 'pins': find(r, 'span', 'pin-letter'), 'show on map': find(r, 'button', 'show-map'),
            'photo bento': find(r, 'div', 'bento'), 'zoom buttons': find(r, 'button', 'zoom', data_zoom=True),
            'captions': find(r, 'span', 'cap'), 'credits on photos': find(r, 'span', 'credit'),
            'map drawers': find(r, 'details', 'drawer', data_pin=True), 'concierge drawers': find(r, 'details', 'drawer', data_cc=True),
            'nearby panel': find(r, 'section', 'nearby'), 'nearby cards': find(r, 'article', 'near'),
            'Instagram embed': [n for n in find(r, 'iframe') if n.attrs.get('data-src', '').startswith('https://www.instagram.com/')],
            'TikTok embed': [n for n in find(r, 'iframe') if n.attrs.get('data-src', '').startswith('https://www.tiktok.com/embed/')],
            'video clip': find(r, 'video'), 'map centre': find(r, 'aside', id='map-centre'), 'route map': find(r, 'div', id='leaflet'),
            'map tabs': find(r, 'button', role='tab'), 'safety layer': find(r, 'input', id='mc-safety'),
            'holiday rules': find(r, 'section', id='holidays'), 'climate table': find(r, 'table', 'wx'), 'stays': find(r, 'article', 'stay'),
            'transport': find(r, 'section', id='transport'), 'fares table': find(r, 'table', 'taxi'), 'backups': find(r, 'section', id='backups'),
            'decision checklist': find(r, 'ul', 'checks'), 'budget': find(r, 'div', 'budget'), 'concierge': find(r, 'section', id='concierge'),
            'emergency numbers': find(r, 'a', 'sos-main'), 'concierge areas': find(r, 'article', 'pc'), 'concierge templates': find(r, 'template'),
            'photo prompts': find(r, 'div', 'prompts'), 'credits': find(r, 'ul', 'credits'), 'sources': find(r, 'ol', 'srclist'),
            'carried sources': find(r, 'ul', 'srclist'), 'source tags': find(r, None, 'src'), 'lightbox': find(r, 'div', id='lightbox'),
            'footer': find(r, 'footer', 'foot'),
            'plans section': find(r, 'section', id='plans'), 'plan rules': find(r, 'ol', 'rules'), 'plan bar': find(r, 'div', 'plans-bar'),
            'Plan A button': find(r, 'button', 'plan-btn', data_plan='a'), 'Plan B button': find(r, 'button', 'plan-btn', data_plan='b'),
            'Plan C button': find(r, 'button', 'plan-btn', data_plan='c'), 'Plan B block': find(r, 'section', 'plan-alt', data_plan='b'),
            'Plan C block': find(r, 'section', 'plan-alt', data_plan='c'), 'forecast strips': find(r, 'div', 'wx'),
            'rules beside forecast': find(r, 'p', 'wx-rules'), 'weather credit': find(r, 'p', 'wx-credit'),
            'audience': find(r, 'section', id='audience'), 'lens switch': find(r, 'div', 'lens-switch'), 'lens buttons': find(r, 'button', 'lens-btn'),
            'suitability marks': find(r, 'li', 'suit'), 'lens notes': find(r, 'p', 'lens-note'),
            'upgrades': find(r, 'section', id='upgrades'), 'upgrade cards': find(r, 'article', 'upg'), 'optional label': find(r, 'p', 'upg-note'),
        }
        missing = [k for k, v in want.items() if not v]
        self.assertEqual(missing, [], f'components missing: {missing}')
        self.assertIn('Optional', find(r, 'p', 'upg-note')[0].text())
        self.assertGreaterEqual(len(find(r, 'button', 'lens-btn')), 3)
        for d in find(r, 'article', 'day'):
            self.assertTrue(find(d, 'div', 'wx'), f'{d.attrs["id"]} has no forecast strip')

    def test_link_rows_have_every_kind(self):
        hrefs = {}
        for a in find(self.root, 'a', 'lk'):
            emoji = find(a, 'span', 'e')[0].text()
            hrefs.setdefault(emoji, []).append(a.attrs['href'])
        self.assertTrue(any(h.startswith('https://') for h in hrefs.get('🌐', [])), 'website')
        self.assertTrue(any(h.startswith('tel:') for h in hrefs.get('📞', [])), 'phone')
        self.assertTrue(all(h.startswith('https://www.google.com/maps/search/?api=1&query=') for h in hrefs.get('📍', [])) and hrefs.get('📍'), 'Google Maps')
        self.assertTrue(all(h.startswith('https://earth.google.com/web/@') for h in hrefs.get('🌏', [])) and hrefs.get('🌏'), 'Google Earth')
        self.assertTrue(all(h.startswith('https://www.instagram.com/explore/tags/') for h in hrefs.get('#️⃣', [])) and hrefs.get('#️⃣'), 'Instagram tag')
        self.assertTrue(all(h.startswith('https://www.tiktok.com/search?q=') for h in hrefs.get('🎬', [])) and hrefs.get('🎬'), 'TikTok search')

    def test_plan_rules_come_from_the_data(self):
        page = self.root.text()
        for r in self.data['plans']['rules']:
            self.assertIn(r['text'], page)
        self.assertEqual([r['plan'] for r in self.trip['plans']['rules']], [r['plan'] for r in self.data['plans']['rules']])
        # Plan A stays in the page next to the alternatives; nothing is hidden
        for day in find(self.root, 'article', 'day'):
            self.assertTrue(find(day, 'div', 'plan-a'))
            for blk in find(day, None, 'plan'):
                self.assertNotIn('hidden', blk.attrs)

    # ------------------------------------------------------------ weather
    def test_weather_places_json_is_valid(self):
        places = self.trip['weather']['places']
        self.assertTrue(1 <= len(places) <= 12)
        keys = [p['key'] for p in places]
        self.assertEqual(len(keys), len(set(keys)), 'keys repeat')
        for p in places:
            self.assertEqual(set(p), {'key', 'lat', 'lon', 'start', 'end'}, 'only these fields leave the page')
            self.assertRegex(p['key'], r'^[a-z0-9][a-z0-9-]{0,29}$')
            for k, lo, hi in (('lat', -90, 90), ('lon', -180, 180)):
                self.assertIsInstance(p[k], (int, float))
                self.assertTrue(lo <= p[k] <= hi)
            a, b = (datetime.date.fromisoformat(p[k]) for k in ('start', 'end'))
            self.assertRegex(p['start'], r'^\d{4}-\d{2}-\d{2}$')
            self.assertLessEqual(a, b)
            self.assertLess((b - a).days, 60)
        for box in find(self.root, 'div', 'wx'):
            self.assertIn(box.attrs['data-wx-place'], keys)
            datetime.date.fromisoformat(box.attrs['data-wx-date'])
            self.assertTrue(box.text().strip().startswith('🗓️ Forecast from'), 'before the forecast reaches the trip it says when it starts')

    def test_weather_protocol_in_script(self):
        js = ''.join(n.text() for n in find(self.root, 'script') if not n.attrs.get('src') and n.attrs.get('type') != 'application/json')
        compact = re.sub(r'\s+', '', js)
        self.assertIn("type:'hj:weather-want'", compact)
        self.assertIn('window.parent!==window', compact)
        self.assertIn("window.parent.postMessage({type:'hj:weather-want',places:", compact)
        self.assertIn('event.source!==window.parent', compact)
        self.assertIn("data.type!=='hj:weather'", compact)
        self.assertIn('Open-Meteo.com', compact)
        self.assertIn('Weatherdataby', re.sub(r'\s+', '', self.html))

    def test_changing_day_ends_a_route_flight(self):
        # Codex review: a flight's callbacks used the old day after the day changed, and threw.
        # Changing the day stops the flight, and every callback checks it belongs to the live flight.
        js = ''.join(n.text() for n in find(self.root, 'script') if not n.attrs.get('src') and n.attrs.get('type') != 'application/json')
        compact = re.sub(r'\s+', '', js)
        day = compact[compact.index('functionselectDay('):]
        self.assertTrue(day[:day.index('dayIdx=')].endswith('if(flying){stopFly();}'))
        self.assertIn('flight++', compact[compact.index('functionstopFly('):])
        self.assertIn('mine=++flight', compact)
        self.assertIn('if(done||!live()){return;}', compact)

    # ------------------------------------------------------------ owner's rules
    def test_only_allowed_script_hosts(self):
        for s in find(self.root, 'script'):
            if s.attrs.get('src'):
                u = urllib.parse.urlsplit(s.attrs['src'])
                self.assertEqual(u.scheme, 'https')
                self.assertIn(u.hostname, SCRIPT_HOSTS)
        for l in find(self.root, 'link', rel='stylesheet'):
            self.assertIn(urllib.parse.urlsplit(l.attrs['href']).hostname, STYLE_HOSTS)
        for f in find(self.root, 'iframe'):
            self.assertTrue((f.attrs.get('data-src') or f.attrs.get('src', '')).startswith(FRAME_PREFIXES))

    def test_no_innerhtml(self):
        for s in find(self.root, 'script'):
            if not s.attrs.get('src') and s.attrs.get('type') != 'application/json':
                self.assertIsNone(HTML_SINKS.search(s.text()), 'the page script must build DOM with textContent')
        with open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8') as f:
            self.assertIsNone(HTML_SINKS.search(f.read()))

    def test_no_empty_photo_slot(self):
        for img in find(self.root, 'img'):
            if not_lightbox(img):
                self.assertTrue(img.attrs.get('src', '').strip(), 'an <img> without a picture')
                self.assertTrue(img.attrs.get('alt', '').strip(), 'an <img> without a description')
        for t in find(self.root, 'figure', 'tile') + find(self.root, 'figure', 'near-photo'):
            self.assertTrue(find(t, 'img'))
        for b in find(self.root, 'div', 'bento'):
            tiles = [c for c in b.children if isinstance(c, build.Node) and 'tile' in c.classes()]
            self.assertTrue(tiles)
            self.assertEqual(b.attrs['data-count'], str(len(tiles)))
        for v in find(self.root, 'video'):
            self.assertTrue(v.attrs.get('poster'))
            self.assertTrue(find(v, 'source'))

    def test_every_photo_has_a_credit(self):
        for n in find(self.root, 'img') + find(self.root, 'video'):
            if not not_lightbox(n):
                continue
            fig = n.up(lambda p: p.tag == 'figure')
            self.assertIsNotNone(fig, 'every picture sits in a figure')
            credit = [c for c in fig.iter() if 'credit' in c.classes()]
            self.assertTrue(credit and credit[0].text().strip(), f'no credit for {n.attrs.get("alt") or n.attrs.get("aria-label")}')
        self.assertEqual(len(find(self.root, 'ul', 'credits')[0].children), len(self.data['photos']), 'the credits list names every photo')

    def test_check_mode_passes_the_example(self):
        self.assertEqual(build.check_html(self.html), [])

    def test_check_mode_reports_broken_pages(self):
        bad = ('<html><body><figure class="tile"><img src="" alt="x"></figure>'
               '<figure><img src="https://example.com/a.jpg" alt="no credit"><figcaption>A nice view</figcaption></figure>'
               '<ul><li data-fact>Open 9am to 5pm daily, $12 entry.</li><li data-fact>Open 9am [[src]] <a class="src" href="https://example.com/">venue</a></li></ul>'
               '<a href="http://example.com/">plain http</a>'
               '<svg xmlns="http://www.w3.org/2000/svg"></svg><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E" alt="ok"></body></html>')
        rules = {r for r, _ in build.check_html(bad)}
        self.assertEqual(rules, {'blank picture holder', 'photo without credit', 'fact without a source', 'http link'})
        details = [d for r, d in build.check_html(bad) if r == 'http link']
        self.assertEqual(len(details), 1, 'namespaces and data: pictures are not links')
        facts = [d for r, d in build.check_html(bad) if r == 'fact without a source']
        self.assertEqual(len(facts), 1)
        with tempfile.TemporaryDirectory() as tmp:
            good_p, bad_p = os.path.join(tmp, 'good.html'), os.path.join(tmp, 'bad.html')
            with open(good_p, 'w', encoding='utf-8') as f:
                f.write(self.html)
            with open(bad_p, 'w', encoding='utf-8') as f:
                f.write(bad)
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(build.main(['--check', good_p, EXAMPLE]), 0)
                self.assertEqual(build.main(['--check', good_p, bad_p]), 1)
            self.assertIn('FAIL', out.getvalue())

    # ------------------------------------------------------------ audience
    def test_lens_mode(self):
        self.assertEqual(find(self.root, 'section', id='audience')[0].attrs['data-audience'], 'lenses')
        self.assertEqual(self.trip['audience']['mode'], 'lenses')
        self.assertEqual([l['key'] for l in self.trip['audience']['lenses']], [l['key'] for l in self.data['audience']['lenses']])
        marks = {n.attrs['data-mark'] for n in find(self.root, 'li', 'suit')}
        self.assertTrue({'step_free', 'walking', 'shade', 'seating', 'toilets', 'kids', 'seniors'} <= marks)

    def test_party_mode(self):
        d = copy.deepcopy(self.data)
        d['audience'] = {'mode': 'party', 'kicker': 'Who is travelling', 'title': 'Two friends.',
                         'travellers': [{'label': 'Traveller 1', 'detail': 'Loves markets.'}, {'label': 'Traveller 2', 'detail': 'Prefers short walks.'}],
                         'needs': ['walking', 'seating']}
        r = build.parse_html(build.build(d))
        self.assertEqual(find(r, 'section', id='audience')[0].attrs['data-audience'], 'party')
        self.assertEqual(len(find(r, 'article', 'traveller')), 2)
        self.assertFalse(find(r, 'div', 'lens-switch'))
        sums = [n.text() for n in find(r, 'p', 'suits-sum')]
        self.assertTrue(sums and all(s.startswith('For this group:') for s in sums))
        self.assertEqual(build.check_html(build.build(d)), [])

    # ------------------------------------------------------------ safety of the data
    def test_text_is_escaped(self):
        d = copy.deepcopy(self.data)
        d['stops']['beach']['name'] = '<script>alert(1)</script>'
        d['photos']['beach-1']['cap'] = '" onerror="alert(2)'
        d['days'][0]['title'] = '<img src=x onerror=alert(3)>'
        html = build.build(d)
        self.assertNotIn('<script>alert(1)', html)
        self.assertNotIn('" onerror="alert(2)', html)
        self.assertNotIn('<img src=x', html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', html)

    def test_bad_data_is_refused(self):
        def refused(change):
            d = copy.deepcopy(self.data)
            change(d)
            with self.assertRaises(build.KitError):
                build.build(d)
        refused(lambda d: d['photos']['beach-1'].update(src='http://example.com/a.jpg'))
        refused(lambda d: d['photos']['beach-1'].update(credit=''))
        refused(lambda d: d['weather']['places'].extend({'key': f'p{i}', 'lat': 0, 'lon': 0, 'start': '2027-06-12', 'end': '2027-06-12'} for i in range(11)))
        refused(lambda d: d['weather']['places'][0].update(key='Example Bay'))
        refused(lambda d: d['weather']['places'][0].update(end='2027-06-01'))
        refused(lambda d: d['weather']['places'][0].update(lat=95))
        refused(lambda d: d['days'][0]['plan_b'].append({'stop': 'nowhere'}))
        refused(lambda d: d['upgrades']['groups'][0]['items'][0].pop('source'))
        refused(lambda d: d['plans']['rules'].append({'plan': 'd', 'metric': 'rain_pct', 'op': '>=', 'value': 1, 'text': 'x'}))
        refused(lambda d: d['days'][0]['info'][1].update(text='[[link:javascript:alert(1)|x]]'))
        refused(lambda d: d['days'][0]['info'][1].update(text='[[link:http://example.com/|x]]'))
        refused(lambda d: d['days'][0]['info'][0].update(text='[[src:no-such-source]]'))
        refused(lambda d: d['audience'].update(mode='crowd'))
        refused(lambda d: d['stops']['beach'].update(suits={'step_free': 'maybe'}))

    def test_map_tiles(self):
        # The family site's locked frame sends no Referer, which OpenStreetMap's tile servers require, so
        # by default the site relays the tiles with a ticket; CARTO with a key still works; tiles straight
        # from OpenStreetMap are accepted but --check reports them.
        self.assertEqual(self.trip['tiles'], {'provider': 'site', 'url': ''})
        self.assertEqual(self.trip['ui']['tiles_notice'], 'Map pictures load inside the family site.')
        self.assertEqual(build.check_html(self.html), [], '--check passes "site"')

        def trip_tiles(d):
            html = build.build(d)
            return json.loads(find(build.parse_html(html), 'script', id='trip-data')[0].text())['tiles'], html
        d = copy.deepcopy(self.data)
        d['map'].pop('tiles')
        self.assertEqual(trip_tiles(d)[0]['provider'], 'site', 'the default')
        d['map']['tiles'] = {'provider': 'carto', 'style': 'voyager', 'key': 'example-key'}
        tiles, html = trip_tiles(d)
        self.assertEqual(tiles, {'provider': 'carto', 'url': 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=example-key'})
        self.assertEqual(build.check_html(html), [])
        d['map']['tiles'] = {'provider': 'osm'}
        tiles, html = trip_tiles(d)
        self.assertEqual(tiles['provider'], 'osm')
        self.assertIn('map blocked in the family site', [rule for rule, _ in build.check_html(html)])
        broken = self.html.replace('hj:tiles-want', 'hj:nothing')
        self.assertIn('map blocked in the family site', [rule for rule, _ in build.check_html(broken)], 'site tiles need the ticket request')

        def refused(tiles):
            d = copy.deepcopy(self.data)
            d['map']['tiles'] = tiles
            with self.assertRaises(build.KitError):
                build.build(d)
        refused({'provider': 'carto'})
        refused({'provider': 'carto', 'key': 'a"><script>'})
        refused({'provider': 'carto', 'key': 'abcd', 'style': 'neon'})
        refused({'provider': 'mapbox', 'key': 'abcd'})
        refused('site')

    def test_tile_relay_protocol(self):
        js = open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read()
        compact = re.sub(r'\s+', '', js)
        relay = compact[compact.index('functionsiteTiles('):compact.index('fillSelectors();initMap();')]
        for part in ("framed=window.parent!==window;", "if(!framed){return;}",
                     "window.parent.postMessage({type:'hj:tiles-want'},'*');",
                     "if(event.source!==window.parent){return;}", "a.type!=='hj:tiles'", "a.ok===true",
                     "TILES_BASE.test(a.base)&&TILES_TICKET.test(a.ticket)", "setTimeout(function(){closed=true;},8000)",
                     "if(closed&&!layer){return;}", "L.tileLayer(url,{maxZoom:19,attribution:credit})",
                     "varurl=a.base+'/{z}/{x}/{y}.png?t='+a.ticket;", "box.classList.add('no-tiles');",
                     "t('tiles_notice','Mappicturesloadinsidethefamilysite.')"):
            self.assertIn(part, relay)
        self.assertEqual(relay.count("postMessage({type:'hj:tiles-want'}"), 1, 'asked once')
        self.assertIn('https://www.openstreetmap.org/copyright', compact)
        self.assertIn('&copy;OpenStreetMapcontributors', compact)

        def js_regex(name):
            src = re.search(r'var ' + name + r'=/(.+?)/;', js).group(1)
            return re.compile(src[:-1] + r'\Z' if src.endswith('$') else src)
        base, ticket = js_regex('TILES_BASE'), js_regex('TILES_TICKET')
        for ok in ('https://family.example.org/tiles', 'https://family.example.net:8443/tiles', 'http://127.0.0.1:8080/tiles', 'http://localhost:3000/tiles'):
            self.assertTrue(base.match(ok), ok)
        for bad in ('http://family.example.org/tiles', 'https://family.example.org/tiles/', 'https://family.example.org/x/tiles', 'https://family.example.org/tiles?x=1',
                    'https://FAMILY.example.org/tiles', 'https://a.org:123456/tiles', 'http://10.0.0.1:80/tiles', 'http://localhost/tiles',
                    'https://user@family.example.org/tiles', 'javascript:alert(1)//tiles', 'https://family.example.org/tiles\n', '//family.example.org/tiles'):
            self.assertFalse(base.match(bad), bad)
        for ok in ('1730880000.0123456789abcdef0123456789abcdef', '1.ffffffffffffffffffffffffffffffff'):
            self.assertTrue(ticket.match(ok), ok)
        for bad in ('1730880000.0123456789ABCDEF0123456789abcdef', '1730880000.0123456789abcdef0123456789abcde', '1234567890123.0123456789abcdef0123456789abcdef',
                    '0123456789abcdef0123456789abcdef', '1.0123456789abcdef0123456789abcdef&x=1', '1.0123456789abcdef0123456789abcdef\n', ''):
            self.assertFalse(ticket.match(bad), bad)
        css = re.sub(r'\s+', '', open(os.path.join(HERE, 'assets', 'kit.css'), encoding='utf-8').read())
        self.assertIn('.leaflet-control-attribution{display:block!important;visibility:visible!important', css, 'the credit is never hidden')

    @unittest.skipUnless(BROWSER, 'needs node and Playwright')
    def test_tile_relay_in_a_browser(self):
        # alone, and in a frame whose parent answers well, refuses, stays silent, answers late, sends a
        # bad base or ticket, or lets another frame answer instead
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, 'page.html')
            with open(page, 'w', encoding='utf-8') as f:
                f.write(self.html)
            script = os.path.join(tmp, 'tiles.cjs')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(TILES_JS)
            out = subprocess.run([NODE, script, page], capture_output=True, text=True, timeout=180,
                                 env=dict(os.environ, NODE_PATH=PLAYWRIGHT_PATH))
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            res = json.loads(out.stdout)
        if not res['alone']['leaflet']:
            self.skipTest('Leaflet could not be fetched from unpkg.com')
        notice = 'Map pictures load inside the family site.'
        for k, r in res.items():
            self.assertEqual(r['errors'], [], k)
        good = res.pop('good')
        ticket = '1730880000.' + '0123456789abcdef' * 2
        self.assertTrue(good['tiles'])
        for u in good['tiles']:
            self.assertRegex(u, r'^http://127\.0\.0\.1:9/tiles/\d+/\d+/\d+\.png\?t=' + re.escape(ticket) + '$')
        self.assertEqual((good['wants'], good['notice'], good['plain']), (1, '', False))
        self.assertIn('© OpenStreetMap contributors', good['credit'])
        self.assertEqual((good['creditHref'], good['creditOnMap']), ('ok', True), 'the credit links to the copyright page, on the map')
        for k, r in res.items():
            self.assertEqual(r['tiles'], [], f'{k}: no tile server is contacted')
            self.assertEqual((r['notice'], r['plain']), (notice, True), k)
            if k != 'alone':
                self.assertEqual(r['wants'], 1, f'{k}: asked once')

    def test_days_without_alternatives(self):
        d = copy.deepcopy(self.data)
        for day in d['days']:
            day['plan_b'], day['plan_c'] = [], []
        d['opener']['highlights'] = [s for s in d['opener']['highlights'] if s != 'tearoom']  # a Plan B stop
        r = build.parse_html(build.build(d))
        self.assertFalse(find(r, 'button', 'plan-btn'))
        self.assertEqual(len(find(r, 'p', 'plan-missing')), len(d['days']))
        self.assertTrue(find(r, 'p', 'wx-rules'), 'the rules still show')

    # ------------------------------------------------------------ the opener (owner's review, 6 November 2026)
    def test_opener_comes_first(self):
        body = find(self.root, 'body')[0]
        first = [c for c in body.children if isinstance(c, build.Node) and c.tag != 'a']
        self.assertEqual(first[0].attrs.get('id'), 'opener', 'the opener is the first thing on the page')
        op = first[0]
        self.assertEqual(len(find(self.root, 'h1')), 1, 'one h1: the opener title')
        self.assertTrue(find(op, 'h1', 'hero-t'))
        slides = find(op, 'figure', 'hero-slide')
        self.assertEqual(len(slides), len(self.data['opener']['hero']))
        for f in slides:
            self.assertTrue(find(f, 'img')[0].attrs['src'])
            self.assertTrue(find(f, 'span', 'credit')[0].text().strip())
        cd = find(op, 'span', id='op-count')[0]
        self.assertEqual((cd.attrs['data-start'], cd.attrs['data-end']), ('2027-06-12', '2027-06-13'))
        self.assertEqual(find(op, 'span', id='op-time')[0].attrs['data-tz'], 'UTC')
        self.assertEqual(len(find(op, 'ol', 'tldr')[0].children), 3)
        ids = {n.attrs['id'] for n in self.root.iter() if n.attrs.get('id')}
        for a in find(op, 'a', 'chip-alert'):
            self.assertIn(a.attrs['href'][1:], ids, 'alert chips link to a place on the page')
        cards = find(op, 'article', 'ocard')
        self.assertEqual(len(cards), len(self.data['opener']['stays']) + len(self.data['opener']['highlights']))
        for c in cards:
            target = find(c, 'a', 'ocard-t')[0].attrs['href']
            self.assertIn(target[1:], ids, 'each card links to its stop')
            self.assertTrue(find(c, 'img') and find(c, 'span', 'credit'), 'each card has a credited photo')
        self.assertTrue(find(op, 'a', 'ocard-web'), "a stop's website is a small second link")
        self.assertTrue(find(op, 'button', id='play-trip'))

    def test_legend_categories(self):
        labels = [n.text().strip() for n in find(self.root, 'button', 'lg') if 'legend-compact' not in n.parent.classes()]
        self.assertEqual([l.split()[1] if len(l.split()) > 1 else l for l in labels],
                         ['Stays', 'Transport', 'Weather', 'Food', 'Drinks', 'Snacks', 'Shopping', 'Fun', 'Sights', 'Worship'])
        self.assertEqual(list(self.trip['cats']), ['stays', 'transport', 'weather', 'food', 'drinks', 'snacks', 'shopping', 'fun', 'sights', 'worship'])
        for st in find(self.root, 'article', 'stop'):
            self.assertTrue(st.attrs.get('data-cats'), f'{st.attrs["id"]} carries its categories')
        self.assertEqual(find(self.root, 'article', 'stop', id='d2-market')[0].attrs['data-cats'], 'shopping snacks food', 'a list lights every category')
        self.assertTrue(find(self.root, 'button', 'lg', data_legend='worship'))
        self.assertTrue(any(s['cats'] for d in self.trip['days'] for s in d['stops']), 'route pins know their categories')
        d = copy.deepcopy(self.data)
        d['stops']['cellar']['cat'] = ['dining', 'drinks']
        r = build.parse_html(build.build(d))
        self.assertEqual(find(r, 'article', 'stop', id='d1b-cellar')[0].attrs['data-cats'], 'food drinks', '"dining" is read as Food')
        d['labels'] = {'cats': {'fun': 'Fun & games'}}
        self.assertIn('Fun &amp; games', build.build(d))
        d['stops']['cellar']['cat'] = 'nightlife'
        with self.assertRaises(build.KitError):
            build.build(d)

    def test_globe(self):
        op = find(self.root, 'section', id='opener')[0]
        svg = find(op, 'svg', 'globe')[0]
        for cls in ('g-sphere', 'g-grat', 'g-dots', 'g-coast', 'g-arc', 'g-pins'):
            self.assertTrue([n for n in svg.iter() if cls in n.classes()], cls)
        g = json.loads(find(self.root, 'script', id='globe-data')[0].text())
        self.assertTrue(1500 < len(g['d']) // 2 < 3000, 'a dotted land fill')
        self.assertGreater(sum(len(c) // 2 for c in g['c']), 2000, 'coastlines')
        with open(os.path.join(HERE, 'assets', 'land-110m.json'), encoding='utf-8') as f:
            land = json.load(f)
        self.assertEqual(list(land['objects']), ['land'])
        self.assertLess(os.path.getsize(os.path.join(HERE, 'assets', 'land-110m.json')), 80000, 'the 110m land, not a finer one')
        js = open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read()
        self.assertNotIn('fetch(', js)
        self.assertNotIn('XMLHttpRequest', js)
        self.assertIn('Natural Earth', find(self.root, 'section', id='credits')[0].text())
        o = self.trip['opener']
        self.assertEqual(o['home']['name'], 'Sample City')
        self.assertEqual(o['dest']['name'], 'Example Bay')

    def test_schedule_items_have_photos_and_links(self):
        items = [li for li in find(self.root, 'li') if li.parent.tag == 'ol' and 'timeline' in li.parent.classes()]
        with_stop = [li for li in items if find(li, 'a', 'tl-go')]
        self.assertGreaterEqual(len(with_stop), 6)
        for li in items:
            strips = find(li, 'div', 'strip')
            self.assertTrue(strips, 'every schedule item shows photos')
            tiles = find(strips[0], 'figure', 'tile')
            self.assertTrue(1 <= len(tiles) <= 3)
            for t in tiles:
                self.assertTrue(find(t, 'span', 'credit')[0].text().strip())
        for li in with_stop:
            self.assertTrue(find(li, 'a', 'lk'), 'and its official links')
        harbour = find(self.root, 'article', 'stop', id='d1-harbour')[0]
        chips = find(find(harbour, 'div', 'offl')[0], 'a', 'lk')
        kinds = [a.attrs.get('data-kind') for a in chips if a.attrs.get('data-kind')]
        self.assertEqual(kinds, ['web', 'ig', 'fb', 'tt', 'yt', 'tel'])
        emoji = {a.attrs['data-kind']: find(a, 'span', 'e')[0].text() for a in chips if a.attrs.get('data-kind')}
        self.assertEqual([emoji[k] for k in kinds], ['🌐', '📷', '📘', '🎵', '▶️', '📞'])
        addr = find(find(harbour, 'p', 'lk-addr')[0], 'a', data_kind='addr')[0]
        self.assertTrue(addr.attrs['href'].startswith('https://www.google.com/maps/'))
        hours = find(harbour, 'p', 'lk-hours')[0]
        self.assertIn('data-fact', hours.attrs)
        self.assertTrue(find(hours, 'a', 'src', data_source=True))
        drawer = find(harbour, 'details', 'ig-drawer')
        self.assertFalse(drawer, 'the harbour already embeds that Instagram account')
        hotel = find(self.root, 'article', 'stop', id='d1-hotel')[0]
        ig = find(hotel, 'details', 'ig-drawer')[0]
        frame = find(ig, 'iframe')[0]
        self.assertEqual(frame.attrs['data-src'], 'https://www.instagram.com/instagram/embed/')
        self.assertNotIn('src', frame.attrs, 'loaded only when the drawer opens')

    def test_official_links_row(self):
        # one row of small single-line chips, then the address as a line of text, then the hours
        for offl in find(self.root, 'div', 'offl'):
            kids = [k.tag + '.' + ' '.join(sorted(k.classes())) for k in offl.children if hasattr(k, 'tag')]
            order = [k.split('.')[0] + '.' + ('links' if 'links' in k else 'lk-addr' if 'lk-addr' in k else 'lk-hours') for k in kids]
            self.assertEqual(order, sorted(order, key=lambda k: ('ul.links', 'p.lk-addr', 'p.lk-hours', 'details.lk-hours').index(k)), kids)
            for a in find(offl, 'a', 'lk'):
                self.assertEqual([k.tag for k in a.children if hasattr(k, 'tag')][:1], ['span'])
                self.assertFalse(find(a, 'small') or find(a, 'br') or find(a, 'b'), 'no notes inside a chip')
                self.assertNotEqual(a.attrs.get('data-kind'), 'addr', 'the address is a line, not a chip')
        harbour = find(self.root, 'article', 'stop', id='d1-harbour')[0]
        tel = find(harbour, 'a', 'lk', data_kind='tel')[0]
        self.assertEqual(find(tel, 'span', 'l-wide')[0].text(), '+000 100 0400', 'the number on wide screens')
        self.assertEqual(find(tel, 'span', 'l-narrow')[0].text(), 'Call', 'and Call on phones')
        self.assertEqual(tel.attrs.get('title'), 'Harbour office', 'a name goes in the title')
        d = copy.deepcopy(self.data)
        [x for x in d['stops']['harbour']['links'] if x['kind'] == 'tel'][0]['short'] = 'Office'
        two = find(find(build.parse_html(build.build(d)), 'article', 'stop', id='d1-harbour')[0], 'a', 'lk', data_kind='tel')[0]
        self.assertEqual((find(two, 'span', 'l-wide')[0].text(), find(two, 'span', 'l-narrow')[0].text()),
                         ('Office · +000 100 0400', 'Call Office'), 'two venues on one stop: say which')
        ig = find(harbour, 'a', 'lk', data_kind='ig')[0]
        self.assertEqual((find(ig, 'span', 'l')[0].text(), ig.attrs.get('title')), ('Instagram', 'placeholder account'))
        self.assertEqual(find(find(harbour, 'p', 'lk-addr')[0], 'span', 'a')[0].text(), '1 Harbour Row, Example Bay')
        hotel = find(self.root, 'article', 'stop', id='d1-hotel')[0]
        tel = find(hotel, 'a', 'lk', data_kind='tel')[0]
        self.assertEqual((find(tel, 'span', 'l-wide')[0].text(), tel.attrs.get('title')), ('+000 100 0200', 'Hotel reception'))
        long_hours = find(hotel, 'details', 'lk-hours')[0]
        self.assertIn('data-fact', long_hours.attrs)
        self.assertIn('Hours', find(long_hours, 'summary')[0].text())
        self.assertIn('"open 24 hours"', find(long_hours, 'p', 'h')[0].text())
        self.assertTrue(find(long_hours, 'a', 'src', data_source=True), 'long hours keep their source')
        self.assertFalse(find(hotel, 'p', 'lk-hours'))
        css = re.sub(r'\s+', '', open(os.path.join(HERE, 'assets', 'kit.css'), encoding='utf-8').read())
        self.assertNotIn('.timelineli{', css, 'schedule rows never style the chips nested in them')
        self.assertIn('.timeline>li{display:grid', css)
        chip = css[css.index('.lk{display:inline-flex'):]
        self.assertIn('white-space:nowrap', chip[:chip.index('}')])

    @unittest.skipUnless(BROWSER, 'needs node and Playwright')
    def test_links_row_layout_in_a_browser(self):
        # rendered at iPad landscape and phone width: chips stay one line, the address and number show
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, 'page.html')
            with open(page, 'w', encoding='utf-8') as f:
                f.write(self.html)
            script = os.path.join(tmp, 'measure.cjs')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(MEASURE_JS)
            out = subprocess.run([NODE, script, page], capture_output=True, text=True, timeout=120,
                                 env=dict(os.environ, NODE_PATH=PLAYWRIGHT_PATH))
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            res = json.loads(out.stdout)
        wide, phone = res['1180'], res['390']
        self.assertGreater(wide['chips'], 20)
        self.assertEqual(wide['tall'], [], 'no link chip or line taller than about two lines at 1180 px (and no chip squashed)')
        self.assertEqual(phone['tall'], [], 'and chips stay one line at 390 px')
        self.assertIn('1 Harbour Row, Example Bay', wide['addr'])
        self.assertEqual(wide['tel'], '+000 100 0400')
        self.assertEqual(phone['tel'], 'Call')
        self.assertFalse(wide['hscroll'] or phone['hscroll'], 'no sideways scroll')

    def test_official_link_rules(self):
        def refused(link):
            d = copy.deepcopy(self.data)
            d['stops']['beach']['links'] = [link]
            with self.assertRaises(build.KitError):
                build.build(d)
        refused({'kind': 'ig', 'url': 'https://example.com/instagram'})
        refused({'kind': 'fb', 'url': 'https://notfacebook.com/page'})
        refused({'kind': 'tt', 'url': 'https://www.tiktok.com.example.net/@a'})
        refused({'kind': 'yt', 'url': 'http://www.youtube.com/@a'})
        refused({'kind': 'addr', 'label': '1 Sea Road', 'url': 'https://maps.example.com/?q=1'})
        refused({'kind': 'hours', 'label': 'Daily 9am to 5pm'})
        bad = ('<html><body><ul class="links"><li><a class="lk" data-kind="ig" href="https://insta.example.com/a">x</a></li>'
               '<li><a class="lk" data-kind="addr" href="https://www.bing.com/maps?q=1">1 Sea Road</a></li>'
               '<li><a class="lk" data-kind="yt" href="https://m.youtube.com/@a">ok</a></li></ul></body></html>')
        rules = [r for r, _ in build.check_html(bad)]
        self.assertEqual(sorted(rules), ['address not on Google Maps', 'social link off its platform'])

    def test_alternatives_and_worship(self):
        harbour = find(self.root, 'article', 'stop', id='d1-harbour')[0]
        alts = find(harbour, 'section', 'alts')[0]
        self.assertIn("If it's closed or crowded", alts.text())
        cards = find(alts, 'article', 'alt')
        self.assertEqual([c.attrs['data-cats'] for c in cards], ['food', 'drinks snacks', 'worship'])
        for c in cards:
            hours = find(c, 'p', 'alt-hours')
            self.assertTrue(hours and find(hours[0], 'a', 'src'), 'hours carry their source')
            self.assertTrue(find(c, 'button', 'show-map'))
        stays = find(self.root, 'section', id='stays')[0]
        self.assertEqual(len(find(find(stays, 'div', 'worship')[0], 'article', 'alt')), 3)
        cats = [p['cats'] for p in self.trip['nearby']]
        self.assertIn(['worship'], cats)
        self.assertGreaterEqual(len(self.trip['nearby']), 10)
        self.assertTrue(find(self.root, 'input', id='mc-nearby'), 'a nearby-options layer on the map')
        self.assertTrue(find(find(self.root, 'aside', id='map-centre')[0], 'div', 'legend-compact'), 'the legend lights pins on the map too')
        d = copy.deepcopy(self.data)
        d['stops']['harbour']['nearby'][0].pop('source')
        with self.assertRaises(build.KitError):
            build.build(d)

    def test_alternatives_read_plainly(self):
        for c in find(self.root, 'article', 'alt'):
            dist = find(c, 'p', 'alt-dist')
            if dist:
                self.assertNotRegex(dist[0].text(), r'straight line|estimate|\(', 'one plain line; the method goes in the title')
        harbour = find(self.root, 'article', 'stop', id='d1-harbour')[0]
        d = find(find(harbour, 'section', 'alts')[0], 'p', 'alt-dist')[0]
        self.assertRegex(d.text(), r'^About \d+ min (walk|drive)$')
        self.assertIn('straight line', d.attrs.get('title', ''))
        cart = [c for c in find(self.root, 'article', 'alt') if 'Lamp Room Tea Cart' in c.text()]
        self.assertEqual(len(cart), 1, 'a place without coordinates is still shown')
        self.assertFalse(find(cart[0], 'button', 'show-map'), 'but has no Show on map')
        self.assertTrue(find(cart[0], 'p', 'alt-hours'))
        gm = find(cart[0], 'a', data_kind='map')[0].attrs['href']
        self.assertIn('Example%20Bay%20lighthouse', gm, 'its Google Maps link searches by name')
        self.assertNotIn('Lamp Room Tea Cart', [p['name'] for p in self.trip['nearby']], 'and no pin')
        d = copy.deepcopy(self.data)
        d['stops']['lighthouse']['nearby'][0].pop('lng')
        with self.assertRaises(build.KitError):
            build.build(d)

    def test_play_the_trip(self):
        tour = find(self.root, 'div', id='tour')[0]
        self.assertEqual((tour.attrs.get('role'), tour.attrs.get('aria-modal')), ('dialog', 'true'))
        self.assertIn('hidden', tour.attrs)
        for cls in ('tour-prev', 'tour-pause', 'tour-next', 'tour-close'):
            self.assertTrue(find(tour, 'button', cls), cls)
        ids = {n.attrs['id'] for n in self.root.iter() if n.attrs.get('id')}
        steps = self.trip['tour']
        self.assertEqual(len(steps), sum(len(d['stops']) for d in self.data['days']))
        for s in steps:
            self.assertIn(s['id'], ids)
        js = open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read()
        compact = re.sub(r'\s+', '', js)
        self.assertIn("if(e.key==='Escape'){e.preventDefault();closeTour();}", compact)
        self.assertIn('tPlaying=!reduce;tPause.hidden=reduce;', compact, 'no autoplay under reduced motion: Next steps on')

    def test_motion_and_phone_rules(self):
        css = open(os.path.join(HERE, 'assets', 'kit.css'), encoding='utf-8').read()
        compact = re.sub(r'\s+', '', css)
        reduced = compact[compact.rindex('@media(prefers-reduced-motion:reduce)'):]
        for rule in ('.hero-slide.onimg{animation:none}', '.rv{opacity:1;transform:none;transition:none}'):
            self.assertIn(rule, reduced)
        self.assertIn('body{padding-bottom:calc(96px+env(safe-area-inset-bottom))}', compact)
        self.assertIn('html.has-opener.rail{opacity:0;visibility:hidden', compact)
        self.assertIn('has-opener', find(self.root, 'html')[0].attrs.get('class', ''))
        js = re.sub(r'\s+', '', open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read())
        self.assertIn("if(slides.length>1&&!reduce)", js)
        self.assertIn("if(!reduce&&'IntersectionObserver'inwindow){varrvEls", js)
        self.assertIn('v.muted=true;v.loop=true;', js)

    def test_page_weight_and_pinned_libraries(self):
        self.assertLess(len(self.html.encode('utf-8')), 1_500_000)
        for s in find(self.root, 'script') + find(self.root, 'link', rel='stylesheet'):
            url = s.attrs.get('src') or s.attrs.get('href') or ''
            if urllib.parse.urlsplit(url).hostname in SCRIPT_HOSTS:
                self.assertRegex(url, r'@\d+\.\d+\.\d+/', 'library versions are pinned exactly')

    def test_json_block_cannot_close_the_script(self):
        d = copy.deepcopy(self.data)
        d['days'][0]['title'] = '</script><script>alert(1)</script>'
        html = build.build(d)
        block = html.split('id="trip-data">', 1)[1].split('</script>', 1)[0]
        self.assertNotIn('<', block)
        self.assertEqual(json.loads(block)['days'][0]['title'], d['days'][0]['title'])

    # ------------------------------------------------------------ place panels, meals, photo spots (6 November 2026)
    def test_place_names_open_panels(self):
        panels = self.trip['panels']
        ids = {n.attrs['id'] for n in self.root.iter() if n.attrs.get('id')}
        links = find(self.root, 'a', 'pl')
        self.assertGreater(len(links), 20)
        for a in links:
            self.assertIn(a.attrs.get('data-place'), panels, a.text())
            self.assertNotIn('target', a.attrs, 'a place name never opens a new window')
            href = a.attrs.get('href', '')
            self.assertTrue(href == '#' or href[1:] in ids, href)
        for card in find(self.root, 'article', 'stop'):
            self.assertTrue(find(find(card, 'h4')[0], 'a', 'pl'), 'every stop name is a link')
        for card in find(self.root, 'article', 'alt'):
            self.assertTrue(find(card, 'a', 'pl'), 'every alternative, place of worship and meal choice name is a link')
        stays = find(self.root, 'section', id='stays')[0]
        self.assertEqual(find(stays, 'a', 'pl')[0].attrs['data-place'], 'p-hotel', 'a stay card names its place')
        day1 = find(self.root, 'article', id='day-1')[0]
        kicker = find(find(day1, 'header', 'day-h')[0], 'p', 'kicker')[0]
        self.assertEqual([a.text() for a in find(kicker, 'a', 'pl')], ['Station', 'Harbour', 'Lantern Point'], 'route labels link each place')
        info = [n for n in find(day1, 'section') if n.up(lambda x: 'info4' in x.classes())]
        self.assertTrue(any(find(n, 'a', 'pl') for n in info), '[[place:...]] in day notes')
        for pid, p in panels.items():
            self.assertRegex(pid, r'^[pa]-[a-z0-9-]{1,27}$')
            self.assertTrue(p['name'])
            self.assertTrue(p['maps'].startswith('https://www.google.com/maps'), pid)
            for k in ('web', 'hours_src'):
                if p.get(k):
                    self.assertTrue(p[k].startswith('https://'), (pid, k))
            if p.get('photo'):
                self.assertTrue(p['photo']['credit'], f'{pid}: a panel photo keeps its credit')
        with self.assertRaises(build.KitError):
            d = copy.deepcopy(self.data)
            d['days'][0]['info'][0]['text'] = '[[place:nowhere]]'
            build.build(d)

    def test_place_panel_markup(self):
        sheet = find(self.root, 'div', id='sheet')[0]
        self.assertIn('hidden', sheet.attrs)
        card = find(sheet, 'section', 'sheet-card')[0]
        self.assertEqual((card.attrs.get('role'), card.attrs.get('aria-modal'), card.attrs.get('aria-labelledby')), ('dialog', 'true', 'sheet-h'))
        self.assertTrue(find(sheet, 'button', 'sheet-x', data_sheet_close=True))
        self.assertTrue(find(self.root, 'p', 'toast', role='status'))
        self.assertTrue(find(self.root, 'button', 'near-me', data_near_me=True))
        self.assertEqual([b for b in find(self.root, 'button', 'near-me') if not b.attrs.get('data-near-me')], [],
                         'no plain Near me button (the owner, 7 November 2026); only Hungry? and Shop nearby')
        self.assertEqual(len(find(self.root, 'button', 'share-day')), len(self.data['days']))

    def test_meals_have_their_choices(self):
        day1 = find(self.root, 'article', id='day-1')[0]
        meals = find(day1, 'div', 'meal')
        self.assertEqual([m.attrs['data-meal'] for m in meals], ['lunch', 'dinner'])
        for m in meals:
            self.assertEqual(len(find(m, 'article', 'alt')), 4, 'four choices, the planned place counted')
            self.assertIn('4 choices', find(m, 'h4')[0].text())
        self.assertEqual(len(find(meals[0], 'article', 'alt-planned')), 1)
        self.assertTrue(find(meals[0], 'span', 'badge'))
        d = copy.deepcopy(self.data)
        d['days'][0]['meals'][1]['choices'].pop()
        with self.assertRaisesRegex(build.KitError, 'meal_choices'):
            build.build(d)
        d = copy.deepcopy(self.data)
        d['days'][0]['meals'][0]['meal'] = 'elevenses'
        with self.assertRaises(build.KitError):
            build.build(d)
        d = copy.deepcopy(self.data)
        d['days'][0]['meals'][0]['choices'][1]['hours'] = 'Daily 9 to 5'
        del d['days'][0]['meals'][0]['choices'][1]['source']
        with self.assertRaisesRegex(build.KitError, 'source'):
            build.build(d)

    def test_photo_spots_and_venue_instagram(self):
        spots = find(self.root, 'p', 'spot')
        self.assertEqual(len(spots), len(find(self.root, 'article', id='d1-lighthouse')) + 1)
        for sp in spots:
            self.assertIn('Photo spot', sp.text())
            self.assertTrue(find(sp, 'a', 'src'), 'a photo spot names its source')
        church = next(p for p in self.trip['panels'].values() if p['name'] == "St Example's Church")
        self.assertEqual((church['ig'], church['spot']['spot']), ('example.church', 'The lych gate'))
        self.assertTrue(self.trip['panels']['p-lighthouse']['spot']['src_url'].startswith('https://'))
        for bad in ({'spot': 'Somewhere'}, {'source': 'ex_tourism'}, {'spot': 'x', 'source': 'http://example.com/'}):
            d = copy.deepcopy(self.data)
            d['stops']['lighthouse']['photo_spot'] = bad
            with self.assertRaises(build.KitError):
                build.build(d)
        for bad in ('https://example.com/example.church', 'https://www.instagram.com/p/abc/x', 'http://www.instagram.com/example.church/'):
            d = copy.deepcopy(self.data)
            d['worship'][0]['items'][0]['instagram'] = bad
            with self.assertRaises(build.KitError):
                build.build(d)

    def test_title_accents(self):
        self.assertIn('Example Bay &amp; the <em>Lantern</em> Coast', self.html)
        self.assertIn('Arrive by the <em>sea</em>', self.html)
        page = build.Page(copy.deepcopy(self.data))
        self.assertEqual(page.accent('**not** an *accent* <b>'), '**not** an <em>accent</em> &lt;b&gt;')
        self.assertEqual(self.trip['days'][0]['title'], 'Arrive by the sea', 'plain text never shows the accent markers')
        self.assertNotIn('*sea*', self.html)

    def test_motion_only_through_the_web_animations_helper(self):
        js = open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read()
        compact = re.sub(r'\s+', '', js)
        self.assertEqual(compact.count('.animate('), 1, 'every animation goes through motion()')
        self.assertIn("functionmotion(e,frames,opts){if(reduce||!e||typeofe.animate!=='function'){returnnull;}", compact)
        self.assertNotIn('forwards', js, 'no animation is left filling after it ends')
        self.assertIn("sheetCard.style.transform=to;", compact, 'the panel closes onto its own style')
        self.assertIn("if(tAnim){tAnim.pause();}", compact, 'Play the trip pauses its animation')

    def test_share_and_near_me_protocol(self):
        js = open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read()
        compact = re.sub(r'\s+', '', js)
        self.assertIn("window.parent.postMessage({type:'hj:share-want',kind:'place',title:String(p.name).slice(0,120),text:text,url:url},'*');", compact)
        self.assertIn("window.parent.postMessage({type:'hj:share-want',kind:'doc',title:title,hash:id},'*');", compact, 'a day is shared by its link only')
        self.assertIn("if(!ANCHOR_OK.test(id||'')){returnfalse;}", compact, 'only a plain part name goes after the #')
        self.assertIn("window.parent.postMessage({type:'hj:near-want',places:places},'*');", compact)
        panel = compact[compact.index('/*====placepanels'):]
        self.assertIn("if(event.source!==window.parent){return;}", panel)
        self.assertIn("returnx&&typeofx.key==='string'&&P[x.key]&&typeofx.km==='number'&&isFinite(x.km);", panel, 'only known keys and distances are used')
        self.assertIn('{enableHighAccuracy:false,maximumAge:300000,timeout:15000}', panel, 'never precise location')
        self.assertFalse(HTML_SINKS.search(panel))

    @unittest.skipUnless(BROWSER, 'needs node and Playwright')
    def test_place_panel_in_a_browser(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, 'page.html')
            with open(page, 'w', encoding='utf-8') as f:
                f.write(self.html)
            script = os.path.join(tmp, 'panel.cjs')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(PANEL_JS)
            out = subprocess.run([NODE, script, page], capture_output=True, text=True, timeout=180,
                                 env=dict(os.environ, NODE_PATH=PLAYWRIGHT_PATH))
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            res = json.loads(out.stdout)
        for k in ('motion', 'reduced'):
            r = res[k]
            self.assertEqual(r['errors'], [], k)
            self.assertEqual((r['shown'], r['title'], r['focus'], r['closed'], r['back']), (True, "St Example's Church", 'sheet-h', True, True), k)
            self.assertEqual(r['ig'], 'https://www.instagram.com/example.church/embed/')
            self.assertTrue(r['out'] and all(t == '_blank' and '↗' in x for x, t in r['out']), 'outside links are marked and grouped')
            self.assertIn('The lych gate', r['spot'])
        self.assertGreater(res['motion']['running'], 0, 'the panel moves in')
        self.assertEqual(res['reduced']['running'], 0, 'and does not move when motion is reduced')
        fr = res['framed']
        self.assertEqual(fr['errors'], [])
        self.assertTrue(fr['want']['places'] and all(set(p) == {'key', 'lat', 'lon'} for p in fr['want']['places']))
        self.assertEqual(len(fr['near']['items']), 2, 'unknown keys in the answer are dropped')
        self.assertTrue(all('about 1.5 km' in x for x in fr['near']['items']))
        self.assertEqual((fr['share']['kind'], fr['share']['title']), ('place', "St Example's Church"))
        self.assertTrue(fr['share']['url'].startswith('https://'))
        self.assertEqual((fr['toast'], fr['day']), ('Link copied.', True))

    # ------------------------------------------------------------ Taste & Shop, awards, the Gallery (7 November 2026)
    def test_taste_and_shop(self):
        day1 = find(self.root, 'article', id='day-1')[0]
        ts = find(day1, 'section', 'tasteshop')[0]
        self.assertEqual([c.attrs['class'].split()[1] for c in find(ts, 'div', 'ts-col')], ['ts-taste', 'ts-shop'])
        self.assertTrue(find(ts, 'p', 'ts-hours'))
        self.assertTrue(all(find(a, 'a', 'pl') for a in find(ts, 'article', 'alt')), 'every Taste & Shop place opens its panel')
        sec = find(self.root, 'section', id='taste_shop')[0]
        for label in ('Taste here', 'Sweet & snack stops', 'Markets on your day', 'Shopping', 'Bring home'):
            self.assertIn(label, sec.text())
        self.assertTrue(find(sec, 'article', 'taste'))
        self.assertTrue(find(sec, 'table'), 'the trading-hours table')
        self.assertIn('Taste &amp; Shop', self.html.split('class="topnav"', 1)[1].split('</nav>', 1)[0])
        self.assertEqual({b.attrs['data-near-me'] for b in find(self.root, 'button', 'near-me') if b.attrs.get('data-near-me')}, {'food', 'shopping'})
        d = copy.deepcopy(self.data)
        d['taste_shop']['areas'][0]['signature'][0].pop('source')
        with self.assertRaisesRegex(build.KitError, 'source'):
            build.build(d)
        d = copy.deepcopy(self.data)
        d['taste_shop']['areas'][0]['area'] = 'nowhere'
        with self.assertRaises(build.KitError):
            build.build(d)

    def test_awards(self):
        lines = find(self.root, 'p', 'awards')
        self.assertTrue(lines)
        for line in lines:
            self.assertTrue(find(line, 'span', 'award'))
            self.assertTrue(find(line, 'a', 'src'), 'an award names the page that lists it')
        harbour = self.trip['panels']['p-harbour']
        self.assertEqual(harbour['awards'][0]['label'], 'Example Food Guide, one hat 2026')
        for bad in ([{'award': 'Best café'}], [{'source': 'ex_tourism'}], [{'award': 'x', 'source': 'http://example.com/'}]):
            d = copy.deepcopy(self.data)
            d['stops']['harbour']['awards'] = bad
            with self.assertRaises(build.KitError):
                build.build(d)
        self.assertNotIn('★', self.html, 'no star ratings: awards and guide listings only')

    def test_gallery_markup(self):
        g = find(self.root, 'section', id='gallery')[0]
        self.assertTrue(find(self.root, 'span', 'viewsw', role='group'))
        tiles = find(g, 'figure', 'g-tile')
        self.assertGreater(len(tiles), 8)
        shapes = {c for t in tiles for c in t.classes() if c in ('g-wide', 'g-port', 'g-sq', 'g-tall')}
        self.assertTrue({'g-wide', 'g-port', 'g-tall'} <= shapes, 'the mix of shapes from the reference')
        for t in tiles:
            self.assertTrue(find(t, 'a', 'pl'), 'every tile names its place and opens its panel')
            if find(t, 'img'):
                self.assertTrue(find(t, 'span', 'credit'), 'every picture keeps its credit')
        self.assertEqual(find(g, 'iframe'), [], 'no post loads until it is tapped')
        embeds = {t.attrs.get('data-kind'): t.attrs.get('data-embed') for t in tiles if 'g-social' in t.classes()}
        self.assertEqual(embeds['tiktok'], 'https://www.tiktok.com/embed/v2/7300000000000000001')
        self.assertIn(embeds['instagram'], ('https://www.instagram.com/p/C0ExampleBay1/embed/captioned/', 'https://www.instagram.com/reel/C0ExampleReel/embed/captioned/'))
        for t in tiles:
            if t.attrs.get('data-kind') in ('instagram', 'tiktok'):
                o = find(t, 'a', 'g-orig')
                self.assertEqual(len(o), 1, 'a playing post keeps a way out to the post itself')
                self.assertTrue(re.match(r'^https://www\.(instagram|tiktok)\.com/', o[0].attrs.get('href', '')))
                self.assertEqual(o[0].attrs.get('target'), '_blank')
        fb = [t for t in tiles if t.attrs.get('data-kind') == 'facebook'][0]
        self.assertEqual(find(fb, 'a', 'g-play')[0].attrs.get('target'), '_blank', 'Facebook is a link only')
        for bad in ({'kind': 'instagram', 'url': 'https://www.instagram.com/examplebay/', 'by': 'x'},
                    {'kind': 'tiktok', 'url': 'https://www.tiktok.com/@x/photo/123456789', 'by': 'x'},
                    {'kind': 'youtube', 'url': 'https://www.youtube.com/watch?v=x', 'by': 'x'},
                    {'kind': 'instagram', 'url': 'https://www.instagram.com/p/C0ExampleBay1/', 'by': 'bad handle!'}):
            d = copy.deepcopy(self.data)
            d['stops']['lighthouse']['social'] = [bad]
            with self.assertRaises(build.KitError):
                build.build(d)
        # a post curated for a weather-plan stop still reaches the Gallery, once, marked with its plan
        d = copy.deepcopy(self.data)
        d['stops']['tearoom']['social'] = [{'kind': 'tiktok', 'url': 'https://www.tiktok.com/@examplebay/video/7300000000000000009', 'by': 'examplebay'}]
        r = build.parse_html(build.build(d))
        pt = [t for t in find(find(r, 'section', id='gallery')[0], 'figure', 'g-tile') if 'tiktok.com/embed/v2/7300000000000000009' in t.attrs.get('data-embed', '')]
        self.assertEqual(len(pt), 1, 'one tile though the stop is in Plan B and Plan C')
        self.assertIn('Plan B', find(pt[0], 'span', 'g-k')[0].text())
        js = re.sub(r'\s+', '', open(os.path.join(HERE, 'assets', 'kit.js'), encoding='utf-8').read())
        self.assertIn(r"varEMBED_OK=/^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]{5,40}\/embed\/captioned\/$|^https:\/\/www\.tiktok\.com\/embed\/v2\/[0-9]{8,25}$/;", js)
        css = re.sub(r'\s+', '', open(os.path.join(HERE, 'assets', 'kit.css'), encoding='utf-8').read())
        self.assertIn('html[data-view=gallery]main.layout>:not(#gallery){display:none}', css)

    def test_gallery_shows_each_picture_and_post_once_a_day(self):
        # the owner, 7 November 2026: the same photo three times, from three Facebook links of one account
        d = copy.deepcopy(self.data)
        lh = d['stops']['lighthouse']
        lh['social'] = [{'kind': 'facebook', 'url': f'https://www.facebook.com/examplebaytourism/posts/{i}', 'by': 'examplebaytourism'} for i in (7, 8, 9)]
        lh['social'] += [{'kind': 'tiktok', 'url': 'https://www.tiktok.com/@examplebay/video/7300000000000000005', 'by': 'examplebay'}] * 2
        r = build.parse_html(build.build(d))
        for day in find(find(r, 'section', id='gallery')[0], 'div', 'g-day'):
            tiles = find(day, 'figure', 'g-tile')
            srcs = [find(t, 'img')[0].attrs['src'] for t in tiles if find(t, 'img')]
            self.assertEqual(len(srcs), len(set(srcs)), f'{day.attrs["id"]}: a picture shows once')
            fbs = [find(t, 'a', 'g-fb')[0].attrs['href'] for t in tiles if t.attrs.get('data-kind') == 'facebook']
            self.assertLessEqual(len([u for u in fbs if '/examplebaytourism/' in u]), 1, f'{day.attrs["id"]}: one Facebook tile per account')
            embeds = [t.attrs['data-embed'] for t in tiles if t.attrs.get('data-embed')]
            self.assertEqual(len(embeds), len(set(embeds)), f'{day.attrs["id"]}: a post shows once')

    def test_section_links(self):
        # the owner, 7 November 2026: "every section of the page have a HTML hyperlink #hashtag that I can share"
        main = find(self.root, 'main')[0]
        secs = [s for s in find(main, 'section', 'sec') if s.attrs.get('id') and find(s, 'h2')]
        self.assertGreater(len(secs), 6)
        parts = [(s.attrs['id'], find(s, 'h2')[0]) for s in secs]
        parts += [(a.attrs['id'], find(a, 'h3')[0]) for a in find(main, 'article', 'day')]
        parts += [(g.attrs['id'], find(g, 'h3')[0]) for g in find(main, 'div', 'g-day')]
        parts.append(('gallery', find(find(main, 'section', id='gallery')[0], 'h2')[0]))
        self.assertIn('day-1', [p for p, _ in parts])
        for pid, h in parts:
            links = find(h, 'a', 'sec-link')
            self.assertEqual(len(links), 1, pid)
            a = links[0]
            self.assertEqual((a.attrs.get('href'), a.attrs.get('data-sec-link')), ('#' + pid, pid), pid)
            self.assertEqual(a.text().strip(), '', f'{pid}: the # is drawn by the style sheet, so the heading reads the same in the contents list')
            self.assertTrue(a.attrs.get('aria-label'), pid)
        ids = [n.attrs['id'] for n in self.root.iter() if n.attrs.get('id')]
        for _, h in parts:
            self.assertIn(find(h, 'a', 'sec-link')[0].attrs['data-sec-link'], ids)
        css = re.sub(r'\s+', '', open(os.path.join(HERE, 'assets', 'kit.css'), encoding='utf-8').read())
        self.assertIn('.sec-link::before{content:"#"}', css)
        self.assertIn('@mediaprint{.sec-link{display:none!important}}', css)
        with self.assertRaises(build.KitError):
            build.Page(copy.deepcopy(self.data)).sec_link('1 bad"id')

    @unittest.skipUnless(BROWSER, 'needs node and Playwright')
    def test_gallery_in_a_browser(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, 'page.html')
            with open(page, 'w', encoding='utf-8') as f:
                f.write(self.html)
            script = os.path.join(tmp, 'gallery.cjs')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(GALLERY_JS)
            out = subprocess.run([NODE, script, page], capture_output=True, text=True, timeout=180,
                                 env=dict(os.environ, NODE_PATH=PLAYWRIGHT_PATH))
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            res = json.loads(out.stdout)
        for k, r in res.items():
            self.assertEqual(r['errors'], [], k)
            self.assertEqual((r['view'], r['shown'], r['overview'], r['frames'], r['wide'], r['pressed']), ('gallery', 'block', 'none', 0, False, 'true'), k)
            self.assertEqual(r['before'], 0, f'{k}: no post is fetched before a tap')
            self.assertEqual(len(r['live']), 2, k)
            self.assertIn('https://www.tiktok.com/embed/v2/7300000000000000001', r['live'], k)
            self.assertTrue(any(u in r['live'] for u in ('https://www.instagram.com/p/C0ExampleBay1/embed/captioned/',
                                                          'https://www.instagram.com/reel/C0ExampleReel/embed/captioned/')), k)
            self.assertEqual(r['back'], {'view': None, 'overview': 'block'}, k)
            self.assertEqual(sorted(set(r['orig'])), ['idle none', 'live flex'] if len(r['orig']) > 2 else ['live flex'], k)
            h = r['hashed']
            self.assertEqual(h['view'], 'gallery', f'{k}: #g-day-1 opens the Gallery')
            self.assertLess(abs(h['top']), 120, f'{k}: at that day')
            self.assertIsNone(h['after'], f'{k}: #day-2 goes back to reading')
            self.assertEqual(h['clicked'], '#days', k)
            self.assertTrue(h['links'], k)
            for lid, width, inside in h['links']:
                self.assertGreaterEqual(width, 32, f'{k}: {lid} is big enough to tap')
                self.assertTrue(inside, f'{k}: {lid} stays on the screen')


    # ------------------------------------------------------------ the calendar (7 November 2026)
    def test_calendar_times(self):
        cases = {'09:15': (555, 585), '10:15 to 11:30': (615, 690), '11:25 → 16:35': (685, 995), 'Around 18:30': (1110, 1140),
                 'From 14:00': (840, 870), 'By 15:00': (870, 900), '22:00 to 01:00': (1320, 1500)}
        for t, want in cases.items():
            self.assertEqual(build.clock_span(t), want, t)
        for t in ('Morning', 'Late afternoon', 'Midway', '', None, '25:00', 'By 00:00'):
            self.assertIsNone(build.clock_span(t), t)
        self.assertEqual(build.tz_offset('UTC+8'), '+0800')
        self.assertEqual(build.tz_offset('UTC-5:30'), '-0530')
        self.assertEqual(build.tz_offset('UTC+0'), '+0000')
        for bad in ('GMT+8', 'UTC+15', 'Perth', None):
            self.assertIsNone(build.tz_offset(bad), bad)

    def test_calendar_markup(self):
        sec = find(self.root, 'section', id='calendar')
        self.assertEqual(len(sec), 1)
        self.assertTrue(find(self.root, 'a', href='#calendar'), 'the top bar links to the calendar')
        cols = find(sec[0], 'section', 'cal-day')
        self.assertEqual(len(cols), len(self.data['days']), 'one column per day')
        timed = [t for d in self.data['days'] for t in d.get('timeline') or [] if build.clock_span(t.get('time'))]
        adds = find(sec[0], 'a', 'cal-add-one')
        self.assertEqual(len(adds), len(timed), 'an Add for every timed item')
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(adds[0].attrs['href']).query)
        first = self.data['days'][0]
        a, b = build.clock_span(first['timeline'][0]['time'])
        ymd = first['iso'].replace('-', '')
        self.assertEqual(q['tz'], [build.tz_offset(self.data['meta']['tz'])])
        self.assertEqual(q['s0'], [f'{ymd}T{a // 60:02d}{a % 60:02d}'])
        self.assertEqual(q['e0'], [f'{ymd}T{b // 60:02d}{b % 60:02d}'])
        self.assertIn(self.data['meta']['status'], q['n0'][0], 'each event says the trip is not booked')
        for a_ in find(sec[0], 'a', 'cal-add'):
            self.assertTrue(a_.attrs['href'].startswith('/calendar.ics?'))
            self.assertEqual(a_.attrs.get('target'), '_blank')
            self.assertTrue(a_.attrs.get('aria-label', '').startswith('Add '))
        days = find(sec[0], 'a', 'cal-add-day')
        self.assertEqual(len(days), len(cols))
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(days[0].attrs['href']).query)
        n = sum(1 for t in first['timeline'] if build.clock_span(t.get('time')))
        self.assertIn(f't{n - 1}', q)
        self.assertNotIn(f't{n}', q)
        # An item with no set time is drawn in its place, dashed, and never added.
        d = copy.deepcopy(self.data)
        d['days'][0]['timeline'][1]['time'] = 'Morning'
        r = build.parse_html(build.build(d))
        loose = find(r, 'article', 'cal-loose')
        self.assertEqual(len(loose), 1)
        self.assertEqual(find(loose[0], 'a', 'cal-add'), [])
        # No time zone, or no timed item: no calendar.
        d = copy.deepcopy(self.data)
        d['meta'].pop('tz', None)
        self.assertNotIn('id="calendar"', build.build(d))
        d = copy.deepcopy(self.data)
        for day in d['days']:
            for t in day.get('timeline') or []:
                t['time'] = 'Morning'
        self.assertNotIn('id="calendar"', build.build(d))

    @unittest.skipUnless(BROWSER, 'needs node and Playwright')
    def test_calendar_in_a_browser(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, 'page.html')
            with open(page, 'w', encoding='utf-8') as f:
                f.write(self.html)
            script = os.path.join(tmp, 'cal.cjs')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(CAL_JS)
            out = subprocess.run([NODE, script, page], capture_output=True, text=True, timeout=180,
                                 env=dict(os.environ, NODE_PATH=PLAYWRIGHT_PATH))
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            res = json.loads(out.stdout)
        for k, r in res.items():
            self.assertEqual(r['errors'], [], k)
            self.assertFalse(r['wide'], f'{k}: the page never scrolls sideways')
            self.assertTrue(r['scrolls'] if k == 'phone' else True, f'{k}: the days scroll sideways inside the calendar')
            self.assertEqual((r['off'], r['adds']), (True, 'none'), f'{k}: away from the family site, a note and no Add buttons')
            self.assertGreater(r['cards'], 0, k)
            self.assertEqual(r['overlap'], 0, f'{k}: cards never cover each other')

    @unittest.skipUnless(BROWSER, 'needs node and Playwright')
    def test_tour_tells_the_site(self):
        """Inside the family site's frame, the tour says when it opens and closes (7 November 2026), so the
        site can fold its own buttons away while it plays."""
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, 'page.html')
            with open(page, 'w', encoding='utf-8') as f:
                f.write(self.html)
            with open(os.path.join(tmp, 'host.html'), 'w', encoding='utf-8') as f:
                f.write('<!doctype html><script>window.__msgs=[];addEventListener("message",function(e){window.__msgs.push(e.data);});</script>'
                        '<iframe src="page.html" style="width:1000px;height:800px"></iframe>')
            script = os.path.join(tmp, 'tour.cjs')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(TOUR_JS)
            out = subprocess.run([NODE, script, os.path.join(tmp, 'host.html')], capture_output=True, text=True, timeout=180,
                                 env=dict(os.environ, NODE_PATH=PLAYWRIGHT_PATH))
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            msgs = json.loads(out.stdout)
        tours = [m for m in msgs if isinstance(m, dict) and m.get('type') == 'hj:tour']
        self.assertEqual(tours, [{'type': 'hj:tour', 'open': True}, {'type': 'hj:tour', 'open': False}])

if __name__ == '__main__':
    unittest.main(verbosity=1)
