#!/usr/bin/env node
'use strict';

// Renders every trips/*.json through template/brief.html into
// docs/<slug>/index.html and every gear/*.json through template/gear.html into
// docs/gear/<slug>/index.html, then writes docs/index.html as an index of both.
// Zero dependencies, Node 18+.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TEMPLATE_PATH = path.join(ROOT, 'template', 'brief.html');
const GEAR_TEMPLATE_PATH = path.join(ROOT, 'template', 'gear.html');
const TRIPS_DIR = path.join(ROOT, 'trips');
const GEAR_DIR = path.join(ROOT, 'gear');
const DOCS_DIR = path.join(ROOT, 'docs');

// Design-system tokens, mirrored from the template stylesheet. SVG attributes
// can't use CSS variables when the SVG must also survive being viewed alone.
const C = {
  paper: '#EDF0E8',
  paper2: '#F6F7F3',
  contour: '#7A5B38',
  forest: '#2E5339',
  water: '#1D6F8E',
  route: '#B5651D',
  rule: '#C9CEC0',
  ink: '#23281F',
  muted: '#5A6152',
};

const MILES_PER_DEG_LAT = 69.055;
const OZ_PER_LB = 16;

function fail(msg) {
  console.error('build failed: ' + msg);
  process.exit(1);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numWord = (n) => WORDS[n] || String(n);
// Unicode minus for display coordinates, per the design system.
const coordFmt = (v) => v.toFixed(4).replace('-', '−');
// Safe to embed in a <script> block: no `<` survives.
const jsLit = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
// Commons file name -> URL path segment (underscores + strict RFC 3986).
const commonsFile = (name) =>
  encodeURIComponent(name.replace(/ /g, '_')).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());

function need(obj, key, ctx) {
  if (obj == null || obj[key] == null) {
    fail(`${ctx}: missing required field "${key}" — add it to the trip JSON (schema: CLAUDE.md) rather than hardcoding content in the template.`);
  }
  return obj[key];
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

// "Spanish Peaks — Aug 24–27, 2026" from place + first/last day + year in `dates`.
function titleTag(trip) {
  const days = trip.days || [];
  const year = (String(trip.dates || '').match(/\b(19|20)\d\d\b/) || [''])[0];
  if (!days.length) return trip.place + (trip.dates ? ' — ' + trip.dates : '');
  const a = String(days[0].date).split(' ');
  const b = String(days[days.length - 1].date).split(' ');
  const span = a[0] === b[0] && a[1] && b[1]
    ? `${a[0]} ${a[1]}–${b[1]}`
    : `${days[0].date} – ${days[days.length - 1].date}`;
  return `${trip.place} — ${span}${year ? ', ' + year : ''}`;
}

function metaDescription(trip) {
  // The eyebrow leads with the wilderness name, which is sometimes also the
  // place — drop the repeat rather than saying it twice.
  const place = String(trip.place || '');
  const where = String(trip.eyebrow || '')
    .split(' · ')
    .filter((part) => part.toLowerCase() !== place.toLowerCase())
    .join(', ');
  return `Backpacking trip brief: ${place}${where ? ', ' + where : ''}, ${trip.dates}.`;
}

// ---------------------------------------------------------------------------
// Elevation profile SVG
// ---------------------------------------------------------------------------

function profileSvg(trip, ctx) {
  const p = need(trip, 'profile', ctx);
  const pts = need(p, 'points', ctx + ' profile');
  if (pts.length < 2) fail(`${ctx}: profile.points needs at least 2 points`);

  const X0 = 96, X1 = 740, YB = 248, YT = 80;
  const pxMile = (X1 - X0) / need(p, 'x_max', ctx + ' profile');
  const pxFt = (YB - YT) / (need(p, 'y_max', ctx + ' profile') - need(p, 'y_min', ctx + ' profile'));
  const X = (m) => Math.round(X0 + m * pxMile);
  const Y = (ft) => Math.round(YB - (ft - p.y_min) * pxFt);

  const first = pts[0];
  const last = pts[pts.length - 1];
  const aria = `Elevation profile: ${comma(first.elev)} feet at mile ${first.mile} to ${comma(last.elev)} feet at mile ${last.mile}`;

  const grid = [];
  const axisText = [];
  for (let ft = p.y_min; ft <= p.y_max; ft += 1000) {
    const y = Y(ft);
    const dash = ft === p.y_min ? '' : ' stroke-dasharray="2 4"';
    grid.push(`  <line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${C.rule}"${dash}/>`);
    axisText.push(`    <text x="${X0 - 10}" y="${y + 4}" text-anchor="end">${comma(ft)}</text>`);
  }
  const step = p.x_max <= 12 ? 2 : 5;
  for (let m = 0; m <= p.x_max; m += step) {
    axisText.push(`    <text x="${X(m)}" y="270" text-anchor="middle">${m}</text>`);
  }
  axisText.push(`    <text x="${Math.round((X0 + X1) / 2)}" y="291" text-anchor="middle" letter-spacing="1.4" fill="${C.contour}">MILES FROM TRAILHEAD</text>`);

  const line = pts.map((pt) => `${X(pt.mile)} ${Y(pt.elev)}`).join(' L');
  const area = `M${line} L${X(last.mile)} ${YB} L${X(first.mile)} ${YB} Z`;

  const radius = (pt) => (pt === last ? 6 : pt.emphasis ? 5.5 : 4.5);
  const dots = pts
    .filter((pt) => pt.label)
    .map((pt) => `    <circle cx="${X(pt.mile)}" cy="${Y(pt.elev)}" r="${radius(pt)}"/>`);

  // Label placement: first point sits above its dot, the last is right-aligned
  // above the line's end, plain mid labels drop below-right of their dot, and
  // emphasised mid labels stack above the previous label to stay clear of the
  // rising line.
  const labels = [];
  let prev = null;
  for (const pt of pts) {
    if (!pt.label) continue;
    const px = X(pt.mile), py = Y(pt.elev);
    let x, y, attrs = '';
    if (pt === first) { x = px; y = py - 13; }
    else if (pt === last) { x = px; y = py - 20; attrs += ' text-anchor="end"'; }
    else if (pt.emphasis && prev) { x = prev.x; y = prev.y - 22; }
    else { x = px + 16; y = py + 41; }
    attrs += pt.emphasis ? ' font-weight="600"' : ` font-size="12" fill="${C.muted}"`;
    labels.push(`    <text x="${x}" y="${y}"${attrs}>${esc(pt.label)}</text>`);
    prev = { x, y };
  }

  return `<svg viewBox="0 0 780 300" role="img" aria-label="${escAttr(aria)}">
  <title>Elevation profile</title>
${grid.join('\n')}
  <g font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11" fill="${C.muted}">
${axisText.join('\n')}
  </g>
  <path d="${area}" fill="${C.forest}" opacity="0.1"/>
  <path d="M${line}" fill="none" stroke="${C.route}" stroke-width="2.5" stroke-linejoin="round"/>
  <g fill="${C.route}" stroke="${C.paper2}" stroke-width="2">
${dots.join('\n')}
  </g>
  <g font-family="system-ui, sans-serif" font-size="13" fill="${C.ink}">
${labels.join('\n')}
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Static plan-view SVG
// ---------------------------------------------------------------------------

function planSvg(trip, ctx) {
  const wps = need(need(trip, 'map', ctx), 'waypoints', ctx + ' map').filter((w) => w.diagram_label);
  if (wps.length < 2) fail(`${ctx}: at least two waypoints need a "diagram_label" to draw the static diagram`);

  const located = wps.filter((w) => w.lat != null);
  if (located.length < 2) fail(`${ctx}: at least two diagram waypoints need real coordinates`);

  // Marker labels are drawn to the right of their dot, so the route itself gets
  // the left ~180px and labels take the rest.
  const W = 340, H = 440, TOP = 68, BOTTOM = 82, LEFT_X = 18, RIGHT_X = 198;
  const lats = located.map((w) => w.lat);
  const lons = located.map((w) => w.lon);
  const latMax = Math.max(...lats), latMin = Math.min(...lats);
  const lonMax = Math.max(...lons), lonMin = Math.min(...lons);
  const boxH = H - TOP - BOTTOM;
  const boxW = RIGHT_X - LEFT_X;
  // Equirectangular projection, equal scale on both axes: longitude is
  // compressed by cos(mid-latitude), then the route is scaled to whichever
  // axis runs out of room first and centred in the panel. A wide route (a
  // loop) is width-limited; a long corridor is height-limited.
  const cosF = Math.cos(((latMax + latMin) / 2) * Math.PI / 180);
  const latSpan = latMax - latMin;
  const lonSpan = (lonMax - lonMin) * cosF;
  const sLat = latSpan > 0 ? boxH / latSpan : Infinity;
  const sLon = lonSpan > 0 ? boxW / lonSpan : Infinity;
  const s = Math.min(sLat, sLon);
  if (!isFinite(s)) fail(`${ctx}: diagram waypoints are all at one point — cannot draw the plan view`);
  const originX = LEFT_X + (boxW - lonSpan * s) / 2;
  const originY = TOP + (boxH - latSpan * s) / 2;

  const pos = wps.map((w) =>
    w.lat != null
      ? { x: originX + (w.lon - lonMin) * cosF * s, y: originY + (latMax - w.lat) * s }
      : null
  );
  // Waypoints without a coordinate (dispersed camps) are interpolated along
  // the corridor by trail mile between their located neighbours.
  wps.forEach((w, i) => {
    if (pos[i]) return;
    let a = i - 1; while (a >= 0 && !pos[a]) a--;
    let b = i + 1; while (b < wps.length && !pos[b]) b++;
    if (a < 0 || b >= wps.length) fail(`${ctx}: waypoint "${w.name}" has no coordinates and no located neighbours to interpolate between`);
    if (w.mile == null || wps[a].mile == null || wps[b].mile == null) {
      fail(`${ctx}: waypoint "${w.name}" has lat null, so it and its neighbours need "mile" for interpolation`);
    }
    const f = (w.mile - wps[a].mile) / (wps[b].mile - wps[a].mile);
    pos[i] = { x: pos[a].x + f * (pos[b].x - pos[a].x), y: pos[a].y + f * (pos[b].y - pos[a].y) };
  });

  const P = pos.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) }));
  const last = P.length - 1;
  // A loop repeats its first waypoint at the end so the corridor closes. That
  // trailing point draws the line but not a second marker or a label on top of
  // the first one's.
  const closesLoop = P.length > 2 && P[0].x === P[last].x && P[0].y === P[last].y;
  const drawn = (i) => !(closesLoop && i === last);
  const radius = (i) => (i === 0 ? 6 : i === last && !closesLoop ? 7 : 5);

  const corridor = P.map((pt) => `${pt.x},${pt.y}`).join(' ');

  const circles = wps.map((w, i) => {
    if (!drawn(i)) return null;
    const r = radius(i);
    return w.kind === 'approximate'
      ? `      <circle cx="${P[i].x}" cy="${P[i].y}" r="${r}" fill="${C.paper2}" stroke="${C.route}" stroke-width="2"/>`
      : `      <circle cx="${P[i].x}" cy="${P[i].y}" r="${r}" fill="${i === 0 ? C.forest : C.water}" stroke="${C.paper2}" stroke-width="2"/>`;
  }).filter(Boolean);

  const labels = wps.map((w, i) => {
    if (!drawn(i)) return null;
    const x = P[i].x + radius(i) + 6;
    const y = P[i].y;
    let l2 = w.diagram_label[1] || '';
    if (w.kind === 'approximate') l2 += ' · approx.';
    const out = [`        <text x="${x}" y="${y - 3}" font-size="12.5" font-weight="600">${esc(w.diagram_label[0])}</text>`];
    if (l2) out.push(`        <text x="${x}" y="${y + 11}" font-size="11" fill="${C.muted}">${esc(l2)}</text>`);
    return out.join('\n');
  }).filter(Boolean);

  // Scale bar: the largest round mile figure that stays well inside the panel,
  // sized off whichever axis the route actually spans.
  const spanMiles = Math.max(latSpan, lonSpan) * MILES_PER_DEG_LAT;
  let barMiles = 1;
  for (const n of [1, 2, 5, 10, 20, 50]) if (n <= spanMiles / 2.5) barMiles = n;
  const barPx = Math.round((barMiles / MILES_PER_DEG_LAT) * s);
  const bx0 = 30, bx1 = bx0 + barPx, bmid = Math.round(bx0 + barPx / 2), by = H - 35;
  const barLabel = barMiles === 1 ? '1 MILE' : `${barMiles} MILES`;

  const aria = `Plan-view diagram, drawn to scale: ${wps[0].diagram_label[0]} to ${wps[wps.length - 1].diagram_label[0]}, connected by straight corridor lines, not the trail alignment`;

  return `    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(aria)}">
      <title>Route waypoints</title>
      <g stroke="${C.forest}" stroke-width="1.4" fill="none">
        <line x1="40" y1="86" x2="40" y2="60"/>
      </g>
      <polygon points="40,54 36,64 44,64" fill="${C.forest}"/>
      <text x="40" y="100" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="11" fill="${C.forest}">N</text>

      <polyline points="${corridor}" fill="none" stroke="${C.route}"
        stroke-width="2" stroke-dasharray="6 5" stroke-linejoin="round"/>

${circles.join('\n')}

      <g font-family="system-ui, sans-serif" fill="${C.ink}">
${labels.join('\n\n')}
      </g>

      <g stroke="${C.muted}" stroke-width="1.2">
        <line x1="${bx0}" y1="${by}" x2="${bx1}" y2="${by}"/>
        <line x1="${bx0}" y1="${by - 5}" x2="${bx0}" y2="${by + 5}"/>
        <line x1="${bmid}" y1="${by - 3}" x2="${bmid}" y2="${by + 3}"/>
        <line x1="${bx1}" y1="${by - 5}" x2="${bx1}" y2="${by + 5}"/>
      </g>
      <text x="${bmid}" y="${by + 19}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace"
        font-size="10.5" letter-spacing="0.8" fill="${C.muted}">${barLabel}</text>
    </svg>`;
}

// ---------------------------------------------------------------------------
// Body sections
// ---------------------------------------------------------------------------

function factsHtml(facts) {
  return facts
    .map((f) => `  <div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`)
    .join('\n');
}

function daysHtml(days) {
  return days
    .map((d) => {
      const inner = [`    <h3>${esc(d.title)}</h3>`];
      if (d.log && d.log.length) {
        inner.push('    <div class="log">');
        for (const [t, text] of d.log) inner.push(`      <div><span>${esc(t)}</span><p>${text}</p></div>`);
        inner.push('    </div>');
      }
      for (const n of d.notes || []) inner.push(`    <p>${n}</p>`);
      return `<div class="day">
  <div><p class="daymark">${esc(d.n)}</p><p class="daydate">${esc(d.dow)}<br>${esc(d.date)}</p></div>
  <div>
${inner.join('\n')}
  </div>
</div>`;
    })
    .join('\n\n');
}

function legsHtml(legs) {
  return legs
    .map((l) => {
      const parts = ['  <li>', `    <em>${esc(l.meta)}</em>`, `    <strong>${esc(l.title)}</strong>`, `    ${l.body}`];
      if (l.photo) {
        const f = commonsFile(l.photo.commons);
        const page = `https://commons.wikimedia.org/wiki/File:${f}`;
        parts.push(`    <figure>
      <a href="${page}"><img src="https://commons.wikimedia.org/wiki/Special:FilePath/${f}?width=900" alt="${escAttr(l.photo.caption)}" loading="lazy"
        onerror="var f=this.closest('figure'); if(f) f.style.display='none';"></a>
      <figcaption>${esc(l.photo.caption)} · ${esc(l.photo.credit)}, via <a href="${page}">Wikimedia Commons</a></figcaption>
    </figure>`);
      }
      parts.push('  </li>');
      return parts.join('\n');
    })
    .join('\n');
}

// A loop repeats its first waypoint to close the diagram corridor; it should
// not show up twice in the table or as two stacked map markers.
function dedupeByCoord(wps) {
  const seen = new Set();
  return wps.filter((w) => {
    if (w.lat == null) return true;
    const key = `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function waypointRows(wps) {
  return dedupeByCoord(wps)
    .filter((w) => w.lat != null)
    .map((w) => `      <tr><td>${esc(w.name)}</td><td class="n">${coordFmt(w.lat)}, ${coordFmt(w.lon)}</td></tr>`)
    .join('\n');
}

function drivePara(m) {
  const wps = m.waypoints || [];
  const origin = wps.find((w) => w.kind === 'transport' && w.lat != null);
  const dest = wps.find((w) => w.kind !== 'transport' && w.lat != null);
  let html = m.drive_note || '';
  if (origin && dest) {
    html += ` <a href="https://www.google.com/maps/dir/?api=1&amp;origin=${origin.lat},${origin.lon}&amp;destination=${dest.lat},${dest.lon}">Airport to trailhead on Google Maps.</a>`;
  }
  return html;
}

function costRowsHtml(costs, ctx) {
  const rows = need(costs, 'rows', ctx);
  const party = need(costs, 'party_size', ctx);
  let total = 0;
  const out = rows.map((r) => {
    total += need(r, 'pp', `${ctx} cost row "${r.item}"`);
    const note = r.note ? `<small>${r.note}</small>` : '';
    return `    <tr data-status="${escAttr(r.status || 'estimated')}"><td>${esc(r.item)}${note}</td><td class="n">$${comma(r.pp)}</td></tr>`;
  });
  const totalLabel = party === 1 ? 'Total' : 'Total, each';
  const totalNote = party === 1 ? 'Traveling solo — nothing splits.' : `About $${comma(total * party)} for the ${numWord(party)} of us.`;
  out.push(
    `    <tr class="total"><td>${totalLabel}<small style="font-weight:400">${totalNote}</small></td><td class="n">~$${comma(total)}</td></tr>`
  );
  return out.join('\n');
}

function weatherRowsHtml(rows) {
  return rows
    .map((r) => `    <tr><td>${esc(r.label)}</td><td class="n">${esc(r.value)}</td></tr>`)
    .join('\n');
}

function beforeColsHtml(items) {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)]
    .filter((col) => col.length)
    .map((col) => {
      const inner = col.map((it) => `    <h3>${esc(it.h)}</h3>\n    <p>${it.p}</p>`).join('\n');
      return `  <div>\n${inner}\n  </div>`;
    })
    .join('\n');
}

// Site nav. Both links land on the index, which carries a group per page type —
// `prefix` is the hop back up to docs/ and depends on how deep the page sits.
// The Gear link is omitted entirely when there are no gear pages, rather than
// pointing at an anchor that isn't there.
function navHtml(active, prefix, hasGear) {
  const items = [{ key: 'plans', label: 'Plans' }];
  if (hasGear) items.push({ key: 'gear', label: 'Gear' });
  return items
    .map((i) => {
      const current = i.key === active ? ' aria-current="page"' : '';
      return `  <a href="${escAttr(prefix + '#' + i.key)}"${current}>${esc(i.label)}</a>`;
    })
    .join('\n');
}

function footerHtml(f, researched) {
  const lines = (f.lines || []).slice();
  if (researched) lines.push(`Researched ${researched}`);
  let out = lines.map((l) => `  ${esc(l)}<br>`).join('\n');
  const qs = f.open_questions || [];
  if (qs.length === 1) {
    out += `\n  <br>\n  One open item: ${esc(qs[0])}`;
  } else if (qs.length > 1) {
    out += `\n  <br>\n  Open items:<br>\n` + qs.map((q, i) => `  ${String(i + 1).padStart(2, '0')} — ${esc(q)}`).join('<br>\n');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gear pages
// ---------------------------------------------------------------------------

// Every figure on a gear page is derived from the items. `subtotal_oz` and
// `subtotal_usd` in the JSON are checksums against the source spreadsheet — they
// are asserted here and never displayed, so the page cannot disagree with itself.
function kitMetrics(kit, ctx) {
  let carried = 0, worn = 0, food = 0, water = 0, fuel = 0, containers = 0;
  let spend = 0, bigOz = 0, bigUsd = 0, items = 0;

  for (const cat of need(kit, 'categories', ctx)) {
    const name = need(cat, 'name', ctx);
    const where = `${ctx} kit "${kit.id}" category "${name}"`;
    const oz = need(cat, 'items', where).reduce((s, it) => s + need(it, 'oz', where), 0);
    const usd = cat.items.reduce((s, it) => s + (it.usd || 0), 0);

    if (cat.subtotal_oz != null && Math.abs(oz - cat.subtotal_oz) > 0.005) {
      fail(`${where}: items sum to ${oz.toFixed(2)} oz but subtotal_oz says ${cat.subtotal_oz}. ` +
        'Fix the item weights or the checksum — the page renders the derived figure either way.');
    }
    if (cat.subtotal_usd != null && usd !== cat.subtotal_usd) {
      fail(`${where}: items sum to $${usd} but subtotal_usd says $${cat.subtotal_usd}.`);
    }

    items += cat.items.length;
    // Worn clothing never counts toward pack weight.
    if (cat.worn) { worn += oz; continue; }
    carried += oz;
    spend += usd;
    if (cat.big_three) { bigOz += oz; bigUsd += usd; }

    for (const it of cat.items) {
      if (it.consumable === 'food') food += it.oz;
      else if (it.consumable === 'water') water += it.oz;
      else if (it.consumable === 'fuel') fuel += it.oz;
      if (it.container) containers += it.oz;
    }
  }

  const base = carried - food - water - fuel;
  return {
    base_lb: base / OZ_PER_LB,
    carried_lb: carried / OZ_PER_LB,
    carried_worn_lb: (carried + worn) / OZ_PER_LB,
    pack_no_water_lb: (carried - water) / OZ_PER_LB,
    worn_lb: worn / OZ_PER_LB,
    // Base weight the way the source spreadsheet computes it: also minus the
    // food bag's containers. Lower than base_lb by exactly their weight.
    sheet_base_lb: (base - containers) / OZ_PER_LB,
    spend_usd: spend,
    big_three_usd_pct: spend ? Math.round((bigUsd / spend) * 100) : null,
    big_three_oz_pct: carried ? Math.round((bigOz / carried) * 100) : null,
    items,
  };
}

// A `metric` name in the JSON resolves to a computed figure. The suffix picks
// the format, so a new metric needs no formatting code.
function metricText(metrics, name, ctx) {
  if (!(name in metrics)) {
    fail(`${ctx}: unknown metric "${name}" — available: ${Object.keys(metrics).join(', ')}`);
  }
  const v = metrics[name];
  if (v == null) fail(`${ctx}: metric "${name}" is not computable for this kit`);
  if (name.endsWith('_lb')) return v.toFixed(2);
  if (name.endsWith('_usd')) return '$' + comma(v);
  if (name.endsWith('_pct')) return v + '%';
  return comma(v);
}

function statsHtml(gear, metrics, ctx) {
  return need(gear, 'stats', ctx)
    .map((s) => {
      const value = metricText(metrics, need(s, 'metric', ctx + ' stat'), ctx + ` stat "${s.label}"`);
      const unit = s.unit ? `<small>${esc(s.unit)}</small>` : '';
      return `  <div class="fact"><dt>${esc(s.label)}</dt><dd>${value}${unit}</dd></div>`;
    })
    .join('\n');
}

// Notes hang below the strip rather than inside a cell — one long note in a
// four-column grid stretches every sibling cell to match it.
function statNotesHtml(gear) {
  return gear.stats
    .filter((s) => s.note)
    .map((s) => `<p class="caveat"><strong>${esc(s.label)}:</strong> ${s.note}</p>`)
    .join('\n');
}

// Collapse categories into ridgeline peaks. Affects the diagram only — the
// tables below stay granular.
function ridgeData(gear, kit, ctx) {
  const r = gear.ridgeline || {};
  const labels = r.labels || {};
  const merges = r.merge || [];

  const known = new Set(kit.categories.filter((c) => !c.worn).map((c) => c.name));
  const mergedInto = new Map();
  for (const m of merges) {
    for (const name of need(m, 'categories', ctx + ' ridgeline.merge')) {
      if (!known.has(name)) {
        fail(`${ctx}: ridgeline.merge references category "${name}", which is not a ` +
          `non-worn category of kit "${kit.id}". A typo here silently redraws the diagram.`);
      }
      mergedInto.set(name, need(m, 'label', ctx + ' ridgeline.merge'));
    }
  }
  for (const name of Object.keys(labels)) {
    if (!known.has(name)) {
      fail(`${ctx}: ridgeline.labels references unknown category "${name}"`);
    }
  }

  const acc = new Map();
  for (const cat of kit.categories) {
    if (cat.worn) continue;
    const label = mergedInto.get(cat.name) || labels[cat.name] || cat.name;
    const oz = cat.items.reduce((s, it) => s + it.oz, 0);
    acc.set(label, (acc.get(label) || 0) + oz);
  }
  return [...acc].map(([n, oz]) => ({ n, oz })).sort((a, b) => b.oz - a.oz);
}

function ridgeSvg(gear, kit, metrics, ctx) {
  const data = ridgeData(gear, kit, ctx);
  if (data.length < 2) fail(`${ctx}: the ridgeline needs at least two categories`);

  const W = 1000, H = 360, BASE = 248, padL = 10, padR = 10, maxH = 186;
  const total = data.reduce((s, d) => s + d.oz, 0);
  const maxOz = data[0].oz;
  const usable = W - padL - padR;
  const n2 = (v) => Math.round(v * 100) / 100;

  // Arrange so the profile rises to a summit and falls away, like a real ridge,
  // instead of reading as a sorted bar chart.
  const rest = data.slice(1);
  const left = rest.filter((_, i) => i % 2 === 1).reverse();
  const right = rest.filter((_, i) => i % 2 === 0);
  const order = [...left, data[0], ...right];

  let x = padL;
  const peaks = order.map((d) => {
    const w = (d.oz / total) * usable;
    const h = (d.oz / maxOz) * maxH;
    const p = { ...d, x0: x, x1: x + w, cx: x + w / 2, top: BASE - h, h, w };
    x += w;
    return p;
  });

  let outline = `M ${padL} ${BASE}`;
  peaks.forEach((p, i) => {
    const prevV = i === 0 ? BASE : BASE - Math.min(peaks[i - 1].h, p.h) * 0.26;
    outline += ` Q ${n2(p.x0 + (p.cx - p.x0) * 0.40)} ${n2(prevV - p.h * 0.34)} ${n2(p.cx)} ${n2(p.top)}`;
    const nextV = i === peaks.length - 1 ? BASE : BASE - Math.min(peaks[i + 1].h, p.h) * 0.26;
    outline += ` Q ${n2(p.cx + (p.x1 - p.cx) * 0.60)} ${n2(nextV - p.h * 0.34)} ${n2(p.x1)} ${n2(nextV)}`;
  });
  outline += ` L ${W - padR} ${BASE} Z`;

  // Contour interval, one pound, clipped to the silhouette.
  const contours = [];
  for (let lb = 1; lb * OZ_PER_LB <= maxOz + OZ_PER_LB; lb++) {
    const y = n2(BASE - ((lb * OZ_PER_LB) / maxOz) * maxH);
    contours.push(`    <line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.contour}" stroke-width="1" stroke-dasharray="2 5" opacity="0.32"/>`);
  }

  // Two staggered rows so narrow peaks can't collide.
  const ROW = [BASE + 21, BASE + 41];
  const values = [];
  const axis = [];
  peaks.forEach((p, i) => {
    if (p.w > 46) {
      values.push(`    <text x="${n2(p.cx)}" y="${n2(p.top - 11)}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.ink}">${(p.oz / OZ_PER_LB).toFixed(2)}</text>`);
    }
    const row = ROW[i % 2];
    axis.push(`    <line x1="${n2(p.cx)}" y1="${BASE + 3}" x2="${n2(p.cx)}" y2="${row - 11}" stroke="${C.rule}" stroke-width="1"/>
    <text x="${n2(p.cx)}" y="${row}" text-anchor="middle" font-size="10" letter-spacing="0.8" fill="${C.muted}">${esc(p.n.toUpperCase())}</text>
    <text x="${n2(p.cx)}" y="${row + 13}" text-anchor="middle" font-size="9.5" fill="${C.muted}">${Math.round((p.oz / total) * 100)}%</text>`);
  });

  const totalLabel = (gear.ridgeline && gear.ridgeline.total_label) || 'Total carried';
  const aria = `Ridgeline diagram of pack weight by category, heaviest to lightest: ` +
    data.map((d) => `${d.n} ${(d.oz / OZ_PER_LB).toFixed(2)} pounds`).join(', ') +
    `. Total ${metrics.carried_lb.toFixed(2)} pounds.`;

  return `  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(aria)}">
    <title>Pack weight by category</title>
    <defs><clipPath id="ridgeClip"><path d="${outline}"/></clipPath></defs>
    <g clip-path="url(#ridgeClip)">
      <path d="${outline}" fill="${C.paper}"/>
${contours.join('\n')}
    </g>
    <path d="${outline}" fill="none" stroke="${C.route}" stroke-width="2" stroke-linejoin="round"/>
    <line x1="${padL}" y1="${BASE}" x2="${W - padR}" y2="${BASE}" stroke="${C.ink}" stroke-width="1.5"/>
    <g font-family="ui-monospace, Menlo, Consolas, monospace" font-variant-numeric="tabular-nums">
${values.join('\n')}
${axis.join('\n')}
      <text x="${padL}" y="${H - 6}" font-size="11" fill="${C.muted}">${esc(totalLabel)} — ${metrics.carried_lb.toFixed(2)} lb</text>
    </g>
  </svg>`;
}

function talliesHtml(kit, metrics, ctx) {
  return `  <dl class="tallies">
${need(kit, 'tallies', ctx)
    .map((t) => {
      const value = metricText(metrics, need(t, 'metric', ctx + ' tally'), ctx + ` tally "${t.label}"`);
      const unit = t.unit ? `<small>${esc(t.unit)}</small>` : '';
      return `    <div><dt>${esc(t.label)}</dt><dd>${value}${unit}</dd></div>`;
    })
    .join('\n')}
  </dl>`;
}

function kitPanelHtml(kit, metrics, ctx) {
  const priced = !!kit.priced;
  // The unpriced kit tracks a running total the way the source spreadsheet does.
  let cum = 0;
  const anyConsumable = kit.categories.some((c) => !c.worn && c.items.some((it) => it.consumable));

  const cats = kit.categories.map((cat, i) => {
    const oz = cat.items.reduce((s, it) => s + it.oz, 0);
    const usd = cat.items.reduce((s, it) => s + (it.usd || 0), 0);
    const sub = priced
      ? `${(oz / OZ_PER_LB).toFixed(2)} lb · $${comma(usd)}`
      : `${oz.toFixed(2)} oz · ${(oz / OZ_PER_LB).toFixed(2)} lb`;

    const lastHead = priced ? 'Price' : cat.worn ? '—' : 'Cumulative';
    const rows = cat.items.map((it) => {
      if (!cat.worn) cum += it.oz;
      const detail = it.detail ? `<span class="detail">${esc(it.detail)}</span>` : '';
      const con = it.consumable ? `<span class="con">${esc(it.consumable)}</span>` : '';
      const lastCell = priced
        ? `<td class="n usd">$${comma(it.usd || 0)}</td>`
        : `<td class="n cum hide-sm">${cat.worn ? '—' : (cum / OZ_PER_LB).toFixed(2)}</td>`;
      return `      <tr><td><strong>${esc(it.name)}</strong>${con}${detail}</td>
        <td class="n">${it.oz.toFixed(2)}</td>
        <td class="n hide-sm">${(it.oz / OZ_PER_LB).toFixed(2)}</td>
        ${lastCell}</tr>`;
    });

    return `  <div class="cat">
    <div class="cat-head">
      <span class="idx">${String(i + 1).padStart(2, '0')}</span>
      <h4>${esc(cat.name)}</h4>
      <span class="sub">${sub}</span>
    </div>
${cat.note ? `    <p class="cat-note">${cat.note}</p>\n` : ''}    <table>
      <thead><tr><th>Item</th><th class="n">oz</th><th class="n hide-sm">lb</th><th class="n${priced ? '' : ' hide-sm'}">${esc(lastHead)}</th></tr></thead>
      <tbody>
${rows.join('\n')}
      </tbody>
    </table>
  </div>`;
  });

  const legend = anyConsumable
    ? '\n    <p class="legend">Rows tagged food, water or fuel are consumed on trail and do not count toward base weight.</p>'
    : '';

  return `<div class="panel" id="p-${escAttr(kit.id)}">
  <div class="panel-intro">
    <div>
      <h3>${esc(need(kit, 'heading', ctx))}</h3>
      <p>${need(kit, 'blurb', ctx)}</p>${legend}
    </div>
${talliesHtml(kit, metrics, ctx)}
  </div>
${cats.join('\n')}
</div>`;
}

// The kit switcher is four radio inputs and four labels: no JavaScript, so it
// still works on a phone with no signal and a blocked script.
function kitTabsHtml(kits, allMetrics) {
  return kits
    .map((k, i) => {
      const m = allMetrics[i];
      const sub = k.priced
        ? '$' + comma(m.spend_usd)
        : m.base_lb.toFixed(2) + ' lb base';
      return `  <label for="k-${escAttr(k.id)}">${esc(k.label)}<span>${esc(sub)}</span></label>`;
    })
    .join('\n');
}

// autocomplete="off" matters here: browsers restore radio state across reloads,
// which would reopen the page on whichever starter kit was last viewed instead
// of the real, carried one.
function kitInputsHtml(kits) {
  return kits
    .map(
      (k, i) =>
        `<input class="kitin" type="radio" name="kit" autocomplete="off" id="k-${escAttr(k.id)}"${i === 0 ? ' checked' : ''}>`
    )
    .join('\n');
}

// Per-kit selectors have to be generated, since the template can't know the ids.
function kitCssHtml(kits) {
  return kits
    .map((k) => {
      const id = k.id;
      return `  #k-${id}:checked ~ #panels #p-${id}{display:block}
  #k-${id}:checked ~ .tabs label[for="k-${id}"]{background:var(--forest);color:var(--paper-2)}
  #k-${id}:checked ~ .tabs label[for="k-${id}"] span{color:var(--paper-2);opacity:.75}
  #k-${id}:focus-visible ~ .tabs label[for="k-${id}"]{outline:3px solid var(--water);outline-offset:-3px}`;
    })
    .join('\n');
}

function primerHtml(cards, ctx) {
  return cards
    .map((c) => {
      const paras = need(c, 'p', ctx + ' primer card').map((p) => `    <p>${p}</p>`).join('\n');
      return `  <article>
    <h4>${esc(need(c, 'h', ctx + ' primer card'))}</h4>
${paras}
  </article>`;
    })
    .join('\n');
}

function gearTitleTag(gear) {
  return `${gear.title.join(' ')} — ${gear.trip.wilderness}`;
}

function gearMetaDescription(gear, metrics) {
  const t = gear.trip;
  return `Backpacking gear list for ${t.wilderness}, ${t.state} — ${numWord(t.nights)} nights in ` +
    `${t.season}. A field-tested kit at ${metrics.base_lb.toFixed(2)} lb base weight, item by item, ` +
    `plus three starter kits at three budgets.`;
}

function renderGear(template, gear, ctx) {
  for (const key of ['eyebrow', 'title', 'lede', 'trip', 'stats', 'sections', 'kits', 'primer', 'regulations', 'footer']) {
    need(gear, key, ctx);
  }
  const kits = gear.kits;
  if (!kits.length) fail(`${ctx}: needs at least one kit`);

  const allMetrics = kits.map((k) => kitMetrics(k, ctx));
  // The hero stats describe the first kit — the real, carried one. The starter
  // kits are alternatives to it, not part of it.
  const heroMetrics = {
    ...allMetrics[0],
    field_items: allMetrics[0].items,
    all_items: allMetrics.reduce((s, m) => s + m.items, 0),
  };

  const sec = (name, key) => {
    const s = need(gear.sections, name, ctx + ' sections');
    return need(s, key, `${ctx} sections.${name}`);
  };

  const reg = gear.regulations;
  const values = {
    meta_description: escAttr(gearMetaDescription(gear, heroMetrics)),
    title_tag: esc(gearTitleTag(gear)),
    nav: navHtml('gear', '../../', true),
    eyebrow: esc(gear.eyebrow),
    eyebrow_2: esc(gear.eyebrow_2 || ''),
    // First line in forest, every line after it in the accent colour.
    title_h1: gear.title
      .map((line, i) => (i === 0 ? esc(line) : `<em>${esc(line)}</em>`))
      .join(''),
    lede: gear.lede,
    stats: statsHtml(gear, heroMetrics, ctx),
    stat_notes: statNotesHtml(gear),
    kit_css: kitCssHtml(kits),

    ridge_eyebrow: esc(sec('ridge', 'eyebrow')),
    ridge_heading: esc(sec('ridge', 'heading')),
    ridge_intro: sec('ridge', 'intro'),
    ridge_svg: ridgeSvg(gear, kits[0], allMetrics[0], ctx),
    ridge_caption: (gear.sections.ridge.caption || [])
      .map((c) => `    <span>${esc(c)}</span>`)
      .join('\n'),

    kits_eyebrow: esc(sec('kits', 'eyebrow')),
    kits_heading: esc(sec('kits', 'heading')),
    kits_intro: sec('kits', 'intro'),
    kit_inputs: kitInputsHtml(kits),
    kit_tabs: kitTabsHtml(kits, allMetrics),
    kit_panels: kits.map((k, i) => kitPanelHtml(k, allMetrics[i], ctx)).join('\n\n'),

    reg_title: esc(need(reg, 'title', ctx + ' regulations')),
    reg_intro: need(reg, 'intro', ctx + ' regulations'),
    reg_items: need(reg, 'points', ctx + ' regulations').map((p) => `    <li>${p}</li>`).join('\n'),
    reg_outro: need(reg, 'outro', ctx + ' regulations'),

    primer_eyebrow: esc(sec('primer', 'eyebrow')),
    primer_heading: esc(sec('primer', 'heading')),
    primer_intro: sec('primer', 'intro'),
    primer_cards: primerHtml(gear.primer, ctx),

    footer_html: footerHtml(gear.footer, gear.researched),
  };

  return template.replace(/\{\{([a-z0-9_]+)\}\}/g, (m, key) => {
    if (!(key in values)) fail(`template/gear.html references unknown placeholder {{${key}}}`);
    return values[key];
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function render(template, trip, ctx, hasGear) {
  for (const key of ['place', 'eyebrow', 'title', 'dates', 'thesis', 'facts', 'profile', 'why', 'days', 'map', 'route', 'costs', 'hazard', 'weather', 'before', 'booking', 'footer']) {
    need(trip, key, ctx);
  }

  const wps = need(trip.map, 'waypoints', ctx + ' map');
  const liveWps = dedupeByCoord(wps)
    .filter((w) => w.lat != null)
    .map((w) => ({
      ll: [w.lat, w.lon],
      name: w.name,
      popup: w.popup || '',
      hike: w.kind !== 'transport' && w.in_hike_bounds !== false,
    }));

  const anyPhotos = trip.route.some((l) => l.photo);

  // The weather section's forecast link and live-fetch coordinate both come
  // from the first located trail waypoint (the trailhead), never authored.
  const trailWp = wps.find((w) => w.kind !== 'transport' && w.lat != null);
  if (!trailWp) fail(`${ctx}: no located trail waypoint to anchor the weather forecast to`);
  const wx = trip.weather;

  const values = {
    meta_description: escAttr(metaDescription(trip)),
    title_tag: esc(titleTag(trip)),
    nav: navHtml('plans', '../', hasGear),
    eyebrow: esc(trip.eyebrow),
    title_h1: trip.title.map(esc).join('<br>'),
    thesis: trip.thesis,
    profile_svg: profileSvg(trip, ctx),
    profile_note: trip.profile.note ? `<p class="vizsource">${esc(trip.profile.note)}</p>` : '',
    facts: factsHtml(trip.facts),
    why_paras: trip.why.map((p) => `<p>${p}</p>`).join('\n\n'),
    days: daysHtml(trip.days),
    route_intro: trip.map.intro || '',
    plan_svg: planSvg(trip, ctx),
    waypoint_rows: waypointRows(wps),
    drive_para: drivePara(trip.map),
    diagram_caveat: need(trip.map, 'caveat', ctx + ' map'),
    route_legs: legsHtml(trip.route),
    photo_license_note: anyPhotos
      ? '<p style="font-size:14.5px;color:var(--ink-2);margin-top:20px">Photographs are from Wikimedia Commons, which hosts only freely licensed or public-domain media. Each caption links to its file page — worth a look at the license there before reusing any of them anywhere public.</p>'
      : '',
    cost_rows: costRowsHtml(trip.costs, ctx),
    hazard_title: esc(need(trip.hazard, 'title', ctx + ' hazard')),
    hazard_intro: need(trip.hazard, 'intro', ctx + ' hazard'),
    hazard_items: need(trip.hazard, 'points', ctx + ' hazard').map((pt) => `    <li>${pt}</li>`).join('\n'),
    hazard_outro: need(trip.hazard, 'outro', ctx + ' hazard'),
    weather_intro: need(wx, 'intro', ctx + ' weather'),
    weather_rows: weatherRowsHtml(need(wx, 'rows', ctx + ' weather')),
    weather_source: esc(need(wx, 'source', ctx + ' weather')),
    nws_link: escAttr(`https://forecast.weather.gov/MapClick.php?lat=${trailWp.lat.toFixed(4)}&lon=${trailWp.lon.toFixed(4)}`),
    wx_point_js: jsLit([Number(trailWp.lat.toFixed(4)), Number(trailWp.lon.toFixed(4))]),
    before_cols: beforeColsHtml(trip.before),
    booking_legs: legsHtml(trip.booking),
    footer_html: footerHtml(trip.footer, trip.researched),
    map_waypoints_js: jsLit(liveWps),
    default_tiles_js: jsLit(trip.map.tiles || 'opentopomap'),
  };

  return template.replace(/\{\{([a-z0-9_]+)\}\}/g, (m, key) => {
    if (!(key in values)) fail(`template references unknown placeholder {{${key}}}`);
    return values[key];
  });
}

function indexHtml(trips, gearPages) {
  const listItem = (href, title, when, where) => `    <li><a href="${escAttr(href)}/">
      <strong>${esc(title)}</strong>
      <span class="when">${esc(when || '')}</span>
      <span class="where">${esc(where || '')}</span>
    </a></li>`;

  const items = trips
    .map(({ slug, trip }) => listItem(slug, trip.place, trip.dates, trip.eyebrow))
    .join('\n');

  // Gear lists get their own group rather than nesting under a trip: the
  // starter-kit half is meant to be shared on its own.
  const gearGroup = gearPages.length
    ? `
  <header class="group" id="gear">
    <p class="eyebrow">Gear lists</p>
  </header>
  <ul>
${gearPages
        .map(({ slug, gear }) =>
          listItem(
            `gear/${slug}`,
            gear.title.join(' '),
            [gear.trip && gear.trip.wilderness, gear.eyebrow_2].filter(Boolean).join(' · '),
            gear.eyebrow
          )
        )
        .join('\n')}
  </ul>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Hike plans</title>
<style>
  :root{
    --paper:#EDF0E8;--paper-2:#F6F7F3;--contour:#7A5B38;--forest:#2E5339;
    --rule:#C9CEC0;--ink:#23281F;--ink-2:#5A6152;
    --serif:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,serif;
    --sans:system-ui,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.65 var(--sans)}
  .sheet{max-width:820px;margin:0 auto;padding:0 24px 96px}
  header{padding:56px 0 0}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--contour);margin:0 0 18px}
  h1{font:700 clamp(42px,9vw,76px)/0.95 var(--serif);margin:0;letter-spacing:-.02em;color:var(--forest)}
  header.group{padding:56px 0 0}
  header.group .eyebrow{margin:0}
  ul{list-style:none;padding:0;margin:48px 0 0;border-top:1px solid var(--rule)}
  header.group + ul{margin-top:18px}
  .topnav{display:flex;gap:22px;padding:3px 0 8px;border-bottom:1px solid var(--rule)}
  .topnav a{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--ink-2);text-decoration:none;
    padding:13px 2px 5px;border-bottom:2px solid transparent}
  .topnav a:hover{color:var(--forest)}
  .topnav a[aria-current]{color:var(--forest);border-bottom-color:var(--forest)}
  .topnav + header{padding-top:34px}
  /* #plans is already at the top of the page — a margin larger than its offset
     means the jump doesn't scroll at all, so the nav stays visible. */
  #plans{scroll-margin-top:96px}
  #gear{scroll-margin-top:24px}
  li a{display:block;padding:22px 4px;border-bottom:1px solid var(--rule);text-decoration:none;color:var(--ink)}
  li a:hover{background:var(--paper-2)}
  li strong{display:block;font:600 24px/1.2 var(--serif);color:var(--forest)}
  .when{display:block;font-family:var(--mono);font-size:13px;color:var(--ink-2);margin-top:6px;font-variant-numeric:tabular-nums}
  .where{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--contour);margin-top:4px}
</style>
</head>
<body>
<div class="sheet">
  <nav class="topnav" aria-label="Sections">
${navHtml(null, '', gearPages.length > 0)}
  </nav>
  <header id="plans">
    <p class="eyebrow">Trip briefs</p>
    <h1>Hike<br>plans</h1>
  </header>
  <ul>
${items}
  </ul>${gearGroup}
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

// Either dir/<slug>/<inner>.json or a bare dir/<slug>.json, sorted by slug.
// The folder form lets research notes and GPX tracks live beside the data.
function discover(dir, label, inner) {
  const found = [];
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const p = path.join(dir, e.name, inner);
      if (fs.existsSync(p)) found.push({ slug: e.name, file: p, ctx: `${label}/${e.name}/${inner}` });
    } else if (e.name.endsWith('.json')) {
      found.push({
        slug: path.basename(e.name, '.json'),
        file: path.join(dir, e.name),
        ctx: `${label}/${e.name}`,
      });
    }
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

function readJson(file, ctx) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${ctx}: invalid JSON — ${e.message}`);
  }
}

function main() {
  let template;
  try {
    template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch {
    fail('template/brief.html not found');
  }

  const found = discover(TRIPS_DIR, 'trips', 'trip.json');
  if (!found.length) fail('no trips found — expected trips/<slug>/trip.json');

  // Gear lists are a sibling page type, not a section of a brief. Discovered
  // before anything renders, because the nav on every page needs to know
  // whether a Gear link has somewhere to point.
  const gearFound = discover(GEAR_DIR, 'gear', 'gear.json');
  const hasGear = gearFound.length > 0;

  const trips = [];
  for (const { slug, file, ctx } of found) {
    const trip = readJson(file, ctx);
    const html = render(template, trip, ctx, hasGear);
    const outDir = path.join(DOCS_DIR, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    console.log(`built docs/${slug}/index.html`);
    trips.push({ slug, trip });
  }

  const gearPages = [];
  if (hasGear) {
    let gearTemplate;
    try {
      gearTemplate = fs.readFileSync(GEAR_TEMPLATE_PATH, 'utf8');
    } catch {
      fail('template/gear.html not found, but gear/*.json exists');
    }
    for (const { slug, file, ctx } of gearFound) {
      const gear = readJson(file, ctx);
      const html = renderGear(gearTemplate, gear, ctx);
      const outDir = path.join(DOCS_DIR, 'gear', slug);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.html'), html);
      console.log(`built docs/gear/${slug}/index.html`);
      gearPages.push({ slug, gear });
    }
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), indexHtml(trips, gearPages));
  fs.writeFileSync(path.join(DOCS_DIR, '.nojekyll'), '');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  console.log(
    `built docs/index.html (${plural(trips.length, 'trip')}` +
      (gearPages.length ? `, ${plural(gearPages.length, 'gear list')}` : '') + ')'
  );
}

main();
