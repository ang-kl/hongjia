// The document page's side of saved fields and annotations (P2b C) and the annotation tools (D1).
// The helper inside the locked frame (frame-helper.js) sends messages here; every one is checked,
// because the document's own scripts can send the same messages. Saving needs this page's session
// and form token, so a document cannot write anything by itself except into its own saved fields,
// and it can never create, change, move or delete a mark: a person chooses in the menu or the
// panel drawn by this page. Words people write (comments, notes, text boxes, inserted and
// replacement text, stamps) and drawings (D2) are drawn here, over the frame, and never sent into it.
// D4: the uploader or the owner marks passages for redaction (a black box until applied in the
// panel), and anyone may pin a file at a point (a paperclip drawn here; the file is only ever
// downloaded, never opened in the site).

import { createInk, drawingNodes, parsePoints, placement } from './ink.mjs';
import { createSignaturePad, signatureNodes } from './signature.mjs';

export const LIMITS = { key: 200, value: 4000, storage: 8000, label: 200, quote: 1000, around: 64, id: 20, text: 500, body: 4000, path: 400 };
export const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];
export const STAMPS = [['check', '✓'], ['cross', '✗'], ['approved', 'Approved'], ['reviewed', 'Reviewed'], ['signedoff', 'Signed off']];
const TYPES = new Set(['hj:ready', 'hj:field', 'hj:storage', 'hj:selection', 'hj:focus', 'hj:open', 'hj:menu', 'hj:positions', 'hj:located', 'hj:loupe', 'hj:escape', 'hj:weather-want', 'hj:tiles-want', 'hj:share-want', 'hj:near-want', 'hj:tour']);
/// A trip page may ask for the forecast of up to this many places (travel kit, Phase 1).
export const MAX_WEATHER_PLACES = 12;
/// A trip page may ask which of up to this many places are nearest ("Near me", 6 November 2026).
export const MAX_NEAR_PLACES = 200;
/// The nearest places sent back, each with a rough distance only.
export const NEAR_ANSWERS = 20;
/// Lengths a trip page may ask this page to share (the Web Share API, 6 November 2026).
export const SHARE_LIMITS = { title: 120, text: 300, url: 2000 };
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PLACE_KEY = /^[a-z0-9][a-z0-9-]{0,29}$/;
/// Loupe magnifications (D3): 0 is closed.
export const LOUPE_ZOOMS = [0, 2, 3];
const INPUTS = new Set(['mouse', 'touch', 'pen', 'keyboard']);
const PATH = /^[a-z][a-z0-9-]{0,30}:[0-9]{1,5}(\/[a-z][a-z0-9-]{0,30}:[0-9]{1,5}){0,24}$/;

const isText = (v, max) => typeof v === 'string' && v.length <= max;
const isNumber = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isPath = v => v === '' || (isText(v, LIMITS.path) && PATH.test(v));

/// A message from the frame, cleaned, or null when it is not one the page accepts.
export function validMessage(data) {
  if (!data || typeof data !== 'object' || !TYPES.has(data.type)) return null;
  switch (data.type) {
    case 'hj:ready':
      return { type: data.type };
    case 'hj:field':
      if (!isText(data.key, LIMITS.key) || !data.key || !isText(data.value, LIMITS.value) || !isText(data.label ?? '', LIMITS.label)) return null;
      return { type: data.type, key: data.key, value: data.value, label: data.label ?? '' };
    case 'hj:storage': {
      if (!['set', 'remove', 'clear'].includes(data.op)) return null;
      if (data.op !== 'clear' && (!isText(data.key, LIMITS.key) || !data.key)) return null;
      if (data.op === 'set' && !isText(data.value, LIMITS.storage)) return null;
      return { type: data.type, op: data.op, key: data.op === 'clear' ? '' : data.key, value: data.op === 'set' ? data.value : '' };
    }
    case 'hj:selection': {
      if (!isText(data.quote, LIMITS.quote) || !isText(data.prefix ?? '', LIMITS.around) || !isText(data.suffix ?? '', LIMITS.around)) return null;
      const out = { type: data.type, quote: data.quote, prefix: data.prefix ?? '', suffix: data.suffix ?? '' };
      // Where the selected words are in the frame, and how they were selected (for ✎ Mark Up).
      if (data.input !== undefined) { if (!INPUTS.has(data.input)) return null; out.input = data.input; }
      if (data.box !== undefined) {
        const b = data.box;
        if (!b || !isNumber(b.x, -1e5, 1e5) || !isNumber(b.y, -1e5, 1e5) || !isNumber(b.w, 0, 1e5) || !isNumber(b.h, 0, 1e5)) return null;
        out.box = { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      return out;
    }
    case 'hj:focus':
      if (!isText(data.key, LIMITS.key) || !isText(data.label ?? '', LIMITS.label)) return null;
      return { type: data.type, key: data.key, label: data.label ?? '' };
    case 'hj:open':
      if (!isText(data.id, LIMITS.id) || !/^[0-9]+$/.test(data.id)) return null;
      return { type: data.type, id: data.id };
    case 'hj:menu': {
      const strings = [['quote', LIMITS.quote], ['prefix', LIMITS.around], ['suffix', LIMITS.around], ['ppre', LIMITS.around], ['psuf', LIMITS.around], ['field', LIMITS.key], ['label', LIMITS.label]];
      if (!INPUTS.has(data.input) || !isNumber(data.x, -1e4, 1e5) || !isNumber(data.y, -1e4, 1e5)) return null;
      if (!strings.every(([k, max]) => isText(data[k] ?? '', max)) || !isPath(data.path ?? '')) return null;
      if (!isNumber(data.fx ?? 0, 0, 1) || !isNumber(data.fy ?? 0, 0, 1)) return null;
      const out = { type: data.type, input: data.input, x: data.x, y: data.y, path: data.path ?? '', fx: data.fx ?? 0, fy: data.fy ?? 0 };
      for (const [k] of strings) out[k] = data[k] ?? '';
      return out;
    }
    case 'hj:positions': {
      if (!Array.isArray(data.items) || data.items.length > 1000 || !isNumber(data.w, 0, 1e5) || !isNumber(data.h, 0, 1e5)) return null;
      const items = [];
      for (const item of data.items) {
        if (!item || !isText(item.id, LIMITS.id) || !/^[0-9]+$/.test(item.id) || !isNumber(item.x, -1e6, 1e6) || !isNumber(item.y, -1e6, 1e6)) return null;
        // Drawings (D2) also carry their element's size, to scale them.
        if ((item.w !== undefined && !isNumber(item.w, 0, 1e6)) || (item.h !== undefined && !isNumber(item.h, 0, 1e6))) return null;
        items.push(item.w === undefined ? { id: item.id, x: item.x, y: item.y } : { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h ?? 0 });
      }
      return { type: data.type, items, w: data.w, h: data.h };
    }
    case 'hj:located': {
      if (!isText(data.req, 12) || !/^[0-9]+$/.test(data.req) || !isPath(data.path) || !data.path || !isNumber(data.fx, 0, 1) || !isNumber(data.fy, 0, 1)) return null;
      const box = ['bx', 'by', 'bw', 'bh'];
      if (!box.every(k => data[k] === undefined || isNumber(data[k], -1e6, 1e6))) return null;
      const out = { type: data.type, req: data.req, path: data.path, fx: data.fx, fy: data.fy };
      for (const k of box) if (data[k] !== undefined) out[k] = data[k];
      return out;
    }
    case 'hj:loupe':
      // The helper says the loupe closed (Escape, a click in the document) or could not open.
      if (!LOUPE_ZOOMS.includes(data.zoom) || !['', 'long'].includes(data.reason ?? '')) return null;
      return { type: data.type, zoom: data.zoom, reason: data.reason ?? '' };
    case 'hj:escape':
      // Escape pressed while the document has the keyboard: it closes the annotation menu.
      return { type: data.type };
    case 'hj:weather-want': {
      // A trip page names its places and dates; the server checks them again before asking.
      if (!Array.isArray(data.places) || data.places.length < 1 || data.places.length > MAX_WEATHER_PLACES) return null;
      const places = [];
      for (const p of data.places) {
        if (!p || typeof p !== 'object' || !isText(p.key, 30) || !PLACE_KEY.test(p.key)) return null;
        if (!isNumber(p.lat, -90, 90) || !isNumber(p.lon, -180, 180)) return null;
        if (!isText(p.start, 10) || !DATE.test(p.start) || !isText(p.end, 10) || !DATE.test(p.end) || p.end < p.start) return null;
        places.push({ key: p.key, lat: p.lat, lon: p.lon, start: p.start, end: p.end });
      }
      if (new Set(places.map(p => p.key)).size !== places.length) return null;
      return { type: data.type, places };
    }
    case 'hj:tiles-want':
      // A trip page's map asks for a ticket to load its map pictures through this site.
      return { type: data.type };
    case 'hj:tour':
      // A trip page's tour opened or closed: the page's right-hand buttons fold away meanwhile.
      if (typeof data.open !== 'boolean') return null;
      return { type: data.type, open: data.open };
    case 'hj:share-want':
      // The locked frame cannot share, so a trip page asks this page. A place is shared by its
      // public facts and an https link; the document itself only by its link on this site (the
      // owner, 6 November 2026: "link only"), so trip details never leave in the message.
      if (data.kind === 'doc') {
        if (!isText(data.title ?? '', SHARE_LIMITS.title)) return null;
        return { type: data.type, kind: 'doc', title: data.title ?? '' };
      }
      if (data.kind !== 'place' || !isText(data.title, SHARE_LIMITS.title) || !data.title.trim()) return null;
      if (!isText(data.text ?? '', SHARE_LIMITS.text) || !shareUrl(data.url)) return null;
      return { type: data.type, kind: 'place', title: data.title, text: data.text ?? '', url: data.url };
    case 'hj:near-want': {
      // "Near me": a trip page names its places; this page asks the person, then the device, and
      // answers with the nearest keys and rough distances, never the person's coordinates.
      if (!Array.isArray(data.places) || data.places.length < 1 || data.places.length > MAX_NEAR_PLACES) return null;
      const places = [];
      for (const p of data.places) {
        if (!p || typeof p !== 'object' || !isText(p.key, 30) || !PLACE_KEY.test(p.key)) return null;
        if (!isNumber(p.lat, -90, 90) || !isNumber(p.lon, -180, 180)) return null;
        places.push({ key: p.key, lat: p.lat, lon: p.lon });
      }
      if (new Set(places.map(p => p.key)).size !== places.length) return null;
      return { type: data.type, places };
    }
  }
  return null;
}

/// An address a trip page may ask to share: https only, no user name or password in it.
export function shareUrl(v) {
  if (!isText(v, SHARE_LIMITS.url) || !v.startsWith('https://')) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/// Distance on the Earth's surface in kilometres (haversine, mean radius 6,371 km).
export function distanceKm(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/// A distance as the trip page sees it: to the nearest half kilometre, and 0.5 for anything closer.
export const roughKm = km => Math.max(0.5, Math.round(km * 2) / 2);

/// The nearest places to a position, closest first, with rough distances only.
export function nearest(here, places, n = NEAR_ANSWERS) {
  return places
    .map(p => ({ key: p.key, d: distanceKm(here, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(p => ({ key: p.key, km: roughKm(p.d) }));
}

/// A simple budget: at most `limit` events in any `windowMs`.
export function rateLimiter(limit, windowMs) {
  let stamps = [];
  return now => {
    stamps = stamps.filter(t => now - t < windowMs);
    if (stamps.length >= limit) return false;
    stamps.push(now);
    return true;
  };
}

/// What the composer says it is commenting on.
export function targetText(target) {
  if (!target) return '';
  if (target.field) return `On the field: ${target.label || target.field}`;
  const quote = target.quote.length > 140 ? `${target.quote.slice(0, 140)}…` : target.quote;
  return `On: “${quote}”`;
}

/// Where a menu of size w × h goes for a pointer at x, y in a view of vw × vh: just below and to the
/// right of the pointer, moved back inside the view (and pinned to the top when taller than it).
export function placeMenu(x, y, w, h, vw, vh, margin = 8) {
  const left = Math.max(margin, Math.min(x, vw - w - margin));
  let top = y + h + margin <= vh ? y : y - h;
  top = Math.max(margin, Math.min(top, vh - h - margin));
  return { left: Math.round(left), top: Math.round(top) };
}

/// A text cut into plain pieces and the @mentions of family members (handles in lowercase).
export function mentionPieces(text, mentions) {
  const pieces = [];
  const pattern = /@([A-Za-z]{1,21})/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    const before = match.index === 0 ? '' : text[match.index - 1];
    if (/[\p{L}\p{N}]/u.test(before) || !mentions.includes(match[1].toLowerCase())) continue;
    if (match.index > last) pieces.push({ text: text.slice(last, match.index) });
    pieces.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });
  return pieces;
}

/// The handle being typed after an @ just before the caret, or null.
export function mentionQuery(text, caret) {
  const match = /(^|[^\p{L}\p{N}])@([A-Za-z]{0,20})$/u.exec(text.slice(0, caret));
  return match ? match[2].toLowerCase() : null;
}

/// A size in words, as the panel shows it: "820 bytes", "12 KB", "3.4 MB".
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.floor((n + 512) / 1024)} KB`;
  const tenths = Math.floor((n * 10 + 512 * 1024) / (1024 * 1024));
  return `${Math.floor(tenths / 10)}.${tenths % 10} MB`;
}

const TYPE_WORDS = { jpeg: 'JPEG picture', png: 'PNG picture', webp: 'WebP picture', pdf: 'PDF', docx: 'Word document', doc: 'Word document', xlsx: 'Excel workbook', xls: 'Excel workbook', pptx: 'PowerPoint', ppt: 'PowerPoint', csv: 'CSV', txt: 'Plain text' };
/// What an attached file's type is called in the panel.
export const typeWords = kind => TYPE_WORDS[kind] || 'Plain text';

/// The annotation menu (the owner's design, 6 November 2026): a short main menu whose submenus pop up
/// in its place, at most three groups per menu, Redact last. `needs` names the rule in `unavailable`.
export const MENU = {
  main: {
    title: 'Mark Up',
    groups: [
      [{ swatches: true, needs: 'quote' }, { label: 'Text', open: 'text' }, { label: 'Comment…', act: 'comment' }],
      [{ label: 'Note', open: 'note' }, { label: 'Stamp', open: 'stamp' }, { label: 'Signature', open: 'signature' }, { label: 'Draw', open: 'draw' }],
      [{ label: 'Redact', act: 'redaction', needs: 'redact', destructive: true }]
    ],
    more: [{ label: 'Loupe', act: 'loupe' }]
  },
  text: {
    title: 'Text',
    groups: [
      [{ label: 'Underline', act: 'underline', needs: 'quote' }, { label: 'Strikethrough', act: 'strike', needs: 'quote' }, { label: 'Replace…', act: 'replace', needs: 'quote' }],
      [{ label: 'Insert Text…', act: 'insert', needs: 'point' }],
      [{ label: 'Copy', act: 'copy', needs: 'quote' }]
    ]
  },
  note: {
    title: 'Note',
    groups: [
      [{ label: 'Sticky Note…', act: 'note', needs: 'place' }, { label: 'Text Box…', act: 'textbox', needs: 'place' }],
      [{ label: 'Attach File…', act: 'attach', needs: 'attach' }]
    ]
  },
  stamp: { title: 'Stamp', groups: [STAMPS.map(([stamp, label]) => ({ label, act: 'stamp', needs: 'place', data: { stamp } }))] },
  signature: {
    title: 'Signature',
    groups: [[{ label: 'Place My Signature', act: 'signature', needs: 'place' }, { label: 'Change My Signature…', act: 'mysignature', needs: 'signature' }]]
  },
  draw: {
    title: 'Draw',
    groups: [
      [{ label: 'Pen', act: 'ink', data: { tool: 'draw' } }, { label: 'Sketch', act: 'ink', data: { tool: 'sketch' } }],
      [{ label: 'Rectangle', act: 'ink', data: { tool: 'rectangle' } }, { label: 'Oval', act: 'ink', data: { tool: 'oval' } },
        { label: 'Line', act: 'ink', data: { tool: 'line' } }, { label: 'Arrow', act: 'ink', data: { tool: 'arrow' } }],
      [{ label: 'Eraser', act: 'ink', data: { tool: 'eraser' } }]
    ]
  }
};
/// Most files a document may have attached (as on the server).
export const MAX_ATTACHMENTS = 100;
/// Why a menu item cannot be used right now, or '' when it can. Unavailable items are greyed out
/// and show this reason (the owner's choice (b), 6 November 2026).
export function unavailable(needs, s) {
  switch (needs) {
    case 'quote': return s.picture ? 'Not on pictures' : s.quote ? '' : 'Select words first';
    case 'point': return s.picture ? 'Not on pictures' : s.point ? '' : 'Press inside the text first';
    case 'place': return s.place ? '' : 'Press on the document first';
    case 'redact':
      if (!s.manager) return 'Only the person who added this document, or the owner';
      if (s.picture) return 'Not on pictures yet';
      return s.quote ? '' : 'Select words first';
    case 'attach':
      if (!s.place) return 'Press on the document first';
      return s.attachments >= MAX_ATTACHMENTS ? `This document already has ${MAX_ATTACHMENTS} files` : '';
    case 'signature': return s.signature === false ? 'No signature yet: Place My Signature draws one first' : '';
    default: return '';
  }
}

const KIND_WORDS = { comment: 'Comment', highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', insert: 'Insert', replace: 'Replace', note: 'Sticky note', textbox: 'Text box', stamp: 'Stamp', ink: 'Drawing', shape: 'Shape', signature: 'Signature', redaction: 'Redaction', attachment: 'Attachment' };
const SHAPE_WORDS = { rectangle: 'Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow' };
const DRAWN = new Set(['ink', 'shape']);
const PLACED = new Set(['note', 'textbox', 'stamp', 'signature', 'attachment']);
const OVERLAID = new Set(['note', 'textbox', 'stamp', 'insert', 'replace', 'signature', 'attachment']);
/// Kinds listed in their own panel sections (D4).
const SEPARATE = ['redaction', 'attachment'];
const SVG = 'http://www.w3.org/2000/svg';

/// A paperclip, for an attached file's pin.
function paperclip(doc) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'clip-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M16.5 7v8.5a4.5 4.5 0 0 1-9 0V6a3 3 0 0 1 6 0v9a1.5 1.5 0 0 1-3 0V7.5');
  svg.append(path);
  return svg;
}

function element(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

function fillWithMentions(el, text, mentions) {
  el.replaceChildren(...mentionPieces(text, mentions).map(p => (p.mention ? element('span', { className: 'mention', textContent: p.text }) : document.createTextNode(p.text))));
}

function start() {
  const frame = document.querySelector('.doc-frame');
  const body = document.body;
  const { csrf, docKey } = body.dataset;
  if (!frame || !csrf || !docKey) return;
  const base = `/documents/${encodeURIComponent(docKey)}`;
  const list = document.querySelector('[data-annotations]');
  const count = document.querySelector('[data-annotation-count]');
  const empty = document.querySelector('[data-annotations-empty]');
  // D4: pending redactions and attachments have sections of their own.
  const lists = Object.fromEntries(SEPARATE.map(kind => [kind, document.querySelector(`[data-mark-list="${kind}"]`)]));
  const listFor = kind => lists[kind] || list;
  const manager = body.dataset.manager === 'true';
  const canRedact = body.dataset.canRedact === 'true';
  const docKind = body.dataset.docKind || '';
  const composer = document.querySelector('[data-composer]');
  const commentButton = document.querySelector('[data-comment]');
  const overlay = document.querySelector('[data-doc-overlay]');
  const allowWrite = rateLimiter(120, 10_000);
  const allowOther = rateLimiter(60, 1_000);
  const allowPositions = rateLimiter(240, 1_000);
  const beside = matchMedia('(min-aspect-ratio: 1/1) and (min-width: 720px)');

  const post = (path, fields) => fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  const toFrame = message => frame.contentWindow?.postMessage(message, '*');
  // While the trip's tour is open, the 🛰️ globe 📁 buttons fold into 🔭 so they never cover the tour.
  const tourMode = on => {
    const root = document.documentElement;
    root.classList.toggle('tour-on', on);
    root.classList.remove('fabs-peek');
    document.querySelector('[data-fab-scope]')?.setAttribute('aria-expanded', 'false');
  };
  // Trip pages (travel kit, Phase 1): the page names its places and dates, this page asks the
  // server, which asks Open-Meteo, and each answer goes back into the frame as 'hj:weather'.
  // Each place is asked for once per load of the document.
  const weatherAsked = new Set();
  // Trip maps (T2): the locked frame cannot send a Referer, which OpenStreetMap requires, so the
  // page loads its map pictures from this site with a ticket; asked for once per load.
  let tilesAsked = false;
  const askTiles = async () => {
    if (tilesAsked) return;
    tilesAsked = true;
    let answer;
    try {
      const reply = await fetch('/api/tile-ticket', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      const data = await reply.json();
      answer = reply.ok && typeof data.ticket === 'string' && /^[0-9]{1,12}\.[0-9a-f]{32}$/.test(data.ticket)
        ? { ok: true, base: `${location.origin}/tiles`, ticket: data.ticket, expires: Number(data.expires) || 0 }
        : { ok: false };
    } catch {
      answer = { ok: false };
    }
    toFrame({ type: 'hj:tiles', ...answer });
  };
  const askWeather = async places => {
    for (const p of places) {
      if (weatherAsked.has(p.key)) continue;
      weatherAsked.add(p.key);
      const query = new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), start: p.start, end: p.end });
      let answer;
      try {
        const reply = await fetch(`/api/weather?${query}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
        const data = await reply.json();
        answer = reply.ok ? { ok: true, available: data.available === true, from: data.from ?? '', past: data.past === true, days: Array.isArray(data.days) ? data.days : [], source: data.source ?? '', link: data.link ?? '' }
          : { ok: false, error: data.error ?? 'The forecast could not be fetched just now.' };
      } catch {
        answer = { ok: false, error: 'The forecast could not be fetched just now.' };
      }
      toFrame({ type: 'hj:weather', key: p.key, ...answer });
    }
  };

  // Share and Near me for trip pages (6 November 2026). The locked frame may not use either, so
  // it asks this page. Every question to the person is shown here, in the site's own bar and
  // words, never by the document: share what, or use this device's location once.
  const askBar = document.createElement('div');
  askBar.className = 'doc-ask';
  askBar.hidden = true;
  askBar.setAttribute('role', 'dialog');
  askBar.setAttribute('aria-live', 'polite');
  document.body.append(askBar);
  let askDone = null;
  const closeAsk = result => {
    askBar.hidden = true;
    askBar.replaceChildren();
    const done = askDone;
    askDone = null;
    if (done) done(result);
  };
  const ask = (label, words, buttons) => {
    if (askDone) closeAsk('replaced');
    const text = document.createElement('p');
    text.textContent = words;
    const row = document.createElement('div');
    row.className = 'doc-ask-row';
    for (const [value, name, solid] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = solid ? 'pill solid' : 'pill';
      b.textContent = name;
      b.dataset.ask = value;
      row.append(b);
    }
    askBar.setAttribute('aria-label', label);
    askBar.replaceChildren(text, row);
    askBar.hidden = false;
    askBar.querySelector('button')?.focus({ preventScroll: true });
    return new Promise(resolve => { askDone = resolve; });
  };
  askBar.addEventListener('click', event => {
    const b = event.target.closest('button[data-ask]');
    if (b) closeAsk(b.dataset.ask);
  });
  askBar.addEventListener('keydown', event => { if (event.key === 'Escape') closeAsk('no'); });

  const allowShare = rateLimiter(1, 2_000);
  let sharing = false;
  const systemShare = async data => {
    try {
      await navigator.share(data);
      return 'share';
    } catch (error) {
      return error?.name === 'AbortError' ? 'cancel' : 'refused';
    }
  };
  const shareFrom = async message => {
    if (sharing || !allowShare(Date.now())) return;
    const data = message.kind === 'doc'
      ? { title: message.title || document.title, url: `${location.origin}${base}` }
      : { title: message.title, ...(message.text ? { text: message.text } : {}), url: message.url };
    // A trip page shares outside places only; this site's own addresses are shared as the document.
    if (message.kind === 'place' && new URL(data.url).origin === location.origin) return;
    sharing = true;
    let how = 'refused';
    try {
      const can = typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data));
      // A tap inside the frame usually lets this page share at once; when the browser says no,
      // the person taps Share in this page's own bar instead.
      if (can) how = await systemShare(data);
      if (how === 'refused') {
        const what = message.kind === 'doc' ? 'the link to this document (family sign-in needed)' : `“${data.title}”`;
        const choice = await ask('Share', `Share ${what}?`, [
          ...(can ? [['share', 'Share…', true]] : []), ['copy', 'Copy link', !can], ['no', 'Cancel', false]
        ]);
        if (choice === 'share') how = await systemShare(data);
        else if (choice === 'copy') {
          try {
            await navigator.clipboard.writeText(data.url);
            how = 'copy';
            announce('Link copied.');
          } catch {
            how = 'refused';
          }
        } else how = 'cancel';
      }
    } finally {
      sharing = false;
    }
    toFrame({ type: 'hj:shared', ok: how === 'share' || how === 'copy', how });
  };

  // Near me: asked once per load of the document, in this page's words; the reading is coarse
  // (no high accuracy, a cached reading up to five minutes old) and is used here only to sort the
  // trip page's places. It is never sent to the server, stored, or passed into the frame.
  const allowNear = rateLimiter(1, 5_000);
  let nearAgreed = false;
  let nearBusy = false;
  const nearFrom = async places => {
    if (nearBusy || !allowNear(Date.now())) return;
    const reply = answer => toFrame({ type: 'hj:near', ...answer });
    if (!('geolocation' in navigator)) return reply({ ok: false, reason: 'unsupported' });
    nearBusy = true;
    try {
      if (!nearAgreed) {
        const choice = await ask('Near me', 'Find the trip places nearest to you? Your rough location is used on this device only, to sort the list; it is not sent to the site or kept.', [
          ['yes', 'Use my location', true], ['no', 'Not now', false]
        ]);
        if (choice !== 'yes') return reply({ ok: false, reason: 'declined' });
        nearAgreed = true;
      }
      const here = await new Promise(resolve => navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        e => resolve({ error: e?.code === 1 ? 'denied' : e?.code === 3 ? 'timeout' : 'unavailable' }),
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 15_000 }
      ));
      if (here.error) return reply({ ok: false, reason: here.error });
      reply({ ok: true, places: nearest(here, places) });
    } finally {
      nearBusy = false;
    }
  };

  // Saved values, gathered briefly so a burst of typing is one request per field.
  const pending = new Map();
  let timer = 0;
  const flush = () => {
    timer = 0;
    for (const fields of pending.values()) post(`${base}/fields`, fields).catch(() => {});
    pending.clear();
  };
  const save = (id, fields) => {
    pending.set(id, fields);
    if (!timer) timer = setTimeout(flush, 500);
  };
  addEventListener('pagehide', flush);

  // The marks, as the helper needs them: places and the document's own text only, no words
  // people wrote.
  const entries = () => [list, ...Object.values(lists)].filter(Boolean).flatMap(l => [...l.querySelectorAll('li[data-annotation-id]')]);
  const anchors = () => entries().map(li => ({
    id: li.dataset.annotationId, kind: li.dataset.kind || 'comment', color: li.dataset.color || 'yellow',
    quote: li.dataset.quote || '', prefix: li.dataset.prefix || '', suffix: li.dataset.suffix || '',
    field: li.dataset.field || '', path: li.dataset.path || '', x: Number(li.dataset.x || 0), y: Number(li.dataset.y || 0)
  }));
  const sendAnchors = () => { toFrame({ type: 'hj:anchors', items: anchors() }); drawOverlay(); };
  const refreshCount = () => {
    const n = list.querySelectorAll('li[data-annotation-id]').length;
    count.textContent = String(n);
    empty.hidden = n > 0;
    for (const [kind, l] of Object.entries(lists)) {
      if (!l) continue;
      const k = l.querySelectorAll('li[data-annotation-id]').length;
      const badge = document.querySelector(`[data-mark-count="${kind}"]`);
      const none = document.querySelector(`[data-mark-empty="${kind}"]`);
      if (badge) badge.textContent = String(k);
      if (none) none.hidden = k > 0;
    }
  };

  // What Comment will attach to: the latest selection or focused field in the document.
  let target = null;
  const showComment = () => {
    commentButton.hidden = !target;
    commentButton.textContent = target?.field ? 'Comment on this field' : 'Comment';
  };
  const setComposer = chosen => {
    const form = composer.elements;
    form.quote.value = chosen?.quote || '';
    form.prefix.value = chosen?.prefix || '';
    form.suffix.value = chosen?.suffix || '';
    form.field_key.value = chosen?.field || '';
    form.field_label.value = chosen?.field ? (chosen.label || '') : '';
    const line = composer.querySelector('[data-composer-target]');
    line.textContent = targetText(chosen);
    line.hidden = !chosen;
    composer.querySelector('[data-composer-clear]').hidden = !chosen;
  };
  const openPanel = () => {
    if (beside.matches) {
      // The sidebar may have been closed with ×; Comment brings it back.
      if (body.dataset.sidebar === 'off') {
        body.dataset.sidebar = 'on';
        try { localStorage.setItem('hj:sidebar', 'on'); } catch { /* storage may be blocked */ }
      }
    } else if (location.hash !== '#panel') {
      location.hash = 'panel';
    }
    document.dispatchEvent(new Event('hj:sidebar'));
  };
  const startComment = chosen => {
    setComposer(chosen);
    openPanel();
    document.getElementById('annotations')?.scrollIntoView({ block: 'start' });
    composer.elements.body.focus({ preventScroll: true });
  };
  commentButton.addEventListener('click', () => startComment(target));
  composer.querySelector('[data-composer-clear]').addEventListener('click', () => setComposer(null));

  // One entry in the panel, built from what the server returned.
  const item = a => {
    const li = element('li', { className: `annotation${a.mentions?.includes(body.dataset.viewer || '') ? ' mentions-me' : ''}`, id: `annotation-${a.id}`, tabIndex: -1 });
    Object.assign(li.dataset, {
      annotationId: a.id, kind: a.kind || 'comment', color: a.color || 'yellow', quote: a.quote || '', prefix: a.prefix || '',
      suffix: a.suffix || '', field: a.field || '', text: a.text || '', label: a.label || '', path: a.path || '',
      x: a.x == null ? '' : String(a.x), y: a.y == null ? '' : String(a.y), body: a.body || '', canEdit: String(Boolean(a.can_edit))
    });
    if (DRAWN.has(a.kind)) Object.assign(li.dataset, { tool: a.tool || '', points: a.points || '', width: String(a.width ?? ''), ref: String(a.ref ?? ''), refh: String(a.refh ?? '') });
    if (a.kind === 'signature') li.dataset.points = a.points || '';
    const tag = () => element('span', { className: 'kind-tag', textContent: KIND_WORDS[a.kind] || 'Comment', dataset: { color: a.color || 'yellow' } });
    let head;
    switch (a.kind) {
      case 'highlight': case 'underline': case 'strike':
        head = element('blockquote', { className: 'annotation-quote' }, tag(), ` “${a.quote}”`); break;
      case 'insert':
        head = element('p', { className: 'annotation-quote' }, tag(), ` “${a.text}” ${a.quote ? `after “${a.quote}”` : 'here'}`); break;
      case 'replace':
        head = element('p', { className: 'annotation-quote' }, tag(), ` “${a.quote}” with “${a.text}”`); break;
      case 'stamp': case 'signature':
        head = element('p', { className: 'annotation-quote' }, tag(), ` ${a.label}`); break;
      case 'note': case 'textbox':
        head = element('p', { className: 'annotation-quote' }, tag()); break;
      case 'redaction':
        head = element('blockquote', { className: 'annotation-quote' }, element('span', { className: 'kind-tag kind-redaction', textContent: 'Redaction' }), ` “${a.quote}”`); break;
      case 'attachment':
        head = element('p', { className: 'annotation-quote' }, element('span', { className: 'kind-tag kind-attachment', textContent: 'Attachment' }), ' ', element('span', { className: 'wrap', textContent: a.text || '' }));
        break;
      case 'ink': case 'shape':
        head = element('p', { className: 'annotation-quote' },
          element('span', { className: 'kind-tag', textContent: a.kind === 'shape' ? (SHAPE_WORDS[a.tool] || 'Shape') : 'Drawing', dataset: { color: a.color || 'yellow' } }),
          ` in ${a.color || 'yellow'}`);
        break;
      default:
        if (a.field) head = element('p', { className: 'annotation-quote', textContent: `On the field: ${a.field_label || a.field}` });
        else if (a.quote) head = element('blockquote', { className: 'annotation-quote', textContent: `“${a.quote}”` });
        else head = element('p', { className: 'annotation-quote', textContent: 'On the whole document' });
    }
    if (a.kind !== 'comment' || a.field || a.quote) head.dataset.annotationJump = '';
    li.append(head);
    if (a.kind === 'attachment') {
      li.append(element('p', { className: 'attachment-file' },
        element('a', { href: `${base}/attachments/${a.id}`, download: '', textContent: 'Download', dataset: { attachmentLink: '' } }),
        ` · ${typeWords(a.file_type)} · ${fileSize(a.size)}`));
    }
    if (a.body) {
      const text = element('p', { className: 'annotation-body' });
      fillWithMentions(text, a.body, a.mentions || []);
      li.append(text);
    }
    li.append(element('p', { className: 'small', textContent: `${a.author}, ${a.created} (SGT) · version ${a.version}` }));
    const actions = element('div', { className: 'annotation-actions' });
    // A signature is moved, never edited (D3); nor are redactions and attachments (D4).
    if (a.can_edit && !['signature', 'redaction', 'attachment'].includes(a.kind)) actions.append(element('button', { type: 'button', className: 'link', textContent: 'Edit', dataset: { annotationEdit: '' } }));
    if (a.can_delete) {
      const form = element('form', { method: 'post', action: `${base}/annotations/${a.id}/delete`, dataset: { annotationDelete: '' } },
        element('input', { type: 'hidden', name: 'csrf', value: csrf }),
        element('button', { type: 'submit', className: 'link', textContent: 'Delete' }));
      actions.append(form);
    }
    li.append(actions);
    return li;
  };
  const replaceEntry = a => {
    const old = document.getElementById(`annotation-${a.id}`);
    const fresh = item(a);
    if (old) old.replaceWith(fresh); else listFor(a.kind).append(fresh);
    refreshCount();
    sendAnchors();
    return fresh;
  };
  const focusEntry = id => {
    const li = document.getElementById(`annotation-${id}`);
    if (!li) return;
    openPanel();
    li.scrollIntoView({ block: 'center' });
    li.focus({ preventScroll: true });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1200);
  };

  const removeEntry = id => {
    document.getElementById(`annotation-${id}`)?.remove();
    refreshCount();
    sendAnchors();
  };

  const create = async fields => {
    const response = await post(`${base}/annotations`, fields);
    if (response.status !== 201) throw new Error(String(response.status));
    return replaceEntry(await response.json());
  };

  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const status = composer.querySelector('[data-composer-status]');
    const fields = Object.fromEntries(new FormData(composer));
    delete fields.csrf;
    if (!fields.body.trim()) { status.textContent = 'Write a comment first.'; return; }
    status.textContent = 'Saving…';
    try {
      await create(fields);
      composer.elements.body.value = '';
      setComposer(null);
      target = null;
      showComment();
      status.textContent = 'Comment saved.';
    } catch {
      status.textContent = 'The comment was not saved. Please try again.';
    }
  });

  const onListSubmit = async event => {
    const form = event.target.closest('form[data-annotation-delete]');
    if (form) {
      event.preventDefault();
      try {
        const response = await post(form.action, { csrf });
        if (response.status !== 204) throw new Error(String(response.status));
        removeEntry(form.closest('li')?.dataset.annotationId);
      } catch {
        form.querySelector('button').textContent = 'Not deleted; try again';
      }
      return;
    }
    const edit = event.target.closest('form[data-annotation-editor]');
    if (!edit) return;
    event.preventDefault();
    const li = edit.closest('li');
    const fields = { op: 'edit', body: edit.elements.body?.value ?? li.dataset.body, text: edit.elements.text?.value ?? '' };
    try {
      const response = await post(`${base}/annotations/${li.dataset.annotationId}/update`, fields);
      if (response.status !== 200) throw new Error(String(response.status));
      replaceEntry(await response.json()).focus();
    } catch {
      edit.querySelector('[data-editor-status]').textContent = 'Not saved; check the words and try again.';
    }
  };

  const onListClick = event => {
    const editButton = event.target.closest('[data-annotation-edit]');
    if (editButton) {
      const li = editButton.closest('li');
      if (li.querySelector('form[data-annotation-editor]')) return;
      const kind = li.dataset.kind;
      const form = element('form', { className: 'stack annotation-editor', dataset: { annotationEditor: '' } });
      if (kind === 'insert' || kind === 'replace') {
        form.append(element('label', {}, kind === 'insert' ? 'Text to insert ' : 'Replacement ', element('input', { type: 'text', name: 'text', maxLength: LIMITS.text, required: true, value: li.dataset.text })));
      }
      const textarea = element('textarea', { name: 'body', rows: 3, maxLength: LIMITS.body, value: li.dataset.body, required: ['comment', 'note', 'textbox'].includes(kind) });
      form.append(element('label', {}, kind === 'note' || kind === 'textbox' ? 'Words ' : 'Comment ', textarea));
      attachMentions(textarea);
      form.append(element('div', { className: 'composer-actions' },
        element('button', { type: 'submit', textContent: 'Save' }),
        element('button', { type: 'button', className: 'secondary', textContent: 'Cancel', dataset: { editorCancel: '' } })),
      element('p', { className: 'small', role: 'status', dataset: { editorStatus: '' } }));
      li.append(form);
      (form.querySelector('input[name=text]') || textarea).focus();
      return;
    }
    if (event.target.closest('[data-editor-cancel]')) { event.target.closest('form')?.remove(); return; }
    const jump = event.target.closest('[data-annotation-jump]');
    const li = jump?.closest('li[data-annotation-id]');
    if (li) {
      toFrame({ type: 'hj:scroll', id: li.dataset.annotationId });
      flashDrawing(li.dataset.annotationId);
    }
  };
  for (const l of [list, ...Object.values(lists)].filter(Boolean)) {
    l.addEventListener('submit', onListSubmit);
    l.addEventListener('click', onListClick);
  }

  // @mentions: the family's handles, offered under a text box when @ is typed.
  let handles = null;
  const loadHandles = async () => {
    if (handles) return handles;
    try { handles = await (await fetch('/api/handles', { credentials: 'same-origin' })).json(); } catch { handles = []; }
    return handles;
  };
  function attachMentions(textarea) {
    const box = element('ul', { className: 'mention-list', role: 'listbox', hidden: true });
    textarea.after(box);
    let choices = [], active = 0;
    const close = () => { box.hidden = true; choices = []; };
    const pick = handle => {
      const caret = textarea.selectionStart;
      const before = textarea.value.slice(0, caret).replace(/@([A-Za-z]{0,20})$/, `@${handle} `);
      textarea.value = before + textarea.value.slice(caret);
      textarea.setSelectionRange(before.length, before.length);
      close();
      textarea.focus();
    };
    const paint = () => box.replaceChildren(...choices.map((h, i) => {
      const option = element('li', { role: 'option', textContent: `@${h}`, ariaSelected: String(i === active) });
      option.addEventListener('pointerdown', event => { event.preventDefault(); pick(h); });
      return option;
    }));
    textarea.addEventListener('input', async () => {
      const query = mentionQuery(textarea.value, textarea.selectionStart);
      if (query == null) { close(); return; }
      choices = (await loadHandles()).filter(h => h.startsWith(query)).slice(0, 8);
      active = 0;
      box.hidden = choices.length === 0;
      paint();
    });
    textarea.addEventListener('keydown', event => {
      if (box.hidden || !choices.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
        paint();
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pick(choices[active]);
      } else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    textarea.addEventListener('blur', () => setTimeout(close, 150));
  }
  attachMentions(composer.elements.body);

  // Marks drawn over the frame: notes, text boxes, stamps, inserted and replacement words.
  const positions = new Map();
  const shapes = new Map();
  const frameOffset = () => ({ left: frame.clientLeft || 0, top: frame.clientTop || 0 });
  function drawOverlay() {
    if (!overlay) return;
    const seen = new Set();
    for (const li of entries()) {
      const { annotationId: id, kind } = li.dataset;
      if (!OVERLAID.has(kind)) continue;
      seen.add(id);
      let shape = shapes.get(id);
      if (!shape) {
        shape = element('div', { className: `ov ov-${kind}`, dataset: { id } });
        shapes.set(id, shape);
        overlay.append(shape);
        wireShape(shape);
      }
      shape.dataset.color = li.dataset.color || 'yellow';
      shape.dataset.own = li.dataset.canEdit === 'true' ? 'true' : 'false';
      if (kind === 'attachment') {
        // A paperclip and the file's name; the file is in the panel, to download.
        if (shape.dataset.name !== li.dataset.text) {
          shape.dataset.name = li.dataset.text;
          shape.title = li.dataset.text;
          shape.replaceChildren(paperclip(document), element('span', { className: 'clip-name', textContent: li.dataset.text }));
        }
      } else if (kind === 'signature') {
        // The signature (drawn strokes or the typed name) and its caption from the server.
        const sig = `${li.dataset.points}|${li.dataset.text}|${li.dataset.label}`;
        if (shape.dataset.sig !== sig) {
          shape.dataset.sig = sig;
          shape.replaceChildren(signatureNodes(document, li.dataset.points, li.dataset.text), element('span', { className: 'sig-caption', textContent: li.dataset.label }));
        }
      } else {
        const words = kind === 'stamp' ? li.dataset.label : (kind === 'insert' || kind === 'replace') ? li.dataset.text : li.dataset.body;
        fillWithMentions(shape, kind === 'insert' ? `‸ ${words}` : words, []);
      }
      placeShape(id);
    }
    for (const [id, shape] of shapes) if (!seen.has(id)) { shape.remove(); shapes.delete(id); }
    drawDrawings();
  }

  // Drawings (D2): one SVG group each, in the drawing's reference size, scaled and moved to where
  // its element is now. Only the lines take clicks, which open the drawing's entry.
  const inkLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  inkLayer.setAttribute('class', 'ink-layer');
  overlay?.prepend(inkLayer);
  const groups = new Map();
  const drawingOf = li => ({
    kind: li.dataset.kind, tool: li.dataset.tool, width: Number(li.dataset.width) || 4,
    ref: Number(li.dataset.ref) || 1, refh: Number(li.dataset.refh) || 0, points: parsePoints(li.dataset.points || '')
  });
  function drawDrawings() {
    if (!overlay) return;
    const seen = new Set();
    for (const li of entries()) {
      const { annotationId: id, kind } = li.dataset;
      if (!DRAWN.has(kind)) continue;
      seen.add(id);
      const sig = `${li.dataset.points}|${li.dataset.color}|${li.dataset.tool}|${li.dataset.width}`;
      let group = groups.get(id);
      if (!group || group.dataset.sig !== sig) {
        group?.remove();
        group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.dataset.id = id;
        group.dataset.sig = sig;
        group.setAttribute('data-color', li.dataset.color || 'yellow');
        group.setAttribute('class', `ink ink-${kind}`);
        group.append(...drawingNodes(document, drawingOf(li)));
        group.addEventListener('click', () => focusEntry(id));
        groups.set(id, group);
        inkLayer.append(group);
      }
      placeDrawing(id);
    }
    for (const [id, group] of groups) if (!seen.has(id)) { group.remove(); groups.delete(id); }
  }
  function placeDrawing(id) {
    const group = groups.get(id);
    const at = positions.get(id);
    if (!group) return;
    if (!at || at.w === undefined) { group.setAttribute('visibility', 'hidden'); return; }
    const li = document.getElementById(`annotation-${id}`);
    const pl = li ? placement(drawingOf(li), at) : { x: at.x, y: at.y, s: 1 };
    const off = frameOffset();
    group.setAttribute('visibility', 'visible');
    group.setAttribute('transform', `translate(${pl.x + off.left} ${pl.y + off.top}) scale(${pl.s})`);
  }
  function flashDrawing(id) {
    const group = groups.get(id);
    if (!group) return;
    group.classList.add('flash');
    setTimeout(() => group.classList.remove('flash'), 1200);
  }
  function placeShape(id) {
    const shape = shapes.get(id);
    const at = positions.get(id);
    if (!shape) return;
    if (!at) { shape.hidden = true; return; }
    const off = frameOffset();
    shape.hidden = false;
    shape.style.left = `${at.x + off.left}px`;
    shape.style.top = `${at.y + off.top}px`;
  }

  // Dragging your own placed marks (mouse, touch or Pencil); a click opens the entry instead.
  let requests = 0;
  const located = new Map();
  // Where a point of the frame's viewport is in the document: an element path, the point as
  // fractions of that element's box, and the box itself.
  const askPlace = async (x, y) => {
    const req = String(++requests);
    const answer = new Promise(resolve => { located.set(req, resolve); setTimeout(() => resolve(null), 2000); });
    toFrame({ type: 'hj:locate', req, x, y });
    const place = await answer;
    located.delete(req);
    return place;
  };
  function wireShape(shape) {
    shape.addEventListener('pointerdown', event => {
      if (!event.isPrimary) return;
      const id = shape.dataset.id;
      const kind = entries().find(li => li.dataset.annotationId === id)?.dataset.kind;
      const own = shape.dataset.own === 'true' && PLACED.has(kind);
      const startX = event.clientX, startY = event.clientY;
      const left = parseFloat(shape.style.left) || 0, top = parseFloat(shape.style.top) || 0;
      let moved = false;
      if (own) shape.setPointerCapture(event.pointerId);
      const move = e => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        if (own) { shape.classList.add('dragging'); shape.style.left = `${left + dx}px`; shape.style.top = `${top + dy}px`; }
      };
      const up = async () => {
        shape.removeEventListener('pointermove', move);
        shape.removeEventListener('pointerup', up);
        shape.removeEventListener('pointercancel', up);
        shape.classList.remove('dragging');
        if (!moved) { focusEntry(id); return; }
        if (!own) return;
        const off = frameOffset();
        const place = await askPlace((parseFloat(shape.style.left) || 0) - off.left, (parseFloat(shape.style.top) || 0) - off.top);
        if (!place) { placeShape(id); return; }
        try {
          const response = await post(`${base}/annotations/${id}/update`, { op: 'move', anchor_path: place.path, anchor_x: String(place.fx), anchor_y: String(place.fy) });
          if (response.status !== 200) throw new Error(String(response.status));
          replaceEntry(await response.json());
        } catch { placeShape(id); }
      };
      shape.addEventListener('pointermove', move);
      shape.addEventListener('pointerup', up);
      shape.addEventListener('pointercancel', up);
    });
  }

  // The annotation menu, opened by right-click or two quick taps (a finger or the Pencil) in the frame (and by
  // ✎ Mark Up beside a touch selection). The owner's design, 6 November 2026: a short main menu whose
  // submenus pop up in its place; the same bar on every menu (◀ back, ▼/▲ fold and unfold, … more
  // and why items are grey, × close); everything unavailable greyed out with its reason; submenus in
  // a font one size smaller; the size fits the rows and never the whole window.
  let color = 'yellow';
  let context = null;
  let stack = ['main'];
  let folded = false;
  let signatureSaved;
  const menu = element('div', { className: 'anno-menu glass', role: 'menu', ariaLabel: 'Mark up', tabIndex: -1, hidden: true });
  // The bar's symbols are drawn, all in one 16 by 16 box, so ◀ ▼ ▲ … × are the same size everywhere.
  const SVG = 'http://www.w3.org/2000/svg';
  const ICONS = {
    back: '<path d="M11 2.5 3.5 8l7.5 5.5z"/>',
    down: '<path d="M2.5 5h11L8 12.5z"/>',
    up: '<path d="M2.5 11h11L8 3.5z"/>',
    more: '<circle cx="3" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="13" cy="8" r="1.6"/>',
    close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
  };
  const icon = name => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'anno-icon');
    svg.innerHTML = ICONS[name];
    return svg;
  };
  const navButton = (nav, shape, label) => {
    const b = element('button', { type: 'button', className: 'anno-nav', title: label, ariaLabel: label, dataset: { nav, icon: shape } });
    b.append(icon(shape));
    return b;
  };
  const backButton = navButton('back', 'back', 'Back');
  const titleText = element('span', { className: 'anno-title' });
  const foldButton = navButton('fold', 'down', 'Fold the menu');
  const moreButton = navButton('more', 'more', 'More, and why items are grey');
  const closeButton = navButton('close', 'close', 'Close (Esc)');
  const head = element('div', { className: 'anno-head' }, backButton, titleText, foldButton, moreButton, closeButton);
  const bodyBox = element('div', { className: 'anno-body' });
  const why = element('p', { className: 'anno-why', role: 'status', dataset: { annoWhy: '' } });
  const form = element('form', { className: 'anno-form' });
  const formColors = element('div', { className: 'anno-row anno-colors', role: 'radiogroup', ariaLabel: 'Colour' });
  for (const c of COLORS) formColors.append(element('label', { className: 'swatch-choice' }, element('input', { type: 'radio', name: 'color', value: c, ariaLabel: c }), element('span', { className: 'swatch', dataset: { color: c } })));
  const formInput = element('textarea', { rows: 3, maxLength: LIMITS.body, required: true, dataset: { annoInput: '' } });
  form.append(formInput, formColors, element('div', { className: 'composer-actions' },
    element('button', { type: 'submit', textContent: 'Add' }),
    element('button', { type: 'button', className: 'secondary', textContent: 'Cancel', dataset: { annoCancel: '' } })),
  element('p', { className: 'small', role: 'status', dataset: { annoStatus: '' } }));
  attachMentions(formInput);
  menu.append(head, bodyBox, why);
  document.body.append(menu);
  // ✎ Mark Up: beside words selected with a finger or the Pencil, where iPadOS shows its own Copy bar.
  const pill = element('button', { type: 'button', className: 'anno-pill glass', textContent: '✎ Mark Up', ariaLabel: 'Mark up the selected words', hidden: true });
  document.body.append(pill);
  let pillAt = null;
  const hidePill = () => { pill.hidden = true; pillAt = null; };

  const attachmentCount = () => entries().filter(li => li.dataset.kind === 'attachment').length;
  const situation = () => ({
    quote: Boolean(context?.quote.trim()),
    point: Boolean(context && (context.quote.trim() || context.ppre || context.psuf)),
    place: Boolean(context?.path),
    picture: docKind === 'picture',
    manager,
    attachments: attachmentCount(),
    signature: signatureSaved
  });
  const viewTitle = name => (name === 'form' ? formTitle : name === 'more' ? 'More' : MENU[name].title);
  const itemButton = (spec, reason) => {
    const b = element('button', { type: 'button', className: `anno-item${spec.open ? ' anno-open' : ''}${spec.destructive ? ' anno-danger' : ''}`, role: 'menuitem' });
    b.append(element('span', { textContent: spec.label }));
    if (spec.open) { b.dataset.open = spec.open; b.setAttribute('aria-haspopup', 'menu'); b.append(element('span', { className: 'anno-chev', textContent: '›', ariaHidden: 'true' })); }
    for (const [k, v] of Object.entries(spec.data || {})) b.dataset[k] = v;
    if (spec.act) b.dataset.act = spec.act;
    if (reason) { b.setAttribute('aria-disabled', 'true'); b.dataset.why = reason; b.title = reason; }
    return b;
  };
  const greyedIn = name => {
    const s = situation();
    const out = [];
    for (const group of MENU[name].groups) for (const spec of group) {
      const reason = unavailable(spec.needs, s);
      if (reason) out.push([spec.swatches ? 'Highlight' : spec.label, reason]);
    }
    return out;
  };
  function render() {
    const name = stack[stack.length - 1];
    const parent = stack.length > 1 ? stack[stack.length - 2] : null;
    menu.dataset.view = name;
    titleText.textContent = viewTitle(name);
    backButton.setAttribute('aria-disabled', String(stack.length === 1));
    if (foldButton.dataset.icon !== (folded ? 'up' : 'down')) {
      foldButton.dataset.icon = folded ? 'up' : 'down';
      foldButton.replaceChildren(icon(foldButton.dataset.icon));
    }
    foldButton.setAttribute('aria-label', folded ? 'Unfold the menu' : 'Fold the menu');
    foldButton.title = foldButton.getAttribute('aria-label');
    bodyBox.hidden = folded;
    why.textContent = '';
    bodyBox.replaceChildren();
    const s = situation();
    if (name === 'form') {
      bodyBox.append(form);
      moreButton.setAttribute('aria-disabled', 'true');
    } else if (name === 'more') {
      const from = MENU[parent];
      for (const spec of from.more || []) bodyBox.append(itemButton(spec, unavailable(spec.needs, s)));
      const grey = greyedIn(parent);
      if (grey.length) {
        bodyBox.append(element('p', { className: 'anno-label', textContent: 'Why some items are grey' }));
        const list = element('ul', { className: 'anno-reasons' });
        for (const [label, reason] of grey) list.append(element('li', {}, element('b', { textContent: `${label}: ` }), document.createTextNode(reason)));
        bodyBox.append(list);
      }
      moreButton.setAttribute('aria-disabled', 'true');
    } else {
      const view = MENU[name];
      view.groups.forEach((group, i) => {
        if (i) bodyBox.append(element('div', { className: 'anno-sep', role: 'separator' }));
        for (const spec of group) {
          if (spec.swatches) {
            const reason = unavailable('quote', s);
            const row = element('div', { className: 'anno-row', role: 'group', ariaLabel: 'Highlight' }, element('span', { className: 'anno-label', textContent: 'Highlight' }));
            for (const c of COLORS) {
              const sw = element('button', { type: 'button', className: 'swatch', role: 'menuitem', ariaLabel: `Highlight ${c}`, title: reason || `Highlight ${c}`, dataset: { act: 'highlight', color: c } });
              if (reason) { sw.setAttribute('aria-disabled', 'true'); sw.dataset.why = reason; }
              row.append(sw);
            }
            bodyBox.append(row);
          } else bodyBox.append(itemButton(spec, unavailable(spec.needs, s)));
        }
      });
      moreButton.setAttribute('aria-disabled', String(!(view.more?.length || greyedIn(name).length)));
    }
    placeOpenMenu(context.px, context.py);
  }
  const menuItems = () => [...bodyBox.querySelectorAll('[role=menuitem]')];
  const go = name => { stack.push(name); folded = false; render(); (menuItems()[0] || moreButton).focus({ preventScroll: true }); };
  const back = () => { if (stack.length > 1) { stack.pop(); folded = false; render(); (menuItems()[0] || menu).focus({ preventScroll: true }); } };
  let returnFocus = null;
  const closeMenu = (focusBack = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    if (focusBack && returnFocus) returnFocus.focus({ preventScroll: true });
  };
  const placeOpenMenu = (px, py) => {
    menu.style.maxHeight = `${innerHeight - 16}px`;
    menu.style.maxWidth = `${Math.min(300, innerWidth - 16)}px`;
    const { left, top } = placeMenu(px, py, menu.offsetWidth, Math.min(menu.offsetHeight, innerHeight - 16), innerWidth, innerHeight);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  function openMenu(message) {
    const r = frame.getBoundingClientRect();
    const off = frameOffset();
    context = { ...message, px: r.left + off.left + message.x, py: r.top + off.top + message.y };
    hidePill();
    stack = ['main'];
    folded = false;
    returnFocus = message.input === 'keyboard' ? frame : document.activeElement;
    menu.hidden = false;
    render();
    (menuItems().find(b => b.getAttribute('aria-disabled') !== 'true') || menuItems()[0] || menu).focus({ preventScroll: true });
    if (signatureSaved === undefined) savedSignature().then(sig => { signatureSaved = Boolean(sig); if (!menu.hidden && stack.includes('signature')) render(); }).catch(() => {});
  }
  const chooseColor = c => { color = c; toFrame({ type: 'hj:tool', color }); };
  const markFields = kind => ({ kind, color, quote: context.quote, prefix: context.prefix, suffix: context.suffix });
  const placeFields = kind => ({ kind, color, anchor_path: context.path, anchor_x: String(context.fx), anchor_y: String(context.fy) });
  let formKind = '';
  let formTitle = '';
  const askFor = (kind, label, max, multiline) => {
    formKind = kind;
    formTitle = label;
    formInput.value = '';
    formInput.maxLength = max;
    formInput.rows = multiline ? 3 : 1;
    formColors.hidden = !(kind === 'note' || kind === 'textbox');
    for (const radio of formColors.querySelectorAll('input')) radio.checked = radio.value === color;
    form.querySelector('[data-anno-status]').textContent = '';
    go('form');
    formInput.focus();
  };
  const run = async (fields, done = 'Added.', reasonFor = () => 'Not saved; please try again.') => {
    // The menu may have been opened again while this was saving; only close the one it came from.
    const session = context;
    try {
      const li = await create(fields);
      if (context === session) closeMenu(false);
      li?.classList.add('flash');
      setTimeout(() => li?.classList.remove('flash'), 1200);
      document.querySelector('[data-anno-live]').textContent = done;
    } catch (error) {
      if (context !== session) return;
      const message = reasonFor(error?.message);
      if (stack[stack.length - 1] === 'form') form.querySelector('[data-anno-status]').textContent = message;
      else why.textContent = message;
    }
  };
  const redactRefusal = code => code === '403' ? 'Only the person who added this document, or the owner, can redact it.'
    : code === '422' ? 'Pictures cannot be redacted yet.'
    : code === '409' ? 'Not marked: these words cross formatting (bold, a link or a table) in the file. Select plain words, or a shorter piece.'
    : 'Not marked; please try again.';
  head.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]')?.dataset.nav;
    if (!nav || event.target.closest('[aria-disabled="true"]')) return;
    if (nav === 'close') closeMenu();
    else if (nav === 'back') back();
    else if (nav === 'fold') { folded = !folded; render(); foldButton.focus({ preventScroll: true }); }
    else if (nav === 'more') go('more');
  });
  bodyBox.addEventListener('click', event => {
    const button = event.target.closest('button[data-act], button[data-open]');
    if (!button || !context) return;
    if (button.getAttribute('aria-disabled') === 'true') { why.textContent = button.dataset.why || ''; return; }
    if (button.dataset.open) { go(button.dataset.open); return; }
    const act = button.dataset.act;
    switch (act) {
      case 'highlight': chooseColor(button.dataset.color); run(markFields('highlight'), 'Highlighted.'); break;
      case 'underline': case 'strike': run(markFields(act), act === 'strike' ? 'Struck through.' : 'Underlined.'); break;
      case 'redaction': run(markFields('redaction'), 'Marked for redaction. Apply it in the panel to black it out for good.', redactRefusal); break;
      case 'attach': {
        const fields = placeFields('attachment');
        closeMenu(false);
        pickFile(fields);
        break;
      }
      case 'insert': askFor('insert', 'Text to insert', LIMITS.text, false); break;
      case 'replace': askFor('replace', 'Replace with', LIMITS.text, false); break;
      case 'note': askFor('note', 'Sticky note', LIMITS.body, true); break;
      case 'textbox': askFor('textbox', 'Text box', LIMITS.body, true); break;
      case 'comment': {
        const chosen = context.field ? { field: context.field, label: context.label } : context.quote.trim() ? { quote: context.quote, prefix: context.prefix, suffix: context.suffix } : null;
        closeMenu(false);
        startComment(chosen);
        break;
      }
      case 'stamp': run({ ...placeFields('stamp'), text: button.dataset.stamp }, 'Stamped.'); break;
      case 'ink':
        closeMenu(false);
        ink.enter(button.dataset.tool);
        break;
      case 'signature': {
        // Place your own saved signature; with none saved yet, the pad opens first.
        const fields = placeFields('signature');
        closeMenu(false);
        placeSignature(fields).then(() => { signatureSaved = undefined; }).catch(() => {});
        break;
      }
      case 'mysignature':
        closeMenu(false);
        Promise.resolve(changeSignature()).then(() => { signatureSaved = undefined; }).catch(() => {});
        break;
      case 'loupe':
        closeMenu(false);
        loupe.set(2);
        break;
      case 'copy':
        navigator.clipboard?.writeText(context.quote).catch(() => {});
        closeMenu();
        break;
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const words = formInput.value.trim();
    if (!words || !context) return;
    const picked = formColors.querySelector('input:checked')?.value;
    if (picked && !formColors.hidden) chooseColor(picked);
    if (formKind === 'insert') {
      const fields = context.quote.trim() ? markFields('insert') : { kind: 'insert', color, quote: '', prefix: context.ppre, suffix: context.psuf };
      run({ ...fields, text: words }, 'Insertion added.');
    } else if (formKind === 'replace') run({ ...markFields('replace'), text: words }, 'Replacement added.');
    else run({ ...placeFields(formKind), body: words }, formKind === 'note' ? 'Note added.' : 'Text box added.');
  });
  form.querySelector('[data-anno-cancel]').addEventListener('click', back);
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
    if (event.target.closest('form')) return;
    const items = menuItems();
    const at = items.indexOf(document.activeElement);
    const step = i => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') { event.preventDefault(); step(at + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(at - 1); }
    else if (event.key === 'ArrowRight' && document.activeElement?.dataset?.open) { event.preventDefault(); go(document.activeElement.dataset.open); }
    else if (event.key === 'ArrowLeft' && stack.length > 1) { event.preventDefault(); back(); }
    else if (event.key === 'Home') { event.preventDefault(); step(0); }
    else if (event.key === 'End') { event.preventDefault(); step(items.length - 1); }
    else if (event.key === 'Tab') closeMenu(false);
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target)) closeMenu(false);
    if (!pill.hidden && event.target !== pill) hidePill();
  }, true);
  addEventListener('resize', () => { if (!menu.hidden && context) placeOpenMenu(context.px, context.py); hidePill(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(); } });
  const showPill = message => {
    if (!menu.hidden || !message.box) { hidePill(); return; }
    const r = frame.getBoundingClientRect();
    const off = frameOffset();
    const b = message.box;
    pillAt = { x: b.x + b.w / 2, y: b.y + b.h };
    pill.hidden = false;
    const w = pill.offsetWidth, h = pill.offsetHeight;
    const cx = r.left + off.left + pillAt.x, below = r.top + off.top + b.y + b.h + 12;
    const top = below + h + 8 <= innerHeight ? below : r.top + off.top + b.y - h - 12;
    pill.style.left = `${Math.round(Math.max(8, Math.min(cx - w / 2, innerWidth - w - 8)))}px`;
    pill.style.top = `${Math.round(Math.max(8, Math.min(top, innerHeight - h - 8)))}px`;
  };
  pill.addEventListener('click', () => {
    if (!pillAt) return;
    toFrame({ type: 'hj:menu-at', x: Math.round(pillAt.x), y: Math.round(pillAt.y) });
    hidePill();
  });
  addEventListener('resize', () => closeMenu(false));
  body.append(element('p', { className: 'visually-hidden', role: 'status', dataset: { annoLive: '' } }));
  const announce = text => { document.querySelector('[data-anno-live]').textContent = text; };

  // Signatures (D3): the pad, and placing your own saved signature at a point.
  const pad = createSignaturePad({ post, announce });
  const savedSignature = async () => {
    try {
      const response = await fetch('/api/signature', { credentials: 'same-origin' });
      if (!response.ok) return null;
      const saved = await response.json();
      return saved.style ? saved : null;
    } catch { return null; }
  };
  async function placeSignature(fields) {
    try {
      const li = await create(fields);
      li?.classList.add('flash');
      setTimeout(() => li?.classList.remove('flash'), 1200);
      announce('Signed.');
    } catch (error) {
      if (error.message !== '409') { announce('The signature was not placed; please try again.'); return; }
      const saved = await pad.open({ saved: null });
      if (saved) placeSignature(fields);
    }
  }
  async function changeSignature() {
    const saved = await pad.open({ saved: await savedSignature() });
    if (saved) announce('Your signature was saved.');
  }

  // Attachments (D4): the file picker opens from the menu; the file goes with the place chosen.
  const fileInput = document.querySelector('[data-attach-input]');
  const attachStatus = document.querySelector('[data-attach-status]');
  let attachAt = null;
  function pickFile(fields) {
    if (!fileInput) return;
    attachAt = fields;
    fileInput.value = '';
    fileInput.click();
  }
  const tellAttach = (text, show) => {
    if (attachStatus) attachStatus.textContent = text;
    announce(text);
    if (show) {
      openPanel();
      document.getElementById('attachments')?.scrollIntoView({ block: 'start' });
    }
  };
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const at = attachAt;
    attachAt = null;
    if (!file || !at) return;
    const data = new FormData();
    data.append('anchor_path', at.anchor_path);
    data.append('anchor_x', at.anchor_x);
    data.append('anchor_y', at.anchor_y);
    data.append('file', file, file.name);
    tellAttach(`Attaching ${file.name}…`, false);
    try {
      const response = await fetch(`${base}/attachments`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf }, body: data });
      if (response.status !== 201) {
        let message = 'The file was not attached; please try again.';
        try { message = (await response.json()).error || message; } catch { /* not JSON */ }
        tellAttach(message, true);
        return;
      }
      const li = replaceEntry(await response.json());
      li.classList.add('flash');
      setTimeout(() => li.classList.remove('flash'), 1200);
      tellAttach(`${file.name} attached.`, false);
    } catch {
      tellAttach('The file was not attached; please try again.', true);
    } finally {
      fileInput.value = '';
    }
  });

  // The loupe (D3): drawn by the helper inside the frame, over the document's own content only.
  // This page sends the magnification, and the pointer's place while drawing covers the frame.
  const loupeChip = element('div', { className: 'loupe-chip glass', role: 'toolbar', ariaLabel: 'Loupe', hidden: true, dataset: { loupeChip: '' } },
    element('span', { className: 'anno-label', textContent: 'Loupe' }),
    element('button', { type: 'button', className: 'ink-button ink-text', textContent: '2×', ariaPressed: 'true', dataset: { loupeZoom: '2' } }),
    element('button', { type: 'button', className: 'ink-button ink-text', textContent: '3×', ariaPressed: 'false', dataset: { loupeZoom: '3' } }),
    element('button', { type: 'button', className: 'ink-button ink-text ink-done', textContent: 'Close', dataset: { loupeClose: '' } }));
  document.body.append(loupeChip);
  const loupe = {
    zoom: 0,
    paint() {
      loupeChip.hidden = this.zoom === 0;
      for (const b of loupeChip.querySelectorAll('[data-loupe-zoom]')) b.setAttribute('aria-pressed', String(Number(b.dataset.loupeZoom) === this.zoom));
      body.classList.toggle('louping', this.zoom > 0);
    },
    set(zoom) {
      this.zoom = LOUPE_ZOOMS.includes(zoom) ? zoom : 0;
      toFrame({ type: 'hj:loupe', zoom: this.zoom });
      this.paint();
      if (this.zoom) announce(`Loupe at ${this.zoom} times. Move over the document; Escape or a click closes it.`);
    },
    at(x, y) { if (this.zoom) toFrame({ type: 'hj:loupe-at', x, y }); }
  };
  loupeChip.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.loupeZoom) loupe.set(Number(button.dataset.loupeZoom));
    else if ('loupeClose' in button.dataset) loupe.set(0);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && loupe.zoom && !pad.isOpen) loupe.set(0); });

  // Drawing (D2): the toolbar and the drawing surface over the frame.
  const ink = createInk({
    frame,
    layerHost: document.querySelector('[data-doc-stage]') || frame.parentElement,
    toFrame,
    askPlace,
    color: () => color,
    setColor: chooseColor,
    announce,
    save: create,
    undo: async () => {
      const response = await post(`${base}/annotations/undo`, {});
      if (response.status !== 200) return false;
      removeEntry((await response.json()).id);
      return true;
    },
    erase: async id => {
      try {
        const response = await post(`${base}/annotations/${id}/delete`, { csrf });
        if (response.status !== 204) return false;
        removeEntry(id);
        return true;
      } catch { return false; }
    },
    drawings: () => entries().filter(li => DRAWN.has(li.dataset.kind)).map(li => ({
      id: li.dataset.annotationId,
      canDelete: Boolean(li.querySelector('form[data-annotation-delete]')),
      drawing: drawingOf(li),
      at: positions.get(li.dataset.annotationId)
    })),
    onExit: () => frame.focus({ preventScroll: true }),
    // D3: the loupe from the drawing toolbar follows the pen while drawing covers the frame.
    toggleLoupe: () => loupe.set(loupe.zoom ? 0 : 2),
    loupeMove: (x, y) => loupe.at(x, y),
    loupeOn: () => loupe.zoom > 0
  });

  addEventListener('message', event => {
    if (event.source !== frame.contentWindow) return;
    const message = validMessage(event.data);
    if (!message) return;
    if (message.type === 'hj:positions') {
      if (!allowPositions(Date.now())) return;
      positions.clear();
      for (const p of message.items) positions.set(p.id, p);
      for (const id of shapes.keys()) placeShape(id);
      for (const id of groups.keys()) placeDrawing(id);
      return;
    }
    const write = message.type === 'hj:field' || message.type === 'hj:storage';
    if (!(write ? allowWrite : allowOther)(Date.now())) return;
    switch (message.type) {
      case 'hj:ready':
        tourMode(false);
        sendAnchors();
        toFrame({ type: 'hj:tool', color });
        weatherAsked.clear();
        tilesAsked = false;
        break;
      case 'hj:tiles-want':
        askTiles();
        break;
      case 'hj:weather-want':
        askWeather(message.places);
        break;
      case 'hj:share-want':
        shareFrom(message);
        break;
      case 'hj:tour':
        tourMode(message.open);
        break;
      case 'hj:near-want':
        nearFrom(message.places);
        break;
      case 'hj:field':
        save(`f:${message.key}`, { kind: 'field', op: 'set', key: message.key, value: message.value, label: message.label });
        break;
      case 'hj:storage':
        if (message.op === 'clear') for (const id of pending.keys()) if (id.startsWith('s:')) pending.delete(id);
        save(message.op === 'clear' ? 's:*clear' : `s:${message.key}`, { kind: 'storage', op: message.op, key: message.key, value: message.value });
        break;
      case 'hj:selection':
        target = message.quote ? { quote: message.quote, prefix: message.prefix, suffix: message.suffix } : (target?.field ? target : null);
        showComment();
        if (message.quote && (message.input === 'touch' || message.input === 'pen')) showPill(message);
        else hidePill();
        break;
      case 'hj:focus':
        target = message.key ? { field: message.key, label: message.label } : null;
        showComment();
        break;
      case 'hj:open':
        focusEntry(message.id);
        break;
      case 'hj:menu':
        openMenu(message);
        break;
      case 'hj:located': {
        const resolve = located.get(message.req);
        if (resolve) resolve(message);
        break;
      }
      case 'hj:escape':
        closeMenu();
        break;
      case 'hj:loupe':
        loupe.zoom = message.zoom;
        loupe.paint();
        if (message.reason === 'long') announce('This page is too long for the loupe; pinch or zoom the browser instead.');
        break;
    }
  });

  frame.addEventListener('load', sendAnchors);
  sendAnchors();
}

if (typeof document !== 'undefined' && document.querySelector('.doc-frame')) start();
