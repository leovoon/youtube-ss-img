import init from './app.js';

const bootStatus = document.getElementById('boot-status');
const FRAMES_STORAGE_KEY = 'youtube-frame-grab.frames';

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result?.[key]);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [FRAMES_STORAGE_KEY]: value }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageRemove(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

window.loadYoutubeFrames = async function loadYoutubeFrames() {
  return (await storageGet(FRAMES_STORAGE_KEY)) || [];
};

window.storeYoutubeFrames = async function storeYoutubeFrames(frames) {
  await storageSet(frames || []);
};

window.clearYoutubeFrames = async function clearYoutubeFrames() {
  await storageRemove(FRAMES_STORAGE_KEY);
};

function sendMessageToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tab?.id) {
        reject(new Error('No active tab found.'));
        return;
      }
      if (!tab.url || !tab.url.includes('youtube.com')) {
        reject(new Error('Open a YouTube video tab first.'));
        return;
      }

      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  });
}

window.captureYoutubeFrame = async function captureYoutubeFrame() {
  let response;

  try {
    response = await sendMessageToActiveTab({ action: 'capture-frame' });
  } catch (error) {
    // Existing YouTube tabs opened before extension reload may not have content.js injected yet.
    if (!String(error?.message ?? error).includes('Receiving end does not exist')) {
      throw error;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    response = await sendMessageToActiveTab({ action: 'capture-frame' });
  }

  if (!response?.ok) {
    throw new Error(response?.error || 'Could not capture frame.');
  }

  return {
    url: response.url,
    width: response.width,
    height: response.height,
  };
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load captured frame.'));
    image.src = src;
  });
}

window.exportYoutubeFrames = async function exportYoutubeFrames(frames, format = 'png') {
  if (!frames?.length) {
    throw new Error('No frames to export.');
  }

  const images = await Promise.all(frames.map((frame) => loadImage(frame.url)));
  const width = Math.max(...frames.map((frame, index) => frame.width || images[index].naturalWidth || 320));
  const heights = frames.map((frame, index) => frame.height || images[index].naturalHeight || 180);
  const height = heights.reduce((sum, item) => sum + item, 0);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create export canvas.');

  // White background prevents transparent/black JPEG exports.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  let y = 0;
  images.forEach((image, index) => {
    const frameWidth = frames[index].width || image.naturalWidth || width;
    const frameHeight = heights[index];
    const x = Math.floor((width - frameWidth) / 2);
    ctx.drawImage(image, x, y, frameWidth, frameHeight);
    y += frameHeight;
  });

  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const extension = format === 'jpeg' ? 'jpg' : 'png';
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode collage.'));
    }, mime, 0.92);
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `youtube-frame-collage-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

init()
  .then(() => {
    bootStatus?.remove();
  })
  .catch((error) => {
    console.error('Failed to load WASM app:', error);
    if (bootStatus) {
      bootStatus.textContent = `Failed to load app: ${error?.message ?? error}`;
      bootStatus.style.color = '#b00020';
    }
  });
