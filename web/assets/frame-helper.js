// The helper the server adds to each HTML document when it is shown (the stored file is never
// changed). It runs inside the locked document frame, before the document's own scripts:
// - it stands in for localStorage and sessionStorage, which the locked frame blocks, so pages
//   that save their own progress keep working; localStorage writes are saved on the site;
// - it restores what people filled in (ticks, typed answers, choices) and reports changes;
// - it reports selected text and the focused field so a person can comment on them, and it
//   highlights annotated passages. Comment text never enters the frame.
// Messages go only to the parent page, which checks every one; the document's own scripts can
// send the same messages, so the parent treats them all as untrusted.
// The placeholder on the last line is replaced by the server with JSON, escaped so it cannot end
// this script.
(function (DATA) {
  'use strict';
  /* PURE START: plain functions, also loaded by web/test/frame-helper.test.mjs */
  var SKIP_TYPES = ['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image'];
  var MAX = { key: 200, value: 4000, storage: 8000, label: 200, quote: 1000, around: 32 };

  // FNV-1a, 32 bits, as eight hex digits: a short stable name for label text.
  function hashText(text) {
    var h = 0x811c9dc5;
    text = String(text);
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function squash(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function clip(text, n) {
    text = String(text == null ? '' : text);
    return text.length > n ? text.slice(0, n) : text;
  }

  // Where a quote sits in the page text. The place where the words before and after match too
  // wins; otherwise the first place the quote appears. Returns [start, end] or null.
  function findAnchor(text, quote, prefix, suffix) {
    if (!quote) return null;
    var best = -1, bestScore = -1, from = 0, tries = 0, at;
    while ((at = text.indexOf(quote, from)) !== -1 && tries < 2000) {
      var score = 0;
      if (prefix && text.slice(Math.max(0, at - prefix.length), at) === prefix) score += 2;
      if (suffix && text.slice(at + quote.length, at + quote.length + suffix.length) === suffix) score += 1;
      if (score > bestScore) { best = at; bestScore = score; }
      if (score === 3) break;
      from = at + 1;
      tries++;
    }
    return best === -1 ? null : [best, best + quote.length];
  }

  // The words either side of a selection, as saved with an annotation.
  function around(text, start, end) {
    return {
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - MAX.around), start),
      suffix: text.slice(end, end + MAX.around)
    };
  }
  /* PURE END */

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var framed = window.parent && window.parent !== window;
  var me = document.currentScript;
  if (me && me.parentNode) me.parentNode.removeChild(me);
  DATA = DATA || {};

  function send(message) {
    if (framed) window.parent.postMessage(message, '*');
  }

  // Writes are gathered for a moment so typing sends one message, not one per key.
  var pending = new Map();
  var timer = 0;
  function queue(id, message) {
    pending.set(id, message);
    if (!timer) timer = setTimeout(flush, 400);
  }
  function flush() {
    timer = 0;
    pending.forEach(function (message) { send(message); });
    pending.clear();
  }
  window.addEventListener('pagehide', flush);

  // Storage stand-ins: synchronous, in memory, preloaded with what the site saved.
  function makeStorage(initial, persist) {
    var map = new Map();
    Object.keys(initial || {}).forEach(function (k) { map.set(k, String(initial[k])); });
    var api = {
      getItem: function (k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem: function (k, v) {
        k = clip(String(k), MAX.key);
        v = String(v);
        map.set(k, v);
        if (persist && v.length <= MAX.storage) queue('s:' + k, { type: 'hj:storage', op: 'set', key: k, value: v });
      },
      removeItem: function (k) {
        k = String(k);
        if (map.delete(k) && persist) queue('s:' + k, { type: 'hj:storage', op: 'remove', key: clip(k, MAX.key), value: '' });
      },
      clear: function () {
        map.clear();
        if (persist) {
          pending.forEach(function (_, id) { if (id.indexOf('s:') === 0) pending.delete(id); });
          queue('s:*clear', { type: 'hj:storage', op: 'clear', key: '', value: '' });
        }
      },
      key: function (i) {
        var keys = Array.from(map.keys());
        return i >= 0 && i < keys.length ? keys[i] : null;
      }
    };
    return new Proxy(api, {
      get: function (t, p) {
        if (p === 'length') return map.size;
        if (typeof p === 'symbol' || p in t) return t[p];
        return map.has(p) ? map.get(p) : undefined;
      },
      set: function (t, p, v) {
        if (typeof p === 'symbol' || p in t) return false;
        api.setItem(p, v);
        return true;
      },
      deleteProperty: function (t, p) { api.removeItem(p); return true; },
      has: function (t, p) { return p in t || map.has(p); },
      ownKeys: function () { return Array.from(map.keys()); },
      getOwnPropertyDescriptor: function (t, p) {
        return map.has(p) ? { value: map.get(p), enumerable: true, configurable: true, writable: true } : undefined;
      }
    });
  }
  function install(name, store) {
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return store; } });
    } catch (e) { /* the browser refused; the page keeps the blocked original */ }
  }
  install('localStorage', makeStorage(DATA.storage, true));
  install('sessionStorage', makeStorage({}, false));

  // Form fields.
  function isField(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
    return tag === 'INPUT' && SKIP_TYPES.indexOf((el.type || 'text').toLowerCase()) === -1;
  }
  function pathOf(el) {
    var parts = [];
    for (var node = el; node && node !== document.body && parts.length < 12; node = node.parentElement) {
      var i = 1;
      for (var sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.tagName === node.tagName) i++;
      parts.unshift(node.tagName.toLowerCase() + i);
    }
    return parts.join('.');
  }
  function labelOf(el) {
    var text = '';
    if (el.labels && el.labels.length) text = el.labels[0].textContent;
    else if (el.closest && el.closest('label')) text = el.closest('label').textContent;
    text = squash(text || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '');
    if (!text && el.parentElement) text = squash(el.parentElement.textContent);
    return clip(text, 120);
  }
  function fieldKey(el) {
    var type = (el.type || '').toLowerCase();
    var key;
    if (type === 'radio' && el.name) key = 'radio:' + el.name;
    else if (el.id) key = 'id:' + el.id;
    else if (type === 'checkbox' && el.name) {
      var same = Array.prototype.filter.call(document.getElementsByName(el.name), function (x) { return x.type === 'checkbox'; });
      key = 'check:' + el.name + '=' + (el.getAttribute('value') || String(same.indexOf(el) + 1));
    } else if (el.name) key = 'name:' + el.name;
    else key = 'path:' + pathOf(el) + ':' + hashText(labelOf(el));
    return clip(key, MAX.key);
  }
  function readValue(el) {
    var type = (el.type || '').toLowerCase();
    if (type === 'checkbox') return el.checked ? 'true' : 'false';
    if (type === 'radio') return el.checked ? (el.name ? el.value : 'true') : (el.name ? null : 'false');
    if (el.tagName === 'SELECT' && el.multiple) {
      return Array.prototype.map.call(el.selectedOptions, function (o) { return o.value; }).join('\n');
    }
    return String(el.value);
  }
  function writeValue(el, value) {
    var type = (el.type || '').toLowerCase();
    var before = readValue(el);
    if (type === 'checkbox') el.checked = value === 'true';
    else if (type === 'radio') el.checked = el.name ? el.value === value : value === 'true';
    else if (el.tagName === 'SELECT' && el.multiple) {
      var wanted = value.split('\n');
      Array.prototype.forEach.call(el.options, function (o) { o.selected = wanted.indexOf(o.value) !== -1; });
    } else el.value = value;
    return before !== readValue(el);
  }

  var restoring = false;
  function restore() {
    var saved = DATA.fields || {};
    var keys = Object.keys(saved);
    if (!keys.length) return;
    restoring = true;
    try {
      document.querySelectorAll('input, select, textarea').forEach(function (el) {
        if (!isField(el)) return;
        var key = fieldKey(el);
        if (Object.prototype.hasOwnProperty.call(saved, key) && writeValue(el, String(saved[key]))) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    } finally {
      restoring = false;
    }
  }

  function onEdit(event) {
    if (restoring || !isField(event.target)) return;
    var el = event.target;
    var value = readValue(el);
    if (value === null || value.length > MAX.value) return;
    var key = fieldKey(el);
    DATA.fields = DATA.fields || {};
    DATA.fields[key] = value;
    queue('f:' + key, { type: 'hj:field', key: key, value: value, label: clip(labelOf(el), MAX.label) });
  }
  document.addEventListener('change', onEdit, true);
  document.addEventListener('input', onEdit, true);
  document.addEventListener('focusin', function (event) {
    if (isField(event.target)) send({ type: 'hj:focus', key: fieldKey(event.target), label: clip(labelOf(event.target), MAX.label) });
  }, true);

  // The page's text, as one string, with the text nodes it came from.
  var SKIP_TEXT = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1 };
  function textModel() {
    var nodes = [], starts = [], text = '';
    if (!document.body) return { text: '', nodes: nodes, starts: starts };
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var p = n.parentElement; p; p = p.parentElement) if (SKIP_TEXT[p.tagName]) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n);
      starts.push(text.length);
      text += n.data;
    }
    return { text: text, nodes: nodes, starts: starts };
  }
  function offsetIn(model, container, offset) {
    if (container.nodeType === 3) {
      var i = model.nodes.indexOf(container);
      return i === -1 ? -1 : model.starts[i] + Math.min(offset, container.data.length);
    }
    var point = document.createRange();
    point.setStart(container, offset);
    for (var j = 0; j < model.nodes.length; j++) {
      if (point.comparePoint(model.nodes[j], 0) >= 0) return model.starts[j];
    }
    return model.text.length;
  }

  var lastQuote = '';
  var selectionTimer = 0;
  function reportSelection() {
    var sel = window.getSelection && window.getSelection();
    var quote = '', found = null;
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      var range = sel.getRangeAt(0);
      var model = textModel();
      var start = offsetIn(model, range.startContainer, range.startOffset);
      var end = offsetIn(model, range.endContainer, range.endOffset);
      if (start >= 0 && end > start) {
        end = Math.min(end, start + MAX.quote);
        found = around(model.text, start, end);
        if (found.quote.trim()) quote = found.quote;
      }
    }
    if (quote === lastQuote) return;
    lastQuote = quote;
    send(quote ? { type: 'hj:selection', quote: found.quote, prefix: found.prefix, suffix: found.suffix } : { type: 'hj:selection', quote: '', prefix: '', suffix: '' });
  }
  document.addEventListener('selectionchange', function () {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(reportSelection, 250);
  });

  // Highlights for annotations, in the live page only.
  var anchors = [];
  var style = null;
  function ensureStyle() {
    if (style || !document.head) return;
    style = document.createElement('style');
    style.textContent = 'mark[data-hj-id]{background:#ffe08a;color:inherit;border-radius:2px;cursor:pointer;box-shadow:0 0 0 1px #e0b400}'
      + '[data-hj-field]{outline:2px solid #e0b400;outline-offset:2px}';
    document.head.appendChild(style);
  }
  function clearMarks() {
    document.querySelectorAll('mark[data-hj-id]').forEach(function (mark) {
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
    document.querySelectorAll('[data-hj-field]').forEach(function (el) { el.removeAttribute('data-hj-field'); });
  }
  function wrap(model, span, id) {
    for (var i = 0; i < model.nodes.length; i++) {
      var node = model.nodes[i], s = model.starts[i], e = s + node.data.length;
      if (e <= span[0] || s >= span[1]) continue;
      var from = Math.max(span[0], s) - s, to = Math.min(span[1], e) - s;
      var piece = node;
      if (to < piece.data.length) piece.splitText(to);
      if (from > 0) piece = piece.splitText(from);
      var mark = document.createElement('mark');
      mark.setAttribute('data-hj-id', id);
      piece.parentNode.insertBefore(mark, piece);
      mark.appendChild(piece);
    }
  }
  function applyAnchors() {
    if (!document.body) return;
    ensureStyle();
    clearMarks();
    anchors.forEach(function (a) {
      if (a.field) {
        document.querySelectorAll('input, select, textarea').forEach(function (el) {
          if (isField(el) && fieldKey(el) === a.field) el.setAttribute('data-hj-field', a.id);
        });
      }
      if (!a.quote) return;
      var model = textModel();
      var span = findAnchor(model.text, a.quote, a.prefix, a.suffix);
      if (span) wrap(model, span, a.id);
    });
  }
  document.addEventListener('click', function (event) {
    var mark = event.target && event.target.closest ? event.target.closest('mark[data-hj-id]') : null;
    if (mark) send({ type: 'hj:open', id: mark.getAttribute('data-hj-id') });
  }, true);

  function text(v, n) { return typeof v === 'string' ? clip(v, n) : ''; }
  window.addEventListener('message', function (event) {
    if (!framed || event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'hj:anchors' && Array.isArray(d.items)) {
      anchors = d.items.slice(0, 1000).map(function (a) {
        return {
          id: text(a && a.id, 20), quote: text(a && a.quote, MAX.quote), prefix: text(a && a.prefix, 64),
          suffix: text(a && a.suffix, 64), field: text(a && a.field, MAX.key)
        };
      }).filter(function (a) { return /^[0-9]+$/.test(a.id); });
      // The page sends anchors after a comment is saved or deleted; the same text may then be
      // selected again for a new comment, so it must be reported again.
      lastQuote = '';
      applyAnchors();
    } else if (d.type === 'hj:scroll' && typeof d.id === 'string' && /^[0-9]+$/.test(d.id)) {
      var target = document.querySelector('mark[data-hj-id="' + d.id + '"], [data-hj-field="' + d.id + '"]');
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  function ready() {
    restore();
    send({ type: 'hj:ready' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  // Fields a page builds with its own scripts get restored once the page has loaded, and the
  // highlights are drawn again in case the page rebuilt its text.
  window.addEventListener('load', function () { restore(); if (anchors.length) applyAnchors(); });
})(__HJ_DATA__);
