import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validMessage, rateLimiter, targetText, LIMITS, MAX_WEATHER_PLACES } from '../assets/doc-view.mjs';

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
