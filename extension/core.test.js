import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { URL };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('./core.js', import.meta.url), 'utf8'), context);
const { canonicalYouTubeVideoId, chooseActiveVideoIndex, insertionIndexForPoint, reorderByInsertion, latestCaptureFrame } = context.YTFrameCore;

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

test('reorderByInsertion moves one frame while preserving frame-owned settings', () => {
  const frames = [{ id: 'a' }, { id: 'b', view: { zoom: 2 } }, { id: 'c' }, { id: 'd' }];
  const result = reorderByInsertion(frames, 1, 4);
  assert.deepEqual([...result].map((frame) => frame.id), ['a', 'c', 'd', 'b']);
  assert.equal(result[3], frames[1]);
  assert.deepEqual([...reorderByInsertion(frames, 2, 2)], frames);
});
