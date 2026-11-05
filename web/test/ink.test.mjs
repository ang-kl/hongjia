// D2 drawing helpers: simplification, shape recognition, scaling, palm rejection, eraser reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simplify, capPoints, recognise, formatInk, formatShape, parsePoints, scaleOf, toView, widthFor,
  inkPolicy, touches, segmentsOf, arrowHead, MAX_POINTS
} from '../assets/ink.mjs';
import { validMessage } from '../assets/doc-view.mjs';

const circle = (cx, cy, rx, ry, n = 64, wobble = 0) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  const w = wobble ? Math.sin(i * 1.7) * wobble : 0;
  return { x: cx + (rx + w) * Math.cos(t), y: cy + (ry + w) * Math.sin(t), p: 0.5 };
});
const along = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n, p: 0.5 }));
const rectangle = (x, y, w, h) => [
  ...along({ x, y }, { x: x + w, y }, 20), ...along({ x: x + w, y }, { x: x + w, y: y + h }, 20).slice(1),
  ...along({ x: x + w, y: y + h }, { x, y: y + h }, 20).slice(1), ...along({ x, y: y + h }, { x: x + 2, y: y + 3 }, 20).slice(1)
];

test('simplify keeps the ends and drops points on a straight run', () => {
  const line = along({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
  const out = simplify(line, 0.5);
  assert.deepEqual(out.map(p => [p.x, p.y]), [[0, 0], [100, 0]]);
  const corner = [...along({ x: 0, y: 0 }, { x: 50, y: 0 }, 10), ...along({ x: 50, y: 0 }, { x: 50, y: 50 }, 10).slice(1)];
  assert.deepEqual(simplify(corner, 0.5).map(p => [p.x, p.y]), [[0, 0], [50, 0], [50, 50]]);
  const pressured = [{ x: 0, y: 0, p: 0.2 }, { x: 5, y: 9, p: 0.9 }, { x: 10, y: 0, p: 0.4 }];
  assert.deepEqual(simplify(pressured, 0.5), pressured, 'pressure travels with each kept point');
});

test('long strokes are capped at 600 points', () => {
  const scribble = Array.from({ length: 5000 }, (_, i) => ({ x: i * 0.7, y: Math.sin(i / 3) * 40, p: 0.5 }));
  const out = capPoints(scribble);
  assert.ok(out.length <= MAX_POINTS && out.length > 50, String(out.length));
  assert.deepEqual(out[0], scribble[0]);
  assert.deepEqual(out.at(-1), scribble.at(-1));
});

test('sketches become clean shapes, or stay freehand', () => {
  const line = along({ x: 10, y: 10 }, { x: 210, y: 60 }, 30).map((p, i) => ({ ...p, y: p.y + (i % 2 ? 0.8 : -0.8) }));
  assert.equal(recognise(line).tool, 'line');
  const round = recognise(circle(100, 100, 60, 60, 64, 2));
  assert.equal(round.tool, 'oval');
  assert.ok(Math.abs(round.a.x - 40) < 4 && Math.abs(round.b.y - 160) < 4);
  assert.equal(recognise(circle(100, 100, 90, 40)).tool, 'oval', 'a wide oval');
  assert.equal(recognise(circle(50, 50, 45, 36, 40)).tool, 'oval', 'a smooth small oval (its path is only about 1.57 times its width plus height)');
  const box = recognise(rectangle(20, 30, 160, 90));
  assert.equal(box.tool, 'rectangle');
  assert.deepEqual([box.a.x, box.a.y, box.b.x, box.b.y].map(Math.round), [20, 30, 180, 120]);
  const shaft = along({ x: 0, y: 100 }, { x: 200, y: 100 }, 40);
  const hook = along({ x: 200, y: 100 }, { x: 175, y: 82 }, 8).slice(1);
  const arrow = recognise([...shaft, ...hook]);
  assert.equal(arrow.tool, 'arrow');
  assert.deepEqual([arrow.a.x, arrow.b.x], [0, 200]);
  const zigzag = Array.from({ length: 40 }, (_, i) => ({ x: i * 6, y: i % 2 ? 40 : 0, p: 0.5 }));
  assert.equal(recognise(zigzag), null, 'a zigzag stays freehand');
  const u = [...along({ x: 0, y: 0 }, { x: 0, y: 100 }, 20), ...along({ x: 0, y: 100 }, { x: 100, y: 100 }, 20).slice(1), ...along({ x: 100, y: 100 }, { x: 100, y: 0 }, 20).slice(1)];
  assert.equal(recognise(u), null, 'an open U stays freehand');
  assert.equal(recognise([{ x: 0, y: 0 }, { x: 3, y: 2 }]), null, 'too short to be anything');
  assert.deepEqual(recognise(circle(100, 100, 60, 60, 64, 2)), recognise(circle(100, 100, 60, 60, 64, 2)), 'deterministic');
});

test('points are written compactly and read back', () => {
  const text = formatInk([{ x: 1.04, y: -2.26, p: 0.333 }, { x: 10, y: 20, p: 1.5 }]);
  assert.equal(text, '1,-2.3,0.33 10,20,1');
  assert.deepEqual(parsePoints(text), [{ x: 1, y: -2.3, p: 0.33 }, { x: 10, y: 20, p: 1 }]);
  assert.equal(formatShape({ x: 0, y: 0 }, { x: 12.345, y: 6 }), '0,0 12.3,6');
  assert.deepEqual(parsePoints('0,0 12.3,6'), [{ x: 0, y: 0, p: 0.5 }, { x: 12.3, y: 6, p: 0.5 }]);
  assert.deepEqual(parsePoints('x,1 2,3'), []);
  assert.deepEqual(parsePoints(''), []);
});

test('drawings scale with their element and follow it', () => {
  assert.equal(scaleOf(320, 640), 0.5);
  assert.equal(scaleOf(0, 640), 1, 'a hidden element keeps the drawing at its own size');
  assert.deepEqual(toView({ x: 100, y: 40 }, { x: 10, y: 500, w: 320 }, 640), { x: 60, y: 520 });
  assert.equal(widthFor(4, 0.5), 4);
  assert.ok(widthFor(4, 1) > widthFor(4, 0.2));
});

test('palm rejection: after a Pencil, fingers scroll instead of drawing', () => {
  const policy = inkPolicy();
  assert.equal(policy.decide('touch', true), 'draw', 'a finger draws on a phone without a Pencil');
  assert.equal(policy.decide('touch', false), 'ignore', 'a second finger does not draw');
  assert.equal(policy.decide('mouse', true, 0), 'draw');
  assert.equal(policy.decide('mouse', true, 2), 'ignore', 'right button does not draw');
  assert.equal(policy.penSeen, false);
  assert.equal(policy.decide('pen', true), 'draw');
  assert.equal(policy.penSeen, true);
  assert.equal(policy.decide('touch', true), 'scroll', 'the palm or a finger now scrolls');
  assert.equal(policy.decide('pen', true), 'draw');
});

test('the eraser reaches a drawing near its line, scaled to where it is', () => {
  const ink = { kind: 'ink', tool: 'draw', width: 4, ref: 400, points: [{ x: 0, y: 0, p: 0.5 }, { x: 100, y: 0, p: 0.5 }] };
  const at = { x: 50, y: 50, w: 200 };
  assert.ok(touches(ink, at, 75, 52, 10), 'on the line, at half size');
  assert.ok(!touches(ink, at, 75, 80, 10), 'too far away');
  assert.ok(!touches(ink, at, 150, 50, 10), 'past the end (the line is 50 px long at this size)');
  const oval = { kind: 'shape', tool: 'oval', width: 2, ref: 100, points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] };
  assert.ok(touches(oval, { x: 0, y: 0, w: 100 }, 50, 1, 6), 'on the rim');
  assert.ok(!touches(oval, { x: 0, y: 0, w: 100 }, 50, 25, 6), 'not inside it');
  assert.equal(segmentsOf({ kind: 'shape', tool: 'rectangle', width: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }).length, 4);
  const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
  assert.ok(head.every(p => p.x < 100 && Math.abs(p.y) > 3), 'the head points back along the shaft');
});

test('positions and places from the frame carry element boxes, checked', () => {
  const pos = validMessage({ type: 'hj:positions', w: 800, h: 600, items: [{ id: '7', x: 10, y: 20, w: 300, h: 40 }, { id: '8', x: 1, y: 2 }] });
  assert.deepEqual(pos.items, [{ id: '7', x: 10, y: 20, w: 300, h: 40 }, { id: '8', x: 1, y: 2 }]);
  assert.equal(validMessage({ type: 'hj:positions', w: 800, h: 600, items: [{ id: '7', x: 10, y: 20, w: 'x' }] }), null);
  const place = validMessage({ type: 'hj:located', req: '3', path: 'body:1/p:2', fx: 0.5, fy: 0.25, bx: 8, by: 100, bw: 640, bh: 40 });
  assert.deepEqual([place.bx, place.by, place.bw, place.bh], [8, 100, 640, 40]);
  assert.equal(validMessage({ type: 'hj:located', req: '3', path: 'body:1/p:2', fx: 0.5, fy: 0.25, bw: Infinity }), null);
});
