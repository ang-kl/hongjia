import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validMessage, rateLimiter, targetText, LIMITS, MAX_WEATHER_PLACES, MAX_NEAR_PLACES, NEAR_ANSWERS, SHARE_LIMITS, shareUrl, distanceKm, roughKm, nearest } from '../assets/doc-view.mjs';

test('only known messages with bounded strings are accepted', () => {
  assert.deepEqual(validMessage({ type: 'hj:ready', extra: 1 }), { type: 'hj:ready' });
  assert.deepEqual(validMessage({ type: 'hj:field', key: 'id:a', value: 'true', label: 'Book' }), { type: 'hj:field', key: 'id:a', value: 'true', label: 'Book' });
  assert.equal(validMessage({ type: 'hj:field', key: '', value: 'x' }), null);
  assert.equal(validMessage({ type: 'hj:field', key: 'k'.repeat(LIMITS.key + 1), value: 'x' }), null);
  assert.equal(validMessage({ type: 'hj:field', key: 'k', value: 'v'.repeat(LIMITS.value + 1) }), null);
  assert.equal(validMessage({ type: 'hj:field', key: 'k', value: 5 }), null);
  assert.equal(validMessage({ type: 'hj:annotate', body: 'made up by the page' }), null, 'no message creates an annotation');
  assert.equal(validMessage('hj:ready'), null);
  assert.equal(validMessage(null), null);
});

test('storage messages', () => {
  assert.deepEqual(validMessage({ type: 'hj:storage', op: 'set', key: 'visits', value: '3' }), { type: 'hj:storage', op: 'set', key: 'visits', value: '3' });
  assert.deepEqual(validMessage({ type: 'hj:storage', op: 'clear', key: 'x', value: 'y' }), { type: 'hj:storage', op: 'clear', key: '', value: '' });
  assert.deepEqual(validMessage({ type: 'hj:storage', op: 'remove', key: 'a' }), { type: 'hj:storage', op: 'remove', key: 'a', value: '' });
  assert.equal(validMessage({ type: 'hj:storage', op: 'set', key: 'a', value: 's'.repeat(LIMITS.storage + 1) }), null);
  assert.equal(validMessage({ type: 'hj:storage', op: 'drop', key: 'a' }), null);
});

test('selections, focus and highlight clicks', () => {
  assert.deepEqual(validMessage({ type: 'hj:selection', quote: 'Two', prefix: 'x', suffix: 'y' }), { type: 'hj:selection', quote: 'Two', prefix: 'x', suffix: 'y' });
  assert.equal(validMessage({ type: 'hj:selection', quote: 'q'.repeat(LIMITS.quote + 1) }), null);
  assert.equal(validMessage({ type: 'hj:selection', quote: 'q', prefix: 'p'.repeat(65) }), null);
  assert.deepEqual(validMessage({ type: 'hj:focus', key: 'id:a' }), { type: 'hj:focus', key: 'id:a', label: '' });
  assert.deepEqual(validMessage({ type: 'hj:open', id: '12' }), { type: 'hj:open', id: '12' });
  assert.equal(validMessage({ type: 'hj:open', id: '12"><img' }), null);
});

test('the rate limit allows a burst, then waits for the window', () => {
  const allow = rateLimiter(3, 1000);
  assert.deepEqual([allow(0), allow(10), allow(20), allow(30)], [true, true, true, false]);
  assert.equal(allow(1015), true);
});

test('what the composer says it comments on', () => {
  assert.equal(targetText(null), '');
  assert.equal(targetText({ field: 'id:a', label: 'Book the car' }), 'On the field: Book the car');
  assert.equal(targetText({ field: 'id:a', label: '' }), 'On the field: id:a');
  assert.equal(targetText({ quote: 'Two bedrooms' }), 'On: “Two bedrooms”');
  assert.equal(targetText({ quote: 'x'.repeat(200) }).length, 'On: “'.length + 141 + 1);
});

test('a trip page may ask for the forecast of its places, and nothing else', () => {
  const place = { key: 'harbour', lat: 51.51, lon: -0.13, start: '2030-06-20', end: '2030-06-27' };
  assert.deepEqual(validMessage({ type: 'hj:weather-want', places: [{ ...place, extra: '<b>' }] }), { type: 'hj:weather-want', places: [place] });
  const bad = [
    { places: [] },
    { places: 'harbour' },
    { places: Array.from({ length: MAX_WEATHER_PLACES + 1 }, (_, i) => ({ ...place, key: `p${i}` })) },
    { places: [place, place] },
    { places: [{ ...place, key: 'Harbour' }] },
    { places: [{ ...place, key: '../x' }] },
    { places: [{ ...place, lat: 91 }] },
    { places: [{ ...place, lon: '-0.13' }] },
    { places: [{ ...place, start: '20-03-2027' }] },
    { places: [{ ...place, end: '2030-06-19' }] },
    { places: [null] }
  ];
  for (const b of bad) assert.equal(validMessage({ type: 'hj:weather-want', ...b }), null, JSON.stringify(b).slice(0, 80));
  assert.equal(validMessage({ type: 'hj:weather', key: 'harbour' }), null, 'answers only ever go into the frame');
});

test('a trip map may ask for its map ticket, and nothing more', () => {
  assert.deepEqual(validMessage({ type: 'hj:tiles-want', base: 'https://evil.example/', extra: 1 }), { type: 'hj:tiles-want' });
  assert.equal(validMessage({ type: 'hj:tiles', ticket: 'x' }), null, 'tickets only ever go into the frame');
});

test('a trip page may ask to share a place by its public facts and an https link', () => {
  const place = { type: 'hj:share-want', kind: 'place', title: 'Harbour Café', text: '1 Quay Street', url: 'https://example.com/cafe' };
  assert.deepEqual(validMessage({ ...place, extra: '<b>' }), place);
  assert.deepEqual(validMessage({ ...place, text: undefined }), { ...place, text: '' });
  const bad = [
    { url: 'http://example.com/cafe' },
    { url: 'javascript:alert(1)' },
    { url: 'https://user:pass@example.com/' },
    { url: 'https://localhost/x' },
    { url: 'https://example.com/' + 'x'.repeat(SHARE_LIMITS.url) },
    { url: 5 },
    { title: '' },
    { title: '   ' },
    { title: 't'.repeat(SHARE_LIMITS.title + 1) },
    { text: 'x'.repeat(SHARE_LIMITS.text + 1) },
    { kind: 'file' }
  ];
  for (const b of bad) assert.equal(validMessage({ ...place, ...b }), null, JSON.stringify(b).slice(0, 80));
  assert.equal(shareUrl('https://www.instagram.com/harbour.cafe/'), true);
  assert.equal(shareUrl('https://example.com:99999/'), false, 'a broken address is refused');
});

test('a trip page may share the document only by its link: no text and no address of its own', () => {
  assert.deepEqual(validMessage({ type: 'hj:share-want', kind: 'doc', title: 'Day 3', text: 'secret plans', url: 'https://evil.example/' }), { type: 'hj:share-want', kind: 'doc', title: 'Day 3' });
  assert.deepEqual(validMessage({ type: 'hj:share-want', kind: 'doc' }), { type: 'hj:share-want', kind: 'doc', title: '' });
  assert.equal(validMessage({ type: 'hj:share-want', kind: 'doc', title: 't'.repeat(SHARE_LIMITS.title + 1) }), null);
  assert.equal(validMessage({ type: 'hj:shared', ok: true }), null, 'answers only ever go into the frame');
});

test('Near me: a trip page names its places, and never receives a position', () => {
  const p = { key: 'harbour', lat: 51.51, lon: -0.13 };
  assert.deepEqual(validMessage({ type: 'hj:near-want', places: [{ ...p, start: '2030-06-20', name: '<b>' }] }), { type: 'hj:near-want', places: [p] });
  const bad = [
    { places: [] },
    { places: Array.from({ length: MAX_NEAR_PLACES + 1 }, (_, i) => ({ ...p, key: `p${i}` })) },
    { places: [p, p] },
    { places: [{ ...p, key: 'Harbour' }] },
    { places: [{ ...p, lat: -91 }] },
    { places: [{ ...p, lon: Infinity }] },
    { places: [{ ...p, lat: '51.5' }] }
  ];
  for (const b of bad) assert.equal(validMessage({ type: 'hj:near-want', ...b }), null, JSON.stringify(b).slice(0, 80));
  assert.equal(validMessage({ type: 'hj:near', places: [] }), null, 'answers only ever go into the frame');
});

test('a trip page says when its tour opens and closes, and nothing else', () => {
  assert.deepEqual(validMessage({ type: 'hj:tour', open: true, extra: 'x' }), { type: 'hj:tour', open: true });
  assert.deepEqual(validMessage({ type: 'hj:tour', open: false }), { type: 'hj:tour', open: false });
  for (const open of [undefined, 'true', 1, null]) assert.equal(validMessage({ type: 'hj:tour', open }), null, String(open));
});

test('Near me sorts by distance and gives rough distances only', () => {
  const here = { lat: 51.5007, lon: -0.1246 };
  const places = [
    { key: 'far', lat: 48.8584, lon: 2.2945 },
    { key: 'near', lat: 51.5014, lon: -0.1419 },
    { key: 'next-door', lat: 51.5008, lon: -0.1247 }
  ];
  const km = distanceKm(here, places[0]);
  assert.ok(km > 330 && km < 350, `London to Paris is about 340 km, got ${km}`);
  assert.deepEqual(nearest(here, places), [{ key: 'next-door', km: 0.5 }, { key: 'near', km: 1 }, { key: 'far', km: Math.round(km * 2) / 2 }]);
  assert.equal(roughKm(0.01), 0.5);
  assert.equal(roughKm(1.26), 1.5);
  const many = Array.from({ length: 50 }, (_, i) => ({ key: `p${i}`, lat: 51 + i / 100, lon: 0 }));
  const answer = nearest({ lat: 51, lon: 0 }, many);
  assert.equal(answer.length, NEAR_ANSWERS);
  for (const a of answer) assert.deepEqual(Object.keys(a).sort(), ['key', 'km'], 'only keys and rough distances');
});
