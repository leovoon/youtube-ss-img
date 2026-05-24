const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const zipPath = path.join(releaseDir, 'youtube-frame-grab-alpha-v0.1.0.zip');

fs.mkdirSync(releaseDir, { recursive: true });

console.log('Building WASM...');
execSync('wasm-pack build --target web --out-name app --out-dir ./extension', {
  cwd: root,
  stdio: 'inherit',
});

console.log('Validating manifest...');
JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

console.log('Creating Chrome Web Store ZIP...');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `zip -r ${JSON.stringify(zipPath)} manifest.json popup.html popup.js background.js content.js app.js app_bg.wasm icons -x '*.DS_Store'`,
  { cwd: extensionDir, stdio: 'inherit' }
);

console.log(`Release package: ${zipPath}`);
