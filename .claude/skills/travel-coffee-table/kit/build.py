#!/usr/bin/env python3
"""Travel coffee-table page kit.

Turns one trip data file (JSON, described in schema.md) into one self-contained HTML page, and
checks finished pages against the owner's rules.

    python3 build.py trip.json -o trip.html        render one page
    python3 build.py --check trip.html [more ...]  check pages (a .json is rendered, then checked)

Python 3 standard library only. Every value from the data file is escaped when it is written into
the page; inline markup in text fields is limited to the tokens listed in schema.md. The page's
script builds its DOM with textContent and never uses innerHTML.
"""
import argparse
import datetime
import json
import math
import os
import re
import sys
import urllib.parse
from html import escape, unescape
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')

LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
EMOJI = {'web': '🌐', 'tel': '📞', 'mail': '✉️', 'book': '🎟️', 'ig': '📸', 'fb': '📘', 'tt': '🎵', 'yt': '▶️',
         'x': '✖️', 'map': '📍', 'earth': '🌏', 'tag': '#️⃣', 'tts': '🎬'}
LINK_LABELS = {'web': 'Website', 'tel': 'Phone', 'mail': 'Email', 'book': 'Book', 'ig': 'Instagram', 'fb': 'Facebook',
               'tt': 'TikTok', 'yt': 'YouTube', 'x': 'X'}
SCRIPT_HOSTS = ('cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com')
PLACE_KEY = re.compile(r'^[a-z0-9][a-z0-9-]{0,29}$')
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
HANDLE = re.compile(r'^[A-Za-z0-9._-]{1,60}$')
DATE = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
MAX_WEATHER_PLACES = 12
MAX_SPAN_DAYS = 60
FORECAST_LEAD_DAYS = 15  # Open-Meteo forecasts 16 days, today included
METRICS = ('code', 'tmax', 'tmin', 'rain_pct', 'rain_mm', 'wind_kmh', 'gust_kmh', 'uv')
OPS = ('>=', '>', '<=', '<', 'in')
PLANS = ('a', 'b', 'c')
# Map tiles. OpenStreetMap's own tile servers refuse requests without a Referer, and a page in the
# family site's locked frame (an opaque origin) never sends one. So by default ("site") the page asks
# the family site for a short-lived ticket and loads OpenStreetMap tiles through the site's relay
# (TILES_WANT / TILES_ANSWER in kit.js); opened anywhere else it keeps its routes and pins on a plain
# background with a notice, and contacts no tile server. "carto" (CARTO's raster basemaps with the
# family's free, revocable key, kept in the private trip file) still works; "osm" (OpenStreetMap
# directly) is accepted but --check reports it, as it is blocked inside the site.
TILE_PROVIDERS = ('site', 'carto', 'osm')
CARTO_STYLES = ('voyager', 'light_all')
TILE_KEY = re.compile(r'^[A-Za-z0-9._-]{4,200}$')


SECTION_ORDER = ['overview', 'audience', 'plans', 'map', 'days', 'concierge', 'holidays', 'stays', 'transport',
                 'backups', 'checklist', 'upgrades', 'credits', 'sources']
PROSE = ('overview', 'holidays', 'stays', 'transport', 'backups', 'checklist')
NAV_DEFAULT = {'overview': 'Overview', 'audience': 'Who', 'plans': 'Plans & weather', 'map': 'Map', 'days': 'Days',
               'concierge': 'Concierge', 'holidays': 'Holidays', 'stays': 'Stays', 'transport': 'Transport',
               'backups': 'Backups', 'checklist': 'Checklist', 'upgrades': 'Upgrades', 'credits': 'Credits',
               'sources': 'Sources'}

# Suitability marks a stop can carry: mark -> (icon, {value: (level, label)}). Levels: good, mixed, poor.
MARKS = {
    'step_free': ('♿', {'yes': ('good', 'Step-free'), 'partial': ('mixed', 'Partly step-free'), 'no': ('poor', 'Not step-free')}),
    'walking': ('🚶', {'short': ('good', 'Short walks'), 'moderate': ('mixed', 'Some walking'), 'long': ('poor', 'Long walks')}),
    'shade': ('⛱️', {'yes': ('good', 'Shade'), 'some': ('mixed', 'Some shade'), 'no': ('poor', 'Little shade')}),
    'seating': ('🪑', {'yes': ('good', 'Seating'), 'some': ('mixed', 'Some seating'), 'no': ('poor', 'Few seats')}),
    'toilets': ('🚻', {'yes': ('good', 'Toilets'), 'nearby': ('mixed', 'Toilets nearby'), 'no': ('poor', 'No toilets')}),
    'kids': ('🧒', {'yes': ('good', 'Good with children'), 'some': ('mixed', 'Some for children'), 'no': ('poor', 'Not for small children')}),
    'seniors': ('🧓', {'yes': ('good', 'Easy for seniors'), 'some': ('mixed', 'Fine with care'), 'no': ('poor', 'Hard going for seniors')}),
}
MARK_NAMES = {'step_free': 'step-free', 'walking': 'walking', 'shade': 'shade', 'seating': 'seating', 'toilets': 'toilets',
              'kids': 'children', 'seniors': 'seniors'}

# WMO weather codes -> (icon, label), for the live forecast strip.
WMO = {0: ('☀️', 'Clear'), 1: ('🌤️', 'Mainly clear'), 2: ('⛅', 'Partly cloudy'), 3: ('☁️', 'Overcast'), 45: ('🌫️', 'Fog'),
       48: ('🌫️', 'Freezing fog'), 51: ('🌦️', 'Light drizzle'), 53: ('🌦️', 'Drizzle'), 55: ('🌧️', 'Heavy drizzle'),
       56: ('🌧️', 'Freezing drizzle'), 57: ('🌧️', 'Freezing drizzle'), 61: ('🌦️', 'Light rain'), 63: ('🌧️', 'Rain'),
       65: ('🌧️', 'Heavy rain'), 66: ('🌧️', 'Freezing rain'), 67: ('🌧️', 'Freezing rain'), 71: ('🌨️', 'Light snow'),
       73: ('🌨️', 'Snow'), 75: ('❄️', 'Heavy snow'), 77: ('🌨️', 'Snow grains'), 80: ('🌦️', 'Showers'), 81: ('🌧️', 'Showers'),
       82: ('⛈️', 'Violent showers'), 85: ('🌨️', 'Snow showers'), 86: ('🌨️', 'Snow showers'), 95: ('⛈️', 'Thunderstorm'),
       96: ('⛈️', 'Thunderstorm with hail'), 99: ('⛈️', 'Thunderstorm with hail')}
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

# Every visible string the kit itself writes. A data file may override any of them in "labels".
LABELS = {
    'skip': 'Skip to the day plans', 'trip_facts': 'Trip facts', 'display_mode': 'Display mode', 'mode_light': 'Light',
    'mode_print': 'Print', 'print_pdf': 'Print / save PDF', 'nav': 'Sections and days', 'nav_days': 'Days', 'day': 'Day',
    'show_on_map': 'Show on map', 'stops_for_day': 'Stops for day {n}', 'links': 'Links', 'google_maps': 'Google Maps',
    'google_earth': 'Google Earth', 'earth_3d': '3D', 'ig_photos': 'Instagram photos', 'tiktok_videos': 'TikTok videos',
    'tiktok_search': 'search',
    'links_note': "Accounts shown are the ones the venue or its tourism body links from its own website; #tags and searches show other people's posts.",
    'details': 'Details', 'prompts3': 'Three photo prompts', 'prompts': 'Photo prompts', 'map_drawer': 'Map drawer: Google pin',
    'pin_search': 'Pin search: "{q}". Coordinates {lat}, {lng} ({note})', 'concierge_drawer': 'Concierge: {name}',
    'full_panel': 'Full {name} panel', 'latest_posts': 'Latest posts',
    'embed_note': "Live from the official accounts; Instagram and TikTok see your device's internet address when this opens.",
    'ig_latest': 'Latest Instagram posts from @{h}', 'tt_latest': 'Latest TikTok videos from @{h}',
    'enlarge': 'Enlarge photo: {alt}', 'photo': 'Photo', 'original': 'original', 'image_url': 'Image URL', 'licensed': 'licensed',
    'by': 'by', 'nearby_kicker': 'More nearby · optional extras, not in the timings', 'nearby_aria': 'More nearby, optional, day {n}',
    'rail': 'Timeline: drag or tap to move through the trip', 'rail_start': 'Start of the guide', 'lightbox': 'Photo viewer',
    'lb_close': 'Close photo viewer', 'lb_prev': 'Previous photo', 'lb_next': 'Next photo', 'emergency_numbers': 'Emergency numbers',
    'areas': 'Areas', 'back_to_top': 'Back to top ↑', 'map_aria': 'Map command centre', 'map_kicker': 'Map command centre',
    'day_label': 'Day', 'choose_day': 'Choose a day', 'map_views': 'Map views', 'tab_route': 'Route plotter', 'tab_pin': 'Google pin',
    'tab_dir': 'Leg directions', 'fly': 'Fly route', 'fly_stop': 'Stop', 'safety': 'Hospitals & police', 'route_map': 'Route map',
    'stop_label': 'Stop', 'choose_stop': 'Choose a stop', 'leg_label': 'Leg', 'choose_leg': 'Choose a leg',
    'map_note_route': 'Lines follow the route data in this guide; dashed lines are short walks. Not live navigation.',
    'map_note_pin': "Google Maps searches the stop's name and address. Check the returned pin before travelling.",
    'map_note_dir': 'Google directions for one leg. A navigation aid, not proof of road time.',
    'map_fallback': 'The route map could not load here. The Google pin and directions tabs still work.',
    'tiles_notice': 'Map pictures load inside the family site.',
    'short_walk': 'short walk', 'optional': 'optional', 'to': 'to',
    'plan_a': 'As planned', 'plan_b': 'If it rains', 'plan_c': 'Heat, wind or storm', 'plan': 'Plan {p}',
    'plans_for_day': 'Plans for day {n}', 'choose_plan': 'Choose a plan', 'chosen': 'Chosen', 'suggested': 'Forecast suggests',
    'plans_missing': 'Plan B (rain) and Plan C (heat, wind or storm) are not listed for this day yet.',
    'plans_rules': 'Rules', 'replaces': 'Replaces', 'plan_for_day': 'Plan {p} for day {n}: {label}',
    'wx_from': 'Forecast from {date}', 'wx_error': 'No forecast just now: {error}', 'wx_past': 'This day is over; no forecast.',
    'wx_none': 'No forecast for this day.', 'wx_frame': 'The live forecast shows when this page is opened on the family site.',
    'wx_credit': 'Weather data by', 'wx_licence': 'CC BY 4.0', 'wx_rain': 'rain', 'wx_gust': 'gusts', 'wx_wind': 'wind', 'wx_uv': 'UV',
    'wx_suggests': 'Suggests Plan {p}: {why}', 'wx_fits': 'Fits Plan A', 'wx_no_plan': 'Suggests Plan {p} ({why}); none is listed for this day yet.',
    'wx_max_min': 'max {max}° / min {min}°',
    'lens_all': 'All travellers', 'lens_choose': 'Choose a kind of traveller', 'lens_fits': 'fits', 'lens_check': 'check',
    'lens_unknown': 'not checked', 'lens_for': 'For {label}', 'party_for': 'For this group', 'suits_aria': 'Suitability',
    'lens_note': 'Choosing a kind of traveller only changes what this page highlights. Nothing is hidden and nothing is sent.',
    'lens_looks_for': 'Looks for', 'party_needs': 'What matters most to this group',
    'upg_tag': 'Optional upgrade', 'upg_price': 'Indicative price', 'upg_book': 'Book ahead', 'upg_source': 'Source',
    'upg_note': 'Optional. Each upgrade sits beside the plan and never replaces it. Prices are indicative, not quotes.',
    'carried_summary': 'Links carried over from the earlier version',
}

# Legend categories, in the owner's order: (key, icon, label). A stop or nearby place may carry several.
CATS = [('stays', '🏨', 'Stays'), ('transport', '🚗', 'Transport'), ('weather', '🌦️', 'Weather'), ('food', '🍽️', 'Food'),
        ('drinks', '☕', 'Drinks'), ('snacks', '🍫', 'Snacks'), ('shopping', '🛍️', 'Shopping'), ('fun', '🎡', 'Fun'),
        ('sights', '🏛️', 'Sights'), ('worship', '⛪', 'Worship')]
CAT_KEYS = [c[0] for c in CATS]
CAT_ALIASES = {'dining': 'food'}  # the first legend had one Dining category
# Official social links must point at the platform itself.
SOCIAL_HOSTS = {'ig': 'instagram.com', 'fb': 'facebook.com', 'tt': 'tiktok.com', 'yt': 'youtube.com'}
PHONE_TEXT = re.compile(r'\+?[\d(][\d\s().-]{4,}')  # a phone number as people write it
TZ_NAME = re.compile(r'^[A-Za-z]+(?:/[A-Za-z0-9_+-]+){1,2}$|^UTC$')
EMOJI.update({'ig': '📷', 'addr': '📍', 'hours': '⏰'})
LINK_LABELS.update({'addr': 'Address', 'hours': 'Hours'})
LABELS.update({
    'call': 'Call', 'hours': 'Hours',
    'op_play': 'Play the trip', 'op_read': 'Start reading', 'op_tldr': 'The trip at a glance', 'op_stays': "Where you'll stay",
    'op_highlights': "Can't-miss", 'op_alerts': 'Good to know', 'op_globe': 'Globe: the way there, and the bases',
    'op_globe_hint': 'Drag to turn the globe.', 'op_time': 'Local time', 'website': 'Website',
    'cd_to_go': '{n} days to go', 'cd_one': '1 day to go', 'cd_today': 'Today is the day', 'cd_during': 'Day {d} of {n}',
    'local_time': '{time} in {place}',
    'legend': 'Legend: tap to light up places on the page and the map', 'lg_lit': '{n} lit: {label}', 'lg_none': 'Nothing marked {label} yet',
    'lg_next': 'Next ↓', 'lg_clear': 'Clear', 'map_legend': 'Light up on the map',
    'alts': "If it's closed or crowded", 'alts_aria': "If it's closed or crowded: near {name}", 'alt_map': 'Show on map',
    'nearby_pins': 'Nearby options', 'worship_title': 'Places of worship near your stays', 'worship_kicker': 'Worship',
    'ig_drawer': 'Instagram: @{h}', 'ig_profile': 'Instagram profile of @{h}', 'stop_details': 'Details below',
    'tour': 'Play the trip', 'tour_pause': 'Pause', 'tour_play': 'Play', 'tour_next': 'Next', 'tour_prev': 'Back',
    'tour_close': 'Close the tour', 'tour_from': 'From {home} to {dest}', 'tour_way': 'The way there',
    'globe_credit': 'Globe: land outlines from Natural Earth (public domain), 1:110m, via world-atlas 2.0.2 (ISC licence).',
    # place panels, meals, photo spots, Share and Near me (6 November 2026)
    'sheet_close': 'Close', 'sheet_aria': 'Place details', 'photo_spot': 'Photo spot', 'planned': 'Planned',
    'meals': 'Meals', 'meals_aria': 'Meals for day {n}', 'meal_choices': '{n} choices',
    'meal_breakfast': 'Breakfast', 'meal_brunch': 'Brunch', 'meal_lunch': 'Lunch', 'meal_dinner': 'Dinner', 'meal_snack': 'Snack',
    'share': 'Share', 'share_day': 'Share this day', 'shared': 'Shared.', 'copied': 'Link copied.',
    'near_me': 'Near me', 'near_title': 'Nearest to you', 'near_wait': 'Waiting for your answer…',
    'near_note': 'Straight-line distances, to the nearest half kilometre. Your location stays on your device.',
    'near_declined': 'Nothing was shared.', 'near_denied': 'Location is turned off for this page in your browser settings.',
    'near_unavailable': 'Your device could not find a location just now.', 'near_unsupported': 'This browser cannot give a location.',
    'near_none': 'No places with a map pin yet.', 'about_km': 'about {km} km', 'new_tab': 'opens a new tab',
    'ig_posts': 'Latest posts from @{h} on Instagram', 'address': 'Address',
})
MEALS = ('breakfast', 'brunch', 'lunch', 'dinner', 'snack')
MEAL_ICONS = {'breakfast': '🍳', 'brunch': '🥐', 'lunch': '🍽️', 'dinner': '🌙', 'snack': '🍰'}
IG_URL = re.compile(r'^https://(?:www\.)?instagram\.com/([A-Za-z0-9._]{1,30})/?$')


def norm_cats(v, where):
    """A stop's categories: one key or a list; "dining" is read as "food"."""
    if v in (None, '', []):
        return []
    out = []
    for c in (v if isinstance(v, list) else [v]):
        c = CAT_ALIASES.get(c, c)
        if c not in CAT_KEYS:
            raise KitError(f'{where}: cat must be one of {", ".join(CAT_KEYS)} (got {c!r})')
        if c not in out:
            out.append(c)
    return out


_GLOBE = None


def globe_data():
    """Natural Earth 1:110m land (world-atlas TopoJSON, shipped in assets): simplified coastlines and a
    dotted land fill, worked out once at build time so the page needs no fetch. Tenths of a degree."""
    global _GLOBE
    if _GLOBE is not None:
        return _GLOBE
    with open(os.path.join(ASSETS, 'land-110m.json'), encoding='utf-8') as f:
        topo = json.load(f)
    (sx, sy), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for a in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in a:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    rings = []
    for g in topo['objects']['land']['geometries']:
        for poly in (g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]):
            for ring in poly:
                pts = []
                for i in ring:
                    a = arcs[i] if i >= 0 else arcs[~i][::-1]
                    pts.extend(a if not pts else a[1:])
                rings.append(pts)
    boxes = [(min(p[0] for p in r), max(p[0] for p in r), min(p[1] for p in r), max(p[1] for p in r)) for r in rings]

    def land(lon, lat):
        inside = False
        for r, (x0, x1, y0, y1) in zip(rings, boxes):
            if y0 <= lat <= y1 and x0 <= lon <= x1:
                for (xa, ya), (xb, yb) in zip(r, r[1:]):
                    if (ya > lat) != (yb > lat) and lon < xa + (lat - ya) * (xb - xa) / (yb - ya):
                        inside = not inside
        return inside

    dots, step, lat = [], 2.4, -84.0
    while lat <= 84:
        dlon = step / max(0.2, math.cos(math.radians(lat)))
        lon = -180 + dlon / 2
        while lon < 180:
            if land(lon, lat):
                dots += [round(lon * 10), round(lat * 10)]
            lon += dlon
        lat += step
    coast = []
    for a in arcs:
        keep = [a[0]] + [p for p in a[1:-1]] + [a[-1]]
        kept = [keep[0]]
        for p in keep[1:-1]:
            if abs(p[0] - kept[-1][0]) + abs(p[1] - kept[-1][1]) >= 0.45:
                kept.append(p)
        kept.append(keep[-1])
        q = [(round(x * 10), round(y * 10)) for x, y in kept]
        flat = [q[0][0], q[0][1]]
        for (x0, y0), (x1, y1) in zip(q, q[1:]):
            flat += [x1 - x0, y1 - y0]
        coast.append(flat)
    _GLOBE = {'c': coast, 'd': dots}
    return _GLOBE


class KitError(Exception):
    pass


def E(s):
    return escape('' if s is None else str(s), quote=True)


def host_of(url):
    try:
        return urllib.parse.urlsplit(url).hostname or ''
    except ValueError:
        return ''


def check_url(url, where, allow=('https',)):
    """Links must be https (or tel:, mailto:, an in-page #anchor where allowed). Raises KitError."""
    if not isinstance(url, str) or not url:
        raise KitError(f'{where}: missing link')
    if url.startswith('#') and '#' in allow:
        return url
    scheme = url.split(':', 1)[0].lower() if ':' in url else ''
    if scheme not in allow:
        raise KitError(f'{where}: link must be {" or ".join(a + ":" if a != "#" else "#anchor" for a in allow)} ({url[:80]})')
    if scheme == 'https' and not host_of(url):
        raise KitError(f'{where}: link has no host ({url[:80]})')
    return url


def check_image(src, where):
    if isinstance(src, str) and src.startswith('data:image/'):
        return src
    return check_url(src, where)


def parse_date(s, where):
    if not isinstance(s, str) or not DATE.match(s):
        raise KitError(f'{where}: date must be YYYY-MM-DD ({s!r})')
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        raise KitError(f'{where}: not a real date ({s})')


def human_date(d):
    return f'{d.day} {MONTHS[d.month - 1]} {d.year}'


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def safe_json(obj):
    """JSON for a <script type="application/json"> block: no '<', '>' or '&' survive as raw characters."""
    s = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    return s.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


class Page:
    def __init__(self, data):
        if not isinstance(data, dict):
            raise KitError('the data file must hold one JSON object')
        self.d = data
        self.L = dict(LABELS)
        self.L.update(data.get('labels') or {})
        self.marks = {k: (v[0], dict(v[1])) for k, v in MARKS.items()}
        for k, over in ((data.get('labels') or {}).get('marks') or {}).items():
            if k in self.marks:
                self.marks[k][1].update({v: (self.marks[k][1].get(v, ('mixed', ''))[0], lab) for v, lab in over.items()})
        self.sources = data.get('sources') or {}
        self.places = data.get('places') or {}
        self.legs = data.get('legs') or {}
        self.photos = data.get('photos') or {}
        self.stops = data.get('stops') or {}
        self.areas = data.get('areas') or {}
        self.days = data.get('days') or []
        self.plans = data.get('plans') or None
        self.weather = data.get('weather') or None
        self.audience = data.get('audience') or None
        self.tiles = (data.get('map') or {}).get('tiles') or {'provider': 'site'}
        self.opener_d = data.get('opener') or None
        self.stop_cats = {}
        self.cat_labels = {k: lab for k, _, lab in CATS}
        self.cat_labels.update({k: v for k, v in ((data.get('labels') or {}).get('cats') or {}).items() if k in self.cat_labels})
        self.cat_icons = {k: icon for k, icon, _ in CATS}
        self.panels = {}       # place panels for the page's script: pid -> facts shown in the panel
        self.place_pid = {}    # places key -> pid
        self.alt_pid = {}      # (name, lat, lng) -> pid, so an alternative shown twice opens one panel
        self.validate()
        self.collect_places()

    # ------------------------------------------------------------------ validation
    def validate_tiles(self):
        t = self.tiles
        if not isinstance(t, dict) or t.get('provider') not in TILE_PROVIDERS:
            raise KitError(f'map.tiles.provider must be one of {", ".join(TILE_PROVIDERS)}')
        if t['provider'] == 'carto':
            if not TILE_KEY.match(str(t.get('key') or '')):
                raise KitError('map.tiles.key: CARTO needs its key (letters, digits, dot, dash or underscore)')
            if (t.get('style') or 'voyager') not in CARTO_STYLES:
                raise KitError(f'map.tiles.style must be one of {", ".join(CARTO_STYLES)}')

    def tile_url(self):
        t = self.tiles
        if t['provider'] == 'carto':
            return f'https://basemaps.cartocdn.com/rastertiles/{t.get("style") or "voyager"}/{{z}}/{{x}}/{{y}}{{r}}.png?key={t["key"]}'
        if t['provider'] == 'site':
            return ''  # the site gives the address with each ticket
        return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

    def validate(self):
        d = self.d
        self.validate_tiles()
        meta = d.get('meta') or {}
        for k in ('title', 'lang'):
            if not meta.get(k):
                raise KitError(f'meta.{k} is required')
        if not (d.get('masthead') or {}).get('title'):
            raise KitError('masthead.title is required')
        for key, s in self.sources.items():
            if not s.get('label'):
                raise KitError(f'sources.{key}: label is required')
            if s.get('url'):
                check_url(s['url'], f'sources.{key}')
            if s.get('tier', 'checked') not in ('checked', 'carried'):
                raise KitError(f'sources.{key}: tier must be "checked" or "carried"')
        for key, p in self.places.items():
            for k in ('name', 'lat', 'lng', 'q'):
                if p.get(k) in (None, ''):
                    raise KitError(f'places.{key}.{k} is required')
            if not all(isinstance(p[k], (int, float)) and not isinstance(p[k], bool) for k in ('lat', 'lng')) or not (-90 <= p['lat'] <= 90 and -180 <= p['lng'] <= 180):
                raise KitError(f'places.{key}: coordinates out of range')
        for key, p in self.photos.items():
            self.check_photo(p, f'photos.{key}')
        for key, st in self.stops.items():
            if not st.get('name') or st.get('place') not in self.places:
                raise KitError(f'stops.{key}: name and a known place are required')
            for pid in st.get('photos') or []:
                if pid not in self.photos:
                    raise KitError(f'stops.{key}: unknown photo {pid}')
            if st.get('area') and st['area'] not in self.areas:
                raise KitError(f'stops.{key}: unknown area {st["area"]}')
            for m, v in (st.get('suits') or {}).items():
                if m not in self.marks or v not in self.marks[m][1]:
                    raise KitError(f'stops.{key}.suits: {m}={v!r} is not a known mark (see schema.md)')
            for e in st.get('embeds') or []:
                if e.get('kind') not in ('instagram', 'tiktok') or not HANDLE.match(e.get('handle') or ''):
                    raise KitError(f'stops.{key}.embeds: kind must be instagram or tiktok, with a plain handle')
            for i, c in enumerate(st.get('clips') or []):
                for k in ('poster', 'alt', 'cap', 'credit'):
                    if not c.get(k):
                        raise KitError(f'stops.{key}.clips[{i}].{k} is required')
                check_image(c['poster'], f'stops.{key}.clips[{i}].poster')
                if not c.get('sources'):
                    raise KitError(f'stops.{key}.clips[{i}]: at least one video source is required')
                for s in c['sources']:
                    check_url(s.get('src'), f'stops.{key}.clips[{i}]')
            self.stop_cats[key] = norm_cats(st.get('cat'), f'stops.{key}.cat')
            if st.get('photo_spot'):
                self.check_spot(st['photo_spot'], f'stops.{key}.photo_spot')
            for i, x in enumerate(st.get('nearby') or []):
                self.check_alt(x, f'stops.{key}.nearby[{i}]')
        for gi, g in enumerate(d.get('worship') or []):
            for i, x in enumerate(g.get('items') or []):
                self.check_alt(x, f'worship[{gi}].items[{i}]', default='worship')
        if not self.days:
            raise KitError('days: at least one day is required')
        for i, day in enumerate(self.days):
            w = f'days[{i}]'
            for k in ('when', 'title'):
                if not day.get(k):
                    raise KitError(f'{w}.{k} is required')
            route = day.get('route') or []
            if not route or any(p not in self.places for p in route):
                raise KitError(f'{w}.route: list the day\'s places (known place ids)')
            if len(route) > len(LETTERS):
                raise KitError(f'{w}.route: at most {len(LETTERS)} places')
            walk = set(day.get('walk') or [])
            for a, b in zip(route, route[1:]):
                k = f'{a}>{b}'
                if k not in walk and k not in self.legs:
                    raise KitError(f'{w}: leg {k} is missing (add it to "legs", or list it in the day\'s "walk")')
            if not day.get('stops'):
                raise KitError(f'{w}.stops: Plan A needs at least one stop')
            for plan in ('stops', 'plan_b', 'plan_c'):
                for it in day.get(plan) or []:
                    if it.get('stop') not in self.stops:
                        raise KitError(f'{w}.{plan}: unknown stop {it.get("stop")!r}')
            if day.get('iso'):
                parse_date(day['iso'], f'{w}.iso')
            for j, x in enumerate(day.get('timeline') or []):
                if x.get('stop') and x['stop'] not in self.stops:
                    raise KitError(f'{w}.timeline[{j}]: unknown stop {x["stop"]!r}')
                for pid in x.get('photos') or []:
                    if pid not in self.photos:
                        raise KitError(f'{w}.timeline[{j}]: unknown photo {pid!r}')
            for j, x in enumerate(day.get('nearby') or []):
                norm_cats(x.get('cat'), f'{w}.nearby[{j}].cat')
            want = (d.get('page') or {}).get('meal_choices')
            for j, m in enumerate(day.get('meals') or []):
                if m.get('meal') not in MEALS:
                    raise KitError(f'{w}.meals[{j}].meal must be one of {", ".join(MEALS)}')
                choices = m.get('choices') or []
                if not choices:
                    raise KitError(f'{w}.meals[{j}]: list the choices')
                if want and len(choices) != want:
                    raise KitError(f'{w}.meals[{j}] ({m["meal"]}): {len(choices)} choices; this page asks for {want} per meal (page.meal_choices)')
                for c, x in enumerate(choices):
                    if 'stop' in x:
                        if x['stop'] not in self.stops:
                            raise KitError(f'{w}.meals[{j}].choices[{c}]: unknown stop {x["stop"]!r}')
                    else:
                        self.check_alt(x, f'{w}.meals[{j}].choices[{c}]', default='food')
        self.validate_weather()
        self.validate_plans()
        self.validate_audience()
        self.validate_opener()
        for gi, g in enumerate((d.get('upgrades') or {}).get('groups') or []):
            for ii, u in enumerate(g.get('items') or []):
                for k in ('name', 'line', 'price', 'book_ahead', 'source'):
                    if not u.get(k):
                        raise KitError(f'upgrades.groups[{gi}].items[{ii}].{k} is required')
                for s in as_list(u['source']):
                    if s not in self.sources:
                        raise KitError(f'upgrades.groups[{gi}].items[{ii}]: unknown source {s}')
                norm_cats(u.get('cat'), f'upgrades.groups[{gi}].items[{ii}].cat')

    def check_alt(self, x, where, default=None):
        """A nearby alternative (or a place of worship): name and category are required; the pin is optional
        (without one the card shows, with no map pin); hours are a fact, so they need a source."""
        if not x.get('name'):
            raise KitError(f'{where}.name is required')
        has = [x.get(k) is not None for k in ('lat', 'lng')]
        if any(has) and not all(has):
            raise KitError(f'{where}: give both lat and lng, or neither')
        if all(has) and (not all(isinstance(x[k], (int, float)) and not isinstance(x[k], bool) for k in ('lat', 'lng'))
                         or not (-90 <= x['lat'] <= 90 and -180 <= x['lng'] <= 180)):
            raise KitError(f'{where}: coordinates out of range')
        if not norm_cats(x.get('cat') or default, f'{where}.cat'):
            raise KitError(f'{where}.cat is required')
        if x.get('website'):
            check_url(x['website'], f'{where}.website')
        if x.get('hours') and not x.get('source'):
            raise KitError(f'{where}: hours are a fact; give their source')
        if x.get('source') and x['source'] not in self.sources:
            check_url(x['source'], f'{where}.source')
        if x.get('instagram') and not IG_URL.match(x['instagram']):
            raise KitError(f'{where}.instagram: the venue\'s own account, as https://www.instagram.com/<handle>/')
        if x.get('photo_spot'):
            self.check_spot(x['photo_spot'], f'{where}.photo_spot')
        if x.get('photo'):
            self.photo(x['photo'], f'{where}.photo')

    def check_spot(self, sp, where):
        """A photo spot names the spot and the official source that names it (a source key or an https page)."""
        if not isinstance(sp, dict) or not sp.get('spot') or not sp.get('source'):
            raise KitError(f'{where}: a photo spot needs "spot" and its "source"')
        if sp['source'] not in self.sources:
            check_url(sp['source'], f'{where}.source')

    def validate_opener(self):
        o = self.opener_d
        if not o:
            return
        if not o.get('hero'):
            raise KitError('opener.hero: list 1 to 8 photo ids for the opening slideshow')
        if len(o['hero']) > 8 or any(p not in self.photos for p in o['hero']):
            raise KitError('opener.hero: at most 8 known photo ids')
        for k in ('stays', 'highlights'):
            for sid in o.get(k) or []:
                if sid not in self.stops:
                    raise KitError(f'opener.{k}: unknown stop {sid!r}')
                if not self.stop_anchor(sid):
                    raise KitError(f'opener.{k}: stop {sid!r} is not on any day')
        for k in ('home', 'destination'):
            p = o.get(k)
            if p is None:
                continue
            if not p.get('name') or not all(isinstance(p.get(c), (int, float)) and not isinstance(p.get(c), bool) for c in ('lat', 'lng')) \
                    or not (-90 <= p['lat'] <= 90 and -180 <= p['lng'] <= 180):
                raise KitError(f'opener.{k}: name, lat and lng are required')
        for i, a in enumerate(o.get('alerts') or []):
            if not a.get('text') or not str(a.get('href') or '').startswith('#') or not ID.match(str(a['href'])[1:]):
                raise KitError(f'opener.alerts[{i}]: text and an in-page #anchor are required')
        if len(as_list(o.get('tldr'))) > 5:
            raise KitError('opener.tldr: three lines is the house style (five at most)')
        if o.get('tz') and not TZ_NAME.match(o['tz']):
            raise KitError('opener.tz: an IANA time zone such as Europe/London')
        for k in ('start', 'end'):
            if o.get(k):
                parse_date(o[k], f'opener.{k}')

    def check_photo(self, p, where):
        for k in ('src', 'alt', 'cap', 'credit'):
            if not p.get(k):
                raise KitError(f'{where}.{k} is required (every photo needs a picture, a description, a caption and a credit)')
        check_image(p['src'], where + '.src')
        for k in ('credit_url', 'licence_url'):
            if p.get(k):
                check_url(p[k], f'{where}.{k}')

    def validate_weather(self):
        if not self.weather:
            return
        places = self.weather.get('places') or []
        if len(places) > MAX_WEATHER_PLACES:
            raise KitError(f'weather.places: at most {MAX_WEATHER_PLACES} places')
        seen = set()
        for i, p in enumerate(places):
            w = f'weather.places[{i}]'
            if not isinstance(p.get('key'), str) or not PLACE_KEY.match(p['key']) or p['key'] in seen:
                raise KitError(f'{w}.key: lowercase letters, digits and -, up to 30 characters, no repeats')
            seen.add(p['key'])
            for k, lo, hi in (('lat', -90, 90), ('lon', -180, 180)):
                v = p.get(k)
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
                    raise KitError(f'{w}.{k}: a number from {lo} to {hi}')
            a, b = parse_date(p.get('start'), w + '.start'), parse_date(p.get('end'), w + '.end')
            if b < a or (b - a).days >= MAX_SPAN_DAYS:
                raise KitError(f'{w}: end must not be before start, and a place covers at most {MAX_SPAN_DAYS} days')
        for i, day in enumerate(self.days):
            k = day.get('weather')
            if k:
                if k not in seen:
                    raise KitError(f'days[{i}].weather: unknown forecast place {k}')
                if not day.get('iso'):
                    raise KitError(f'days[{i}]: a day with a forecast place needs its iso date')

    def validate_plans(self):
        if not self.plans:
            return
        for i, r in enumerate(self.plans.get('rules') or []):
            w = f'plans.rules[{i}]'
            if r.get('plan') not in ('b', 'c') or r.get('metric') not in METRICS or r.get('op') not in OPS or not r.get('text'):
                raise KitError(f'{w}: needs plan (b or c), metric ({", ".join(METRICS)}), op ({" ".join(OPS)}), value and text')
            v = r.get('value')
            if r['op'] == 'in':
                if not isinstance(v, list) or not all(isinstance(x, (int, float)) for x in v):
                    raise KitError(f'{w}.value: a list of numbers for "in"')
            elif not isinstance(v, (int, float)) or isinstance(v, bool):
                raise KitError(f'{w}.value: a number')

    def validate_audience(self):
        a = self.audience
        if not a:
            return
        if a.get('mode') not in ('party', 'lenses'):
            raise KitError('audience.mode must be "party" or "lenses"')
        for m in a.get('needs') or []:
            if m not in self.marks:
                raise KitError(f'audience.needs: unknown mark {m}')
        if a['mode'] == 'lenses':
            lenses = a.get('lenses') or []
            if not lenses:
                raise KitError('audience.lenses: list at least one kind of traveller')
            seen = set()
            for i, l in enumerate(lenses):
                if not isinstance(l.get('key'), str) or not PLACE_KEY.match(l['key']) or l['key'] in seen or not l.get('label'):
                    raise KitError(f'audience.lenses[{i}]: key (lowercase, unique) and label are required')
                seen.add(l['key'])
                for m in l.get('needs') or []:
                    if m not in self.marks:
                        raise KitError(f'audience.lenses[{i}].needs: unknown mark {m}')

    # ------------------------------------------------------------------ inline text
    TOKEN = re.compile(r'\[\[(src|tel|link|place):([^\]|]*)(?:\|([^\]]*))?\]\]')

    # ------------------------------------------------------------------ place panels
    # Every place name on the page is a link that opens one panel inside the page (the owner,
    # 6 November 2026: option A), instead of a new window that is hard to come back from on a
    # tablet or phone. The panel's facts travel to the page's script as data, never as HTML.
    def new_pid(self, prefix, raw):
        base = prefix + '-' + (re.sub(r'[^a-z0-9]+', '-', str(raw).lower()).strip('-') or 'x')
        base = base[:26].rstrip('-')
        pid, n = base, 2
        while pid in self.panels:
            pid = f'{base}-{n}'
            n += 1
        return pid

    def plain(self, s):
        """A text field without its markup, for the panel (which shows plain text only)."""
        if s is None:
            return ''
        if isinstance(s, list):
            return ' '.join(self.plain(x) for x in s)
        out = str(s).replace('[[added]]', '').replace('[[/added]]', '').replace('[[br]]', ' ')
        out = re.sub(r'\*\*(.+?)\*\*', r'\1', out)

        def tok(m):
            kind, a, b = m.group(1), m.group(2), m.group(3)
            if kind == 'src':
                return ''
            if kind == 'place':
                return b or (self.places.get(a) or {}).get('name', a)
            return b or a
        out = self.TOKEN.sub(tok, out)
        return re.sub(r'\s+', ' ', out).strip()

    def accent(self, s):
        """A title, escaped, with *one word* set in the accent italic."""
        return re.sub(r'(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)', r'<em>\1</em>', E(s))

    def pl_link(self, pid, html, anchor=''):
        href = f'#{E(anchor)}' if anchor else '#'
        return f'<a class="pl" href="{href}" data-place="{E(pid)}">{html}</a>'

    def gmaps(self, q):
        return 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote(q)

    def panel_photo(self, ref, where):
        p = self.photo(ref, where)
        return dict(src=p['src'], alt=p['alt'], credit=self.plain(p.get('credit_prefix') or self.L['photo']) + ': ' + p['credit'],
                    credit_url=p.get('credit_url') or '', host=p.get('host') or '')

    def panel_spot(self, sp, where):
        if not sp:
            return None
        src = self.sources.get(sp['source'])
        url = (src or {}).get('url') or ('' if src else sp['source'])
        label = (src or {}).get('label') or host_of(url).removeprefix('www.')
        return dict(spot=sp['spot'], tip=sp.get('tip') or '', src=label, src_url=url)

    def collect_places(self):
        """One panel per place in "places", with the facts of the stop that tells most about it."""
        for key, pl in self.places.items():
            self.place_pid[key] = self.new_pid('p', key)
            self.panels[self.place_pid[key]] = None
        for key, pl in self.places.items():
            stops = [(sid, st) for sid, st in self.stops.items() if st.get('place') == key]
            stops.sort(key=lambda x: (x[0] != key, -(len(x[1].get('links') or []) + len(x[1].get('photos') or []))))
            sid, st = stops[0] if stops else (None, {})
            w = f'places.{key}'
            panel = dict(name=pl['name'], lat=pl['lat'], lng=pl['lng'], maps=self.gmaps(pl['q']), cats=[], what='', anchor='', day=-1, idx=-1)
            if sid:
                panel['cats'] = self.stop_cats.get(sid) or []
                panel['what'] = self.plain(st.get('line') or self.first_role(sid))
                panel['anchor'] = self.stop_anchor(sid)
                if st.get('photos'):
                    panel['photo'] = self.panel_photo(st['photos'][0], w + '.photo')
                for i, it in enumerate(st.get('links') or []):
                    kind, url, label = self.official_link(it, f'stops.{sid}.links[{i}]')
                    if kind == 'web' and 'web' not in panel:
                        panel['web'] = url
                    elif kind == 'addr' and 'addr' not in panel:
                        panel['addr'] = label
                        panel['maps'] = url
                    elif kind == 'hours' and 'hours' not in panel:
                        panel['hours'] = label
                        panel['hours_src'] = url
                    elif kind == 'tel' and 'tel' not in panel:
                        panel['tel'] = url
                handle = self.ig_handle(st, include_embedded=True)
                if handle:
                    panel['ig'] = handle
                if st.get('photo_spot'):
                    panel['spot'] = self.panel_spot(st['photo_spot'], f'stops.{sid}.photo_spot')
            for n, day in enumerate(self.days):
                if key in day['route']:
                    panel['day'], panel['idx'] = n, day['route'].index(key)
                    break
            if panel['cats']:
                panel['icon'] = self.cat_icons[panel['cats'][0]]
            self.panels[self.place_pid[key]] = panel

    def alt_panel(self, x, where, default=None, anchor_id=''):
        """The panel of a nearby alternative, a place of worship or a meal choice (one per place)."""
        seen = (x['name'], x.get('lat'), x.get('lng'))
        if seen in self.alt_pid:
            return self.alt_pid[seen], False
        pid = self.new_pid('a', x['name'])
        self.alt_pid[seen] = pid
        cats = norm_cats(x.get('cat') or default, where + '.cat')
        pinned = x.get('lat') is not None and x.get('lng') is not None
        q = x.get('q') or (f'{x["name"]} {x["lat"]:.5f},{x["lng"]:.5f}' if pinned else x['name'])
        what = ' '.join(t for t in (self.plain(x.get('faith') or x.get('kind')), self.plain(x.get('why'))) if t)
        panel = dict(name=x['name'], cats=cats, icon=self.cat_icons[cats[0]], what=what, maps=self.gmaps(q),
                     anchor=anchor_id or f'alt-{pid}', day=-1, idx=-1, dist=x.get('distance') or '')
        if pinned:
            panel['lat'], panel['lng'] = x['lat'], x['lng']
        if x.get('website'):
            panel['web'] = x['website']
        if x.get('address'):
            panel['addr'] = x['address']
        if x.get('hours'):
            panel['hours'] = self.plain(x['hours'])
            key = x.get('source') or next(iter(x.get('hours_sources') or []), '')
            src = self.sources.get(key)
            panel['hours_src'] = (src or {}).get('url') or ('' if src else key or '')
        m = IG_URL.match(x.get('instagram') or '')
        if m:
            panel['ig'] = m.group(1)
        if x.get('photo'):
            panel['photo'] = self.panel_photo(x['photo'], where + '.photo')
        if x.get('photo_spot'):
            panel['spot'] = self.panel_spot(x['photo_spot'], where + '.photo_spot')
        self.panels[pid] = panel
        return pid, True

    def spot_line(self, sp, where):
        if not sp:
            return ''
        src = self.src_tag(sp['source'], where=where) if sp['source'] in self.sources else \
            f'<a class="src" href="{E(sp["source"])}" target="_blank" rel="noopener">{E(host_of(sp["source"]).removeprefix("www."))}</a>'
        tip = f'. {E(sp["tip"])}' if sp.get('tip') else ''
        return f'<p class="spot" data-fact><span aria-hidden="true">📸</span> <b>{E(self.L["photo_spot"])}:</b> {E(sp["spot"])}{tip} {src}</p>'

    def rich(self, s, where='text'):
        """Escape a text field, then expand the kit's inline tokens (schema.md, "Text fields")."""
        if s is None:
            return ''
        if isinstance(s, list):
            return ' '.join(self.rich(x, where) for x in s)
        if not isinstance(s, str):
            raise KitError(f'{where}: text expected')
        out = E(s)
        if out.count('[[added]]') != out.count('[[/added]]'):
            raise KitError(f'{where}: [[added]] and [[/added]] must pair up')
        out = out.replace('[[added]]', '<span class="added">').replace('[[/added]]', '</span>').replace('[[br]]', '<br>')
        out = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', out)
        out = self.TOKEN.sub(lambda m: self.token(m, where), out)
        if '[[' in out:
            raise KitError(f'{where}: unknown token near {out[out.index("[["):][:40]!r}')
        return out

    def token(self, m, where):
        kind, a, b = m.group(1), unescape(m.group(2)), unescape(m.group(3)) if m.group(3) is not None else None
        if kind == 'src':
            return self.src_tag(a, b, where)
        if kind == 'place':
            if a not in self.place_pid:
                raise KitError(f'{where}: unknown place {a!r} in [[place:...]]')
            return self.pl_link(self.place_pid[a], E(b or self.places[a]['name']), self.panels[self.place_pid[a]]['anchor'] if self.panels.get(self.place_pid[a]) else '')
        if kind == 'tel':
            num = re.sub(r'[\s()-]', '', a)
            if not re.match(r'^\+?[0-9]{2,16}$', num):
                raise KitError(f'{where}: phone number {a!r}')
            return f'<a class="tel" href="tel:{E(num)}">{E(b or a)}</a>'
        url = check_url(a, where, ('https', 'mailto', 'tel', '#'))
        ext = '' if url.startswith('#') else ' target="_blank" rel="noopener"'
        return f'<a href="{E(url)}"{ext}>{E(b or url)}</a>'

    def src_tag(self, key, label=None, where='text'):
        s = self.sources.get(key)
        if not s:
            raise KitError(f'{where}: unknown source {key!r}')
        cls = 'src src-o' if s.get('tier') == 'carried' else 'src'
        tip = s.get('tooltip') or (f'{s.get("title", "")}, opened {s["opened"]}' if s.get('opened') else s.get('title', s['label']))
        if s.get('url'):
            return f'<a class="{cls}" href="{E(s["url"])}" target="_blank" rel="noopener" title="{E(tip)}">{E(label or s["label"])}</a>'
        return f'<span class="{cls}" title="{E(tip)}">{E(label or s["label"])}</span>'

    def url_or_source(self, item, where):
        if item.get('source'):
            s = self.sources.get(item['source'])
            if not s or not s.get('url'):
                raise KitError(f'{where}: source {item["source"]!r} has no link')
            return s['url']
        return check_url(item.get('url'), where)

    def ext_link(self, url, text):
        return f'<a href="{E(url)}" target="_blank" rel="noopener">{E(text)}</a>'

    def fmt(self, key, **kw):
        return self.L[key].format(**kw)

    # ------------------------------------------------------------------ legend categories
    def cats_attr(self, cats):
        return f' data-cats="{" ".join(cats)}"' if cats else ''

    def cat_chips(self, cats):
        if not cats:
            return ''
        return '<span class="cats">' + ''.join(
            f'<span class="cat-chip" data-cat="{c}"><span aria-hidden="true">{self.cat_icons[c]}</span> {E(self.cat_labels[c])}</span>' for c in cats) + '</span>'

    def stop_anchor(self, sid):
        """Where a stop's card is on the page: its first Plan A day, else its first Plan B or C."""
        for n, day in enumerate(self.days, 1):
            if any(it.get('stop') == sid for it in day.get('stops') or []):
                return f'd{n}-{sid}'
        for n, day in enumerate(self.days, 1):
            for p in ('b', 'c'):
                if any(it.get('stop') == sid for it in day.get('plan_' + p) or []):
                    return f'd{n}{p}-{sid}'
        return ''

    def legend(self, compact=False):
        btns = ''.join(f'<button type="button" class="lg" data-legend="{k}" aria-pressed="false"'
                       + (f' aria-label="{E(self.cat_labels[k])}" title="{E(self.cat_labels[k])}"' if compact else '')
                       + f'><span aria-hidden="true">{icon}</span>' + ('' if compact else f' {E(self.cat_labels[k])}<span class="lg-n"></span>') + '</button>'
                       for k, icon, _ in CATS)
        label = self.L['map_legend'] if compact else self.L['legend']
        return (f'<div class="legend{" legend-compact" if compact else ""}" role="group" aria-label="{E(label)}">{btns}</div>'
                + ('' if compact else f'<p class="lg-status" aria-live="polite"><span class="lg-msg"></span> <button type="button" class="lg-next" hidden>{E(self.L["lg_next"])}</button>'
                   f' <button type="button" class="lg-clear" hidden>{E(self.L["lg_clear"])}</button></p>'))

    # ------------------------------------------------------------------ photos
    def photo(self, ref, where):
        if isinstance(ref, dict):
            self.check_photo(ref, where)
            return ref
        if ref not in self.photos:
            raise KitError(f'{where}: unknown photo {ref!r}')
        return self.photos[ref]

    def credit(self, p, original=True):
        pre = E(p.get('credit_prefix') or self.L['photo'])
        if p.get('host') and p.get('credit_url'):
            out = f'{pre}: {E(p["credit"])} · {self.ext_link(p["credit_url"], p["host"])}'
        elif p.get('credit_url'):
            out = f'{pre}: {self.ext_link(p["credit_url"], p["credit"])}'
        else:
            out = f'{pre}: {E(p["credit"])}'
        if p.get('licence_url'):
            out += f' · {self.ext_link(p["licence_url"], p.get("licence") or "licence")}'
        elif original and p['src'].startswith('https://'):
            out += f' · {self.ext_link(p["src"], self.L["original"])}'
        return out

    def zoom_img(self, p):
        return (f'<button type="button" class="zoom" data-zoom aria-label="{E(self.fmt("enlarge", alt=p["alt"]))}" data-cap="{E(p["cap"])}">'
                f'<img src="{E(p["src"])}" alt="{E(p["alt"])}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>')

    def tile(self, p, slot):
        return (f'<figure class="tile" data-slot="{slot}">{self.zoom_img(p)}'
                f'<figcaption><span class="cap">{E(p["cap"])}</span> <span class="credit">{self.credit(p)}</span></figcaption></figure>')

    def bento(self, ids, where):
        real = [self.photo(x, where) for x in (ids or []) if x][:4]
        if not real:
            return ''
        return f'<div class="bento" data-count="{len(real)}">' + ''.join(self.tile(p, i) for i, p in enumerate(real)) + '</div>'

    def small_photo(self, ref, where, cls='near-photo'):
        p = self.photo(ref, where)
        return (f'<figure class="{cls}">{self.zoom_img(p)}<figcaption><span class="credit">{self.credit(p, original=False)}</span></figcaption></figure>')

    # ------------------------------------------------------------------ links, clips, posts
    def official_link(self, it, where):
        """One official link: (kind, url, label, note, extra attributes). Social links must be on the
        platform itself, an address links to Google Maps, and hours (a fact) link to their source."""
        kind = it.get('kind', 'web')
        if kind not in LINK_LABELS:
            raise KitError(f'{where}: kind must be one of {", ".join(LINK_LABELS)}')
        label = it.get('label') or LINK_LABELS[kind]
        if kind == 'addr':
            if not it.get('label'):
                raise KitError(f'{where}: an address link needs the address as its label')
            url = it.get('url') or 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote(it['label'])
            u = urllib.parse.urlsplit(url)
            if u.scheme != 'https' or (u.hostname or '') not in ('www.google.com', 'google.com') or not u.path.startswith('/maps'):
                raise KitError(f'{where}: an address must link to Google Maps (https://www.google.com/maps/...)')
        elif kind == 'hours':
            if not it.get('label') or not (it.get('source') or it.get('url')):
                raise KitError(f'{where}: hours need their text as the label and a source (source key or url)')
            url = self.url_or_source(it, where)
        else:
            url = check_url(it.get('url'), where, ('https', 'tel', 'mailto'))
        if kind in SOCIAL_HOSTS:
            host = (urllib.parse.urlsplit(url).hostname or '').lower()
            if not url.startswith('https://') or not (host == SOCIAL_HOSTS[kind] or host.endswith('.' + SOCIAL_HOSTS[kind])):
                raise KitError(f'{where}: a {LINK_LABELS[kind]} link must be https on {SOCIAL_HOSTS[kind]} ({url[:80]})')
        return kind, url, label

    def chip(self, kind, url, label, title='', ext=True, narrow=None, emoji=None):
        """One small single-line link chip; any note goes in its title, never inside it."""
        t = f' title="{E(title)}"' if title else ''
        tgt = ' target="_blank" rel="noopener"' if ext else ''
        lab = f'<span class="l l-wide">{E(label)}</span><span class="l l-narrow">{E(narrow)}</span>' if narrow else f'<span class="l">{E(label)}</span>'
        dk = f' data-kind="{kind}"' if kind else ''
        cls = ' web' if kind == 'web' else ' lk-tel' if kind == 'tel' else ''
        return f'<li><a class="lk{cls}"{dk} href="{E(url)}"{tgt}{t}><span class="e" aria-hidden="true">{emoji or EMOJI[kind]}</span>{lab}</a></li>'

    def link_row(self, items, place, tag=None, tq=None, where='links', extras=True):
        """The official links: a wrapping row of small chips (website, socials, call), then the address as
        a line of text linking to Google Maps, then the hours (a line, or a small disclosure when long)."""
        chips, addrs, hours = [], [], []
        for i, it in enumerate(items or []):
            kind, url, label = self.official_link(it, f'{where}[{i}]')
            note = it.get('note') or ''
            if kind == 'addr':
                who = f'<b>{E(note)}:</b> ' if note else ''
                addrs.append(f'<p class="lk-addr"><a data-kind="addr" href="{E(url)}" target="_blank" rel="noopener"><span aria-hidden="true">{EMOJI["addr"]}</span> {who}<span class="a">{E(label)}</span></a></p>')
            elif kind == 'hours':
                src = f'<a class="src" data-source data-kind="hours" href="{E(url)}" target="_blank" rel="noopener">{E(host_of(url).removeprefix("www."))}</a>'
                lab = E(self.L['hours']) + (f' · {E(note)}' if note else '')
                if len(label) <= 60:
                    hours.append(f'<p class="lk-hours" data-fact><span aria-hidden="true">{EMOJI["hours"]}</span> {lab}: <span class="h">{E(label)}</span> {src}</p>')
                else:
                    hours.append(f'<details class="lk-hours" data-fact><summary><span aria-hidden="true">{EMOJI["hours"]}</span> {lab}</summary>'
                                 f'<p class="h">{E(label)}</p><p class="fine">{E(self.L["upg_source"])}: {src}</p></details>')
            elif kind == 'tel':
                # the number is the chip's text on wide screens ("Call" on phones); a name such as
                # "Reception" goes in the title with the note
                parts = [s for s in (it.get('label'), note) if s]
                number = next((s for s in parts if PHONE_TEXT.fullmatch(s)), url.removeprefix('tel:'))
                title = ' · '.join(s for s in parts if s not in (number, LINK_LABELS['tel'], self.L['call']))
                short = (it.get('short') or '').strip()  # which venue, when a stop has two
                if short and len(short) > 24:
                    raise KitError(f'{where}[{i}]: short must be a short venue name (24 characters at most)')
                wide, narrow = (f'{short} · {number}', f'{self.L["call"]} {short}') if short else (number, self.L['call'])
                chips.append(self.chip('tel', url, wide, title, ext=False, narrow=narrow))
            else:
                chips.append(self.chip(kind, url, label, note, ext=kind != 'mail'))
        if place:
            gm = 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote(place['q'])
            if not addrs:
                chips.append(self.chip('map', gm, self.L['google_maps']))
            if extras:
                earth = f'https://earth.google.com/web/@{place["lat"]:.5f},{place["lng"]:.5f},40a,1100d,35y,0h,55t,0r'
                chips.append(self.chip('', earth, self.L['google_earth'], self.L['earth_3d'], emoji=EMOJI['earth']))
        if tag:
            if not re.match(r'^\w{1,60}$', tag):
                raise KitError(f'{where}: Instagram tag must be letters and digits only ({tag!r})')
            chips.append(self.chip('', f'https://www.instagram.com/explore/tags/{urllib.parse.quote(tag)}/', f'#{tag}', self.L['ig_photos'], emoji=EMOJI['tag']))
        if tq:
            chips.append(self.chip('', f'https://www.tiktok.com/search?q={urllib.parse.quote(tq)}', self.L['tiktok_videos'], self.L['tiktok_search'], emoji=EMOJI['tts']))
        row = f'<ul class="links" aria-label="{E(self.L["links"])}">' + ''.join(chips) + '</ul>' if chips else ''
        return f'<div class="offl">{row}{"".join(addrs)}{"".join(hours)}</div>' if (row or addrs or hours) else ''

    def clips(self, items):
        if not items:
            return ''
        figs = []
        for c in items:
            srcs = ''.join(f'<source src="{E(s["src"])}" type="{E(s.get("type") or "video/webm")}">' for s in c['sources'])
            cred = E(c['credit'])
            if c.get('page'):
                cred += ' · ' + self.ext_link(check_url(c['page'], 'clip page'), c.get('host') or self.L['original'])
            if c.get('licence_url'):
                cred += ' · ' + self.ext_link(check_url(c['licence_url'], 'clip licence'), c.get('licence') or 'licence')
            figs.append(f'<figure class="clip"><video controls playsinline muted preload="none" poster="{E(c["poster"])}" aria-label="{E(c["alt"])}">{srcs}</video>'
                        f'<figcaption>🎬 {E(c["cap"])} · <span class="credit">{cred}</span></figcaption></figure>')
        return '<div class="clips">' + ''.join(figs) + '</div>'

    def posts(self, items):
        if not items:
            return ''
        names = ' · '.join(('Instagram' if e['kind'] == 'instagram' else 'TikTok') + f' @{e["handle"]}' for e in items)
        frames = []
        for e in items:
            h = e['handle']
            if e['kind'] == 'instagram':
                src, title = f'https://www.instagram.com/{h}/embed/', self.fmt('ig_latest', h=h)
            else:
                src, title = f'https://www.tiktok.com/embed/@{h}', self.fmt('tt_latest', h=h)
            frames.append(f'<iframe data-src="{E(src)}" title="{E(title)}" height="560" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>')
        return (f'<details class="social" data-auto-open><summary><span aria-hidden="true">📸</span> {E(self.L["latest_posts"])} <small>{E(names)}</small></summary>'
                f'<div class="social-grid">{"".join(frames)}</div><p class="fine">{E(self.L["embed_note"])}</p></details>')

    # ------------------------------------------------------------------ suitability
    def suits(self, st, sid):
        marks = st.get('suits') or {}
        notes = st.get('lens_notes') or {}
        if not marks and not notes and not st.get('suits_note'):
            return ''
        chips = []
        for m, v in marks.items():
            icon, vals = self.marks[m]
            level, label = vals[v]
            chips.append(f'<li class="suit" data-mark="{E(m)}" data-level="{level}"><span aria-hidden="true">{icon}</span> {E(label)}</li>')
        out = f'<div class="suits-box">'
        if chips:
            out += f'<ul class="suits" aria-label="{E(self.L["suits_aria"])}">' + ''.join(chips) + '</ul>'
        a = self.audience or {}
        if a.get('mode') == 'party' and a.get('needs'):
            out += f'<p class="suits-sum">{self.party_summary(marks, a["needs"])}</p>'
        elif a.get('mode') == 'lenses':
            out += '<p class="suits-sum" hidden></p>'
        if st.get('suits_note'):
            out += f'<p class="lens-note">{self.rich(st["suits_note"], f"stops.{sid}.suits_note")}</p>'
        lens_labels = {l['key']: l['label'] for l in (a.get('lenses') or [])}
        for k, txt in notes.items():
            lab = lens_labels.get(k, k)
            out += f'<p class="lens-note" data-lens="{E(k)}"><b>{E(lab)}:</b> {self.rich(txt, f"stops.{sid}.lens_notes.{k}")}</p>'
        return out + '</div>'

    def party_summary(self, marks, needs):
        fits, check, unknown = [], [], []
        for m in needs:
            if m not in marks:
                unknown.append(MARK_NAMES[m])
                continue
            level, label = self.marks[m][1][marks[m]]
            (fits if level == 'good' else check).append(label.lower() if level == 'good' else f'{MARK_NAMES[m]} ({label.lower()})')
        parts = []
        if fits:
            parts.append(f'{E(self.L["lens_fits"])} · ' + E(', '.join(fits)))
        if check:
            parts.append(f'{E(self.L["lens_check"])} · ' + E(', '.join(check)))
        if unknown:
            parts.append(f'{E(self.L["lens_unknown"])} · ' + E(', '.join(unknown)))
        return f'<b>{E(self.L["party_for"])}:</b> ' + '; '.join(parts)

    # ------------------------------------------------------------------ stops and days
    def stop_card(self, day, n, item, plan):
        sid = item['stop']
        st = self.stops[sid]
        pl = self.places[st['place']]
        w = f'stops.{sid}'
        route = day['route']
        idx = route.index(st['place']) if st['place'] in route else -1
        letter = LETTERS[idx] if idx >= 0 else '+'
        did = f'd{n}-{sid}' if plan == 'a' else f'd{n}{plan}-{sid}'
        role = item.get('role') or ''
        if item.get('replaces'):
            role = (role + ' ' if role else '') + f'{self.L["replaces"]}: {item["replaces"]}.'
        note = self.fmt('plan', p=plan.upper()) if plan != 'a' else self.L['optional']
        details = ' · '.join(f'<a href="{E(self.url_or_source(x, w + ".details"))}" target="_blank" rel="noopener">{E(x["text"])} ↗</a>' for x in st.get('details') or [])
        prompts = st.get('prompts') or []
        ptitle = self.L['prompts3'] if len(prompts) == 3 else self.L['prompts']
        area = self.areas.get(st.get('area')) if st.get('area') else None
        coord_src = (self.d.get('map') or {}).get('coordinates_source')
        pin = self.fmt('pin_search', q=pl['q'], lat=f'{pl["lat"]:.5f}', lng=f'{pl["lng"]:.5f}', note=pl.get('note') or '')
        pin = E(pin).replace(' ()', '')
        if coord_src:
            pin += ' ' + self.src_tag(coord_src, where=w)
        cats = self.stop_cats.get(sid) or []
        out = (f'<article class="stop" id="{E(did)}"{self.cats_attr(cats)}>'
               f'<header class="stop-h"><span class="pin-letter" aria-hidden="true">{letter}</span>'
               f'<div><h4>{self.pl_link(self.place_pid[st["place"]], E(st["name"]), did)}</h4><p class="role">{E(role)}</p>{self.cat_chips(cats)}</div>'
               f'<button type="button" class="btn-ghost show-map" data-day="{n - 1}" data-idx="{idx if plan == "a" else -1}" data-lat="{pl["lat"]}" data-lng="{pl["lng"]}" data-name="{E(st["name"])}" data-note="{E(note)}">{E(self.L["show_on_map"])}</button></header>'
               f'{self.suits(st, sid)}'
               f'{self.bento(st.get("photos"), w + ".photos")}'
               f'{self.clips(st.get("clips"))}'
               f'{self.posts(st.get("embeds"))}'
               f'{self.link_row(st.get("links"), pl, st.get("instagram_tag"), st.get("tiktok_search"), w + ".links")}'
               f'{self.spot_line(st.get("photo_spot"), w + ".photo_spot")}'
               f'<p class="links-note">{E(self.L["links_note"])}{(" " + E(self.L["details"]) + ": " + details) if details else ""}</p>'
               f'{self.alts(st.get("nearby"), st["name"], n, w + ".nearby")}')
        if prompts:
            out += f'<div class="prompts"><h5>{E(ptitle)}</h5><ol>' + ''.join(f'<li>{E(x)}</li>' for x in prompts) + '</ol></div>'
        out += (f'<details class="drawer" data-pin="{E(pl["q"])}" data-name="{E(st["name"])}"><summary>{E(self.L["map_drawer"])}</summary>'
                f'<div class="drawer-map"></div><p class="fine">{pin}.</p></details>')
        handle = self.ig_handle(st)
        if handle:
            out += (f'<details class="drawer ig-drawer"><summary>📷 {E(self.fmt("ig_drawer", h=handle))}</summary>'
                    f'<div class="social-grid"><iframe data-src="https://www.instagram.com/{E(handle)}/embed/" title="{E(self.fmt("ig_profile", h=handle))}" height="560" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
                    f'<p class="fine">{E(self.L["embed_note"])}</p></details>')
        if area:
            out += f'<details class="drawer" data-cc="{E(st["area"])}"><summary>{E(self.fmt("concierge_drawer", name=area["name"]))}</summary><div class="cc-slot"></div></details>'
        return out + '</article>'

    def ig_handle(self, st, include_embedded=False):
        """The venue's own Instagram handle, from its Instagram link, unless its posts are already embedded."""
        embedded = set() if include_embedded else {e['handle'].lower() for e in st.get('embeds') or [] if e.get('kind') == 'instagram'}
        for it in st.get('links') or []:
            if it.get('kind') == 'ig':
                m = re.match(r'^https://(?:www\.)?instagram\.com/([A-Za-z0-9._]{1,30})/?$', it.get('url') or '')
                if m and m.group(1).lower() not in ('explore', 'p', 'reel', 'reels', 'stories') and m.group(1).lower() not in embedded:
                    return m.group(1)
        return ''

    def alt_card(self, x, n, where, default=None):
        cats = norm_cats(x.get('cat') or default, where + '.cat')
        icon = self.cat_icons[cats[0]]
        hours = ''
        if x.get('hours'):
            src = self.src_tag(x['source'], where=where) if x['source'] in self.sources else \
                f'<a class="src" href="{E(x["source"])}" target="_blank" rel="noopener" title="Source">{E(host_of(x["source"]).removeprefix("www."))}</a>'
            hours = f'<p class="alt-hours" data-fact><span aria-hidden="true">⏰</span> {self.rich(x["hours"], where + ".hours")} {src}</p>'
        elif x.get('source'):
            hours = '<p class="alt-src">' + (self.src_tag(x['source'], where=where) if x['source'] in self.sources else
                                            f'<a class="src" href="{E(x["source"])}" target="_blank" rel="noopener">{E(host_of(x["source"]).removeprefix("www."))}</a>') + '</p>'
        pinned = x.get('lat') is not None and x.get('lng') is not None
        q = x.get('q') or (f'{x["name"]} {x["lat"]:.5f},{x["lng"]:.5f}' if pinned else x['name'])
        gm = 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote(q)
        links = []
        if x.get('website'):
            links.append(f'<a href="{E(x["website"])}" target="_blank" rel="noopener" data-kind="web">🌐 {E(self.L["website"])}</a>')
        links.append(f'<a href="{E(gm)}" target="_blank" rel="noopener" data-kind="map">📍 {E(self.L["google_maps"])}</a>')
        if pinned:
            links.append(f'<button type="button" class="linkish show-map" data-day="{max(0, n - 1)}" data-idx="-1" data-lat="{x["lat"]}" data-lng="{x["lng"]}" '
                         f'data-name="{E(x["name"])}" data-note="{E(self.cat_labels[cats[0]])}">{E(self.L["alt_map"])}</button>')
        # one plain distance line ("About 3 min drive"); how it was worked out goes in its title
        tip = f' title="{E(x["distance_note"])}"' if x.get('distance_note') else ''
        dist = f'<p class="alt-dist"{tip}>{E(x["distance"])}</p>' if x.get('distance') else ''
        faith = f'<p class="alt-faith">{E(x["faith"])}</p>' if x.get('faith') else ''
        pid, first = self.alt_panel(x, where, default)
        aid = f' id="{E(self.panels[pid]["anchor"])}"' if first else ''
        ig = IG_URL.match(x.get('instagram') or '')
        if ig:
            links.insert(1 if x.get('website') else 0, f'<a href="{E(x["instagram"])}" target="_blank" rel="noopener" data-kind="ig">📸 @{E(ig.group(1))}</a>')
        return (f'<article class="alt"{aid}{self.cats_attr(cats)}><p class="alt-h"><span class="alt-ico" aria-hidden="true">{icon}</span> '
                f'<b>{self.pl_link(pid, E(x["name"]), self.panels[pid]["anchor"])}</b></p>{dist}'
                f'{faith}' + (f'<p>{self.rich(x["why"], where + ".why")}</p>' if x.get('why') else '') + hours
                + self.spot_line(x.get('photo_spot'), where + '.photo_spot')
                + f'<p class="alt-links">{" · ".join(links)}</p></article>')

    def alts(self, items, name, n, where):
        if not items:
            return ''
        cards = ''.join(self.alt_card(x, n, f'{where}[{i}]') for i, x in enumerate(items))
        return (f'<section class="alts" aria-label="{E(self.fmt("alts_aria", name=name))}"><p class="mono kicker">{E(self.L["alts"])}</p>'
                f'<div class="alts-grid">{cards}</div></section>')

    def worship_block(self):
        groups = self.d.get('worship') or []
        if not groups:
            return ''
        out = f'<div class="worship" data-cats="worship"><h3 class="h-rule">⛪ {E(self.L["worship_title"])}</h3>'
        for gi, g in enumerate(groups):
            base = g.get('title') or (self.areas.get(g.get('base')) or {}).get('name') or g.get('base') or ''
            out += (f'<h4>{E(base)}</h4>' if base else '') + '<div class="alts-grid">' + ''.join(
                self.alt_card(x, 1, f'worship[{gi}].items[{i}]', default='worship') for i, x in enumerate(g.get('items') or [])) + '</div>'
        return out + '</div>'

    def plan_label(self, p):
        return ((self.plans or {}).get('labels') or {}).get(p) or self.L['plan_' + p]

    def rules_line(self):
        rules = (self.plans or {}).get('rules') or []
        if not rules:
            return ''
        return f'<p class="wx-rules"><b>{E(self.L["plans_rules"])}:</b> ' + ' · '.join(E(r.get('short') or r['text']) for r in rules) + '</p>'

    def plans_bar(self, day, n, alts):
        wx = ''
        if day.get('weather') and self.weather:
            iso = parse_date(day['iso'], 'iso')
            frm = iso - datetime.timedelta(days=FORECAST_LEAD_DAYS)
            wx = (f'<div class="wx" data-wx-place="{E(day["weather"])}" data-wx-date="{E(day["iso"])}" aria-live="polite">'
                  f'<p class="wx-line"><span class="wx-ico" aria-hidden="true">🗓️</span> <span class="wx-msg">{E(self.fmt("wx_from", date=human_date(frm)))}</span></p>'
                  f'{self.rules_line()}</div>')
        if not self.plans and not wx and not alts:
            return ''
        out = f'<div class="plans-bar" role="group" aria-label="{E(self.fmt("plans_for_day", n=n))}"{" data-cats=" + chr(34) + "weather" + chr(34) if wx else ""}>'
        if self.plans or alts:
            if alts:
                btns = []
                for p in ['a'] + alts:
                    btns.append(f'<button type="button" class="plan-btn" data-plan="{p}" aria-pressed="{"true" if p == "a" else "false"}">'
                                f'<b aria-hidden="true">{p.upper()}</b><span class="sr">{E(self.fmt("plan", p=p.upper()))}: </span>{E(self.plan_label(p))}'
                                f'<span class="sugg-tag" hidden>{E(self.L["suggested"])}</span></button>')
                out += f'<div class="plan-switch" role="group" aria-label="{E(self.L["choose_plan"])}">' + ''.join(btns) + '</div>'
            else:
                out += f'<p class="plan-missing">{E(self.L["plans_missing"])}</p>'
            if not wx:
                out += self.rules_line()
        return out + wx + '</div>'

    def strip(self, ids, where):
        """A row of up to three photos for a schedule item: swipeable on phones, tap to enlarge, credited."""
        real = [self.photo(x, where) for x in (ids or []) if x][:3]
        if not real:
            return ''
        return f'<div class="strip" data-count="{len(real)}">' + ''.join(self.tile(p, i) for i, p in enumerate(real)) + '</div>'

    def timeline_item(self, x, n, w):
        st = self.stops.get(x.get('stop')) if x.get('stop') else None
        title = E(x.get('title'))
        if st:
            anchor = self.stop_anchor(x['stop'])
            title = f'<a class="tl-go" href="#{E(anchor)}">{title}</a>' if anchor else title
        photos = x.get('photos') or (st.get('photos') if st else None)
        links = x.get('links') if x.get('links') is not None else (st.get('links') if st else None)
        place = self.places[st['place']] if st else None
        extra = self.strip(photos, w + '.photos')
        if links or place:
            extra += self.link_row(links, place, where=w + '.links', extras=False)
        cats = self.stop_cats.get(x.get('stop')) if st else []
        return (f'<li{self.cats_attr(cats or [])}><span class="t">{E(x.get("time"))}</span><div><b>{title}</b><p>{self.rich(x.get("text"), w)}</p>'
                f'{extra}</div></li>')

    def plan_head(self, p):
        return (f'<p class="plan-h"><span class="plan-tag">{E(self.fmt("plan", p=p.upper()))}</span> {E(self.plan_label(p))}'
                f' <span class="chosen-tag">{E(self.L["chosen"])}</span><span class="sugg-tag" hidden>{E(self.L["suggested"])}</span></p>')

    def day_html(self, day, i):
        n = i + 1
        w = f'days[{i}]'
        pl = self.places
        stops_strip = ' <span class="arr" aria-hidden="true">→</span> '.join(
            f'<button type="button" class="chip-stop show-map" data-day="{n - 1}" data-idx="{j}" data-lat="{pl[p]["lat"]}" data-lng="{pl[p]["lng"]}" data-name="{E(pl[p]["name"])}"><b>{LETTERS[j]}</b> {E(pl[p]["name"])}</button>'
            for j, p in enumerate(day['route']))
        tl = ''.join(self.timeline_item(x, n, f'{w}.timeline[{j}]') for j, x in enumerate(day.get('timeline') or []))
        info = ''.join(f'<section><h5>{E(x["title"])}</h5><p>{self.rich(x.get("text"), w + ".info")}</p></section>' for x in day.get('info') or [])
        links = ' · '.join(f'<a href="{E(self.url_or_source(x, w + ".links"))}" target="_blank" rel="noopener">{E(x["text"])} ↗</a>' for x in day.get('links') or [])
        cards = ''.join(self.stop_card(day, n, it, 'a') for it in day['stops'])
        alts = [p for p in ('b', 'c') if day.get('plan_' + p)]
        meta = ''.join(f'<span class="pill{" pill-line" if k == "badge" else ""}">{E(day[k])}</span>' for k in ('base', 'badge') if day.get(k))
        kicker = E(day['when']) + (f' · {self.rich(day["route_label"], w + ".route_label")}' if day.get('route_label') else '')
        chosen = ' data-chosen="a"' if alts else ''
        band = ''
        for it in day['stops']:
            ph = (self.stops[it['stop']].get('photos') or [None])[0]
            if ph:
                p = self.photo(ph, w + '.band')
                band = (f'<figure class="day-band"><img src="{E(p["src"])}" alt="{E(p["alt"])}" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
                        f'<figcaption><span class="credit">{self.credit(p, original=False)}</span></figcaption></figure>')
                break
        out = (f'<article class="day" id="day-{n}" data-day="{n - 1}"{chosen}>'
               f'<header class="day-h{" has-band" if band else ""}">{band}<div class="day-num"><span class="mono">{E(self.L["day"])}</span><b>{n:02d}</b></div>'
               f'<div class="day-t"><p class="mono kicker">{kicker}</p><h3>{self.accent(day["title"])}</h3>'
               + (f'<p class="dek">{E(day["sub"])}</p>' if day.get('sub') else '')
               + (f'<p class="day-meta">{meta}</p>' if meta else '')
               + f'<button type="button" class="btn-ghost share-day" data-share-day="{n}" hidden><span aria-hidden="true">↗</span> {E(self.L["share_day"])}</button>'
               + '</div></header>'
               + self.plans_bar(day, n, alts)
               + f'<div class="plan plan-a{" on" if alts else ""}" data-plan="a">' + (self.plan_head('a') if alts else '')
               + f'<div class="route-strip" aria-label="{E(self.fmt("stops_for_day", n=n))}">{stops_strip}</div>'
               + (f'<ol class="timeline">{tl}</ol>' if tl else '')
               + (f'<div class="info4">{info}</div>' if info else '')
               + (f'<p class="day-links">{links}</p>' if links else '')
               + f'<div class="stops">{cards}</div></div>')
        for p in alts:
            note = (day.get('plan_notes') or {}).get(p)
            out += (f'<section class="plan plan-alt" data-plan="{p}" aria-label="{E(self.fmt("plan_for_day", p=p.upper(), n=n, label=self.plan_label(p)))}">'
                    + self.plan_head(p) + (f'<p class="plan-why">{self.rich(note, w + ".plan_notes")}</p>' if note else '')
                    + '<div class="stops">' + ''.join(self.stop_card(day, n, it, p) for it in day['plan_' + p]) + '</div></section>')
        out += self.meals_html(day, n)
        out += self.nearby(day, n)
        return out + '</article>'

    def meals_html(self, day, n):
        """Each meal of the day with its choices (the planned place counts as one), all on the page."""
        meals = day.get('meals') or []
        if not meals:
            return ''
        w = f'days[{n - 1}].meals'
        out = f'<section class="meals" aria-label="{E(self.fmt("meals_aria", n=n))}"><p class="mono kicker">{E(self.L["meals"])}</p>'
        for j, m in enumerate(meals):
            cards = []
            for c, x in enumerate(m['choices']):
                if 'stop' in x:
                    st = self.stops[x['stop']]
                    pid = self.place_pid[st['place']]
                    cats = self.stop_cats.get(x['stop']) or ['food']
                    pl = self.places[st['place']]
                    role = x.get('role') or self.first_role(x['stop'])
                    cards.append(f'<article class="alt alt-planned"{self.cats_attr(cats)}><p class="alt-h"><span class="alt-ico" aria-hidden="true">{self.cat_icons[cats[0]]}</span> '
                                 f'<b>{self.pl_link(pid, E(st["name"]), self.panels[pid]["anchor"])}</b> <span class="badge">{E(self.L["planned"])}</span></p>'
                                 + (f'<p>{E(role)}</p>' if role else '')
                                 + f'<p class="alt-links"><button type="button" class="linkish show-map" data-day="{n - 1}" data-idx="-1" data-lat="{pl["lat"]}" data-lng="{pl["lng"]}" '
                                   f'data-name="{E(st["name"])}" data-note="{E(self.L["planned"])}">{E(self.L["alt_map"])}</button></p></article>')
                else:
                    cards.append(self.alt_card(x, n, f'{w}[{j}].choices[{c}]', default='food'))
            head = f'{MEAL_ICONS[m["meal"]]} {E(self.L["meal_" + m["meal"]])}' + (f' · {E(m["time"])}' if m.get('time') else '')
            out += (f'<div class="meal" data-meal="{m["meal"]}"><h4 class="meal-h">{head} <span class="meal-n">{E(self.fmt("meal_choices", n=len(cards)))}</span></h4>'
                    + (f'<p class="meal-note">{self.rich(m["note"], f"{w}[{j}].note")}</p>' if m.get('note') else '')
                    + f'<div class="alts-grid">{"".join(cards)}</div></div>')
        return out + '</section>'

    def nearby(self, day, n):
        items = day.get('nearby') or []
        if not items:
            return ''
        cards = []
        for j, x in enumerate(items):
            w = f'days[{n - 1}].nearby[{j}]'
            for k in ('id', 'name', 'why', 'lat', 'lng', 'q'):
                if x.get(k) in (None, ''):
                    raise KitError(f'{w}.{k} is required')
            ph = self.small_photo(x['photo'], w + '.photo') if x.get('photo') else ''
            hours = ''
            if x.get('hours'):
                tags = []
                for s in x.get('hours_sources') or []:
                    if s in self.sources:
                        tags.append(self.src_tag(s, where=w))
                    else:
                        u = check_url(s, w + '.hours_sources')
                        tags.append(f'<a class="src" href="{E(u)}" target="_blank" rel="noopener" title="Source for these hours">{E(host_of(u).removeprefix("www."))}</a>')
                hours = f'<p class="fine" data-fact>{self.rich(x["hours"], w + ".hours")}{(" " + " ".join(tags)) if tags else ""}</p>'
            place = {'q': x['q'], 'lat': x['lat'], 'lng': x['lng']}
            ncats = norm_cats(x.get('cat'), w + '.cat')
            nid = f'x{n}-{x["id"]}'
            npid, _ = self.alt_panel(dict(x, cat=ncats, why=x.get('why'), website=next((it.get('url') for it in x.get('links') or [] if it.get('kind', 'web') == 'web'), None)),
                                     w, anchor_id=nid)
            cards.append(f'<article class="near" id="{E(nid)}"{self.cats_attr(ncats)}>{ph}<div class="near-b"><p class="mono kicker">{E(x.get("kind"))}</p><h4>{self.pl_link(npid, E(x["name"]), nid)}</h4>'
                         f'<p>{self.rich(x["why"], w + ".why")}</p>{hours}{self.link_row(x.get("links"), place, where=w + ".links")}</div></article>')
        return (f'<section class="nearby" aria-label="{E(self.fmt("nearby_aria", n=n))}"><p class="mono kicker">{E(self.L["nearby_kicker"])}</p>'
                f'<div class="nearby-grid">{"".join(cards)}</div></section>')

    # ------------------------------------------------------------------ concierge
    def emergency(self):
        nums = self.d.get('emergency') or []
        if not nums:
            return ''
        out = []
        for e in nums:
            num = re.sub(r'[\s()-]', '', e['tel'])
            if not re.match(r'^\+?[0-9]{2,16}$', num):
                raise KitError(f'emergency: phone number {e["tel"]!r}')
            out.append(f'<a class="tel{" sos-main" if e.get("main") else ""}" href="tel:{E(num)}">{E(e.get("label") or e["tel"])}</a>')
        return f'<div class="sos" role="group" aria-label="{E(self.L["emergency_numbers"])}">' + ''.join(out) + '</div>'

    def area_items(self, items, compact, where):
        out = []
        for it in items:
            if isinstance(it, str):
                it = {'text': it}
            lab = (it.get('short_label') if compact else None) or it.get('label')
            head = f'<b>{E(lab)}:</b>' if lab else ''
            if 'list' in it:
                vals = [self.rich(x, where) for x in it['list']]
                body = (' ' + ' '.join(vals)) if compact else ('<ul>' + ''.join(f'<li data-fact>{v}</li>' for v in vals) + '</ul>')
                out.append(f'<li data-fact>{head}{body}</li>' if compact else f'<li>{head}{body}</li>')
            else:
                out.append(f'<li data-fact>{head}{" " if head else ""}{self.rich(it.get("text"), where)}</li>')
        return ''.join(out)

    def area_compact(self, aid):
        a = self.areas[aid]
        groups = ''.join(f'<div><dt>{E(g.get("short_title") or g["title"])}</dt><dd><ul>{self.area_items(g.get("items") or [], True, f"areas.{aid}")}</ul></dd></div>'
                         for g in a.get('groups') or [])
        return (f'<div class="cc">{self.emergency()}<dl class="cc-grid">{groups}</dl>'
                f'<p class="cc-more"><a href="#pc-{E(aid)}">{E(self.fmt("full_panel", name=a["name"]))}</a></p></div>')

    def area_full(self, aid):
        a = self.areas[aid]
        secs = ''.join(f'<section{" class=" + chr(34) + E(g["tone"]) + chr(34) if g.get("tone") else ""}><h4>{E(g["title"])}</h4><ul>{self.area_items(g.get("items") or [], False, f"areas.{aid}")}</ul></section>'
                       for g in a.get('groups') or [])
        return (f'<article class="pc" id="pc-{E(aid)}"><header><h3>{E(a["name"])}</h3>'
                + (f'<p class="mono kicker">{E(a["used"])}</p>' if a.get('used') else '') + f'</header><div class="pc-grid">{secs}</div></article>')

    def area_order(self):
        order = (self.d.get('concierge') or {}).get('order') or list(self.areas)
        for a in order:
            if a not in self.areas:
                raise KitError(f'concierge.order: unknown area {a}')
        return order

    # ------------------------------------------------------------------ prose blocks
    def blocks(self, blocks, where):
        return ''.join(self.block(b, f'{where}[{i}]') for i, b in enumerate(blocks or []))

    def block(self, b, w):
        t = b.get('type')
        fact = ' data-fact' if b.get('facts') else ''
        if t == 'p':
            cls = {'fine': 'fine', 'quote': 'quote', 'offer': 'offer', 'lede': 'lede'}.get(b.get('style') or '', '')
            return f'<p{" class=" + chr(34) + cls + chr(34) if cls else ""}{fact}>{self.rich(b.get("text"), w)}</p>'
        if t == 'h3':
            return f'<h3 class="h-rule">{E(b.get("text"))}</h3>'
        if t == 'alert':
            return f'<div class="alert" role="note"><b>{E(b.get("title"))}</b> {self.rich(b.get("text"), w)}</div>'
        if t == 'list':
            cls = 'principles' if b.get('style') == 'principles' else 'mini'
            ul = f'<ul class="{cls}">' + ''.join(f'<li{fact}>{self.rich(x, w)}</li>' for x in b.get('items') or []) + '</ul>'
            head = f'<h3 class="h-rule">{E(b["title"])}</h3>' if b.get('title') else ''
            if b.get('box'):
                return f'<div class="{E(b["box"])}">{head}{ul}</div>'
            return head + ul
        if t == 'bases':
            return '<div class="bases">' + ''.join(
                f'<div class="base"><span class="mono">{E(x.get("label"))}</span><h3>{E(x.get("name"))}</h3><p>{E(x.get("text"))}</p><b>{E(x.get("note"))}</b></div>'
                for x in b.get('items') or []) + '</div>'
        if t == 'anchors':
            return '<div class="flights">' + ''.join(
                f'<div class="flight"><span class="mono">{E(x.get("label"))}</span><b>{E(x.get("code"))}</b>' + ''.join(f'<p>{E(l)}</p>' for l in x.get('lines') or []) + '</div>'
                for x in b.get('items') or []) + '</div>'
        if t == 'details':
            inner = ''.join(f'<p>{self.rich(x, w)}</p>' for x in b.get('paras') or [])
            if b.get('items'):
                inner += '<ul>' + ''.join(f'<li>{self.rich(x, w)}</li>' for x in b['items']) + '</ul>'
            cls = ' class="howto"' if b.get('style') == 'howto' else ''
            return f'<details{cls}><summary>{E(b.get("summary"))}</summary>{inner}</details>'
        if t == 'cards':
            layout = 'three' if b.get('layout') == 'three' else 'two'
            cls = ' class="stay"' if b.get('style') == 'stay' else ''
            arts = []
            for x in b.get('items') or []:
                k = f'<p class="mono kicker">{E(x["kicker"])}</p>' if x.get('kicker') else ''
                title = E(x.get('title'))
                if x.get('place'):
                    if x['place'] not in self.place_pid:
                        raise KitError(f'{w}: unknown place {x["place"]!r}')
                    title = self.pl_link(self.place_pid[x['place']], title, self.panels[self.place_pid[x['place']]]['anchor'])
                arts.append(f'<article{cls}>{k}<h3>{title}</h3>' + ''.join(f'<p{fact}>{self.rich(p, w)}</p>' for p in as_list(x.get('paras'))) + '</article>')
            return f'<div class="{layout}">' + ''.join(arts) + '</div>'
        if t == 'columns':
            return '<div class="two">' + ''.join(f'<div>{self.blocks(col, w + ".columns")}</div>' for col in b.get('columns') or []) + '</div>'
        if t == 'table':
            num = set(b.get('num') or [])
            head = ''.join(f'<th scope="col">{E(h)}</th>' for h in b.get('head') or [])
            rows = []
            for r in b.get('rows') or []:
                cells = []
                for ci, c in enumerate(r):
                    if isinstance(c, dict):
                        html = self.rich(c.get('text'), w) + (f'<br><span class="mono">{E(c["sub"])}</span>' if c.get('sub') else '')
                    else:
                        html = self.rich(c, w)
                    if ci == 0 and b.get('row_header'):
                        cells.append(f'<th scope="row">{html}</th>')
                    else:
                        cells.append(f'<td{" class=" + chr(34) + "num" + chr(34) if ci in num else ""}>{html}</td>')
                rows.append(f'<tr{fact}>' + ''.join(cells) + '</tr>')
            cls = f' class="{E(b["style"])}"' if b.get('style') else ''
            cap = f'<caption>{self.rich(b["caption"], w)}</caption>' if b.get('caption') else ''
            return f'<div class="tablewrap"><table{cls}>{cap}<thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
        if t == 'checks':
            items = []
            for x in b.get('items') or []:
                name = x.get('name') or ''
                if name and not ID.match(name):
                    raise KitError(f'{w}: checkbox name {name!r}')
                items.append(f'<li><label><input type="checkbox" name="{E(name)}"> <span><b>{E(x.get("title"))}</b> {self.rich(x.get("text"), w)}</span></label></li>')
            return '<ul class="checks">' + ''.join(items) + '</ul>'
        if t == 'budget':
            return '<div class="budget">' + ''.join(f'<div><span class="mono">{E(x.get("label"))}</span><p>{self.rich(x.get("text"), w)}</p></div>' for x in b.get('items') or []) + '</div>'
        if t == 'emergency':
            return self.emergency()
        raise KitError(f'{w}: unknown block type {t!r}')

    def head(self, s, w):
        out = f'<p class="mono kicker">{E(s["kicker"])}</p>' if s.get('kicker') else ''
        out += f'<h2>{self.accent(s["title"])}</h2>' if s.get('title') else ''
        cls = ' class="fine"' if s.get('intro_style') == 'fine' else ''
        out += ''.join(f'<p{cls}>{self.rich(p, w + ".intro")}</p>' for p in as_list(s.get('intro')))
        return out

    def prose(self, sid):
        s = self.d.get(sid)
        if not s and not (sid == 'stays' and self.d.get('worship')):
            return ''
        s = s or {}
        alert = self.block(dict(s['alert'], type='alert'), sid + '.alert') if s.get('alert') else ''
        cats = norm_cats(s.get('cat') or {'stays': 'stays', 'transport': 'transport', 'holidays': 'weather'}.get(sid), sid + '.cat')
        extra = self.worship_block() if sid == 'stays' else ''
        return f'<section id="{sid}" class="sec"{self.cats_attr(cats)}>{alert}{self.head(s, sid)}{self.blocks(s.get("blocks"), sid + ".blocks")}{extra}</section>'

    # ------------------------------------------------------------------ the opener
    def first_role(self, sid):
        for day in self.days:
            for p in ('stops', 'plan_b', 'plan_c'):
                for it in day.get(p) or []:
                    if it.get('stop') == sid and it.get('role'):
                        return it['role']
        return ''

    def ocard(self, sid, where):
        st = self.stops[sid]
        anchor = self.stop_anchor(sid)
        cats = self.stop_cats.get(sid) or []
        ph = ''
        if st.get('photos'):
            p = self.photo(st['photos'][0], where)
            ph = (f'<figure class="ocard-ph"><a href="#{E(anchor)}" tabindex="-1" aria-hidden="true">'
                  f'<img src="{E(p["src"])}" alt="{E(p["alt"])}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>'
                  f'<figcaption><span class="credit">{self.credit(p, original=False)}</span></figcaption></figure>')
        web = next((it for it in st.get('links') or [] if it.get('kind', 'web') == 'web'), None)
        web_html = f'<a class="ocard-web" href="{E(check_url(web["url"], where))}" target="_blank" rel="noopener">🌐 {E(self.L["website"])}</a>' if web else ''
        line = st.get('line') or self.first_role(sid)
        return (f'<article class="ocard"{self.cats_attr(cats)}>{ph}<div class="ocard-b">{self.cat_chips(cats)}'
                f'<a class="ocard-t" href="#{E(anchor)}" data-place="{E(self.place_pid[st["place"]])}"><h4>{E(st["name"])}</h4>' + (f'<p>{E(line)}</p>' if line else '') + f'</a>{web_html}</div></article>')

    def globe_svg(self, gid, label):
        return (f'<svg class="globe" data-globe viewBox="0 0 400 400" role="img" aria-label="{E(label)}" tabindex="0">'
                f'<defs><radialGradient id="{gid}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#ffffff"/>'
                f'<stop offset=".72" stop-color="#f7f2e8"/><stop offset="1" stop-color="#e6d9bf"/></radialGradient></defs>'
                f'<circle class="g-sphere" cx="200" cy="200" r="180" fill="url(#{gid})"/><path class="g-grat"/><path class="g-dots"/>'
                f'<path class="g-coast"/><path class="g-arc"/><g class="g-pins"></g><circle class="g-rim" cx="200" cy="200" r="180"/></svg>')

    def opener_points(self):
        o = self.opener_d
        stays = [self.places[self.stops[s]['place']] for s in o.get('stays') or []]
        dest = o.get('destination') or (dict(name=stays[0]['name'], lat=stays[0]['lat'], lng=stays[0]['lng']) if stays else None)
        if not dest:
            p = self.places[self.days[0]['route'][0]]
            dest = dict(name=p['name'], lat=p['lat'], lng=p['lng'])
        bases = []
        for p in stays:
            if all(abs(p['lat'] - b['lat']) + abs(p['lng'] - b['lng']) > 0.05 for b in bases):
                bases.append(dict(lat=p['lat'], lng=p['lng']))
        return dest, bases

    def trip_dates(self):
        o = self.opener_d
        isos = [d['iso'] for d in self.days if d.get('iso')]
        return o.get('start') or (min(isos) if isos else ''), o.get('end') or (max(isos) if isos else '')

    def opener_html(self):
        o = self.opener_d
        if not o:
            return ''
        m = self.d['masthead']
        title = o.get('title') or m['title']
        slides = []
        for i, pid in enumerate(o['hero']):
            p = self.photo(pid, 'opener.hero')
            slides.append(f'<figure class="hero-slide{" on" if i == 0 else ""}"><img src="{E(p["src"])}" alt="{E(p["alt"])}" decoding="async"'
                          f' loading="{"eager" if i < 2 else "lazy"}" referrerpolicy="no-referrer">'
                          f'<figcaption><span class="credit">{self.credit(p, original=False)}</span></figcaption></figure>')
        start, end = self.trip_dates()
        dest, _ = self.opener_points()
        live = ''
        if start:
            live += f'<span class="cd" id="op-count" data-start="{E(start)}" data-end="{E(end)}" hidden></span>'
        if o.get('tz'):
            live += f'<span class="lt" id="op-time" data-tz="{E(o["tz"])}" data-place="{E(o.get("tz_place") or dest["name"])}" hidden></span>'
        tldr = ''.join(f'<li>{self.rich(x, "opener.tldr")}</li>' for x in as_list(o.get('tldr')))
        alerts = ''.join(f'<li><a class="chip-alert" href="{E(a["href"])}"><span aria-hidden="true">{E(a.get("icon") or "⚠️")}</span> {E(a["text"])}</a></li>'
                         for a in o.get('alerts') or [])
        home = o.get('home')
        glabel = self.fmt('tour_from', home=home['name'], dest=dest['name']) if home else dest['name']
        globe = (f'<figure class="op-globe">{self.globe_svg("g-sea-1", glabel)}<figcaption class="fine">{E(self.L["op_globe_hint"])} '
                 f'Land: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>.</figcaption></figure>')
        stays = ''.join(self.ocard(s, 'opener.stays') for s in o.get('stays') or [])
        highs = ''.join(self.ocard(s, 'opener.highlights') for s in o.get('highlights') or [])
        return (f'<section id="opener" class="opener" aria-label="{E(title)}">'
                f'<div class="hero"><div class="hero-slides">{"".join(slides)}</div><div class="hero-in">'
                + (f'<p class="mono kicker hero-k">{E(o.get("kicker") or m.get("kicker"))}</p>' if (o.get('kicker') or m.get('kicker')) else '')
                + f'<h1 class="hero-t">{self.accent(title)}</h1>'
                + (f'<p class="hero-dates">{E(o["dates"])}</p>' if o.get('dates') else '')
                + (f'<p class="hero-live">{live}</p>' if live else '')
                + f'<p class="hero-ctas"><button type="button" class="btn-gold btn-hero" id="play-trip"><span aria-hidden="true">▶</span> {E(self.L["op_play"])}</button>'
                f'<a class="btn-hero2" href="#top">{E(self.L["op_read"])} <span aria-hidden="true">↓</span></a></p></div></div>'
                f'<div class="op-body"><div class="op-grid"><div class="op-tldr"><p class="mono kicker">TL;DR</p><h2>{E(self.L["op_tldr"])}</h2>'
                + (f'<ol class="tldr">{tldr}</ol>' if tldr else '')
                + (f'<ul class="op-alerts" aria-label="{E(self.L["op_alerts"])}">{alerts}</ul>' if alerts else '')
                + f'</div>{globe}</div>'
                + (f'<h3 class="h-rule op-h"><span aria-hidden="true">🏨</span> {E(self.L["op_stays"])}</h3><div class="ocards">{stays}</div>' if stays else '')
                + (f'<h3 class="h-rule op-h"><span aria-hidden="true">✨</span> {E(self.L["op_highlights"])}</h3><div class="ocards">{highs}</div>' if highs else '')
                + self.legend() + '</div></section>')

    def tour_html(self):
        if not self.opener_d:
            return ''
        return (f'<div class="tour" id="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" hidden>'
                f'<div class="tour-stage"><div class="tour-globe">{self.globe_svg("g-sea-2", self.L["tour_way"])}</div><div class="tour-map"></div>'
                f'<figure class="tour-big"><img alt=""></figure></div>'
                f'<div class="tour-card"><figure class="tour-ph"><img alt=""><figcaption><span class="credit tour-credit"></span></figcaption></figure>'
                f'<div class="tour-txt"><p class="mono kicker tour-k"></p><h2 class="tour-t" id="tour-title"></h2><p class="tour-l"></p></div>'
                f'<div class="tour-ctl"><button type="button" class="tour-prev">‹ {E(self.L["tour_prev"])}</button>'
                f'<button type="button" class="tour-pause">{E(self.L["tour_pause"])}</button>'
                f'<button type="button" class="tour-next">{E(self.L["tour_next"])} ›</button>'
                f'<button type="button" class="tour-close" aria-label="{E(self.L["tour_close"])}">×</button></div>'
                f'<div class="tour-bar" aria-hidden="true"><i></i></div></div></div>')

    _pins = None

    def nearby_pins(self):
        """Every nearby alternative and place of worship, for the map's own pin layer."""
        if self._pins is not None:
            return self._pins
        pins = []
        for sid, st in self.stops.items():
            anchor = self.stop_anchor(sid)
            n = int(re.match(r'd(\d+)', anchor).group(1)) if anchor else 1
            for x in st.get('nearby') or []:
                if x.get('lat') is None:
                    continue
                pins.append(dict(name=x['name'], cats=norm_cats(x.get('cat'), 'nearby.cat'), lat=x['lat'], lng=x['lng'], day=n - 1, near=st['name']))
        for g in self.d.get('worship') or []:
            for x in g.get('items') or []:
                if x.get('lat') is None:
                    continue
                pins.append(dict(name=x['name'], cats=norm_cats(x.get('cat') or 'worship', 'worship.cat'), lat=x['lat'], lng=x['lng'], day=-1, near=''))
        for i, day in enumerate(self.days):
            for x in day.get('nearby') or []:
                if x.get('lat') is not None and x.get('cat'):
                    pins.append(dict(name=x['name'], cats=norm_cats(x.get('cat'), 'nearby.cat'), lat=x['lat'], lng=x['lng'], day=i, near=''))
        self._pins = pins
        return pins

    def tour_steps(self):
        steps = []
        for i, day in enumerate(self.days):
            for it in day['stops']:
                st = self.stops[it['stop']]
                idx = day['route'].index(st['place']) if st['place'] in day['route'] else -1
                pl = self.places[st['place']]
                steps.append(dict(d=i, idx=idx, id=f'd{i + 1}-{it["stop"]}', name=st['name'], line=st.get('line') or it.get('role') or '',
                                  when=f'{self.L["day"]} {i + 1} · {day["when"]}', lat=pl['lat'], lng=pl['lng']))
        return steps

    # ------------------------------------------------------------------ fixed sections
    def masthead(self):
        m = self.d['masthead']
        facts = ''.join(f'<li><span class="mono">{E(f.get("label"))}</span><b{" class=" + chr(34) + "status" + chr(34) if f.get("status") else ""}>{E(f.get("value"))}</b></li>'
                        for f in m.get('facts') or [])
        return (f'<header class="mast" id="top"><div class="mast-in">'
                + (f'<p class="mono kicker">{E(m["kicker"])}</p>' if m.get('kicker') else '')
                + (f'<h2 class="mast-h">{self.accent(m["title"])}</h2>' if self.opener_d else f'<h1>{self.accent(m["title"])}</h1>')
                + (f'<p class="lede">{E(m["lede"])}</p>' if m.get('lede') else '')
                + (f'<ul class="facts" aria-label="{E(self.L["trip_facts"])}">{facts}</ul>' if facts else '')
                + f'<div class="mast-bar"><p class="mono edition">{E(m.get("edition"))}</p>'
                f'<div class="mode" role="group" aria-label="{E(self.L["display_mode"])}">'
                f'<button type="button" data-set-mode="light" aria-pressed="true">{E(self.L["mode_light"])}</button>'
                f'<button type="button" data-set-mode="print" aria-pressed="false">{E(self.L["mode_print"])}</button>'
                f'<button type="button" id="print-btn" class="btn-ghost">{E(self.L["print_pdf"])}</button></div></div></div></header>')

    def present(self):
        order = (self.d.get('page') or {}).get('order') or SECTION_ORDER
        out = []
        for s in order:
            if s not in SECTION_ORDER:
                raise KitError(f'page.order: unknown section {s}')
            if s in ('map', 'days', 'credits', 'sources') or self.d.get(s) or (s == 'concierge' and self.areas) or (s == 'stays' and self.d.get('worship')):
                if s == 'upgrades' and not (self.d.get('upgrades') or {}).get('groups'):
                    continue
                out.append(s)
        return out

    def topnav(self, present):
        nav = self.d.get('nav') or {}
        items = nav.get('items') or (present[:1] + ['@days'] + present[1:])
        labels = dict(NAV_DEFAULT)
        labels.update(nav.get('labels') or {})
        for s in present:
            if isinstance(self.d.get(s), dict) and self.d[s].get('nav'):
                labels[s] = self.d[s]['nav']
        out = []
        for it in items:
            if it == '@days':
                lab = f'<span class="tn-lab">{E(nav["days_label"])}</span>' if nav.get('days_label') else ''
                out.append(f'<span class="tn-days" role="group" aria-label="{E(self.L["nav_days"])}">{lab}' + ''.join(
                    f'<a class="tn-day" href="#day-{i + 1}" data-day="{i}" aria-label="{E(self.L["day"])} {i + 1}, {E(d["when"])}">{E(self.short(d))}</a>'
                    for i, d in enumerate(self.days)) + '</span>')
            elif it in present:
                href = 'map-centre' if it == 'map' else it
                out.append(f'<a href="#{href}">{E(labels.get(it, it))}</a>')
        return f'<nav class="topnav" aria-label="{E(self.L["nav"])}">' + ''.join(out) + '</nav>'

    def short(self, d):
        if d.get('short'):
            return str(d['short'])
        if d.get('iso'):
            return str(int(d['iso'][8:10]))
        m = re.search(r'\d+', d['when'])
        return m.group(0) if m else d['when'][:3]

    def map_section(self):
        m = self.d.get('map') or {}
        notes = m.get('notes') or {}
        note = lambda k: self.rich(notes[k], 'map.notes') if notes.get(k) else E(self.L['map_note_' + k])
        return (f'<aside id="map-centre" class="mapc" aria-label="{E(self.L["map_aria"])}"><div class="mapc-in"><div class="mapc-head">'
                f'<p class="mono kicker">{E(m.get("kicker") or self.L["map_kicker"])}</p><label class="sr" for="mc-day">{E(self.L["day_label"])}</label>'
                f'<select id="mc-day" aria-label="{E(self.L["choose_day"])}"></select></div>'
                f'<div class="tabs" role="tablist" aria-label="{E(self.L["map_views"])}">'
                f'<button type="button" role="tab" id="tab-route" aria-controls="panel-route" aria-selected="true">{E(self.L["tab_route"])}</button>'
                f'<button type="button" role="tab" id="tab-pin" aria-controls="panel-pin" aria-selected="false" tabindex="-1">{E(self.L["tab_pin"])}</button>'
                f'<button type="button" role="tab" id="tab-dir" aria-controls="panel-dir" aria-selected="false" tabindex="-1">{E(self.L["tab_dir"])}</button></div>'
                f'<div class="panel" id="panel-route" role="tabpanel" aria-labelledby="tab-route"><div class="mc-tools">'
                f'<button type="button" id="fly" class="btn-gold">{E(self.L["fly"])}</button>'
                f'<button type="button" class="btn-ghost near-me" data-near-me><span aria-hidden="true">📍</span> {E(self.L["near_me"])}</button>'
                + (f'<label class="check"><input type="checkbox" id="mc-safety"> {E(m.get("safety_label") or self.L["safety"])}</label>' if self.d.get('safety') else '')
                + (f'<label class="check"><input type="checkbox" id="mc-nearby"> {E(self.L["nearby_pins"])}</label>' if self.nearby_pins() else '')
                + f'</div>' + (self.legend(compact=True) if self.opener_d else '') + f'<div id="leaflet" class="mapbox" role="region" aria-label="{E(self.L["route_map"])}"></div><ol id="mc-stops" class="mc-stops"></ol>'
                f'<p class="fine">{note("route")}</p></div>'
                f'<div class="panel" id="panel-pin" role="tabpanel" aria-labelledby="tab-pin" hidden><label class="sr" for="mc-stop">{E(self.L["stop_label"])}</label>'
                f'<select id="mc-stop" aria-label="{E(self.L["choose_stop"])}"></select><div class="mapbox gbox" id="pin-box"></div><p class="fine">{note("pin")}</p></div>'
                f'<div class="panel" id="panel-dir" role="tabpanel" aria-labelledby="tab-dir" hidden><label class="sr" for="mc-leg">{E(self.L["leg_label"])}</label>'
                f'<select id="mc-leg" aria-label="{E(self.L["choose_leg"])}"></select><div class="mapbox gbox" id="dir-box"></div><p class="fine">{note("dir")}</p></div>'
                f'</div></aside>')

    def days_section(self):
        s = self.d.get('days_section') or {}
        return f'<section id="days" class="sec">{self.head(s, "days_section")}' + ''.join(self.day_html(d, i) for i, d in enumerate(self.days)) + '</section>'

    def concierge(self):
        c = self.d.get('concierge') or {}
        order = self.area_order()
        notes = ''.join(f'<li>{self.rich(x, "concierge.notes")}</li>' for x in c.get('notes') or [])
        chips = ''.join(f'<a class="chip" href="#pc-{E(a)}">{E(self.areas[a]["name"])}</a>' for a in order)
        return (f'<section id="concierge" class="sec">{self.head(c, "concierge")}{self.emergency()}'
                + (f'<ul class="mini">{notes}</ul>' if notes else '')
                + f'<nav class="chips" aria-label="{E(self.L["areas"])}">{chips}</nav>' + ''.join(self.area_full(a) for a in order) + '</section>')

    def audience_section(self):
        a = self.audience
        out = f'<section id="audience" class="sec" data-audience="{a["mode"]}">{self.head(a, "audience")}'
        if a['mode'] == 'party':
            out += '<div class="party">' + ''.join(
                f'<article class="traveller"><span class="mono">{E(t.get("label"))}</span>' + (f'<h3>{E(t["name"])}</h3>' if t.get('name') else '')
                + f'<p>{self.rich(t.get("detail"), "audience.travellers")}</p></article>' for t in a.get('travellers') or []) + '</div>'
            if a.get('needs'):
                out += (f'<p class="needs"><b>{E(self.L["party_needs"])}:</b> '
                        + ' · '.join(f'<span class="suit need" data-mark="{m}"><span aria-hidden="true">{self.marks[m][0]}</span> {E(MARK_NAMES[m])}</span>' for m in a['needs']) + '</p>')
        else:
            btns = [f'<button type="button" class="lens-btn" data-lens="" aria-pressed="true">{E(self.L["lens_all"])}</button>']
            cards = []
            for l in a['lenses']:
                icon = f'<span aria-hidden="true">{E(l["icon"])}</span> ' if l.get('icon') else ''
                btns.append(f'<button type="button" class="lens-btn" data-lens="{E(l["key"])}" aria-pressed="false">{icon}{E(l["label"])}</button>')
                needs = ', '.join(MARK_NAMES[m] for m in l.get('needs') or [])
                cards.append(f'<article class="lens-card" data-lens-card="{E(l["key"])}"><h3>{icon}{E(l["label"])}</h3><p>{self.rich(l.get("intro"), "audience.lenses")}</p>'
                             + (f'<p class="mono">{E(self.L["lens_looks_for"])}: {E(needs)}</p>' if needs else '') + '</article>')
            out += (f'<div class="lens-switch" role="group" aria-label="{E(self.L["lens_choose"])}">' + ''.join(btns) + '</div>'
                    f'<div class="lens-cards">{"".join(cards)}</div><p class="fine">{E(self.L["lens_note"])}</p>')
        legend = ' · '.join(f'<span aria-hidden="true">{icon}</span> {E(MARK_NAMES[m])}' for m, (icon, _) in self.marks.items())
        out += ''.join(f'<p>{self.rich(x, "audience.notes")}</p>' for x in a.get('notes') or [])
        return out + f'<p class="fine marks-legend">{legend}</p></section>'

    def plans_section(self):
        p = self.plans
        keys = ''.join(f'<article><p class="mono kicker">{E(self.fmt("plan", p=k.upper()))}</p><h3>{E(self.plan_label(k))}</h3><p>{self.rich((p.get("explain") or {}).get(k), "plans.explain")}</p></article>'
                       for k in PLANS)
        rules = ''.join(f'<li>{E(r["text"])}</li>' for r in p.get('rules') or [])
        out = f'<section id="plans" class="sec">{self.head(p, "plans")}<div class="three plan-keys">{keys}</div>'
        if rules:
            out += f'<h3 class="h-rule">{E(p.get("rules_title") or self.L["plans_rules"])}</h3><ol class="mini rules">{rules}</ol>'
        wx = self.weather
        if wx:
            out += f'<h3 class="h-rule">{E(wx.get("title") or "Live forecast")}</h3>' + ''.join(f'<p>{self.rich(x, "weather.intro")}</p>' for x in as_list(wx.get('intro')))
            out += '<ul class="mini wx-places">' + ''.join(
                f'<li><b>{E(pl.get("label") or pl["key"])}</b>: {E(human_date(parse_date(pl["start"], "s")))} {E(self.L["to"])} {E(human_date(parse_date(pl["end"], "e")))}</li>'
                for pl in wx.get('places') or []) + '</ul>'
            out += (f'<p class="fine wx-credit">{E(self.L["wx_credit"])} <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>'
                    f' · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">{E(self.L["wx_licence"])}</a></p>')
        return out + '</section>'

    def upgrades_section(self):
        u = self.d['upgrades']
        out = f'<section id="upgrades" class="sec">{self.head(u, "upgrades")}<p class="upg-note" role="note">{E(u.get("note") or self.L["upg_note"])}</p>'
        for gi, g in enumerate(u.get('groups') or []):
            title = g.get('title') or (self.areas.get(g.get('area')) or {}).get('name') or g.get('area') or ''
            cards = []
            for ii, x in enumerate(g.get('items') or []):
                w = f'upgrades.groups[{gi}].items[{ii}]'
                ph = self.small_photo(x['photo'], w + '.photo', 'near-photo') if x.get('photo') else ''
                srcs = ' '.join(self.src_tag(s, where=w) for s in as_list(x['source']))
                place = self.places.get(x.get('place')) if x.get('place') else None
                links = self.link_row(x.get('links'), place, where=w + '.links') if (x.get('links') or place) else ''
                cards.append(f'<article class="upg" data-fact>{ph}<div class="upg-b"><p class="mono kicker">{E(self.L["upg_tag"])}</p><h4>{E(x["name"])}</h4>'
                             f'<p>{self.rich(x["line"], w + ".line")}</p><dl class="upg-dl"><div><dt>{E(self.L["upg_price"])}</dt><dd>{self.rich(x["price"], w)}</dd></div>'
                             f'<div><dt>{E(self.L["upg_book"])}</dt><dd>{self.rich(x["book_ahead"], w)}</dd></div></dl>'
                             f'<p class="upg-src">{E(self.L["upg_source"])}: {srcs}</p>{links}</div></article>')
            out += (f'<h3 class="h-rule">{E(title)}</h3>' if title else '') + f'<div class="upg-grid">{"".join(cards)}</div>'
        return out + '</section>'

    def credits_section(self):
        c = self.d.get('credits') or {}
        rows = []
        for pid, p in self.photos.items():
            parts = [f'<b>{E(p["cap"])}</b>']
            if p.get('file') and p.get('host') and p.get('credit_url'):
                lic = self.ext_link(p['licence_url'], p.get('licence') or 'licence') if p.get('licence_url') else E(p.get('licence') or '')
                parts.append(f'"{E(p["file"])}" {E(self.L["by"])} {E(p["credit"])}, {self.ext_link(p["credit_url"], p["host"])}, {E(self.L["licensed"])} {lic}.')
                note = p.get('note') or c.get('library_note')
            else:
                who = self.ext_link(p['credit_url'], p['credit']) if p.get('credit_url') else E(p['credit'])
                parts.append(f'{E(p.get("credit_prefix") or self.L["photo"])}: {who}.')
                if p.get('licence_url'):
                    parts.append(f'{E(self.L["licensed"]).capitalize()} {self.ext_link(p["licence_url"], p.get("licence") or "licence")}.')
                elif p.get('licence'):
                    parts.append(f'{E(p["licence"])}.')
                if p['src'].startswith('https://') and not p.get('licence_url'):
                    parts.append(self.ext_link(p['src'], self.L['image_url']) + '.')
                note = p.get('note')
            if note:
                parts.append(E(note))
            rows.append('<li>' + ' '.join(parts) + '</li>')
        globe = ''
        if self.opener_d:
            globe = (f'<p class="fine globe-credit">{E(self.L["globe_credit"])} '
                     f'<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> · '
                     f'<a href="https://github.com/topojson/world-atlas" target="_blank" rel="noopener">world-atlas</a></p>')
        return f'<section id="credits" class="sec">{self.head(c, "credits")}<ul class="credits">{"".join(rows)}</ul>{globe}</section>'

    def sources_section(self):
        s = self.d.get('sources_page') or {}
        seen, rows, carried = {'checked': set(), 'carried': set()}, [], []
        for key, x in self.sources.items():
            u, tier = x.get('url'), x.get('tier') or 'checked'
            if not u or u in seen[tier]:
                continue
            seen[tier].add(u)
            if tier == 'carried':
                carried.append(f'<li>{self.ext_link(u, u.split("//", 1)[-1][:70])}</li>')
            else:
                when = f' <span class="mono">opened {E(x["opened"])}</span>' if x.get('opened') else ''
                rows.append(f'<li>{self.ext_link(u, x.get("title") or x["label"])}{when}</li>')
        out = f'<section id="sources" class="sec">{self.head(s, "sources_page")}<ol class="srclist">{"".join(rows)}</ol>'
        if carried:
            out += f'<details><summary>{E(s.get("carried_summary") or self.L["carried_summary"])}</summary><ul class="srclist">{"".join(carried)}</ul></details>'
        return out + self.blocks(s.get('blocks'), 'sources_page.blocks') + '</section>'

    def footer(self):
        f = self.d.get('footer') or {}
        return (f'<footer class="foot sec">' + (f'<p class="mono kicker">{E(f["kicker"])}</p>' if f.get('kicker') else '')
                + ''.join(f'<p>{self.rich(x, "footer.text")}</p>' for x in as_list(f.get('text')))
                + f'<p class="fine">{self.rich(f.get("fine"), "footer.fine")} <a href="#top">{E(self.L["back_to_top"])}</a></p></footer>')

    def rail(self):
        marks = []
        for i, d in enumerate(self.days):
            n = i + 1
            marks.append(f'<a class="rail-mark day" href="#day-{n}" data-day="{i}" data-tip="{E(self.L["day"])} {n} · {E(d["when"])} · {E(d["title"])}" aria-label="{E(self.L["day"])} {n}, {E(d["when"])}"><i></i><b>{E(self.short(d))}</b></a>')
            for it in d['stops']:
                nm = self.stops[it['stop']]['name']
                marks.append(f'<a class="rail-mark" href="#d{n}-{E(it["stop"])}" data-tip="{E(self.L["day"])} {n} · {E(nm)}" aria-label="{E(self.L["day"])} {n}: {E(nm)}" tabindex="-1"><i></i></a>')
        return (f'<nav class="rail" aria-label="{E(self.L["rail"])}"><div class="rail-track"><div class="rail-fill"></div></div>' + ''.join(marks)
                + f'<div class="rail-thumb"><span class="rail-tip">{E(self.L["rail_start"])}</span></div></nav>')

    def lightbox(self):
        return (f'<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="{E(self.L["lightbox"])}" hidden>'
                f'<button type="button" class="lb-close" aria-label="{E(self.L["lb_close"])}">×</button>'
                f'<button type="button" class="lb-prev" aria-label="{E(self.L["lb_prev"])}">‹</button>'
                f'<figure><img alt=""><figcaption><span class="lb-cap"></span><span class="lb-credit"></span></figcaption></figure>'
                f'<button type="button" class="lb-next" aria-label="{E(self.L["lb_next"])}">›</button></div>')

    def sheet_html(self):
        """The place panel: from the bottom on a phone, from the side on a wider screen. Its contents are
        built by the page's script from the panel data, with text nodes only."""
        return (f'<div class="sheet" id="sheet" hidden><div class="sheet-scrim" data-sheet-close></div>'
                f'<section class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-h" aria-label="{E(self.L["sheet_aria"])}">'
                f'<div class="sheet-grip" aria-hidden="true"><i></i></div>'
                f'<header class="sheet-top"><p class="mono kicker sheet-k"></p><h3 id="sheet-h" tabindex="-1"></h3>'
                f'<button type="button" class="sheet-x" data-sheet-close aria-label="{E(self.L["sheet_close"])}">×</button></header>'
                f'<div class="sheet-body"></div></section></div>'
                f'<p class="toast" role="status" aria-live="polite" hidden></p>')

    # ------------------------------------------------------------------ data for the page's script
    def trip_json(self):
        meta = self.d['meta']
        days = []
        for i, d in enumerate(self.days):
            stops = [dict(id=p, letter=LETTERS[j], name=self.places[p]['name'], lat=self.places[p]['lat'], lng=self.places[p]['lng'],
                          q=self.places[p]['q'], note=self.places[p].get('note') or '') for j, p in enumerate(d['route'])]
            legs = []
            walk = set(d.get('walk') or [])
            for a, b in zip(d['route'], d['route'][1:]):
                k = f'{a}>{b}'
                pa, pb = self.places[a], self.places[b]
                if k in walk:
                    legs.append(dict(a=a, b=b, walk=True, path=[[pa['lat'], pa['lng']], [pb['lat'], pb['lng']]]))
                else:
                    g = self.legs[k]
                    legs.append(dict(a=a, b=b, walk=False, km=g.get('km'), min=g.get('min'), path=g.get('path') or [[pa['lat'], pa['lng']], [pb['lat'], pb['lng']]]))
            place_cats = {}
            for it in d['stops']:
                place_cats.setdefault(self.stops[it['stop']]['place'], [])
                place_cats[self.stops[it['stop']]['place']] += [c for c in self.stop_cats.get(it['stop']) or [] if c not in place_cats[self.stops[it['stop']]['place']]]
            for s in stops:
                s['cats'] = place_cats.get(s['id'], [])
            days.append(dict(n=i + 1, label=f'{self.L["day"]} {i + 1} · {d["when"]}', title=d['title'], iso=d.get('iso') or '',
                             weather=d.get('weather') or '', stops=stops, legs=legs))
        ui = {k: self.L[k] for k in ('fly', 'fly_stop', 'short_walk', 'optional', 'map_fallback', 'tiles_notice', 'wx_from', 'wx_error', 'wx_past', 'wx_none',
                                     'wx_frame', 'wx_credit', 'wx_licence', 'wx_rain', 'wx_gust', 'wx_wind', 'wx_uv', 'wx_suggests', 'wx_fits',
                                     'wx_no_plan', 'wx_max_min', 'plans_rules', 'lens_fits', 'lens_check', 'lens_unknown', 'lens_for', 'rail_start', 'to',
                                     'cd_to_go', 'cd_one', 'cd_today', 'cd_during', 'local_time', 'lg_lit', 'lg_none', 'tour_pause', 'tour_play',
                                     'tour_from', 'tour_way', 'nearby_pins', 'photo_spot', 'share', 'share_day', 'shared', 'copied',
                                     'near_me', 'near_title', 'near_wait', 'near_note', 'near_declined', 'near_denied', 'near_unavailable',
                                     'near_unsupported', 'near_none', 'about_km', 'new_tab', 'ig_posts', 'address', 'website', 'google_maps',
                                     'alt_map', 'hours', 'embed_note', 'call', 'stop_details')}
        ui['months'] = self.L.get('months') or MONTHS
        ui['wmo'] = {str(k): list(v) for k, v in WMO.items()}
        ui['marks'] = MARK_NAMES
        out = dict(id=meta.get('id') or re.sub(r'[^a-z0-9]+', '-', meta['title'].lower()).strip('-')[:40], trip=meta.get('trip') or meta['title'],
                   status=meta.get('status') or '', tz=meta.get('tz') or '', days=days, ui=ui,
                   safety=[dict(kind=s['kind'], name=s['name'], lat=s['lat'], lng=s['lng']) for s in self.d.get('safety') or []],
                   tiles=dict(provider=self.tiles['provider'], url=self.tile_url()))
        if self.weather:
            out['weather'] = dict(places=[dict(key=p['key'], lat=p['lat'], lon=p['lon'], start=p['start'], end=p['end']) for p in self.weather.get('places') or []])
        if self.plans:
            out['plans'] = dict(rules=[dict(plan=r['plan'], metric=r['metric'], op=r['op'], value=r['value'], text=r.get('short') or r['text'])
                                       for r in self.plans.get('rules') or []],
                                labels={p: self.plan_label(p) for p in PLANS})
        if self.audience:
            out['audience'] = dict(mode=self.audience['mode'], needs=self.audience.get('needs') or [],
                                   lenses=[dict(key=l['key'], label=l['label'], needs=l.get('needs') or []) for l in self.audience.get('lenses') or []])
        out['cats'] = {k: [icon, self.cat_labels[k]] for k, icon, _ in CATS}
        out['nearby'] = self.nearby_pins()
        out['panels'] = {k: v for k, v in self.panels.items() if v}
        if self.opener_d:
            o = self.opener_d
            dest, bases = self.opener_points()
            start, end = self.trip_dates()
            out['opener'] = dict(start=start, end=end, tz=o.get('tz') or '', home=o.get('home'), dest=dict(name=dest['name'], lat=dest['lat'], lng=dest['lng']),
                                 bases=bases)
            out['tour'] = self.tour_steps()
        return out

    # ------------------------------------------------------------------ the page
    def render(self):
        meta = self.d['meta']
        present = self.present()
        css = read_asset('kit.css').replace('/*MAP-ROWS*/12', str(max(12, len(present) + 1)))
        js = read_asset('kit.js')
        parts = {'map': self.map_section, 'days': self.days_section, 'concierge': self.concierge, 'audience': self.audience_section,
                 'plans': self.plans_section, 'upgrades': self.upgrades_section, 'credits': self.credits_section, 'sources': self.sources_section}
        body = ''.join(parts[s]() if s in parts else self.prose(s) for s in present)
        templates = ''.join(f'<template id="cc-{E(a)}">{self.area_compact(a)}</template>' for a in self.areas)
        # Atelier type (6 November 2026): Fraunces for display, with its italic for the accent words, and
        # Inter for text and the letter-spaced labels. Both are SIL Open Font Licence fonts on Google Fonts.
        fonts = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@300..700&display=swap'
        return ('<!doctype html>\n'
                f'<html lang="{E(meta["lang"])}" data-mode="light"{" class=" + chr(34) + "has-opener" + chr(34) if self.opener_d else ""}>\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="color-scheme" content="light">\n'
                f'<title>{E(meta["title"])}</title>\n'
                + (f'<meta name="description" content="{E(meta["description"])}">\n' if meta.get('description') else '')
                + f'<meta name="generator" content="travel-coffee-table kit">\n<link rel="stylesheet" href="{E(fonts)}">\n'
                '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">\n'
                f'<style>{css}</style>\n</head>\n<body>\n<a class="skip" href="#days">{E(self.L["skip"])}</a>\n'
                f'{self.opener_html()}\n{self.masthead()}\n{self.topnav(present)}\n<main class="layout">\n{body}\n{self.footer()}\n</main>\n'
                f'{self.rail()}\n{self.lightbox()}\n{self.sheet_html()}\n{self.tour_html()}\n{templates}\n'
                f'<script type="application/json" id="trip-data">{safe_json(self.trip_json())}</script>\n'
                + (f'<script type="application/json" id="globe-data">{safe_json(globe_data())}</script>\n' if self.opener_d else '')
                + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>\n'
                f'<script>{js}</script>\n</body>\n</html>\n')


def read_asset(name):
    with open(os.path.join(ASSETS, name), encoding='utf-8') as f:
        return f.read()


def build(data):
    return Page(data).render()


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ====================================================================== check mode
class Node:
    __slots__ = ('tag', 'attrs', 'children', 'parent', 'line')
    GAPS = {'td', 'th', 'li', 'p', 'div', 'br', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'section', 'article'}

    def __init__(self, tag, attrs, parent, line=0):
        self.tag, self.attrs, self.children, self.parent, self.line = tag, attrs, [], parent, line

    def iter(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def text(self):
        out = []
        for c in self.children:
            if isinstance(c, str):
                out.append(c)
            elif c.tag not in ('script', 'style', 'template'):
                out.append(c.text())
                if c.tag in self.GAPS:
                    out.append(' ')
        return ''.join(out)

    def classes(self):
        return set((self.attrs.get('class') or '').split())

    def up(self, pred):
        n = self.parent
        while n is not None:
            if pred(n):
                return n
            n = n.parent
        return None


class Tree(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root', {}, None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag, {k: (v if v is not None else '') for k, v in attrs}, self.cur, self.getpos()[0])
        self.cur.children.append(n)
        if tag not in self.VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, {k: (v if v is not None else '') for k, v in attrs}, self.cur, self.getpos()[0]))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse_html(html):
    t = Tree()
    t.feed(html)
    t.close()
    return t.root


URL_ATTRS = ('href', 'src', 'poster', 'data-src', 'action', 'formaction', 'cite', 'background', 'data', 'srcset', 'data-pin-url')
BLANK = ('', '#', 'about:blank')
CREDIT_WORDS = re.compile(r'(?i)(©|\bphoto\b|\bphotograph|\bimage\b|\bpicture\b|\billustration\b|\bcredit|\bcourtesy\b|\bvia\b|\bCC[ -]?(?:BY|0)\b|\bpublic domain\b|\bWikimedia\b)')
# A checkable datum: a price, a phone number, a percentage, opening hours or a distance.
DATUM = re.compile(r'(?ix)(?:[$€£¥]\s?\d|\b(?:AUD|USD|EUR|GBP|SGD|NZD)\s?\d|\d\s?(?:%|per\s?cent)|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b'
                   r'|\b\d{1,2}:\d{2}\s?(?:to|-|–)\s?\d{1,2}:\d{2}\b|\b\d+(?:\.\d+)?\s?km\b|\(0\d\)\s?\d{4}|\+\d{2}\s?\d)')


def check_html(html, name='page'):
    """The owner's rules for a finished page. Returns a list of problems (empty when the page passes)."""
    root = parse_html(html)
    problems = []
    nodes = list(root.iter())
    # the photo viewer and the trip tour fill their frames from the page itself when they open
    in_lightbox = lambda n: n.up(lambda p: p.attrs.get('id') in ('lightbox', 'tour') or p.tag == 'template') is not None
    # 1. blank picture holders
    for n in nodes:
        if n.tag == 'img' and not in_lightbox(n):
            src = (n.attrs.get('src') or '').strip()
            if src.lower() in BLANK or src.lower().startswith('javascript:'):
                problems.append(('blank picture holder', f'line {n.line}: <img> with no picture ({n.attrs.get("alt", "")[:60]!r})'))
        cls = n.classes()
        if n.tag == 'figure' and cls & {'tile', 'near-photo'} and not any(c.tag == 'img' for c in n.iter()):
            problems.append(('blank picture holder', f'line {n.line}: empty photo frame'))
        if cls & {'placeholder', 'photo-slot', 'img-placeholder', 'image-placeholder'} and not any(c.tag in ('img', 'video') for c in n.iter()):
            problems.append(('blank picture holder', f'line {n.line}: placeholder with no picture'))
        if 'bento' in cls:
            tiles = [c for c in n.children if isinstance(c, Node) and 'tile' in c.classes()]
            if not tiles or n.attrs.get('data-count') not in (None, str(len(tiles))):
                problems.append(('blank picture holder', f'line {n.line}: photo grid expects {n.attrs.get("data-count")} photos, has {len(tiles)}'))
        if n.tag == 'video' and not (n.attrs.get('src') or any(c.tag == 'source' and c.attrs.get('src') for c in n.iter())):
            problems.append(('blank picture holder', f'line {n.line}: video with no source'))
    # 2. photos without credit
    for n in nodes:
        if n.tag in ('img', 'video') and not in_lightbox(n) and n.attrs.get('aria-hidden') != 'true':
            fig = n.up(lambda p: p.tag == 'figure')
            cap = next((c for c in fig.iter() if c.tag == 'figcaption'), None) if fig else None
            credit = None
            if cap is not None:
                credit = next((c for c in cap.iter() if 'credit' in c.classes()), None)
            ok = cap is not None and ((credit is not None and credit.text().strip()) or CREDIT_WORDS.search(cap.text()))
            if not ok:
                what = (n.attrs.get('alt') or n.attrs.get('aria-label') or n.attrs.get('src') or '')[:60]
                problems.append(('photo without credit', f'line {n.line}: {n.tag} {what!r}'))
    # 3. facts without a source
    marked = [n for n in nodes if 'data-fact' in n.attrs]
    candidates = marked if marked else [n for n in nodes if n.tag in ('li', 'p', 'td', 'dd')
                                         and not n.up(lambda p: p.tag in ('header', 'nav', 'footer', 'figure', 'template') or 'timeline' in p.classes())
                                         and not any(isinstance(c, Node) and c.tag in ('li', 'p', 'ul', 'ol') for c in n.children)]
    for n in candidates:
        txt = ' '.join(n.text().split())
        if not txt or not DATUM.search(txt):
            continue
        has = any(('src' in c.classes()) or 'data-source' in c.attrs or c.tag == 'cite' or (not marked and c.tag == 'a' and (c.attrs.get('href') or '').startswith('https://'))
                  for c in n.iter())
        if not has:
            problems.append(('fact without a source', f'line {n.line}: {txt[:90]!r}'))
    # 4. map tiles the family site's locked frame cannot load
    for n in nodes:
        if n.tag == 'script' and n.attrs.get('id') == 'trip-data':
            try:
                tiles = (json.loads(n.text()) or {}).get('tiles') or {}
            except ValueError:
                tiles = {}
            if not any(m.attrs.get('id') == 'leaflet' for m in nodes):
                continue
            if tiles.get('provider') not in ('site', 'carto'):
                problems.append(('map blocked in the family site', "map tiles come straight from OpenStreetMap's servers, which refuse pages in the site's locked frame; leave map.tiles out (the site relays the tiles) or use carto with the family's key"))
            elif tiles.get('provider') == 'site' and not any(m.tag == 'script' and 'hj:tiles-want' in m.text() for m in nodes):
                problems.append(('map blocked in the family site', "map.tiles is site, but the page's script never asks the site for a tile ticket (hj:tiles-want)"))
    # 5. official links: social accounts on the platform itself, addresses on Google Maps
    for n in nodes:
        kind = n.attrs.get('data-kind')
        if n.tag != 'a' or not kind:
            continue
        href = (n.attrs.get('href') or '').strip()
        u = urllib.parse.urlsplit(href)
        host = (u.hostname or '').lower()
        if kind in SOCIAL_HOSTS and (u.scheme != 'https' or not (host == SOCIAL_HOSTS[kind] or host.endswith('.' + SOCIAL_HOSTS[kind]))):
            problems.append(('social link off its platform', f'line {n.line}: {LINK_LABELS[kind]} link must be https on {SOCIAL_HOSTS[kind]}: {href[:80]}'))
        if kind == 'addr' and (u.scheme != 'https' or host not in ('www.google.com', 'google.com') or not u.path.startswith('/maps')):
            problems.append(('address not on Google Maps', f'line {n.line}: {href[:80]}'))
    # 6. http links (namespaces such as xmlns are not links)
    for n in nodes:
        for k, v in n.attrs.items():
            if k in URL_ATTRS and v and not v.strip().lower().startswith('data:') and re.search(r'(?i)(^|[\s,])http://', v.strip()):
                problems.append(('http link', f'line {n.line}: {k}="{v.strip()[:80]}"'))
        if n.tag == 'style':
            for m in re.finditer(r'(?i)(url\(\s*["\']?|@import\s+["\'])http://[^\s"\')]+', n.text()):
                problems.append(('http link', f'stylesheet: {m.group(0)[:80]}'))
    return problems


def report(name, problems):
    if not problems:
        print(f'PASS {name}')
        return True
    print(f'FAIL {name}: {len(problems)} problem(s)')
    by = {}
    for rule, detail in problems:
        by.setdefault(rule, []).append(detail)
    for rule, details in by.items():
        print(f'  {rule}: {len(details)}')
        for x in details[:12]:
            print(f'    - {x}')
        if len(details) > 12:
            print(f'    ... and {len(details) - 12} more')
    return False


def main(argv=None):
    ap = argparse.ArgumentParser(description='Render a trip data file into a coffee-table page, or check pages.')
    ap.add_argument('inputs', nargs='+', help='trip.json to render; with --check, pages (.html) or data files (.json)')
    ap.add_argument('-o', '--out', help='where to write the page (default: next to the data file, .html)')
    ap.add_argument('--check', action='store_true', help="report pages failing the owner's rules")
    a = ap.parse_args(argv)
    if a.check:
        ok = True
        for path in a.inputs:
            try:
                if path.endswith('.json'):
                    html = build(load(path))
                else:
                    with open(path, encoding='utf-8') as f:
                        html = f.read()
            except (KitError, OSError, ValueError) as e:
                print(f'FAIL {path}: {e}')
                ok = False
                continue
            ok = report(path, check_html(html, path)) and ok
        return 0 if ok else 1
    if len(a.inputs) != 1:
        ap.error('render one data file at a time')
    src = a.inputs[0]
    try:
        html = build(load(src))
    except (KitError, ValueError) as e:
        print(f'error: {e}', file=sys.stderr)
        return 2
    out = a.out or os.path.splitext(src)[0] + '.html'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    problems = check_html(html, out)
    print(f'wrote {out} ({len(html.encode("utf-8"))} bytes)')
    if problems:
        report(out, problems)
    return 0


if __name__ == '__main__':
    sys.exit(main())
