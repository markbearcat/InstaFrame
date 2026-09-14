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
4. **Pick a frame** — 1:1 square or 4:5 portrait (Instagram's two supported feed ratios).
5. **Pick frame colour** — black or white border.
6. **Export** — renders full-resolution (1080px) framed JPEGs and saves/shares them to your
   photo library (uses the native Android share sheet when available, falls back to a direct
   download).

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `instaframe`).
2. Upload all files from the provided zip to the repo root, preserving the `icons/` subfolder:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `manifest.json`
   - `sw.js`
   - `icons/icon-192.png`
   - `icons/icon-512.png`
   - `icons/icon-maskable-192.png`
   - `icons/icon-maskable-512.png`
3. In the repo, go to **Settings → Pages**, set **Source** to your default branch and
   root folder (`/`), then save.
4. GitHub will give you a URL like `https://yourusername.github.io/instaframe/`. That's your
   live app — PWAs require HTTPS to install, and GitHub Pages serves HTTPS by default, so
   this works out of the box.

If your repo is published under a subpath (a typical project page), the paths in
`manifest.json`, `index.html`, and `sw.js` are all relative (`./`), so they work correctly
without edits.

## Installing on Android

1. Open the GitHub Pages URL in **Chrome** on your Android phone.
2. Chrome shows an **"Add to Home screen" / "Install app"** banner, or tap the **⋮** menu →
   **Install app** if the banner doesn't appear automatically.
3. Confirm — InstaFrame now appears as a normal app icon on your home screen/app drawer,
   launches full-screen with no browser chrome, and works offline after the first load thanks
   to the service worker cache.

## Ratio naming (fixed)

Crop-box ratios are always expressed as width:height —
**4:3** is the landscape box (wider than tall), **3:4** is the portrait box (taller than
wide). The segmented toggle and the 90°-rotate button both swap correctly between these two
labels/values.

## How the auto-crop works

"Auto crop" prioritizes keeping as much of the original photo as possible:

1. It finds the largest crop rectangle at your chosen ratio (4:3 or 3:4) that fits fully
   inside the source image — i.e. no shrink at all, maximum area retained.
2. It estimates the photo's focal point using an on-device edge/contrast saliency heuristic
   (with mild center-bias) — this approximates where the main subject or busiest detail is.
3. It finds the nearest rule-of-thirds intersection to that focal point.
4. It slides the full-size crop rectangle so the focal point lands on that intersection,
   clamped to stay within the image bounds.
5. Only if perfect alignment is impossible while staying in-bounds (e.g. the subject sits
   very close to an edge, or dead-center) does it shrink the crop — and only by the minimum
   amount needed, never by an arbitrary fixed percentage, and never below 60% of the maximum
   possible crop area. If shrinking wouldn't meaningfully improve alignment, it keeps the
   full-size crop instead.

This is a heuristic, not true subject/face detection — it works well for portraits or
off-center subjects; for flat or evenly busy scenes, fine-tune manually afterward with
drag/pinch.

## Customizing

- Colours, spacing, and border radius are CSS variables at the top of `styles.css`
  (`:root { ... }`) — quick to retheme.
- Export resolution is set to `1080` px (Instagram's standard) inside `app.js` in
  `renderExportScreen()` — increase this for higher-res exports.
- The auto-crop shrink floor (`maxShrink`, default `0.6`) is a parameter on
  `computeAutoCropRect()` in `app.js` — lower it to allow more aggressive shrinking for
  tighter thirds alignment, raise it to preserve more image area at the cost of looser
  alignment.

## File-by-file overview

- `index.html` — five screens (select, mode, crop, frame, export), all in one page, toggled
  by adding/removing an `active` class.
- `styles.css` — dark, minimal UI. Pill-shaped buttons, segmented toggles, single accent
  colour (blue) reserved for the auto-crop highlight and active states.
- `app.js` — all app logic: file loading, pointer-based pan/pinch-zoom cropping, the
  saliency-based auto-crop algorithm, frame compositing, and export/share.
- `manifest.json` — PWA manifest (name, icons, standalone display, portrait orientation).
- `sw.js` — service worker that caches the app shell so it installs and works offline.
- `icons/` — generated app icons (regular + maskable, 192px and 512px).
