// Shared storage + capture helpers for the YouTube LineStack Studio extension.
// Pure JS, no build step. Used by the side panel.

export const FRAMES_KEY = 'youtube-frame-grab.frames';
export const AUTO_KEY = 'youtube-frame-grab.auto-capture';
export const SETTINGS_KEY = 'youtube-frame-grab.settings';
export const MAX_FRAMES = 200;

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function get(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res?.[key]);
    });
  });
}

function set(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function remove(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

// Normalize any stored frame shape (older builds saved bare {url,width,height}).
function normalizeFrame(f, index) {
  const v = f.view || {};
  const b = f.block || {};
  return {
    id: f.id || uid(),
    url: f.url,
    width: f.width || 0,
    height: f.height || 0,
    type: f.type === 'keyframe' || f.type === 'subtitle' ? f.type : (index === 0 ? 'keyframe' : 'subtitle'),
    time: typeof f.time === 'number' ? f.time : null,
    captionText: f.captionText || '',
    // True when a caption is baked into the image pixels (captured frames that
    // had a visible YouTube caption). False for uploads and caption-less
    // captures — those may receive an editable caption rendered on export.
    hasBakedCaption: typeof f.hasBakedCaption === 'boolean' ? f.hasBakedCaption : Boolean(f.captionText),
    // Per-frame scale for custom (non-baked) caption overlays. 1 = default.
    captionScale: typeof f.captionScale === 'number' && Number.isFinite(f.captionScale) ? f.captionScale : 1,
    // Per-frame subtitle crop: cropTop removes from top, cropBottom from bottom.
    // Both are 0..1 ratios. null = use global setting.
    cropTop: typeof f.cropTop === 'number' && Number.isFinite(f.cropTop) ? f.cropTop : null,
    cropBottom: typeof f.cropBottom === 'number' && Number.isFinite(f.cropBottom) ? f.cropBottom : null,
    capturedAt: f.capturedAt || Date.now(),
    // Per-frame collage view transform (zoom + pan). 1 / 0 / 0 = cover-fit.
    view: {
      zoom: typeof v.zoom === 'number' ? v.zoom : 1,
      offsetX: typeof v.offsetX === 'number' ? v.offsetX : 0,
      offsetY: typeof v.offsetY === 'number' ? v.offsetY : 0,
    },
    // Per-frame masonry block sizing: column span + height scale.
    block: {
      colSpan: typeof b.colSpan === 'number' ? b.colSpan : 1,
      heightScale: typeof b.heightScale === 'number' ? b.heightScale : 1,
    },
  };
}

export async function loadFrames() {
  const raw = (await get(FRAMES_KEY)) || [];
  return raw.map(normalizeFrame);
}

export async function saveFrames(frames) {
  await set({ [FRAMES_KEY]: frames });
}

export async function clearFrames() {
  await remove(FRAMES_KEY);
}

export async function loadSettings() {
  return (await get(SETTINGS_KEY)) || {};
}

export async function saveSettings(settings) {
  await set({ [SETTINGS_KEY]: settings });
}

export function onFramesChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[FRAMES_KEY]) {
      cb((changes[FRAMES_KEY].newValue || []).map(normalizeFrame));
    }
  });
}

// Send a message to the active YouTube tab, injecting content.js if needed.
function sendToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!tab?.id) return reject(new Error('No active tab found.'));
      if (!tab.url || !tab.url.includes('youtube.com')) {
        return reject(new Error('Open a YouTube video tab first.'));
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(response);
      });
    });
  });
}

export async function captureFrame() {
  let response;
  try {
    response = await sendToActiveTab({ action: 'capture-frame' });
  } catch (error) {
    if (!String(error?.message ?? error).includes('Receiving end does not exist')) throw error;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['core.js', 'content.js'] });
    response = await sendToActiveTab({ action: 'capture-frame' });
  }
  if (!response?.ok) throw new Error(response?.error || 'Could not capture frame.');
  return response;
}

// Append a captured frame to storage, classifying it. Returns the frame list.
export async function appendCapture(response) {
  const frames = await loadFrames();
  if (frames.length >= MAX_FRAMES) {
    throw new Error(`Frame limit (${MAX_FRAMES}) reached. Clear some frames first.`);
  }
  const frame = normalizeFrame(
    {
      id: uid(),
      url: response.url,
      width: response.width,
      height: response.height,
      time: response.time ?? null,
      captionText: response.captionText || '',
      hasBakedCaption: Boolean(response.hasCaption),
      // Frames with visible captions default to subtitle bands; caption-less
      // frames default to keyframes (they carry the visual context).
      type: response.hasCaption ? 'subtitle' : 'keyframe',
      capturedAt: Date.now(),
    },
    frames.length
  );
  const next = [...frames, frame];
  await saveFrames(next);
  return next;
}

// Read an uploaded image file into a data URL with its natural dimensions.
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const url = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupt image.'));
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

// Append an uploaded image to storage as a keyframe. Uploads have no baked
// caption, so their captionText is editable and rendered on export.
export async function appendUpload(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (PNG, JPEG, or WebP).');
  }
  const frames = await loadFrames();
  if (frames.length >= MAX_FRAMES) {
    throw new Error(`Frame limit (${MAX_FRAMES}) reached. Clear some frames first.`);
  }
  const { url, width, height } = await readImageFile(file);
  const frame = normalizeFrame(
    {
      id: uid(),
      url,
      width,
      height,
      time: null,
      captionText: '',
      hasBakedCaption: false,
      type: 'keyframe',
      capturedAt: Date.now(),
    },
    frames.length
  );
  const next = [...frames, frame];
  await saveFrames(next);
  return next;
}

export function openSidePanel() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs?.[0];
      try {
        if (chrome.sidePanel?.open && tab?.windowId != null) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}
