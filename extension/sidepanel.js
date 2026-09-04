import { renderLineStack, renderCollage, clearBitmapCache } from './engine.js';
import { icon as ICON, applyIcons, chinchilla } from './icons.js';
import {
  loadFrames,
  saveFrames as writeFrames,
  clearFrames,
  captureFrame,
  appendCapture,
  appendUpload,
  onFramesChanged,
  MAX_FRAMES,
} from './store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const { insertionIndexForPoint, reorderByInsertion, latestCaptureFrame } = globalThis.YTFrameCore;

function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatTime(seconds) {
  if (typeof seconds !== 'number') return '—';
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let frames = [];
let autoTimer = null;
let autoRunning = false;
let autoVideoId = null;
let exportMode = 'linestack'; // 'linestack' | 'collage'
let selectedId = null;

let lastStackBlobs = [];
let lastCollageBlob = null;
let lastCollageLayout = null;
let previewUrl = null;
let previewToken = 0;
let dragState = null;
let reorderState = null;
let dragCueText = '';
let frameSaveQueue = Promise.resolve();
let frameSavesPending = 0;

// Frame list drag-to-reorder state
let listDragFrom = null;
let listDragOverIndex = null;
let listDragOverPosition = null; // 'before' | 'after'

function saveFrames(next) {
  frameSavesPending += 1;
  const save = frameSaveQueue.then(() => writeFrames(next));
  frameSaveQueue = save.catch(() => {});
  return save.finally(() => { frameSavesPending -= 1; });
}

async function updateFrames(next) {
  frames = next;
  await saveFrames(frames);
  renderFrameList();
  schedulePreview();
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const els = {
  status: $('#status'),
  countLabel: $('#countLabel'),
  frameList: $('#frameList'),
  preview: $('#preview'),
  previewLabel: $('#previewLabel'),
  captureBtn: $('#captureBtn'),
  autoBtn: $('#autoBtn'),
  interval: $('#interval'),
  captureRule: $('#captureRule'),
  ratio: $('#bottomKeepRatio'),
  ratioLabel: $('#ratioLabel'),
  downloadExportBtn: $('#downloadExportBtn'),
  downloadCurrentBtn: $('#downloadCurrentBtn'),
  clearBtn: $('#clearBtn'),
  zoomInBtn: $('#zoomInBtn'),
  zoomOutBtn: $('#zoomOutBtn'),
  zoomResetBtn: $('#zoomResetBtn'),
  uploadBtn: $('#uploadBtn'),
  uploadInput: $('#uploadInput'),
  frameZoom: $('#frameZoom'),
  // Collage block editor
  blockEditor: $('#blockEditor'),
  blockTitle: $('#blockTitle'),
  blockClose: $('#blockClose'),
  blockZoom: $('#blockZoom'),
  zoomLabel: $('#zoomLabel'),
  blockOffsetX: $('#blockOffsetX'),
  blockOffsetY: $('#blockOffsetY'),
  blockReset: $('#blockReset'),
  blockSizeGroup: $('#blockSizeGroup'),
  blockSpan: $('#blockSpan'),
  spanLabel: $('#spanLabel'),
  blockHeight: $('#blockHeight'),
  heightLabel: $('#heightLabel'),
  frameCaption: $('#frameCaption'),
  frameCaptionHint: $('#frameCaptionHint'),
  frameType: $('#frameType'),
  frameCaptionScale: $('#frameCaptionScale'),
  frameCaptionScaleLabel: $('#frameCaptionScaleLabel'),
  frameEarlier: $('#frameEarlier'),
  frameLater: $('#frameLater'),
  frameDelete: $('#frameDelete'),
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function setStatus(message, cls = '') {
  els.status.className = `status ${cls}`;
  els.status.textContent = message;
}

// ---------------------------------------------------------------------------
// Preview zoom
// ---------------------------------------------------------------------------
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let previewZoom = 1;

function applyPreviewZoom() {
  const stage = document.getElementById('previewStage');
  if (stage) stage.style.zoom = String(previewZoom);
  if (els.zoomResetBtn) els.zoomResetBtn.textContent = `${Math.round(previewZoom * 100)}%`;
  if (els.zoomInBtn) els.zoomInBtn.disabled = previewZoom >= ZOOM_MAX;
  if (els.zoomOutBtn) els.zoomOutBtn.disabled = previewZoom <= ZOOM_MIN;
}

function setPreviewZoom(z) {
  previewZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  applyPreviewZoom();
}

function stepZoom(dir) {
  if (dir > 0) {
    const next = ZOOM_STEPS.find((s) => s > previewZoom + 1e-3);
    setPreviewZoom(next ?? ZOOM_MAX);
  } else {
    const rev = [...ZOOM_STEPS].reverse();
    const next = rev.find((s) => s < previewZoom - 1e-3);
    setPreviewZoom(next ?? ZOOM_MIN);
  }
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------
function setPreviewImage(blob, label) {
  els.preview.dataset.collage = exportMode === 'collage' ? '1' : '0';
  const nextUrl = URL.createObjectURL(blob);
  let img = document.getElementById('previewImg');
  if (!img) {
    els.preview.innerHTML =
      `<div class="preview-stage" id="previewStage">` +
        `<img id="previewImg" alt="${label} preview" draggable="false">` +
        `<div class="block-overlay" id="blockOverlay"></div>` +
      `</div>`;
    img = document.getElementById('previewImg');
  }
  const oldUrl = previewUrl;
  previewUrl = nextUrl;
  img.onload = () => { if (oldUrl && oldUrl !== nextUrl) URL.revokeObjectURL(oldUrl); };
  img.src = nextUrl;
  els.previewLabel.textContent = label;
  const overlay = document.getElementById('blockOverlay');
  if (overlay && exportMode !== 'collage') overlay.innerHTML = '';
  applyPreviewZoom();
}

function setPreviewEmpty(message) {
  els.preview.dataset.collage = '0';
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  els.preview.innerHTML = `<div class="empty-illu">${chinchilla(80)}<div class="bubble"><span>${escapeHtml(message)}</span></div></div>`;
}

// ---------------------------------------------------------------------------
// Export mode switch
// ---------------------------------------------------------------------------
function setExportMode(mode) {
  exportMode = mode;
  $$('.mode-switch__btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $$('[data-settings]').forEach((p) => { p.hidden = p.dataset.settings !== mode; });
  // Update export button label
  els.downloadExportBtn.innerHTML = mode === 'linestack'
    ? `${ICON('download')}<span class="btxt">Download LineStack</span>`
    : `${ICON('download')}<span class="btxt">Download Collage</span>`;
  // In collage mode, the block overlay is active
  if (mode !== 'collage') {
    const overlay = document.getElementById('blockOverlay');
    if (overlay) overlay.innerHTML = '';
    els.blockEditor.hidden = true;
    selectedId = null;
  }
  syncBlockEditor();
  schedulePreview();
}

$$('.mode-switch__btn').forEach((btn) => {
  btn.addEventListener('click', () => setExportMode(btn.dataset.mode));
});

// ---------------------------------------------------------------------------
// Frame list rendering
// ---------------------------------------------------------------------------
function renderFrameList() {
  els.countLabel.textContent = `${frames.length} / ${MAX_FRAMES}`;
  if (!frames.length) {
    els.frameList.innerHTML = '<p class="empty">Capture frames to start building your stack.</p>';
    return;
  }
  els.frameList.innerHTML = frames.map((f, i) => {
    const pos = String(i + 1).padStart(2, '0');
    const sel = f.id === selectedId;
    const cap = f.captionText ? escapeHtml(f.captionText) : '';
    const capClass = f.hasBakedCaption ? 'frame-card__caption' : 'frame-card__caption editable';
    const capAttr = f.hasBakedCaption
      ? ''
      : ` contenteditable="true" data-placeholder="Add caption…" data-caption-id="${f.id}"`;
    const typeLabel = f.type === 'keyframe' ? 'KEY' : 'SUB';
    return `<div class="frame-card ${sel ? 'selected' : ''}" data-index="${i}" data-id="${f.id}" data-type="${f.type}" draggable="false">
      <div class="frame-card__grip" data-grip="${i}" title="Drag to reorder">⠿${pos}</div>
      <div class="frame-card__thumb">
        <img src="${f.url}" alt="Frame ${pos}" loading="lazy" draggable="false">
      </div>
      <div class="frame-card__info">
        <div class="frame-card__title">
          <span>#${pos}</span>
          <span class="frame-card__time">${formatTime(f.time)}</span>
        </div>
        <div class="${capClass}"${capAttr}>${cap}</div>
      </div>
      <div class="frame-card__actions">
        <button class="type-toggle" data-action="toggle-type" data-active="${f.type}" title="Toggle keyframe / subtitle band">${typeLabel}</button>
        <button class="ghost" data-action="delete" title="Delete frame">${ICON('remove', 10)}</button>
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Frame list interactions
// ---------------------------------------------------------------------------

// Click handler for type toggle, delete, and caption editing
els.frameList.addEventListener('click', async (ev) => {
  const actionBtn = ev.target.closest('[data-action]');
  if (!actionBtn) return;
  const card = actionBtn.closest('.frame-card');
  if (!card) return;
  const idx = Number(card.dataset.index);
  const action = actionBtn.dataset.action;

  if (action === 'toggle-type') {
    const f = frames[idx];
    const next = frames.map((x, j) =>
      j === idx ? { ...x, type: x.type === 'keyframe' ? 'subtitle' : 'keyframe' } : x
    );
    await updateFrames(next);
  } else if (action === 'delete') {
    const next = frames.filter((_, j) => j !== idx);
    if (selectedId === frames[idx]?.id) selectedId = null;
    await updateFrames(next);
  }
});

// Inline caption editing
async function saveCaptionEdit(id, el) {
  const text = el.textContent.trim();
  const f = frames.find((x) => x.id === id);
  if (!f || text === (f.captionText || '')) return;
  frames = frames.map((x) => (x.id === id ? { ...x, captionText: text } : x));
  await saveFrames(frames);
  schedulePreview();
}

els.frameList.addEventListener('blur', (ev) => {
  const el = ev.target.closest('.caption.editable, .frame-card__caption.editable');
  if (el?.dataset.captionId) saveCaptionEdit(el.dataset.captionId, el);
}, true);

els.frameList.addEventListener('keydown', (ev) => {
  const el = ev.target.closest('.frame-card__caption.editable');
  if (!el) return;
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
});

// ---------------------------------------------------------------------------
// Frame list drag-to-reorder (pointer-based, via grip handle)
// ---------------------------------------------------------------------------
let listPointerState = null;

els.frameList.addEventListener('pointerdown', (ev) => {
  const grip = ev.target.closest('.frame-card__grip');
  if (!grip) return;
  const card = grip.closest('.frame-card');
  if (!card) return;
  ev.preventDefault();
  const idx = Number(card.dataset.index);
  listPointerState = {
    fromIndex: idx,
    startX: ev.clientX,
    startY: ev.clientY,
    moved: false,
    card,
  };
  card.classList.add('dragging');
  grip.setPointerCapture(ev.pointerId);
});

els.frameList.addEventListener('pointermove', (ev) => {
  if (!listPointerState) return;
  const distance = Math.hypot(ev.clientX - listPointerState.startX, ev.clientY - listPointerState.startY);
  if (distance < 5) return;
  listPointerState.moved = true;

  // Find which card the pointer is over
  $$('.frame-card', els.frameList).forEach((c) => {
    c.classList.remove('drop-before', 'drop-after');
  });

  const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.frame-card');
  if (!target || target === listPointerState.card) return;

  const rect = target.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const position = ev.clientY < midY ? 'before' : 'after';
  target.classList.add(`drop-${position}`);
  listDragOverIndex = Number(target.dataset.index);
  listDragOverPosition = position;
});

els.frameList.addEventListener('pointerup', async (ev) => {
  if (!listPointerState) return;
  const state = listPointerState;
  listPointerState = null;
  state.card.classList.remove('dragging');
  $$('.frame-card', els.frameList).forEach((c) => {
    c.classList.remove('drop-before', 'drop-after');
  });

  if (!state.moved || listDragOverIndex == null) {
    listDragOverIndex = null;
    listDragOverPosition = null;
    return;
  }

  let targetIndex = listDragOverIndex;
  if (listDragOverPosition === 'after') targetIndex += 1;
  listDragOverIndex = null;
  listDragOverPosition = null;

  if (targetIndex !== state.fromIndex) {
    const next = reorderByInsertion(frames, state.fromIndex, targetIndex);
    await updateFrames(next);
  }
});

els.frameList.addEventListener('pointercancel', () => {
  if (listPointerState) {
    listPointerState.card.classList.remove('dragging');
    listPointerState = null;
  }
  $$('.frame-card', els.frameList).forEach((c) => {
    c.classList.remove('drop-before', 'drop-after');
  });
});

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
function applyCaptureRule(nextFrames) {
  const rule = els.captureRule.value;
  if (rule === 'caption-aware') return nextFrames;
  return nextFrames.map((f, i) => {
    if (rule === 'first-keyframe') return { ...f, type: i === 0 ? 'keyframe' : 'subtitle' };
    if (rule === 'all-subtitle') return { ...f, type: 'subtitle' };
    return f;
  });
}

async function captureAndStore({ auto = false } = {}) {
  els.captureBtn.disabled = true;
  try {
    setStatus('Capturing…');
    const response = await captureFrame();
    if (auto) {
      if (autoVideoId && response.videoId && response.videoId !== autoVideoId) {
        stopAuto();
        setStatus('Auto stopped — video changed.', 'warn');
        return;
      }
      autoVideoId ||= response.videoId;
    }
    let next = await appendCapture(response);
    next = applyCaptureRule(next);
    frames = next;
    await saveFrames(frames);
    renderFrameList();
    schedulePreview();
    setStatus(`Captured #${frames.length}`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'warn');
  } finally {
    els.captureBtn.disabled = false;
  }
}

async function autoTick() {
  if (!autoRunning) return;
  await captureAndStore({ auto: true });
  if (!autoRunning) return;
  const delay = Math.max(0.5, Math.min(60, Number(els.interval.value) || 1)) * 1000;
  autoTimer = setTimeout(autoTick, delay);
}

function stopAuto() {
  autoRunning = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  autoVideoId = null;
  els.autoBtn.innerHTML = `${ICON('play')}<span class="btxt">Auto</span>`;
  els.autoBtn.classList.add('secondary');
}

function startAuto() {
  autoRunning = true;
  autoVideoId = null;
  els.autoBtn.innerHTML = `${ICON('stop')}<span class="btxt">Stop</span>`;
  els.autoBtn.classList.remove('secondary');
  autoTick();
}

els.captureBtn.addEventListener('click', captureAndStore);
els.autoBtn.addEventListener('click', () => (autoRunning ? stopAuto() : startAuto()));

els.captureRule.addEventListener('change', async () => {
  await updateFrames(applyCaptureRule(frames));
});

// ---------------------------------------------------------------------------
// Upload / paste / drop images
// ---------------------------------------------------------------------------
async function uploadFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) {
    setStatus('Drop an image file (PNG, JPEG, or WebP).', 'warn');
    return;
  }
  els.uploadBtn.disabled = true;
  try {
    setStatus(`Adding ${imgs.length} image${imgs.length > 1 ? 's' : ''}…`);
    for (const f of imgs) frames = await appendUpload(f);
    await saveFrames(frames);
    renderFrameList();
    schedulePreview();
    setStatus(`Added ${imgs.length} image${imgs.length > 1 ? 's' : ''} (${frames.length}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'warn');
  } finally {
    els.uploadBtn.disabled = false;
  }
}

els.uploadBtn.addEventListener('click', () => els.uploadInput.click());
els.uploadInput.addEventListener('change', () => {
  const files = els.uploadInput.files;
  if (files && files.length) uploadFiles(files);
  els.uploadInput.value = '';
});

// Window-level drop for image files
const appEl = $('.app');
window.addEventListener('dragover', (ev) => {
  if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) {
    ev.preventDefault();
    appEl.classList.add('dragover');
  }
});
window.addEventListener('dragleave', (ev) => {
  if (!ev.relatedTarget || !appEl.contains(ev.relatedTarget)) appEl.classList.remove('dragover');
});
window.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  appEl.classList.remove('dragover');
  const files = ev.dataTransfer?.files ? [...ev.dataTransfer.files] : [];
  if (files.length) await uploadFiles(files);
});

// Paste from clipboard
window.addEventListener('paste', async (ev) => {
  const t = ev.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
  const items = ev.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  ev.preventDefault();
  await uploadFiles(files);
});

// ---------------------------------------------------------------------------
// Live preview (debounced)
// ---------------------------------------------------------------------------
let previewTimer = null;
function schedulePreview() {
  previewToken += 1;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 300);
}

function collageCfg() {
  return {
    layout: $('#collageLayout').value,
    columns: Number($('#collageColumns').value) || 2,
    cellAspect: Number($('#collageAspect').value) || 16 / 9,
    outputWidth: Number($('#collageWidth').value) || 1080,
    gap: Number($('#collageGap').value) || 0,
    backgroundColor: $('#collageBg').value,
    cornerRadius: Number($('#collageRadius').value) || 0,
    returnLayout: true,
  };
}

function stackCfg() {
  return {
    outputWidth: Number($('#stackWidth').value),
    bottomKeepRatio: Number($('#bottomKeepRatio').value),
    enableKeyframeGap: $('#enableGap').value === 'true',
    gapSize: Number($('#gapSize').value) || 0,
    watermarkText: $('#stackWatermark').value.trim(),
    jpgQuality: Number($('#stackQuality').value) || 0.9,
  };
}

async function runPreview() {
  if (!frames.length) {
    setPreviewEmpty('Capture frames — the preview updates automatically.');
    els.downloadExportBtn.disabled = true;
    els.downloadCurrentBtn.disabled = true;
    return;
  }

  const token = previewToken;
  try {
    if (exportMode === 'linestack') {
      const blobs = await renderLineStack(
        frames.map((f) => ({
          source: f.url,
          isKeyframe: f.type === 'keyframe',
          captionText: f.captionText,
          hasBakedCaption: f.hasBakedCaption,
          captionScale: f.captionScale,
        })),
        stackCfg()
      );
      if (token !== previewToken) return;
      lastStackBlobs = blobs;
      setPreviewImage(blobs[0], blobs.length > 1 ? `LineStack · page 1/${blobs.length}` : 'LineStack');
      els.downloadExportBtn.disabled = false;
    } else {
      const result = await renderCollage(
        frames.map((f) => ({
          source: f.url,
          view: f.view,
          block: f.block,
          captionText: f.captionText,
          hasBakedCaption: f.hasBakedCaption,
          captionScale: f.captionScale,
        })),
        collageCfg()
      );
      if (token !== previewToken || !result) return;
      lastCollageBlob = result.blob;
      lastCollageLayout = { layout: result.layout, width: result.width, height: result.height };
      setPreviewImage(result.blob, 'Collage');
      buildBlockOverlay();
      els.downloadExportBtn.disabled = false;
    }
  } catch (err) {
    if (token !== previewToken) return;
    console.error(err);
    setStatus(`Preview failed: ${err.message || err}`, 'warn');
  }

  // Enable download current frame
  els.downloadCurrentBtn.disabled = !latestCaptureFrame(frames);
}

// ---------------------------------------------------------------------------
// Collage block overlay
// ---------------------------------------------------------------------------
function buildBlockOverlay() {
  const overlay = document.getElementById('blockOverlay');
  if (!overlay || !lastCollageLayout || exportMode !== 'collage') {
    if (overlay) overlay.innerHTML = '';
    return;
  }
  const isMasonry = $('#collageLayout').value === 'masonry';
  const W = lastCollageLayout.width;
  const H = lastCollageLayout.height;
  overlay.innerHTML = lastCollageLayout.layout
    .map((cell) => {
      const frame = frames[cell.index];
      if (!frame) return '';
      const sel = frame.id === selectedId;
      const dragging = dragState && dragState.id === frame.id;
      const left = (cell.x / W) * 100;
      const top = (cell.y / H) * 100;
      const w = (cell.w / W) * 100;
      const h = (cell.h / H) * 100;
      const pos = String(cell.index + 1).padStart(2, '0');
      const handles = isMasonry
        ? `<span class="bh bh-e" data-edge="e"></span>
           <span class="bh bh-s" data-edge="s"></span>
           <span class="bh bh-se" data-edge="se"></span>`
        : '';
      const cue = dragging && dragCueText ? `<span class="block-box__cue">${dragCueText}</span>` : '';
      return `<div class="block-box ${sel ? 'selected' : ''} ${dragging ? 'dragging' : ''}" data-index="${cell.index}" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%">
        <span class="block-box__grip" title="Drag to reorder">⠿ #${pos}</span>
        ${cue}
        ${handles}
      </div>`;
    })
    .join('');
}

// Block overlay pointer events (collage drag: pan, resize, reorder)
els.preview.addEventListener('pointerdown', (ev) => {
  if (exportMode !== 'collage') return;
  const grip = ev.target.closest('.block-box__grip');
  const edge = ev.target.closest('.bh');
  const box = ev.target.closest('.block-box');
  if (!box) return;

  const index = Number(box.dataset.index);
  const f = frames[index];
  if (!f) return;

  selectedId = f.id;
  syncBlockEditor();
  buildBlockOverlay();

  if (grip) {
    // Start reorder
    reorderState = {
      fromIndex: index,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      insertionIndex: index,
    };
    ev.preventDefault();
    els.preview.setPointerCapture?.(ev.pointerId);
    return;
  }

  if (edge) {
    // Start resize (masonry only)
    const img = document.getElementById('previewImg');
    if (!img || !lastCollageLayout) return;
    const scale = lastCollageLayout.width / img.getBoundingClientRect().width;
    const cell = lastCollageLayout.layout[index];
    dragState = {
      id: f.id,
      index,
      box,
      mode: edge.dataset.edge,
      startX: ev.clientX,
      startY: ev.clientY,
      startSpan: f.block.colSpan,
      startHeight: f.block.heightScale,
      startBoxW: parseFloat(box.style.width),
      startBoxH: parseFloat(box.style.height),
      scale,
      cols: Number($('#collageColumns').value) || 2,
      cellUnit: (lastCollageLayout.width - (Number($('#collageGap').value) || 0) * (Number($('#collageColumns').value) + 1)) / (Number($('#collageColumns').value) || 1),
      baseHOutput: cell ? cell.h / (f.block.heightScale || 1) : 200,
      cellW: cell ? cell.w : 200,
      cellH: cell ? cell.h : 200,
      moved: false,
    };
    ev.preventDefault();
    els.preview.setPointerCapture?.(ev.pointerId);
    return;
  }

  // Pan
  const img = document.getElementById('previewImg');
  if (!img || !lastCollageLayout) return;
  const cell = lastCollageLayout.layout[index];
  if (!cell) return;
  const scale = lastCollageLayout.width / img.getBoundingClientRect().width;
  dragState = {
    id: f.id,
    index,
    box,
    mode: 'pan',
    startX: ev.clientX,
    startY: ev.clientY,
    startOffX: f.view.offsetX,
    startOffY: f.view.offsetY,
    startBoxW: parseFloat(box.style.width),
    startBoxH: parseFloat(box.style.height),
    scale,
    cellW: cell.w / scale,
    cellH: cell.h / scale,
    moved: false,
  };
  ev.preventDefault();
  els.preview.setPointerCapture?.(ev.pointerId);
});

els.preview.addEventListener('pointermove', (ev) => {
  if (reorderState) {
    const distance = Math.hypot(ev.clientX - reorderState.startX, ev.clientY - reorderState.startY);
    if (distance < 6) return;
    reorderState.moved = true;
    $$('.block-box', els.preview).forEach((b) => b.classList.remove('insert-before', 'insert-after'));
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.block-box');
    if (!target) return;
    const tidx = Number(target.dataset.index);
    const ins = insertionIndexForPoint(tidx, target.getBoundingClientRect(), ev.clientX, ev.clientY);
    reorderState.insertionIndex = ins;
    target.classList.add(ins === tidx ? 'insert-before' : 'insert-after');
    const source = $(`.block-box[data-index="${reorderState.fromIndex}"]`, els.preview);
    if (source) source.classList.add('reorder-source');
    return;
  }
  if (!dragState) return;
  const f = frames.find((x) => x.id === dragState.id);
  if (!f) return;
  const dxCss = ev.clientX - dragState.startX;
  const dyCss = ev.clientY - dragState.startY;

  if (dragState.mode === 'pan') {
    const offsetX = Math.max(-1, Math.min(1, dragState.startOffX + (dxCss / Math.max(1, dragState.cellW)) * 2));
    const offsetY = Math.max(-1, Math.min(1, dragState.startOffY + (dyCss / Math.max(1, dragState.cellH)) * 2));
    dragState.moved = true;
    els.blockOffsetX.value = offsetX;
    els.blockOffsetY.value = offsetY;
    dragCueText = `⤢ ${offsetX.toFixed(2)}, ${offsetY.toFixed(2)}`;
    updateLiveCue();
    patchSelectedView({ offsetX, offsetY }, { rerender: false });
    scheduleLiveRender();
  } else {
    const patch = {};
    if (dragState.mode.includes('e') || dragState.mode.includes('se')) {
      const dxOut = dxCss * dragState.scale;
      const spanDelta = Math.round(dxOut / dragState.cellUnit);
      patch.colSpan = Math.max(1, Math.min(dragState.cols, dragState.startSpan + spanDelta));
    }
    if (dragState.mode.includes('s')) {
      const dyOut = dyCss * dragState.scale;
      patch.heightScale = Math.max(0.4, Math.min(2.5, dragState.startHeight + dyOut / Math.max(1, dragState.baseHOutput)));
      patch.heightScale = Math.round(patch.heightScale * 20) / 20;
    }
    dragState.moved = true;
    dragCueText = `${patch.colSpan ?? f.block.colSpan} col · ${Number(patch.heightScale ?? f.block.heightScale).toFixed(2)}×`;
    updateLiveCue();
    patchSelectedBlock(patch, { rerender: false });
    scheduleLiveRender();
  }
});

// rAF-throttled live render during collage drag
let liveRenderPending = false;
let liveRenderBusy = false;
function scheduleLiveRender() {
  if (liveRenderPending) return;
  liveRenderPending = true;
  requestAnimationFrame(runLiveRender);
}

async function runLiveRender() {
  liveRenderPending = false;
  if (!dragState || liveRenderBusy || exportMode !== 'collage') return;
  liveRenderBusy = true;
  try {
    const result = await renderCollage(
      frames.map((f) => ({
        source: f.url, view: f.view, block: f.block,
        captionText: f.captionText, hasBakedCaption: f.hasBakedCaption, captionScale: f.captionScale,
      })),
      collageCfg()
    );
    if (!result || !dragState) return;
    lastCollageBlob = result.blob;
    lastCollageLayout = { layout: result.layout, width: result.width, height: result.height };
    const img = document.getElementById('previewImg');
    if (img) {
      const nextUrl = URL.createObjectURL(result.blob);
      const oldUrl = previewUrl;
      img.onload = () => { if (oldUrl && oldUrl !== nextUrl) URL.revokeObjectURL(oldUrl); };
      previewUrl = nextUrl;
      img.src = nextUrl;
    }
    buildBlockOverlay();
    if (dragState) {
      const box = document.querySelector(`.block-box[data-index="${dragState.index}"]`);
      if (box) {
        dragState.box = box;
        box.classList.add('dragging', 'selected');
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    liveRenderBusy = false;
  }
}

function updateLiveCue() {
  if (!dragState || !dragState.box) return;
  let cue = dragState.box.querySelector('.block-box__cue');
  if (!cue) {
    cue = document.createElement('span');
    cue.className = 'block-box__cue';
    dragState.box.appendChild(cue);
  }
  cue.textContent = dragCueText;
  dragState.box.classList.add('dragging', 'selected');
}

function endDrag() {
  if (!dragState) return;
  dragState = null;
  dragCueText = '';
  buildBlockOverlay();
}

async function endPointer(ev, { cancel = false } = {}) {
  if (reorderState) {
    const state = reorderState;
    reorderState = null;
    if (!cancel && state.moved) await updateFrames(reorderByInsertion(frames, state.fromIndex, state.insertionIndex));
    else buildBlockOverlay();
    els.preview.releasePointerCapture?.(ev.pointerId);
    return;
  }
  endDrag();
}

els.preview.addEventListener('pointerup', (ev) => endPointer(ev));
els.preview.addEventListener('pointercancel', (ev) => endPointer(ev, { cancel: true }));
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && reorderState) {
    reorderState = null;
    buildBlockOverlay();
  }
});

// ---------------------------------------------------------------------------
// Collage block editor (bottom sheet)
// ---------------------------------------------------------------------------
function selectedFrame() {
  return frames.find((f) => f.id === selectedId) || null;
}

function syncBlockEditor() {
  const f = selectedFrame();
  if (!f || exportMode !== 'collage') {
    els.blockEditor.hidden = true;
    return;
  }
  const pos = frames.findIndex((x) => x.id === f.id) + 1;
  const isMasonry = $('#collageLayout').value === 'masonry';
  els.blockEditor.hidden = false;
  els.blockTitle.textContent = `Block #${String(pos).padStart(2, '0')}`;
  els.blockSizeGroup.style.display = isMasonry ? '' : 'none';
  const maxSpan = Math.max(1, Math.min(6, Number($('#collageColumns').value) || 1));
  els.blockSpan.max = String(maxSpan);
  els.blockSpan.value = Math.min(maxSpan, f.block.colSpan);
  els.spanLabel.textContent = `${els.blockSpan.value}`;
  els.blockHeight.value = f.block.heightScale;
  els.heightLabel.textContent = `${Number(f.block.heightScale).toFixed(2)}×`;
  els.blockZoom.value = f.view.zoom;
  els.zoomLabel.textContent = `${Number(f.view.zoom).toFixed(2)}×`;
  els.blockOffsetX.value = f.view.offsetX;
  els.blockOffsetY.value = f.view.offsetY;
  els.frameCaption.value = f.captionText || '';
  els.frameCaption.disabled = Boolean(f.hasBakedCaption);
  els.frameCaptionHint.textContent = f.hasBakedCaption ? 'captured in image' : '';
  els.frameType.value = f.type;
  els.frameCaptionScale.value = f.captionScale || 1;
  els.frameCaptionScale.disabled = Boolean(f.hasBakedCaption);
  els.frameCaptionScaleLabel.textContent = `${Number(f.captionScale || 1).toFixed(1)}×`;
  els.frameEarlier.disabled = pos <= 1;
  els.frameLater.disabled = pos >= frames.length;
}

async function patchSelectedBlock(patch, { rerender = true } = {}) {
  const f = selectedFrame();
  if (!f) return;
  frames = frames.map((x) => (x.id === f.id ? { ...x, block: { ...x.block, ...patch } } : x));
  await saveFrames(frames);
  const cur = selectedFrame();
  if (cur) {
    els.spanLabel.textContent = `${cur.block.colSpan}`;
    els.heightLabel.textContent = `${Number(cur.block.heightScale).toFixed(2)}×`;
  }
  if (rerender) schedulePreview();
}

async function patchSelectedView(patch, { rerender = true } = {}) {
  const f = selectedFrame();
  if (!f) return;
  frames = frames.map((x) => (x.id === f.id ? { ...x, view: { ...x.view, ...patch } } : x));
  await saveFrames(frames);
  const cur = selectedFrame();
  if (cur) els.zoomLabel.textContent = `${Number(cur.view.zoom).toFixed(2)}×`;
  if (rerender) schedulePreview();
}

async function patchSelectedFrame(patch) {
  const f = selectedFrame();
  if (!f) return;
  await updateFrames(frames.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
  syncBlockEditor();
}

els.blockZoom.addEventListener('input', () => patchSelectedView({ zoom: Number(els.blockZoom.value) }));
els.blockOffsetX.addEventListener('input', () => patchSelectedView({ offsetX: Number(els.blockOffsetX.value) }));
els.blockOffsetY.addEventListener('input', () => patchSelectedView({ offsetY: Number(els.blockOffsetY.value) }));
els.blockSpan.addEventListener('input', () => {
  els.spanLabel.textContent = `${els.blockSpan.value}`;
  patchSelectedBlock({ colSpan: Number(els.blockSpan.value) });
});
els.blockHeight.addEventListener('input', () => {
  els.heightLabel.textContent = `${Number(els.blockHeight.value).toFixed(2)}×`;
  patchSelectedBlock({ heightScale: Number(els.blockHeight.value) });
});
els.blockReset.addEventListener('click', async () => {
  const f = selectedFrame();
  if (!f) return;
  frames = frames.map((x) => (x.id === f.id
    ? { ...x, view: { zoom: 1, offsetX: 0, offsetY: 0 }, block: { colSpan: 1, heightScale: 1 } }
    : x));
  await saveFrames(frames);
  syncBlockEditor();
  schedulePreview();
});

els.frameCaption.addEventListener('change', () => patchSelectedFrame({ captionText: els.frameCaption.value.trim() }));
els.frameType.addEventListener('change', () => patchSelectedFrame({ type: els.frameType.value }));
els.frameCaptionScale.addEventListener('input', () => {
  const value = Number(els.frameCaptionScale.value);
  els.frameCaptionScaleLabel.textContent = `${value.toFixed(1)}×`;
  patchSelectedFrame({ captionScale: value });
});
els.frameEarlier.addEventListener('click', () => {
  const index = frames.findIndex((f) => f.id === selectedId);
  if (index > 0) updateFrames(move(frames, index, index - 1));
});
els.frameLater.addEventListener('click', () => {
  const index = frames.findIndex((f) => f.id === selectedId);
  if (index >= 0 && index < frames.length - 1) updateFrames(move(frames, index, index + 1));
});
els.frameDelete.addEventListener('click', () => {
  const index = frames.findIndex((f) => f.id === selectedId);
  if (index < 0) return;
  const next = frames.filter((_, i) => i !== index);
  selectedId = next[Math.min(index, next.length - 1)]?.id || null;
  updateFrames(next);
});

els.blockClose.addEventListener('click', () => {
  selectedId = null;
  syncBlockEditor();
  buildBlockOverlay();
});

$('#collageLayout').addEventListener('change', syncBlockEditor);
$('#collageColumns').addEventListener('input', syncBlockEditor);

// ---------------------------------------------------------------------------
// Export settings -> live preview
// ---------------------------------------------------------------------------
els.ratio.addEventListener('input', () => {
  els.ratioLabel.textContent = `${Math.round(Number(els.ratio.value) * 100)}%`;
});
els.ratio.dispatchEvent(new Event('input'));

const stackControls = ['#stackWidth', '#stackQuality', '#bottomKeepRatio', '#enableGap', '#gapSize', '#stackWatermark'];
const collageControls = ['#collageLayout', '#collageColumns', '#collageAspect', '#collageWidth', '#collageGap', '#collageRadius', '#collageBg'];
[...stackControls, ...collageControls].forEach((sel) => {
  const el = $(sel);
  if (el) el.addEventListener('input', schedulePreview);
});

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
els.downloadExportBtn.addEventListener('click', () => {
  if (exportMode === 'linestack') {
    lastStackBlobs.forEach((blob, i) => {
      const suffix = lastStackBlobs.length > 1 ? `-${String(i + 1).padStart(2, '0')}` : '';
      downloadBlob(blob, `youtube-linestack${suffix}.jpg`);
    });
  } else {
    downloadBlob(lastCollageBlob, 'youtube-collage.jpg');
  }
});

els.downloadCurrentBtn.addEventListener('click', () => {
  const frame = latestCaptureFrame(frames);
  if (!frame) return;
  const a = document.createElement('a');
  a.href = frame.url;
  a.download = `youtube-frame-${String(frames.length).padStart(2, '0')}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

els.clearBtn.addEventListener('click', async () => {
  stopAuto();
  await clearFrames();
  clearBitmapCache();
  frames = [];
  selectedId = null;
  renderFrameList();
  syncBlockEditor();
  schedulePreview();
  setStatus('Cleared all frames.');
});

// ---------------------------------------------------------------------------
// Preview zoom controls
// ---------------------------------------------------------------------------
els.zoomInBtn.addEventListener('click', () => stepZoom(1));
els.zoomOutBtn.addEventListener('click', () => stepZoom(-1));
els.zoomResetBtn.addEventListener('click', () => setPreviewZoom(1));
els.preview.addEventListener('wheel', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  stepZoom(ev.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
applyIcons();
applyPreviewZoom();
setPreviewEmpty('Capture frames — the preview updates automatically.');

loadFrames().then((loaded) => {
  frames = loaded;
  renderFrameList();
  schedulePreview();
});

onFramesChanged((next) => {
  if (frameSavesPending) return;
  frames = next;
  if (selectedId && !frames.some((f) => f.id === selectedId)) selectedId = null;
  renderFrameList();
  syncBlockEditor();
  schedulePreview();
});
