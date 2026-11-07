// Signed-in pages only. Sends a heartbeat each minute while the tab is visible and was used in the
// last two minutes (an estimate of active time, not proof of reading), and, only where this device
// allowed it, one approximate location per session, rounded here to about 40 km before sending.

export const HEARTBEAT_MS = 60_000;
export const IDLE_LIMIT_MS = 120_000;

/// Rounds a coordinate to the nearest 0.4 of a degree (about 40 km); the server rounds it the same way.
export function roundCoordinate(value) {
  return Math.round(value * 2.5) * 4 / 10;
}

/// Whether a heartbeat should be sent now.
export function shouldBeat(visible, lastInteraction, now) {
  return visible && now - lastInteraction <= IDLE_LIMIT_MS;
}

function post(path, csrf, body) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }).catch(() => {});
}

if (typeof document !== 'undefined' && document.body?.dataset.csrf) {
  const { csrf, location } = document.body.dataset;
  let lastInteraction = Date.now();
  for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
    addEventListener(type, () => { lastInteraction = Date.now(); }, { passive: true });
  }
  setInterval(() => {
    if (shouldBeat(document.visibilityState === 'visible', lastInteraction, Date.now())) post('/api/heartbeat', csrf, '');
  }, HEARTBEAT_MS);

  if (location === 'yes' && 'geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      position => {
        const body = new URLSearchParams({
          lat: String(roundCoordinate(position.coords.latitude)),
          lon: String(roundCoordinate(position.coords.longitude))
        });
        post('/api/location', csrf, body.toString());
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 15_000 }
    );
  }
}
