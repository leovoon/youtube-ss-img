# Privacy Policy

Effective date: 2026-05-24

YouTube Frame Grab is an alpha Chrome extension for capturing still frames from YouTube videos and exporting local collages.

## Data collected

The extension does not collect, sell, share, or transmit personal data to any server.

## Local data stored

The extension stores captured frame images locally using `chrome.storage.local` so frames remain available after the popup closes.

Stored data may include:

- Captured video frame images
- Frame width and height
- Frame order chosen by user

This data stays on the user's device/browser profile.

## Network requests

The extension does not make external network requests. It only runs on YouTube pages to access the current HTML video element for frame capture.

## Permissions used

- `activeTab`: communicate with current YouTube tab after user opens extension
- `scripting`: inject content script into already-open YouTube tabs after extension reload
- `storage`: save captured frames locally
- `unlimitedStorage`: avoid losing large captured frame data due to local quota
- `https://*.youtube.com/*`: access YouTube video element for capture

## Data deletion

Use **Clear Frames** in the popup to delete all captured frames. Deleting the extension also removes its local extension storage.

## Contact

Open an issue in the GitHub repository for privacy questions or bugs.
