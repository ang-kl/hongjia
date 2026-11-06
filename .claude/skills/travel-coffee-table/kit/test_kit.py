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
        # The family site's locked frame sends no Referer, which OpenStreetMap's tile servers require;
        # pages for the site use CARTO with the family's key, and --check flags OpenStreetMap tiles.
        data = json.loads(re.search(r'<script type="application/json" id="trip-data">(.*?)</script>', self.html, re.S).group(1))
        self.assertEqual(data['tiles'], {'provider': 'carto', 'url': 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=example-key'})
        self.assertIn('carto.com/attributions', self.html)
        def refused(tiles):
            d = copy.deepcopy(self.data)
            d['map']['tiles'] = tiles
            with self.assertRaises(build.KitError):
                build.build(d)
        refused({'provider': 'carto'})
        refused({'provider': 'carto', 'key': 'a"><script>'})
        refused({'provider': 'carto', 'key': 'abcd', 'style': 'neon'})
        refused({'provider': 'mapbox', 'key': 'abcd'})
        osm = copy.deepcopy(self.data)
        osm['map'].pop('tiles')
        problems = build.check_html(build.build(osm))
        self.assertIn('map blocked in the family site', [rule for rule, _ in problems])

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


if __name__ == '__main__':
    unittest.main(verbosity=1)
