// Security headers sent on every response, in one place so a test can check them all.
// The placeholder page loads only its own stylesheet and script; nothing else is allowed.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Every powerful browser feature is switched off. Only features current browsers recognise are
// listed, so the header itself does not produce console warnings.
export const PERMISSIONS_POLICY = [
  'accelerometer', 'autoplay', 'camera', 'display-capture', 'encrypted-media', 'fullscreen',
  'geolocation', 'gyroscope', 'magnetometer', 'microphone', 'midi', 'payment',
  'picture-in-picture', 'publickey-credentials-get', 'screen-wake-lock', 'usb', 'xr-spatial-tracking'
].map(feature => `${feature}=()`).join(', ');

export function securityHeaders() {
  return {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow'
  };
}
