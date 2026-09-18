// Pure, DOM-free helpers shared by the content script and the side panel.
// Keep this file free of `chrome.*` and `window` so it stays testable under
// plain Node (see core.test.js).

export function canonicalYouTubeVideoId(url) {
  try {
    const parsed = new URL(url, 'https://www.youtube.com');
    if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    const shorts = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shorts) return shorts[1];
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
    return null;
  } catch {
    return null;
  }
}

export function chooseActiveVideoIndex(candidates) {
  const ranked = candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .filter((candidate) => candidate.visible && (candidate.visibleRatio ?? 1) >= 0.25)
    .sort((a, b) => Number(b.playing) - Number(a.playing) || (b.visibleRatio ?? 1) - (a.visibleRatio ?? 1) || a.centerDistance - b.centerDistance);
  return ranked[0]?.index ?? -1;
}

export function insertionIndexForPoint(index, rect, clientX, clientY) {
  const vertical = rect.height >= rect.width;
  const after = vertical
    ? clientY >= rect.top + rect.height / 2
    : clientX >= rect.left + rect.width / 2;
  return index + (after ? 1 : 0);
}

// Vertical strip drop target. `slots` = [{ index, top, bottom }] for every
// frame (dragged one included; it is ignored). Insertion index is the count
// of other frames whose vertical midpoint is above the pointer, expressed in
// the original array's index space so reorderByInsertion can consume it.
export function stripDropTarget(slots, fromIndex, pointerY) {
  const others = slots
    .filter((slot) => slot.index !== fromIndex)
    .sort((a, b) => a.top - b.top);
  if (others.length === 0) return { insertionIndex: fromIndex, boundaryY: null, moves: false };

  let k = 0;
  while (k < others.length && pointerY >= (others[k].top + others[k].bottom) / 2) k += 1;

  const insertionIndex = k < others.length ? others[k].index : others.length + 1;
  const boundaryY = k < others.length ? others[k].top : others[others.length - 1].bottom;
  const moves = insertionIndex !== fromIndex && insertionIndex !== fromIndex + 1;
  return { insertionIndex, boundaryY, moves };
}

// Signed scroll speed (px/frame) when the pointer is inside the top/bottom
// edge zone of a scroll container; eases quadratically toward the edge.
export function edgeScrollVelocity(pointerY, top, bottom, zone, maxSpeed) {
  if (pointerY < top + zone) {
    const t = Math.min(1, (top + zone - pointerY) / zone);
    return -Math.ceil(maxSpeed * t * t);
  }
  if (pointerY > bottom - zone) {
    const t = Math.min(1, (pointerY - (bottom - zone)) / zone);
    return Math.ceil(maxSpeed * t * t);
  }
  return 0;
}

export function reorderByInsertion(items, fromIndex, insertionIndex) {
  if (fromIndex < 0 || fromIndex >= items.length || insertionIndex < 0 || insertionIndex > items.length) return items;
  let target = insertionIndex;
  if (target > fromIndex) target -= 1;
  if (target === fromIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(target, 0, item);
  return next;
}

export function latestCaptureFrame(frames) {
  return frames.at(-1) || null;
}

// ---------------------------------------------------------------------------
// Auto-capture dedup — pure helpers. The side panel feeds these a caption
// string (already extracted from YouTube's caption DOM at capture time, so no
// OCR is needed) plus a difference hash of the frame's pixels, and skips
// captures that repeat the previous one.
// ---------------------------------------------------------------------------

// Hamming-distance budget (of 64 bits) below which two frames count as the
// same image. Lossless captures of a static scene land at 0-2; real cuts land
// well above 20.
export const AUTO_DEDUP_HASH_THRESHOLD = 6;

// Collapse whitespace so captions that only wrapped differently compare equal.
export function normalizeCaptionText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// Difference hash (dHash) over a width x height luminance grid (0-255 per
// pixel, row-major). Standard 9x8 grid -> one bit per horizontal pixel pair
// -> 64-bit hash returned as a '0'/'1' string. Returns null for bad input.
export function dHashFromGray(gray, width = 9, height = 8) {
  if (!gray || gray.length < width * height) return null;
  let bits = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      bits += gray[y * width + x + 1] > gray[y * width + x] ? '1' : '0';
    }
  }
  return bits;
}

// Number of differing positions between two equal-length bit strings.
// Non-comparable input yields Infinity so callers treat it as "not a match".
export function hammingDistance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.length || a.length !== b.length) {
    return Number.POSITIVE_INFINITY;
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d += 1;
  }
  return d;
}

// Decide whether an auto-captured frame duplicates the previous kept one.
// `previous`/`next` = { captionText: string, hash: string|null }.
//  - New subtitle text => keep (new content even if the scene is static).
//  - Caption appeared or disappeared => keep.
//  - Same subtitle text (or both blank) => keep only when the pixels moved
//    more than `threshold` bits, so a scene change under the same caption is
//    still captured while a paused/static video is skipped.
export function isDuplicateAutoCapture(previous, next, threshold = AUTO_DEDUP_HASH_THRESHOLD) {
  if (!previous || !next) return false;
  const prevCaption = normalizeCaptionText(previous.captionText);
  const nextCaption = normalizeCaptionText(next.captionText);
  if (prevCaption && nextCaption) {
    if (prevCaption !== nextCaption) return false; // new subtitle line
  } else if (!prevCaption !== !nextCaption) {
    return false; // caption appeared or disappeared
  }
  const distance = hammingDistance(previous.hash, next.hash);
  if (!Number.isFinite(distance)) return false; // missing/uncomparable hash
  return distance <= threshold;
}
