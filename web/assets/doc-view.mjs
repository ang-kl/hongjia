// The document page's side of saved fields and annotations (P2b C). The helper inside the locked
// frame (frame-helper.js) sends messages here; every one is checked, because the document's own
// scripts can send the same messages. Saving needs this page's session and form token, so a
// document cannot write anything by itself except into its own saved fields, and it can never
// create an annotation: a person types the comment here and presses Save.

export const LIMITS = { key: 200, value: 4000, storage: 8000, label: 200, quote: 1000, around: 64, id: 20 };
const TYPES = new Set(['hj:ready', 'hj:field', 'hj:storage', 'hj:selection', 'hj:focus', 'hj:open']);

const isText = (v, max) => typeof v === 'string' && v.length <= max;

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
  const allowWrite = rateLimiter(120, 10_000);
  const allowOther = rateLimiter(60, 1_000);
  const beside = matchMedia('(min-aspect-ratio: 1/1) and (min-width: 720px)');

  const post = (path, fields) => fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });

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

  // The anchors of every annotation, sent to the helper so it can draw highlights.
  const anchors = () => [...list.querySelectorAll('li[data-annotation-id]')].map(li => ({
    id: li.dataset.annotationId, quote: li.dataset.quote || '', prefix: li.dataset.prefix || '',
    suffix: li.dataset.suffix || '', field: li.dataset.field || ''
  }));
  const sendAnchors = () => frame.contentWindow?.postMessage({ type: 'hj:anchors', items: anchors() }, '*');
  const refreshCount = () => {
    const n = list.querySelectorAll('li[data-annotation-id]').length;
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

  commentButton.addEventListener('click', () => {
    setComposer(target);
    openPanel();
    document.getElementById('annotations')?.scrollIntoView({ block: 'start' });
    composer.elements.body.focus({ preventScroll: true });
  });
  composer.querySelector('[data-composer-clear]').addEventListener('click', () => setComposer(null));

  const item = a => {
    const li = document.createElement('li');
    li.className = 'annotation';
    li.id = `annotation-${a.id}`;
    li.tabIndex = -1;
    Object.assign(li.dataset, { annotationId: a.id, quote: a.quote, prefix: a.prefix, suffix: a.suffix, field: a.field });
    const head = document.createElement(a.quote && !a.field ? 'blockquote' : 'p');
    head.className = 'annotation-quote';
    if (a.field) { head.textContent = `On the field: ${a.field_label || a.field}`; head.dataset.annotationJump = ''; }
    else if (a.quote) { head.textContent = `“${a.quote}”`; head.dataset.annotationJump = ''; }
    else head.textContent = 'On the whole document';
    const text = document.createElement('p');
    text.className = 'annotation-body';
    text.textContent = a.body;
    const meta = document.createElement('p');
    meta.className = 'small';
    meta.textContent = `${a.author}, ${a.created} (SGT) · version ${a.version}`;
    li.append(head, text, meta);
    if (a.can_delete) {
      const form = document.createElement('form');
      form.method = 'post';
      form.action = `${base}/annotations/${a.id}/delete`;
      form.dataset.annotationDelete = '';
      const token = document.createElement('input');
      Object.assign(token, { type: 'hidden', name: 'csrf', value: csrf });
      const button = document.createElement('button');
      Object.assign(button, { type: 'submit', className: 'link', textContent: 'Delete' });
      form.append(token, button);
      li.append(form);
    }
    return li;
  };

  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const status = composer.querySelector('[data-composer-status]');
    const fields = Object.fromEntries(new FormData(composer));
    delete fields.csrf;
    if (!fields.body.trim()) { status.textContent = 'Write a comment first.'; return; }
    status.textContent = 'Saving…';
    try {
      const response = await post(`${base}/annotations`, fields);
      if (response.status !== 201) throw new Error(String(response.status));
      const saved = await response.json();
      list.append(item(saved));
      refreshCount();
      sendAnchors();
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
    if (!form) return;
    event.preventDefault();
    try {
      const response = await post(form.action, { csrf });
      if (response.status !== 204) throw new Error(String(response.status));
      form.closest('li')?.remove();
      refreshCount();
      sendAnchors();
    } catch {
      form.querySelector('button').textContent = 'Not deleted; try again';
    }
  });

  list.addEventListener('click', event => {
    const jump = event.target.closest('[data-annotation-jump]');
    const li = jump?.closest('li[data-annotation-id]');
    if (li) frame.contentWindow?.postMessage({ type: 'hj:scroll', id: li.dataset.annotationId }, '*');
  });

  addEventListener('message', event => {
    if (event.source !== frame.contentWindow) return;
    const message = validMessage(event.data);
    if (!message) return;
    const write = message.type === 'hj:field' || message.type === 'hj:storage';
    if (!(write ? allowWrite : allowOther)(Date.now())) return;
    switch (message.type) {
      case 'hj:ready':
        sendAnchors();
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
      case 'hj:open': {
        const li = document.getElementById(`annotation-${message.id}`);
        if (li) {
          openPanel();
          li.scrollIntoView({ block: 'center' });
          li.focus({ preventScroll: true });
          li.classList.add('flash');
          setTimeout(() => li.classList.remove('flash'), 1200);
        }
        break;
      }
    }
  });

  frame.addEventListener('load', sendAnchors);
  sendAnchors();
}

if (typeof document !== 'undefined' && document.querySelector('.doc-frame')) start();
