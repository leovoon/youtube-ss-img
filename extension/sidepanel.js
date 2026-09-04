import { renderLineStack, renderCollage, clearBitmapCache } from './engine.js';
import { icon as ICON, applyIcons, emptyStateArt } from './icons.js';
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
const { insertionIndexForPoint, reorderByInsertion } = globalThis.YTFrameCore;

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
  if (typeof seconds !== 'number') return '';
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
let exportMode = 'linestack';
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

// Strip drag state
let stripDragState = null;

function saveFrames(next) {
  frameSavesPending += 1;
  const save = frameSaveQueue.then(() => writeFrames(next));
  frameSaveQueue = save.catch(() => {});
  return save.finally(() => { frameSavesPending -= 1; });
}

async function updateFrames(next) {
  frames = next;
  await saveFrames(frames);
  renderStrip();
  scheduleExport();
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const els = {
  status: $('#status'),
  countLabel: $('#countLabel'),
  outputStrip: $('#outputStrip'),
  previewContainer: $('#previewContainer'),
  previewLabel: $('#previewLabel'),
  emptyState: $('#emptyState'),
  captureBtn: $('#captureBtn'),
  autoBtn: $('#autoBtn'),
  interval: $('#interval'),
  captureRule: $('#captureRule'),
  ratio: null, // removed — per-frame crop only
  ratioLabel: null,
  downloadExportBtn: $('#downloadExportBtn'),
  clearBtn: $('#clearBtn'),
  zoomInBtn: $('#zoomInBtn'),
  zoomOutBtn: $('#zoomOutBtn'),
  zoomResetBtn: $('#zoomResetBtn'),
  uploadBtn: $('#uploadBtn'),
  uploadInput: $('#uploadInput'),
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
// Preview zoom (works for both strip and collage)
// ---------------------------------------------------------------------------
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let previewZoom = 1;

function applyPreviewZoom() {
  // For collage: zoom the preview stage
  const stage = document.getElementById('previewStage');
  if (stage) stage.style.zoom = String(previewZoom);
  // For strip: scale via width (reliable across browsers)
  const inner = document.getElementById('stripInner');
  if (inner) inner.style.width = `${previewZoom * 100}%`;
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
// Export mode switch
// ---------------------------------------------------------------------------
function setExportMode(mode) {
  exportMode = mode;
  $$('.mode-switch__btn').forEach((b) => {
    const isActive = b.dataset.mode === mode;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', String(isActive));
  });
  $$('[data-settings]').forEach((p) => { p.hidden = p.dataset.settings !== mode; });
  
  // Show/hide appropriate preview containers
  if (mode === 'linestack') {
    els.outputStrip.classList.add('active');
    els.previewContainer.hidden = true;
    els.downloadExportBtn.innerHTML = `${ICON('download')}<span class="btxt">Download LineStack</span>`;
    renderStrip();
  } else {
    els.outputStrip.classList.remove('active');
    els.previewContainer.hidden = false;
    els.downloadExportBtn.innerHTML = `${ICON('download')}<span class="btxt">Download Collage</span>`;
  }
  
  syncBlockEditor();
  scheduleExport();
}

$$('.mode-switch__btn').forEach((btn) => {
  btn.addEventListener('click', () => setExportMode(btn.dataset.mode));
});

// ---------------------------------------------------------------------------
// Output strip rendering (LineStack editing surface)
// ---------------------------------------------------------------------------

// Default crop: reads from current input values (type-bound presets)
function getDefaultCrop(type) {
  const top = (Number($('#defaultCropTop')?.value) || 0) / 100;
  const bottom = (Number($('#defaultCropBottom')?.value) || 0) / 100;
  return { top, bottom };
}

function renderStrip() {
  els.countLabel.textContent = `${frames.length} / ${MAX_FRAMES}`;
  
  if (!frames.length) {
    els.outputStrip.innerHTML = '';
    els.emptyState.hidden = false;
    els.emptyState.innerHTML = `<div class="empty-state__inner">
      ${emptyStateArt(80)}
      <p>No frames yet</p>
      <p class="empty-state__hint">Press Capture or Auto to start building your strip.</p>
      <p class="empty-state__hint">Enable YouTube captions for subtitle bands.</p>
    </div>`;
    return;
  }
  
  els.emptyState.hidden = true;
  
  // Gap settings
  const gapEnabled = $('#enableGap').value === 'true';
  const gapPx = Number($('#gapSize').value) || 0;
  
  // Watermark
  const watermark = $('#stackWatermark').value.trim();
  
  // Count visuals for gap logic
  const visualCount = frames.filter((f) => f.type === 'keyframe').length;
  const showGaps = gapEnabled && gapPx > 0 && visualCount >= 2;
  
  let html = '<div class="output-strip-inner" id="stripInner">';
  
  frames.forEach((f, i) => {
    const pos = String(i + 1).padStart(2, '0');
    const defaults = getDefaultCrop(f.type);
    const cropTop = typeof f.cropTop === 'number' ? f.cropTop : defaults.top;
    const cropBottom = typeof f.cropBottom === 'number' ? f.cropBottom : defaults.bottom;
    const keptRatio = Math.max(0.05, 1 - cropTop - cropBottom);
    const topPct = Math.round(cropTop * 100);
    const bottomPct = Math.round(cropBottom * 100);
    const timeStr = formatTime(f.time);
    const caption = f.captionText ? escapeHtml(f.captionText) : '';
    
    const aspectH = 9 * keptRatio;
    const aspectRatio = `16 / ${aspectH}`;
    const imgTopPct = -(cropTop / keptRatio) * 100;
    
    // Gap before this frame
    const needsGap = showGaps && i > 0 && f.type === 'keyframe';
    if (needsGap) {
      html += `<div class="strip-gap" style="height:${gapPx}px"></div>`;
    }
    
    const showWatermark = watermark && i === frames.length - 1;
    const hasCrop = typeof f.cropTop === 'number' || typeof f.cropBottom === 'number';
    
    html += `<div class="strip-frame" data-index="${i}" data-id="${f.id}" data-type="${f.type}">
      <div class="strip-frame__crop-view" style="aspect-ratio: ${aspectRatio};">
        <img src="${f.url}" alt="Frame ${pos}" style="position:absolute;top:${imgTopPct}%;width:100%;height:auto;">
      </div>
      ${showWatermark ? `<div class="strip-watermark">${escapeHtml(watermark)}</div>` : ''}
      <div class="strip-frame__overlay">
        <div class="strip-frame__top">
          <span class="strip-frame__grip" data-grip="${i}">⠿</span>
          <span class="strip-frame__pos">#${pos}</span>
          ${timeStr ? `<span class="strip-frame__pos">${timeStr}</span>` : ''}
          <span class="strip-frame__type" data-type="${f.type}" data-action="toggle-type" role="button" tabindex="0" aria-label="Toggle frame type (currently ${f.type === 'keyframe' ? 'visual' : 'subtitle'})">${f.type === 'keyframe' ? 'VIS' : 'SUB'}</span>
          <span class="spacer"></span>
          <span class="crop-inline">
            <span class="crop-inline__label">T</span>
            <button class="crop-btn" data-crop-step="top" data-step="-5">−</button>
            <span class="crop-row__val" data-crop-val="top">${topPct}%</span>
            <button class="crop-btn" data-crop-step="top" data-step="5">+</button>
          </span>
          <span class="crop-inline">
            <span class="crop-inline__label">B</span>
            <button class="crop-btn" data-crop-step="bottom" data-step="-5">−</button>
            <span class="crop-row__val" data-crop-val="bottom">${bottomPct}%</span>
            <button class="crop-btn" data-crop-step="bottom" data-step="5">+</button>
          </span>
          <button class="strip-act" data-action="move-up" title="Move up" ${i === 0 ? 'disabled' : ''}>${ICON('arrow-up', 10)}</button>
          <button class="strip-act" data-action="move-down" title="Move down" ${i === frames.length - 1 ? 'disabled' : ''}>${ICON('arrow-down', 10)}</button>
          <button class="strip-act" data-action="jump-top" title="Jump to top" ${i === 0 ? 'disabled' : ''}>${ICON('jump-top', 10)}</button>
          <button class="strip-act" data-action="jump-bottom" title="Jump to bottom" ${i === frames.length - 1 ? 'disabled' : ''}>${ICON('jump-bottom', 10)}</button>
          <button class="strip-act strip-act--danger" data-action="skip" title="Skip">${ICON('remove', 10)}</button>
        </div>
        ${caption && !f.hasBakedCaption ? `<div class="strip-frame__caption" contenteditable="true" data-caption-id="${f.id}" data-placeholder="Add caption…">${caption}</div>` : ''}
      </div>
    </div>`;
  });
  
  html += '</div>';
  els.outputStrip.innerHTML = html;
  
  // Apply zoom via width scaling (reliable across browsers)
  const inner = document.getElementById('stripInner');
  if (inner) inner.style.width = `${previewZoom * 100}%`;
}

// ---------------------------------------------------------------------------
// Strip interactions
// ---------------------------------------------------------------------------



els.outputStrip.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-action="toggle-type"]')) {
    ev.preventDefault();
    ev.target.click();
  }
});

els.outputStrip.addEventListener('click', async (ev) => {
  const actionEl = ev.target.closest('[data-action]');
  if (!actionEl) return;
  
  const frame = actionEl.closest('.strip-frame');
  if (!frame) return;
  const idx = Number(frame.dataset.index);
  const action = actionEl.dataset.action;
  
  if (action === 'toggle-type') {
    const f = frames[idx];
    const newType = f.type === 'keyframe' ? 'subtitle' : 'keyframe';
    const defaults = getDefaultCrop(newType);
    const next = frames.map((x, j) =>
      j === idx ? { ...x, type: newType, cropTop: defaults.top, cropBottom: defaults.bottom } : x
    );
    await updateFrames(next);
  } else if (action === 'skip') {
    const next = frames.filter((_, j) => j !== idx);
    await updateFrames(next);
  } else if (action === 'move-up') {
    if (idx > 0) await updateFrames(move(frames, idx, idx - 1));
  } else if (action === 'move-down') {
    if (idx < frames.length - 1) await updateFrames(move(frames, idx, idx + 1));
  } else if (action === 'jump-top') {
    if (idx > 0) await updateFrames(move(frames, idx, 0));
  } else if (action === 'jump-bottom') {
    if (idx < frames.length - 1) await updateFrames(move(frames, idx, frames.length - 1));
  }
});

// Per-frame crop stepper buttons
els.outputStrip.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-crop-step]');
  if (!btn) return;
  const frame = btn.closest('.strip-frame');
  if (!frame) return;
  const idx = Number(frame.dataset.index);
  const direction = btn.dataset.cropStep; // 'top' or 'bottom'
  const step = Number(btn.dataset.step); // -5 or +5
  
  const f = frames[idx];
  const defaults = getDefaultCrop(f.type);
  let cropTop = typeof f.cropTop === 'number' ? f.cropTop : defaults.top;
  let cropBottom = typeof f.cropBottom === 'number' ? f.cropBottom : defaults.bottom;
  
  if (direction === 'top') {
    cropTop = Math.max(0, Math.min(90, Math.round(cropTop * 100) + step)) / 100;
    // Ensure at least 5% kept region
    if (cropTop + cropBottom > 0.95) cropBottom = Math.max(0, 0.95 - cropTop);
  } else {
    cropBottom = Math.max(0, Math.min(90, Math.round(cropBottom * 100) + step)) / 100;
    if (cropTop + cropBottom > 0.95) cropTop = Math.max(0, 0.95 - cropBottom);
  }
  
  // Update frame data
  frames = frames.map((x, j) => j === idx ? { ...x, cropTop, cropBottom } : x);
  await saveFrames(frames);
  
  // Update display values
  const topVal = frame.querySelector('[data-crop-val="top"]');
  const botVal = frame.querySelector('[data-crop-val="bottom"]');
  if (topVal) topVal.textContent = `${Math.round(cropTop * 100)}%`;
  if (botVal) botVal.textContent = `${Math.round(cropBottom * 100)}%`;
  
  // Update the image position live
  const keptRatio = Math.max(0.05, 1 - cropTop - cropBottom);
  const cropView = frame.querySelector('.strip-frame__crop-view');
  if (cropView) {
    cropView.style.aspectRatio = `16 / ${9 * keptRatio}`;
    const img = cropView.querySelector('img');
    if (img) {
      img.style.top = `${-(cropTop / keptRatio) * 100}%`;
    }
  }
  
  scheduleExport();
});

// Caption editing
async function saveCaptionEdit(id, el) {
  const text = el.textContent.trim();
  const f = frames.find((x) => x.id === id);
  if (!f || text === (f.captionText || '')) return;
  frames = frames.map((x) => (x.id === id ? { ...x, captionText: text } : x));
  await saveFrames(frames);
  scheduleExport();
}

els.outputStrip.addEventListener('blur', (ev) => {
  const el = ev.target.closest('.strip-frame__caption');
  if (el?.dataset.captionId) saveCaptionEdit(el.dataset.captionId, el);
}, true);

els.outputStrip.addEventListener('keydown', (ev) => {
  const el = ev.target.closest('.strip-frame__caption');
  if (!el) return;
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
});

// ---------------------------------------------------------------------------
// Strip drag-to-reorder (uses bounding rects for reliable detection)
// ---------------------------------------------------------------------------
els.outputStrip.addEventListener('pointerdown', (ev) => {
  const grip = ev.target.closest('.strip-frame__grip');
  if (!grip) return;
  const frame = grip.closest('.strip-frame');
  if (!frame) return;
  ev.preventDefault();
  const idx = Number(frame.dataset.index);
  
  // Cache all frame rects for reliable hit testing during drag
  const frameEls = $$('.strip-frame', els.outputStrip);
  const rects = frameEls.map((f) => ({
    el: f,
    index: Number(f.dataset.index),
    rect: f.getBoundingClientRect(),
  }));
  
  stripDragState = {
    fromIndex: idx,
    startX: ev.clientX,
    startY: ev.clientY,
    moved: false,
    frame,
    rects,
  };
  frame.classList.add('dragging');
  grip.setPointerCapture(ev.pointerId);
});

els.outputStrip.addEventListener('pointermove', (ev) => {
  if (!stripDragState) return;
  const distance = Math.hypot(ev.clientX - stripDragState.startX, ev.clientY - stripDragState.startY);
  if (distance < 5) return;
  stripDragState.moved = true;
  
  // Clear all indicators
  $$('.strip-frame', els.outputStrip).forEach((f) => {
    f.classList.remove('drop-before', 'drop-after');
  });
  
  // Find target frame using cached rects (refresh positions for accuracy)
  const cursorY = ev.clientY;
  let targetInfo = null;
  
  for (const info of stripDragState.rects) {
    if (info.index === stripDragState.fromIndex) continue;
    // Refresh rect (cheap, only visible frames)
    info.rect = info.el.getBoundingClientRect();
    if (cursorY >= info.rect.top && cursorY <= info.rect.bottom) {
      targetInfo = info;
      break;
    }
  }
  
  if (!targetInfo) return;
  
  // Use 60/40 threshold: top 60% = "before", bottom 40% = "after"
  // This makes it easier to drop above a frame when dragging upward
  const threshold = targetInfo.rect.top + targetInfo.rect.height * 0.6;
  const position = cursorY < threshold ? 'before' : 'after';
  targetInfo.el.classList.add(`drop-${position}`);
});

els.outputStrip.addEventListener('pointerup', async (ev) => {
  if (!stripDragState) return;
  const state = stripDragState;
  stripDragState = null;
  state.frame.classList.remove('dragging');
  
  const dropTarget = $('.strip-frame.drop-before, .strip-frame.drop-after', els.outputStrip);
  $$('.strip-frame', els.outputStrip).forEach((f) => {
    f.classList.remove('drop-before', 'drop-after');
  });
  
  if (!state.moved || !dropTarget) return;
  
  const targetIdx = Number(dropTarget.dataset.index);
  const position = dropTarget.classList.contains('drop-before') ? 'before' : 'after';
  let insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
  
  if (insertIdx !== state.fromIndex) {
    const next = reorderByInsertion(frames, state.fromIndex, insertIdx);
    await updateFrames(next);
  }
});

els.outputStrip.addEventListener('pointercancel', () => {
  if (stripDragState) {
    stripDragState.frame.classList.remove('dragging');
    stripDragState = null;
  }
  $$('.strip-frame', els.outputStrip).forEach((f) => {
    f.classList.remove('drop-before', 'drop-after');
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
    // Apply default capture type from settings
    const defaultType = $('#defaultCaptureType')?.value || 'subtitle';
    if (next.length > 0) {
      next = next.map((f, i) => i === next.length - 1 ? { ...f, type: defaultType } : f);
    }
    frames = next;
    await saveFrames(frames);
    renderStrip();
    scheduleExport();
    setStatus(`Captured #${frames.length}`, 'ok');
    // Auto-scroll window to bottom during auto-capture
    if (auto && exportMode === 'linestack') {
      requestAnimationFrame(() => {
        const lastFrame = els.outputStrip.querySelector('.strip-frame:last-child');
        if (lastFrame) {
          lastFrame.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'warn');
  } finally {
    // Don't re-enable capture if auto is still running
    els.captureBtn.disabled = autoRunning;
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
  els.autoBtn.classList.remove('auto-btn--active');
  els.captureBtn.disabled = false;
}

function startAuto() {
  autoRunning = true;
  autoVideoId = null;
  els.autoBtn.innerHTML = `${ICON('stop')}<span class="btxt">Stop</span>`;
  els.autoBtn.classList.remove('secondary');
  els.autoBtn.classList.add('auto-btn--active');
  els.captureBtn.disabled = true;
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
    renderStrip();
    scheduleExport();
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
// Export rendering (debounced)
// ---------------------------------------------------------------------------
let exportTimer = null;
function scheduleExport() {
  previewToken += 1;
  clearTimeout(exportTimer);
  exportTimer = setTimeout(runExport, 300);
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
    bottomKeepRatio: 0.2, // default fallback; per-frame cropTop/cropBottom overrides
    enableKeyframeGap: $('#enableGap').value === 'true',
    gapSize: Number($('#gapSize').value) || 0,
    watermarkText: $('#stackWatermark').value.trim(),
    jpgQuality: 1.0, // always max quality
  };
}

async function runExport() {
  if (!frames.length) {
    els.downloadExportBtn.disabled = true;
    return;
  }
  
  const token = previewToken;
  try {
    if (exportMode === 'linestack') {
      // For LineStack, the strip IS the preview — no canvas render needed until download
      els.downloadExportBtn.disabled = false;
      els.previewLabel.textContent = `${frames.length} frames`;
    } else {
      // For Collage, render to canvas
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
      
      const img = document.getElementById('previewImg');
      if (img) {
        const nextUrl = URL.createObjectURL(result.blob);
        const oldUrl = previewUrl;
        img.onload = () => { if (oldUrl && oldUrl !== nextUrl) URL.revokeObjectURL(oldUrl); };
        previewUrl = nextUrl;
        img.src = nextUrl;
      }
      buildBlockOverlay();
      els.downloadExportBtn.disabled = false;
      els.previewLabel.textContent = 'live';
    }
  } catch (err) {
    if (token !== previewToken) return;
    console.error(err);
    setStatus(`Export failed: ${err.message || err}`, 'warn');
  }
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

// Block overlay pointer events (collage drag)
els.previewContainer.addEventListener('pointerdown', (ev) => {
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
    reorderState = {
      fromIndex: index,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      insertionIndex: index,
    };
    ev.preventDefault();
    els.previewContainer.setPointerCapture?.(ev.pointerId);
    return;
  }
  
  if (edge) {
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
      scale,
      cols: Number($('#collageColumns').value) || 2,
      cellUnit: (lastCollageLayout.width - (Number($('#collageGap').value) || 0) * (Number($('#collageColumns').value) + 1)) / (Number($('#collageColumns').value) || 1),
      baseHOutput: cell ? cell.h / (f.block.heightScale || 1) : 200,
      cellW: cell ? cell.w : 200,
      cellH: cell ? cell.h : 200,
      moved: false,
    };
    ev.preventDefault();
    els.previewContainer.setPointerCapture?.(ev.pointerId);
    return;
  }
  
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
    scale,
    cellW: cell.w / scale,
    cellH: cell.h / scale,
    moved: false,
  };
  ev.preventDefault();
  els.previewContainer.setPointerCapture?.(ev.pointerId);
});

els.previewContainer.addEventListener('pointermove', (ev) => {
  if (reorderState) {
    const distance = Math.hypot(ev.clientX - reorderState.startX, ev.clientY - reorderState.startY);
    if (distance < 6) return;
    reorderState.moved = true;
    $$('.block-box', els.previewContainer).forEach((b) => b.classList.remove('insert-before', 'insert-after'));
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.block-box');
    if (!target) return;
    const tidx = Number(target.dataset.index);
    const ins = insertionIndexForPoint(tidx, target.getBoundingClientRect(), ev.clientX, ev.clientY);
    reorderState.insertionIndex = ins;
    target.classList.add(ins === tidx ? 'insert-before' : 'insert-after');
    const source = $(`.block-box[data-index="${reorderState.fromIndex}"]`, els.previewContainer);
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
    els.previewContainer.releasePointerCapture?.(ev.pointerId);
    return;
  }
  endDrag();
}

els.previewContainer.addEventListener('pointerup', (ev) => endPointer(ev));
els.previewContainer.addEventListener('pointercancel', (ev) => endPointer(ev, { cancel: true }));
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && reorderState) {
    reorderState = null;
    buildBlockOverlay();
  }
});

// ---------------------------------------------------------------------------
// Collage block editor
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
  if (rerender) scheduleExport();
}

async function patchSelectedView(patch, { rerender = true } = {}) {
  const f = selectedFrame();
  if (!f) return;
  frames = frames.map((x) => (x.id === f.id ? { ...x, view: { ...x.view, ...patch } } : x));
  await saveFrames(frames);
  const cur = selectedFrame();
  if (cur) els.zoomLabel.textContent = `${Number(cur.view.zoom).toFixed(2)}×`;
  if (rerender) scheduleExport();
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
  scheduleExport();
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
// Type-bound crop inputs (Top%/Bot% default values based on type)
// ---------------------------------------------------------------------------
let savedVisCropTop = 0;
let savedVisCropBot = 0;
let savedSubCropTop = Number($('#defaultCropTop')?.value) || 80;
let savedSubCropBot = Number($('#defaultCropBottom')?.value) || 0;

function syncCropInputsToType() {
  const type = $('#defaultCaptureType')?.value;
  const topInput = $('#defaultCropTop');
  const botInput = $('#defaultCropBottom');
  if (!topInput || !botInput) return;

  if (type === 'keyframe') {
    // VIS: show saved VIS values (default 0/0)
    topInput.value = String(savedVisCropTop);
    botInput.value = String(savedVisCropBot);
  } else {
    // SUB: show saved SUB values
    topInput.value = String(savedSubCropTop);
    botInput.value = String(savedSubCropBot);
  }
}

// Save crop values whenever they change
$('#defaultCropTop')?.addEventListener('input', () => {
  const type = $('#defaultCaptureType')?.value;
  const val = Number($('#defaultCropTop').value) || 0;
  if (type === 'keyframe') savedVisCropTop = val;
  else savedSubCropTop = val;
});
$('#defaultCropBottom')?.addEventListener('input', () => {
  const type = $('#defaultCaptureType')?.value;
  const val = Number($('#defaultCropBottom').value) || 0;
  if (type === 'keyframe') savedVisCropBot = val;
  else savedSubCropBot = val;
});

$('#defaultCaptureType')?.addEventListener('change', syncCropInputsToType);
// Apply on boot
syncCropInputsToType();

// ---------------------------------------------------------------------------
// Export settings -> live preview
// ---------------------------------------------------------------------------
const stackControls = ['#stackWidth', '#enableGap', '#gapSize', '#stackWatermark', '#defaultCropTop', '#defaultCropBottom', '#defaultCaptureType'];
const collageControls = ['#collageLayout', '#collageColumns', '#collageAspect', '#collageWidth', '#collageGap', '#collageRadius', '#collageBg'];
[...stackControls, ...collageControls].forEach((sel) => {
  const el = $(sel);
  if (el) el.addEventListener('input', () => {
    scheduleExport();
    // Settings that need strip re-render
    if (exportMode === 'linestack' && ['#enableGap', '#gapSize', '#stackWatermark', '#defaultCropTop', '#defaultCropBottom', '#defaultCaptureType'].includes(sel)) {
      renderStrip();
      const inner = document.getElementById('stripInner');
      if (inner) inner.style.width = `${previewZoom * 100}%`;
    }
  });
});

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
els.downloadExportBtn.addEventListener('click', async () => {
  if (exportMode === 'linestack') {
    // Render LineStack on demand
    setStatus('Rendering LineStack…');
    try {
      const blobs = await renderLineStack(
        frames.map((f) => ({
          source: f.url,
          isKeyframe: f.type === 'keyframe',
          cropTop: f.cropTop,
          cropBottom: f.cropBottom,
          captionText: f.captionText,
          hasBakedCaption: f.hasBakedCaption,
          captionScale: f.captionScale,
        })),
        stackCfg()
      );
      lastStackBlobs = blobs;
      blobs.forEach((blob, i) => {
        const suffix = blobs.length > 1 ? `-${String(i + 1).padStart(2, '0')}` : '';
        downloadBlob(blob, `youtube-linestack${suffix}.jpg`);
      });
      setStatus(`Downloaded ${blobs.length} page${blobs.length > 1 ? 's' : ''}`, 'ok');
    } catch (err) {
      console.error(err);
      setStatus(`Export failed: ${err.message || err}`, 'warn');
    }
  } else {
    downloadBlob(lastCollageBlob, 'youtube-collage.jpg');
  }
});

els.clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all frames? This cannot be undone.')) return;
  stopAuto();
  await clearFrames();
  clearBitmapCache();
  frames = [];
  selectedId = null;
  renderStrip();
  syncBlockEditor();
  scheduleExport();
  setStatus('Cleared all frames.');
});

// ---------------------------------------------------------------------------
// Preview zoom controls
// ---------------------------------------------------------------------------
els.zoomInBtn.addEventListener('click', () => stepZoom(1));
els.zoomOutBtn.addEventListener('click', () => stepZoom(-1));
els.zoomResetBtn.addEventListener('click', () => setPreviewZoom(1));
els.previewContainer.addEventListener('wheel', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  stepZoom(ev.deltaY < 0 ? 1 : -1);
}, { passive: false });

// Also zoom on Ctrl+wheel over the strip
els.outputStrip.addEventListener('wheel', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  stepZoom(ev.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
applyIcons();
applyPreviewZoom();
setExportMode('linestack');

loadFrames().then((loaded) => {
  frames = loaded;
  renderStrip();
  scheduleExport();
});

onFramesChanged((next) => {
  if (frameSavesPending) return;
  frames = next;
  if (selectedId && !frames.some((f) => f.id === selectedId)) selectedId = null;
  renderStrip();
  syncBlockEditor();
  scheduleExport();
});
