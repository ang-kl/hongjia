// The 🛰️ satellite, globe and 📁 folder for hongjia, ported from the owner's michi explorer
// (assets/claude-explorer.mjs, release 0.9.1) to the family's documents. The globe is a
// chromeless glass sphere: each island is a hashtag, each pin a document. The satellite searches
// every document on the server; the folder lists the open document's headings or all documents.
// Rules kept from michi: button order 🛰️ globe 📁; the search field stays closed until the
// satellite is pressed and docks on the globe while it is open; Enter opens the first result;
// Escape closes the field, then the card, then the globe; Tab stays inside the globe and its
// buttons; focus returns to the opener; a status line speaks to screen readers; reduced motion
// never turns the globe. Text from the server is only ever inserted with textContent.
import { buildIslands, placeGlobe, rotate as turnPoint, byMonth, shortTitle } from '/assets/globe-layout.mjs';

const group = document.querySelector('[data-fab-group]');
const dialog = document.querySelector('[data-globe]');
if (group && dialog) setup();

function setup() {
  const NS = 'http://www.w3.org/2000/svg';
  const satellite = group.querySelector('[data-fab-satellite]');
  const fab = group.querySelector('[data-fab-globe]');
  const folder = group.querySelector('[data-fab-folder]');
  const fabForm = group.querySelector('[data-fab-search]');
  const search = group.querySelector('[data-fab-input]');
  const contents = group.querySelector('[data-fab-contents]');
  const stage = dialog.querySelector('[data-globe-stage]');
  const globeBox = dialog.querySelector('[data-globe-box]');
  const status = dialog.querySelector('[data-globe-status]');
  const card = dialog.querySelector('[data-globe-card]');
  const panel = dialog.querySelector('[data-globe-panel]');
  const hereKey = document.body.dataset.docKey || null;
  const frame = document.querySelector('.doc-frame');
  const C = 300, R = 250, VIEW = 700;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let library = null, loading = null, svg = null, islands = [], points = [], byKey = new Map();
  let yaw = -.35, pitch = .15, drag = null, suppressClick = false, selected = null, opener = null;
  let k = 1, zoomLevel = 1, viewX = -50, viewY = -50, idle = !reduceMotion, spinning = false;
  let results = [], seq = 0, typing = 0;
  const pointers = new Map();
  let pinch = null;

  const el = (name, attrs = {}, parent = null) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (parent) parent.append(node);
    return node;
  };
  const html = (name, className, text) => { const node = document.createElement(name); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

  async function loadLibrary() {
    if (library) return library;
    if (!loading) {
      loading = fetch('/api/library', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then(data => { library = Array.isArray(data.documents) ? data.documents : []; return library; })
        .catch(error => { loading = null; throw error; });
    }
    return loading;
  }

  // The globe is built once, from the library.
  function build() {
    const layout = placeGlobe(buildIslands(library));
    svg = el('svg', { class: 'globe-canvas', viewBox: '-50 -50 700 700', width: 600, height: 600, role: 'group', tabindex: 0, 'aria-describedby': 'globe-help', 'aria-label': 'Globe of the family documents. Each island is a hashtag; each pin is a document.' });
    const defs = el('defs', {}, svg);
    const glass = el('radialGradient', { id: 'globe-glass', cx: '38%', cy: '30%', r: '75%' }, defs);
    for (const [offset, colour, opacity] of [['0', '#fff', '.92'], ['.55', '#f4f8fd', '.78'], ['.9', '#dfe9f6', '.7'], ['1', '#b9cbe4', '.85']]) el('stop', { offset, 'stop-color': colour, 'stop-opacity': opacity }, glass);
    const sheen = el('radialGradient', { id: 'globe-sheen', cx: '30%', cy: '22%', r: '40%' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '1' }, sheen);
    el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, sheen);
    el('circle', { cx: C, cy: C, r: R + 1 }, el('clipPath', { id: 'globe-clip' }, defs));
    const shell = el('g', { class: 'globe-shell', 'aria-hidden': 'true' }, svg);
    el('circle', { cx: C, cy: C, r: R + 2, fill: 'url(#globe-glass)', stroke: '#8aa3c8', 'stroke-opacity': '.7', 'stroke-width': '1.3' }, shell);
    for (const [rx, ry] of [[R, R * .35], [R * .35, R], [R, R * .78]]) el('ellipse', { cx: C, cy: C, rx, ry, class: 'globe-grid' }, shell);
    const clipped = el('g', { 'clip-path': 'url(#globe-clip)' }, svg);
    const land = el('g', { class: 'globe-land', 'aria-hidden': 'true' }, clipped);
    islands = layout.islands.map(island => {
      const path = el('path', { class: 'globe-island', fill: island.fill, stroke: island.rim, d: '' }, land);
      const name = el('text', { class: 'globe-island-name', fill: island.ink, 'text-anchor': 'middle' }, land);
      name.textContent = island.name;
      return { ...island, el: path, label: name };
    });
    el('ellipse', { cx: C - 70, cy: C - 95, rx: 95, ry: 60, fill: 'url(#globe-sheen)' }, el('g', { class: 'globe-sheen', 'aria-hidden': 'true' }, clipped));
    const nodes = el('g', { class: 'globe-nodes' }, svg);
    points = layout.pins.map(pin => {
      const doc = pin.doc;
      const node = el('a', { class: 'globe-node', href: `/documents/${encodeURIComponent(doc.key)}`, 'data-key': doc.key, 'aria-label': `Document ${doc.label}: ${doc.title}` }, nodes);
      el('title', {}, node).textContent = doc.title;
      el('circle', { class: 'globe-node-hit', r: 12 }, node);
      el('circle', { class: 'globe-node-dot', r: 6 }, node);
      const label = el('text', { x: 0, y: -14, 'text-anchor': 'middle' }, node);
      label.textContent = shortTitle(doc.title);
      if (doc.key === hereKey) node.classList.add('is-here');
      return { key: doc.key, doc, node, label, x: pin.x, y: pin.y, z: pin.z, match: false, back: false };
    });
    byKey = new Map(points.map(p => [p.key, p]));
    stage.prepend(svg);
    bindGlobe();
    applyView();
    if (!library.length) status.textContent = 'No documents yet. Add one from Documents.';
  }

  const rotate = p => turnPoint(p, yaw, pitch);
  const toScreen = (r, lift = 1) => ({ x: C + r.x * R * lift, y: C + r.y * R * lift });
  const rimmed = r => { if (r.depth >= 0) return toScreen(r); const l = Math.hypot(r.x, r.y) || 1; return { x: C + r.x / l * R, y: C + r.y / l * R }; };
  const applyView = () => svg?.setAttribute('viewBox', `${viewX.toFixed(1)} ${viewY.toFixed(1)} ${(VIEW / zoomLevel).toFixed(1)} ${(VIEW / zoomLevel).toFixed(1)}`);

  function draw() {
    if (!svg) return;
    for (const island of islands) {
      const centre = rotate(island.centre);
      // Nothing from the far side shows: land, names and pins behind the globe are hidden.
      island.el.classList.toggle('is-back', centre.depth < -.05);
      island.label.classList.toggle('is-back', centre.depth < .1);
      const shore = island.coast.map(p => rimmed(rotate(p)));
      island.el.setAttribute('d', shore.map((s, i) => `${i ? 'L' : 'M'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`).join('') + 'Z');
      island.el.setAttribute('opacity', (.55 + .45 * Math.max(0, centre.depth)).toFixed(2));
      const label = toScreen(centre, 1.02), top = Math.min(...shore.map(s => s.y));
      island.label.setAttribute('font-size', (11 * k).toFixed(1));
      island.label.setAttribute('x', label.x.toFixed(1));
      island.label.setAttribute('y', (top - 6 * k).toFixed(1));
    }
    const positions = new Map();
    for (const p of points) {
      const r = rotate(p);
      const pos = toScreen(r, (1 + .1 * r.depth) * (p.key === selected ? 1.1 : 1));
      positions.set(p.key, { ...pos, depth: r.depth });
      p.node.setAttribute('transform', `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`);
      p.node.setAttribute('opacity', (.6 + .4 * Math.max(0, r.depth)).toFixed(2));
      p.node.querySelector('.globe-node-dot').setAttribute('r', String(6.4 * Math.sqrt(k) * (1 + .15 * r.depth) * (p.match ? 1.25 : 1)));
      p.node.querySelector('.globe-node-hit').setAttribute('r', String(12 * k));
      p.label.setAttribute('font-size', (13 * k).toFixed(1));
      p.back = r.depth < 0;
      p.node.classList.toggle('is-back', p.back);
    }
    // Front pins are drawn last; a focused pin keeps focus.
    const g = svg.querySelector('.globe-nodes');
    const ordered = [...points].sort((a, b) => positions.get(a.key).depth - positions.get(b.key).depth).map(p => p.node);
    if (ordered.some((node, i) => g.children[i] !== node)) {
      const focused = document.activeElement;
      g.append(...ordered);
      if (focused && g.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
    // Labels show where they fit without overlapping; the selected and matching pins come first.
    const labels = [];
    const order = [...points].filter(p => !p.back).sort((a, b) => (b.key === selected) - (a.key === selected) || b.match - a.match || positions.get(a.key).y - positions.get(b.key).y);
    for (const p of order) {
      const pos = positions.get(p.key);
      const halfWidth = p.label.textContent.length * 3.9 * k;
      const clear = box => !labels.some(o => box.left < o.right + 5 && box.right > o.left - 5 && box.top < o.bottom + 4 && box.bottom > o.top - 4);
      const boxAt = y => ({ left: pos.x - halfWidth, right: pos.x + halfWidth, top: pos.y + y - 14 * k, bottom: pos.y + y + 4 * k });
      const offset = [-16 * k, 26 * k, -38 * k].find(y => clear(boxAt(y)));
      p.label.classList.toggle('is-quiet', offset === undefined);
      p.label.setAttribute('y', String(offset ?? -16 * k));
      if (offset !== undefined) labels.push(boxAt(offset));
    }
    placeCard();
  }
  function updateScale() {
    const size = svg?.getBoundingClientRect().width || 600;
    k = Math.min(2.2, Math.max(.75, 640 / (size * zoomLevel)));
  }
  // The globe takes the shorter side of its box.
  function resize() {
    if (dialog.hidden || !svg) return;
    const cs = getComputedStyle(globeBox);
    const w = globeBox.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = globeBox.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const size = Math.max(200, Math.floor(Math.min(w - 16, h - 16)));
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    updateScale();
    draw();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(globeBox);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  function zoomTo(level, cx = VIEW / 2 - 50, cy = VIEW / 2 - 50) {
    const next = Math.max(1, Math.min(4, level));
    const before = VIEW / zoomLevel, after = VIEW / next;
    viewX = cx - (cx - viewX) * (after / before);
    viewY = cy - (cy - viewY) * (after / before);
    zoomLevel = next;
    const min = -50, max = VIEW - 50 - after;
    viewX = Math.max(min, Math.min(max, viewX)); viewY = Math.max(min, Math.min(max, viewY));
    if (next === 1) { viewX = -50; viewY = -50; }
    applyView();
    updateScale();
    draw();
  }
  const svgPoint = (clientX, clientY) => { const rect = svg.getBoundingClientRect(); return { x: viewX + (clientX - rect.left) / rect.width * (VIEW / zoomLevel), y: viewY + (clientY - rect.top) / rect.height * (VIEW / zoomLevel) }; };

  // The card sits beside its pin: above it, or below near the top; phones dock it as a sheet.
  function placeCard() {
    if (card.hidden || !selected || !svg) return;
    if (getComputedStyle(card).getPropertyValue('--docked').trim() === '1') { card.style.left = ''; card.style.top = ''; return; }
    const p = byKey.get(selected);
    if (!p) return;
    const r = rotate(p), rect = svg.getBoundingClientRect();
    const pin = toScreen(r, 1 + .1 * r.depth);
    const sx = rect.left + (pin.x - viewX) / (VIEW / zoomLevel) * rect.width, sy = rect.top + (pin.y - viewY) / (VIEW / zoomLevel) * rect.height;
    const w = card.offsetWidth, h = card.offsetHeight, sw = window.innerWidth, sh = window.innerHeight;
    const minTop = fabForm.classList.contains('is-docked') && !fabForm.hidden ? fabForm.getBoundingClientRect().bottom + 8 : 8;
    let top = sy - h - 18, below = false;
    if (top < minTop) { top = Math.min(sy + 20, sh - h - 8); below = true; }
    const left = Math.max(8, Math.min(sx - w / 2, sw - w - 8));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(Math.max(minTop, top))}px`;
    card.style.setProperty('--arrow-x', `${Math.round(Math.max(16, Math.min(sx - left, w - 16)))}px`);
    card.classList.toggle('is-below', below);
  }
  function openCard(key) {
    const p = byKey.get(key);
    if (!p) return;
    const hit = results.find(r => r.key === key);
    const doc = p.doc;
    const nodes = [html('p', 'globe-kind', `Document · ${doc.label}`)];
    const title = html('h3', 'globe-title', doc.title);
    title.tabIndex = -1;
    nodes.push(title);
    if (doc.tags?.length) nodes.push(html('p', 'globe-tags', doc.tags.map(t => `#${t}`).join(' ')));
    if (hit?.snippet) nodes.push(html('p', 'globe-snippet', hit.snippet));
    if (key === hereKey) nodes.push(html('p', 'globe-here', 'You are reading this document.'));
    else {
      const open = html('a', 'pill solid', 'Open');
      open.href = `/documents/${encodeURIComponent(doc.key)}`;
      const line = html('p', 'globe-open');
      line.append(open);
      nodes.push(line);
    }
    const others = results.filter(r => r.key !== key && byKey.has(r.key)).slice(0, 5);
    if (others.length) {
      const also = html('p', 'globe-also', 'Also found: ');
      others.forEach((r, i) => { const a = html('a', '', r.title); a.href = `/documents/${encodeURIComponent(r.key)}`; a.dataset.jump = r.key; also.append(a); if (i < others.length - 1) also.append(' · '); });
      nodes.push(also);
    }
    panel.replaceChildren(...nodes);
    card.hidden = false;
    card.scrollTop = 0;
    placeCard();
  }
  const closeCard = () => { card.hidden = true; };
  const stopIdle = () => { idle = false; };
  function select(key, focusCard = true) {
    const p = byKey.get(key);
    if (!p) return;
    stopIdle();
    selected = key;
    const searching = results.length > 0;
    for (const q of points) {
      q.node.classList.toggle('is-dim', searching && !q.match && q.key !== key);
      if (q.key === key) q.node.setAttribute('aria-current', 'location'); else q.node.removeAttribute('aria-current');
    }
    status.textContent = `${p.doc.title}, ${p.doc.label}.`;
    openCard(key);
    draw();
    if (focusCard) panel.querySelector('h3')?.focus({ preventScroll: true });
  }
  function clearSelection() {
    selected = null;
    for (const q of points) { q.node.classList.toggle('is-dim', results.length > 0 && !q.match); q.node.removeAttribute('aria-current'); }
    closeCard();
    draw();
  }
  // Turns the globe so the pin faces front, and recentres a zoomed view on it.
  function faceFront(p) {
    yaw = Math.atan2(p.z, p.x) - Math.PI / 2;
    const z = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
    pitch = Math.max(-.75, Math.min(.75, -Math.atan2(p.y, z)));
    if (zoomLevel > 1) {
      const r = rotate(p), pin = toScreen(r, 1 + .1 * r.depth), span = VIEW / zoomLevel;
      viewX = Math.max(-50, Math.min(VIEW - 50 - span, pin.x - span / 2));
      viewY = Math.max(-50, Math.min(VIEW - 50 - span, pin.y - span / 2));
      applyView();
    }
  }
  function markMatches() {
    const keys = new Set(results.map(r => r.key));
    const searching = search.value.trim().length > 0;
    for (const p of points) {
      p.match = keys.has(p.key);
      p.node.classList.toggle('is-match', p.match);
      p.node.classList.toggle('is-dim', searching && results.length > 0 && !p.match && p.key !== selected);
    }
    dialog.classList.toggle('is-searching', searching && results.length > 0);
  }
  // The server searches titles, hashtags and the text of every document's latest version.
  async function runSearch(openResult = true) {
    const q = search.value.trim();
    const mine = ++seq;
    if (!q) { results = []; markMatches(); if (selected) openCard(selected); draw(); return; }
    let data;
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || String(response.status));
    } catch {
      if (mine === seq) status.textContent = 'Search is not available right now. Try again in a moment.';
      return;
    }
    if (mine !== seq) return;
    results = Array.isArray(data.results) ? data.results : [];
    stopIdle();
    markMatches();
    const first = results.length ? byKey.get(results[0].key) : null;
    if (first && openResult) { faceFront(first); select(first.key, false); }
    else { if (selected) openCard(selected); draw(); }
    status.textContent = results.length ? `${results.length} found. First: ${results[0].title}.` : 'Nothing found. Try another word.';
  }
  function turn(direction) {
    stopIdle();
    if (direction === 'reset') { yaw = -.35; pitch = .15; zoomTo(1); return; }
    if (direction === 'left') yaw -= .25;
    if (direction === 'right') yaw += .25;
    if (direction === 'up') pitch -= .2;
    if (direction === 'down') pitch += .2;
    draw();
  }
  // A slow idle turn shows the globe is round; it stops at the first drag, key, search or tap.
  // A double-tap, or a long press on a touch screen, starts or stops it. Reduced motion never turns.
  function spin() {
    if (dialog.hidden || !idle) { spinning = false; return; }
    yaw -= .0022;
    draw();
    requestAnimationFrame(spin);
  }
  function startSpin() { if (idle && !spinning && !reduceMotion) { spinning = true; requestAnimationFrame(spin); } }
  let pressSpin = false, pressTimer = 0, lastPress = 0;
  function setTurning(on) { idle = on && !reduceMotion; if (idle) startSpin(); status.textContent = idle ? 'The globe is turning. Double-tap or press and hold to stop it.' : 'The globe stopped turning.'; }

  // While the globe is open, Tab cycles through the globe, its card and the buttons beside it.
  const focusable = () => [dialog, group].flatMap(root => [...root.querySelectorAll('a[href],button:not([disabled]),input,[tabindex="0"]')]).filter(node => !node.closest('[hidden]') && !node.classList.contains('is-back') && !node.closest('.is-back') && node.getClientRects().length);
  // The search field docks above the globe while it is open, but stays closed until the satellite is pressed.
  const dockSearch = on => {
    if (on) stage.append(fabForm); else group.prepend(fabForm);
    fabForm.hidden = true;
    fabForm.classList.toggle('is-docked', on);
    satellite.setAttribute('aria-expanded', 'false');
  };
  async function open() {
    opener = document.activeElement;
    dialog.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    group.classList.add('is-open');
    document.documentElement.classList.add('globe-open');
    showContents(false);
    dockSearch(true);
    if (!svg) {
      status.textContent = 'Loading the documents…';
      try { await loadLibrary(); } catch { status.textContent = 'The documents could not be loaded. Close the globe and try again.'; return; }
      if (dialog.hidden) return;
      build();
    }
    resize();
    applyView();
    // With a document open, the globe turns to its pin and shows its card.
    const here = hereKey && byKey.get(hereKey);
    if (here) { faceFront(here); select(here.key, false); }
    else startSpin();
    svg.focus({ preventScroll: true });
  }
  function close() {
    dialog.hidden = true;
    dockSearch(false);
    idle = !reduceMotion;
    fab.setAttribute('aria-expanded', 'false');
    group.classList.remove('is-open');
    document.documentElement.classList.remove('globe-open');
    const back = opener && document.contains(opener) && !opener.closest('[hidden]') && opener.getClientRects().length ? opener : fab;
    back.focus({ preventScroll: true });
  }
  const showField = on => { fabForm.hidden = !on; satellite.setAttribute('aria-expanded', String(on)); if (on) { showContents(false); search.focus(); } placeCard(); };
  function showContents(on) {
    contents.hidden = !on;
    folder.setAttribute('aria-expanded', String(on));
    if (on) {
      if (!fabForm.classList.contains('is-docked')) showField(false);
      fillLibraryContents();
      contents.querySelector('a')?.focus({ preventScroll: true });
    }
  }
  // On pages other than a document, 📁 lists all documents by the month they were filed.
  async function fillLibraryContents() {
    const holder = contents.querySelector('[data-contents-library]');
    if (!holder || holder.dataset.filled) return;
    try { await loadLibrary(); } catch { holder.replaceChildren(html('p', 'small', 'The documents could not be loaded.')); return; }
    holder.dataset.filled = 'yes';
    if (!library.length) { holder.replaceChildren(html('p', 'small', 'No documents yet.')); return; }
    const parts = [];
    for (const { month, docs } of byMonth(library)) {
      parts.push(html('p', 'fab-month', month));
      const list = html('ol', 'fab-contents-list');
      for (const doc of docs) {
        const a = html('a');
        a.href = `/documents/${encodeURIComponent(doc.key)}`;
        a.append(html('b', '', doc.label), html('span', '', doc.title));
        const item = html('li');
        item.append(a);
        list.append(item);
      }
      parts.push(list);
    }
    holder.replaceChildren(...parts);
    if (!contents.hidden && !contents.contains(document.activeElement)) contents.querySelector('a')?.focus({ preventScroll: true });
  }

  function bindGlobe() {
    svg.addEventListener('keydown', event => {
      if (event.target === svg) {
        const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'reset' }[event.key];
        if (direction) { event.preventDefault(); turn(direction); return; }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); stopIdle(); zoomTo(zoomLevel * 1.25); }
        if (event.key === '-' || event.key === '_') { event.preventDefault(); stopIdle(); zoomTo(zoomLevel / 1.25); }
        if (event.key === '0') { event.preventDefault(); zoomTo(1); }
        return;
      }
      const node = event.target.closest('.globe-node');
      if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(node.dataset.key); }
    });
    svg.addEventListener('focusin', event => { if (event.target.closest('.globe-node')) stopIdle(); });
    svg.addEventListener('wheel', event => { event.preventDefault(); stopIdle(); const at = svgPoint(event.clientX, event.clientY); zoomTo(zoomLevel * (event.deltaY < 0 ? 1.12 : 1 / 1.12), at.x, at.y); }, { passive: false });
    svg.addEventListener('dblclick', event => { event.preventDefault(); setTurning(!pressSpin); });
    svg.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const now = performance.now();
      if (now - lastPress > 400) pressSpin = spinning;
      lastPress = now;
      stopIdle();
      suppressClick = false;
      clearTimeout(pressTimer);
      if (event.pointerType !== 'mouse') pressTimer = setTimeout(() => { if (drag && !drag.moved && pointers.size === 1) { suppressClick = true; drag = null; setTurning(!pressSpin); } }, 550);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), level: zoomLevel };
        drag = null;
        svg.setPointerCapture(event.pointerId);
        return;
      }
      drag = { x: event.clientX, y: event.clientY, yaw, pitch, pointer: event.pointerId, moved: false };
    });
    svg.addEventListener('pointermove', event => {
      const tracked = pointers.get(event.pointerId);
      if (tracked) { tracked.x = event.clientX; tracked.y = event.clientY; }
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = svgPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomTo(pinch.level * dist / pinch.dist, mid.x, mid.y);
        suppressClick = true;
        return;
      }
      if (!drag || event.pointerId !== drag.pointer) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) { drag.moved = true; clearTimeout(pressTimer); svg.setPointerCapture(event.pointerId); svg.classList.add('is-dragging'); }
      if (drag.moved) { yaw = drag.yaw + dx * .008 / Math.sqrt(zoomLevel); pitch = drag.pitch - dy * .008 / Math.sqrt(zoomLevel); draw(); }
    });
    const endPointer = event => {
      clearTimeout(pressTimer);
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      if (drag && event.pointerId === drag.pointer) { suppressClick = suppressClick || drag.moved; drag = null; svg.classList.remove('is-dragging'); }
      setTimeout(() => { suppressClick = false; }, 0);
    };
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
  }

  const escapeStep = () => {
    if (!fabForm.hidden) { showField(false); satellite.focus({ preventScroll: true }); return; }
    if (!card.hidden) { clearSelection(); status.textContent = 'Card closed.'; svg?.focus({ preventScroll: true }); return; }
    close();
  };
  const trap = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); escapeStep(); return; }
    if (event.key === 'Tab') {
      stopIdle();
      const items = focusable();
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement);
      const next = at < 0 ? (event.shiftKey ? items.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
    }
  };
  dialog.addEventListener('keydown', trap);
  group.addEventListener('keydown', event => {
    if (!dialog.hidden) { if (event.key === 'Escape' && contents.contains(event.target) && !contents.hidden) { event.preventDefault(); showContents(false); folder.focus(); return; } trap(event); return; }
    if (event.key !== 'Escape') return;
    if (!fabForm.hidden && fabForm.contains(event.target)) { event.preventDefault(); showField(false); satellite.focus({ preventScroll: true }); }
    else if (!contents.hidden) { event.preventDefault(); showContents(false); folder.focus({ preventScroll: true }); }
  });
  dialog.addEventListener('click', event => {
    const node = event.target.closest('.globe-node');
    if (node) {
      event.preventDefault();
      if (suppressClick) { suppressClick = false; return; }
      if (selected === node.dataset.key) { clearSelection(); status.textContent = 'Card closed.'; return; }
      select(node.dataset.key);
      return;
    }
    const jump = event.target.closest('[data-jump]');
    if (jump) { event.preventDefault(); const p = byKey.get(jump.dataset.jump); if (p) { faceFront(p); select(p.key); } return; }
    if (event.target.closest('[data-globe-close]')) { close(); return; }
    if (event.target.closest('[data-globe-card-close]')) { clearSelection(); status.textContent = 'Card closed.'; svg?.focus({ preventScroll: true }); }
  });

  // The globe button: a press lights a soft glow, then the globe opens; a second press closes it.
  fab.addEventListener('click', () => {
    if (!dialog.hidden) { close(); return; }
    if (reduceMotion) { open(); return; }
    fab.classList.add('is-lit');
    setTimeout(() => { fab.classList.remove('is-lit'); open(); }, 220);
  });
  satellite.addEventListener('click', () => showField(fabForm.hidden));
  search.addEventListener('input', () => { if (dialog.hidden || !svg) return; clearTimeout(typing); typing = setTimeout(() => runSearch(false), 250); });
  fabForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearTimeout(typing);
    if (dialog.hidden) { await open(); fabForm.hidden = false; satellite.setAttribute('aria-expanded', 'true'); }
    if (svg) runSearch(true);
  });
  folder.addEventListener('click', () => showContents(contents.hidden));
  // On a document page, a heading moves the document's frame to that heading.
  contents.addEventListener('click', event => {
    const jump = event.target.closest('[data-frame-jump]');
    if (jump && frame && hereKey) {
      event.preventDefault();
      frame.src = `/documents/${encodeURIComponent(hereKey)}/raw#${encodeURIComponent(jump.dataset.frameJump)}`;
      showContents(false);
      if (!dialog.hidden) close();
      status.textContent = `Moved to ${jump.textContent}.`;
      frame.focus({ preventScroll: true });
      return;
    }
    if (event.target.closest('a') && !dialog.hidden) close();
  });
  for (const button of [satellite, fab, folder]) button.disabled = false;
}
