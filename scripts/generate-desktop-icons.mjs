// Renders public/images/cit-pdf-logo.svg into the PNG icons used by the
// desktop app. Run with Electron (it provides the SVG rasterizer):
//   npx electron scripts/generate-desktop-icons.mjs
import { app, BrowserWindow } from 'electron';
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
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${svg.toString('base64')}"
         style="display:block;width:${SIZE}px;height:${SIZE}px"></body></html>`;
  await win.loadURL(
    `data:text/html;base64,${Buffer.from(html).toString('base64')}`
  );
  await new Promise((r) => setTimeout(r, 500));

  const image = await win.webContents.capturePage();
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
