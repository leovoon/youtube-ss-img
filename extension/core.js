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
  reorderByInsertion,
  latestCaptureFrame,
};
