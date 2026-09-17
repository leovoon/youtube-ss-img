# Agent Instructions

These instructions apply to every change in this repository. Quality gates
are defined in `.github/workflows/ci.yml`.

## Repository facts

- **Language**: Plain JavaScript (ES modules) for the Chrome extension, built
  with [WXT](https://wxt.dev). No Rust, no WASM — the legacy `src/lib.rs` and
  `Cargo.toml` are leftovers from a previous iteration and are not built.
- **Build output**: `.output/chrome-mv3/`; release zip via `npm run zip`.
- **Node**: 18+ (WXT requirement). Package manager: npm, with
  `package-lock.json` committed (CI runs `npm ci`).

## Local commands agents must run before finishing

Run from the repo root:

```sh
npm run check      # node --check on every source file
npm test           # node --test extension/core.test.js
npm run build      # WXT production build -> .output/chrome-mv3/
npm run zip        # WXT package -> .output/<name>-<version>-chrome.zip
```

CI runs the same four gates. Match them locally before pushing.

## Architecture rules

- **No new runtime dependencies without justification.** The extension is
  plain JS; the only devDependency is `wxt`. Anything new must be evaluated
  against the standard library and existing modules first.
- **Keep `extension/core.js` pure.** No `chrome.*`, no DOM. It is shared by
  the content script and the side panel and is the only module with
  host-run unit tests (`extension/core.test.js`).
- **WXT owns the manifest.** `manifest.json` is generated; overrides belong
  in `wxt.config.ts` (permissions, commands, icons), never in a checked-in
  manifest. `extension/public/` holds verbatim-copied assets (`icons/`).
- **Entrypoints live in `extension/entrypoints/`.** Use WXT helpers
  (`defineBackground`, `defineContentScript`, `#imports`), and import shared
  modules (`core.js`, `engine.js`, `store.js`, `icons.js`) directly — there
  is no `globalThis.YTFrameCore` bridge anymore.
- **Do not weaken CI to make a change pass.** If a gate fails, fix the code.

## Testing expectations

- `extension/core.test.js` runs under `node --test`. When you add behavior
  to `core.js`, add tests for it there.
- DOM/extension behavior is not unit-tested; verify entrypoint changes with
  `npm run build` plus a manual (or Playwright-driven) load of
  `.output/chrome-mv3` in Chromium before merging.

## Build and release

```sh
npm install        # runs `wxt prepare`
npm run dev        # HMR dev build, loads unpacked
npm run build      # -> .output/chrome-mv3/
npm run zip        # -> .output/<name>-<version>-chrome.zip
```

The extension version is `package.json#version`; the zip name derives from
it. Bump it there, not in any manifest.
