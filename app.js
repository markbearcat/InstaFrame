
/* ============================================================
   InstaFrame — client-side photo cropper/framer PWA
   No dependencies. Canvas-based editing.
   ============================================================ */

const state = {
  files: [],          // { id, img, name }
  mode: 'individual',  // 'individual' | 'batch'
  cropIndex: 0,
  crops: {},           // id -> { ratio, rotation, offsetX, offsetY, scale, boxW }
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

   IMPORTANT: the crop box's on-screen height is ALWAYS derived as
   boxW / crop.ratio, never re-measured independently via
   wrap.clientHeight. CSS aspect-ratio can introduce tiny sub-pixel
   rounding differences between a measured clientHeight and the
   mathematically exact boxW/ratio, and replaying transforms later
   using a mismatched height is what previously caused exported
   crops to come out visibly stretched/squashed and mis-centered
   in the frame. Deriving height consistently everywhere removes
   that entire class of bug.
------------------------------------------------------------- */

const cropCanvas = el('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');

let crop = {
  ratio: 1.3333,     // width/height of the crop box — defaults to 4:3 landscape
  rotation: 0,         // fine straighten, degrees
  scale: 1,             // zoom of image within crop
  offsetX: 0,            // pan in screen px, relative to boxW/boxH at save time
  offsetY: 0,
  minScale: 1,
  boxW: 0                // crop box width (css px) at the moment this crop was defined
};
let hardRotationSteps = 0; // 0..3 hard 90° turns, independent of fine rotation slider

function currentFile(){
  return state.files[state.cropIndex];
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
  crop = existing ? {...existing} : { ratio: 1.3333, rotation: 0, scale: 1, offsetX: 0, offsetY: 0, minScale: 1, boxW: 0 };
  hardRotationSteps = existing ? (existing.hardRotationSteps || 0) : 0;

  // Show the crop screen FIRST, before measuring/sizing the canvas. If the screen is still
  // display:none (as on the very first image), clientWidth/clientHeight read as 0, which
  // breaks the first image's crop rendering. Showing the screen first lets the browser lay
  // it out so the wrapper has real dimensions by the time we measure it.
  showScreen('crop');
  applyBoxAspect();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setupCropCanvas();
    });
  });
}

function applyBoxAspect(){
  cropCanvas.parentElement.style.aspectRatio = `${crop.ratio} / 1`;
}

// The single source of truth for the crop box's CSS pixel dimensions. Height is ALWAYS
// derived from width via the declared ratio — never independently measured — so it can
// never drift from what the ratio implies.
function getBoxDims(boxW){
  return { boxW, boxH: boxW / crop.ratio };
}

function setupCropCanvas(){
  const wrap = cropCanvas.parentElement;
  const cssW = wrap.clientWidth;

  if (cssW === 0){
    requestAnimationFrame(setupCropCanvas);
    return;
  }

  const { boxW, boxH } = getBoxDims(cssW);
  crop.boxW = boxW;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cropCanvas.width = boxW * dpr;
  cropCanvas.height = boxH * dpr;
  cropCanvas.style.height = boxH + 'px';
  cropCtx.setTransform(dpr,0,0,dpr,0,0);

  document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.ratio) - crop.ratio) < 0.001);
  });
  el('rotateSlider').value = crop.rotation;
  el('rotateValue').textContent = `${crop.rotation}°`;

  fitMinScale();
  drawCrop();
}

function fitMinScale(){
  const f = currentFile();
  const img = f.img;
  if (!crop.boxW) return;
  const { boxW, boxH } = getBoxDims(crop.boxW);
  const totalRad = (crop.rotation + hardRotationSteps*90) * Math.PI/180;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const rw = Math.abs(iw*Math.cos(totalRad)) + Math.abs(ih*Math.sin(totalRad));
  const rh = Math.abs(iw*Math.sin(totalRad)) + Math.abs(ih*Math.cos(totalRad));
  const coverScale = Math.max(boxW/rw, boxH/rh);
  crop.minScale = coverScale;
  if (crop.scale < coverScale) crop.scale = coverScale;
}

function drawCrop(){
  const f = currentFile();
  const img = f.img;
  if (!crop.boxW) return;
  const { boxW, boxH } = getBoxDims(crop.boxW);

  cropCtx.clearRect(0,0,boxW,boxH);
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0,0,boxW,boxH);

  cropCtx.save();
  cropCtx.translate(boxW/2 + crop.offsetX, boxH/2 + crop.offsetY);
  cropCtx.rotate((crop.rotation + hardRotationSteps*90) * Math.PI/180);
  cropCtx.scale(crop.scale, crop.scale);
  cropCtx.drawImage(img, -img.naturalWidth/2, -img.naturalHeight/2);
  cropCtx.restore();
}

window.addEventListener('resize', () => { setupCropCanvas(); });

// ratio toggle (4:3 / 3:4)
document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-crop .seg-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    crop.ratio = parseFloat(btn.dataset.ratio);
    applyBoxAspect();
    requestAnimationFrame(()=>{ setupCropCanvas(); });
  });
});

// rotation slider (fine straighten)
el('rotateSlider').addEventListener('input', (e) => {
  crop.rotation = parseFloat(e.target.value);
  el('rotateValue').textContent = `${crop.rotation}°`;
  fitMinScale();
  drawCrop();
});

// hard 90° rotate — swaps the crop box between 4:3 and 3:4 to match the new orientation
el('btnRotate90').addEventListener('click', () => {
  hardRotationSteps = (hardRotationSteps + 1) % 4;
  crop.ratio = crop.ratio === 1.3333 ? 0.75 : 1.3333;
  document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.ratio) - crop.ratio) < 0.001);
  });
  applyBoxAspect();
  requestAnimationFrame(()=>{ setupCropCanvas(); });
});

el('btnReset').addEventListener('click', () => {
  crop.rotation = 0;
  hardRotationSteps = 0;
  crop.scale = 1;
  crop.offsetX = 0;
  crop.offsetY = 0;
  el('rotateSlider').value = 0;
  el('rotateValue').textContent = '0°';
  fitMinScale();
  drawCrop();
});

/* ---- Pointer drag (pan) + pinch (zoom) ---- */
(function setupGestures(){
  const wrap = cropCanvas.parentElement;
  let pointers = new Map();
  let lastDist = null;

  function getPos(e){
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  wrap.addEventListener('pointerdown', (e) => {
    wrap.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, getPos(e));
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = getPos(e);
    pointers.set(e.pointerId, cur);

    if (pointers.size === 1){
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      crop.offsetX += dx;
      crop.offsetY += dy;
      drawCrop();
    } else if (pointers.size === 2){
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      if (lastDist != null){
        const factor = dist / lastDist;
        crop.scale = Math.max(crop.minScale, Math.min(crop.scale * factor, crop.minScale * 6));
      }
      lastDist = dist;
      drawCrop();
    }
  });

  function clearPointer(e){
    pointers.delete(e.pointerId);
    if (pointers.size < 2){ lastDist = null; }
  }
  wrap.addEventListener('pointerup', clearPointer);
  wrap.addEventListener('pointercancel', clearPointer);
  wrap.addEventListener('pointerleave', clearPointer);

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 0.95;
    crop.scale = Math.max(crop.minScale, Math.min(crop.scale * factor, crop.minScale * 6));
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
    return { err, rect: { sx: cxg, sy: cyg, cropW: w, cropH: h } };
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
  hardRotationSteps = 0;
  el('rotateSlider').value = 0;
  el('rotateValue').textContent = '0°';

  const analysis = analyzeSaliency(img);
  const rect = computeAutoCropRect(iw, ih, crop.ratio, analysis);

  fitMinScale();
  const { boxW } = getBoxDims(crop.boxW);

  const scale = boxW / rect.cropW;
  crop.scale = Math.max(crop.minScale, scale);

  const rectCenterX = rect.sx + rect.cropW/2;
  const rectCenterY = rect.sy + rect.cropH/2;
  const imgCenterX = iw/2;
  const imgCenterY = ih/2;

  crop.offsetX = -(rectCenterX - imgCenterX) * crop.scale;
  crop.offsetY = -(rectCenterY - imgCenterY) * crop.scale;

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
  state.crops[f.id] = { ...crop, hardRotationSteps };
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
      state.crops[f.id] = { ratio: template.ratio, rotation: 0, hardRotationSteps: template.hardRotationSteps, scale: 1, offsetX: 0, offsetY: 0, minScale: 1, boxW: 0, autoBatch: true };
    }
  });
  goToFrameScreen();
});

/* ---------------- STEP 3+4: FRAME RATIO + COLOUR ---------------- */

function goToFrameScreen(){
  state.files.forEach(f => {
    if (!state.crops[f.id]){
      const ref = Object.values(state.crops)[0] || { ratio: 1.3333, hardRotationSteps: 0 };
      state.crops[f.id] = { ratio: ref.ratio, rotation:0, hardRotationSteps: ref.hardRotationSteps||0, scale:1, offsetX:0, offsetY:0, minScale:1, boxW:0, autoBatch:true };
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

/* ---------------------------------------------------------------
   Convert a saved manual crop (scale/offset/rotation, defined
   relative to its own boxW/boxH at save time) into an explicit
   source-image-space rectangle wherever possible, OR — if
   rotation is non-zero — replay the transform directly onto the
   target canvas using boxW/boxH DERIVED THE SAME WAY they were
   at save time (never re-measured), so there is never a mismatch
   between what the user saw and what gets exported.
------------------------------------------------------------------ */
function drawManualCropToCanvas(img, targetCtx, targetW, targetH, c){
  const boxW = c.boxW || targetW;
  const boxH = boxW / c.ratio; // ALWAYS derived, matches how it was defined on-screen

  // Scale factor from the crop-screen's box size to this target canvas size.
  // Because boxH is always boxW/ratio and targetH is always targetW/ratio (both canvases
  // share the same aspect ratio by construction), a single uniform scalar is now exact —
  // there is no independent height to drift out of proportion.
  const s = targetW / boxW;

  const totalRot = (c.rotation||0) + (c.hardRotationSteps||0)*90;

  targetCtx.save();
  targetCtx.translate(targetW/2 + c.offsetX*s, targetH/2 + c.offsetY*s);
  targetCtx.rotate(totalRot * Math.PI/180);
  targetCtx.scale(c.scale*s, c.scale*s);
  targetCtx.drawImage(img, -img.naturalWidth/2, -img.naturalHeight/2);
  targetCtx.restore();
}

/* Renders the cropped photo (per its saved crop) centered into a framed canvas with the
   frame color as background/border, matching frameRatio (1 = square 1080x1080, 1.25 = 4:5
   portrait 1080x1350 — Instagram's standard feed dimensions).

   Placement rule: the photo fills whichever dimension matches the frame's orientation —
   for a 4:3 crop (wider than the 1:1/4:5 frame), it fills the FULL WIDTH and is centered
   vertically (equal top/bottom bars). For a 3:4 crop, the same logic applies on whichever
   axis is relatively larger. No artificial margin is ever added on the filled axis. */
function renderFramedImage(f, canvas, outW, outH){
  const ctx = canvas.getContext('2d');
  const c = state.crops[f.id];
  const img = f.img;

  ctx.fillStyle = state.frameColor;
  ctx.fillRect(0,0,outW,outH);

  const cropAspect = c.ratio; // width/height of the cropped photo
  const frameAspect = outW/outH;

  let photoW, photoH;
  if (cropAspect > frameAspect){
    // crop is relatively wider than the frame -> fill full width, letterbox top/bottom
    photoW = outW;
    photoH = photoW / cropAspect;
  } else {
    // crop is relatively taller than the frame -> fill full height, pillarbox sides
    photoH = outH;
    photoW = photoH * cropAspect;
  }
  const px = Math.round((outW - photoW)/2);
  const py = Math.round((outH - photoH)/2);
  photoW = Math.round(photoW);
  photoH = Math.round(photoH);

  const off = document.createElement('canvas');
  off.width = photoW;
  off.height = photoH;
  const octx = off.getContext('2d');

  if (c.autoBatch){
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const a = analyzeSaliency(img);
    const rect = computeAutoCropRect(iw, ih, cropAspect, a);
    octx.drawImage(img, rect.sx, rect.sy, rect.cropW, rect.cropH, 0, 0, off.width, off.height);
  } else {
    drawManualCropToCanvas(img, octx, off.width, off.height, c);
  }

  ctx.drawImage(off, px, py, photoW, photoH);
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
  hardRotationSteps = 0;
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
