// D3: signatures (stored form, typed names) and the loupe (messages and layout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatStrokes, parseStrokes, cleanTyped, PAD, MAX_POINTS } from '../assets/signature.mjs';
import { validMessage, LOUPE_ZOOMS } from '../assets/doc-view.mjs';

test('drawn strokes are kept inside the pad in the stored form', () => {
  const text = formatStrokes([
    [{ x: 10, y: 20, p: 0.5 }, { x: 30.26, y: 40, p: 0.704 }],
    [{ x: -5, y: 250, p: 2 }]
  ]);
  assert.equal(text, '10,20,0.5 30.3,40,0.7;0,200,1');
  assert.deepEqual(parseStrokes(text), [
    [{ x: 10, y: 20, p: 0.5 }, { x: 30.3, y: 40, p: 0.7 }],
    [{ x: 0, y: 200, p: 1 }]
  ]);
  assert.equal(formatStrokes([]), '', 'nothing drawn');
  assert.equal(formatStrokes([[]]), '');
});

test('long signatures are capped at 1200 points and 60 strokes', () => {
  const zigzag = Array.from({ length: 3000 }, (_, i) => ({ x: i % PAD.w, y: i % 2 ? 20 : 180, p: 0.5 }));
  const many = parseStrokes(formatStrokes([zigzag]));
  assert.equal(many.flat().length, MAX_POINTS);
  const dots = Array.from({ length: 80 }, (_, i) => [{ x: i, y: 10, p: 0.5 }]);
  assert.equal(parseStrokes(formatStrokes(dots)).length, 60);
});

test('unreadable stored strokes are left out', () => {
  assert.deepEqual(parseStrokes('a,b,c;1,2'), [[{ x: 1, y: 2, p: 0.5 }]]);
  assert.deepEqual(parseStrokes(''), []);
  assert.deepEqual(parseStrokes(null), []);
});

test('typed names are trimmed and limited', () => {
  assert.equal(cleanTyped('  Lake Example '), 'Lake Example');
  assert.equal(cleanTyped('灯笼'), '灯笼');
  assert.equal(cleanTyped(''), '');
  assert.equal(cleanTyped('x'.repeat(61)), '');
  assert.equal(cleanTyped('a\u0007b'), '');
});

test('loupe messages from the frame are checked', () => {
  assert.deepEqual(LOUPE_ZOOMS, [0, 2, 3]);
  assert.deepEqual(validMessage({ type: 'hj:loupe', zoom: 0 }), { type: 'hj:loupe', zoom: 0, reason: '' });
  assert.deepEqual(validMessage({ type: 'hj:loupe', zoom: 0, reason: 'long' }), { type: 'hj:loupe', zoom: 0, reason: 'long' });
  assert.equal(validMessage({ type: 'hj:loupe', zoom: 5 }), null);
  assert.equal(validMessage({ type: 'hj:loupe', zoom: '2' }), null);
  assert.equal(validMessage({ type: 'hj:loupe', zoom: 2, reason: '<b>' }), null);
});

test('the loupe centres the point under the pointer, above a finger', async () => {
  const source = await readFile(new URL('../assets/frame-helper.js', import.meta.url), 'utf8');
  const pure = source.slice(source.indexOf('/* PURE START'), source.indexOf('/* PURE END'));
  const { loupeLayout } = new Function(`${pure}; return { loupeLayout };`)();
  // Pointer at (100, 50), page scrolled down 400, magnified twice, a 180 px lens.
  const at = loupeLayout(100, 50, 0, 400, 2, 180, false);
  assert.deepEqual(at, { left: 10, top: -40, tx: 90 - 100 * 2, ty: 90 - 450 * 2 });
  // The document point under the pointer lands in the lens's centre.
  assert.equal(at.tx + 100 * 2, 90);
  assert.equal(at.ty + 450 * 2, 90);
  const touch = loupeLayout(100, 300, 0, 0, 3, 180, true);
  assert.equal(touch.top, 300 - 90 - 135, 'lifted above the finger');
});
