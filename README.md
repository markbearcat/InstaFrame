# InstaFrame — Instagram Pre-Crop PWA

A tiny, installable web app that lets you pick the exact crop (1:1 or 4:5) and a black/white
frame border **before** you upload to Instagram — so Instagram never re-crops your shot.

Everything runs locally in the browser (canvas-based image processing). No server, no
uploads, no backend required.

## What it does

1. **Select images** — pick one or many photos from your device.
2. **Choose edit mode** — edit each photo individually, or batch-process them all the same way.
3. **Straighten, rotate & crop** — drag to pan, pinch/scroll to zoom, slider to straighten,
   a button to rotate 90°, locked to a 4:3 (landscape) or 3:4 (portrait) crop box. Or tap
   **Auto crop** to let the app analyze image contrast/edges and position the crop so the
   main subject lands on a rule-of-thirds intersection, keeping as much of the original
   image as possible.
4. **Pick a frame** — 1:1 square (1080×1080px) or 4:5 portrait (1080×1350px) — Instagram's
   two supported feed dimensions.
5. **Pick frame colour** — black or white border.
6. **Export** — renders full-resolution framed JPEGs and saves/shares them to your photo
   library.

## Fixes in this version

- **Distorted/mis-centered crop fixed.** Previously, a 4:3 photo framed into a 1:1 square
  could come out with the wrong aspect ratio baked into the exported pixels (visibly
  stretched) and unevenly split top/bottom margins, instead of filling the full width and
  sitting centered with equal bars top and bottom.

  The root cause: the crop box's on-screen height was measured independently from the DOM
  (`clientHeight`), which can drift by a pixel or two from what the declared ratio implies
  once the browser applies CSS `aspect-ratio` and rounds to whole pixels. When exporting, a
  single scale factor derived only from width was then applied uniformly to both axes,
  silently baking that tiny mismatch into a real distortion, and shifting where the crop
  content landed relative to the frame's center.

  The fix: the crop box's height is now always **derived** as `boxW / ratio` — a fixed
  formula — and never independently re-measured from the DOM at any point, either on-screen
  or when rendering to the frame/export canvas. This guarantees the exported photo always has
  exactly the declared aspect ratio and is placed with mathematically exact centering.

- **Frame placement logic confirmed matching the reference:** for a 4:3 crop placed in a 1:1
  (or 4:5) frame, the photo fills the full width and sits horizontally centered as a block,
  with equal-height bars above and below. A 3:4 crop follows the identical logic on the other
  axis — it fills the full height and sits centered with equal-width bars on the left and
  right. Whichever of the crop's two dimensions is proportionally larger relative to the
  frame gets filled edge-to-edge; the other dimension is centered with symmetric padding.

- **First-image crop bug fixed** (from a previous round) — the very first image selected
  used to fail to render on the crop screen due to measuring the canvas before its container
  was actually visible.

- **4:3 / 3:4 labels fixed** to match their true width:height values.

- **Auto-crop rewritten** to keep as much of the original image as possible while aligning
  the subject to a rule-of-thirds intersection.

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `instaframe`).
2. Upload all files from the provided zip to the repo root, preserving the `icons/` subfolder:
   - `index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`
   - `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-192.png`,
     `icons/icon-maskable-512.png`
3. In the repo, go to **Settings → Pages**, set **Source** to your default branch and root
   folder (`/`), then save. GitHub Pages serves HTTPS by default, which PWAs require to install.

## Installing on Android

1. Open the GitHub Pages URL in **Chrome** on your Android phone.
2. Chrome shows an **"Add to Home screen" / "Install app"** banner, or tap the **⋮** menu →
   **Install app**.
3. Confirm — InstaFrame now appears as a normal app icon, launches full-screen, and works
   offline after the first load thanks to the service worker cache.

## How the auto-crop works

1. Finds the largest crop rectangle at your chosen ratio that fits fully inside the source
   image — no shrink at all, maximum area retained.
2. Estimates the photo's focal point using an on-device edge/contrast saliency heuristic.
3. Finds the nearest rule-of-thirds intersection to that focal point.
4. Slides the full-size crop rectangle so the focal point lands on that intersection, clamped
   to the image bounds.
5. Only shrinks the crop if perfect alignment is otherwise impossible, by the minimum amount
   needed, never below 60% of the maximum possible crop area.

## Customizing

- Colours, spacing, and border radius are CSS variables at the top of `styles.css`.
- Export resolution is set via `OUT = 1080` in `renderExportScreen()` in `app.js`.
- The auto-crop shrink floor (`maxShrink`, default `0.6`) is a parameter on
  `computeAutoCropRect()` in `app.js`.

## File-by-file overview

- `index.html` — five screens (select, mode, crop, frame, export), toggled via an `active` class.
- `styles.css` — dark, minimal UI.
- `app.js` — all app logic: file loading, pan/pinch-zoom cropping, saliency-based auto-crop,
  frame compositing, export/share.
- `manifest.json` — PWA manifest.
- `sw.js` — service worker for offline install.
- `icons/` — app icons (regular + maskable, 192px and 512px).
