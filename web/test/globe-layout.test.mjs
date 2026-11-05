import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIslands, placeGlobe, rotate, byMonth, shortTitle, MAX_ISLANDS } from '../assets/globe-layout.mjs';

const doc = (key, tags, month = 'November 2026') => ({ key, label: key.replace('_', '_#'), title: `Doc ${key}`, tags, month });

test('islands come from hashtags shared by two or more documents, most common first', () => {
  const docs = [doc('a_1', ['boats', 'lake']), doc('a_2', ['lake']), doc('a_3', ['boats', 'hills']), doc('a_4', ['lake']), doc('a_5', ['solo'])];
  const islands = buildIslands(docs);
  assert.deepEqual(islands.map(i => i.name), ['#lake', '#boats', 'Other']);
  assert.deepEqual(islands[0].docs.map(d => d.key), ['a_1', 'a_2', 'a_4']);
  assert.deepEqual(islands[1].docs.map(d => d.key), ['a_3'], 'each document joins one island only');
  assert.deepEqual(islands[2].docs.map(d => d.key), ['a_5']);
});

test('at most six islands, with Other taking one of the six when needed', () => {
  const docs = [];
  for (let t = 0; t < 8; t++) for (let n = 0; n < 2; n++) docs.push(doc(`t${t}_${n}`, [`tag${t}`]));
  docs.push(doc('x_1', []));
  const islands = buildIslands(docs);
  assert.equal(islands.length, MAX_ISLANDS);
  assert.equal(islands.at(-1).name, 'Other');
  assert.equal(islands.reduce((n, i) => n + i.docs.length, 0), docs.length, 'every document is on the globe');
  const exact = [];
  for (let t = 0; t < 6; t++) for (let n = 0; n < 2; n++) exact.push(doc(`e${t}_${n}`, [`tag${t}`]));
  assert.equal(buildIslands(exact).filter(i => i.name === 'Other').length, 0, 'six shared hashtags fill six islands');
});

test('with no shared hashtag, each document\'s first hashtag names its island', () => {
  assert.deepEqual(buildIslands([doc('s_1', ['garden', 'tomatoes'])]).map(i => i.name), ['#garden']);
  assert.deepEqual(buildIslands([doc('s_1', [])]).map(i => i.name), ['Other']);
  assert.deepEqual(buildIslands([]), []);
});

test('pins and coasts sit on the unit sphere, near their island', () => {
  const { islands, pins } = placeGlobe(buildIslands([doc('a_1', ['lake']), doc('a_2', ['lake']), doc('a_3', ['hills']), doc('a_4', ['hills'])]));
  assert.equal(pins.length, 4);
  for (const p of [...pins, ...islands.flatMap(i => i.coast)]) assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-3);
  for (const island of islands) {
    assert.equal(island.coast.length, 48);
    for (const pin of island.pins) {
      const dot = pin.x * island.centre.x + pin.y * island.centre.y + pin.z * island.centre.z;
      assert.ok(Math.acos(Math.min(1, dot)) <= island.radius, 'pin inside its island');
    }
  }
  assert.notDeepEqual(islands[0].centre, islands[1].centre);
});

test('rotation keeps length and turns the front', () => {
  const r = rotate({ x: 0, y: 0, z: 1 }, 0, 0);
  assert.ok(Math.abs(r.depth - 1) < 1e-9);
  const t = rotate({ x: 1, y: 0, z: 0 }, Math.PI / 2, 0);
  assert.ok(Math.abs(Math.hypot(t.x, t.y, t.depth) - 1) < 1e-9);
});

test('contents group documents by month and pin labels stay short', () => {
  const groups = byMonth([doc('a_1', [], 'November 2026'), doc('a_2', [], 'November 2026'), doc('b_1', [], 'October 2026')]);
  assert.deepEqual(groups.map(g => [g.month, g.docs.length]), [['November 2026', 2], ['October 2026', 1]]);
  assert.equal(shortTitle('A short one'), 'A short one');
  assert.equal([...shortTitle('x'.repeat(40))].length, 26);
  assert.ok(shortTitle('灯'.repeat(30)).endsWith('…'));
});
