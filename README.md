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
   **Auto crop** for a rule-of-thirds crop that keeps as much of the image as possible.
4. **Pick a frame** — 1:1 square (1080×1080px) or 4:5 portrait (1080×1350px).
5. **Pick frame colour** — black or white border.
6. **Export** — renders full-resolution framed JPEGs and saves/shares them to your library.

## This update: a structural rewrite of the crop engine

Two bugs kept recurring — the cropped photo not filling the full width/height of the frame,
and the first selected image failing to preview. Both traced back to the same underlying
design flaw, so this version replaces the crop engine's internals rather than patching
symptoms:

**Before:** the crop was stored as screen-space values (zoom scale, pixel offsets) tied to
the on-screen crop canvas's measured size at the moment of editing. Exporting meant
"replaying" those screen-space values onto a differently-sized offscreen canvas using a
scale factor calculated from a separately-remeasured width. Any tiny mismatch between the
live canvas's actual size and the value used at replay time (from CSS rounding, layout
timing, or a stale measurement) got baked into the output as a real distortion or an
uneven, wrongly-sized crop — which is exactly what caused photos not to fill the frame
correctly.

**Now:** every crop is stored as a single rectangle in the *source image's own pixel
coordinates* — `{ sx, sy, sw, sh }` — the same representation used for auto-crop. The live
crop canvas, the frame preview, and the final export all call the exact same drawing
function with this same rectangle; there is no separate value that gets "replayed" or
re-derived later, so on-screen and exported results can no longer diverge. Because the
rectangle's width and height are always kept in exact proportion to the ratio, a single
scale factor is always mathematically exact on both axes — no possibility of stretch.

For the first-image preview bug: the crop canvas used to be sized by measuring the DOM
right after making its container visible, guessing how many animation frames the browser
needed to finish layout first. That guess wasn't reliable. It's now driven by a
`ResizeObserver`, which is specified to fire as soon as an observed element actually has a
real layout size — including the very first time it becomes visible — so there's no timing
window where the canvas gets sized to zero.

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `instaframe`).
2. Upload all files from the provided zip to the repo root, preserving the `icons/` subfolder.
3. Go to **Settings → Pages**, set **Source** to your default branch and root folder (`/`).
4. GitHub Pages serves HTTPS by default, which PWAs require to install.

If you have a previously installed version of this app on a device, uninstall and reinstall
it (or clear its site data) so the new service worker cache takes over — the cache version
has been bumped so this shouldn't normally be required, but it guarantees a clean update.

## Installing on Android

1. Open the GitHub Pages URL in **Chrome**.
2. Tap **Install app** from the banner or the **⋮** menu.
3. InstaFrame launches full-screen and works offline after the first load.

## How the auto-crop works

Finds the largest crop rectangle at your chosen ratio that fits fully inside the source
image, locates the photo's focal point via an edge/contrast saliency heuristic, and slides
the crop so that point lands on the nearest rule-of-thirds intersection — shrinking only if
perfect alignment is otherwise impossible, and never below 60% of the maximum possible area.

## Customizing

- Colours, spacing, border radius: CSS variables at the top of `styles.css`.
- Export resolution: `OUT = 1080` in `renderExportScreen()` in `app.js`.
- Auto-crop shrink floor: `maxShrink` parameter (default `0.6`) on `computeAutoCropRect()`.

## File-by-file overview

- `index.html` — five screens (select, mode, crop, frame, export).
- `styles.css` — dark, minimal UI.
- `app.js` — file loading, source-space cropping, saliency-based auto-crop, frame
  compositing, export/share.
- `manifest.json` — PWA manifest.
- `sw.js` — service worker for offline install.
- `icons/` — app icons (regular + maskable, 192px and 512px).
