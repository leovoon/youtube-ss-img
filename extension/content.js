// Content script for YouTube page
(function () {
  function getVideoElement() {
    return document.querySelector('video');
  }

  function getCaptionData() {
    const container = document.querySelector('.ytp-caption-window-container');
    if (!container) return null;

    // Check container visibility
    const style = window.getComputedStyle(container);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return null;
    }

    // Find the caption window element (may have rollup class)
    const captionWindow = container.querySelector('.caption-window');
    if (!captionWindow) return null;

    // Collect visual lines
    const visualLines = captionWindow.querySelectorAll('.caption-visual-line');
    if (visualLines.length === 0) return null;

    const lines = [];
    for (const visualLine of visualLines) {
      const segments = visualLine.querySelectorAll('.ytp-caption-segment');
      if (segments.length === 0) continue;

      const lineData = { text: '', segments: [] };
      for (const seg of segments) {
        const segStyle = window.getComputedStyle(seg);
        lineData.text += seg.textContent || '';
        lineData.segments.push({
          text: seg.textContent || '',
          color: segStyle.color,
          backgroundColor: segStyle.backgroundColor,
          fontSize: segStyle.fontSize,
          fontFamily: segStyle.fontFamily,
          fontWeight: segStyle.fontWeight,
          fontStyle: segStyle.fontStyle,
          padding: segStyle.padding,
        });
      }
      if (lineData.text.trim()) {
        lines.push(lineData);
      }
    }

    if (lines.length === 0) return null;

    // Get caption window position and styles
    const winStyle = window.getComputedStyle(captionWindow);

    return {
      lines,
      windowRect: captionWindow.getBoundingClientRect(),
      winBackgroundColor: winStyle.backgroundColor,
      winTextAlign: winStyle.textAlign,
    };
  }

  function drawCaptionsOnCanvas(ctx, captionData, video) {
    const videoRect = video.getBoundingClientRect();
    const scaleX = video.videoWidth / videoRect.width;
    const scaleY = video.videoHeight / videoRect.height;

    const winRect = captionData.windowRect;

    // Caption window position relative to video, scaled to native resolution
    const winX = (winRect.left - videoRect.left) * scaleX;
    const winY = (winRect.top - videoRect.top) * scaleY;
    const winWidth = winRect.width * scaleX;
    const winHeight = winRect.height * scaleY;

    // Draw caption window background
    ctx.fillStyle = captionData.winBackgroundColor || 'rgba(8, 8, 8, 0.5)';
    ctx.fillRect(winX, winY, winWidth, winHeight);

    ctx.save();

    // Parse text alignment
    const textAlign = captionData.winTextAlign || 'center';

    // Get font metrics from first segment
    const firstSeg = captionData.lines[0]?.segments[0];
    if (!firstSeg) return;

    const fontSize = parseFloat(firstSeg.fontSize) || 16;
    const scaledFontSize = fontSize * scaleY;
    const lineHeight = scaledFontSize * 1.4;
    // Segment padding is "top right bottom left", e.g. "0px 8.9px"
    const paddingParts = (firstSeg.padding || '0px 8.9px').split(/\s+/);
    const padV = parseFloat(paddingParts[0]) || 0;
    const padH = parseFloat(paddingParts[1] || paddingParts[0]) || 8.9;
    const scaledPadV = padV * scaleY;
    const scaledPadH = padH * scaleX;

    let currentY = winY + scaledFontSize * 1.1;

    for (const line of captionData.lines) {
      const seg = line.segments[0];
      const weight = seg.fontWeight || '400';
      const fontStyle = seg.fontStyle || 'normal';
      const fontFamily = seg.fontFamily || '"YouTube Noto", Roboto, Arial, sans-serif';

      ctx.font = `${fontStyle} ${weight} ${scaledFontSize}px ${fontFamily}`;

      // Measure the full line text width
      const fullTextWidth = ctx.measureText(line.text).width;

      // Compute starting X based on alignment
      // For each segment, draw its own background rect, then draw the text on top
      let drawX;
      if (textAlign === 'center') {
        drawX = winX + (winWidth - fullTextWidth) / 2;
      } else if (textAlign === 'right') {
        drawX = winX + winWidth - fullTextWidth - scaledPadH;
      } else {
        drawX = winX + scaledPadH;
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      for (const s of line.segments) {
        const segTextWidth = ctx.measureText(s.text).width;

        // Segment background
        ctx.fillStyle = s.backgroundColor || 'rgba(8, 8, 8, 0.75)';
        ctx.fillRect(
          drawX - scaledPadH,
          currentY - scaledFontSize - scaledPadV,
          segTextWidth + scaledPadH * 2,
          scaledFontSize + scaledPadV * 2
        );

        // Segment text
        ctx.fillStyle = s.color || '#ffffff';
        ctx.fillText(s.text, drawX, currentY);

        drawX += segTextWidth;
      }

      currentY += lineHeight;
    }

    ctx.restore();
  }

  async function captureFrame() {
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
      // Draw the raw video frame
      ctx.drawImage(video, 0, 0, width, height);

      // Overlay captions if visible
      const captionData = getCaptionData();
      if (captionData && captionData.lines.length > 0) {
        try {
          drawCaptionsOnCanvas(ctx, captionData, video);
        } catch (_captionError) {
          // Silently fall back to video-only if caption rendering fails
        }
      }

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
      captureFrame().then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err?.message ?? err });
      });
      return true;
    }
  });

  window.youtubeFrameGrabber = { captureFrame };
})();
