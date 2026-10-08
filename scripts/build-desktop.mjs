#!/usr/bin/env node
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

// CIT-PDF has its own version (desktop/package.json), independent of the
// upstream BentoPDF version in the root package.json.
const desktopVersion = JSON.parse(
  readFileSync(resolve(root, 'desktop', 'package.json'), 'utf8')
).version;

console.log('=== Building CIT-PDF Desktop Application ===');

// 1. Build web assets for desktop (tools only, no compression duplicates, no SW precache)
console.log('1. Building frontend with Vite (desktop mode)...');
execSync('npx vite build', {
  cwd: root,
  stdio: 'inherit',
  env: {
    // Desktop branding defaults; override by setting these before running.
    VITE_BRAND_NAME: 'CIT-PDF',
    VITE_BRAND_LOGO: 'images/cit-pdf-logo.svg',
    VITE_FOOTER_TEXT:
      '© 2026 CIT-PDF · Cường IT. Dựa trên BentoPDF (AGPL-3.0).',
    VITE_DEFAULT_LANGUAGE: 'vi',
    // OCR language packs offered as downloads (desktop/app/modules-manifest.json).
    VITE_TESSERACT_AVAILABLE_LANGUAGES: 'vie,eng',
    ...process.env,
    VITE_DESKTOP: 'true',
    SIMPLE_MODE: 'true',
    APP_VERSION: desktopVersion,
  },
});

// 2. Compile desktop TypeScript files (Electron main, preload, protocol, modules-manager)
console.log('2. Compiling desktop Electron processes...');
execSync('npx tsc -p desktop/tsconfig.json', {
  cwd: root,
  stdio: 'inherit',
});

// The main process needs `tar` at runtime. It is installed inside desktop/
// so the package carries only that, not the web app's dependencies (those
// are already bundled by Vite). Without this, electron-builder falls back
// to the root node_modules and the installer grows by several hundred MB.
if (!existsSync(resolve(root, 'desktop', 'node_modules', 'tar'))) {
  console.log('   Installing main-process dependencies in desktop/...');
  execSync('npm install --omit=dev --no-audit --no-fund', {
    cwd: resolve(root, 'desktop'),
    stdio: 'inherit',
  });
}

// 3. Ensure bundled modules exist
const cpdfDistDir = resolve(root, 'desktop', 'bundled-modules', 'cpdf', 'dist');
mkdirSync(cpdfDistDir, { recursive: true });
const cpdfSource = resolve(root, 'public', 'coherentpdf.browser.min.js');
if (existsSync(cpdfSource)) {
  copyFileSync(cpdfSource, resolve(cpdfDistDir, 'coherentpdf.browser.min.js'));
  console.log('3. Bundled cpdf into desktop/bundled-modules.');
}

// 4. Sync web bundle to desktop/dist-web (filtering heavy/unneeded files)
console.log('4. Syncing web bundle to desktop/dist-web...');
const srcDist = resolve(root, 'dist');
const targetWeb = resolve(root, 'desktop', 'dist-web');

rmSync(targetWeb, { recursive: true, force: true });

function copyFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = resolve(src, entry.name);
    const d = resolve(dest, entry.name);

    // Skip heavy LibreOffice binaries and SW from installer bundle
    if (
      entry.name === 'soffice.wasm.gz' ||
      entry.name === 'soffice.data.gz' ||
      entry.name === 'sw.js'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      copyFiltered(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

copyFiltered(srcDist, targetWeb);
console.log('   Synced desktop/dist-web without heavy WASM binaries.');

console.log('=== Desktop build completed successfully! ===');
console.log('Run "npm run desktop" to launch the desktop application.');
