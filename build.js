const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const manifestPath = path.join(extensionDir, 'manifest.json');

fs.mkdirSync(releaseDir, { recursive: true });

console.log('Validating manifest...');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const zipPath = path.join(releaseDir, `youtube-linestack-studio-v${manifest.version}.zip`);

const files = [
  'manifest.json',
  'sidepanel.html',
  'sidepanel.js',
  'background.js',
  'core.js',
  'content.js',
  'engine.js',
  'store.js',
  'icons.js',
  'studio.css',
  'icons',
];

for (const f of files) {
  const p = path.join(extensionDir, f);
  if (!fs.existsSync(p)) throw new Error(`Missing extension file: ${f}`);
}

console.log('Creating Chrome Web Store ZIP...');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(`zip -r ${JSON.stringify(zipPath)} ${files.join(' ')} -x '*.DS_Store'`, {
  cwd: extensionDir,
  stdio: 'inherit',
});

console.log(`Release package: ${zipPath}`);
