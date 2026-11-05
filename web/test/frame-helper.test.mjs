// The pure parts of the in-frame helper (between its PURE START and PURE END markers), loaded
// exactly as the server sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/frame-helper.js', import.meta.url), 'utf8');
const pure = source.slice(source.indexOf('/* PURE START'), source.indexOf('/* PURE END'));
const { hashText, squash, clip, findAnchor, around } = new Function(`${pure}; return { hashText, squash, clip, findAnchor, around };`)();

test('the helper has one data placeholder, at the end, and never closes a script tag', () => {
  assert.equal(source.split('__HJ_DATA__').length - 1, 1);
  assert.match(source.trimEnd(), /\}\)\(__HJ_DATA__\);$/);
  assert.equal(/<\/script/i.test(source), false);
});

test('label hashes are short and stable', () => {
  assert.equal(hashText(''), '811c9dc5');
  assert.equal(hashText('Book the car'), hashText('Book the car'));
  assert.notEqual(hashText('Book the car'), hashText('Book the cab'));
  assert.match(hashText('灯笼'), /^[0-9a-f]{8}$/);
});

test('text is squashed and clipped', () => {
  assert.equal(squash('  a \n\t b  '), 'a b');
  assert.equal(squash(null), '');
  assert.equal(clip('abcdef', 3), 'abc');
  assert.equal(clip('ab', 3), 'ab');
});

test('anchors prefer the place where the words around match', () => {
  const text = 'One bed here. Two bedrooms near the lake. Two bedrooms in town.';
  assert.deepEqual(findAnchor(text, 'Two bedrooms', 'here. ', ' near'), [14, 26]);
  assert.deepEqual(findAnchor(text, 'Two bedrooms', 'lake. ', ' in town'), [42, 54]);
  assert.deepEqual(findAnchor(text, 'Two bedrooms', 'zzz', 'zzz'), [14, 26], 'first match when nothing else fits');
  assert.equal(findAnchor(text, 'Three', '', ''), null);
  assert.equal(findAnchor(text, '', '', ''), null);
});

test('a selection keeps up to 32 characters either side', () => {
  const text = 'a'.repeat(40) + 'QUOTE' + 'b'.repeat(40);
  const found = around(text, 40, 45);
  assert.equal(found.quote, 'QUOTE');
  assert.equal(found.prefix, 'a'.repeat(32));
  assert.equal(found.suffix, 'b'.repeat(32));
  assert.deepEqual(around('xQy', 1, 2), { quote: 'Q', prefix: 'x', suffix: 'y' });
});
