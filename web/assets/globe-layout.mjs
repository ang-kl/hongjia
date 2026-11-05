// Globe layout for hongjia's documents, ported from the owner's michi explorer
// (src/claude-explorer.mjs): islands are placed on a golden spiral, pins spread around each
// island's centre, and every island has its own coastline. Pure functions, no DOM, so Node tests
// can check them. Positions are a layout only; distance means nothing.

export const MAX_ISLANDS = 6;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
// Six soft land tones (fill | rim | name), one per island, as in michi.
const LAND = ['#d7e5cf|#8fb09a|#2f5a45', '#f1e2cf|#c9a57a|#6b4a24', '#d6e3f3|#8aa9d2|#243f66', '#ead9ec|#b48cc0|#5a2e63', '#f3dcd6|#d1958a|#6f3328', '#d9ecec|#86b8bb|#245a5c'];

export const norm = v => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

// A point at angular distance r from centre c, in direction theta.
export function around(c, r, theta) {
  const helper = Math.abs(c.y) < .9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = norm(cross(helper, c)), v = cross(c, u);
  const s = Math.sin(r), k = Math.cos(r);
  return norm({ x: c.x * k + (u.x * Math.cos(theta) + v.x * Math.sin(theta)) * s, y: c.y * k + (u.y * Math.cos(theta) + v.y * Math.sin(theta)) * s, z: c.z * k + (u.z * Math.cos(theta) + v.z * Math.sin(theta)) * s });
}

// Turns a point by yaw (around the vertical axis) then pitch; depth > 0 faces the reader.
export function rotate(p, yaw, pitch) {
  const x = p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
  const z = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
  const y = p.y * Math.cos(pitch) - z * Math.sin(pitch);
  const depth = p.y * Math.sin(pitch) + z * Math.cos(pitch);
  return { x, y, depth };
}

// Islands from hashtags: the most common hashtags shared by two or more documents (ties in
// alphabetical order), up to six islands in all; each document joins the first island whose
// hashtag it has, and documents without a shared hashtag go to an "Other" island (which then
// takes one of the six places). When no hashtag is shared at all, each document's first hashtag
// names its island, so a small library still shows named land.
export function buildIslands(docs) {
  const counts = new Map();
  for (const doc of docs) for (const tag of new Set(doc.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  let candidates = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([tag]) => tag);
  if (!candidates.length) candidates = [...new Set(docs.map(d => (d.tags || [])[0]).filter(Boolean))];
  const assign = limit => {
    const used = new Set(), islands = [];
    for (const tag of candidates) {
      if (islands.length === limit) break;
      const members = docs.filter(d => !used.has(d.key) && (d.tags || []).includes(tag));
      if (!members.length) continue;
      for (const d of members) used.add(d.key);
      islands.push({ id: `tag:${tag}`, name: `#${tag}`, docs: members });
    }
    return { islands, rest: docs.filter(d => !used.has(d.key)) };
  };
  let { islands, rest } = assign(MAX_ISLANDS);
  if (rest.length) ({ islands, rest } = assign(MAX_ISLANDS - 1));
  if (rest.length) islands.push({ id: 'other', name: 'Other', docs: rest });
  return islands;
}

const round = v => ({ x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) });

// Places islands and pins on the unit sphere, exactly as michi places themes and their items.
export function placeGlobe(islands) {
  const n = islands.length;
  const placed = islands.map((island, t) => {
    const y = 1 - 2 * (t + .5) / n, r = Math.sqrt(1 - y * y), angle = t * GOLDEN + .6;
    const centre = norm({ x: r * Math.cos(angle), y: y * .82, z: r * Math.sin(angle) });
    const spread = Math.min(.42, .16 + .04 * Math.sqrt(island.docs.length));
    const pins = island.docs.map((doc, i) => ({ doc, island: island.id, ...round(around(centre, spread * Math.sqrt((i + .5) / island.docs.length), i * GOLDEN + t)) }));
    const [fill, rim, ink] = LAND[t % LAND.length].split('|');
    const radius = spread + .08;
    // Each island has its own coastline: a different mix of bays and headlands per seed.
    const coast = Array.from({ length: 48 }, (_, i) => {
      const theta = i * Math.PI / 24, s = t;
      const wobble = 1 + .14 * Math.sin((2 + s % 3) * theta + s * 1.7) + .09 * Math.cos((4 + s % 2) * theta + s * .9) + .05 * Math.sin(7 * theta + s);
      return round(around(centre, radius * wobble, theta));
    });
    return { id: island.id, name: island.name, count: island.docs.length, centre: round(centre), radius, coast, fill, rim, ink, pins };
  });
  return { islands: placed, pins: placed.flatMap(i => i.pins) };
}

// Documents grouped by the month they were filed, newest first, for 📁 contents.
export function byMonth(docs) {
  const groups = [];
  for (const doc of docs) {
    const last = groups[groups.length - 1];
    if (last && last.month === doc.month) last.docs.push(doc);
    else groups.push({ month: doc.month, docs: [doc] });
  }
  return groups;
}

// A short label for a pin.
export const shortTitle = (title, max = 26) => { const t = String(title || '').trim(); return [...t].length > max ? [...t].slice(0, max - 1).join('') + '…' : t; };
