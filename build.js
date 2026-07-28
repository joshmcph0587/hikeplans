#!/usr/bin/env node
'use strict';

// Renders every trips/*.json through template/brief.html into
// docs/<slug>/index.html, and writes docs/index.html as an index of all
// trips. Zero dependencies, Node 18+.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TEMPLATE_PATH = path.join(ROOT, 'template', 'brief.html');
const TRIPS_DIR = path.join(ROOT, 'trips');
const DOCS_DIR = path.join(ROOT, 'docs');

// Design-system tokens, mirrored from the template stylesheet. SVG attributes
// can't use CSS variables when the SVG must also survive being viewed alone.
const C = {
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
  const where = String(trip.eyebrow || '').split(' · ').join(', ');
  return `Backpacking trip brief: ${trip.place}${where ? ', ' + where : ''}, ${trip.dates}.`;
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

  const W = 340, H = 440, TOP = 68, BOTTOM = 82, RIGHT_X = 198;
  const lats = located.map((w) => w.lat);
  const lons = located.map((w) => w.lon);
  const latMax = Math.max(...lats), latMin = Math.min(...lats);
  const lonMax = Math.max(...lons);
  // Equirectangular projection with equal scale on both axes: latitude spans
  // the panel's content height; longitude is compressed by cos(mid-latitude).
  const s = (H - TOP - BOTTOM) / (latMax - latMin);
  const cosF = Math.cos(((latMax + latMin) / 2) * Math.PI / 180);

  const pos = wps.map((w) =>
    w.lat != null
      ? { x: RIGHT_X - (lonMax - w.lon) * cosF * s, y: TOP + (latMax - w.lat) * s }
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
  const radius = (i) => (i === 0 ? 6 : i === wps.length - 1 ? 7 : 5);

  const corridor = P.map((pt) => `${pt.x},${pt.y}`).join(' ');

  const circles = wps.map((w, i) => {
    const r = radius(i);
    return w.kind === 'approximate'
      ? `      <circle cx="${P[i].x}" cy="${P[i].y}" r="${r}" fill="${C.paper2}" stroke="${C.route}" stroke-width="2"/>`
      : `      <circle cx="${P[i].x}" cy="${P[i].y}" r="${r}" fill="${i === 0 ? C.forest : C.water}" stroke="${C.paper2}" stroke-width="2"/>`;
  });

  const labels = wps.map((w, i) => {
    const x = P[i].x + radius(i) + 6;
    const y = P[i].y;
    let l2 = w.diagram_label[1] || '';
    if (w.kind === 'approximate') l2 += ' · approx.';
    const out = [`        <text x="${x}" y="${y - 3}" font-size="12.5" font-weight="600">${esc(w.diagram_label[0])}</text>`];
    if (l2) out.push(`        <text x="${x}" y="${y + 11}" font-size="11" fill="${C.muted}">${esc(l2)}</text>`);
    return out.join('\n');
  });

  // Scale bar: the largest round mile figure that stays well inside the panel.
  const spanMiles = (latMax - latMin) * MILES_PER_DEG_LAT;
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

function waypointRows(wps) {
  return wps
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
  out.push(
    `    <tr class="total"><td>Total, each<small style="font-weight:400">About $${comma(total * party)} for the ${numWord(party)} of us.</small></td><td class="n">~$${comma(total)}</td></tr>`
  );
  return out.join('\n');
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
// Assembly
// ---------------------------------------------------------------------------

function render(template, trip, ctx) {
  for (const key of ['place', 'eyebrow', 'title', 'dates', 'thesis', 'facts', 'profile', 'why', 'days', 'map', 'route', 'costs', 'hazard', 'before', 'booking', 'footer']) {
    need(trip, key, ctx);
  }

  const wps = need(trip.map, 'waypoints', ctx + ' map');
  const liveWps = wps
    .filter((w) => w.lat != null)
    .map((w) => ({
      ll: [w.lat, w.lon],
      name: w.name,
      popup: w.popup || '',
      hike: w.kind !== 'transport' && w.in_hike_bounds !== false,
    }));

  const anyPhotos = trip.route.some((l) => l.photo);

  const values = {
    meta_description: escAttr(metaDescription(trip)),
    title_tag: esc(titleTag(trip)),
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

function indexHtml(trips) {
  const items = trips
    .map(
      ({ slug, trip }) => `    <li><a href="${escAttr(slug)}/">
      <strong>${esc(trip.place)}</strong>
      <span class="when">${esc(trip.dates || '')}</span>
      <span class="where">${esc(trip.eyebrow || '')}</span>
    </a></li>`
    )
    .join('\n');
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
  ul{list-style:none;padding:0;margin:48px 0 0;border-top:1px solid var(--rule)}
  li a{display:block;padding:22px 4px;border-bottom:1px solid var(--rule);text-decoration:none;color:var(--ink)}
  li a:hover{background:var(--paper-2)}
  li strong{display:block;font:600 24px/1.2 var(--serif);color:var(--forest)}
  .when{display:block;font-family:var(--mono);font-size:13px;color:var(--ink-2);margin-top:6px;font-variant-numeric:tabular-nums}
  .where{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--contour);margin-top:4px}
</style>
</head>
<body>
<div class="sheet">
  <header>
    <p class="eyebrow">Trip briefs</p>
    <h1>Hike<br>plans</h1>
  </header>
  <ul>
${items}
  </ul>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

function main() {
  let template;
  try {
    template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch {
    fail('template/brief.html not found');
  }

  const files = fs.existsSync(TRIPS_DIR)
    ? fs.readdirSync(TRIPS_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];
  if (!files.length) fail('no trip files found in trips/');

  const trips = [];
  for (const file of files) {
    const ctx = 'trips/' + file;
    const slug = path.basename(file, '.json');
    let trip;
    try {
      trip = JSON.parse(fs.readFileSync(path.join(TRIPS_DIR, file), 'utf8'));
    } catch (e) {
      fail(`${ctx}: invalid JSON — ${e.message}`);
    }
    const html = render(template, trip, ctx);
    const outDir = path.join(DOCS_DIR, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    console.log(`built docs/${slug}/index.html`);
    trips.push({ slug, trip });
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), indexHtml(trips));
  fs.writeFileSync(path.join(DOCS_DIR, '.nojekyll'), '');
  console.log(`built docs/index.html (${trips.length} trip${trips.length === 1 ? '' : 's'})`);
}

main();
