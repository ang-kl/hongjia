// The helper the server adds to each HTML document when it is shown (the stored file is never
// changed). It runs inside the locked document frame, before the document's own scripts:
// - it stands in for localStorage and sessionStorage, which the locked frame blocks, so pages
//   that save their own progress keep working; localStorage writes are saved on the site;
// - it restores what people filled in (ticks, typed answers, choices) and reports changes;
// - it reports selected text and the focused field so a person can comment on them, and it
//   highlights annotated passages. Comment text never enters the frame;
// - D1: right-click, a long press (touch) or two quick Pencil taps report the point, the selection
//   and the element there so the page can open its annotation menu; it draws coloured highlights,
//   underlines, strikethroughs and insertion carets, and reports where placed marks sit so the
//   page can draw notes, text boxes, stamps and inserted words over the frame. Words people write
//   never enter the frame; only positions and the document's own text are exchanged;
// - D2: it reports the box of the element each drawing is anchored to, so the page can draw and
//   scale drawings over the frame (their points never enter it), and it scrolls when the page's
//   drawing surface passes on a wheel or a finger.
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

  // An element's path from a root: tag:index steps, the index counting earlier siblings of the
  // same tag from 1 (for example body:1/section:2/p:3). Empty when the element is not inside.
  function anchorPathOf(el, root) {
    var steps = [];
    for (var node = el; node && node !== root; node = node.parentElement) {
      if (!node.tagName || steps.length >= 25) return '';
      var i = 1;
      for (var sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.tagName === node.tagName) i++;
      steps.unshift(String(node.tagName).toLowerCase() + ':' + i);
    }
    return node === root ? steps.join('/') : '';
  }

  // The element a path names from a root, or null.
  function resolvePath(root, path) {
    if (!path) return null;
    var node = root, steps = String(path).split('/');
    for (var s = 0; s < steps.length && node; s++) {
      var m = /^([a-z][a-z0-9-]*):([0-9]{1,5})$/.exec(steps[s]);
      if (!m) return null;
      var want = Number(m[2]), seen = 0, next = null;
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
        if (String(c.tagName).toLowerCase() === m[1] && ++seen === want) { next = c; break; }
      }
      node = next;
    }
    return node || null;
  }

  // Where an insertion point sits in the page text: just after its prefix and before its suffix.
  function findPoint(text, prefix, suffix) {
    if (!prefix && !suffix) return -1;
    var at = text.indexOf(prefix + suffix);
    if (at !== -1) return at + prefix.length;
    if (prefix && (at = text.indexOf(prefix)) !== -1) return at + prefix.length;
    if (suffix && (at = text.indexOf(suffix)) !== -1) return at;
    return -1;
  }

  // A second tap soon after the first and close to it.
  function isDoubleTap(prev, next, maxMs, slop) {
    return !!prev && next.t >= prev.t && next.t - prev.t <= maxMs
      && Math.abs(next.x - prev.x) <= slop && Math.abs(next.y - prev.y) <= slop;
  }

  // A press held long enough without moving far.
  function isLongPress(down, now, moved, delay, slop) {
    return !!down && now - down.t >= delay && moved <= slop;
  }

  // A number between lo and hi.
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
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

  // Marks for annotations, in the live page only: coloured highlights, underlines and
  // strikethroughs wrap the document's own text; an insertion is a caret between two letters.
  var PALETTE = {
    yellow: ['#ffe08a', '#b58900'], green: ['#bdf0b5', '#2e8b3a'], blue: ['#c4ddff', '#2f66c8'],
    pink: ['#ffc8e1', '#c2357f'], orange: ['#ffd3a6', '#cf6200']
  };
  var PLACED = { note: 1, textbox: 1, stamp: 1 };
  var DRAWN = { ink: 1, shape: 1 };
  var anchors = [];
  var style = null;
  function ensureStyle() {
    if (style || !document.head) return;
    var css = 'html{-webkit-touch-callout:none}'
      + 'mark[data-hj-id]{background:#ffe08a;color:inherit;border-radius:2px;cursor:pointer;box-shadow:0 0 0 1px #e0b400}'
      + '[data-hj-field]{outline:2px solid #e0b400;outline-offset:2px}'
      + 'hj-caret{display:inline-block;width:0;height:1em;vertical-align:text-top;position:relative;cursor:pointer}'
      + 'hj-caret::after{content:"‸";position:absolute;left:-0.3em;top:0.55em;font:700 1.1em/1 system-ui,sans-serif}'
      + '[data-hj-ring]{position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #b58900;border-radius:50%;pointer-events:none;display:none}';
    Object.keys(PALETTE).forEach(function (name) {
      var fill = PALETTE[name][0], line = PALETTE[name][1];
      css += 'mark[data-hj-kind=highlight][data-hj-color=' + name + ']{background:' + fill + ' !important;box-shadow:0 0 0 1px ' + line + '55}'
        + 'mark[data-hj-kind=underline][data-hj-color=' + name + ']{text-decoration:underline 2px ' + line + ' !important;text-underline-offset:3px}'
        + 'mark[data-hj-kind=strike][data-hj-color=' + name + '],mark[data-hj-kind=replace][data-hj-color=' + name + ']{text-decoration:line-through 2px ' + line + ' !important}'
        + 'hj-caret[data-hj-color=' + name + ']::after{color:' + line + '}';
    });
    css += 'mark[data-hj-kind=underline],mark[data-hj-kind=strike],mark[data-hj-kind=replace]{background:transparent !important;box-shadow:none !important}';
    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }
  function clearMarks() {
    document.querySelectorAll('mark[data-hj-id]').forEach(function (mark) {
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
    document.querySelectorAll('hj-caret').forEach(function (caret) {
      var parent = caret.parentNode;
      parent.removeChild(caret);
      parent.normalize();
    });
    document.querySelectorAll('[data-hj-field]').forEach(function (el) { el.removeAttribute('data-hj-field'); });
  }
  function wrap(model, span, a) {
    for (var i = 0; i < model.nodes.length; i++) {
      var node = model.nodes[i], s = model.starts[i], e = s + node.data.length;
      if (e <= span[0] || s >= span[1]) continue;
      var from = Math.max(span[0], s) - s, to = Math.min(span[1], e) - s;
      var piece = node;
      if (to < piece.data.length) piece.splitText(to);
      if (from > 0) piece = piece.splitText(from);
      var mark = document.createElement('mark');
      mark.setAttribute('data-hj-id', a.id);
      mark.setAttribute('data-hj-kind', a.kind);
      mark.setAttribute('data-hj-color', a.color);
      piece.parentNode.insertBefore(mark, piece);
      mark.appendChild(piece);
    }
  }
  function caretAt(model, offset, a) {
    for (var i = 0; i < model.nodes.length; i++) {
      var node = model.nodes[i], s = model.starts[i], e = s + node.data.length;
      if (offset < s || offset > e) continue;
      var caret = document.createElement('hj-caret');
      caret.setAttribute('data-hj-id', a.id);
      caret.setAttribute('data-hj-color', a.color);
      var at = offset - s;
      if (at >= node.data.length) node.parentNode.insertBefore(caret, node.nextSibling);
      else node.parentNode.insertBefore(caret, at > 0 ? node.splitText(at) : node);
      return;
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
      if (PLACED[a.kind] || DRAWN[a.kind]) return;
      var model = textModel();
      if (a.kind === 'insert') {
        var point = -1;
        if (a.quote) {
          var found = findAnchor(model.text, a.quote, a.prefix, a.suffix);
          if (found) point = found[1];
        } else point = findPoint(model.text, a.prefix, a.suffix);
        if (point >= 0) caretAt(model, point, a);
        return;
      }
      if (!a.quote) return;
      var span = findAnchor(model.text, a.quote, a.prefix, a.suffix);
      if (span) wrap(model, span, a);
    });
    schedulePositions();
  }
  function opener(event) {
    var el = event.target && event.target.closest ? event.target.closest('mark[data-hj-id], hj-caret[data-hj-id]') : null;
    if (el) send({ type: 'hj:open', id: el.getAttribute('data-hj-id') });
  }
  document.addEventListener('click', opener, true);

  // Where each mark the page draws over the frame sits, in this frame's viewport.
  function placedTarget(a) {
    return resolvePath(document.documentElement, a.path) || document.body;
  }
  function positions() {
    var items = [];
    anchors.forEach(function (a) {
      var x, y, r;
      if (DRAWN[a.kind]) {
        var box = placedTarget(a);
        if (!box) return;
        r = box.getBoundingClientRect();
        if (isFinite(r.left) && isFinite(r.top)) items.push({ id: a.id, x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
        return;
      } else if (PLACED[a.kind]) {
        var el = placedTarget(a);
        if (!el) return;
        r = el.getBoundingClientRect();
        x = r.left + a.x * r.width; y = r.top + a.y * r.height;
      } else if (a.kind === 'insert') {
        var caret = document.querySelector('hj-caret[data-hj-id="' + a.id + '"]');
        if (!caret) return;
        r = caret.getBoundingClientRect();
        x = r.left; y = r.top;
      } else if (a.kind === 'replace') {
        var pieces = document.querySelectorAll('mark[data-hj-id="' + a.id + '"]');
        if (!pieces.length) return;
        r = pieces[pieces.length - 1].getBoundingClientRect();
        x = r.right; y = r.top;
      } else return;
      if (isFinite(x) && isFinite(y)) items.push({ id: a.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    });
    send({ type: 'hj:positions', items: items, w: window.innerWidth, h: window.innerHeight });
  }
  var positionFrame = 0;
  function schedulePositions() {
    if (positionFrame || !framed) return;
    positionFrame = requestAnimationFrame(function () { positionFrame = 0; positions(); });
  }
  window.addEventListener('scroll', schedulePositions, true);
  window.addEventListener('resize', schedulePositions);
  if (typeof ResizeObserver === 'function') {
    var observer = new ResizeObserver(schedulePositions);
    var watchBody = function () { if (document.body) observer.observe(document.body); };
    if (document.body) watchBody(); else document.addEventListener('DOMContentLoaded', watchBody);
  }

  // The annotation menu: what is under the pointer, sent to the page, which draws the menu.
  function selectionInfo() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0), model = textModel();
    var start = offsetIn(model, range.startContainer, range.startOffset);
    var end = offsetIn(model, range.endContainer, range.endOffset);
    if (start < 0 || end <= start) return null;
    end = Math.min(end, start + MAX.quote);
    var found = around(model.text, start, end);
    return found.quote.trim() ? found : null;
  }
  function pointInfo(x, y) {
    var node = null, offset = 0;
    if (document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(x, y);
      if (range) { node = range.startContainer; offset = range.startOffset; }
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) { node = pos.offsetNode; offset = pos.offset; }
    }
    if (!node) return { prefix: '', suffix: '' };
    var model = textModel();
    var at = offsetIn(model, node, offset);
    if (at < 0) return { prefix: '', suffix: '' };
    return { prefix: model.text.slice(Math.max(0, at - MAX.around), at), suffix: model.text.slice(at, at + MAX.around) };
  }
  function blockAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      var display = getComputedStyle(el).display;
      if (display !== 'inline' && display !== 'contents') break;
      el = el.parentElement;
    }
    if (!el || el === document.documentElement) el = document.body;
    return el;
  }
  function anchorInfo(x, y) {
    var el = blockAt(x, y);
    if (!el) return { path: '', fx: 0, fy: 0 };
    var r = el.getBoundingClientRect();
    return {
      path: anchorPathOf(el, document.documentElement),
      fx: r.width ? clamp((x - r.left) / r.width, 0, 1) : 0,
      fy: r.height ? clamp((y - r.top) / r.height, 0, 1) : 0,
      box: { x: r.left, y: r.top, w: r.width, h: r.height }
    };
  }
  function menuAt(x, y, input, target) {
    var sel = selectionInfo() || { quote: '', prefix: '', suffix: '' };
    var point = pointInfo(x, y);
    var place = anchorInfo(x, y);
    var field = target && isField(target) ? target : null;
    send({
      type: 'hj:menu', input: input, x: Math.round(x), y: Math.round(y),
      quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix,
      ppre: point.prefix, psuf: point.suffix,
      path: place.path, fx: Math.round(place.fx * 10000) / 10000, fy: Math.round(place.fy * 10000) / 10000,
      field: field ? fieldKey(field) : '', label: field ? clip(labelOf(field), MAX.label) : ''
    });
  }
  var lastTouchMenu = 0;
  document.addEventListener('contextmenu', function (event) {
    if (event.shiftKey) return; // Shift+right-click keeps the browser's own menu.
    event.preventDefault();
    if (Date.now() - lastTouchMenu < 800) return; // a long press already opened it (Android sends both)
    menuAt(event.clientX, event.clientY, 'mouse', event.target);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    var x = window.innerWidth / 2, y = window.innerHeight / 3;
    var sel = window.getSelection && window.getSelection();
    var box = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).getBoundingClientRect()
      : (document.activeElement && document.activeElement !== document.body ? document.activeElement.getBoundingClientRect() : null);
    if (box && box.width + box.height > 0) { x = box.left + Math.min(box.width, 40); y = box.bottom; }
    menuAt(x, y, 'keyboard', document.activeElement);
  }, true);

  // A long press on a touch screen.
  var press = null, pressTimer = 0, swallowClick = 0;
  document.addEventListener('pointerdown', function (event) {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    press = { x: event.clientX, y: event.clientY, t: Date.now(), moved: 0, target: event.target };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      if (press && isLongPress(press, Date.now(), press.moved, 550, 10)) {
        lastTouchMenu = Date.now();
        swallowClick = Date.now();
        menuAt(press.x, press.y, 'touch', press.target);
      }
      press = null;
    }, 560);
  }, true);
  document.addEventListener('pointermove', function (event) {
    if (press && event.pointerType === 'touch') press.moved = Math.max(press.moved, Math.abs(event.clientX - press.x), Math.abs(event.clientY - press.y));
  }, true);
  function endPress() { clearTimeout(pressTimer); press = null; }
  document.addEventListener('pointerup', function (event) { if (event.pointerType === 'touch') endPress(); }, true);
  document.addEventListener('pointercancel', endPress, true);
  document.addEventListener('click', function (event) {
    if (Date.now() - swallowClick < 700) { event.preventDefault(); event.stopPropagation(); swallowClick = 0; }
  }, true);

  // Two quick taps with the Pencil, and the Pencil's hover ring.
  var penDown = null, lastPenTap = null, ring = null, ringTimer = 0, toolColor = 'yellow';
  document.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'pen') { penDown = { x: event.clientX, y: event.clientY }; hideRing(); }
  }, true);
  document.addEventListener('pointerup', function (event) {
    if (event.pointerType !== 'pen' || !penDown) return;
    var still = Math.abs(event.clientX - penDown.x) <= 10 && Math.abs(event.clientY - penDown.y) <= 10;
    penDown = null;
    if (!still) { lastPenTap = null; return; }
    var tap = { x: event.clientX, y: event.clientY, t: Date.now() };
    if (isDoubleTap(lastPenTap, tap, 350, 30)) {
      lastPenTap = null;
      menuAt(tap.x, tap.y, 'pen', event.target);
    } else lastPenTap = tap;
  }, true);
  function hideRing() { if (ring) ring.style.display = 'none'; }
  document.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'pen' || event.buttons !== 0) return;
    if (!ring) {
      ensureStyle();
      ring = document.createElement('div');
      ring.setAttribute('data-hj-ring', '');
      document.documentElement.appendChild(ring);
    }
    var colors = PALETTE[toolColor] || PALETTE.yellow;
    ring.style.borderColor = colors[1];
    ring.style.left = event.clientX + 'px';
    ring.style.top = event.clientY + 'px';
    ring.style.display = 'block';
    clearTimeout(ringTimer);
    ringTimer = setTimeout(hideRing, 1200);
  }, true);
  document.addEventListener('pointerleave', hideRing, true);

  function text(v, n) { return typeof v === 'string' ? clip(v, n) : ''; }
  function fractionOf(v) { var n = Number(v); return isFinite(n) ? clamp(n, 0, 1) : 0; }
  var KINDS = { comment: 1, highlight: 1, underline: 1, strike: 1, insert: 1, replace: 1, note: 1, textbox: 1, stamp: 1, ink: 1, shape: 1 };
  window.addEventListener('message', function (event) {
    if (!framed || event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'hj:anchors' && Array.isArray(d.items)) {
      anchors = d.items.slice(0, 1000).map(function (a) {
        var kind = text(a && a.kind, 12);
        var color = text(a && a.color, 8);
        return {
          id: text(a && a.id, 20), kind: KINDS[kind] ? kind : 'comment', color: PALETTE[color] ? color : 'yellow',
          quote: text(a && a.quote, MAX.quote), prefix: text(a && a.prefix, 64), suffix: text(a && a.suffix, 64),
          field: text(a && a.field, MAX.key), path: text(a && a.path, 400), x: fractionOf(a && a.x), y: fractionOf(a && a.y)
        };
      }).filter(function (a) { return /^[0-9]+$/.test(a.id); });
      // The page sends anchors after a comment is saved or deleted; the same text may then be
      // selected again for a new comment, so it must be reported again.
      lastQuote = '';
      applyAnchors();
    } else if (d.type === 'hj:scroll' && typeof d.id === 'string' && /^[0-9]+$/.test(d.id)) {
      var target = document.querySelector('mark[data-hj-id="' + d.id + '"], hj-caret[data-hj-id="' + d.id + '"], [data-hj-field="' + d.id + '"]');
      if (!target) {
        var placed = anchors.filter(function (a) { return a.id === d.id && (PLACED[a.kind] || DRAWN[a.kind]); })[0];
        if (placed) target = placedTarget(placed);
      }
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (d.type === 'hj:tool' && typeof d.color === 'string' && PALETTE[d.color]) {
      toolColor = d.color;
    } else if (d.type === 'hj:locate' && typeof d.req === 'string' && /^[0-9]{1,12}$/.test(d.req) && isFinite(d.x) && isFinite(d.y)) {
      var place = anchorInfo(clamp(Number(d.x), 0, window.innerWidth - 1), clamp(Number(d.y), 0, window.innerHeight - 1));
      var b = place.box || { x: 0, y: 0, w: 0, h: 0 };
      send({
        type: 'hj:located', req: d.req, path: place.path, fx: Math.round(place.fx * 10000) / 10000, fy: Math.round(place.fy * 10000) / 10000,
        bx: Math.round(b.x * 10) / 10, by: Math.round(b.y * 10) / 10, bw: Math.round(b.w * 10) / 10, bh: Math.round(b.h * 10) / 10
      });
    } else if (d.type === 'hj:scrollby' && isFinite(d.dx) && isFinite(d.dy)) {
      // The page's drawing surface covers the frame; a wheel or a finger there scrolls the document.
      window.scrollBy(clamp(Number(d.dx), -5000, 5000), clamp(Number(d.dy), -5000, 5000));
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
  window.addEventListener('load', function () { restore(); if (anchors.length) applyAnchors(); else schedulePositions(); });
})(__HJ_DATA__);
