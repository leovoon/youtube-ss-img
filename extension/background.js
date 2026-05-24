const FRAMES_STORAGE_KEY = 'youtube-frame-grab.frames';

function appendFrame(frame) {
  chrome.storage.local.get(FRAMES_STORAGE_KEY, (result) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      return;
    }

    const frames = result?.[FRAMES_STORAGE_KEY] || [];
    frames.push(frame);

    chrome.storage.local.set({ [FRAMES_STORAGE_KEY]: frames }, () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
      }
    });
  });
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

      if (response?.ok) {
        appendFrame({
          url: response.url,
          width: response.width,
          height: response.height,
        });
      } else {
        console.error(response?.error || 'Could not capture frame.');
      }
    });
  });
});
