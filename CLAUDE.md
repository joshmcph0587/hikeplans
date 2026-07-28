# hikeplans

Generates single-file HTML backpacking trip briefs. Each brief is a self-contained
page a group of friends can open on a phone, print, or read at a trailhead with no
signal. Published via GitHub Pages.

Reference implementation: `docs/spanish-peaks-2026-08/index.html`. That file is the
design target. When in doubt about layout, tone, or structure, match it.

## Layout

```javascript
CLAUDE.md                     this file
build.js                      zero-dependency renderer, Node 18+
template/brief.html           the HTML template
trips/<slug>/trip.json        one folder per trip; trip.json is the only thing the build reads
docs/                         build output; GitHub Pages serves from here
docs/index.html               generated index of all trips
docs/<slug>/index.html        generated brief
```

Build: `node build.js` regenerates everything in `docs/`. No npm install, no
dependencies, no framework. Keep it that way.

## Workflow for a new brief

The user gives a destination and dates, or a set of constraints. Do not skip
straight to writing the file.

1. **Research.** See the protocol below. This is most of the work.
2. **Author** `trips/<slug>/trip.json`. Slug format: `place-YYYY-MM`. Anything
   else that belongs to the trip — research notes, GPX tracks, source
   snapshots — lives in the same folder; the build ignores it.
3. **Build** with `node build.js` and read the output. Actually read it.
4. **Report** what you verified, what you estimated, and what you could not
   confirm. Every uncertainty goes in the brief itself, not just the chat.
5. **Commit.** One commit per brief. Message: `brief: <place>, <dates>`.

## Research protocol

Non-negotiable, in order. Each step has burned us before.

**Coordinates before geometry.** Get real coordinates for every waypoint from a
places or geocoding source. Never invent a coordinate, never interpolate one and
present it as surveyed. If a camp is dispersed, say so and mark it approximate —
dispersed camps have no coordinate because they have no fixed site.

**Cross-check distance.** Compute straight-line distance between consecutive
waypoints and compare against reported trail mileage. The ratio should land
between about 1.15 and 1.35 for normal trail. Outside that range, one of your
numbers is wrong — usually a coordinate belongs to a trail segment rather than
the named feature. This check caught a real error on the Spanish Peaks brief.

**Verify junctions.** For any route with trail junctions, name them explicitly with
mileage and the direction of turn. Getting this wrong puts people in the wrong
drainage. Find a trip report or forest-service description that states the
junctions; do not infer them from a map.

**Elevations from a source, not a guess.** If a trip report gives elevation gain to
a landmark, use it and derive the elevation. Mark derived figures with `~`.

**Current conditions.** Search for fire restrictions, closures, and drought or
snowpack status for the actual season. Cite the season, not evergreen advice.
Regional fire and closure status changes weekly — say when it was checked.

**Prices from a live source.** Flights, cars, and lodging get looked up, not
recalled. Aggregator teaser prices ("cheapest found in 7 days") are not fares for
the user's dates — never pass them off as such. Label everything estimated as
estimated.

**Land manager contact.** Get the ranger district phone number into the footer.

## Honesty rules

These matter more than the design. A brief that looks authoritative and is wrong
is worse than no brief.

- **Never draw a trail alignment you have not sourced.** Straight lines between
  real waypoints are fine *if labelled as such, on the graphic itself.* A plausible
  invented squiggle is not acceptable — people navigate off these.
- **Every visual states its provenance.** Real waypoints, approximate camps,
  volunteer-mapped trails: say which is which in the caption.
- **Distinguish confirmed from estimated in the cost table.** One column, explicit
  note per row. The user needs to know which numbers will move.
- **Photos must be freely licensed.** Wikimedia Commons, federal agency works, or
  explicit CC. Link every image to its source page. Do not hotlink photos from
  blogs, AllTrails, or Google Places into a file the user will distribute.
- **Surface what you could not verify.** If a source refused, timed out, or was
  ambiguous, put that in the brief where it's relevant. Do not silently omit it and
  do not imply you checked something you did not.
- **Correct prior errors out loud.** If research contradicts an earlier figure, say
  so plainly and fix it everywhere it appears. Grep for the stale number.

## Required elements

Every brief has all of these. Omitting one is a bug.

1. **Header** — place, dates, names of the party, one-paragraph thesis.
2. **Elevation profile** — inline SVG, real elevations, labelled camps.
3. **Facts strip** — distance, gain, nights out, permit cost, per-person cost.
4. **Why here** — why this place, why this season. Two paragraphs, no filler.
5. **Itinerary** — one block per day, numbered. Travel days get a timed log with
   real flight numbers and times.
6. **Route, junction by junction** — numbered legs, each with mileage, elevation,
   and the turn. Must include the return leg for out-and-backs. Photos where they
   earn their place, not on every leg.
7. **Map** — live Leaflet map plus a static SVG fallback (see below).
8. **Cost table** — per person, confirmed vs estimated marked, group total.
9. **Hazard panel** — the one thing that isn't optional. Bear regulations, water,
   river crossings, whatever the real risk is. Accent-bordered, impossible to skim
   past.
10. **Weather** — sourced climate normals for the actual dates and elevations
    (never a forecast recalled from memory; derived figures get `~`), plus the
    computed NWS point-forecast link and live-forecast box (see degradation).
11. **Before we go** — fires, water, weather, altitude, road access, signal.
12. **To book, in order** — what to reserve, in what order, with urgency noted.
13. **Footer** — coordinates, land manager phone, recommended paper map, and any
    open questions.

## Graceful degradation

Assume the reader is at a trailhead with no signal and a dying phone.

- Everything essential must render with zero network: elevation profile, route
  legs, junctions, coordinates, costs, hazards. These are inline SVG and HTML.
- Live map, photos, and the live weather-forecast box are enhancements. Wrap
  every one in an `onerror`/catch handler that hides the element rather than
  leaving a broken box. The weather box is hidden by default and only appears
  when the NWS API answers; the static normals table is the zero-network layer.
- Tile layers get a `tileload` listener and a timeout. If no tile arrives, hide
  the map and tell the reader to download the file, pointing them at the static
  fallback.
- Print styles: `break-inside: avoid` on figures, day blocks, and the hazard panel.
  A printed copy is the real backup.
- No build step in the browser. No React, no bundler, no CSS framework.

## Design system

Derived from USGS topographic sheets and Forest Service field documentation.
Do not drift toward generic travel-blog styling.

```javascript
--paper    #EDF0E8   vegetation-overprint green, page base
--paper-2  #F6F7F3   panel surface
--contour  #7A5B38   contour brown, eyebrows and labels
--forest   #2E5339   headings, markers
--water    #1D6F8E   links, lakes
--route    #B5651D   the route line, day numbers, hazard border
--rule     #C9CEC0   hairlines
--ink      #23281F   body
--ink-2    #5A6152   secondary
```

Type: system serif for display (Georgia stack), system sans for body, system mono
for all data. No web fonts — they add a network dependency for no benefit.

Mono is structural, not decorative: every number the reader might act on — times,
mileages, elevations, coordinates, costs — is mono with tabular numerals. Prose is
sans. That split is the page's signature; keep it consistent.

Sentence case throughout. Two weights only. Section headings are small mono
all-caps eyebrows over a 2px forest rule. Numbered legs use
`counter(leg, decimal-leading-zero)`.

Add `<meta name="robots" content="noindex, nofollow">`. These pages state where
specific named people will be on specific dates, and that their houses are empty.
Public URL, but not indexed.

## Voice

Write like a competent friend who has done the trip, not a brochure.

- Lead with the thing that decides something. Bury nothing important.
- Name tradeoffs plainly: cheaper flight versus longer drive, popular trail versus
  easy access. Let the reader choose; give a recommendation and the reason.
- Concrete over evocative. "Six miles, steepening in the back half" beats
  "a stunning alpine ascent."
- No exclamation marks. No "nestled." No "hidden gem."
- Where a section exists to prevent harm, drop the register and be direct.

## Deployment

GitHub Pages, source set to `main` / `/docs`. Build, commit, push; live in a minute
or two. Each trip gets its own URL: `<user>.github.io/hikeplans/<slug>/`.

## Do not

- Do not add dependencies, a bundler, or a CSS framework.
- Do not fabricate coordinates, trail lines, prices, or conditions.
- Do not hotlink copyrighted photos.
- Do not let the live map become load-bearing.
- Do not write a brief without the return leg on an out-and-back.
- Do not smooth over uncertainty to make the page read better.

## Schema notes

The trip JSON is self-documenting — `trips/spanish-peaks-2026-08/trip.json` is
the canonical example. Two fields exist specifically for the static plan-view
diagram, on entries in `map.waypoints`:

- `mile` (number) — trail mileage. Positions the marker along the corridor and
  lets a waypoint with `"lat": null` (a dispersed camp) be interpolated between
  its located neighbours. Required on any diagram waypoint without coordinates,
  and on its neighbours.
- `diagram_label` (array of two strings) — the marker's label lines, e.g.
  `["Trailhead", "mile 0 · 6,120 ft"]`. Only waypoints with a `diagram_label`
  appear on the static diagram. Keep `~` on any derived elevation. For
  `"kind": "approximate"` waypoints the template renders a hollow marker and
  appends `· approx.` to the second line itself.

The `weather` object is required: `intro` (prose, normals not forecast),
`rows` (label/value pairs, `~` on anything derived from a lapse rate or a
nearby station), `source` (station, elevation, and the date checked).

Computed by `build.js`, never authored: the `<title>` tag (place + first/last
day dates), meta description, both SVGs' geometry, the scale bar length, the
Google Maps drive link (from the `transport` waypoint to the first trail
waypoint), coordinate formatting in the waypoints table, the cost totals
(per-person sum and group total from `party_size`), and the weather section's
NWS point-forecast link and live-fetch coordinate (from the first located
trail waypoint). If the template needs
something the JSON doesn't carry, propose a field — don't hardcode.
