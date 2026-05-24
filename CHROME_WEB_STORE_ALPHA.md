# Chrome Web Store Alpha Release Checklist

## Package

Upload ZIP:

```text
release/youtube-frame-grab-alpha-v0.1.0.zip
```

Build/rebuild:

```bash
node build.js
```

## Listing copy

### Name

YouTube Frame Grab

### Short description

Capture YouTube video frames and export vertical PNG/JPEG collages.

### Detailed description

YouTube Frame Grab helps you capture still frames from YouTube videos, reorder them, and export a vertical collage.

Alpha features:

- Capture current video frame from the extension popup
- Keyboard shortcut: Ctrl+Shift+G / Cmd+Shift+G
- Keep captured frames while popup opens/closes
- Delete individual frames
- Drag-and-drop reorder
- Export vertical collages as PNG or JPEG
- Local-only frame storage

Alpha limitations:

- Works on YouTube pages only
- Captured frames are stored locally in Chrome extension storage
- No cloud sync

## Category

Productivity

## Language

English

## Store assets

- Icon: `extension/icons/icon128.png`
- Screenshot: `store-assets/screenshot-1280x800.png`
- Small promo tile: `store-assets/small-promo-440x280.png`

## Privacy practices

Data usage answers:

- Does extension collect personally identifiable information? **No**
- Does extension collect health information? **No**
- Does extension collect financial/payment information? **No**
- Does extension collect authentication information? **No**
- Does extension collect personal communications? **No**
- Does extension collect location? **No**
- Does extension collect web history? **No**
- Does extension collect user activity? **No**
- Does extension collect website content? **No remote collection**. It locally captures video frames only when user requests.

Disclosure:

> Captured frames are stored locally in Chrome extension storage and are not transmitted to any server.

Privacy policy file:

```text
PRIVACY.md
```

## Permissions justification

- `activeTab`: send capture request to current YouTube tab after user opens popup
- `scripting`: inject content script into already-open YouTube tabs after extension reload
- `storage`: keep captured frames after popup closes
- `unlimitedStorage`: prevent captured image loss from local storage quota
- `https://*.youtube.com/*`: access YouTube video element for user-requested frame capture

## Manual alpha QA

- [ ] Load unpacked `extension/`
- [ ] Open YouTube video
- [ ] Capture frame from popup
- [ ] Capture several frames
- [ ] Close/reopen popup; frames persist
- [ ] Delete one frame
- [ ] Drag reorder frames
- [ ] Export PNG
- [ ] Export JPEG
- [ ] Test Ctrl+Shift+G / Cmd+Shift+G capture
- [ ] Clear frames

## Release notes

Version `0.1.0-alpha`:

- Initial alpha release
- Frame capture, persistence, delete/reorder, PNG/JPEG collage export
