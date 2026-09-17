import { defineConfig } from 'wxt';

// WXT (https://wxt.dev) drives the extension build.
//
// Layout: extension source lives under `extension/` (the repo's `src/` belongs
// to the Rust crate), entrypoints under `extension/entrypoints/`, and static
// assets under `extension/public/` (copied verbatim, so `icons/*.png` keep the
// paths referenced below).
//
// WXT derives manifest.json from the entrypoints (background service worker,
// content script matches, side_panel) plus the overrides here. `name`,
// `version`, and `description` fall back to package.json when not set.
export default defineConfig({
  srcDir: 'extension',
  outDir: '.output',
  browser: 'chrome',
  manifestVersion: 3,
  manifest: {
    name: 'YouTube LineStack Studio',
    description:
      'Capture YouTube frames with captions, then export subtitle-preserving LineStack images and collages. Runs locally.',
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: 'YouTube LineStack Studio',
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
