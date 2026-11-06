#!/usr/bin/env python3
"""Tests for the travel coffee-table kit (standard library only):  python3 kit/test_kit.py"""
import copy
import datetime
import io
import json
import os
import re
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
    return outside(n, lambda p: p.attrs.get('id') == 'lightbox')


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

    def test_days_without_alternatives(self):
        d = copy.deepcopy(self.data)
        for day in d['days']:
            day['plan_b'], day['plan_c'] = [], []
        r = build.parse_html(build.build(d))
        self.assertFalse(find(r, 'button', 'plan-btn'))
        self.assertEqual(len(find(r, 'p', 'plan-missing')), len(d['days']))
        self.assertTrue(find(r, 'p', 'wx-rules'), 'the rules still show')

    def test_json_block_cannot_close_the_script(self):
        d = copy.deepcopy(self.data)
        d['days'][0]['title'] = '</script><script>alert(1)</script>'
        html = build.build(d)
        block = html.split('id="trip-data">', 1)[1].split('</script>', 1)[0]
        self.assertNotIn('<', block)
        self.assertEqual(json.loads(block)['days'][0]['title'], d['days'][0]['title'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
