# InstaFrame — Instagram Pre-Crop PWA

A tiny, installable web app that lets you pick the exact crop (1:1 or 4:5) and a black/white
frame border **before** you upload to Instagram — so Instagram never re-crops your shot.

Everything runs locally in the browser (canvas-based image processing). No server, no
uploads, no backend required.

## What it does

1. **Select images** — pick one or many photos from your device.
2. **Choose edit mode** — edit each photo individually, or batch-process them all the same way.
3. **Straighten, rotate & crop** — drag to pan, pinch/scroll to zoom, slider to straighten,
   a button to rotate 90°, locked to a 4:3 or 3:4 crop box. Or tap **Auto crop** to let the app
   analyze image contrast/edges and position the crop so the main subject lands on a
   rule-of-thirds intersection.
4. **Pick a frame** — 1:1 square or 4:5 portrait (Instagram's two supported feed ratios).
5. **Pick frame colour** — black or white border.
6. **Export** — renders full-resolution (1080px) framed JPEGs and saves/shares them to your
   photo library (uses the native Android share sheet when available, falls back to a direct
   download).

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `instaframe`).
2. Upload all files in this folder to the repo root, preserving the `icons/` subfolder:
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
   live app — **PWAs require HTTPS to install**, and GitHub Pages serves HTTPS by default, so
   this works out of the box.

> If your repo is not published at the domain root (i.e. it's a project page under a
> subpath), the paths in `manifest.json`, `index.html`, and `sw.js` are all relative
> (`./`), so they'll work correctly under a subpath automatically — no edits needed.

## Installing on Android

1. Open the GitHub Pages URL in **Chrome** on your Android phone.
2. Chrome will show an **"Add to Home screen" / "Install app"** banner or menu option
   (tap the **⋮** menu → **Install app**, if the banner doesn't appear automatically).
3. Confirm — InstaFrame now appears as a normal app icon on your home screen/app drawer,
   launches full-screen (no browser chrome), and works offline after the first load thanks
   to the service worker cache.

## Notes on the auto-crop feature

The "Auto crop" button uses a lightweight on-device saliency estimate (edge/contrast
gradient magnitude with mild center-bias) to find the busiest/most detailed region of the
photo, then positions the crop so that region sits on the nearest rule-of-thirds
intersection at your chosen 4:3/3:4 ratio. It's a heuristic, not true subject/face
detection — for portraits or off-center subjects it works well; for very flat or evenly
busy scenes, fine-tune manually afterward using drag/pinch.

## Customizing

- Colours, spacing, and border radius are all CSS variables at the top of `styles.css`
  (`:root { ... }`) — quick to retheme.
- Export resolution is set to `1080` px (Instagram's standard) inside `app.js` in
  `renderExportScreen()` — bump this if you want higher-res exports.
