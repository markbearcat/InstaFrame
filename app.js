
/* ============================================================
   InstaFrame — client-side photo cropper/framer PWA
   No dependencies. Canvas-based editing.

   CROP MODEL: every crop is stored as a rectangle in SOURCE IMAGE
   PIXEL coordinates: { sx, sy, sw, sh }, plus a rotation in degrees
   (fine + hard 90deg steps combined). This is the ONLY representation
   of "what part of the photo is shown" anywhere in the app — the
   live crop canvas, the frame preview, and the final export all call
   the exact same draw routine with this same rectangle. There is no
   separate screen-space scale/offset that gets "replayed" later, so
   there is no way for on-screen and exported results to diverge.
   ============================================================ */

const state = {
  files: [],          // { id, img, name }
  mode: 'individual',  // 'individual' | 'batch'
  cropIndex: 0,
  crops: {},           // id -> { ratio, sx, sy, sw, sh, rotation, hardRotationSteps, autoBatch }
  frameRatio: 1,        // 1 = square, 1.25 = 4:5
  frameColor: '#ffffff',
  results: []           // id -> dataURL after export
};

const el = (id) => document.getElementById(id);
const screens = {
  select: el('screen-select'),
  mode: el('screen-mode'),
  crop: el('screen-crop'),
  frame: el('screen-frame'),
  export: el('screen-export'),
};

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function toast(msg, ms=1800){
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), ms);
}

/* ---------------- STEP 1: SELECT IMAGES ---------------- */

el('btnSelectImages').addEventListener('click', () => el('fileInput').click());

el('fileInput').addEventListener('change', async (e) => {
  const fileList = Array.from(e.target.files || []);
  if (!fileList.length) return;
  state.files = [];
  state.crops = {};
  state.results = [];

  let idc = 0;
  for (const f of fileList){
    const img = await loadImage(f);
    const id = 'img' + (idc++);
    state.files.push({ id, img, name: f.name });
  }
  renderModeScreen();
  showScreen('mode');
});

function loadImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* ---------------- STEP 1a: MODE ---------------- */

function renderModeScreen(){
  el('modeCount').textContent = `${state.files.length} image${state.files.length===1?'':'s'} selected`;
  const strip = el('modeThumbStrip');
  strip.innerHTML = '';
  state.files.forEach(f => {
    const im = document.createElement('img');
    im.decoding = 'async';
    im.src = f.img.src;
    strip.appendChild(im);
  });
}

el('btnModeBack').addEventListener('click', () => showScreen('select'));

el('btnModeIndividual').addEventListener('click', () => {
  state.mode = 'individual';
  state.cropIndex = 0;
  openCropForCurrent();
});

el('btnModeBatch').addEventListener('click', () => {
  state.mode = 'batch';
  state.cropIndex = 0;
  openCropForCurrent();
});

/* ---------------- STEP 2: CROP / STRAIGHTEN ----------------
   crop.ratio is always WIDTH / HEIGHT of the crop box.
   4:3 (landscape, wider than tall)  -> ratio = 4/3  = 1.3333
   3:4 (portrait,  taller than wide) -> ratio = 3/4  = 0.75
------------------------------------------------------------- */

const canvasWrap = el('canvasWrap');
const cropCanvas = el('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');

let crop = null;         // { ratio, sx, sy, sw, sh, rotation, hardRotationSteps }
let wrapCssW = 0;         // last known on-screen width (css px) of canvasWrap
let wrapCssH = 0;

function currentFile(){
  return state.files[state.cropIndex];
}

// Build a default crop for an image: the largest rectangle at `ratio` centered in the image.
function defaultCropFor(img, ratio){
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let sw, sh;
  if (iw/ih > ratio){ sh = ih; sw = ih*ratio; }
  else { sw = iw; sh = iw/ratio; }
  return {
    ratio,
    sx: (iw-sw)/2, sy: (ih-sh)/2, sw, sh,
    rotation: 0, hardRotationSteps: 0
  };
}

function openCropForCurrent(){
  const f = currentFile();
  if (!f){ goToFrameScreen(); return; }
  el('cropTitle').textContent = state.mode === 'batch' ? 'Set crop (applies to all)' : 'Crop';
  el('cropProgress').textContent = state.mode === 'batch'
    ? ''
    : `${state.cropIndex+1} / ${state.files.length}`;
  el('btnCropSkipAll').style.display = state.mode === 'batch' ? 'inline-block' : 'none';
  el('btnCropNext').textContent = (state.mode==='individual' && state.cropIndex < state.files.length-1) ? 'Next' : 'Continue';

  const existing = state.crops[f.id];
  crop = existing ? { ...existing } : defaultCropFor(f.img, crop ? crop.ratio : 1.3333);

  showScreen('crop');
  syncRatioButtons();
  el('rotateSlider').value = crop.rotation;
  el('rotateValue').textContent = `${crop.rotation}°`;
  // sizeCropCanvas() will be triggered by the ResizeObserver as soon as canvasWrap has a
  // real layout size — this fires reliably even the very first time the screen becomes
  // visible, unlike guessing a fixed number of animation frames.
  if (wrapCssW > 0){ sizeCropCanvas(wrapCssW); }
}

function syncRatioButtons(){
  document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.ratio) - crop.ratio) < 0.001);
  });
}

// Fires whenever canvasWrap's actual rendered width changes (including the first time it
// becomes visible/laid out). This is the single source of truth for sizing — no timing
// guesses, no CSS aspect-ratio dependency.
const wrapObserver = new ResizeObserver(entries => {
  for (const entry of entries){
    const w = entry.contentRect.width;
    if (w > 0 && Math.abs(w - wrapCssW) > 0.5){
      wrapCssW = w;
      if (crop) sizeCropCanvas(w);
    }
  }
});
wrapObserver.observe(canvasWrap);

function sizeCropCanvas(cssW){
  const cssH = cssW / crop.ratio;
  wrapCssW = cssW;
  wrapCssH = cssH;
  canvasWrap.style.height = cssH + 'px';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cropCanvas.width = Math.round(cssW * dpr);
  cropCanvas.height = Math.round(cssH * dpr);
  cropCtx.setTransform(dpr,0,0,dpr,0,0);

  drawCrop();
}

// Draws crop.sx/sy/sw/sh (source-image space) into the live crop canvas, rotated by
// crop.rotation + hardRotationSteps*90 about the crop rectangle's own center.
function drawCrop(){
  const f = currentFile();
  if (!f || !crop || wrapCssW === 0) return;
  const img = f.img;
  const totalRot = (crop.rotation||0) + (crop.hardRotationSteps||0)*90;

  cropCtx.clearRect(0,0,wrapCssW,wrapCssH);
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0,0,wrapCssW,wrapCssH);

  const cx = crop.sx + crop.sw/2;
  const cy = crop.sy + crop.sh/2;
  const scale = wrapCssW / crop.sw; // sw/sh always match crop.ratio, so this is exact on both axes

  cropCtx.save();
  cropCtx.translate(wrapCssW/2, wrapCssH/2);
  cropCtx.rotate(totalRot * Math.PI/180);
  cropCtx.scale(scale, scale);
  cropCtx.translate(-cx, -cy);
  cropCtx.drawImage(img, 0, 0);
  cropCtx.restore();
}

window.addEventListener('resize', () => {
  if (canvasWrap.clientWidth > 0) sizeCropCanvas(canvasWrap.clientWidth);
});

// ratio toggle (4:3 / 3:4) — re-fit a fresh centered crop at the new ratio
document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const newRatio = parseFloat(btn.dataset.ratio);
    const f = currentFile();
    crop = defaultCropFor(f.img, newRatio);
    syncRatioButtons();
    if (wrapCssW > 0) sizeCropCanvas(wrapCssW);
  });
});

// rotation slider (fine straighten) — rotates the view; the crop rectangle size/position
// (in image space) stays the same, only the display rotation changes.
el('rotateSlider').addEventListener('input', (e) => {
  crop.rotation = parseFloat(e.target.value);
  el('rotateValue').textContent = `${crop.rotation}°`;
  drawCrop();
});

// hard 90° rotate — swaps the crop rectangle to the other orientation, centered on the
// same point, and swaps the declared ratio (4:3 <-> 3:4) to match.
el('btnRotate90').addEventListener('click', () => {
  const f = currentFile();
  crop.hardRotationSteps = ((crop.hardRotationSteps||0) + 1) % 4;
  const newRatio = crop.ratio === 1.3333 ? 0.75 : 1.3333;
  const cx = crop.sx + crop.sw/2, cy = crop.sy + crop.sh/2;
  const fresh = defaultCropFor(f.img, newRatio);
  // keep the same center point as before, just re-fit the box size/orientation
  crop.ratio = newRatio;
  crop.sw = fresh.sw; crop.sh = fresh.sh;
  crop.sx = Math.max(0, Math.min(cx - crop.sw/2, f.img.naturalWidth - crop.sw));
  crop.sy = Math.max(0, Math.min(cy - crop.sh/2, f.img.naturalHeight - crop.sh));
  syncRatioButtons();
  if (wrapCssW > 0) sizeCropCanvas(wrapCssW);
});

el('btnReset').addEventListener('click', () => {
  const f = currentFile();
  const keepRatio = crop.ratio;
  crop = defaultCropFor(f.img, keepRatio);
  el('rotateSlider').value = 0;
  el('rotateValue').textContent = '0°';
  drawCrop();
});

/* ---- Pointer drag (pan) + pinch (zoom), operating directly on crop.sx/sy/sw/sh ---- */
(function setupGestures(){
  let pointers = new Map();
  let lastDist = null;

  function getPos(e){
    const r = canvasWrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvasWrap.addEventListener('pointerdown', (e) => {
    canvasWrap.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, getPos(e));
  });

  canvasWrap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !crop || wrapCssW === 0) return;
    const prev = pointers.get(e.pointerId);
    const cur = getPos(e);
    pointers.set(e.pointerId, cur);

    const f = currentFile();
    const iw = f.img.naturalWidth, ih = f.img.naturalHeight;
    const imgPxPerScreenPx = crop.sw / wrapCssW;

    if (pointers.size === 1){
      // Pan: dragging right should move the visible window left (natural drag-to-pan feel)
      const dx = (cur.x - prev.x) * imgPxPerScreenPx;
      const dy = (cur.y - prev.y) * imgPxPerScreenPx;
      crop.sx = Math.max(0, Math.min(crop.sx - dx, iw - crop.sw));
      crop.sy = Math.max(0, Math.min(crop.sy - dy, ih - crop.sh));
      drawCrop();
    } else if (pointers.size === 2){
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      if (lastDist != null && dist > 0){
        const factor = lastDist / dist; // pinch out (dist grows) -> factor<1 -> crop shrinks (zoom in)
        const cx = crop.sx + crop.sw/2, cy = crop.sy + crop.sh/2;
        let newSw = crop.sw * factor;
        let newSh = crop.sh * factor;
        const maxSw = iw, maxSh = ih;
        const minSw = Math.min(iw, ih*crop.ratio) * 0.1; // don't allow zooming in absurdly far
        newSw = Math.max(minSw, Math.min(newSw, maxSw));
        newSh = newSw / crop.ratio;
        if (newSh > maxSh){ newSh = maxSh; newSw = newSh*crop.ratio; }
        crop.sw = newSw; crop.sh = newSh;
        crop.sx = Math.max(0, Math.min(cx - newSw/2, iw - newSw));
        crop.sy = Math.max(0, Math.min(cy - newSh/2, ih - newSh));
      }
      lastDist = dist;
      drawCrop();
    }
  });

  function clearPointer(e){
    pointers.delete(e.pointerId);
    if (pointers.size < 2){ lastDist = null; }
  }
  canvasWrap.addEventListener('pointerup', clearPointer);
  canvasWrap.addEventListener('pointercancel', clearPointer);
  canvasWrap.addEventListener('pointerleave', clearPointer);

  canvasWrap.addEventListener('wheel', (e) => {
    if (!crop) return;
    e.preventDefault();
    const f = currentFile();
    const iw = f.img.naturalWidth, ih = f.img.naturalHeight;
    const factor = e.deltaY < 0 ? 0.95 : 1.05;
    const cx = crop.sx + crop.sw/2, cy = crop.sy + crop.sh/2;
    let newSw = crop.sw * factor;
    const minSw = Math.min(iw, ih*crop.ratio) * 0.1;
    newSw = Math.max(minSw, Math.min(newSw, iw));
    let newSh = newSw / crop.ratio;
    if (newSh > ih){ newSh = ih; newSw = newSh*crop.ratio; }
    crop.sw = newSw; crop.sh = newSh;
    crop.sx = Math.max(0, Math.min(cx - newSw/2, iw - newSw));
    crop.sy = Math.max(0, Math.min(cy - newSh/2, ih - newSh));
    drawCrop();
  }, { passive:false });
})();

/* ---------------------------------------------------------------
   AUTO CROP — rule of thirds, maximum-area heuristic.

   1. Find the largest crop rectangle of the target aspect ratio
      that fits fully inside the source image (no zoom-in).
   2. Find the image's focal point via edge/contrast saliency.
   3. Pick the nearest rule-of-thirds intersection.
   4. Slide the max-size crop rectangle so that intersection sits
      under the focal point, clamped to the source image bounds.
   5. If exact alignment isn't reachable at full size, scan shrink
      factors and pick the LARGEST factor (least shrink, most area
      kept) that achieves alignment within tolerance. Never shrink
      below 60% of the max possible crop area, and never shrink
      unless it produces a meaningful improvement in alignment.
------------------------------------------------------------------ */

el('btnAutoCrop').addEventListener('click', () => {
  autoCropCurrent();
});

function computeAutoCropRect(iw, ih, targetAspect, analysis, maxShrink = 0.6){
  let cropW, cropH;
  if (iw/ih > targetAspect){
    cropH = ih;
    cropW = ih * targetAspect;
  } else {
    cropW = iw;
    cropH = iw / targetAspect;
  }

  const cx = analysis.cx, cy = analysis.cy;

  const fracOptionsX = [1/3, 2/3];
  const fracOptionsY = [1/3, 2/3];
  const thirdsX = fracOptionsX.map(fr => fr*iw);
  const thirdsY = fracOptionsY.map(fr => fr*ih);
  const fracX = Math.abs(thirdsX[0]-cx) < Math.abs(thirdsX[1]-cx) ? fracOptionsX[0] : fracOptionsX[1];
  const fracY = Math.abs(thirdsY[0]-cy) < Math.abs(thirdsY[1]-cy) ? fracOptionsY[0] : fracOptionsY[1];

  function rectAt(factor){
    const w = cropW*factor, h = cropH*factor;
    const x = cx - fracX*w, y = cy - fracY*h;
    const mx = iw-w, my = ih-h;
    const cxg = Math.max(0, Math.min(x, mx));
    const cyg = Math.max(0, Math.min(y, my));
    const actualFracX = w>0 ? (cx-cxg)/w : 0.5;
    const actualFracY = h>0 ? (cy-cyg)/h : 0.5;
    const err = Math.abs(actualFracX-fracX) + Math.abs(actualFracY-fracY);
    return { err, rect: { sx: cxg, sy: cyg, sw: w, sh: h } };
  }

  const TOL = 0.02;
  const full = rectAt(1.0);
  if (full.err <= TOL){
    return full.rect;
  }

  const N = 200;
  let bestOkFactor = null;
  let bestAnyErr = full.err;
  let bestAnyRect = full.rect;

  for (let i = 0; i <= N; i++){
    const factor = maxShrink + (1.0-maxShrink) * (i/N);
    const { err, rect } = rectAt(factor);
    if (err <= TOL && (bestOkFactor === null || factor > bestOkFactor)){
      bestOkFactor = factor;
    }
    if (err < bestAnyErr){
      bestAnyErr = err;
      bestAnyRect = rect;
    }
  }

  if (bestOkFactor !== null){
    return rectAt(bestOkFactor).rect;
  }

  if (full.err - bestAnyErr > 0.05){
    return bestAnyRect;
  }
  return full.rect;
}

function autoCropCurrent(){
  const f = currentFile();
  const img = f.img;
  const iw = img.naturalWidth, ih = img.naturalHeight;

  crop.rotation = 0;
  crop.hardRotationSteps = 0;
  el('rotateSlider').value = 0;
  el('rotateValue').textContent = '0°';

  const analysis = analyzeSaliency(img);
  const rect = computeAutoCropRect(iw, ih, crop.ratio, analysis);
  crop.sx = rect.sx; crop.sy = rect.sy; crop.sw = rect.sw; crop.sh = rect.sh;

  drawCrop();
  toast('Auto-cropped to rule of thirds');
}

function analyzeSaliency(img){
  const SAMPLE = 120;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const aspect = iw/ih;
  let sw, sh;
  if (aspect > 1){ sw = SAMPLE; sh = Math.round(SAMPLE/aspect); }
  else { sh = SAMPLE; sw = Math.round(SAMPLE*aspect); }
  sw = Math.max(sw,8); sh = Math.max(sh,8);

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0,0,sw,sh).data;

  const gray = new Float32Array(sw*sh);
  for (let i=0;i<sw*sh;i++){
    const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
    gray[i] = 0.299*r + 0.587*g + 0.114*b;
  }

  let totalW = 0, sumX = 0, sumY = 0;
  for (let y=1; y<sh-1; y++){
    for (let x=1; x<sw-1; x++){
      const idx = y*sw+x;
      const gx = gray[idx+1] - gray[idx-1];
      const gy = gray[idx+sw] - gray[idx-sw];
      let mag = Math.sqrt(gx*gx + gy*gy);

      const nx = (x/sw - 0.5), ny = (y/sh - 0.5);
      const distFromCenter = Math.sqrt(nx*nx+ny*ny);
      const centerBias = 1 - Math.min(distFromCenter, 0.9) * 0.5;
      mag *= centerBias;

      totalW += mag;
      sumX += mag * x;
      sumY += mag * y;
    }
  }

  let cx, cy;
  if (totalW < 1e-6){
    cx = sw/2; cy = sh/2;
  } else {
    cx = sumX/totalW;
    cy = sumY/totalW;
  }

  return {
    cx: (cx / sw) * iw,
    cy: (cy / sh) * ih
  };
}

/* ---- Navigation for crop screen ---- */
el('btnCropBack').addEventListener('click', () => {
  if (state.mode === 'individual' && state.cropIndex > 0){
    state.cropIndex--;
    openCropForCurrent();
  } else {
    showScreen('mode');
  }
});

function saveCurrentCrop(){
  const f = currentFile();
  state.crops[f.id] = { ...crop };
}

el('btnCropNext').addEventListener('click', () => {
  saveCurrentCrop();
  if (state.mode === 'individual'){
    if (state.cropIndex < state.files.length - 1){
      state.cropIndex++;
      openCropForCurrent();
      return;
    }
  }
  goToFrameScreen();
});

el('btnCropSkipAll').addEventListener('click', () => {
  saveCurrentCrop();
  const template = state.crops[currentFile().id];
  state.files.forEach(f => {
    if (!state.crops[f.id]){
      // Re-fit the same ratio/rotation choice to each image individually (centered default),
      // rather than reusing pixel coordinates that only make sense for the first image's size.
      const fitted = defaultCropFor(f.img, template.ratio);
      fitted.rotation = template.rotation;
      fitted.hardRotationSteps = template.hardRotationSteps;
      fitted.autoBatch = true;
      state.crops[f.id] = fitted;
    }
  });
  goToFrameScreen();
});

/* ---------------- STEP 3+4: FRAME RATIO + COLOUR ---------------- */

function goToFrameScreen(){
  state.files.forEach(f => {
    if (!state.crops[f.id]){
      const ref = Object.values(state.crops)[0] || { ratio: 1.3333 };
      const fitted = defaultCropFor(f.img, ref.ratio);
      fitted.autoBatch = true;
      state.crops[f.id] = fitted;
    }
  });
  renderFramePreview();
  showScreen('frame');
}

document.querySelectorAll('#screen-frame [data-frame]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-frame [data-frame]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.frameRatio = parseFloat(btn.dataset.frame);
    renderFramePreview();
  });
});

document.querySelectorAll('#screen-frame .color-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-frame .color-swatch').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.frameColor = btn.dataset.color;
    renderFramePreview();
  });
});

function renderFramePreview(){
  const f = state.files[0];
  if (!f) return;
  const canvas = el('framePreviewCanvas');
  const OUT = 600;
  canvas.width = OUT;
  canvas.height = Math.round(OUT * state.frameRatio);
  renderFramedImage(f, canvas, OUT, canvas.height);
}

/* Draws crop.sx/sy/sw/sh from the source image directly into a destination rectangle,
   applying rotation about the crop rectangle's own center. This is the SAME primitive used
   for the live crop canvas, so preview and export are guaranteed to match what was cropped. */
function drawCropToRect(img, ctx, c, destX, destY, destW, destH){
  const totalRot = (c.rotation||0) + (c.hardRotationSteps||0)*90;
  const cx = c.sx + c.sw/2, cy = c.sy + c.sh/2;
  const scale = destW / c.sw;

  ctx.save();
  ctx.beginPath();
  ctx.rect(destX, destY, destW, destH);
  ctx.clip();
  ctx.translate(destX + destW/2, destY + destH/2);
  ctx.rotate(totalRot * Math.PI/180);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/* Renders the cropped photo centered into a framed canvas with the frame color as
   background/border, matching frameRatio (1 = square 1080x1080, 1.25 = 4:5 portrait
   1080x1350 — Instagram's standard feed dimensions).

   Placement rule: the photo fills whichever dimension matches the frame's orientation —
   for a 4:3 crop (relatively wider than the frame), it fills the FULL WIDTH and is centered
   vertically (equal top/bottom bars). For a 3:4 crop, the same logic applies on whichever
   axis is relatively larger — it fills the FULL HEIGHT and is centered horizontally. No
   artificial margin is ever added on the filled axis. */
function renderFramedImage(f, canvas, outW, outH){
  const ctx = canvas.getContext('2d');
  let c = state.crops[f.id];
  const img = f.img;

  if (c.autoBatch){
    const a = analyzeSaliency(img);
    const rect = computeAutoCropRect(img.naturalWidth, img.naturalHeight, c.ratio, a);
    c = { ...c, sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh };
  }

  ctx.fillStyle = state.frameColor;
  ctx.fillRect(0,0,outW,outH);

  const cropAspect = c.ratio;
  const frameAspect = outW/outH;

  let photoW, photoH;
  if (cropAspect > frameAspect){
    photoW = outW;
    photoH = photoW / cropAspect;
  } else {
    photoH = outH;
    photoW = photoH * cropAspect;
  }
  const px = Math.round((outW - photoW)/2);
  const py = Math.round((outH - photoH)/2);
  photoW = Math.round(photoW);
  photoH = Math.round(photoH);

  drawCropToRect(img, ctx, c, px, py, photoW, photoH);
}

el('btnFrameBack').addEventListener('click', () => {
  showScreen('crop');
});

el('btnFrameNext').addEventListener('click', () => {
  renderExportScreen();
  showScreen('export');
});

/* ---------------- STEP 5: EXPORT ----------------
   Export sizes match Instagram's official 2026 feed recommendations:
   1:1 square  -> 1080 x 1080 px
   4:5 portrait -> 1080 x 1350 px (outH = outW * 1.25)
------------------------------------------------- */

function renderExportScreen(){
  const grid = el('exportGrid');
  grid.innerHTML = '';
  state.results = [];

  const OUT = 1080;
  state.files.forEach(f => {
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = Math.round(OUT * state.frameRatio);
    renderFramedImage(f, canvas, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    state.results.push({ id: f.id, name: f.name, dataUrl });

    const img = document.createElement('img');
    img.src = dataUrl;
    grid.appendChild(img);
  });

  el('exportSummary').textContent = `${state.files.length} image${state.files.length===1?'':'s'} ready · ${state.frameRatio===1?'1:1 (1080×1080)':'4:5 (1080×1350)'} · ${state.frameColor==='#ffffff'?'White':'Black'} frame`;
}

el('btnExportBack').addEventListener('click', () => showScreen('frame'));

el('btnStartOver').addEventListener('click', () => {
  state.files = [];
  state.crops = {};
  state.results = [];
  crop = null;
  wrapCssW = 0;
  el('fileInput').value = '';
  showScreen('select');
});

el('btnSaveAll').addEventListener('click', async () => {
  for (const r of state.results){
    await saveImage(r.dataUrl, r.name);
  }
  toast('Saved to your library');
});

async function saveImage(dataUrl, originalName){
  const base = (originalName || 'photo').replace(/\.[^.]+$/, '');
  const filename = `InstaFrame_${base}_${Date.now()}.jpg`;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch(e){ /* fall through to download */ }

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ---------------- PWA install / service worker ---------------- */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
