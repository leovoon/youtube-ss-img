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
