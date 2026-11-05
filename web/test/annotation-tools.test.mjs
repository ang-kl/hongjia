// D1 annotation tools: the pure parts of the page module and of the in-frame helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validMessage, placeMenu, mentionPieces, mentionQuery, COLORS, STAMPS } from '../assets/doc-view.mjs';

const source = await readFile(new URL('../assets/frame-helper.js', import.meta.url), 'utf8');
const pure = source.slice(source.indexOf('/* PURE START'), source.indexOf('/* PURE END'));
const { anchorPathOf, resolvePath, findPoint, isDoubleTap, isLongPress, clamp } =
  new Function(`${pure}; return { anchorPathOf, resolvePath, findPoint, isDoubleTap, isLongPress, clamp };`)();

// A tiny element tree with only the properties the helpers use.
function tree(spec, parent = null) {
  const node = { tagName: spec[0].toUpperCase(), parentElement: parent, previousElementSibling: null, nextElementSibling: null, firstElementChild: null };
  let prev = null;
  for (const childSpec of spec.slice(1)) {
    const child = tree(childSpec, node);
    child.previousElementSibling = prev;
    if (prev) prev.nextElementSibling = child; else node.firstElementChild = child;
    prev = child;
  }
  return node;
}
const nth = (node, ...indexes) => indexes.reduce((n, i) => { let c = n.firstElementChild; for (let k = 0; k < i; k++) c = c.nextElementSibling; return c; }, node);

test('element paths count same-tag siblings and resolve back', () => {
  const html = tree(['html', ['head'], ['body', ['h1'], ['section', ['p'], ['p']], ['section', ['h2'], ['p'], ['p'], ['div']]]]);
  const body = nth(html, 1);
  const target = nth(body, 2, 2);
  assert.equal(anchorPathOf(target, html), 'body:1/section:2/p:2');
  assert.equal(anchorPathOf(body, html), 'body:1');
  assert.equal(resolvePath(html, 'body:1/section:2/p:2'), target);
  assert.equal(resolvePath(html, 'body:1/section:2/div:1'), nth(body, 2, 3));
  assert.equal(resolvePath(html, 'body:1/section:3'), null, 'missing');
  assert.equal(resolvePath(html, 'body:1/section:x'), null, 'bad step');
  assert.equal(resolvePath(html, ''), null);
  const outside = tree(['div']);
  assert.equal(anchorPathOf(outside, html), '', 'not inside the root');
});

test('insertion points are found from the words around them', () => {
  const text = 'Book the car early. Book the boat later.';
  assert.equal(findPoint(text, 'Book the ', 'boat'), 29);
  assert.equal(findPoint(text, 'the car', ''), 12);
  assert.equal(findPoint(text, '', 'early'), 13);
  assert.equal(findPoint(text, '', ''), -1);
  assert.equal(findPoint(text, 'nowhere', 'else'), -1);
});

test('double taps and long presses', () => {
  const first = { x: 100, y: 100, t: 1000 };
  assert.equal(isDoubleTap(first, { x: 110, y: 95, t: 1300 }, 350, 30), true);
  assert.equal(isDoubleTap(first, { x: 110, y: 95, t: 1400 }, 350, 30), false, 'too slow');
  assert.equal(isDoubleTap(first, { x: 150, y: 100, t: 1100 }, 350, 30), false, 'too far');
  assert.equal(isDoubleTap(null, first, 350, 30), false);
  assert.equal(isLongPress({ t: 0 }, 560, 4, 550, 10), true);
  assert.equal(isLongPress({ t: 0 }, 300, 0, 550, 10), false, 'too short');
  assert.equal(isLongPress({ t: 0 }, 900, 25, 550, 10), false, 'moved: a scroll, not a press');
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
});

test('the menu stays inside the window on every device size', () => {
  const sizes = [[1440, 900], [1180, 820], [820, 1180], [744, 1133], [430, 932], [375, 667], [360, 740]];
  for (const [vw, vh] of sizes) {
    for (const [x, y] of [[0, 0], [vw - 1, vh - 1], [vw / 2, vh / 2], [vw - 5, 10], [5, vh - 5]]) {
      const { left, top } = placeMenu(x, y, 260, 420, vw, vh);
      assert.ok(left >= 8 && left + 260 <= vw - 8 + 0.5, `${vw}x${vh} at ${x},${y}: left ${left}`);
      assert.ok(top >= 8 && top + 420 <= vh - 8 + 0.5, `${vw}x${vh} at ${x},${y}: top ${top}`);
    }
  }
  assert.deepEqual(placeMenu(100, 100, 200, 300, 1440, 900), { left: 100, top: 100 }, 'below and right when it fits');
  assert.deepEqual(placeMenu(100, 800, 200, 300, 1440, 900), { left: 100, top: 500 }, 'above when below would not fit');
  assert.equal(placeMenu(10, 10, 200, 900, 375, 667).top, 8, 'taller than the window: pinned to the top');
});

test('mentions: family handles only, not inside words', () => {
  assert.deepEqual(mentionPieces('Ask @Beta, not mail@alpha or @gamma', ['alpha', 'beta']), [
    { text: 'Ask ' }, { text: '@Beta', mention: true }, { text: ', not mail@alpha or @gamma' }
  ]);
  assert.deepEqual(mentionPieces('plain', ['alpha']), [{ text: 'plain' }]);
  assert.equal(mentionQuery('Ask @be', 7), 'be');
  assert.equal(mentionQuery('Ask @', 5), '');
  assert.equal(mentionQuery('mail@be', 7), null, 'inside a word');
  assert.equal(mentionQuery('Ask @be now', 11), null, 'caret moved on');
});

test('menu, position and locate messages are checked', () => {
  const menu = { type: 'hj:menu', input: 'mouse', x: 10, y: 20, quote: 'Two', prefix: 'a', suffix: 'b', ppre: '', psuf: '', path: 'body:1/p:2', fx: 0.5, fy: 0.25, field: '', label: '' };
  assert.deepEqual(validMessage(menu), menu);
  assert.equal(validMessage({ ...menu, input: 'voice' }), null);
  assert.equal(validMessage({ ...menu, path: 'body:1/p:2;x' }), null);
  assert.equal(validMessage({ ...menu, fx: 2 }), null);
  assert.equal(validMessage({ ...menu, x: Number.NaN }), null);
  assert.equal(validMessage({ ...menu, quote: 'q'.repeat(1001) }), null);
  assert.deepEqual(validMessage({ type: 'hj:positions', items: [{ id: '4', x: 1.5, y: -20 }], w: 800, h: 600 }), { type: 'hj:positions', items: [{ id: '4', x: 1.5, y: -20 }], w: 800, h: 600 });
  assert.equal(validMessage({ type: 'hj:positions', items: [{ id: 'x', x: 1, y: 1 }], w: 1, h: 1 }), null);
  assert.equal(validMessage({ type: 'hj:positions', items: Array(1001).fill({ id: '1', x: 0, y: 0 }), w: 1, h: 1 }), null);
  assert.deepEqual(validMessage({ type: 'hj:located', req: '3', path: 'body:1', fx: 0, fy: 1 }), { type: 'hj:located', req: '3', path: 'body:1', fx: 0, fy: 1 });
  assert.equal(validMessage({ type: 'hj:located', req: '3', path: '', fx: 0, fy: 1 }), null);
  for (const forged of ['hj:create', 'hj:delete', 'hj:move', 'hj:edit']) assert.equal(validMessage({ type: forged, id: '1' }), null, `${forged} is not a message the page accepts`);
  assert.deepEqual(COLORS, ['yellow', 'green', 'blue', 'pink', 'orange']);
  assert.equal(STAMPS.length, 5);
});
