# YouTube Frame Grab

Alpha Chrome extension for capturing frames from YouTube videos and exporting them as a vertical collage.

| Capture frames | Export collage |
| --- | --- |
| <img src="docs/images/screenshot1.png" alt="YouTube Frame Grab capture screenshot" width="100%"> | <img src="docs/images/screenshot2.jpg" alt="YouTube Frame Grab collage screenshot" width="100%"> |

## Alpha features

- Capture current YouTube video frame from popup
- Keyboard capture: `Ctrl+Shift+G` / `Cmd+Shift+G`
- Keep captured frames across popup close/reopen
- Delete individual frames
- Drag-and-drop frame reordering
- Export vertical collage as PNG or JPEG
- Local-only storage via `chrome.storage.local`

## Build

Prereqs:

- Rust stable
- `wasm32-unknown-unknown` target
- `wasm-pack`
- Node.js
- zip CLI

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
node build.js
```

Build output:

```text
extension/app.js
extension/app_bg.wasm
release/youtube-frame-grab-alpha-v0.1.0.zip
```

## Technical Architecture

### Mermaid Diagram

```mermaid
flowchart TD
    subgraph Extension["Chrome Extension (MV3)"]
        M["manifest.json
(entrypoint)"]
        P["popup.html + popup.js
(host)"]
        B["background.js
(service worker)"]
        C["content.js
(injected)"]
        YT["YouTube
video tag"]
    end

    subgraph WASM["Rust/WASM (Yew UI)"]
        APP["App (lib.rs)
• Grab Frame
• Save PNG/JPEG
• Clear All
• Drag reorder
• Delete one"]
        WB["window bridge
captureYoutubeFrame()
loadYoutubeFrames()
storeYoutubeFrames()
clearYoutubeFrames()
exportYoutubeFrames()"]
    end

    subgraph Storage["chrome.storage.local"]
        STORAGE["youtube-frame-grab.frames[]
[{url, width, height}, ...]"]
    end

    M -->|click icon| P
    B -->|keyboard shortcut| C
    C -->|capture frame| YT
    YT -->|canvas.draw
toDataURL| C
    C -->|sendMessage| P
    P -->|grab/save/clear| APP
    APP -->|calls| WB
    WB -->|store frames| STORAGE
    STORAGE <--> WB
```

## Local install

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select `extension/`
5. Open a YouTube video
6. Click extension icon and capture frames

## Privacy

See `PRIVACY.md`. Captured frames stay local in Chrome extension storage unless user exports/downloads them.
