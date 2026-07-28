# Spanish Peaks trip brief

Backpacking brief for the Spanish Peaks, Lee Metcalf Wilderness, Montana — 24–27 August 2026.

`index.html` is fully self-contained. Enable GitHub Pages on this repo
(Settings → Pages → Deploy from a branch → `main` / `root`) and it serves as-is.

External resources it pulls at runtime, all optional and all degrading gracefully:

- Leaflet 1.9.4 (cdnjs) — interactive map
- OpenTopoMap / OpenStreetMap tiles — contours and trail lines
- Wikimedia Commons — three Custer Gallatin National Forest photographs

If any of those fail to load, the page falls back to a static SVG route diagram
and elevation profile that need no network at all.

`index.html` carries a `noindex, nofollow` robots tag. Remove it if you want the
page to be searchable.
