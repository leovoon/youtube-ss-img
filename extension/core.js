function canonicalYouTubeVideoId(url) {
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

function chooseActiveVideoIndex(candidates) {
  const ranked = candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .filter((candidate) => candidate.visible && (candidate.visibleRatio ?? 1) >= 0.25)
    .sort((a, b) => Number(b.playing) - Number(a.playing) || (b.visibleRatio ?? 1) - (a.visibleRatio ?? 1) || a.centerDistance - b.centerDistance);
  return ranked[0]?.index ?? -1;
}

function insertionIndexForPoint(index, rect, clientX, clientY) {
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
function stripDropTarget(slots, fromIndex, pointerY) {
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
function edgeScrollVelocity(pointerY, top, bottom, zone, maxSpeed) {
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

function reorderByInsertion(items, fromIndex, insertionIndex) {
  if (fromIndex < 0 || fromIndex >= items.length || insertionIndex < 0 || insertionIndex > items.length) return items;
  let target = insertionIndex;
  if (target > fromIndex) target -= 1;
  if (target === fromIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(target, 0, item);
  return next;
}

function latestCaptureFrame(frames) {
  return frames.at(-1) || null;
}

globalThis.YTFrameCore = {
  canonicalYouTubeVideoId,
  chooseActiveVideoIndex,
  insertionIndexForPoint,
  stripDropTarget,
  edgeScrollVelocity,
  reorderByInsertion,
  latestCaptureFrame,
};
