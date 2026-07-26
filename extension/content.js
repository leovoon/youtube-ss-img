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

    // Find the caption window element
    const captionWindow = container.querySelector('.caption-window');
    if (!captionWindow) return null;

    // YouTube's caption DOM varies by build: older versions wrap each line
    // in `.caption-visual-line` / `.caption-rollup-line`, the current build
    // uses a flat list of `.ytp-caption-segment` with no per-line wrapper.
    // Grouping by rendered Y position works for all of them.
    const segments = Array.from(captionWindow.querySelectorAll('.ytp-caption-segment'));
    if (segments.length === 0) return null;

    const lineGroups = groupSegmentsByLine(segments);

    const lines = [];
    for (const group of lineGroups) {
      const lineData = { text: '', segments: [] };
      for (const seg of group) {
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

  function drawCaptionsOnCanvas(ctx, captionData, playerRect, scaleX, scaleY) {
    const winRect = captionData.windowRect;

    // Caption window position relative to the reference rect (union of video
    // and caption bounds), scaled to canvas resolution
    const winX = (winRect.left - playerRect.left) * scaleX;
    const winY = (winRect.top - playerRect.top) * scaleY;
    const winWidth = winRect.width * scaleX;
    const winHeight = winRect.height * scaleY;

    ctx.save();

    // Parse text alignment
    const textAlign = captionData.winTextAlign || 'center';

    // Get font metrics from first segment
    const firstSeg = captionData.lines[0]?.segments[0];
    if (!firstSeg) {
      ctx.restore();
      return;
    }

    const fontSize = parseFloat(firstSeg.fontSize) || 16;
    const scaledFontSize = fontSize * scaleY;
    const lineHeight = scaledFontSize * 1.4;
    // Segment padding is "top right bottom left", e.g. "0px 8.9px"
    const paddingParts = (firstSeg.padding || '0px 8.9px').split(/\s+/);
    const padV = parseFloat(paddingParts[0]) || 0;
    const padH = parseFloat(paddingParts[1] || paddingParts[0]) || 8.9;
    const scaledPadV = padV * scaleY;
    const scaledPadH = padH * scaleX;
    const fontFamily = firstSeg.fontFamily || '"YouTube Noto", Roboto, Arial, sans-serif';
    const fontWeight = firstSeg.fontWeight || '400';
    const fontStyle = firstSeg.fontStyle || 'normal';
    ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // YouTube's caption DOM keeps multi-line captions as a single segment with
    // `white-space: pre-wrap` — the browser wraps visually but the DOM text
    // stays as one long string. Wrap to fit within the caption window so
    // canvas output matches what the player shows.
    const maxTextWidth = Math.max(1, winWidth - 2 * scaledPadH);
    const wrappedLines = [];
    for (const line of captionData.lines) {
      wrappedLines.push(...wrapLineToWidth(line, maxTextWidth, ctx));
    }

    // Draw caption window background tall enough to cover all wrapped lines.
    const totalHeight = wrappedLines.length * lineHeight + scaledFontSize * 0.4;
    ctx.fillStyle = captionData.winBackgroundColor || 'rgba(8, 8, 8, 0.5)';
    ctx.fillRect(winX, winY, winWidth, Math.max(winHeight, totalHeight));

    let currentY = winY + scaledFontSize * 1.1;

    for (const line of wrappedLines) {
      // Measure the full line text width
      const fullTextWidth = ctx.measureText(line.text).width;

      // Compute starting X based on alignment
      let drawX;
      if (textAlign === 'center') {
        drawX = winX + (winWidth - fullTextWidth) / 2;
      } else if (textAlign === 'right') {
        drawX = winX + winWidth - fullTextWidth - scaledPadH;
      } else {
        drawX = winX + scaledPadH;
      }

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

  // Wrap a line's text into sub-lines that fit within maxWidth. Single-segment
  // lines word-wrap on whitespace; multi-segment lines pack segments greedily
  // and split between segments when they would overflow.
  function wrapLineToWidth(line, maxWidth, ctx) {
    if (!line.segments || line.segments.length === 0) return [line];

    const fullWidth = ctx.measureText(line.text).width;
    if (fullWidth <= maxWidth) return [line];

    if (line.segments.length === 1) {
      const seg = line.segments[0];
      const wrapped = [];
      let currentText = '';
      let currentWidth = 0;

      // Split on whitespace boundaries, keeping separators so spaces survive.
      // Each wrapped line keeps ONE segment (the original style); drawing one
      // background per line — not per token — matches the unwrapped look.
      const tokens = seg.text.split(/(\s+)/);
      for (const token of tokens) {
        if (!token) continue;
        const tokenWidth = ctx.measureText(token).width;
        if (currentWidth + tokenWidth > maxWidth && currentText.length > 0) {
          wrapped.push({
            text: currentText,
            segments: [{ ...seg, text: currentText }],
          });
          currentText = '';
          currentWidth = 0;
        }
        currentText += token;
        currentWidth += tokenWidth;
      }
      if (currentText.length > 0) {
        wrapped.push({
          text: currentText,
          segments: [{ ...seg, text: currentText }],
        });
      }
      return wrapped.length > 0 ? wrapped : [line];
    }

    // Multi-segment: pack segments greedily, splitting between segments.
    const wrapped = [];
    let current = { text: '', segments: [] };
    let currentWidth = 0;
    for (const seg of line.segments) {
      const segWidth = ctx.measureText(seg.text).width;
      if (currentWidth + segWidth > maxWidth && current.segments.length > 0) {
        wrapped.push(current);
        current = { text: '', segments: [] };
        currentWidth = 0;
      }
      current.text += seg.text;
      current.segments.push(seg);
      currentWidth += segWidth;
    }
    if (current.segments.length > 0) wrapped.push(current);
    return wrapped.length > 0 ? wrapped : [line];
  }

  // Group caption segments into visual lines by their rendered Y position.
  // Segments at the same Y (within a small threshold) belong to the same line.
  function groupSegmentsByLine(segments) {
    const LINE_THRESHOLD_PX = 4;
    const sorted = segments.slice().sort((a, b) => {
      const aTop = a.getBoundingClientRect().top;
      const bTop = b.getBoundingClientRect().top;
      return aTop - bTop || a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });

    const groups = [];
    for (const seg of sorted) {
      const segTop = seg.getBoundingClientRect().top;
      const lastGroup = groups[groups.length - 1];
      if (lastGroup) {
        const lastTop = lastGroup[0].getBoundingClientRect().top;
        if (Math.abs(segTop - lastTop) <= LINE_THRESHOLD_PX) {
          lastGroup.push(seg);
          continue;
        }
      }
      groups.push([seg]);
    }

    for (const group of groups) {
      group.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    }

    return groups;
  }

  async function captureFrame() {
    const video = getVideoElement();
    if (!video) {
      return { ok: false, error: 'No video element found on this page.' };
    }

    const vw = video.videoWidth || video.clientWidth || 320;
    const vh = video.videoHeight || video.clientHeight || 180;

    if (!vw || !vh) {
      return { ok: false, error: 'Video dimensions unavailable. Try after video starts playing.' };
    }

    // The video element can be smaller than its player container (letterboxed
    // on certain aspect ratios). Captions live in the player, so capture the
    // player area at the video's scale and draw the video at its offset —
    // this preserves the 2% bottom gap the player shows under the caption.
    const player = video.closest('.html5-video-player') || video.parentElement;
    const playerRect = player ? player.getBoundingClientRect() : video.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();

    const scaleX = vw / videoRect.width;
    const scaleY = vh / videoRect.height;

    const canvasWidth = Math.max(1, Math.ceil(playerRect.width * scaleX));
    const canvasHeight = Math.max(1, Math.ceil(playerRect.height * scaleY));

    const videoCanvasX = (videoRect.left - playerRect.left) * scaleX;
    const videoCanvasY = (videoRect.top - playerRect.top) * scaleY;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, error: 'Could not create canvas context.' };
    }

    try {
      // Draw the raw video frame at its position within the player
      ctx.drawImage(video, videoCanvasX, videoCanvasY, vw, vh);

      let captionText = '';
      const captionData = getCaptionData();
      if (captionData && captionData.lines.length > 0) {
        captionText = captionData.lines.map((l) => l.text).join(' ').trim();
        try {
          drawCaptionsOnCanvas(ctx, captionData, playerRect, scaleX, scaleY);
        } catch (_captionError) {
          // Silently fall back to video-only if caption rendering fails
        }
      }

      return {
        ok: true,
        url: canvas.toDataURL('image/jpeg', 0.92),
        width: canvasWidth,
        height: canvasHeight,
        time: Number.isFinite(video.currentTime) ? video.currentTime : null,
        captionText,
        hasCaption: Boolean(captionText),
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
