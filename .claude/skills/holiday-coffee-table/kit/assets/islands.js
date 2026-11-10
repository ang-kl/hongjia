/* The islands (the owner, 9 and 10 November 2026: "simulation of day's events as islands"): each day an island
   named like "Fri 25 Dec", with its public holiday, and its places at their true distances; the build works out the
   shapes and distances (islands_data in build.py). Opened by the family site's globe button ('hj:islands-open')
   or by #islands; the page tells the site when the islands are ready, open and closed ('hj:islands'). */
(function () {
'use strict';
var dataEl = document.getElementById('islands-data'), root = document.getElementById('islands');
if (!dataEl || !root) return;
var D = JSON.parse(dataEl.textContent), U = D.ui || {};
function tr(key, o) { return String(U[key] || '').replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
var NS = 'http://www.w3.org/2000/svg';
var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
var reduced = !!mq.matches;
if (mq.addEventListener) mq.addEventListener('change', function (e) { reduced = e.matches; });

var $ = function (id) { return document.getElementById('isl-' + id.toLowerCase()); };
var stage = $('stage'), archEl = $('arch'), archSvg = $('archSvg'), archLab = $('archLab');
var isleEl = $('isle'), mapEl = $('map'), mapSvg = $('mapSvg'), mapLab = $('mapLab'), panel = $('panel');
var cap = $('cap'), header = root.querySelector('.isl-top'), bar = root.querySelector('.isl-bar');
var bPlay = $('play'), bBack = $('back'), bNext = $('next'), bAll = $('all'), pick = $('pick');
var NDAYS = D.days.length;

function sv(tag, attrs, parent) {
  var e = document.createElementNS(NS, tag);
  if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function ht(tag, cls, parent, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function r1(v) { return Math.round(v * 10) / 10; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function ease(p) { return 0.5 - 0.5 * Math.cos(Math.PI * p); }
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fmtPt(p) { return r1(p[0]) + ',' + r1(p[1]); }
function closedPath(P) {
  var n = P.length, d = 'M' + fmtPt(P[0]);
  for (var i = 0; i < n; i++) {
    var p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    d += 'C' + fmtPt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]) + ' ' +
      fmtPt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]) + ' ' + fmtPt(p2);
  }
  return d + 'Z';
}
function openPath(P) {
  var n = P.length, d = 'M' + fmtPt(P[0]);
  for (var i = 0; i < n - 1; i++) {
    var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    d += 'C' + fmtPt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]) + ' ' +
      fmtPt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]) + ' ' + fmtPt(p2);
  }
  return d;
}
function bez(p0, p1, p2, p3, t) { // the same curve as openPath, as a Bezier from Catmull-Rom points
  var c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
  var u = 1 - t;
  return [u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
          u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]];
}
function polyPath(P) { return 'M' + P.map(fmtPt).join('L'); }
function lens(P) { var L = [0]; for (var i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return L; }
function along(P, L, t) {
  var target = t * L[L.length - 1];
  for (var i = 1; i < P.length; i++) {
    if (L[i] >= target || i === P.length - 1) {
      var seg = L[i] - L[i - 1], f = seg > 0 ? (target - L[i - 1]) / seg : 0;
      f = clamp(f, 0, 1);
      return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f, Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0])];
    }
  }
  return [P[0][0], P[0][1], 0];
}
function overlap(a, b) {
  var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return (w > 0 && h > 0) ? w * h : 0;
}
// Pick the candidate box with the least overlap with obstacles and route lines.
function placeBox(w, h, cands, obst, samples, bounds) {
  var best = null, bs = Infinity;
  for (var c = 0; c < cands.length; c++) {
    var x = clamp(cands[c][0], bounds[0], bounds[2] - w), y = clamp(cands[c][1], bounds[1], bounds[3] - h);
    var box = [x, y, x + w, y + h], s = c * 3 + (Math.abs(x - cands[c][0]) + Math.abs(y - cands[c][1])) * 4;
    for (var i = 0; i < obst.length; i++) s += overlap(box, obst[i]) * (obst[i][4] || 1);
    if (samples) for (var j = 0; j < samples.length; j++) {
      var p = samples[j];
      if (p[0] > x - 2 && p[0] < x + w + 2 && p[1] > y - 2 && p[1] < y + h + 2) s += 26;
    }
    if (s < bs) { bs = s; best = box; }
  }
  return best;
}
function densify(P, step) {
  var out = [];
  for (var i = 0; i < P.length - 1; i++) {
    var a = P[i], b = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (var k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  if (P.length) out.push(P[P.length - 1]);
  return out;
}
function niceScale(kpx, target) { // kpx: pixels per km
  var c = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500], best = c[0];
  for (var i = 0; i < c.length; i++) if (c[i] * kpx <= target) best = c[i];
  return { km: best, px: best * kpx, label: best < 1 ? Math.round(best * 1000) + ' m' : best + ' km' };
}
function letters(p) { return p.optional ? '+' : p.letters.join('·'); }
function dayItemsAt(day, ri) { return day.items.filter(function (it) { return it.ri === ri; }); }
function placeItems(day, pj) {
  var p = day.places[pj];
  return day.items.filter(function (it) { return p.ri.indexOf(it.ri) >= 0; });
}
function titleInto(elm, day) { // the day's title, its accent word in italics
  (day.title_parts || []).forEach(function (r) { if (r[1]) ht('em', null, elm, r[0]); else elm.appendChild(document.createTextNode(r[0])); });
  return elm;
}
function setName(elm, day) { // "Fri 25 Dec · Christmas Day", with the holiday in the accent
  elm.textContent = day.name;
  if (day.holiday) { elm.appendChild(document.createTextNode(' · ')); ht('span', 'hol', elm, day.holiday); }
}

/* ------------------------------------------------------------ state */
var S = { view: 'arch', day: -1, i: 0, t: 0, playing: false, started: false, raf: 0, last: 0 };
var SEQ = [], DAYSTART = [];
D.days.forEach(function (day, d) {
  DAYSTART[d] = SEQ.length;
  SEQ.push({ t: 'enter', d: d });
  day.route.forEach(function (pj, ri) {
    SEQ.push({ t: 'stop', d: d, ri: ri });
    if (ri < day.route.length - 1) SEQ.push({ t: 'leg', d: d, li: ri });
  });
  SEQ.push({ t: 'leave', d: d });
  if (d < NDAYS - 1) SEQ.push({ t: 'sail', d: d });
});
SEQ.push({ t: 'end', d: NDAYS - 1 });
function segDur(s) {
  var day = D.days[s.d];
  switch (s.t) {
    case 'enter': return 1300;
    case 'stop': return 1900 + 950 * Math.min(3, dayItemsAt(day, s.ri).length);
    case 'leg':
      var L = day.legs[s.li];
      if (reduced) return 1500;
      return L.kind === 'road' ? clamp(800 + 360 * Math.sqrt(L.min), 1300, 5200) : 1500;
    case 'leave': return reduced ? 300 : 700;
    case 'sail': return reduced ? 1600 : 2300;
    default: return 0;
  }
}

/* ------------------------------------------------------------ archipelago */
var ARCH = null;
function availH(min) {
  return Math.max(min, window.innerHeight - header.offsetHeight - bar.offsetHeight - 34);
}
function renderArch() {
  var W = stage.clientWidth, phone = W < 640;
  var cols = W >= 980 ? 4 : (W >= 640 ? 3 : 2), rows = Math.ceil(NDAYS / cols);
  var padT = phone ? 30 : 38, padB = phone ? 26 : 30;
  var labH = phone ? 52 : 74;
  var rowH = clamp((availH(phone ? 600 : 470) - padT - padB) / rows, phone ? 214 : 200, 420);
  var H = Math.round(rowH * rows + padT + padB), cw = W / cols;
  stage.style.height = H + 'px';
  archSvg.setAttribute('width', W); archSvg.setAttribute('height', H); archSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  archSvg.textContent = ''; archLab.textContent = '';
  defs(archSvg, 'isl-a-');
  sv('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#isl-a-waves)' }, archSvg);
  var wmin = Infinity, wmax = -Infinity;
  D.days.forEach(function (d) { wmin = Math.min(wmin, d.weight); wmax = Math.max(wmax, d.weight); });
  var isl = D.days.map(function (day, i) {
    var r = Math.floor(i / cols), c = i % cols;
    if (r % 2) c = cols - 1 - c;
    var rnd = rng(i * 9973 + 17);
    var boxH = rowH - labH - 14;
    var cx = cw * (c + 0.5) + (rnd() - 0.5) * cw * 0.14;
    var cy = padT + r * rowH + 6 + boxH / 2 + (rnd() - 0.5) * rowH * 0.05;
    var wn = wmax > wmin ? (day.weight - wmin) / (wmax - wmin) : 1;
    var size = Math.min(cw * (phone ? 0.68 : 0.76), boxH) * (0.8 + 0.2 * wn);
    var b = day.box, rw = b[2] - b[0], rh = b[3] - b[1];
    var k = size / Math.max(rw, rh);
    if (rh * k > boxH) k = boxH / rh;
    if (rw * k > cw * 0.84) k = cw * 0.84 / rw;
    var bcx = (b[0] + b[2]) / 2, bcy = (b[1] + b[3]) / 2;
    var P = function (p) { return [cx + (p[0] - bcx) * k, cy + (p[1] - bcy) * k]; };
    return { cx: cx, cy: cy, P: P, box: [cx - rw * k / 2, cy - rh * k / 2, cx + rw * k / 2, cy + rh * k / 2], cw: cw };
  });
  // the sea path: in from the first flight, island to island, out with the last flight
  var C = isl.map(function (s) { return [s.cx, s.cy]; });
  function outward(a, b, dist) { var dx = a[0] - b[0], dy = a[1] - b[1], L = Math.hypot(dx, dy) || 1; return [clamp(a[0] + dx / L * dist, 4, W - 4), clamp(a[1] + dy / L * dist, 4, H - 4)]; }
  // the first and last flights point away from the next island; a one-day trip has none, so they sit either side
  var start = NDAYS > 1 ? outward(C[0], C[1], cw * 0.62) : [clamp(C[0][0] - cw * 0.62, 4, W - 4), C[0][1]];
  var end = NDAYS > 1 ? outward(C[NDAYS - 1], C[NDAYS - 2], cw * 0.62) : [clamp(C[0][0] + cw * 0.62, 4, W - 4), C[0][1]];
  var pts = [start].concat(C, [end]);
  sv('path', { d: openPath(pts), 'class': 'seapath' }, archSvg);
  function segPoint(a, t) { // a: index in pts of the segment start
    return bez(pts[Math.max(0, a - 1)], pts[a], pts[a + 1], pts[Math.min(pts.length - 1, a + 2)], t);
  }
  function inBox(p, b, shrink) { var sx = (b[2] - b[0]) * shrink, sy = (b[3] - b[1]) * shrink; return p[0] > b[0] + sx && p[0] < b[2] - sx && p[1] > b[1] + sy && p[1] < b[3] - sy; }
  function gap(d) { // the part of the crossing from island d to d+1 that is open sea
    var a = d + 1, t0 = 0, t1 = 1, s;
    var b0 = isl[d].ubox || isl[d].box, b1 = isl[d + 1].ubox || isl[d + 1].box;
    for (s = 0; s <= 60; s++) { if (!inBox(segPoint(a, s / 60), b0, 0.04)) { t0 = s / 60; break; } }
    for (s = 60; s >= 0; s--) { if (!inBox(segPoint(a, s / 60), b1, 0.04)) { t1 = s / 60; break; } }
    if (t1 <= t0) { t0 = 0.3; t1 = 0.7; }
    return [t0, t1];
  }
  var gIsl = sv('g', {}, archSvg), gMk = sv('g', {}, archSvg);
  var obst = [], labs = [];
  D.days.forEach(function (day, i) {
    var s = isl[i];
    var g = sv('g', { 'class': 'isl' + (S.day === i ? ' cur' : ''), 'data-day': i }, gIsl);
    sv('path', { d: closedPath(day.reef.map(s.P)), 'class': 'reef' }, g);
    sv('path', { d: closedPath(day.coast.map(s.P)), 'class': 'land', filter: 'url(#isl-a-shadow)' }, g);
    day.legs.forEach(function (L) {
      sv('path', { d: polyPath(L.path.map(s.P)), 'class': 'mini' + (L.kind === 'road' ? '' : ' walk') }, g);
    });
    day.places.forEach(function (p) {
      var q = s.P(p.xy);
      sv('circle', { cx: r1(q[0]), cy: r1(q[1]), r: p.optional ? 2.4 : 2.7, 'class': 'mdot' + (p.optional ? ' opt' : '') }, g);
    });
    g.addEventListener('click', function () { userOpen(i); });
    g.addEventListener('mouseenter', function () { lab.classList.add('hov'); g.classList.add('hov'); });
    g.addEventListener('mouseleave', function () { lab.classList.remove('hov'); g.classList.remove('hov'); });
    s.g = g;
    obst.push([s.box[0], s.box[1], s.box[2], s.box[3], 4]);
    // the label: a real button, so the islands work with a keyboard
    var lab = ht('button', 'ilabel' + (S.day === i ? ' cur' : ''), archLab);
    lab.type = 'button';
    lab.setAttribute('aria-label', tr('is_open_day', { n: day.n, label: day.label, title: day.title }));
    ht('span', 'dno', lab, U.day + ' ' + day.n);
    setName(ht('span', 'dname', lab), day);
    ht('span', 'dtl', lab, day.title);
    ht('span', 'dkm', lab, day.road_km ? tr('is_km_road', { km: day.road_km.toFixed(1) }) : U.is_no_drive);
    var lw = Math.min(cw - 8, phone ? 182 : 240);
    lab.style.maxWidth = lw + 'px';
    var w0 = lab.offsetWidth;
    lab.style.left = r1(clamp(s.cx - w0 / 2, 4, W - w0 - 4)) + 'px';
    lab.style.top = r1(s.box[3] + 3) + 'px';
    lab.addEventListener('click', function () { userOpen(i); });
    lab.addEventListener('focus', function () { g.classList.add('hov'); });
    lab.addEventListener('blur', function () { g.classList.remove('hov'); });
    lab.addEventListener('mouseenter', function () { g.classList.add('hov'); });
    lab.addEventListener('mouseleave', function () { g.classList.remove('hov'); });
    s.lab = lab;
    labs.push(lab);
  });
  labs.forEach(function (lab, i) {
    var lb = [lab.offsetLeft, lab.offsetTop, lab.offsetLeft + lab.offsetWidth, lab.offsetTop + lab.offsetHeight];
    obst.push(lb.concat([4]));
    var b = isl[i].box;
    isl[i].ubox = [Math.min(b[0], lb[0]), Math.min(b[1], lb[1]), Math.max(b[2], lb[2]), Math.max(b[3], lb[3])];
  });
  var bounds = [6, 6, W - 6, H - 6];
  // where the family changes base
  D.days.forEach(function (day, i) {
    if (!day.base_change || i === 0) return;
    var gp = gap(i - 1), p = segPoint(i, (gp[0] + gp[1]) / 2);
    var mk = sv('g', { 'class': 'bmk' }, gMk);
    sv('circle', { cx: r1(p[0]), cy: r1(p[1]), r: 7, 'class': 'o' }, mk);
    sv('circle', { cx: r1(p[0]), cy: r1(p[1]), r: 3, 'class': 'i' }, mk);
    var el = ht('div', 'alab', archLab);
    el.appendChild(document.createTextNode(U.is_base_moves));
    ht('b', null, el, day.base_change.from + ' to ' + day.base_change.to);
    var w = el.offsetWidth, h = el.offsetHeight;
    var box = placeBox(w, h, around(p, w, h, 11), obst, null, bounds);
    el.style.left = r1(box[0]) + 'px'; el.style.top = r1(box[1]) + 'px';
    obst.push(box.concat([3]));
    var nx = clamp(p[0], box[0], box[2]), ny = clamp(p[1], box[1], box[3]);
    if (Math.hypot(nx - p[0], ny - p[1]) > 16) { // too far to read as one: draw a leader
      var a = Math.atan2(ny - p[1], nx - p[0]);
      sv('path', { d: 'M' + fmtPt([p[0] + Math.cos(a) * 8, p[1] + Math.sin(a) * 8]) + 'L' + fmtPt([nx, ny]), 'class': 'lead' }, gMk);
    }
  });
  // the first and last flights
  [[start, phone ? D.start_short : D.start, ''], [end, phone ? D.end_short : D.end, ' end']].forEach(function (a) {
    if (!a[1]) return;
    var p = a[0], el = ht('div', 'alab' + a[2], archLab, a[1]);
    var w = el.offsetWidth, h = el.offsetHeight;
    var box = placeBox(w, h, around(p, w, h, 5), obst, null, bounds);
    el.style.left = r1(box[0]) + 'px'; el.style.top = r1(box[1]) + 'px';
    obst.push(box.concat([3]));
  });
  var boat = sv('g', { 'class': 'boat', visibility: 'hidden' }, archSvg);
  var bt = sv('g', {}, boat);
  sv('path', { d: 'M-9,3 L9,3 L6,8 L-6,8 Z', 'class': 'hull' }, bt);
  sv('path', { d: 'M0,1 L0,-14 L9,1 Z', 'class': 'sail' }, bt);
  sv('path', { d: 'M-1.5,1 L-1.5,-11 L-8,1 Z', 'class': 'sail' }, bt);
  ARCH = { isl: isl, pts: pts, segPoint: segPoint, gap: gap, boat: boat };
}
function around(p, w, h, gap) { // label boxes all round a point, nearest first
  var out = [];
  [0, 24, 48, 72].forEach(function (far) {
    var g = gap + far;
    out.push([p[0] + g, p[1] - h / 2], [p[0] - g - w, p[1] - h / 2], [p[0] - w / 2, p[1] - g - h], [p[0] - w / 2, p[1] + g],
      [p[0] + g * 0.7, p[1] - g * 0.7 - h], [p[0] + g * 0.7, p[1] + g * 0.7], [p[0] - g * 0.7 - w, p[1] - g * 0.7 - h], [p[0] - g * 0.7 - w, p[1] + g * 0.7]);
  });
  return out;
}
function defs(svg, pre) {
  var d = sv('defs', {}, svg);
  var pat = sv('pattern', { id: pre + 'waves', width: 132, height: 54, patternUnits: 'userSpaceOnUse' }, d);
  sv('path', { d: 'M8 14 q6 -4 12 0 t12 0', fill: 'none', stroke: '#1d6a6c', 'stroke-opacity': '.13', 'stroke-width': 1.1, 'stroke-linecap': 'round' }, pat);
  sv('path', { d: 'M74 41 q6 -4 12 0 t12 0', fill: 'none', stroke: '#1d6a6c', 'stroke-opacity': '.10', 'stroke-width': 1.1, 'stroke-linecap': 'round' }, pat);
  var f = sv('filter', { id: pre + 'shadow', x: '-10%', y: '-10%', width: '120%', height: '125%' }, d);
  sv('feDropShadow', { dx: 0, dy: 1.5, stdDeviation: 2, 'flood-color': '#1e2a2b', 'flood-opacity': '.13' }, f);
  return d;
}

/* ------------------------------------------------------------ one island */
var ISLE = null;
function renderIsle(d) {
  var day = D.days[d];
  var W = stage.clientWidth, wide = W >= 900, phone = W < 640;
  var panelW = wide ? Math.round(clamp(W * 0.3, 330, 420)) : W;
  isleEl.classList.toggle('wide', wide);
  isleEl.style.setProperty('--panel-w', panelW + 'px');
  var mw = wide ? W - panelW : W;
  var mh = wide ? availH(500) : Math.round(clamp(window.innerHeight * (phone ? 0.7 : 0.56), 360, 680));
  if (!wide) { // a wide island on a narrow screen needs less height
    var bx = day.box, need = (bx[3] - bx[1]) * (W - 2 * (phone ? 14 : 30)) / (bx[2] - bx[0]) + (phone ? 78 + 70 : 84 + 74) + 70;
    mh = Math.round(clamp(Math.min(mh, need), 380, mh));
  }
  stage.style.height = wide ? mh + 'px' : 'auto';
  mapEl.style.height = mh + 'px';
  panel.style.height = wide ? mh + 'px' : 'auto';
  mapSvg.setAttribute('width', mw); mapSvg.setAttribute('height', mh); mapSvg.setAttribute('viewBox', '0 0 ' + mw + ' ' + mh);
  mapSvg.textContent = ''; mapLab.textContent = '';

  // day heading on the map
  var dh = $('dayhead'); dh.textContent = '';
  ht('div', 'dno', dh, tr('is_of', { n: day.n, total: NDAYS }));
  setName(ht('h2', null, dh), day);
  titleInto(ht('p', null, dh), day);

  var m = phone ? 14 : 30, topR = phone ? 78 : 84, botR = phone ? 70 : 74;
  var b = day.box, rw = b[2] - b[0], rh = b[3] - b[1];
  var k = Math.min((mw - 2 * m) / rw, (mh - topR - botR) / rh);
  var ox = mw / 2, oy = topR + (mh - topR - botR) / 2, bcx = (b[0] + b[2]) / 2, bcy = (b[1] + b[3]) / 2;
  var P = function (p) { return [ox + (p[0] - bcx) * k, oy + (p[1] - bcy) * k]; };
  defs(mapSvg, 'isl-m-');
  sv('rect', { x: 0, y: 0, width: mw, height: mh, fill: 'url(#isl-m-waves)' }, mapSvg);
  var clipId = 'isl-m-landclip';
  var cp = sv('clipPath', { id: clipId }, mapSvg.querySelector('defs'));
  var coastD = closedPath(day.coast.map(P));
  sv('path', { d: coastD }, cp);
  sv('path', { d: closedPath(day.reef.map(P)), 'class': 'reef' }, mapSvg);
  sv('path', { d: coastD, 'class': 'land', filter: 'url(#isl-m-shadow)' }, mapSvg);
  sv('path', { d: coastD, 'class': 'beach', 'clip-path': 'url(#' + clipId + ')' }, mapSvg);
  sv('path', { d: coastD, 'class': 'coastline' }, mapSvg);

  var main = sv('g', {}, mapSvg);
  var legEls = drawRoutes(main, day, P);
  var pins = day.places.map(function (p, j) { var q = P(p.xy); return { j: j, x: q[0], y: q[1] }; });
  var pinEls = drawPins(main, day, P, 12);

  // the marker for the simulation
  var mk = sv('g', { 'class': 'mk', visibility: 'hidden' }, mapSvg);
  sv('circle', { r: 15, 'class': 'mh' }, mk); sv('circle', { r: 7.5, 'class': 'mc' }, mk);

  // route samples (for keeping labels off the lines)
  var samples = [];
  day.legs.forEach(function (L) { samples = samples.concat(densify(L.path.map(P), 7)); });

  // places that sit too close together at this scale get a close-up
  var T = phone ? 26 : 30, parent = pins.map(function (_, i) { return i; });
  function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
  for (var i = 0; i < pins.length; i++) for (var j = i + 1; j < pins.length; j++)
    if (Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y) < T) parent[find(i)] = find(j);
  var groups = {};
  pins.forEach(function (p, i) { var r = find(i); (groups[r] = groups[r] || []).push(i); });
  var clusters = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length > 1; });
  var inCluster = {}; clusters.forEach(function (g, ci) { g.forEach(function (j) { inCluster[j] = ci; }); });

  var obst = [];
  pins.forEach(function (p) { obst.push([p.x - 14, p.y - 14, p.x + 14, p.y + 14, 3]); });
  // scale bar and north arrow, top right
  var sc = niceScale(k, Math.min(150, mw * 0.3));
  var sx1 = mw - m - 26, sx0 = sx1 - sc.px, sy = phone ? 28 : 30;
  var sbar = sv('g', { 'class': 'sbar' }, mapSvg);
  sv('rect', { x: r1(sx0), y: sy, width: r1(sc.px / 2), height: 5, 'class': 'a' }, sbar);
  sv('rect', { x: r1(sx0 + sc.px / 2), y: sy, width: r1(sc.px / 2), height: 5, 'class': 'b' }, sbar);
  var t0 = sv('text', { x: r1(sx0), y: sy - 5, 'text-anchor': 'start' }, sbar); t0.textContent = '0';
  var t1 = sv('text', { x: r1(sx1), y: sy - 5, 'text-anchor': 'end' }, sbar); t1.textContent = sc.label;
  var t2 = sv('text', { x: r1(sx1), y: sy + 19, 'text-anchor': 'end', 'class': 's' }, sbar); t2.textContent = U.is_scale;
  var nth = sv('g', { 'class': 'north', transform: 'translate(' + r1(mw - m - 8) + ',' + (sy - 4) + ')' }, mapSvg);
  sv('path', { d: 'M0,-2 L5,12 L0,9 L-5,12 Z' }, nth);
  var nt = sv('text', { x: 0, y: 25 }, nth); nt.textContent = 'N';
  obst.push([sx0 - 14, sy - 20, mw - m + 6, sy + 24, 4]);
  var dhb = [0, 0, dh.offsetWidth + 6, dh.offsetHeight + 8, 4];
  obst.push(dhb);
  var bounds = [6, 6, mw - 6, mh - 6];
  obst.push([0, mh - botR + 8, mw, mh, 1]);

  // close-ups
  var insets = [];
  clusters.slice(0, 2).forEach(function (g, ci) {
    var cx = 0, cy = 0, kx = 0, ky = 0, span = 0, sr = 0;
    g.forEach(function (j) { cx += pins[j].x; cy += pins[j].y; kx += day.places[j].xy[0]; ky += day.places[j].xy[1]; });
    cx /= g.length; cy /= g.length; kx /= g.length; ky /= g.length;
    g.forEach(function (a) { g.forEach(function (bb) {
      span = Math.max(span, Math.hypot(day.places[a].xy[0] - day.places[bb].xy[0], day.places[a].xy[1] - day.places[bb].xy[1]));
      sr = Math.max(sr, Math.hypot(pins[a].x - pins[bb].x, pins[a].y - pins[bb].y));
    }); });
    var ringR = sr / 2 + 17;
    sv('circle', { cx: r1(cx), cy: r1(cy), r: r1(ringR), 'class': 'ring' }, main);
    obst.push([cx - ringR, cy - ringR, cx + ringR, cy + ringR, 2]);
    var Sz = Math.round(clamp(Math.min(mw, mh) * 0.33, 118, 184)), R = Sz / 2;
    var cands = [], top = topR - 4, bot = mh - botR - 34;
    [[mw - m - R, top + R], [m + R, bot - R], [mw - m - R, bot - R], [m + R, top + R + 20], [mw / 2, bot - R], [mw / 2, top + R], [m + R, (top + bot) / 2], [mw - m - R, (top + bot) / 2]].forEach(function (c) {
      var x = clamp(c[0], R + 6, mw - R - 6), y = clamp(c[1], R + 6, mh - R - 46), s = 0;
      var foot = [x - R - 6, y - R - 6, x + R + 6, y + R + 46];
      samples.forEach(function (p) { if (Math.hypot(p[0] - x, p[1] - y) < R + 8) s += 6; else if (p[0] > foot[0] && p[0] < foot[2] && p[1] > foot[1] && p[1] < foot[3]) s += 3; });
      pins.forEach(function (p) { if (p.x > foot[0] - 14 && p.x < foot[2] + 14 && p.y > foot[1] - 14 && p.y < foot[3] + 14) s += 400; });
      if (Math.hypot(x - cx, y - cy) < R + ringR + 26) s += 3000;
      insets.forEach(function (o) { if (Math.hypot(o.x - x, o.y - y) < R + o.R + 30) s += 5000; });
      for (var oi = 0; oi < obst.length; oi++) if (obst[oi][4] === 4) s += overlap(foot, obst[oi]) * 2;
      s += Math.hypot(x - cx, y - cy) * 0.12;
      cands.push([s, x, y]);
    });
    cands.sort(function (a, bq) { return a[0] - bq[0]; });
    var ix = cands[0][1], iy = cands[0][2];
    var k2 = Math.max(k * 3, (Sz * 0.42) / Math.max(span, 0.02));
    var P2 = function (p) { return [ix + (p[0] - kx) * k2, iy - R * 0.12 + (p[1] - ky) * k2]; };
    // leader line from the ring to the close-up
    var ang = Math.atan2(iy - cy, ix - cx);
    sv('path', { d: 'M' + fmtPt([cx + Math.cos(ang) * ringR, cy + Math.sin(ang) * ringR]) + 'L' + fmtPt([ix - Math.cos(ang) * R, iy - Math.sin(ang) * R]), 'class': 'lead' }, mapSvg);
    var cid = 'isl-m-inset' + ci;
    var cpi = sv('clipPath', { id: cid }, mapSvg.querySelector('defs'));
    sv('circle', { cx: r1(ix), cy: r1(iy), r: R }, cpi);
    var gi = sv('g', { 'clip-path': 'url(#' + cid + ')' }, mapSvg);
    sv('circle', { cx: r1(ix), cy: r1(iy), r: R, 'class': 'inset-bg' }, gi);
    sv('path', { d: closedPath(day.reef.map(P2)), 'class': 'reef' }, gi);
    sv('path', { d: closedPath(day.coast.map(P2)), 'class': 'land' }, gi);
    var ile = drawRoutes(gi, day, P2);
    var ipe = drawPins(gi, day, P2, 11);
    var mk2 = sv('g', { 'class': 'mk', visibility: 'hidden' }, gi);
    sv('circle', { r: 13, 'class': 'mh' }, mk2); sv('circle', { r: 6.5, 'class': 'mc' }, mk2);
    sv('circle', { cx: r1(ix), cy: r1(iy), r: R, 'class': 'inset-rim' }, mapSvg);
    var isc = niceScale(k2, Sz * 0.32);
    var sg = sv('g', { 'class': 'sbar' }, mapSvg), y0 = iy + R - 17;
    sv('rect', { x: r1(ix - isc.px / 2), y: r1(y0), width: r1(isc.px / 2), height: 4, 'class': 'a' }, sg);
    sv('rect', { x: r1(ix), y: r1(y0), width: r1(isc.px / 2), height: 4, 'class': 'b' }, sg);
    var it = sv('text', { x: r1(ix), y: r1(y0 - 4), 'text-anchor': 'middle' }, sg); it.textContent = isc.label;
    // the close-up's caption: distances between the places inside it
    var cap2 = ht('div', 'ilab', mapLab);
    var inner = day.legs.filter(function (L) { return g.indexOf(day.route[L.a]) >= 0 && g.indexOf(day.route[L.b]) >= 0; });
    ht('b', null, cap2, U.is_closeup);
    if (inner.length) inner.forEach(function (L) { ht('div', null, cap2, String.fromCharCode(65 + L.a) + '→' + String.fromCharCode(65 + L.b) + ' ' + L.label); });
    else ht('div', null, cap2, tr('is_together', { list: g.map(function (j) { return letters(day.places[j]); }).join(U.is_and) }));
    cap2.style.maxWidth = Math.max(Sz + 40, 150) + 'px';
    var cw2 = cap2.offsetWidth, ch2 = cap2.offsetHeight;
    var cbox = placeBox(cw2, ch2, [[ix - cw2 / 2, iy + R + 5], [ix - cw2 / 2, iy - R - 5 - ch2]], obst, null, bounds);
    cap2.style.left = r1(cbox[0]) + 'px'; cap2.style.top = r1(cbox[1]) + 'px';
    obst.push([ix - R - 4, iy - R - 4, ix + R + 4, iy + R + 4, 6]);
    obst.push(cbox.concat([6]));
    insets.push({ x: ix, y: iy, R: R, P: P2, mk: mk2, legs: ile, pins: ipe, g: g });
  });

  // place labels
  var leads = sv('g', {}, mapSvg);
  mapSvg.insertBefore(leads, main);
  function placeLabel(fill, ax, ay, ar) {
    var el = ht('div', 'plab', mapLab);
    fill(el);
    var w = el.offsetWidth, h = el.offsetHeight, d = ar + 5, e = ar * 0.72 + 3;
    var cands = [[ax + d, ay - h / 2], [ax - d - w, ay - h / 2], [ax - w / 2, ay - d - h], [ax - w / 2, ay + d],
      [ax + e, ay - e - h], [ax + e, ay + e], [ax - e - w, ay - e - h], [ax - e - w, ay + e],
      [ax + d, ay - h + 10], [ax + d, ay - 10], [ax - d - w, ay - h + 10], [ax - d - w, ay - 10]];
    [30, 60].forEach(function (f) {
      var g = d + f, g2 = e + f * 0.72;
      cands.push([ax + g, ay - h / 2], [ax - g - w, ay - h / 2], [ax - w / 2, ay - g - h], [ax - w / 2, ay + g],
        [ax + g2, ay - g2 - h], [ax + g2, ay + g2], [ax - g2 - w, ay - g2 - h], [ax - g2 - w, ay + g2]);
    });
    var box = placeBox(w, h, cands, obst, samples, bounds);
    el.style.left = r1(box[0]) + 'px'; el.style.top = r1(box[1]) + 'px';
    obst.push(box.concat([3]));
    var nx = clamp(ax, box[0], box[2]), ny = clamp(ay, box[1], box[3]), dist = Math.hypot(nx - ax, ny - ay);
    if (dist > ar + 10) {
      var a = Math.atan2(ny - ay, nx - ax);
      sv('path', { d: 'M' + fmtPt([ax + Math.cos(a) * (ar + 1), ay + Math.sin(a) * (ar + 1)]) + 'L' + fmtPt([nx, ny]), 'class': 'lead' }, leads);
    }
    return el;
  }
  function rowNode(j, parent) {
    var p = day.places[j], its = placeItems(day, j), row = ht('div', 'row', parent);
    ht('span', 'lt' + (p.optional ? ' o' : ''), row, letters(p));
    ht('span', 'nm', row, p.optional ? U.is_optional + p.name : p.name);
    if (phone) { if (its.length) ht('span', 'tm', row, its.map(function (it) { return it.time; }).join(', ')); }
    else its.forEach(function (it) { ht('span', 'tm', row, it.time + ' · ' + it.title); });
    if (p.optional && p.near) ht('span', 'tm', row, tr('is_from_letter', { label: p.near.label, letter: p.near.letter }));
    else if (!its.length && p.role) ht('span', 'tm', row, p.role);
  }
  var order = pins.slice().sort(function (a, bq) { return (day.places[a.j].ri[0] === undefined ? 99 : day.places[a.j].ri[0]) - (day.places[bq.j].ri[0] === undefined ? 99 : day.places[bq.j].ri[0]); });
  var done = {};
  order.forEach(function (p) {
    if (done[p.j]) return;
    var ci = inCluster[p.j];
    if (ci !== undefined) {
      var g = clusters[ci], cx = 0, cy = 0, sr = 0;
      g.forEach(function (j) { done[j] = 1; cx += pins[j].x; cy += pins[j].y; });
      cx /= g.length; cy /= g.length;
      g.forEach(function (a) { g.forEach(function (bq) { sr = Math.max(sr, Math.hypot(pins[a].x - pins[bq].x, pins[a].y - pins[bq].y)); }); });
      placeLabel(function (el) { g.slice().sort(function (a, bq) { return (day.places[a].ri[0] || 0) - (day.places[bq].ri[0] || 0); }).forEach(function (j) { rowNode(j, el); }); }, cx, cy, sr / 2 + 17);
    } else {
      done[p.j] = 1;
      placeLabel(function (el) { rowNode(p.j, el); }, p.x, p.y, 13);
    }
  });
  // leg labels (legs inside a close-up are listed under it)
  day.legs.forEach(function (L) {
    var ja = day.route[L.a], jb = day.route[L.b];
    if (inCluster[ja] !== undefined && inCluster[ja] === inCluster[jb]) return;
    var sp = L.path.map(P), Ls = lens(sp), total = Ls[Ls.length - 1];
    var el = ht('div', 'llab', mapLab);
    ht('span', 'k', el, String.fromCharCode(65 + L.a) + '→' + String.fromCharCode(65 + L.b));
    el.appendChild(document.createTextNode(L.label));
    var w = el.offsetWidth, h = el.offsetHeight, cands = [];
    [6, 26].forEach(function (gap) {
      [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8].forEach(function (t) {
        var q = along(sp, Ls, t), nx = -Math.sin(q[2]), ny = Math.cos(q[2]), off = h / 2 + gap;
        cands.push([q[0] + nx * off - w / 2, q[1] + ny * off - h / 2]);
        cands.push([q[0] - nx * off - w / 2, q[1] - ny * off - h / 2]);
      });
    });
    if (total < 10) cands = [[sp[0][0] + 14, sp[0][1] - h / 2]];
    var box = placeBox(w, h, cands, obst, samples, bounds);
    el.style.left = r1(box[0]) + 'px'; el.style.top = r1(box[1]) + 'px';
    obst.push(box.concat([3]));
  });

  mapSvg.setAttribute('aria-label', tr('is_map_aria', { label: day.label, n: day.places.length, scale: sc.label }));
  ISLE = { d: d, P: P, k: k, mk: mk, legs: legEls, pins: pinEls, insets: insets };
  buildPanel(day, d);
}
function drawRoutes(parent, day, P) {
  var out = [];
  day.legs.forEach(function (L) {
    var d = polyPath(L.path.map(P)), el;
    if (L.kind === 'road') { sv('path', { d: d, 'class': 'road-case' }, parent); el = sv('path', { d: d, 'class': 'road' }, parent); }
    else el = sv('path', { d: d, 'class': L.kind === 'walk' ? 'walkl' : 'linel' }, parent);
    out.push(el);
  });
  return out;
}
function drawPins(parent, day, P, r) {
  // later pins first, so the first letter sits on top when two share a spot
  var out = [];
  day.places.slice().map(function (p, j) { return j; }).reverse().forEach(function (j) {
    var p = day.places[j], q = P(p.xy);
    var g = sv('g', { 'class': 'pin' + (p.optional ? ' opt' : ''), transform: 'translate(' + r1(q[0]) + ',' + r1(q[1]) + ')' }, parent);
    sv('circle', { r: r, 'class': 'h' }, g);
    sv('circle', { r: r, 'class': 'c' }, g);
    var t = sv('text', { x: 0, y: 0.5 }, g); t.textContent = p.optional ? '+' : p.letters[0];
    out[j] = g;
  });
  return out;
}

/* ------------------------------------------------------------ the panel */
function buildPanel(day, d) {
  panel.textContent = '';
  ht('div', 'dno', panel, tr('is_of', { n: day.n, total: NDAYS }));
  setName(ht('h2', null, panel), day);
  titleInto(ht('p', 'ttl', panel), day);
  if (day.sub) ht('p', 'sub', panel, day.sub);
  var pills = ht('div', 'pills', panel);
  if (day.base) ht('span', null, pills, U.is_base + day.base);
  if (day.badge) ht('span', null, pills, day.badge);
  if (day.base_change) ht('span', 'mv', pills, U.is_base_today + day.base_change.from + ' to ' + day.base_change.to);
  ht('div', 'tot', panel, day.road_km ? tr('is_by_road', { km: day.road_km.toFixed(1), time: day.road_time }) +
    (day.legs.some(function (L) { return L.kind === 'walk'; }) ? U.is_walks_extra : '') : U.is_no_drive_today);

  ht('h3', null, panel, U.is_h_day);
  var ol = ht('ol', 'tl', panel);
  day.items.forEach(function (it, n) {
    var li = ht('li', null, ol);
    li.tabIndex = 0;
    li.setAttribute('data-ri', it.ri);
    var pj = day.route[it.ri], p = day.places[pj];
    ht('span', 'lt', li, String.fromCharCode(65 + it.ri));
    var body = ht('div', null, li);
    ht('div', 'tm', body, it.time);
    ht('div', 'tt', body, it.title);
    ht('div', 'tp', body, (it.how ? U.is_near : U.is_at) + p.name);
    if (it.text) ht('p', 'tx', body, it.text);
    var go = function () { gotoStop(d, it.ri); };
    li.addEventListener('click', go);
    li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  ht('h3', null, panel, U.is_h_dist);
  var lg = ht('ol', 'lg', panel);
  day.legs.forEach(function (L) {
    var li = ht('li', null, lg);
    ht('span', 'lk', li, String.fromCharCode(65 + L.a) + '→' + String.fromCharCode(65 + L.b));
    li.appendChild(document.createTextNode(L.from + ' to ' + L.to));
    ht('span', 'd', li, L.label);
    var n = L.kind === 'road' ? tr('is_n_road', { line: fmtLine(L.line_km) }) :
      L.kind === 'walk' ? U.is_n_walk + (L.car_note ? ' ' + L.car_note : '') : U.is_n_line;
    ht('span', 'n', li, n);
  });
  var opts = day.places.filter(function (p) { return p.optional; });
  opts.forEach(function (p) {
    var li = ht('li', null, lg);
    ht('span', 'lk', li, '+');
    li.appendChild(document.createTextNode(tr('is_opt_from', { stop: p.stop || p.name, near: p.near.name })));
    ht('span', 'd', li, p.near.label);
    ht('span', 'n', li, (p.role ? p.role + ' ' : '') + U.is_n_opt);
  });

  ht('h3', null, panel, U.is_h_places);
  var pl = ht('ol', 'pl', panel);
  day.places.forEach(function (p) {
    var li = ht('li', null, pl);
    ht('span', 'lt' + (p.optional ? ' o' : ''), li, letters(p));
    var b = ht('div', null, li, p.name);
    var note = [];
    if (p.stop && p.stop !== p.name) note.push(p.stop);
    if (p.approx) note.push(U.is_approx);
    if (note.length) ht('span', 'n', b, note.join(' · '));
  });
  var hint = ht('p', 'hint', panel, U.is_hint);
  var a = ht('a', null, hint, U.is_how_h);
  a.href = '#isl-how';
  a.addEventListener('click', function (e) { e.preventDefault(); var h = document.getElementById('isl-how'); if (h) h.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); });
}
function fmtLine(km) { return km < 1 ? Math.round(km * 100) * 10 + ' m' : km.toFixed(1) + ' km'; }

/* ------------------------------------------------------------ views */
function showArch(anim) {
  S.view = 'arch';
  isleEl.hidden = true; archEl.hidden = false;
  renderArch();
  archEl.appendChild(cap);
  if (anim && !reduced) { archEl.classList.remove('fadein'); void archEl.offsetWidth; archEl.classList.add('fadein'); }
  syncUi();
}
function showIsle(d, anim) {
  var changed = S.view !== 'isle' || !ISLE || ISLE.d !== d;
  S.view = 'isle'; S.day = d;
  archEl.hidden = true; isleEl.hidden = false;
  if (changed) renderIsle(d);
  mapEl.appendChild(cap);
  if (changed && anim && !reduced) { isleEl.classList.remove('fadein'); void isleEl.offsetWidth; isleEl.classList.add('fadein'); }
  syncUi();
}
function syncUi() {
  $('tPlay').textContent = S.playing ? U.is_pause : U.is_play;
  bPlay.setAttribute('aria-label', S.playing ? U.is_pause_aria : U.is_play_aria);
  $('iPlay').querySelector('path').setAttribute('d', S.playing ? 'M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z' : 'M4 2.5v11l9.5-5.5z');
  bBack.disabled = S.day < 0;
  bNext.disabled = S.day >= NDAYS - 1 && S.view === 'isle';
  pick.value = String(S.view === 'isle' ? S.day : -1);
}
function caption(kicker, main, lines) {
  cap.hidden = false;
  cap.querySelector('.ck').textContent = kicker;
  cap.querySelector('.cm').textContent = main;
  var cs = cap.querySelector('.cs'); cs.textContent = '';
  (lines || []).forEach(function (l) { ht('div', null, cs, l); });
}

/* ------------------------------------------------------------ the simulation */
function placeXY(day, ri) { return day.places[day.route[ri]].xy; }
function moveMarker(xy) {
  if (!ISLE) return;
  var q = ISLE.P(xy);
  ISLE.mk.setAttribute('transform', 'translate(' + r1(q[0]) + ',' + r1(q[1]) + ')');
  ISLE.mk.setAttribute('visibility', 'visible');
  ISLE.insets.forEach(function (o) {
    var q2 = o.P(xy);
    o.mk.setAttribute('transform', 'translate(' + r1(q2[0]) + ',' + r1(q2[1]) + ')');
    o.mk.setAttribute('visibility', 'visible');
  });
}
function hideMarker() {
  if (!ISLE) return;
  ISLE.mk.setAttribute('visibility', 'hidden');
  ISLE.insets.forEach(function (o) { o.mk.setAttribute('visibility', 'hidden'); });
}
function markActive(day, ri, li) {
  if (!ISLE) return;
  ISLE.pins.forEach(function (g, j) { if (g) g.classList.toggle('act', ri != null && day.route[ri] === j); });
  ISLE.insets.forEach(function (o) { o.pins.forEach(function (g, j) { if (g) g.classList.toggle('act', ri != null && day.route[ri] === j); }); });
  ISLE.legs.forEach(function (e, n) { e.classList.toggle('act', n === li); });
  var first = null;
  panel.querySelectorAll('.tl li').forEach(function (el) {
    var on = ri != null && Number(el.getAttribute('data-ri')) === ri;
    el.classList.toggle('act', on);
    if (on && !first) first = el;
  });
  if (first && isleEl.classList.contains('wide')) {
    var top = first.offsetTop - panel.offsetTop, bottom = top + first.offsetHeight;
    if (top < panel.scrollTop || bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = Math.max(0, top - panel.clientHeight / 3);
  }
}
function begin(seg) {
  var day = D.days[seg.d];
  var kick = U.day + ' ' + day.n + ' · ' + day.label;
  if (seg.t === 'enter') {
    showIsle(seg.d, true);
    moveMarker(placeXY(day, 0));
    markActive(day, null, null);
    caption(tr('is_of', { n: day.n, total: NDAYS }), day.label, [day.title + (day.road_km ? ' · ' + day.road_label : '')]);
  } else if (seg.t === 'stop') {
    showIsle(seg.d, false);
    moveMarker(placeXY(day, seg.ri));
    markActive(day, seg.ri, null);
    var p = day.places[day.route[seg.ri]], its = dayItemsAt(day, seg.ri);
    var lines = its.map(function (it) { return it.time + ' · ' + it.title; });
    if (!lines.length) lines = [p.role || (seg.ri === 0 ? U.is_start_day : U.is_on_way)];
    caption(kick, String.fromCharCode(65 + seg.ri) + ' · ' + p.name, lines);
  } else if (seg.t === 'leg') {
    showIsle(seg.d, false);
    var L = day.legs[seg.li];
    markActive(day, null, seg.li);
    var verb = L.kind === 'walk' ? U.is_walking : (L.kind === 'road' ? U.is_driving : U.is_on_to);
    caption(kick, verb + L.to, [String.fromCharCode(65 + L.a) + '→' + String.fromCharCode(65 + L.b) + ' · ' + L.label]);
    if (reduced) moveMarker(placeXY(day, L.b));
  } else if (seg.t === 'leave') {
    showArch(true);
    markCur(seg.d);
    caption(kick, U.is_end_day, [day.town ? U.is_night_in + day.town : U.is_homeward]);
  } else if (seg.t === 'sail') {
    if (S.view !== 'arch') showArch(false);
    markCur(seg.d);
    var nx = D.days[seg.d + 1];
    var lines2 = [];
    if (nx.base_change) lines2.push(U.is_base_moves + nx.base_change.from + ' to ' + nx.base_change.to);
    lines2.push(U.is_gaps);
    caption((day.town ? U.is_night_in + day.town : U.is_overnight), U.is_sailing + nx.label, lines2);
    ARCH.boat.setAttribute('visibility', 'visible');
    if (reduced) placeBoat(seg.d, 1);
  } else if (seg.t === 'end') {
    if (S.view !== 'arch') showArch(false);
    markCur(-1);
    caption(U.is_end_trip, D.end || U.is_home, [U.is_again]);
    stopPlay();
    S.started = false; S.i = 0; S.t = 0; S.day = -1;
    syncUi();
  }
}
function markCur(d) {
  if (!ARCH) return;
  ARCH.isl.forEach(function (s, i) { s.g.classList.toggle('cur', i === d); s.lab.classList.toggle('cur', i === d); });
  if (d >= 0) S.day = d;
  syncUi();
}
function placeBoat(d, p) {
  var gp = ARCH.gap(d), t = gp[0] + (gp[1] - gp[0]) * p, q = ARCH.segPoint(d + 1, t);
  var q2 = ARCH.segPoint(d + 1, Math.min(1, t + 0.02));
  var flip = q2[0] < q[0] ? ' scale(-1,1)' : '';
  ARCH.boat.setAttribute('transform', 'translate(' + r1(q[0]) + ',' + r1(q[1] - 4) + ')' + flip);
}
function apply(seg, p) {
  var day = D.days[seg.d];
  if (seg.t === 'leg' && !reduced) {
    var L = day.legs[seg.li], Ls = lens(L.path), q = along(L.path, Ls, ease(p));
    moveMarker([q[0], q[1]]);
  } else if (seg.t === 'sail' && !reduced) {
    placeBoat(seg.d, ease(p));
  }
}
function tick(now) {
  if (!S.playing) return;
  var dt = Math.min(100, now - S.last); S.last = now;
  var seg = SEQ[S.i];
  S.t += dt;
  var dur = segDur(seg);
  apply(seg, dur ? Math.min(1, S.t / dur) : 1);
  if (S.t >= dur) {
    if (seg.t === 'sail' && ARCH) ARCH.boat.setAttribute('visibility', 'hidden');
    S.i++; S.t = 0;
    if (S.i >= SEQ.length) { S.i = 0; stopPlay(); return; }
    begin(SEQ[S.i]);
    if (!S.playing) return;
  }
  S.raf = requestAnimationFrame(tick);
}
function startPlay() {
  if (!S.started) {
    if (S.view === 'isle' && S.day >= 0) S.i = DAYSTART[S.day] + 1;
    else if (S.day >= 0) S.i = DAYSTART[S.day];
    else S.i = 0;
    S.t = 0; S.started = true;
    S.playing = true;
    begin(SEQ[S.i]);
  } else {
    S.playing = true;
    var seg = SEQ[S.i];
    begin(seg);
    apply(seg, Math.min(1, S.t / (segDur(seg) || 1)));
  }
  S.last = performance.now();
  cancelAnimationFrame(S.raf);
  S.raf = requestAnimationFrame(tick);
  syncUi();
}
function stopPlay() {
  S.playing = false;
  cancelAnimationFrame(S.raf);
  syncUi();
}
function jumpTo(d, anim) {
  if (ARCH && ARCH.boat) ARCH.boat.setAttribute('visibility', 'hidden');
  S.day = d;
  S.i = DAYSTART[d] + 1; S.t = 0;
  showIsle(d, anim);
  if (S.started) begin(SEQ[S.i]);
  else { cap.hidden = true; hideMarker(); markActive(D.days[d], null, null); }
  if (!S.playing) syncUi();
  bringIntoView();
}
function gotoStop(d, ri) {
  var idx = SEQ.findIndex(function (s) { return s.t === 'stop' && s.d === d && s.ri === ri; });
  if (idx < 0) return;
  S.i = idx; S.t = 0; S.started = true;
  begin(SEQ[idx]);
  syncUi();
}
function goAll() {
  stopPlay();
  S.started = false; S.i = 0; S.t = 0; S.day = -1;
  cap.hidden = true;
  showArch(true);
}
function userOpen(d) { jumpTo(d, true); }
function bringIntoView() {
  var r = stage.getBoundingClientRect();
  if (r.top < bar.offsetHeight || r.top > window.innerHeight * 0.5) root.scrollTo({ top: root.scrollTop + r.top - bar.offsetHeight - 10, behavior: reduced ? 'auto' : 'smooth' });
}

bPlay.addEventListener('click', function () { if (S.playing) stopPlay(); else startPlay(); });
bNext.addEventListener('click', function () { var d = S.day < 0 ? 0 : S.day + 1; if (d < NDAYS) jumpTo(d, true); });
bBack.addEventListener('click', function () { if (S.day > 0) jumpTo(S.day - 1, true); else if (S.day === 0) goAll(); });
bAll.addEventListener('click', goAll);
pick.addEventListener('change', function () { var v = Number(pick.value); if (v < 0) goAll(); else jumpTo(v, true); });
document.addEventListener('keydown', function (e) {
  if (root.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); if (S.view === 'isle') goAll(); else closeIslands(); }
  else if (e.key === 'Tab') {
    var f = [].slice.call(root.querySelectorAll('button:not([disabled]), select, a[href], [tabindex="0"]')).filter(function (x) { return x.getClientRects().length; });
    if (!f.length) return;
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
});
var rz = 0, lastW = window.innerWidth, lastH = window.innerHeight;
window.addEventListener('resize', function () {
  clearTimeout(rz);
  rz = setTimeout(function () {
    if (root.hidden) return;
    if (window.innerWidth === lastW && Math.abs(window.innerHeight - lastH) < 80) return; // phone toolbars
    lastW = window.innerWidth; lastH = window.innerHeight;
    if (S.view === 'arch') { renderArch(); if (S.day >= 0) markCur(S.day); }
    else { renderIsle(S.day); }
    var seg = SEQ[S.i];
    if (S.started && seg) {
      if (seg.t === 'stop') { moveMarker(placeXY(D.days[seg.d], seg.ri)); markActive(D.days[seg.d], seg.ri, null); }
      else if (seg.t === 'enter') moveMarker(placeXY(D.days[seg.d], 0));
      else if (seg.t === 'leg') { markActive(D.days[seg.d], null, seg.li); if (reduced) moveMarker(placeXY(D.days[seg.d], D.days[seg.d].legs[seg.li].b)); }
      apply(seg, Math.min(1, S.t / (segDur(seg) || 1)));
      if (seg.t === 'sail' && ARCH) { ARCH.boat.setAttribute('visibility', 'visible'); if (reduced) placeBoat(seg.d, 1); }
    }
  }, 120);
});

/* ------------------------------------------------------------ open and close */
var drawn = false, back = null;
function tell(state) { if (window.parent !== window) { try { window.parent.postMessage({ type: 'hj:islands', state: state }, '*'); } catch (e) {} } }
function openIslands() {
  if (!root.hidden) return;
  back = document.activeElement;
  root.hidden = false;
  document.documentElement.classList.add('isl-open');
  if (!drawn || S.view === 'arch') { drawn = true; showArch(false); if (S.day >= 0) markCur(S.day); }
  else { renderIsle(S.day); syncUi(); }
  root.scrollTop = 0;
  var x = document.getElementById('isl-x');
  if (x) x.focus({ preventScroll: true });
  tell('open');
}
function closeIslands() {
  if (root.hidden) return;
  stopPlay();
  root.hidden = true;
  document.documentElement.classList.remove('isl-open');
  if (location.hash === '#islands' && history.replaceState) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  tell('closed');
  if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) {} }
}
document.getElementById('isl-x').addEventListener('click', closeIslands);
window.addEventListener('message', function (e) {
  if (window.parent === window || e.source !== window.parent) return;
  var a = e.data;
  if (!a || typeof a !== 'object') return;
  if (a.type === 'hj:islands-open') openIslands();
  else if (a.type === 'hj:islands-close') closeIslands();
  else if (a.type === 'hj:islands-ask') tell(root.hidden ? 'ready' : 'open');
});
window.addEventListener('hashchange', function () { if (location.hash === '#islands') openIslands(); });
if (location.hash === '#islands') openIslands();
tell('ready');
window.__islands = { S: S, D: D, SEQ: SEQ, open: openIslands, close: closeIslands };
})();
