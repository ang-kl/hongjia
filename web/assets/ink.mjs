// D2: drawing over a document (owner's request, 5 November 2026): Draw (freehand), Sketch (a rough
// line, arrow, rectangle, circle or oval becomes a clean shape), Shapes (rectangle, oval, line,
// arrow), Eraser and Undo, with a mouse, a finger or the Apple Pencil (its pressure varies the line).
//
// Drawings are people's work, so like notes and text boxes (D1) they are drawn by the page over the
// document frame and never enter it: the frame only reports where each drawing's element sits.
// A drawing is anchored to the element under its first point; its points are pixels from that
// element's top-left corner when the element was `ref` pixels wide, and they are scaled by the
// element's current width, so a drawing keeps its place when the page reflows or is seen on another
// device. A stroke that crosses several elements follows the first one.
//
// The top part is plain functions (tested by web/test/ink.test.mjs); createInk() builds the
// toolbar and the drawing surface for doc-view.mjs.

export const TOOLS = [['draw', '✎', 'Draw'], ['sketch', '〰', 'Sketch'], ['rectangle', '▭', 'Rectangle'], ['oval', '◯', 'Oval'], ['line', '╱', 'Line'], ['arrow', '➜', 'Arrow'], ['eraser', '⌫', 'Eraser']];
export const SHAPES = ['rectangle', 'oval', 'line', 'arrow'];
export const WIDTHS = [2, 4, 8];
export const MAX_POINTS = 600;
const SVG = 'http://www.w3.org/2000/svg';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;

/// The length of a path through the points.
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/// Ramer-Douglas-Peucker: drops points closer than `epsilon` to the line their neighbours make.
/// Keeps the first and last points and each kept point's other values (pressure).
export function simplify(points, epsilon) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = -1, at = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > worst) { worst = d; at = i; }
    }
    if (at !== -1 && worst > epsilon) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/// A stroke simplified gently, then harder until it has at most `max` points.
export function capPoints(points, max = MAX_POINTS) {
  let epsilon = 0.6;
  let out = simplify(points, epsilon);
  while (out.length > max) {
    epsilon *= 1.6;
    out = simplify(points, epsilon);
  }
  return out;
}

/// What a sketch was meant to be: { tool, a, b } for a line or arrow (from a to b) or a rectangle or
/// oval (a and b are opposite corners of its box), or null to keep the freehand stroke.
/// Deterministic: the same points always give the same answer.
export function recognise(points) {
  const n = points.length;
  if (n < 2) return null;
  const length = pathLength(points);
  if (length < 12) return null;
  const start = points[0], end = points[n - 1];
  const chord = dist(start, end);
  if (chord / length > 0.94) return { tool: 'line', a: start, b: end };

  // An arrow: a straight shaft to the point furthest from the start, then a short hook back.
  let apex = 0;
  for (let i = 1; i < n; i++) if (dist(start, points[i]) > dist(start, points[apex])) apex = i;
  const shaft = dist(start, points[apex]);
  if (apex > 0 && apex < n - 1 && shaft > 30 && shaft / pathLength(points.slice(0, apex + 1)) > 0.93) {
    const hook = pathLength(points.slice(apex));
    const ux = (points[apex].x - start.x) / shaft, uy = (points[apex].y - start.y) / shaft;
    const back = dist(points[apex], end);
    const cos = back ? ((end.x - points[apex].x) * ux + (end.y - points[apex].y) * uy) / back : 1;
    if (hook >= 0.08 * shaft && hook <= 0.6 * shaft && cos < -0.25 && cos > -0.985) return { tool: 'arrow', a: start, b: points[apex] };
  }

  // A closed shape: ends close together, a real size, and a path that goes all the way round.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const w = maxX - minX, h = maxY - minY, size = Math.max(w, h), diag = Math.hypot(w, h);
  // A circle's path is about 1.57 times its width plus height; a rectangle's, 2.
  if (w < 12 || h < 12 || chord > 0.25 * size || length < 1.3 * (w + h)) return null;
  const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const cornerGap = Math.max(...corners.map(c => Math.min(...points.map(p => dist(p, c))))) / diag;
  const edgeError = points.reduce((sum, p) => sum + Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y), 0) / n / size;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = w / 2, ry = h / 2;
  const ovalError = points.reduce((sum, p) => sum + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1), 0) / n;
  const box = { a: { x: minX, y: minY }, b: { x: maxX, y: maxY } };
  if (cornerGap < 0.075 && edgeError < 0.07) return { tool: 'rectangle', ...box };
  if (ovalError < 0.15 && cornerGap > 0.09) return { tool: 'oval', ...box };
  return null;
}

/// Ink points as stored: "x,y,p x,y,p".
export function formatInk(points) {
  return points.map(p => `${round1(p.x)},${round1(p.y)},${round2(Math.max(0, Math.min(1, p.p ?? 0.5)))}`).join(' ');
}

/// A shape's two points as stored: "x1,y1 x2,y2".
export function formatShape(a, b) {
  return `${round1(a.x)},${round1(a.y)} ${round1(b.x)},${round1(b.y)}`;
}

/// Stored points back to { x, y, p }; an empty list when the text is not valid.
export function parsePoints(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const token of text.split(' ')) {
    const [x, y, p] = token.split(',').map(Number);
    if (![x, y].every(Number.isFinite)) return [];
    out.push({ x, y, p: Number.isFinite(p) ? p : 0.5 });
  }
  return out;
}

/// How much a drawing is scaled: its element's width now over its width when it was drawn.
export function scaleOf(elementWidth, refWidth) {
  return refWidth > 0 && elementWidth > 0 ? elementWidth / refWidth : 1;
}

/// A point of a drawing in the frame's viewport, given where its element is now ({ x, y, w }).
export function toView(point, at, refWidth) {
  const s = scaleOf(at.w, refWidth);
  return { x: at.x + point.x * s, y: at.y + point.y * s };
}

/// Where a drawing goes now, given its element's box `at` ({ x, y, w, h }). The drawing keeps its
/// shape (scaled by the element's width), and its first point keeps its place against the element:
/// inside it, at the same fraction of the element's height (text reflows taller on a narrow
/// screen); above or below it, the same scaled distance from that edge. Drawings saved without a
/// height (`refh`) are scaled by width only. Returns the origin and scale for the drawing's points.
export function placement(drawing, at) {
  const s = scaleOf(at.w, drawing.ref);
  const first = drawing.points?.[0];
  const refH = Number(drawing.refh) || 0;
  let shift = 0;
  if (first && refH > 0 && at.h > 0) {
    const y0 = first.y;
    const target = y0 < 0 ? y0 * s : y0 > refH ? at.h + (y0 - refH) * s : (y0 / refH) * at.h;
    shift = target - y0 * s;
  }
  return { x: at.x, y: at.y + shift, s };
}

/// The line width for a base width and a pen pressure (0.5 is the base width).
export function widthFor(base, pressure) {
  return base * (0.35 + 1.3 * Math.max(0, Math.min(1, pressure)));
}

/// Who may draw: once a Pencil has been seen, fingers scroll instead (palm rejection); otherwise a
/// finger draws (phones), as do a Pencil and a mouse with its main button.
export function inkPolicy() {
  let pen = false;
  return {
    decide(pointerType, isPrimary = true, button = 0) {
      if (pointerType === 'pen') { pen = true; return 'draw'; }
      if (pointerType === 'mouse') return button === 0 ? 'draw' : 'ignore';
      if (pointerType === 'touch') return pen ? 'scroll' : (isPrimary ? 'draw' : 'ignore');
      return 'ignore';
    },
    get penSeen() { return pen; }
  };
}

/// The two short strokes of an arrow's head at b, for an arrow from a.
export function arrowHead(a, b, length) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const wing = Math.PI * 28 / 180;
  return [angle + Math.PI - wing, angle + Math.PI + wing].map(t => ({ x: b.x + length * Math.cos(t), y: b.y + length * Math.sin(t) }));
}

/// A drawing as line segments in its own (reference) coordinates, for the eraser.
export function segmentsOf(drawing) {
  const pts = drawing.points;
  const segs = [];
  const add = (a, b) => segs.push([a, b]);
  if (drawing.kind === 'ink') {
    if (pts.length === 1) add(pts[0], pts[0]);
    for (let i = 1; i < pts.length; i++) add(pts[i - 1], pts[i]);
    return segs;
  }
  const [a, b] = pts;
  if (!a || !b) return segs;
  if (drawing.tool === 'rectangle') {
    const c = { x: b.x, y: a.y }, d = { x: a.x, y: b.y };
    add(a, c); add(c, b); add(b, d); add(d, a);
  } else if (drawing.tool === 'oval') {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    let prev = null;
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      const p = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
      if (prev) add(prev, p);
      prev = p;
    }
  } else {
    add(a, b);
    if (drawing.tool === 'arrow') for (const w of arrowHead(a, b, Math.max(10, drawing.width * 3))) add(b, w);
  }
  return segs;
}

/// Whether a point in the frame's viewport touches a drawing placed at `at` (within `radius` px
/// plus half its line).
export function touches(drawing, at, x, y, radius) {
  const pl = placement(drawing, at);
  const reach = radius + (drawing.width * pl.s) / 2;
  const p = { x, y };
  const view = q => ({ x: pl.x + q.x * pl.s, y: pl.y + q.y * pl.s });
  return segmentsOf(drawing).some(([a, b]) => segmentDistance(p, view(a), view(b)) <= reach);
}

/// SVG elements for a drawing, in its reference coordinates (the caller scales and places the group).
export function drawingNodes(doc, drawing) {
  const make = (tag, attrs) => {
    const node = doc.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const pts = drawing.points;
  const base = drawing.width;
  if (drawing.kind === 'ink') {
    const even = pts.every(p => Math.abs(p.p - pts[0].p) < 0.01);
    if (even) return [make('polyline', { points: pts.map(p => `${p.x},${p.y}`).join(' '), 'stroke-width': widthFor(base, pts[0]?.p ?? 0.5) })];
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      out.push(make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': widthFor(base, (a.p + b.p) / 2) }));
    }
    return out;
  }
  const [a, b] = pts;
  if (!a || !b) return [];
  if (drawing.tool === 'rectangle') {
    return [make('rect', { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), 'stroke-width': base })];
  }
  if (drawing.tool === 'oval') {
    return [make('ellipse', { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2, 'stroke-width': base })];
  }
  const nodes = [make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': base })];
  if (drawing.tool === 'arrow') {
    const [w1, w2] = arrowHead(a, b, Math.max(10, base * 3));
    nodes.push(make('polyline', { points: `${w1.x},${w1.y} ${b.x},${b.y} ${w2.x},${w2.y}`, 'stroke-width': base }));
  }
  return nodes;
}

/// The drawing toolbar and surface. `api` comes from doc-view.mjs:
///   stage, frame, layerHost  elements; toFrame(message); askPlace(x, y) -> Promise<place|null>
///   (place: path, fx, fy and the element's box bx, by, bw, bh in the frame's viewport);
///   save(fields) -> Promise; undo() -> Promise<boolean>; erase(id) -> Promise<boolean>;
///   drawings() -> [{ id, canDelete, drawing, at }]; color() / setColor(c); announce(text); onExit().
export function createInk(api) {
  const doc = document;
  const policy = inkPolicy();
  let active = false, tool = 'draw', width = 4;
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

  const bar = el('div', { className: 'ink-bar glass', role: 'toolbar', ariaLabel: 'Drawing tools', hidden: true, dataset: { inkBar: '' } });
  const toolRow = el('div', { className: 'ink-row' });
  for (const [name, glyph, label] of TOOLS) toolRow.append(el('button', { type: 'button', className: 'ink-button', title: label, ariaLabel: label, ariaPressed: 'false', dataset: { inkTool: name } }, el('span', { ariaHidden: 'true', textContent: glyph })));
  const colorRow = el('div', { className: 'ink-row' });
  for (const c of ['yellow', 'green', 'blue', 'pink', 'orange']) colorRow.append(el('button', { type: 'button', className: 'ink-button ink-color', title: `Colour ${c}`, ariaLabel: `Colour ${c}`, ariaPressed: 'false', dataset: { inkColor: c, color: c } }, el('span', { className: 'ink-dot', ariaHidden: 'true' })));
  const widthRow = el('div', { className: 'ink-row' });
  for (const w of WIDTHS) widthRow.append(el('button', { type: 'button', className: 'ink-button ink-width', title: `Line ${w}`, ariaLabel: `Line width ${w}`, ariaPressed: 'false', dataset: { inkWidth: String(w) } }, el('span', { className: `ink-line w${w}`, ariaHidden: 'true' })));
  widthRow.append(
    // D3: the loupe follows the pen while drawing.
    el('button', { type: 'button', className: 'ink-button ink-text', textContent: 'Loupe', title: 'Loupe: magnify where the pen is', ariaPressed: 'false', dataset: { inkLoupe: '' } }),
    el('button', { type: 'button', className: 'ink-button ink-text', textContent: 'Undo', dataset: { inkUndo: '' } }),
    el('button', { type: 'button', className: 'ink-button ink-text ink-done', textContent: 'Done', dataset: { inkDone: '' } }));
  bar.append(toolRow, colorRow, widthRow);
  doc.body.append(bar);

  const layer = el('div', { className: 'ink-capture', hidden: true, dataset: { inkCapture: '' } });
  const live = doc.createElementNS(SVG, 'svg');
  live.setAttribute('class', 'ink-live');
  layer.append(live);
  api.layerHost.append(layer);

  const paint = () => {
    for (const b of bar.querySelectorAll('[data-ink-tool]')) b.setAttribute('aria-pressed', String(b.dataset.inkTool === tool));
    for (const b of bar.querySelectorAll('[data-ink-color]')) b.setAttribute('aria-pressed', String(b.dataset.inkColor === api.color()));
    for (const b of bar.querySelectorAll('[data-ink-width]')) b.setAttribute('aria-pressed', String(Number(b.dataset.inkWidth) === width));
    bar.querySelector('[data-ink-loupe]')?.setAttribute('aria-pressed', String(Boolean(api.loupeOn?.())));
    layer.dataset.tool = tool;
    live.setAttribute('data-color', api.color());
  };

  // Where a pointer is in the frame's viewport, and in the layer (which adds the frame's border).
  const inFrame = event => {
    const r = api.frame.getBoundingClientRect();
    return { x: event.clientX - r.left - (api.frame.clientLeft || 0), y: event.clientY - r.top - (api.frame.clientTop || 0) };
  };
  const off = () => ({ x: api.frame.clientLeft || 0, y: api.frame.clientTop || 0 });

  let stroke = null, scroll = null, erasing = null;
  const pressureOf = event => (event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5);
  const showLive = () => {
    live.replaceChildren();
    if (!stroke) return;
    const o = off();
    const shift = p => ({ x: p.x + o.x, y: p.y + o.y, p: p.p });
    const pts = SHAPES.includes(tool) ? [stroke.points[0], stroke.points[stroke.points.length - 1]] : stroke.points;
    const drawing = SHAPES.includes(tool) ? { kind: 'shape', tool, width, points: pts.map(shift) } : { kind: 'ink', tool, width, points: pts.map(shift) };
    for (const node of drawingNodes(doc, drawing)) live.append(node);
  };

  layer.addEventListener('pointerdown', event => {
    const decision = policy.decide(event.pointerType, event.isPrimary, event.button);
    if (decision === 'ignore') return;
    event.preventDefault();
    layer.setPointerCapture?.(event.pointerId);
    if (decision === 'scroll') { scroll = { id: event.pointerId, x: event.clientX, y: event.clientY }; return; }
    const at = inFrame(event);
    if (tool === 'eraser') { erasing = { id: event.pointerId, done: new Set() }; eraseAt(at); return; }
    stroke = { id: event.pointerId, points: [{ ...at, p: pressureOf(event) }], place: api.askPlace(at.x, at.y) };
    showLive();
  });
  layer.addEventListener('pointermove', event => {
    if (api.loupeOn?.()) { const at = inFrame(event); api.loupeMove?.(at.x, at.y); }
    if (scroll && event.pointerId === scroll.id) {
      api.toFrame({ type: 'hj:scrollby', dx: scroll.x - event.clientX, dy: scroll.y - event.clientY });
      scroll.x = event.clientX; scroll.y = event.clientY;
      return;
    }
    if (erasing && event.pointerId === erasing.id) { eraseAt(inFrame(event)); return; }
    if (!stroke || event.pointerId !== stroke.id) return;
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const e of events.length ? events : [event]) stroke.points.push({ ...inFrame(e), p: pressureOf(e) });
    showLive();
  });
  const finish = async event => {
    if (scroll && event.pointerId === scroll.id) { scroll = null; return; }
    if (erasing && event.pointerId === erasing.id) { erasing = null; return; }
    if (!stroke || event.pointerId !== stroke.id) return;
    const done = stroke;
    stroke = null;
    const cancelled = event.type === 'pointercancel';
    let fields;
    const first = done.points[0], last = done.points[done.points.length - 1];
    if (SHAPES.includes(tool)) {
      if (cancelled || dist(first, last) < 4) { live.replaceChildren(); return; }
      fields = { kind: 'shape', tool, a: first, b: last };
    } else {
      const points = done.points.length === 1 ? [first, { ...first, x: first.x + 0.5 }] : capPoints(done.points);
      const shape = tool === 'sketch' ? recognise(points) : null;
      fields = shape ? { kind: 'shape', tool: shape.tool, a: shape.a, b: shape.b } : { kind: 'ink', tool, points };
    }
    const place = await done.place;
    if (!place || !(place.bw > 0)) { live.replaceChildren(); api.announce('The drawing could not be placed; please try again.'); return; }
    const rel = p => ({ x: p.x - place.bx, y: p.y - place.by, p: p.p });
    const save = {
      kind: fields.kind, tool: fields.tool, color: api.color(), stroke_width: String(width), ref_width: String(round1(place.bw)),
      ref_height: place.bh > 0 ? String(round1(place.bh)) : '',
      anchor_path: place.path, anchor_x: String(place.fx), anchor_y: String(place.fy),
      points: fields.kind === 'ink' ? formatInk(fields.points.map(rel)) : formatShape(rel(fields.a), rel(fields.b))
    };
    try {
      await api.save(save);
      api.announce(fields.kind === 'ink' ? 'Drawing added.' : `${fields.tool[0].toUpperCase()}${fields.tool.slice(1)} added.`);
    } catch {
      api.announce('The drawing was not saved; please try again.');
    }
    live.replaceChildren();
  };
  layer.addEventListener('pointerup', finish);
  layer.addEventListener('pointercancel', finish);
  layer.addEventListener('wheel', event => {
    event.preventDefault();
    api.toFrame({ type: 'hj:scrollby', dx: event.deltaX, dy: event.deltaY });
  }, { passive: false });

  const eraseAt = async at => {
    for (const item of api.drawings()) {
      if (!erasing || erasing.done.has(item.id) || !item.at || !touches(item.drawing, item.at, at.x, at.y, 10)) continue;
      erasing.done.add(item.id);
      if (!item.canDelete) { api.announce('You can erase only your own drawings.'); continue; }
      api.announce((await api.erase(item.id)) ? 'Drawing erased.' : 'That drawing was not erased.');
    }
  };

  bar.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.inkTool) tool = button.dataset.inkTool;
    else if (button.dataset.inkColor) api.setColor(button.dataset.inkColor);
    else if (button.dataset.inkWidth) width = Number(button.dataset.inkWidth);
    else if ('inkUndo' in button.dataset) api.announce((await api.undo()) ? 'Last drawing removed.' : 'Nothing of yours to undo.');
    else if ('inkLoupe' in button.dataset) api.toggleLoupe?.();
    else if ('inkDone' in button.dataset) { exit(); return; }
    paint();
  });
  const onKey = event => { if (active && event.key === 'Escape') { event.preventDefault(); exit(); } };
  doc.addEventListener('keydown', onKey, true);

  function enter(chosen) {
    tool = TOOLS.some(([name]) => name === chosen) ? chosen : 'draw';
    active = true;
    bar.hidden = false;
    layer.hidden = false;
    doc.body.classList.add('inking');
    paint();
    bar.querySelector(`[data-ink-tool="${tool}"]`)?.focus({ preventScroll: true });
    api.announce('Drawing. Press Done or Escape to stop.');
  }
  function exit() {
    if (!active) return;
    active = false;
    stroke = scroll = erasing = null;
    live.replaceChildren();
    bar.hidden = true;
    layer.hidden = true;
    doc.body.classList.remove('inking');
    api.onExit?.();
  }
  return { enter, exit, get active() { return active; }, get penSeen() { return policy.penSeen; } };
}
