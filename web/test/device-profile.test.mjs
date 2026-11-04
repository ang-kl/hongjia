import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyDeviceProfile, readDeviceProfile, RESPONSIVE_PROFILE_VERSION } from '../assets/device-profile.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/michi-parity.json', import.meta.url), 'utf8'));

test('profile version matches the owner profile', () => {
  assert.equal(RESPONSIVE_PROFILE_VERSION, 'v2-template-rin3-1');
  assert.equal(fixture.profileVersion, RESPONSIVE_PROFILE_VERSION);
});

test('gives the same answers as michi over the whole viewport grid', () => {
  assert.ok(fixture.rows.length >= 400, 'fixture should cover a broad grid');
  for (const [width, height, agent, maxTouchPoints, formFactor, sizeTier, aspectTier, orientation, deviceFamily, touch, aspectRatio] of fixture.rows) {
    const { userAgent } = fixture.agents[agent];
    const p = classifyDeviceProfile({ width, height, userAgent, maxTouchPoints });
    assert.deepEqual(
      [p.formFactor, p.sizeTier, p.aspectTier, p.orientation, p.deviceFamily, p.touch, p.aspectRatio],
      [formFactor, sizeTier, aspectTier, orientation, deviceFamily, touch, aspectRatio],
      `mismatch at ${width}x${height} ${agent}`
    );
  }
});

// The owner's five device classes, at the seven viewports the plan tests (plan section 5.9).
const deviceClasses = [
  ['notebook', 1440, 900, 'desktop', 'desktop'],
  ['tablet landscape', 1180, 820, 'tablet', 'tablet-standard'],
  ['tablet portrait', 820, 1180, 'tablet', 'tablet-standard'],
  ['mini tablet', 744, 1133, 'tablet', 'tablet-small'],
  ['phone max', 430, 932, 'phone', 'phone-large'],
  ['phone small', 375, 667, 'phone', 'phone-standard'],
  ['phone small, compact', 360, 740, 'phone', 'phone-compact']
];

for (const [name, width, height, formFactor, sizeTier] of deviceClasses) {
  test(`${name} ${width}x${height} is ${formFactor} / ${sizeTier}`, () => {
    const p = classifyDeviceProfile({ width, height });
    assert.equal(p.formFactor, formFactor);
    assert.equal(p.sizeTier, sizeTier);
  });
}

test('brand is descriptive only: a phone-sized iPad user agent stays a phone', () => {
  const p = classifyDeviceProfile({ width: 390, height: 844, userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', maxTouchPoints: 5 });
  assert.equal(p.formFactor, 'phone');
  assert.equal(p.deviceFamily, 'ipad');
});

test('bad dimensions fall back to 1280 x 800, which the owner rules class as a large tablet', () => {
  const p = classifyDeviceProfile({ width: 'x', height: -1 });
  assert.equal(p.viewportWidth, 1280);
  assert.equal(p.viewportHeight, 800);
  // short side 800 <= 1024 and long side 1280 <= 1366, so the profile says tablet (same as michi).
  assert.equal(p.formFactor, 'tablet');
  assert.equal(p.sizeTier, 'tablet-standard');
});

test('reads the layout viewport from a window-like scope', () => {
  const scope = { innerWidth: 375, innerHeight: 667, navigator: { userAgent: '', maxTouchPoints: 5 } };
  const p = readDeviceProfile(scope);
  assert.equal(p.sizeTier, 'phone-standard');
  assert.equal(p.touch, true);
});
