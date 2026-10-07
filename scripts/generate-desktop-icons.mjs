// Renders public/images/cit-pdf-logo.svg into the PNG icons used by the
// desktop app. Run with Electron (it provides the SVG rasterizer):
//   npx electron scripts/generate-desktop-icons.mjs
import { app, BrowserWindow, nativeImage } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'public/images/cit-pdf-logo.svg'));
const SIZE = 1024;

const outputs = [
  // electron-builder derives .ico / .icns / Linux icons from this one.
  { path: 'build-resources/icon.png', size: 1024 },
  // Window icon, served with the web bundle.
  { path: 'public/images/cit-pdf-icon-512.png', size: 512 },
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // The logo is drawn on a canvas inside the page rather than captured from
  // the window: a window cannot be taller than the screen, so a capture of a
  // 1024px window comes back cropped on smaller displays.
  const win = new BrowserWindow({ width: 200, height: 200, show: false });
  await win.loadURL('about:blank');

  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${SIZE};
        canvas.getContext('2d').drawImage(img, 0, 0, ${SIZE}, ${SIZE});
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not load the logo SVG'));
      img.src = 'data:image/svg+xml;base64,${svg.toString('base64')}';
    })
  `);

  const image = nativeImage.createFromDataURL(dataUrl);
  for (const { path, size } of outputs) {
    const target = resolve(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      image.resize({ width: size, height: size, quality: 'best' }).toPNG()
    );
    console.log(`wrote ${path} (${size}x${size})`);
  }
  app.quit();
});
