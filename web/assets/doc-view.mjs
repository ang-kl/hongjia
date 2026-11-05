// The document page's side of saved fields and annotations (P2b C) and the annotation tools (D1).
// The helper inside the locked frame (frame-helper.js) sends messages here; every one is checked,
// because the document's own scripts can send the same messages. Saving needs this page's session
// and form token, so a document cannot write anything by itself except into its own saved fields,
// and it can never create, change, move or delete a mark: a person chooses in the menu or the
// panel drawn by this page. Words people write (comments, notes, text boxes, inserted and
// replacement text, stamps) and drawings (D2) are drawn here, over the frame, and never sent into it.

import { createInk, drawingNodes, parsePoints, placement } from './ink.mjs';
import { createSignaturePad, signatureNodes } from './signature.mjs';

export const LIMITS = { key: 200, value: 4000, storage: 8000, label: 200, quote: 1000, around: 64, id: 20, text: 500, body: 4000, path: 400 };
export const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];
export const STAMPS = [['check', '✓'], ['cross', '✗'], ['approved', 'Approved'], ['reviewed', 'Reviewed'], ['signedoff', 'Signed off']];
const TYPES = new Set(['hj:ready', 'hj:field', 'hj:storage', 'hj:selection', 'hj:focus', 'hj:open', 'hj:menu', 'hj:positions', 'hj:located', 'hj:loupe']);
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
    case 'hj:selection':
      if (!isText(data.quote, LIMITS.quote) || !isText(data.prefix ?? '', LIMITS.around) || !isText(data.suffix ?? '', LIMITS.around)) return null;
      return { type: data.type, quote: data.quote, prefix: data.prefix ?? '', suffix: data.suffix ?? '' };
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
  }
  return null;
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

const KIND_WORDS = { comment: 'Comment', highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', insert: 'Insert', replace: 'Replace', note: 'Sticky note', textbox: 'Text box', stamp: 'Stamp', ink: 'Drawing', shape: 'Shape', signature: 'Signature' };
const SHAPE_WORDS = { rectangle: 'Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow' };
const DRAWN = new Set(['ink', 'shape']);
const PLACED = new Set(['note', 'textbox', 'stamp', 'signature']);
const OVERLAID = new Set(['note', 'textbox', 'stamp', 'insert', 'replace', 'signature']);

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
  const entries = () => [...list.querySelectorAll('li[data-annotation-id]')];
  const anchors = () => entries().map(li => ({
    id: li.dataset.annotationId, kind: li.dataset.kind || 'comment', color: li.dataset.color || 'yellow',
    quote: li.dataset.quote || '', prefix: li.dataset.prefix || '', suffix: li.dataset.suffix || '',
    field: li.dataset.field || '', path: li.dataset.path || '', x: Number(li.dataset.x || 0), y: Number(li.dataset.y || 0)
  }));
  const sendAnchors = () => { toFrame({ type: 'hj:anchors', items: anchors() }); drawOverlay(); };
  const refreshCount = () => {
    const n = entries().length;
    count.textContent = String(n);
    empty.hidden = n > 0;
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
    if (a.body) {
      const text = element('p', { className: 'annotation-body' });
      fillWithMentions(text, a.body, a.mentions || []);
      li.append(text);
    }
    li.append(element('p', { className: 'small', textContent: `${a.author}, ${a.created} (SGT) · version ${a.version}` }));
    const actions = element('div', { className: 'annotation-actions' });
    // A signature is moved, never edited (D3).
    if (a.can_edit && a.kind !== 'signature') actions.append(element('button', { type: 'button', className: 'link', textContent: 'Edit', dataset: { annotationEdit: '' } }));
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
    if (old) old.replaceWith(fresh); else list.append(fresh);
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

  list.addEventListener('submit', async event => {
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
  });

  list.addEventListener('click', event => {
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
  });

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
      if (kind === 'signature') {
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

  // The annotation menu, opened by right-click, a long press or two Pencil taps in the frame.
  let color = 'yellow';
  let context = null;
  const menu = element('div', { className: 'anno-menu glass', role: 'menu', ariaLabel: 'Mark up', tabIndex: -1, hidden: true });
  const swatches = element('div', { className: 'anno-row', role: 'group', ariaLabel: 'Highlight' }, element('span', { className: 'anno-label', textContent: 'Highlight' }));
  for (const c of COLORS) swatches.append(element('button', { type: 'button', className: 'swatch', role: 'menuitem', ariaLabel: `Highlight ${c}`, title: `Highlight ${c}`, dataset: { act: 'highlight', color: c, needs: 'quote' } }));
  const item0 = (label, act, needs = '') => element('button', { type: 'button', className: 'anno-item', role: 'menuitem', textContent: label, dataset: { act, needs } });
  const stampButton = element('button', { type: 'button', className: 'anno-item', role: 'menuitem', ariaHasPopup: 'true', ariaExpanded: 'false', textContent: 'Stamp ▸', dataset: { act: 'stamps', needs: 'place' } });
  const stampGroup = element('div', { className: 'anno-sub', role: 'group', ariaLabel: 'Stamps', hidden: true });
  for (const [name, label] of STAMPS) stampGroup.append(element('button', { type: 'button', className: 'anno-item anno-stamp', role: 'menuitem', textContent: label, dataset: { act: 'stamp', stamp: name, needs: 'place' } }));
  const shapesButton = element('button', { type: 'button', className: 'anno-item', role: 'menuitem', ariaHasPopup: 'true', ariaExpanded: 'false', textContent: 'Shapes ▸', dataset: { act: 'shapes' } });
  const shapesGroup = element('div', { className: 'anno-sub', role: 'group', ariaLabel: 'Shapes', hidden: true });
  for (const [name, label] of Object.entries(SHAPE_WORDS)) shapesGroup.append(element('button', { type: 'button', className: 'anno-item', role: 'menuitem', textContent: label, dataset: { act: 'ink', tool: name } }));
  const form = element('form', { className: 'anno-form', hidden: true });
  const formLabel = element('span', { className: 'anno-label' });
  const formColors = element('div', { className: 'anno-row anno-colors', role: 'radiogroup', ariaLabel: 'Colour' });
  for (const c of COLORS) formColors.append(element('label', { className: 'swatch-choice' }, element('input', { type: 'radio', name: 'color', value: c, ariaLabel: c }), element('span', { className: 'swatch', dataset: { color: c } })));
  const formInput = element('textarea', { rows: 3, maxLength: LIMITS.body, required: true, dataset: { annoInput: '' } });
  form.append(formLabel, formInput, formColors, element('div', { className: 'composer-actions' },
    element('button', { type: 'submit', textContent: 'Add' }),
    element('button', { type: 'button', className: 'secondary', textContent: 'Cancel', dataset: { annoCancel: '' } })),
  element('p', { className: 'small', role: 'status', dataset: { annoStatus: '' } }));
  attachMentions(formInput);
  const inkItem = (label, tool) => { const b = item0(label, 'ink'); b.dataset.tool = tool; return b; };
  menu.append(swatches, item0('Underline', 'underline', 'quote'), item0('Strikethrough', 'strike', 'quote'), item0('Insert text…', 'insert', 'point'),
    item0('Replace…', 'replace', 'quote'), item0('Comment…', 'comment'), item0('Sticky note…', 'note', 'place'), item0('Text box…', 'textbox', 'place'),
    stampButton, stampGroup, item0('Signature…', 'signature', 'place'), item0('My signature…', 'mysignature'),
    inkItem('Draw', 'draw'), inkItem('Sketch', 'sketch'), shapesButton, shapesGroup, inkItem('Eraser', 'eraser'),
    item0('Loupe', 'loupe'), item0('Copy', 'copy', 'quote'), form);
  document.body.append(menu);
  const menuItems = () => [...menu.querySelectorAll('[role=menuitem]')].filter(el => !el.disabled && !el.closest('[hidden]'));
  let returnFocus = null;
  const closeMenu = (focusBack = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    form.hidden = true;
    stampGroup.hidden = true;
    stampButton.setAttribute('aria-expanded', 'false');
    shapesGroup.hidden = true;
    shapesButton.setAttribute('aria-expanded', 'false');
    if (focusBack && returnFocus) returnFocus.focus({ preventScroll: true });
  };
  const placeOpenMenu = (px, py) => {
    menu.style.maxHeight = `${innerHeight - 16}px`;
    const { left, top } = placeMenu(px, py, menu.offsetWidth, Math.min(menu.offsetHeight, innerHeight - 16), innerWidth, innerHeight);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  function openMenu(message) {
    const r = frame.getBoundingClientRect();
    const off = frameOffset();
    context = { ...message, px: r.left + off.left + message.x, py: r.top + off.top + message.y };
    const has = { quote: Boolean(message.quote.trim()), point: Boolean(message.quote.trim() || message.ppre || message.psuf), place: Boolean(message.path) };
    for (const el of menu.querySelectorAll('[data-needs]')) el.disabled = Boolean(el.dataset.needs) && !has[el.dataset.needs];
    form.hidden = true;
    stampGroup.hidden = true;
    stampButton.setAttribute('aria-expanded', 'false');
    shapesGroup.hidden = true;
    shapesButton.setAttribute('aria-expanded', 'false');
    returnFocus = message.input === 'keyboard' ? frame : document.activeElement;
    menu.hidden = false;
    placeOpenMenu(context.px, context.py);
    (menuItems()[0] || menu).focus({ preventScroll: true });
  }
  const chooseColor = c => { color = c; toFrame({ type: 'hj:tool', color }); };
  const markFields = kind => ({ kind, color, quote: context.quote, prefix: context.prefix, suffix: context.suffix });
  const placeFields = kind => ({ kind, color, anchor_path: context.path, anchor_x: String(context.fx), anchor_y: String(context.fy) });
  let formKind = '';
  const askFor = (kind, label, max, multiline) => {
    formKind = kind;
    formLabel.textContent = label;
    formInput.value = '';
    formInput.maxLength = max;
    formInput.rows = multiline ? 3 : 1;
    formColors.hidden = !(kind === 'note' || kind === 'textbox');
    for (const radio of formColors.querySelectorAll('input')) radio.checked = radio.value === color;
    form.querySelector('[data-anno-status]').textContent = '';
    form.hidden = false;
    placeOpenMenu(context.px, context.py);
    formInput.focus();
  };
  const run = async (fields, done = 'Added.') => {
    // The menu may have been opened again while this was saving; only close the one it came from.
    const session = context;
    try {
      const li = await create(fields);
      if (context === session) closeMenu(false);
      li?.classList.add('flash');
      setTimeout(() => li?.classList.remove('flash'), 1200);
      document.querySelector('[data-anno-live]').textContent = done;
    } catch {
      if (context !== session) return;
      form.hidden = false;
      form.querySelector('[data-anno-status]').textContent = 'Not saved; please try again.';
    }
  };
  menu.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (!button || button.disabled || !context) return;
    const act = button.dataset.act;
    switch (act) {
      case 'highlight': chooseColor(button.dataset.color); run(markFields('highlight'), 'Highlighted.'); break;
      case 'underline': case 'strike': run(markFields(act), act === 'strike' ? 'Struck through.' : 'Underlined.'); break;
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
      case 'stamps': {
        const open = stampGroup.hidden;
        stampGroup.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        placeOpenMenu(context.px, context.py);
        if (open) stampGroup.querySelector('button')?.focus();
        break;
      }
      case 'stamp': run({ ...placeFields('stamp'), text: button.dataset.stamp }, 'Stamped.'); break;
      case 'shapes': {
        const open = shapesGroup.hidden;
        shapesGroup.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        placeOpenMenu(context.px, context.py);
        if (open) shapesGroup.querySelector('button')?.focus();
        break;
      }
      case 'ink':
        closeMenu(false);
        ink.enter(button.dataset.tool);
        break;
      case 'signature': {
        // Place your own saved signature; with none saved yet, the pad opens first.
        const fields = placeFields('signature');
        closeMenu(false);
        placeSignature(fields);
        break;
      }
      case 'mysignature':
        closeMenu(false);
        changeSignature();
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
  form.querySelector('[data-anno-cancel]').addEventListener('click', () => { form.hidden = true; placeOpenMenu(context.px, context.py); menuItems()[0]?.focus(); });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
    if (event.target.closest('form')) return;
    const items = menuItems();
    const at = items.indexOf(document.activeElement);
    const go = i => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); go(at + 1); }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); go(at - 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(0); }
    else if (event.key === 'End') { event.preventDefault(); go(items.length - 1); }
    else if (event.key === 'Tab') closeMenu(false);
  });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(false); }, true);
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
        sendAnchors();
        toFrame({ type: 'hj:tool', color });
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
