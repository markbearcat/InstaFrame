
/* ============================================================
   InstaFrame — client-side photo cropper/framer PWA
   No dependencies. Canvas-based editing.
   ============================================================ */

const state = {
  files: [],          // { id, img, name }
  mode: 'individual',  // 'individual' | 'batch'
  cropIndex: 0,
  crops: {},           // id -> { ratio, rotation, offsetX, offsetY, scale }
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

/* ---------------- STEP 2: CROP / STRAIGHTEN ---------------- */

const cropCanvas = el('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
let cropRatio = 0.75; // width/height, 4:3 landscape default (0.75 = 3/4 -> we store as h/w? define below)
// We'll define ratio as WIDTH/HEIGHT of the crop box.
// 4:3 button -> landscape-ish crop box width:height = 4:3 -> ratio=1.3333 ... but spec says "sticking to 4:3 or 3:4"
// seg-btn data-ratio values: 0.75 (=3:4 portrait) and 1.3333 (=4:3 landscape). We'll treat data-ratio as width/height.

let crop = {
  ratio: 0.75,      // width/height of crop box
  rotation: 0,       // degrees
  scale: 1,           // zoom of image within crop
  offsetX: 0,          // pan in source-image px (at scale=1 baseline)
  offsetY: 0,
  minScale: 1
};

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
  crop = existing ? {...existing} : { ratio: 0.75, rotation: 0, scale: 1, offsetX: 0, offsetY: 0, minScale: 1 };
  setupCropCanvas();
  showScreen('crop');
}

function setupCropCanvas(){
  const wrap = cropCanvas.parentElement;
  const cssW = wrap.clientWidth;
  const cssH = wrap.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cropCanvas.width = cssW * dpr;
  cropCanvas.height = cssH * dpr;
  cropCtx.setTransform(dpr,0,0,dpr,0,0);

  // sync ratio buttons UI
  document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.ratio) === crop.ratio);
  });
  el('rotateSlider').value = crop.rotation;
  el('rotateValue').textContent = `${crop.rotation}°`;

  fitMinScale();
  drawCrop();
}

function fitMinScale(){
  const f = currentFile();
  const img = f.img;
  const wrap = cropCanvas.parentElement;
  const boxW = wrap.clientWidth;
  const boxH = wrap.clientHeight; // this represents the crop box area (canvas fills it, ratio letterboxed conceptually)
  // crop box true aspect = crop.ratio (w/h). The visible canvas area IS the crop box (we always show exactly the crop area, cover-fitted).
  const rad = crop.rotation * Math.PI/180;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  // bounding box of rotated image
  const rw = Math.abs(iw*Math.cos(rad)) + Math.abs(ih*Math.sin(rad));
  const rh = Math.abs(iw*Math.sin(rad)) + Math.abs(ih*Math.cos(rad));
  // min scale so rotated image covers the crop box (box aspect = crop.ratio, normalize to boxW:boxH pixel canvas)
  const coverScale = Math.max(boxW/rw, boxH/rh);
  crop.minScale = coverScale;
  if (crop.scale < coverScale) crop.scale = coverScale;
}

function drawCrop(){
  const f = currentFile();
  const img = f.img;
  const wrap = cropCanvas.parentElement;
  const boxW = wrap.clientWidth;
  const boxH = wrap.clientHeight;

  cropCtx.clearRect(0,0,boxW,boxH);
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0,0,boxW,boxH);

  cropCtx.save();
  cropCtx.translate(boxW/2 + crop.offsetX, boxH/2 + crop.offsetY);
  cropCtx.rotate(crop.rotation * Math.PI/180);
  cropCtx.scale(crop.scale, crop.scale);
  cropCtx.drawImage(img, -img.naturalWidth/2, -img.naturalHeight/2);
  cropCtx.restore();
}

// keep canvas box aspect locked to crop.ratio via CSS aspect-ratio on wrapper
function applyBoxAspect(){
  cropCanvas.parentElement.style.aspectRatio = `${crop.ratio} / 1`;
}

window.addEventListener('resize', () => { setupCropCanvas(); });

// ratio toggle
document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-crop .seg-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    crop.ratio = parseFloat(btn.dataset.ratio);
    applyBoxAspect();
    requestAnimationFrame(()=>{ fitMinScale(); drawCrop(); });
  });
});
applyBoxAspect();

// rotation slider
el('rotateSlider').addEventListener('input', (e) => {
  crop.rotation = parseFloat(e.target.value);
  el('rotateValue').textContent = `${crop.rotation}°`;
  fitMinScale();
  drawCrop();
});

el('btnRotate90').addEventListener('click', () => {
  // swap ratio to emulate 90deg turn visually + rotate image 90
  crop.rotation = ((crop.rotation + 90 + 45) % 90) - 45 + Math.round(crop.rotation/90)*0; // keep simple: just add 90 then normalize into slider range via separate hard rotation
  // Simplify: apply a hard 90deg turn independent of slider fine-rotation
  hardRotate90();
});

let hardRotationSteps = 0; // 0..3, applied via drawing transform separately from fine rotation
function hardRotate90(){
  hardRotationSteps = (hardRotationSteps + 1) % 4;
  // swap crop ratio to its inverse to match new orientation feel
  crop.ratio = crop.ratio === 0.75 ? 1.3333 : 0.75;
  document.querySelectorAll('#screen-crop .seg-btn').forEach(btn => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.ratio) - crop.ratio) < 0.001);
  });
  applyBoxAspect();
  requestAnimationFrame(()=>{ fitMinScale(); drawCrop(); });
}

// Redefine drawCrop/fitMinScale to include hardRotationSteps
const _origFit = fitMinScale;
fitMinScale = function(){
  const f = currentFile();
  const img = f.img;
  const wrap = cropCanvas.parentElement;
  const boxW = wrap.clientWidth;
  const boxH = wrap.clientHeight;
  const totalRad = (crop.rotation + hardRotationSteps*90) * Math.PI/180;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const rw = Math.abs(iw*Math.cos(totalRad)) + Math.abs(ih*Math.sin(totalRad));
  const rh = Math.abs(iw*Math.sin(totalRad)) + Math.abs(ih*Math.cos(totalRad));
  const coverScale = Math.max(boxW/rw, boxH/rh);
  crop.minScale = coverScale;
  if (crop.scale < coverScale) crop.scale = coverScale;
};
drawCrop = function(){
  const f = currentFile();
  const img = f.img;
  const wrap = cropCanvas.parentElement;
  const boxW = wrap.clientWidth;
  const boxH = wrap.clientHeight;

  cropCtx.clearRect(0,0,boxW,boxH);
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0,0,boxW,boxH);

  cropCtx.save();
  cropCtx.translate(boxW/2 + crop.offsetX, boxH/2 + crop.offsetY);
  cropCtx.rotate((crop.rotation + hardRotationSteps*90) * Math.PI/180);
  cropCtx.scale(crop.scale, crop.scale);
  cropCtx.drawImage(img, -img.naturalWidth/2, -img.naturalHeight/2);
  cropCtx.restore();
};

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
  let lastMid = null;

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
      const mid = { x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2 };
      if (lastDist != null){
        const factor = dist / lastDist;
        crop.scale = Math.max(crop.minScale, Math.min(crop.scale * factor, crop.minScale * 6));
      }
      lastDist = dist;
      lastMid = mid;
      drawCrop();
    }
  });

  function clearPointer(e){
    pointers.delete(e.pointerId);
    if (pointers.size < 2){ lastDist = null; lastMid = null; }
  }
  wrap.addEventListener('pointerup', clearPointer);
  wrap.addEventListener('pointercancel', clearPointer);
  wrap.addEventListener('pointerleave', clearPointer);

  // mouse wheel zoom (desktop convenience)
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 0.95;
    crop.scale = Math.max(crop.minScale, Math.min(crop.scale * factor, crop.minScale * 6));
    drawCrop();
  }, { passive:false });
})();

/* ---- Auto crop: rule-of-thirds via saliency heuristic ---- */
el('btnAutoCrop').addEventListener('click', () => {
  autoCropCurrent();
});

function autoCropCurrent(){
  const f = currentFile();
  const img = f.img;
  const iw = img.naturalWidth, ih = img.naturalHeight;

  // Reset fine rotation/hard rotation for auto (assume roughly upright); keep straighten at 0
  crop.rotation = 0;
  hardRotationSteps = 0;
  el('rotateSlider').value = 0;
  el('rotateValue').textContent = '0°';

  // Analyze a downsampled version to find the "energy" centroid (edges/contrast)
  const analysis = analyzeSaliency(img);
  fitMinScale();

  const wrap = cropCanvas.parentElement;
  const boxW = wrap.clientWidth, boxH = wrap.clientHeight;

  // Determine crop rectangle in source-image space sized to match box aspect at min scale (tightest crop),
  // then shift so the saliency centroid lands on nearest rule-of-thirds intersection.
  const targetAspect = crop.ratio; // box w/h
  let cropW, cropH;
  if (iw/ih > targetAspect){
    cropH = ih;
    cropW = ih * targetAspect;
  } else {
    cropW = iw;
    cropH = iw / targetAspect;
  }

  // Slight zoom-in for tighter, more intentional composition (10%)
  cropW *= 0.92; cropH *= 0.92;

  // centroid in source pixel coords (0..iw, 0..ih)
  let cx = analysis.cx, cy = analysis.cy;

  // Choose nearest third-line intersection as the anchor point for the centroid
  const thirdsX = [iw/3, iw*2/3];
  const thirdsY = [ih/3, ih*2/3];
  const nearestX = thirdsX.reduce((a,b)=> Math.abs(b-cx)<Math.abs(a-cx)?b:a);
  const nearestY = thirdsY.reduce((a,b)=> Math.abs(b-cy)<Math.abs(a-cy)?b:a);

  // We want, within the crop rect, the centroid to sit at the corresponding third.
  // Determine crop rect top-left (sx, sy) such that (cx-sx)/cropW ≈ (nearestX==thirdsX[0]?1/3:2/3), etc.
  const fracX = nearestX === thirdsX[0] ? 1/3 : 2/3;
  const fracY = nearestY === thirdsY[0] ? 1/3 : 2/3;

  let sx = cx - fracX * cropW;
  let sy = cy - fracY * cropH;

  // clamp within image bounds
  sx = Math.max(0, Math.min(sx, iw - cropW));
  sy = Math.max(0, Math.min(sy, ih - cropH));

  // Convert (sx,sy,cropW,cropH) source rect into our transform model (offset + scale)
  // scale so that cropW maps to boxW (i.e., scale = boxW / cropW), matching box aspect exactly
  const scale = boxW / cropW;
  crop.scale = Math.max(crop.minScale, scale);

  // center of crop rect in source coords
  const rectCenterX = sx + cropW/2;
  const rectCenterY = sy + cropH/2;
  // image center in source coords
  const imgCenterX = iw/2;
  const imgCenterY = ih/2;

  // offset needed (in screen px) = -(rectCenter - imgCenter) * scale
  crop.offsetX = -(rectCenterX - imgCenterX) * crop.scale;
  crop.offsetY = -(rectCenterY - imgCenterY) * crop.scale;

  drawCrop();
  toast('Auto-cropped to rule of thirds');
}

function analyzeSaliency(img){
  const SAMPLE = 120; // analysis resolution
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

  // grayscale
  const gray = new Float32Array(sw*sh);
  for (let i=0;i<sw*sh;i++){
    const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
    gray[i] = 0.299*r + 0.587*g + 0.114*b;
  }

  // simple gradient magnitude (Sobel-ish) as saliency proxy, plus center-bias
  let totalW = 0, sumX = 0, sumY = 0;
  for (let y=1; y<sh-1; y++){
    for (let x=1; x<sw-1; x++){
      const idx = y*sw+x;
      const gx = gray[idx+1] - gray[idx-1];
      const gy = gray[idx+sw] - gray[idx-sw];
      let mag = Math.sqrt(gx*gx + gy*gy);

      // mild center bias so busy edges near frame border don't dominate
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

  // scale centroid back to full-res image coords
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
  // apply same relative crop settings to all; auto-crop per image individually if template came from auto,
  // simplest: just reuse rotation=0/hardRotationSteps + recompute per-image auto-fit at same ratio
  state.files.forEach(f => {
    if (!state.crops[f.id]){
      state.crops[f.id] = { ratio: template.ratio, rotation: 0, hardRotationSteps: template.hardRotationSteps, scale: 1, offsetX: 0, offsetY: 0, minScale: 1, autoBatch: true };
    }
  });
  goToFrameScreen();
});

/* ---------------- STEP 3+4: FRAME RATIO + COLOUR ---------------- */

function goToFrameScreen(){
  // ensure every file has a crop; batch-autofit any missing
  state.files.forEach(f => {
    if (!state.crops[f.id]){
      const ref = Object.values(state.crops)[0] || { ratio: 0.75, hardRotationSteps: 0 };
      state.crops[f.id] = { ratio: ref.ratio, rotation:0, hardRotationSteps: ref.hardRotationSteps||0, scale:1, offsetX:0, offsetY:0, minScale:1, autoBatch:true };
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
  canvas.height = Math.round(OUT * state.frameRatio); // frameRatio = height/width factor (1 or 1.25)
  renderFramedImage(f, canvas, OUT, canvas.height);
}

/* Renders the cropped photo (per its saved crop transform) centered into a framed canvas
   with the frame color as background/border, matching frameRatio (1 = square, 1.25 = 4:5). */
function renderFramedImage(f, canvas, outW, outH){
  const ctx = canvas.getContext('2d');
  const c = state.crops[f.id];
  const img = f.img;

  ctx.fillStyle = state.frameColor;
  ctx.fillRect(0,0,outW,outH);

  // Determine the crop box aspect (w/h) — this is what fills as much of the frame as possible
  const cropAspect = c.ratio; // width/height
  let photoW, photoH;
  const frameAspect = outW/outH;

  if (cropAspect > frameAspect){
    photoW = outW * 0.94;
    photoH = photoW / cropAspect;
  } else {
    photoH = outH * 0.94;
    photoW = photoH * cropAspect;
  }
  const px = (outW - photoW)/2;
  const py = (outH - photoH)/2;

  // Render source image with its crop transform into an offscreen canvas sized photoW x photoH
  const off = document.createElement('canvas');
  off.width = Math.round(photoW);
  off.height = Math.round(photoH);
  const octx = off.getContext('2d');

  const totalRot = (c.rotation||0) + (c.hardRotationSteps||0)*90;

  if (c.autoBatch){
    // compute an auto rule-of-thirds crop fresh for this image at the target aspect
    const a = analyzeSaliency(img);
    drawAutoCropToOffscreen(img, off, octx, a, cropAspect);
  } else {
    // replicate the on-screen crop transform proportionally into the offscreen box
    const scaleRatio = off.width / (document.getElementById('cropCanvas').parentElement.clientWidth || off.width);
    octx.save();
    octx.translate(off.width/2 + c.offsetX*scaleRatio, off.height/2 + c.offsetY*scaleRatio);
    octx.rotate(totalRot * Math.PI/180);
    octx.scale(c.scale*scaleRatio, c.scale*scaleRatio);
    octx.drawImage(img, -img.naturalWidth/2, -img.naturalHeight/2);
    octx.restore();
  }

  ctx.drawImage(off, px, py, photoW, photoH);
}

function drawAutoCropToOffscreen(img, off, octx, analysis, targetAspect){
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let cropW, cropH;
  if (iw/ih > targetAspect){ cropH = ih; cropW = ih*targetAspect; }
  else { cropW = iw; cropH = iw/targetAspect; }
  cropW *= 0.92; cropH *= 0.92;

  let cx = analysis.cx, cy = analysis.cy;
  const thirdsX = [iw/3, iw*2/3], thirdsY = [ih/3, ih*2/3];
  const nearestX = thirdsX.reduce((a,b)=> Math.abs(b-cx)<Math.abs(a-cx)?b:a);
  const nearestY = thirdsY.reduce((a,b)=> Math.abs(b-cy)<Math.abs(a-cy)?b:a);
  const fracX = nearestX === thirdsX[0] ? 1/3 : 2/3;
  const fracY = nearestY === thirdsY[0] ? 1/3 : 2/3;

  let sx = cx - fracX*cropW;
  let sy = cy - fracY*cropH;
  sx = Math.max(0, Math.min(sx, iw-cropW));
  sy = Math.max(0, Math.min(sy, ih-cropH));

  octx.drawImage(img, sx, sy, cropW, cropH, 0, 0, off.width, off.height);
}

el('btnFrameBack').addEventListener('click', () => {
  showScreen('crop');
});

el('btnFrameNext').addEventListener('click', () => {
  renderExportScreen();
  showScreen('export');
});

/* ---------------- STEP 5: EXPORT ---------------- */

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

  el('exportSummary').textContent = `${state.files.length} image${state.files.length===1?'':'s'} ready · ${state.frameRatio===1?'1:1':'4:5'} · ${state.frameColor==='#ffffff'?'White':'Black'} frame`;
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

  // Try native share/save (best UX on Android Chrome/PWA), fallback to download link
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
