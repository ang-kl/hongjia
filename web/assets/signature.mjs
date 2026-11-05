// Signatures (D3): the pad where a person draws (mouse, trackpad, finger or Pencil with pressure) or
// types their signature, and how a saved or placed signature is drawn. A signature is kept as
// numbers (strokes on a 600 x 200 pad) or as the typed name, never as an image; the server checks
// both. Placing always uses the signer's own saved signature, copied by the server. Text is set with
// textContent only.

import { simplify, widthFor } from './ink.mjs';

export const PAD = { w: 600, h: 200 };
export const MAX_STROKES = 60;
export const MAX_POINTS = 1200;
export const MAX_TYPED = 60;
const SVG = 'http://www.w3.org/2000/svg';

const round = (v, places) => {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/// Strokes ({x, y, p} points) in the stored form: each simplified, kept inside the pad, at most 60
/// strokes and 1200 points in all; "x,y,p x,y,p;x,y,p ...". Empty when nothing was drawn.
export function formatStrokes(strokes) {
  const out = [];
  let total = 0;
  for (const stroke of strokes.slice(0, MAX_STROKES)) {
    if (!stroke.length) continue;
    const kept = simplify(stroke, 0.8).slice(0, MAX_POINTS - total);
    if (!kept.length) break;
    total += kept.length;
    out.push(kept.map(q => [
      round(Math.min(PAD.w, Math.max(0, q.x)), 1),
      round(Math.min(PAD.h, Math.max(0, q.y)), 1),
      round(Math.min(1, Math.max(0, Number.isFinite(q.p) ? q.p : 0.5)), 2)
    ].join(',')).join(' '));
    if (total >= MAX_POINTS) break;
  }
  return out.join(';');
}

/// Stored strokes back as arrays of {x, y, p}; anything unreadable is left out.
export function parseStrokes(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.split(';').map(stroke => stroke.split(' ').map(t => {
    const [x, y, p] = t.split(',').map(Number);
    return { x, y, p: Number.isFinite(p) ? p : 0.5 };
  }).filter(q => Number.isFinite(q.x) && Number.isFinite(q.y))).filter(s => s.length);
}

/// A typed signature as it will be saved: trimmed, 1 to 60 characters, no control characters.
export function cleanTyped(text) {
  const name = String(text ?? '').trim();
  const length = [...name].length;
  // eslint-disable-next-line no-control-regex
  return length >= 1 && length <= MAX_TYPED && !/[\u0000-\u001f\u007f]/.test(name) ? name : '';
}

/// SVG elements for drawn strokes on the pad's 600 x 200 box: one segment per pair of points, its
/// width following the pen's pressure (a single point is a dot).
export function strokeNodes(doc, strokes, base = 6) {
  const nodes = [];
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      const dot = doc.createElementNS(SVG, 'circle');
      dot.setAttribute('cx', stroke[0].x);
      dot.setAttribute('cy', stroke[0].y);
      dot.setAttribute('r', widthFor(base, stroke[0].p) / 2);
      dot.setAttribute('class', 'sig-dot');
      nodes.push(dot);
      continue;
    }
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i];
      const line = doc.createElementNS(SVG, 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('stroke-width', widthFor(base, (a.p + b.p) / 2));
      nodes.push(line);
    }
  }
  return nodes;
}

/// What a signature looks like: drawn strokes in an SVG, or the typed name in a script-style font.
export function signatureNodes(doc, strokesText, typed) {
  if (strokesText) {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${PAD.w} ${PAD.h}`);
    svg.setAttribute('class', 'sig-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.append(...strokeNodes(doc, parseStrokes(strokesText)));
    return svg;
  }
  const span = doc.createElement('span');
  span.className = 'sig-typed';
  span.textContent = typed || '';
  return span;
}

/// The signature pad, a dialog drawn by the page. `open({ saved })` shows it; it resolves with the
/// signature now saved ({ style, value }), or null when cancelled or deleted.
export function createSignaturePad(api) {
  const doc = document;
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  };
  const dialog = el('div', { className: 'sig-pad glass', role: 'dialog', ariaModal: 'true', 'aria-labelledby': 'sig-title', hidden: true, dataset: { sigPad: '' } });
  const title = el('h2', { id: 'sig-title', textContent: 'Your signature' });
  const drawTab = el('button', { type: 'button', className: 'sig-tab', textContent: 'Draw', ariaPressed: 'true', dataset: { sigTab: 'drawn' } });
  const typeTab = el('button', { type: 'button', className: 'sig-tab', textContent: 'Type', ariaPressed: 'false', dataset: { sigTab: 'typed' } });
  const area = doc.createElementNS(SVG, 'svg');
  area.setAttribute('viewBox', `0 0 ${PAD.w} ${PAD.h}`);
  area.setAttribute('class', 'sig-area');
  area.setAttribute('role', 'img');
  area.setAttribute('aria-label', 'Signature pad: draw with a mouse, a trackpad, a finger or the Pencil');
  area.dataset.sigArea = '';
  const baseline = doc.createElementNS(SVG, 'line');
  baseline.setAttribute('x1', 30); baseline.setAttribute('x2', 570); baseline.setAttribute('y1', 160); baseline.setAttribute('y2', 160);
  baseline.setAttribute('class', 'sig-baseline');
  const ink = doc.createElementNS(SVG, 'g');
  area.append(baseline, ink);
  const clear = el('button', { type: 'button', className: 'secondary', textContent: 'Clear', dataset: { sigClear: '' } });
  const drawPane = el('div', { className: 'sig-pane', dataset: { sigPane: 'drawn' } }, area, el('div', { className: 'sig-row' }, el('span', { className: 'small', textContent: 'Sign above the line.' }), clear));
  const input = el('input', { type: 'text', maxLength: MAX_TYPED, autocomplete: 'off', spellcheck: false, ariaLabel: 'Your name, as you sign it', dataset: { sigInput: '' } });
  const preview = el('p', { className: 'sig-typed sig-preview', ariaHidden: 'true' });
  const typePane = el('div', { className: 'sig-pane', hidden: true, dataset: { sigPane: 'typed' } }, el('label', {}, 'Your name ', input), preview);
  const status = el('p', { className: 'small', role: 'status', dataset: { sigStatus: '' } });
  const save = el('button', { type: 'button', textContent: 'Save signature', dataset: { sigSave: '' } });
  const cancel = el('button', { type: 'button', className: 'secondary', textContent: 'Cancel', dataset: { sigCancel: '' } });
  const remove = el('button', { type: 'button', className: 'link', textContent: 'Delete my saved signature', hidden: true, dataset: { sigDelete: '' } });
  dialog.append(title, el('p', { className: 'small', textContent: 'Saved to your profile and used whenever you choose Signature. Nobody else can place it. Placed signatures show your name and the time.' }),
    el('div', { className: 'sig-tabs', role: 'group', ariaLabel: 'How to sign' }, drawTab, typeTab), drawPane, typePane,
    el('div', { className: 'composer-actions' }, save, cancel), remove, status);
  doc.body.append(dialog);

  let strokes = [], current = null, style = 'drawn', finish = null, returnFocus = null, penSeen = false;
  const paintInk = () => ink.replaceChildren(...strokeNodes(doc, current ? [...strokes, current.points] : strokes));
  const choose = which => {
    style = which;
    drawTab.setAttribute('aria-pressed', String(which === 'drawn'));
    typeTab.setAttribute('aria-pressed', String(which === 'typed'));
    drawPane.hidden = which !== 'drawn';
    typePane.hidden = which !== 'typed';
    if (which === 'typed') input.focus();
  };
  const point = event => {
    const r = area.getBoundingClientRect();
    return {
      x: ((event.clientX - r.left) / r.width) * PAD.w,
      y: ((event.clientY - r.top) / r.height) * PAD.h,
      p: event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5
    };
  };
  area.addEventListener('pointerdown', event => {
    if (event.pointerType === 'pen') penSeen = true;
    if (event.pointerType === 'touch' && penSeen) return; // the palm, once a Pencil is in use
    if (event.button > 0) return;
    event.preventDefault();
    area.setPointerCapture?.(event.pointerId);
    current = { id: event.pointerId, points: [point(event)] };
    paintInk();
  });
  area.addEventListener('pointermove', event => {
    if (!current || event.pointerId !== current.id) return;
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const e of events.length ? events : [event]) current.points.push(point(e));
    paintInk();
  });
  const end = event => {
    if (!current || event.pointerId !== current.id) return;
    if (strokes.length < MAX_STROKES) strokes.push(current.points);
    current = null;
    paintInk();
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
  clear.addEventListener('click', () => { strokes = []; current = null; paintInk(); });
  input.addEventListener('input', () => { preview.textContent = input.value; });
  drawTab.addEventListener('click', () => choose('drawn'));
  typeTab.addEventListener('click', () => choose('typed'));

  const close = result => {
    dialog.hidden = true;
    doc.removeEventListener('keydown', onKey, true);
    returnFocus?.focus?.({ preventScroll: true });
    const done = finish;
    finish = null;
    done?.(result);
  };
  const onKey = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(null); return; }
    if (event.key !== 'Tab') return;
    // Keep Tab inside the dialog.
    const items = [...dialog.querySelectorAll('button, input')].filter(x => !x.hidden && !x.closest('[hidden]') && !x.disabled);
    const at = items.indexOf(doc.activeElement);
    if (event.shiftKey && at <= 0) { event.preventDefault(); items[items.length - 1]?.focus(); }
    else if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
  };
  cancel.addEventListener('click', () => close(null));
  save.addEventListener('click', async () => {
    const value = style === 'drawn' ? formatStrokes(strokes) : cleanTyped(input.value);
    if (!value) { status.textContent = style === 'drawn' ? 'Draw your signature first.' : 'Type your name first (up to 60 characters).'; return; }
    status.textContent = 'Saving…';
    try {
      const response = await api.post('/api/signature', { style, value });
      if (response.status !== 200) throw new Error(String(response.status));
      status.textContent = '';
      close(await response.json());
    } catch {
      status.textContent = 'Not saved; please try again.';
    }
  });
  remove.addEventListener('click', async () => {
    try {
      const response = await api.post('/api/signature', { op: 'delete' });
      if (response.status !== 204) throw new Error(String(response.status));
      api.announce('Your saved signature was deleted.');
      close(null);
    } catch {
      status.textContent = 'Not deleted; please try again.';
    }
  });

  return {
    open({ saved = null } = {}) {
      returnFocus = doc.activeElement;
      strokes = saved?.style === 'drawn' ? parseStrokes(saved.value) : [];
      current = null;
      input.value = saved?.style === 'typed' ? saved.value : '';
      preview.textContent = input.value;
      remove.hidden = !saved?.style;
      status.textContent = '';
      title.textContent = saved?.style ? 'Change your signature' : 'Your signature';
      paintInk();
      dialog.hidden = false;
      choose(saved?.style === 'typed' ? 'typed' : 'drawn');
      doc.addEventListener('keydown', onKey, true);
      (style === 'typed' ? input : drawTab).focus({ preventScroll: true });
      return new Promise(resolve => { finish = resolve; });
    },
    get isOpen() { return !dialog.hidden; }
  };
}
