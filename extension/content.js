// Content script for YouTube page
(function () {
  function getVideoElement() {
    return document.querySelector('video');
  }

  function captureFrame() {
    const video = getVideoElement();
    if (!video) {
      return { ok: false, error: 'No video element found on this page.' };
    }

    const width = video.videoWidth || video.clientWidth || 320;
    const height = video.videoHeight || video.clientHeight || 180;

    if (!width || !height) {
      return { ok: false, error: 'Video dimensions unavailable. Try after video starts playing.' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, error: 'Could not create canvas context.' };
    }

    try {
      ctx.drawImage(video, 0, 0, width, height);
      return {
        ok: true,
        url: canvas.toDataURL('image/jpeg', 0.92),
        width,
        height,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Could not capture video frame: ${error?.message ?? error}`,
      };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'capture-frame') {
      sendResponse(captureFrame());
      return true;
    }
  });

  window.youtubeFrameGrabber = { captureFrame };
})();
