import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundCoordinate, shouldBeat, IDLE_LIMIT_MS } from '../assets/session.mjs';

test('coordinates are rounded to tenths of a degree before sending', () => {
  assert.equal(roundCoordinate(1.3521), 1.4);
  assert.equal(roundCoordinate(103.8198), 103.8);
  assert.equal(roundCoordinate(-33.8688), -33.9);
});

test('heartbeats only while visible and recently used', () => {
  const now = 1_000_000;
  assert.equal(shouldBeat(true, now - 10_000, now), true);
  assert.equal(shouldBeat(false, now - 10_000, now), false);
  assert.equal(shouldBeat(true, now - IDLE_LIMIT_MS - 1, now), false);
});

test('no en or em dashes in the session script', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../assets/session.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /[\u2013\u2014]/);
});
