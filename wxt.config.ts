import { defineConfig } from 'wxt';

// WXT (https://wxt.dev) drives the extension build.
//
// Layout: extension source lives under `extension/`, entrypoints under
// `extension/entrypoints/`, and static assets under `extension/public/` (copied verbatim, so `icons/*.png` keep the
// paths referenced below).
//
// WXT derives manifest.json from the entrypoints (background service worker,
// content script matches, side_panel) plus the overrides here. `name`,
// `version`, and `description` fall back to package.json when not set.
export default defineConfig({
  srcDir: 'extension',
  publicDir: 'extension/public',
  outDir: '.output',
  browser: 'chrome',
  manifestVersion: 3,
  manifest: {
    name: 'YouTube Screenshot with Subtitles — Frame & Caption Capture',
    description:
      'Capture YouTube screenshots with subtitles baked in. Grab video frames with captions/lyrics, export stacked collages. 100% local.',
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: 'YouTube Screenshot with Subtitles',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'unlimitedStorage'],
    host_permissions: ['https://*.youtube.com/*'],
    commands: {
      'grab-frame': {
        suggested_key: {
          default: 'Ctrl+Shift+G',
          mac: 'Command+Shift+G',
        },
        description: 'Grab current YouTube video frame',
      },
    },
  },
});
