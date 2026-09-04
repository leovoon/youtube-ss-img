// ============================================================================
// Shared image engine for the revamped "YouTube Capture + LineStack + Collage"
// project. This ports the distilled LineStack tool-section logic (from
// ailogocreator.io/line-stack) to plain Canvas so it runs in a normal page and
// later inside an MV3 Chrome extension (OffscreenCanvas in a worker).
//
// -- Distilled LineStack model --------------------------------------------
// Config defaults observed in the shipped bundle:
//   outputWidth: 720 | 1080          (canvas width; everything scales to it)
//   enableKeyframeGap: false         (draw a gap band before each keyframe)
//   gapSize: 8                        (gap band height in px)
//   backgroundColor: "#FFFFFF"
//   bottomKeepRatio: 0.2             ("subtitle crop" slider, 0..1)
//   watermarkText: ""
//   jpgQuality: 0.9
//   MAX_IMAGES: 30
//   MAX_PAGE_HEIGHT: {720: 18000, 1080: 12000}  (split into multiple images)
//
// Per-image sizing:
//   scale = outputWidth / naturalWidth
//   keyframe -> keep full height
//   subtitle -> keep only bottom band: keptHeight = round(naturalHeight * ratio)
//   drawHeight = round(keptHeight * scale)
//
// Render: stack images top-to-bottom on a white canvas. Subtitle images are
// source-cropped to their bottom band (sy = h*(1-ratio), sh = h*ratio) so the
// output becomes: full keyframe(s) + a continuous ribbon of subtitle lines.
// ============================================================================

export const LINESTACK_DEFAULTS = {
  outputWidth: 1080,
  enableKeyframeGap: false,
  gapSize: 8,
  backgroundColor: "#FFFFFF",
  bottomKeepRatio: 0.2,
  watermarkText: "",
  jpgQuality: 0.9,
};

export const MAX_IMAGES = 30;
export const MAX_PAGE_HEIGHT = { 720: 18000, 1080: 12000 };

// Load a File/Blob/HTMLImageElement into an ImageBitmap-like source.
const _bitmapCache = new Map(); // source (string) -> decoded bitmap/image

async function loadBitmap(source) {
  // Cache by stable string sources (data URLs / object URLs) so repeated
  // renders during interactive editing don't re-decode every image.
  if (typeof source === "string" && _bitmapCache.has(source)) {
    return _bitmapCache.get(source);
  }
  let result;
  if (typeof createImageBitmap === "function" && (source instanceof Blob)) {
    result = await createImageBitmap(source);
  } else if (source instanceof HTMLImageElement) {
    result = source;
  } else {
    result = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = typeof source === "string" ? source : URL.createObjectURL(source);
    });
  }
  if (typeof source === "string") {
    _bitmapCache.set(source, result);
    // Bound the cache so long sessions don't grow without limit.
    if (_bitmapCache.size > 240) {
      const firstKey = _bitmapCache.keys().next().value;
      _bitmapCache.delete(firstKey);
    }
  }
  return result;
}

/** Drop cached decodes (call when frames are cleared). */
export function clearBitmapCache() {
  _bitmapCache.clear();
}

function bitmapSize(b) {
  return { w: b.width || b.naturalWidth, h: b.height || b.naturalHeight };
}

// A "gap before keyframe" boundary: insert a gap band before any keyframe.
function needsGapBefore(prev, cur) {
  return !!prev && cur.isKeyframe;
}

// Split a flat list of measured items into pages under MAX_PAGE_HEIGHT.
function paginate(items, maxHeight, gapEnabled, gapSize) {
  const pages = [];
  let cur = [];
  let curH = 0;
  let prev = null;
  for (const it of items) {
    const gap = gapEnabled && needsGapBefore(prev, it) ? gapSize : 0;
    const add = gap + it.height;
    if (cur.length > 0 && curH + add > maxHeight) {
      pages.push({ items: cur, height: curH });
      cur = [];
      curH = 0;
      prev = null;
    }
    const g = gapEnabled && needsGapBefore(prev, it) ? gapSize : 0;
    curH += g + it.height;
    cur.push(it);
    prev = it;
  }
  if (cur.length > 0) pages.push({ items: cur, height: curH });
  return pages;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function drawWatermark(ctx, text, w, h) {
  if (!text) return;
  const fs = Math.round(w * 0.025);
  const pad = Math.round(w * 0.02);
  ctx.font = `${fs}px Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillText(text, w - pad + 1, h - pad + 1);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(text, w - pad, h - pad);
}

async function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return await canvas.convertToBlob({ type, quality });
  return await new Promise((res) => canvas.toBlob(res, type, quality));
}

/**
 * Render a vertical LineStack.
 * @param {Array<{source: Blob|HTMLImageElement|string, isKeyframe?: boolean, cropRatio?: number, cropTop?: number, cropBottom?: number}>} images
 * @param {object} cfg  overrides for LINESTACK_DEFAULTS
 * @param {(cur:number,total:number)=>void} [onProgress]
 * @returns {Promise<Blob[]>} one blob per page
 */
export async function renderLineStack(images, cfg = {}, onProgress = () => {}) {
  const c = { ...LINESTACK_DEFAULTS, ...cfg };
  const maxPage = MAX_PAGE_HEIGHT[c.outputWidth] || MAX_PAGE_HEIGHT[720];

  // Measure
  const measured = [];
  for (let i = 0; i < images.length; i++) {
    onProgress(i + 1, images.length);
    const b = await loadBitmap(images[i].source);
    const { w, h } = bitmapSize(b);
    const isKeyframe = !!images[i].isKeyframe;
    // Two-direction crop: cropTop removes from top, cropBottom removes from bottom.
    // Legacy cropRatio (single value) maps to cropTop = 1 - ratio, cropBottom = 0.
    let cropTop, cropBottom;
    if (typeof images[i].cropTop === 'number' || typeof images[i].cropBottom === 'number') {
      cropTop = typeof images[i].cropTop === 'number' ? images[i].cropTop : (1 - c.bottomKeepRatio);
      cropBottom = typeof images[i].cropBottom === 'number' ? images[i].cropBottom : 0;
    } else if (typeof images[i].cropRatio === 'number') {
      cropTop = 1 - images[i].cropRatio;
      cropBottom = 0;
    } else {
      cropTop = 1 - c.bottomKeepRatio;
      cropBottom = 0;
    }
    // Clamp so the kept region is at least 5% of the frame
    const keptRatio = Math.max(0.05, 1 - cropTop - cropBottom);
    cropTop = Math.max(0, Math.min(1 - 0.05, cropTop));
    cropBottom = Math.max(0, Math.min(1 - cropTop - 0.05, cropBottom));
    
    const scale = c.outputWidth / w;
    const keptH = isKeyframe ? h : Math.round(h * keptRatio);
    const drawH = Math.round(keptH * scale);
    measured.push({
      bitmap: b, natW: w, natH: h, height: drawH, isKeyframe,
      cropTop, cropBottom, keptRatio,
      captionText: images[i].captionText || '',
      hasBakedCaption: !!images[i].hasBakedCaption,
      captionScale: images[i].captionScale,
    });
  }

  const keyframeCount = measured.filter((m) => m.isKeyframe).length;
  const gapEnabled = c.enableKeyframeGap && keyframeCount >= 2;
  const pages = paginate(measured, maxPage, gapEnabled, c.gapSize);

  const type = "image/jpeg";
  const blobs = [];
  for (const page of pages) {
    const canvas = makeCanvas(c.outputWidth, page.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = c.backgroundColor || "#FFFFFF";
    ctx.fillRect(0, 0, c.outputWidth, page.height);
    let y = 0;
    let prev = null;
    for (const it of page.items) {
      if (gapEnabled && needsGapBefore(prev, it)) {
        ctx.fillStyle = c.backgroundColor;
        ctx.fillRect(0, y, c.outputWidth, c.gapSize);
        y += c.gapSize;
      }
      if (it.isKeyframe) {
        ctx.drawImage(it.bitmap, 0, 0, it.natW, it.natH, 0, y, c.outputWidth, it.height);
      } else {
        const sy = it.natH * it.cropTop;
        const sh = it.natH * it.keptRatio;
        ctx.drawImage(it.bitmap, 0, sy, it.natW, sh, 0, y, c.outputWidth, it.height);
      }
      if (!it.hasBakedCaption && it.captionText) {
        drawCaptionOverlay(ctx, it.captionText, 0, y, c.outputWidth, it.height, it.captionScale);
      }
      y += it.height;
      prev = it;
    }
    drawWatermark(ctx, c.watermarkText, c.outputWidth, page.height);
    blobs.push(await canvasToBlob(canvas, type, c.jpgQuality));
    if (measured.some((m) => m.bitmap.close)) {
      /* closed after all pages below */
    }
  }
  measured.forEach((m) => m.bitmap.close && m.bitmap.close());
  return blobs;
}

// ============================================================================
// Collage maker -- grid / mosaic layouts that reuse the same measured sources.
// ============================================================================

export const COLLAGE_DEFAULTS = {
  layout: "grid", // "grid" | "masonry" | "strip"
  columns: 2,
  cellAspect: 16 / 9, // used by "grid"
  outputWidth: 1080,
  gap: 8,
  backgroundColor: "#111111",
  cornerRadius: 0,
  jpgQuality: 0.92,
  watermarkText: "",
};

function roundRect(ctx, x, y, w, h, r) {
  if (!r) return ctx.rect(x, y, w, h);
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// cover-fit source into cell, with an optional per-image view transform.
// view = { zoom >= 1, offsetX in -1..1, offsetY in -1..1 } where the offsets
// pan the image within the extra (overflow) space the cover-fit produces.
function drawCover(ctx, b, natW, natH, x, y, w, h, r, view) {
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const zoom = Math.max(1, view?.zoom || 1);
  const scale = Math.max(w / natW, h / natH) * zoom;
  const dw = natW * scale;
  const dh = natH * scale;
  // Free room to pan (>= 0). offset -1 pins to left/top, +1 to right/bottom.
  const slackX = Math.max(0, dw - w);
  const slackY = Math.max(0, dh - h);
  const ox = clampNum(view?.offsetX ?? 0, -1, 1);
  const oy = clampNum(view?.offsetY ?? 0, -1, 1);
  const drawX = x + (w - dw) / 2 + (ox * slackX) / 2;
  const drawY = y + (h - dh) / 2 + (oy * slackY) / 2;
  ctx.drawImage(b, drawX, drawY, dw, dh);
  ctx.restore();
}

function clampNum(v, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0));
}

// Wrap a single string into lines that fit within maxWidth, using the current
// ctx font. Word-wraps on whitespace; long words are broken greedily.
function wrapTextToWidth(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${cur} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      cur = test;
    } else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines;
}

// Draw an editable caption overlay for frames whose caption is NOT baked into
// the pixels (uploads + caption-less captures). Renders a semi-transparent
// band at the bottom of the given rect with wrapped, centered white text.
// Used by both LineStack and collage exports so caption placement is consistent.
function drawCaptionOverlay(ctx, text, x, y, w, h, scale = 1) {
  if (!text) return;
  const s = Math.max(0.4, Math.min(2.5, scale));
  const padH = Math.round(w * 0.04);
  const bandH = Math.round(h * 0.26 * s);
  const fs = Math.round(bandH * 0.42);
  if (fs < 8) return; // too small to render legibly
  ctx.save();
  ctx.font = `600 ${fs}px "YouTube Noto", Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxTextWidth = Math.max(1, w - padH * 2);
  const lines = wrapTextToWidth(ctx, text, maxTextWidth);
  const lineHeight = fs * 1.25;
  const blockH = Math.min(bandH, lines.length * lineHeight + padH);
  const bandY = y + h - blockH;
  // Soft dark band so text reads over any imagery.
  ctx.fillStyle = 'rgba(8, 8, 8, 0.62)';
  ctx.fillRect(x, bandY, w, blockH);
  let ty = bandY + (blockH - lines.length * lineHeight) / 2 + lineHeight / 2;
  ctx.fillStyle = '#ffffff';
  for (const ln of lines) {
    ctx.fillText(ln, x + w / 2, ty, maxTextWidth);
    ty += lineHeight;
  }
  ctx.restore();
}

/**
 * Render a collage from images. By default returns a Blob. If cfg.returnLayout
 * is true, returns { blob, layout, width, height } for preview hit-testing.
 * @param {Array<{source: Blob|HTMLImageElement|string, view?: {zoom:number,offsetX:number,offsetY:number}, block?: {colSpan:number,heightScale:number}}>} images
 */
export async function renderCollage(images, cfg = {}, onProgress = () => {}) {
  const c = { ...COLLAGE_DEFAULTS, ...cfg };
  const measured = [];
  for (let i = 0; i < images.length; i++) {
    onProgress(i + 1, images.length);
    const b = await loadBitmap(images[i].source);
    const { w, h } = bitmapSize(b);
    measured.push({ bitmap: b, natW: w, natH: h, view: images[i].view || null, block: images[i].block || null, index: i, captionText: images[i].captionText || '', hasBakedCaption: !!images[i].hasBakedCaption, captionScale: images[i].captionScale });
  }
  if (measured.length === 0) return null;

  const cols = Math.max(1, c.columns);
  const W = c.outputWidth;
  const gap = c.gap;
  const cellW = (W - gap * (cols + 1)) / cols;

  let canvasH = 0;
  let layout = [];

  if (c.layout === "masonry") {
    // Flexible mosaic: each block can span multiple columns (block.colSpan) and
    // scale its height (block.heightScale). Blocks are greedily packed into the
    // position that keeps columns as level as possible.
    const colBottoms = new Array(cols).fill(gap);
    layout = measured.map((m) => {
      const span = Math.max(1, Math.min(cols, Math.round(m.block?.colSpan || 1)));
      const hScale = Math.max(0.35, Math.min(3, m.block?.heightScale || 1));
      // Choose the start column (0..cols-span) with the lowest max bottom.
      let best = 0;
      let bestTop = Infinity;
      for (let s = 0; s <= cols - span; s++) {
        let top = 0;
        for (let k = 0; k < span; k++) top = Math.max(top, colBottoms[s + k]);
        if (top < bestTop - 0.5) { bestTop = top; best = s; }
      }
      const w = span * cellW + (span - 1) * gap;
      const x = gap + best * (cellW + gap);
      const y = bestTop;
      // Base height follows the image aspect at this width, then user scale.
      const baseH = (w * m.natH) / m.natW;
      const h = baseH * hScale;
      for (let k = 0; k < span; k++) colBottoms[best + k] = y + h + gap;
      return { m, x, y, w, h };
    });
    canvasH = Math.max(...colBottoms);
  } else if (c.layout === "strip") {
    // single vertical column, cover-fit to a fixed aspect
    const cellH = cellW / c.cellAspect;
    layout = measured.map((m, i) => ({
      m,
      x: gap,
      y: gap + i * (cellH + gap),
      w: W - gap * 2,
      h: cellH,
    }));
    canvasH = gap + measured.length * (cellH + gap);
  } else {
    // uniform grid, cover-fit to cellAspect
    const cellH = cellW / c.cellAspect;
    const rows = Math.ceil(measured.length / cols);
    layout = measured.map((m, i) => {
      const r = Math.floor(i / cols);
      const col = i % cols;
      return {
        m,
        x: gap + col * (cellW + gap),
        y: gap + r * (cellH + gap),
        w: cellW,
        h: cellH,
      };
    });
    canvasH = gap + rows * (cellH + gap);
  }

  const canvas = makeCanvas(W, Math.round(canvasH));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = c.backgroundColor;
  ctx.fillRect(0, 0, W, canvasH);
  for (const cell of layout) {
    drawCover(ctx, cell.m.bitmap, cell.m.natW, cell.m.natH, cell.x, cell.y, cell.w, cell.h, c.cornerRadius, cell.m.view);
    if (!cell.m.hasBakedCaption && cell.m.captionText) {
      drawCaptionOverlay(ctx, cell.m.captionText, cell.x, cell.y, cell.w, cell.h, cell.m.captionScale);
    }
  }
  drawWatermark(ctx, c.watermarkText, W, canvasH);
  measured.forEach((m) => m.bitmap.close && m.bitmap.close());
  const blob = await canvasToBlob(canvas, "image/jpeg", c.jpgQuality);
  if (!c.returnLayout) return blob;
  const outLayout = layout.map((cell) => ({
    index: cell.m.index,
    x: cell.x,
    y: cell.y,
    w: cell.w,
    h: cell.h,
  }));
  return { blob, layout: outLayout, width: W, height: Math.round(canvasH) };
}
