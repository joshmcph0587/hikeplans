# hikeplans

Single-file HTML backpacking trip briefs, generated from JSON.

- `trips/<slug>/` — one folder per trip; `trip.json` is the data file the build
  reads, and any other per-trip material (notes, GPX, sources) lives alongside it
- `template/brief.html` — the page template
- `build.js` — zero-dependency renderer, Node 18+
- `docs/` — build output; GitHub Pages serves from here (Settings → Pages → `main` / `/docs`)

Build:

```
node build.js
```

writes `docs/<slug>/index.html` for every trip plus `docs/index.html`, an index
of all trips. Commit `docs/` — Pages serves it as-is.

Each brief is fully self-contained. External resources (Leaflet from cdnjs,
OpenTopoMap/OSM tiles, Wikimedia Commons photos) are optional enhancements that
degrade gracefully to inline SVG fallbacks. Briefs carry a `noindex, nofollow`
robots tag.

See `CLAUDE.md` for the authoring workflow, research protocol, and design system.
