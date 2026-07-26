import {
  loadFrames,
  saveFrames,
  clearFrames,
  captureFrame,
  appendCapture,
  onFramesChanged,
  openSidePanel,
} from './store.js';
import { applyIcons } from './icons.js';

applyIcons();
const $ = (sel) => document.querySelector(sel);
const countEl = $('#count');
const statusEl = $('#status');

function setStatus(message, cls = '') {
  statusEl.className = `status ${cls}`;
  statusEl.textContent = message;
}

async function refresh() {
  const frames = await loadFrames();
  countEl.textContent = String(frames.length);
}

$('#captureBtn').addEventListener('click', async () => {
  $('#captureBtn').disabled = true;
  try {
    setStatus('Capturing…');
    const next = await appendCapture(await captureFrame());
    await saveFrames(next);
    await refresh();
    setStatus(`Captured frame ${next.length}.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'warn');
  } finally {
    $('#captureBtn').disabled = false;
  }
});

$('#panelBtn').addEventListener('click', async () => {
  try {
    await openSidePanel();
    window.close();
  } catch (err) {
    setStatus(err.message || String(err), 'warn');
  }
});

$('#clearBtn').addEventListener('click', async () => {
  await clearFrames();
  await refresh();
  setStatus('Cleared all frames.');
});

onFramesChanged(refresh);
refresh();
