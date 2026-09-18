import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalYouTubeVideoId,
  chooseActiveVideoIndex,
  insertionIndexForPoint,
  stripDropTarget,
  edgeScrollVelocity,
  reorderByInsertion,
  latestCaptureFrame,
  AUTO_DEDUP_HASH_THRESHOLD,
  normalizeCaptionText,
  dHashFromGray,
  hammingDistance,
  isDuplicateAutoCapture,
} from './core.js';

test('latestCaptureFrame returns the newest frame without changing its aspect', () => {
  const frames = [{ id: 'wide', width: 1920, height: 1080 }, { id: 'short', width: 1080, height: 1920 }];
  assert.equal(latestCaptureFrame(frames), frames[1]);
  assert.equal(latestCaptureFrame([]), null);
});

test('canonicalYouTubeVideoId recognizes watch and Shorts URLs', () => {
  assert.equal(canonicalYouTubeVideoId('https://www.youtube.com/watch?v=abc_123&t=30'), 'abc_123');
  assert.equal(canonicalYouTubeVideoId('https://www.youtube.com/shorts/xyz-789?feature=share'), 'xyz-789');
  assert.equal(canonicalYouTubeVideoId('https://youtu.be/qwerty'), 'qwerty');
  assert.equal(canonicalYouTubeVideoId('https://www.youtube.com/'), null);
});

test('chooseActiveVideoIndex ignores a barely visible outgoing Short', () => {
  const candidates = [
    { visible: true, visibleRatio: 0.05, playing: true, centerDistance: 400 },
    { visible: true, visibleRatio: 0.95, playing: false, centerDistance: 10 },
  ];
  assert.equal(chooseActiveVideoIndex(candidates), 1);
});

test('chooseActiveVideoIndex prioritizes playing visible video nearest viewport center', () => {
  const candidates = [
    { visible: true, playing: false, centerDistance: 2 },
    { visible: true, playing: true, centerDistance: 40 },
    { visible: true, playing: true, centerDistance: 8 },
    { visible: false, playing: true, centerDistance: 0 },
  ];
  assert.equal(chooseActiveVideoIndex(candidates), 2);
});

test('insertionIndexForPoint chooses before or after visual midpoint', () => {
  const rect = { left: 10, top: 20, width: 100, height: 200 };
  assert.equal(insertionIndexForPoint(3, rect, 40, 40), 3);
  assert.equal(insertionIndexForPoint(3, rect, 80, 190), 4);
});

// Four 100px-tall frames stacked at y=0..400; frame 1 (100..200) is dragged.
const slots = [0, 1, 2, 3].map((index) => ({ index, top: index * 100, bottom: index * 100 + 100 }));
const drop = stripDropTarget;

test('stripDropTarget counts midpoints above the pointer and reports the gap line', () => {
  // Pointer over the top half of frame 0 → insert before 0, line at its top edge.
  assert.deepEqual(drop(slots, 1, 20), { insertionIndex: 0, boundaryY: 0, moves: true });
  // Bottom half of frame 2 → insert before 3 (index 3), line at frame 3's top.
  assert.deepEqual(drop(slots, 1, 280), { insertionIndex: 3, boundaryY: 300, moves: true });
  // Below everything → insertion index = items.length, line at last frame's bottom.
  assert.deepEqual(drop(slots, 1, 999), { insertionIndex: 4, boundaryY: 400, moves: true });
  // Above everything → insert at 0.
  assert.deepEqual(drop(slots, 1, -50), { insertionIndex: 0, boundaryY: 0, moves: true });
});

test('stripDropTarget flags no-op drops adjacent to the dragged frame', () => {
  // Bottom half of frame 0 → insertion index 1 === fromIndex → no move.
  assert.equal(stripDropTarget(slots, 1, 80).moves, false);
  // Top half of frame 2 → insertion index 2 === fromIndex + 1 → no move.
  assert.equal(stripDropTarget(slots, 1, 220).moves, false);
  // Result feeds reorderByInsertion without changing order.
  const items = ['a', 'b', 'c', 'd'];
  for (const y of [80, 150, 220]) {
    assert.deepEqual([...reorderByInsertion(items, 1, stripDropTarget(slots, 1, y).insertionIndex)], items);
  }
});

test('stripDropTarget agrees with reorderByInsertion on the final position', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual([...reorderByInsertion(items, 1, stripDropTarget(slots, 1, 280).insertionIndex)], ['a', 'c', 'b', 'd']);
  assert.deepEqual([...reorderByInsertion(items, 1, stripDropTarget(slots, 1, 999).insertionIndex)], ['a', 'c', 'd', 'b']);
  assert.deepEqual([...reorderByInsertion(items, 3, stripDropTarget(slots, 3, 20).insertionIndex)], ['d', 'a', 'b', 'c']);
});

test('stripDropTarget with a single frame is always a no-op', () => {
  assert.deepEqual(drop([slots[0]], 0, 50), { insertionIndex: 0, boundaryY: null, moves: false });
});

test('edgeScrollVelocity is zero in the middle and ramps toward the edges', () => {
  assert.equal(edgeScrollVelocity(300, 0, 600, 48, 16), 0);
  assert.equal(edgeScrollVelocity(48, 0, 600, 48, 16), 0);
  assert.equal(edgeScrollVelocity(552, 0, 600, 48, 16), 0);
  assert.ok(edgeScrollVelocity(40, 0, 600, 48, 16) < 0);
  assert.ok(edgeScrollVelocity(560, 0, 600, 48, 16) > 0);
  assert.equal(edgeScrollVelocity(0, 0, 600, 48, 16), -16);
  assert.equal(edgeScrollVelocity(600, 0, 600, 48, 16), 16);
  // Clamped when the pointer leaves the container entirely.
  assert.equal(edgeScrollVelocity(-500, 0, 600, 48, 16), -16);
  // Quadratic: halfway into the zone is a quarter of max speed (ceil'd).
  assert.equal(edgeScrollVelocity(24, 0, 600, 48, 16), -4);
});

test('reorderByInsertion moves one frame while preserving frame-owned settings', () => {
  const frames = [{ id: 'a' }, { id: 'b', view: { zoom: 2 } }, { id: 'c' }, { id: 'd' }];
  const result = reorderByInsertion(frames, 1, 4);
  assert.deepEqual([...result].map((frame) => frame.id), ['a', 'c', 'd', 'b']);
  assert.equal(result[3], frames[1]);
  assert.deepEqual([...reorderByInsertion(frames, 2, 2)], frames);
});

test('normalizeCaptionText collapses wrapping and stray whitespace', () => {
  assert.equal(normalizeCaptionText('  hello   world  '), 'hello world');
  assert.equal(normalizeCaptionText('hello\n  world'), 'hello world');
  assert.equal(normalizeCaptionText(null), '');
  assert.equal(normalizeCaptionText(undefined), '');
});

test('dHashFromGray encodes horizontal brightness gradients as bits', () => {
  // 9x8 increasing gradient: every right neighbor is brighter -> all 1s.
  const rising = new Array(9 * 8).fill(0).map((_, i) => i % 9);
  assert.equal(dHashFromGray(rising), '1'.repeat(64));
  // Falling gradient -> all 0s.
  const falling = new Array(9 * 8).fill(0).map((_, i) => 8 - (i % 9));
  assert.equal(dHashFromGray(falling), '0'.repeat(64));
  // Too little pixel data -> null, callers treat as uncomparable.
  assert.equal(dHashFromGray([1, 2, 3]), null);
  assert.equal(dHashFromGray(null), null);
});

test('hammingDistance counts differing bits and rejects uncomparable input', () => {
  assert.equal(hammingDistance('0000', '0000'), 0);
  assert.equal(hammingDistance('0000', '1111'), 4);
  assert.equal(hammingDistance('0101', '0011'), 2);
  assert.equal(hammingDistance('', ''), Number.POSITIVE_INFINITY);
  assert.equal(hammingDistance('01', '011'), Number.POSITIVE_INFINITY);
  assert.equal(hammingDistance('01', null), Number.POSITIVE_INFINITY);
});

test('isDuplicateAutoCapture skips repeated subtitles and static frames only', () => {
  const hash = (bits) => bits; // 64-char bit strings
  const same = hash('0'.repeat(64));
  const moved = hash(('1'.repeat(10) + '0'.repeat(54)));

  // No previous frame -> never a duplicate.
  assert.equal(isDuplicateAutoCapture(null, { captionText: 'hi', hash: same }), false);
  // Same caption, identical pixels -> duplicate.
  assert.equal(
    isDuplicateAutoCapture({ captionText: 'hi', hash: same }, { captionText: 'hi', hash: same }),
    true
  );
  // Same caption, but the scene changed underneath -> keep.
  assert.equal(
    isDuplicateAutoCapture({ captionText: 'hi', hash: same }, { captionText: 'hi', hash: moved }),
    false
  );
  // Whitespace-only caption difference still counts as the same subtitle.
  assert.equal(
    isDuplicateAutoCapture({ captionText: 'hi there', hash: same }, { captionText: 'hi\n there ', hash: same }),
    true
  );
  // New subtitle text -> keep even if pixels match (static scene).
  assert.equal(
    isDuplicateAutoCapture({ captionText: 'old line', hash: same }, { captionText: 'new line', hash: same }),
    false
  );
  // Caption appeared or disappeared -> keep.
  assert.equal(isDuplicateAutoCapture({ captionText: 'line', hash: same }, { captionText: '', hash: same }), false);
  assert.equal(isDuplicateAutoCapture({ captionText: '', hash: same }, { captionText: 'line', hash: same }), false);
  // No captions on either side: static frame -> duplicate, moving video -> keep.
  assert.equal(isDuplicateAutoCapture({ captionText: '', hash: same }, { captionText: '', hash: same }), true);
  assert.equal(isDuplicateAutoCapture({ captionText: '', hash: same }, { captionText: '', hash: moved }), false);
  // Missing hash -> cannot compare -> keep.
  assert.equal(isDuplicateAutoCapture({ captionText: '', hash: null }, { captionText: '', hash: same }), false);
  assert.equal(isDuplicateAutoCapture({ captionText: 'hi', hash: same }, { captionText: 'hi', hash: null }), false);
  // Custom threshold: 10 flipped bits is a dup at 10 but not at the default 6.
  assert.equal(isDuplicateAutoCapture({ captionText: '', hash: same }, { captionText: '', hash: moved }, 10), true);
  assert.equal(
    isDuplicateAutoCapture({ captionText: '', hash: same }, { captionText: '', hash: moved }, AUTO_DEDUP_HASH_THRESHOLD),
    false
  );
});
