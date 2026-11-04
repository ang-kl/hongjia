// Device profile for hongjia. Copied unchanged in its rules from the owner's michi repository
// (assets/device-profile.mjs), which ports the owner's 2026-0313_AI-JS profile
// (v3.1/src/responsive/deviceProfile.js, profile "v2-template-rin3-1"). Keep the rules identical:
// geometry decides the layout; the browser's reported device family is descriptive only and is
// never guessed from size; the layout viewport is used, not the visual viewport, so an on-screen
// keyboard cannot flip a phone to landscape. The parity test pins this file to michi's answers.
export const RESPONSIVE_PROFILE_VERSION = 'v2-template-rin3-1';

const cleanDimension = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

function reportedFamily(userAgent, maxTouchPoints, formFactor) {
  const ua = String(userAgent || '');
  if (/iPhone/i.test(ua)) return 'iphone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && Number(maxTouchPoints || 0) > 1 && formFactor === 'tablet')) return 'ipad';
  if (/Samsung|SAMSUNG-|SM-[A-Z0-9]+/i.test(ua)) return 'samsung';
  if (/Android/i.test(ua)) return 'android';
  return 'generic';
}

export function classifyDeviceProfile({ width, height, userAgent = '', maxTouchPoints = 0 } = {}) {
  const viewportWidth = cleanDimension(width, 1280);
  const viewportHeight = cleanDimension(height, 800);
  const shortSide = Math.min(viewportWidth, viewportHeight);
  const longSide = Math.max(viewportWidth, viewportHeight);
  const aspectRatio = Number((viewportWidth / viewportHeight).toFixed(3));
  const orientation = viewportWidth === viewportHeight ? 'square' : viewportWidth > viewportHeight ? 'landscape' : 'portrait';

  let formFactor = 'desktop';
  if (shortSide < 600 && longSide <= 960) formFactor = 'phone';
  else if (shortSide <= 1024 && longSide <= 1366) formFactor = 'tablet';

  let sizeTier = 'desktop';
  if (formFactor === 'phone') sizeTier = shortSide <= 360 ? 'phone-compact' : shortSide <= 414 ? 'phone-standard' : 'phone-large';
  else if (formFactor === 'tablet') sizeTier = shortSide <= 768 ? 'tablet-small' : shortSide <= 900 ? 'tablet-standard' : 'tablet-large';
  else if (viewportWidth >= 2000) sizeTier = 'desktop-wide';

  let aspectTier = 'balanced';
  if (aspectRatio <= 0.55) aspectTier = 'tall';
  else if (aspectRatio < 0.9) aspectTier = 'portrait';
  else if (aspectRatio <= 1.1) aspectTier = 'square';
  else if (aspectRatio >= 1.7) aspectTier = 'wide';
  else aspectTier = 'landscape';

  return {
    profileVersion: RESPONSIVE_PROFILE_VERSION, viewportWidth, viewportHeight, shortSide, longSide,
    aspectRatio, aspectTier, orientation, formFactor, sizeTier,
    deviceFamily: reportedFamily(userAgent, maxTouchPoints, formFactor),
    touch: Number(maxTouchPoints || 0) > 0
  };
}

export function readDeviceProfile(scope = typeof window !== 'undefined' ? window : null) {
  if (!scope) return classifyDeviceProfile();
  return classifyDeviceProfile({
    width: scope.innerWidth, height: scope.innerHeight,
    userAgent: scope.navigator?.userAgent || '', maxTouchPoints: scope.navigator?.maxTouchPoints || 0
  });
}
