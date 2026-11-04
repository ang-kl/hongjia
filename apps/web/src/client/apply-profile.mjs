import { readDeviceProfile } from '@hongjia/shared/device-profile';

// Mark the page with the owner's device tiers so the stylesheet can follow geometry, not brand.
const apply = () => {
  const profile = readDeviceProfile(window);
  const root = document.documentElement;
  root.dataset.formFactor = profile.formFactor;
  root.dataset.sizeTier = profile.sizeTier;
  root.dataset.aspectTier = profile.aspectTier;
  root.dataset.orientation = profile.orientation;
};

let frame = 0;
const schedule = () => {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(apply);
};

apply();
window.addEventListener('resize', schedule, { passive: true });
window.addEventListener('orientationchange', schedule, { passive: true });
