import { renderLineStack, renderCollage, clearBitmapCache } from './engine.js';
import { icon as ICON, applyIcons, chinchilla } from './icons.js';
import {
  loadFrames,
  saveFrames,
  clearFrames,
  captureFrame,
  appendCapture,
  appendUpload,
  onFramesChanged,
  MAX_FRAMES,
} from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let frames = [];
let autoTimer = null;
let autoRunning = false;
let activeTab = 'capture';
let selectedId = null;
let captionSizeOpenId = null; // frame whose inline caption-size slider is open

let lastStackBlobs = [];
let lastCollageBlob = null;
let lastCollageLayout = null; // { layout, width, height }
let previewUrl = null;
let previewToken = 0;
let dragState = null; // active block manipulation
let dragCueText = '';

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
  downloadStackBtn: $('#downloadStackBtn'),
  downloadCollageBtn: $('#downloadCollageBtn'),
  blockEditor: $('#blockEditor'),
  blockTitle: $('#blockTitle'),
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
  sizeHint: $('#sizeHint'),
  zoomInBtn: $('#zoomInBtn'),
  zoomOutBtn: $('#zoomOutBtn'),
  zoomResetBtn: $('#zoomResetBtn'),
  uploadBtn: $('#uploadBtn'),
  uploadInput: $('#uploadInput'),
  frameZoom: $('#frameZoom'),
};

function setStatus(message, cls = '') {
  els.status.className = `status ${cls}`;
  els.status.textContent = message;
}

function formatTime(seconds) {
  if (typeof seconds !== 'number') return '—';
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

function setPreviewImage(blob, label) {
  els.preview.dataset.collage = activeTab === 'collage' ? '1' : '0';
  const nextUrl = URL.createObjectURL(blob);
  let img = document.getElementById('previewImg');
  // Reuse the existing <img> so the old frame stays visible until the new one
  // decodes — avoids the blank-flash / layout collapse on every re-render.
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
  // Stale collage block-boxes must not linger over a LineStack image. Clear
  // the overlay on every non-collage render; the collage path rebuilds it.
  const overlay = document.getElementById('blockOverlay');
  if (overlay && activeTab !== 'collage') overlay.innerHTML = '';
  applyPreviewZoom();
}

function setPreviewEmpty(message) {
  els.preview.dataset.collage = '0';
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  els.preview.innerHTML = emptyStateHTML(message);
}

// Chinchilla speaking the empty-state dialog. Used by every preview empty state
// so the illustration stays consistent across tabs.
function emptyStateHTML(message) {
  return `<div class="empty-illu">${chinchilla(104)}<div class="bubble"><span>${escapeHtml(message)}</span></div></div>`;
}

// ---------------------------------------------------------------------------
// Preview zoom (CSS `zoom` grows the layout box so overflow:auto scrolls and
// getBoundingClientRect reflects the scale — keeps collage drag math correct).
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

// Build the interactive block overlay from the last collage layout. Blocks are
// positioned as percentages so they stay aligned regardless of display size.
function buildBlockOverlay() {
  const overlay = document.getElementById('blockOverlay');
  if (!overlay || !lastCollageLayout) return;
  // Only the collage preview has editable blocks; never draw the overlay when
  // the capture/linestack preview is showing.
  if (activeTab !== 'collage') {
    overlay.innerHTML = '';
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
        ? `<span class="bh bh-e" data-edge="e" title="Drag to change width"></span>
           <span class="bh bh-s" data-edge="s" title="Drag to change height"></span>
           <span class="bh bh-se" data-edge="se" title="Drag to resize"></span>`
        : '';
      const cue = dragging && dragCueText
        ? `<span class="block-box__cue">${dragCueText}</span>`
        : '';
      return `<div class="block-box ${sel ? 'selected' : ''} ${dragging ? 'dragging' : ''}" data-index="${cell.index}" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%">
        <span class="block-box__tag">#${pos}</span>
        ${cue}
        ${handles}
      </div>`;
    })
    .join('');
}

function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

// ---------------------------------------------------------------------------
// Frame queue
// ---------------------------------------------------------------------------
function frameBadge(type) {
  return type === 'keyframe'
    ? `<span class="badge keyframe">${ICON('keyframe', 12)}<span class="btxt">Keyframe</span></span>`
    : `<span class="badge">${ICON('subtitle', 12)}<span class="btxt">Subtitle band</span></span>`;
}

function renderFrames() {
  els.countLabel.textContent = `${frames.length} / ${MAX_FRAMES} frames`;
  if (!frames.length) {
    els.frameList.innerHTML = '<p class="empty">Capture frames from a YouTube tab. Caption-visible frames default to subtitle bands; caption-less frames default to keyframes.</p>';
    return;
  }
  els.frameList.innerHTML = frames.map((f, i) => {
    const editable = !f.hasBakedCaption;
    const captionClass = editable ? 'caption editable' : 'caption';
    const captionAttrs = editable
      ? `contenteditable="true" spellcheck="false" data-caption-id="${f.id}" data-placeholder="Add caption…"`
      : '';
    const captionText = editable ? (f.captionText || '') : (f.captionText || 'No caption text captured');
    // Caption-size button replaces the old "Edit collage view" button, shown
    // only for frames with a custom (non-baked) caption. Baked-caption frames
    // get a 4-button row; the grid auto-fits either count.
    const sizeBtn = editable
      ? `<button data-action="caption-size" title="Adjust caption size">${ICON('text-size')}<span class="btxt">Size</span></button>`
      : '';
    const scale = Number(f.captionScale) || 1;
    const sizeRow = (editable && captionSizeOpenId === f.id)
      ? `<div class="caption-size-row">
          <button class="sz-btn" data-action="caption-smaller" title="Smaller caption" aria-label="Smaller caption">${ICON('minus')}</button>
          <span class="caption-size-val">${scale.toFixed(2)}×</span>
          <button class="sz-btn" data-action="caption-larger" title="Larger caption" aria-label="Larger caption">${ICON('plus')}</button>
        </div>`
      : '';
    return `
    <article class="frame ${f.id === selectedId ? 'selected' : ''}" draggable="true" data-index="${i}" data-id="${f.id}">
      <div class="frame__thumb">
        <img src="${f.url}" alt="frame ${i + 1}">
        <button class="zoom-ico" data-action="zoom" type="button" aria-label="Preview frame" title="Preview">${ICON('magnifier', 13)}</button>
      </div>
      <div class="frame__meta">
        <div class="frame__title"><strong>#${String(i + 1).padStart(2, '0')} · ${formatTime(f.time)}</strong>${frameBadge(f.type)}</div>
        <div class="${captionClass}" ${captionAttrs} title="${escapeHtml(f.captionText || '')}">${escapeHtml(captionText)}</div>
        ${sizeRow}
        <div class="frame__actions">
          <button data-action="toggle" title="Toggle keyframe/subtitle">${ICON('swap')}<span class="btxt">Type</span></button>
          <button data-action="up" title="Move up">${ICON('up')}</button>
          <button data-action="down" title="Move down">${ICON('down')}</button>
          ${sizeBtn}
          <button data-action="remove" class="danger" title="Remove">${ICON('remove')}</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

async function updateFrames(next, { reselect = true } = {}) {
  frames = next;
  await saveFrames(frames);
  if (reselect && selectedId && !frames.some((f) => f.id === selectedId)) {
    selectedId = null;
  }
  renderFrames();
  syncBlockEditor();
  schedulePreview();
}

els.frameList.addEventListener('click', async (ev) => {
  // Let inline caption editing happen without re-rendering the list (which
  // would destroy the focused contenteditable).
  if (ev.target.closest('.caption.editable')) return;
  const btn = ev.target.closest('button');
  const card = ev.target.closest('.frame');
  if (!card) return;
  const idx = Number(card.dataset.index);

  if (!btn) {
    // Clicking a card just selects/highlights it — no forced tab change.
    selectBlock(frames[idx]?.id ?? null);
    return;
  }
  const action = btn.dataset.action;
  if (action === 'zoom') return; // peek affordance — hover-only, click is a no-op
  let next = [...frames];
  if (action === 'toggle') {
    next[idx] = { ...next[idx], type: next[idx].type === 'keyframe' ? 'subtitle' : 'keyframe' };
  } else if (action === 'caption-size') {
    // Toggle the inline caption-size stepper for this frame (one open at a time).
    captionSizeOpenId = captionSizeOpenId === frames[idx].id ? null : frames[idx].id;
    renderFrames();
    return;
  } else if (action === 'caption-smaller' || action === 'caption-larger') {
    // Adjust this frame's custom-caption scale in ±0.1 steps, clamped 0.5–2.
    const id = frames[idx].id;
    const cur = Number(frames[idx].captionScale) || 1;
    const step = action === 'caption-larger' ? 0.1 : -0.1;
    const nextScale = Math.max(0.5, Math.min(2, Math.round((cur + step) * 100) / 100));
    next = frames.map((x) => (x.id === id ? { ...x, captionScale: nextScale } : x));
    await updateFrames(next); // persists + re-renders (row stays open) + preview
    return;
  } else if (action === 'remove') {
    next.splice(idx, 1);
  } else if (action === 'up') {
    next = move(next, idx, idx - 1);
  } else if (action === 'down') {
    next = move(next, idx, idx + 1);
  }
  await updateFrames(next);
});

// Caption size is adjusted via the +/- stepper buttons (handled in the click
// handler above). The old range-slider approach fought with the frame card's
// drag-to-reorder; steppers are pure click targets, no drag conflict.

// Inline caption editing for frames without a baked caption (uploads +
// caption-less captures). Saves on blur; Enter/Escape commit. Dragging the
// frame card is suppressed while editing text so the cursor can select.
async function saveCaptionEdit(id, el) {
  const text = el.textContent.trim();
  const f = frames.find((x) => x.id === id);
  if (!f || text === (f.captionText || '')) return;
  frames = frames.map((x) => (x.id === id ? { ...x, captionText: text } : x));
  await saveFrames(frames);
  schedulePreview();
}
els.frameList.addEventListener('blur', (ev) => {
  const el = ev.target.closest('.caption.editable');
  if (el?.dataset.captionId) saveCaptionEdit(el.dataset.captionId, el);
}, true);
els.frameList.addEventListener('keydown', (ev) => {
  const el = ev.target.closest('.caption.editable');
  if (!el) return;
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
});

let dragFrom = null;
els.frameList.addEventListener('dragstart', (ev) => {
  // Don't start a card drag while editing a caption, using the size stepper,
  // or pressing the peek icon.
  if (ev.target.closest('.caption.editable, .caption-size-row, .zoom-ico')) { ev.preventDefault(); return; }
  const card = ev.target.closest('.frame');
  if (!card) return;
  dragFrom = Number(card.dataset.index);
  card.classList.add('dragging');
});
els.frameList.addEventListener('dragend', (ev) => ev.target.closest('.frame')?.classList.remove('dragging'));
els.frameList.addEventListener('dragover', (ev) => { if (ev.target.closest('.frame')) ev.preventDefault(); });
els.frameList.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  const card = ev.target.closest('.frame');
  if (!card || dragFrom == null) return;
  await updateFrames(move(frames, dragFrom, Number(card.dataset.index)));
  dragFrom = null;
});

// ---------------------------------------------------------------------------
// Frame peek: hover the zoom icon to show an enlarged preview of the frame.
// One shared floating element (position: fixed) so it isn't clipped by the
// frame-list's overflow:auto. First hover delays ~150ms; later hovers are
// instant (the standard "skip delay once one tooltip has opened" feel).
// ---------------------------------------------------------------------------
let zoomShowTimer = null;
let zoomHideTimer = null;
let zoomShownOnce = false;
let zoomFrameId = null; // frame currently shown in the peek

function positionFrameZoom(iconRect) {
  const el = els.frameZoom;
  const margin = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = iconRect.right + margin;
  let top = iconRect.top + iconRect.height / 2 - h / 2;
  if (left + w > vw - margin) left = iconRect.left - w - margin; // flip to left
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  if (top + h > vh - margin) top = vh - h - margin;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function showFrameZoom(frame, iconEl) {
  if (!els.frameZoom.hidden && zoomFrameId === frame.id) return; // already showing this frame
  zoomFrameId = frame.id;
  const pos = frames.findIndex((x) => x.id === frame.id) + 1;
  const meta = `#${String(pos).padStart(2, '0')} · ${formatTime(frame.time)}`;
  const cap = frame.captionText ? `<div class="frame-zoom__cap">${escapeHtml(frame.captionText)}</div>` : '';
  els.frameZoom.innerHTML =
    `<img class="frame-zoom__img" src="${frame.url}" alt="">` +
    `<div class="frame-zoom__meta">${meta}</div>` +
    cap;
  els.frameZoom.hidden = false;
  els.frameZoom.setAttribute('aria-hidden', 'false');
  // Measure after the layout pass so clamping uses the real size.
  requestAnimationFrame(() => positionFrameZoom(iconEl.getBoundingClientRect()));
}

function hideFrameZoom() {
  clearTimeout(zoomShowTimer);
  zoomFrameId = null;
  els.frameZoom.hidden = true;
  els.frameZoom.setAttribute('aria-hidden', 'true');
  els.frameZoom.innerHTML = '';
}

function scheduleHideFrameZoom() {
  clearTimeout(zoomHideTimer);
  zoomHideTimer = setTimeout(hideFrameZoom, 100);
}

els.frameList.addEventListener('mouseover', (ev) => {
  const ico = ev.target.closest('.zoom-ico');
  if (!ico) return;
  const card = ico.closest('.frame');
  const frame = frames.find((f) => f.id === card?.dataset.id);
  if (!frame) return;
  clearTimeout(zoomHideTimer);
  clearTimeout(zoomShowTimer);
  const show = () => { showFrameZoom(frame, ico); zoomShownOnce = true; };
  if (zoomShownOnce) show();
  else zoomShowTimer = setTimeout(show, 150);
});

els.frameList.addEventListener('mouseout', (ev) => {
  const ico = ev.target.closest('.zoom-ico');
  if (!ico) return;
  const to = ev.relatedTarget;
  if (to && (ico.contains(to) || els.frameZoom.contains(to))) return;
  clearTimeout(zoomShowTimer);
  scheduleHideFrameZoom();
});

// Keep the preview open while the cursor is over it (e.g. reading a caption).
els.frameZoom.addEventListener('mouseover', () => clearTimeout(zoomHideTimer));
els.frameZoom.addEventListener('mouseout', (ev) => {
  const to = ev.relatedTarget;
  if (to && els.frameZoom.contains(to)) return;
  scheduleHideFrameZoom();
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

async function captureAndStore() {
  els.captureBtn.disabled = true;
  try {
    setStatus('Capturing active YouTube frame…');
    let next = await appendCapture(await captureFrame());
    next = applyCaptureRule(next);
    frames = next;
    await saveFrames(frames);
    renderFrames();
    schedulePreview();
    setStatus(`Captured frame ${frames.length}.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'warn');
  } finally {
    els.captureBtn.disabled = false;
  }
}

async function autoTick() {
  if (!autoRunning) return;
  await captureAndStore();
  if (!autoRunning) return;
  const delay = Math.max(0.5, Math.min(60, Number(els.interval.value) || 1)) * 1000;
  autoTimer = setTimeout(autoTick, delay);
}
function stopAuto() {
  autoRunning = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  els.autoBtn.innerHTML = `${ICON('play')}<span class="btxt">Start auto</span>`;
  els.autoBtn.classList.add('secondary');
}
function startAuto() {
  autoRunning = true;
  els.autoBtn.innerHTML = `${ICON('stop')}<span class="btxt">Stop auto</span>`;
  els.autoBtn.classList.remove('secondary');
  autoTick();
}

els.captureBtn.addEventListener('click', captureAndStore);
els.autoBtn.addEventListener('click', () => (autoRunning ? stopAuto() : startAuto()));

// Upload images into the frame queue (Capture tab). Accepts one or many
// files — used by both the file-picker and drag-and-drop paths.
async function uploadFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) {
    setStatus('Drop an image file (PNG, JPEG, or WebP).', 'warn');
    return;
  }
  els.uploadBtn.disabled = true;
  try {
    setStatus(`Adding ${imgs.length} image${imgs.length > 1 ? 's' : ''}…`);
    // Append sequentially — appendUpload reloads frames each call, so we must
    // await one before the next to avoid losing earlier appends.
    for (const f of imgs) frames = await appendUpload(f);
    await saveFrames(frames);
    renderFrames();
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

// Drag-and-drop image files onto the capture card (the upload button is the
// visual anchor; the whole card is a roomier drop target).
const captureCard = $('.card[data-panel="capture"]');
captureCard.addEventListener('dragover', (ev) => {
  if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    captureCard.classList.add('drop-active');
  }
});
captureCard.addEventListener('dragleave', (ev) => {
  if (!captureCard.contains(ev.relatedTarget)) captureCard.classList.remove('drop-active');
});
captureCard.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  captureCard.classList.remove('drop-active');
  const files = ev.dataTransfer?.files ? [...ev.dataTransfer.files] : [];
  if (files.length) await uploadFiles(files);
});
// Prevent the browser from opening files dropped outside the drop zone.
window.addEventListener('dragover', (ev) => {
  if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
});
window.addEventListener('drop', (ev) => {
  if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
});

// Paste image(s) from the clipboard (screenshots, copied images). Ignored when
// the paste target is a text field / caption editor so text paste still works.
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
// Live preview (debounced, active export tab only)
// ---------------------------------------------------------------------------
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 350);
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
  if (activeTab !== 'linestack' && activeTab !== 'collage') {
    // Capture tab: preview is an export-only surface, so show the hint and
    // clear any stale LineStack/collage image + overlay left from another tab.
    setPreviewEmpty('Capture frames — the preview updates automatically.');
    els.downloadStackBtn.disabled = true;
    els.downloadCollageBtn.disabled = true;
    return;
  }
  if (!frames.length) {
    setPreviewEmpty('Capture frames — the preview updates automatically.');
    els.downloadStackBtn.disabled = true;
    els.downloadCollageBtn.disabled = true;
    return;
  }
  const token = ++previewToken;
  try {
    if (activeTab === 'linestack') {
      const blobs = await renderLineStack(
        frames.map((f) => ({ source: f.url, isKeyframe: f.type === 'keyframe', captionText: f.captionText, hasBakedCaption: f.hasBakedCaption, captionScale: f.captionScale })),
        stackCfg()
      );
      if (token !== previewToken) return;
      lastStackBlobs = blobs;
      setPreviewImage(blobs[0], blobs.length > 1 ? `LineStack · page 1/${blobs.length}` : 'LineStack');
      els.downloadStackBtn.disabled = false;
    } else {
      const result = await renderCollage(
        frames.map((f) => ({ source: f.url, view: f.view, block: f.block, captionText: f.captionText, hasBakedCaption: f.hasBakedCaption, captionScale: f.captionScale })),
        collageCfg()
      );
      if (token !== previewToken || !result) return;
      lastCollageBlob = result.blob;
      lastCollageLayout = { layout: result.layout, width: result.width, height: result.height };
      setPreviewImage(result.blob, 'Collage · drag a block to move/resize');
      buildBlockOverlay();
      els.downloadCollageBtn.disabled = false;
    }
  } catch (err) {
    if (token !== previewToken) return;
    console.error(err);
    setStatus(`Preview failed: ${err.message || err}`, 'warn');
  }
}

// ---------------------------------------------------------------------------
// Collage block selection + view controls
// ---------------------------------------------------------------------------
function selectedFrame() {
  return frames.find((f) => f.id === selectedId) || null;
}

function selectBlock(id, { switchToCollage = false } = {}) {
  selectedId = id;
  if (id && switchToCollage && activeTab !== 'collage') switchTab('collage');
  renderFrames();
  syncBlockEditor();
  buildBlockOverlay();
}

function syncBlockEditor() {
  const f = selectedFrame();
  if (!f || activeTab !== 'collage') {
    els.blockEditor.hidden = true;
    return;
  }
  const pos = frames.findIndex((x) => x.id === f.id) + 1;
  const isMasonry = $('#collageLayout').value === 'masonry';
  els.blockEditor.hidden = false;
  els.blockTitle.textContent = `Block #${String(pos).padStart(2, '0')}`;
  // Size group (width span + height) only meaningful in masonry.
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
}

async function patchSelectedBlock(patch, { rerender = true } = {}) {
  const f = selectedFrame();
  if (!f) return;
  frames = frames.map((x) => (x.id === f.id ? { ...x, block: { ...x.block, ...patch } } : x));
  await saveFrames(frames);
  const cur = selectedFrame();
  els.spanLabel.textContent = `${cur.block.colSpan}`;
  els.heightLabel.textContent = `${Number(cur.block.heightScale).toFixed(2)}×`;
  if (rerender) schedulePreview();
}

async function patchSelectedView(patch, { rerender = true } = {}) {
  const f = selectedFrame();
  if (!f) return;
  const next = frames.map((x) => (x.id === f.id ? { ...x, view: { ...x.view, ...patch } } : x));
  frames = next;
  await saveFrames(frames);
  els.zoomLabel.textContent = `${Number(selectedFrame().view.zoom).toFixed(2)}×`;
  if (rerender) schedulePreview();
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

// Direct on-block manipulation inside the collage preview:
//  - drag block body  -> pan the image within the block (view.offset)
//  - drag right edge   -> change width (block.colSpan) [masonry]
//  - drag bottom edge  -> change height (block.heightScale) [masonry]
//  - drag corner       -> both
function refreshOverlayCue() {
  buildBlockOverlay();
}

els.preview.addEventListener('pointerdown', (ev) => {
  if (activeTab !== 'collage' || !lastCollageLayout) return;
  const box = ev.target.closest('.block-box');
  const stage = document.getElementById('previewStage');
  if (!box || !stage) return;
  const index = Number(box.dataset.index);
  const frame = frames[index];
  if (!frame) return;
  ev.preventDefault();
  selectBlock(frame.id);

  const cell = lastCollageLayout.layout.find((c) => c.index === index);
  const rect = stage.getBoundingClientRect();
  const scale = lastCollageLayout.width / rect.width; // output px per CSS px
  const handle = ev.target.closest('.bh');
  const edge = handle ? handle.dataset.edge : null;
  const isMasonry = $('#collageLayout').value === 'masonry';
  const cols = Math.max(1, Math.min(6, Number($('#collageColumns').value) || 1));
  const cellUnit = lastCollageLayout.width / cols; // approx output px per column

  dragState = {
    id: frame.id,
    index,
    mode: edge && isMasonry ? `resize-${edge}` : 'pan',
    startX: ev.clientX,
    startY: ev.clientY,
    startOffX: frame.view.offsetX,
    startOffY: frame.view.offsetY,
    startSpan: frame.block.colSpan,
    startHeight: frame.block.heightScale,
    cellW: cell.w / scale, // displayed CSS px
    cellH: cell.h / scale,
    baseHOutput: cell.h / Math.max(0.35, frame.block.heightScale), // output px at 1x
    cellUnit,
    cols,
    scale,
    box,
    startBoxW: parseFloat(box.style.width) || 0,
    startBoxH: parseFloat(box.style.height) || 0,
    moved: false,
  };
  els.preview.setPointerCapture?.(ev.pointerId);
  refreshOverlayCue();
});

els.preview.addEventListener('pointermove', (ev) => {
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
      const colSpan = Math.max(1, Math.min(dragState.cols, dragState.startSpan + spanDelta));
      patch.colSpan = colSpan;
    }
    if (dragState.mode.includes('s')) {
      const dyOut = dyCss * dragState.scale;
      const heightScale = Math.max(0.4, Math.min(2.5, dragState.startHeight + dyOut / Math.max(1, dragState.baseHOutput)));
      patch.heightScale = Math.round(heightScale * 20) / 20;
    }
    dragState.moved = true;
    const span = patch.colSpan ?? f.block.colSpan;
    const hs = patch.heightScale ?? f.block.heightScale;
    dragCueText = `${span} col · ${Number(hs).toFixed(2)}×`;
    updateLiveCue();
    patchSelectedBlock(patch, { rerender: false });
    scheduleLiveRender();
  }
});

// rAF-throttled full-res re-render used *during* a drag. Cheap because the
// engine caches decoded bitmaps — only canvas compositing runs each frame.
let liveRenderPending = false;
let liveRenderBusy = false;
function scheduleLiveRender() {
  if (liveRenderPending) return;
  liveRenderPending = true;
  requestAnimationFrame(runLiveRender);
}
async function runLiveRender() {
  liveRenderPending = false;
  if (!dragState || liveRenderBusy || activeTab !== 'collage') return;
  liveRenderBusy = true;
  try {
    const result = await renderCollage(
      frames.map((f) => ({ source: f.url, view: f.view, block: f.block, captionText: f.captionText, hasBakedCaption: f.hasBakedCaption, captionScale: f.captionScale })),
      collageCfg()
    );
    if (!result || !dragState) return;
    lastCollageBlob = result.blob;
    lastCollageLayout = { layout: result.layout, width: result.width, height: result.height };
    // Swap only the <img> src so the overlay/handles survive the update.
    const img = document.getElementById('previewImg');
    if (img) {
      const nextUrl = URL.createObjectURL(result.blob);
      const oldUrl = previewUrl;
      img.onload = () => { if (oldUrl && oldUrl !== nextUrl) URL.revokeObjectURL(oldUrl); };
      previewUrl = nextUrl;
      img.src = nextUrl;
    }
    // Rebuild overlay to the new geometry and re-bind the dragged box element.
    buildBlockOverlay();
    if (dragState) {
      const box = document.querySelector(`.block-box[data-index="${dragState.index}"]`);
      if (box) {
        dragState.box = box;
        dragState.startBoxW = parseFloat(box.style.width) || dragState.startBoxW;
        dragState.startBoxH = parseFloat(box.style.height) || dragState.startBoxH;
        box.classList.add('dragging', 'selected');
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    liveRenderBusy = false;
  }
}

// Update the cue label on the currently dragged box without a full rebuild.
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
  // The live render already produced final-quality output; just settle overlay.
  buildBlockOverlay();
}
els.preview.addEventListener('pointerup', endDrag);
els.preview.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// Controls -> live preview
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

els.captureRule.addEventListener('change', async () => {
  await updateFrames(applyCaptureRule(frames));
});

// Layout/columns changes affect which block controls are relevant.
$('#collageLayout').addEventListener('change', syncBlockEditor);
$('#collageColumns').addEventListener('input', syncBlockEditor);

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
els.downloadStackBtn.addEventListener('click', () => {
  lastStackBlobs.forEach((blob, i) => {
    const suffix = lastStackBlobs.length > 1 ? `-${String(i + 1).padStart(2, '0')}` : '';
    downloadBlob(blob, `youtube-linestack${suffix}.jpg`);
  });
});
els.downloadCollageBtn.addEventListener('click', () => downloadBlob(lastCollageBlob, 'youtube-collage.jpg'));

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function switchTab(tab) {
  activeTab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
  syncBlockEditor();
  schedulePreview();
}
$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

// ---------------------------------------------------------------------------
// Clear all (added to capture panel actions)
// ---------------------------------------------------------------------------
const clearBtn = document.createElement('button');
clearBtn.className = 'ghost wide danger';
clearBtn.innerHTML = `${ICON('trash')}<span class="btxt">Clear all frames</span>`;
clearBtn.addEventListener('click', async () => {
  stopAuto();
  await clearFrames();
  clearBitmapCache();
  frames = [];
  selectedId = null;
  renderFrames();
  syncBlockEditor();
  schedulePreview();
  setStatus('Cleared all frames.');
});
$('.card[data-panel="capture"] .actions').append(clearBtn);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
applyIcons();

// Preview zoom controls
els.zoomInBtn.addEventListener('click', () => stepZoom(1));
els.zoomOutBtn.addEventListener('click', () => stepZoom(-1));
els.zoomResetBtn.addEventListener('click', () => setPreviewZoom(1));
// Ctrl/Cmd + wheel to zoom over the preview.
els.preview.addEventListener('wheel', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  stepZoom(ev.deltaY < 0 ? 1 : -1);
}, { passive: false });
applyPreviewZoom();

// Show the chinchilla empty state immediately on the default Capture tab.
setPreviewEmpty('Capture frames — the preview updates automatically.');

loadFrames().then((loaded) => {
  frames = loaded;
  renderFrames();
});
onFramesChanged((next) => {
  frames = next;
  if (selectedId && !frames.some((f) => f.id === selectedId)) selectedId = null;
  renderFrames();
  syncBlockEditor();
  schedulePreview();
});
