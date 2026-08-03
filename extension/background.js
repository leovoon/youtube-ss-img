const FRAMES_STORAGE_KEY = 'youtube-frame-grab.frames';
const MAX_FRAMES = 200;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendFrame(response) {
  chrome.storage.local.get(FRAMES_STORAGE_KEY, (result) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      return;
    }
    const frames = result?.[FRAMES_STORAGE_KEY] || [];
    if (frames.length >= MAX_FRAMES) return;
    frames.push({
      id: uid(),
      url: response.url,
      width: response.width,
      height: response.height,
      time: response.time ?? null,
      captionText: response.captionText || '',
      type: response.hasCaption ? 'subtitle' : 'keyframe',
      capturedAt: Date.now(),
    });
    chrome.storage.local.set({ [FRAMES_STORAGE_KEY]: frames }, () => {
      if (chrome.runtime.lastError) console.error(chrome.runtime.lastError.message);
    });
  });
}

// Open the side panel directly when the toolbar icon is clicked.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'grab-frame') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url?.includes('youtube.com')) return;
    chrome.tabs.sendMessage(tab.id, { action: 'capture-frame' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      if (response?.ok) appendFrame(response);
      else console.error(response?.error || 'Could not capture frame.');
    });
  });
});
