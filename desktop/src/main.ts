import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync, spawn } from 'node:child_process';
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Menu,
  net,
  session,
} from 'electron';
import { registerAppScheme, setupAppProtocol } from './protocol.js';
import { ModulesManager } from './modules-manager.js';
import { fill, setUiLanguage, ui } from './ui-strings.js';
import { isNewerVersion } from './version.js';
import { findInstaller, type ReleaseInstaller } from './release-installer.js';
import {
  IPC_CHANNELS,
  PRINT_DUPLEX_MODES,
  PRINT_PAPER_SIZES,
  type DesktopModuleName,
  type EnsureResult,
  type FolderInstallResult,
  type ModuleProgress,
  type ModuleStatus,
  type OpenedFile,
  type PrinterInfo,
  type PrintDuplexMode,
  type PrintPaperSize,
  type PrintRequest,
  type PrintResult,
  type SaveMode,
  type SavedDownload,
  type InstallUpdateResult,
  type UpdateCheckResult,
  type UpdateProgress,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Must register privileged scheme before app is ready
registerAppScheme();

// Conversions run in the renderer and its workers. Chromium deprioritises
// the renderer of a minimised or covered window, which slows a LibreOffice
// conversion to a crawl until the user returns. Keep it at full priority.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// 2. Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

const APP_NAME = 'CIT-PDF';
const APP_ORIGIN = 'app://bentopdf';
const RELEASES_PAGE = 'https://github.com/Cuongyd196/cit-pdf/releases';
const LATEST_RELEASE_API =
  'https://api.github.com/repos/Cuongyd196/cit-pdf/releases/latest';
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

// The window that last had focus: where menu actions and files from the OS go.
let activeWindow: BrowserWindow | null = null;
let modulesManager: ModulesManager | null = null;
let iconPath = '';

// Files the user explicitly handed to the app (OS "Open with", File > Open).
// The renderer may only read paths that are in this set.
const allowedOpenPaths = new Set<string>();
// One file waiting to be picked up, per window (keyed by webContents id).
const pendingOpenFiles = new Map<number, string>();
// A file macOS hands over before the app is ready to open a window.
let startupFile: string | null = null;

function findPdfArg(argv: string[], cwd = process.cwd()): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || !/\.pdf$/i.test(arg)) continue;
    const resolved = path.resolve(cwd, arg);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

// Hands a file to the active window. Its page decides what happens next: a
// window that already shows a document asks for a new window instead.
function queueOpenFile(filePath: string) {
  allowedOpenPaths.add(filePath);
  if (!activeWindow) {
    if (app.isReady()) createWindow(filePath);
    else startupFile = filePath;
    return;
  }
  pendingOpenFiles.set(activeWindow.webContents.id, filePath);
  activeWindow.webContents.send(IPC_CHANNELS.FILE_OPENED);
}

async function showOpenFileDialog() {
  if (!activeWindow) return;
  const result = await dialog.showOpenDialog(activeWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!result.canceled && result.filePaths[0]) {
    queueOpenFile(result.filePaths[0]);
  }
}

function resolveAppPaths() {
  const isPackaged = app.isPackaged;
  const appRoot = isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, '..', '..');

  // The web bundle is always the copy made by the desktop build. In the
  // package it sits next to dist/, which holds the compiled main process,
  // so "dist" must never be used as a fallback here.
  const distDir = isPackaged
    ? path.join(appRoot, 'dist-web')
    : path.join(appRoot, 'desktop', 'dist-web');

  let manifestPath = path.resolve(
    appRoot,
    'desktop',
    'app',
    'modules-manifest.json'
  );
  if (
    !fs.existsSync(manifestPath) &&
    fs.existsSync(path.resolve(appRoot, 'app', 'modules-manifest.json'))
  ) {
    manifestPath = path.resolve(appRoot, 'app', 'modules-manifest.json');
  }

  let iconPath = path.join(appRoot, 'public', 'images', 'cit-pdf-icon-512.png');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(distDir, 'images', 'cit-pdf-icon-512.png');
  }

  return { distDir, manifestPath, iconPath };
}

function setupApp() {
  const paths = resolveAppPaths();
  iconPath = paths.iconPath;
  modulesManager = new ModulesManager(paths.manifestPath);
  setupAppProtocol(paths.distDir, modulesManager);
  watchDownloads();
}

// Results the user saved in this session. The page may ask to reveal or
// open only these, never a path of its own choosing.
const savedDownloads = new Set<string>();

// Document types that are safe to hand to their default program. Anything
// that could run code (exe, bat, html, svg...) is left out on purpose.
const OPENABLE_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.csv',
  '.txt',
  '.md',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tiff',
  '.zip',
  '.epub',
]);

// Where a window's next PDF download goes, set by its page right before a
// tool saves: over the file the tool opened ("Save"), or through "Save as"
// starting in that file's folder. Only a PDF the user opened can be named,
// and the target lapses if no download follows.
interface SaveTarget {
  mode: SaveMode;
  path: string;
  until: number;
}
const saveTargets = new Map<number, SaveTarget>();
const SAVE_TARGET_MS = 120_000;

ipcMain.handle(
  IPC_CHANNELS.SET_SAVE_TARGET,
  (event, mode: unknown, filePath: unknown): boolean => {
    const id = event.sender.id;
    if (
      (mode !== 'overwrite' && mode !== 'saveAs') ||
      typeof filePath !== 'string' ||
      !allowedOpenPaths.has(filePath) ||
      path.extname(filePath).toLowerCase() !== '.pdf'
    ) {
      saveTargets.delete(id);
      return false;
    }
    saveTargets.set(id, {
      mode,
      path: filePath,
      until: Date.now() + SAVE_TARGET_MS,
    });
    return true;
  }
);

/** "name (2).pdf", "name (3).pdf"… next to a file, the first that is free. */
function freeSibling(filePath: string): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const stem = path.basename(filePath, ext);
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${stem} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

// A tool hands over its result as a download, which Electron saves through
// its own "Save as" dialog. Tell the page where the file went, so it can
// offer to show the result instead of leaving the user to go and find it.
function watchDownloads() {
  session.defaultSession.on('will-download', (_event, item, contents) => {
    const target = saveTargets.get(contents.id);
    const isPdfDownload =
      path.extname(item.getFilename()).toLowerCase() === '.pdf' ||
      item.getMimeType() === 'application/pdf';
    let replace: { temp: string; original: string } | null = null;
    if (target && isPdfDownload) {
      saveTargets.delete(contents.id);
      if (target.until > Date.now() && target.mode === 'overwrite') {
        // Written next to the original first, then moved over it, so an
        // interrupted save never leaves the original half written.
        const temp = path.join(
          path.dirname(target.path),
          `.${path.basename(target.path)}.cit-saving`
        );
        replace = { temp, original: target.path };
        item.setSavePath(temp);
      } else if (target.until > Date.now()) {
        const ext = path.extname(target.path);
        // A result named on its own (pages taken out, say) keeps its name;
        // the document itself is offered as "<name> (edited)".
        const stem = path.basename(target.path, ext);
        const offered = path.basename(
          item.getFilename(),
          path.extname(item.getFilename())
        );
        const name = offered.toLowerCase().startsWith(`${stem.toLowerCase()} (`)
          ? offered
          : fill(ui().editedCopy, { name: stem });
        item.setSaveDialogOptions({
          defaultPath: path.join(path.dirname(target.path), `${name}.pdf`),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
      }
    } else if (target && target.mode === 'saveAs') {
      // Another format made from the document (Word, text): offered under
      // its own name in the document's folder.
      saveTargets.delete(contents.id);
      if (target.until > Date.now()) {
        const ext = path.extname(item.getFilename()).slice(1).toLowerCase();
        item.setSaveDialogOptions({
          defaultPath: path.join(path.dirname(target.path), item.getFilename()),
          filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
        });
      }
    }

    item.once('done', async (_done, state) => {
      let filePath = item.getSavePath();
      let overwritten = false;
      let overwriteFailed = false;
      if (replace) {
        if (state !== 'completed') {
          await fs.promises.rm(replace.temp, { force: true }).catch(() => {});
          return;
        }
        try {
          await fs.promises.rename(replace.temp, replace.original);
          filePath = replace.original;
          overwritten = true;
        } catch (e) {
          // Locked by another program (a PDF reader holding it open): keep
          // the result next to it rather than lose it.
          console.warn('[Save] Could not replace', replace.original, e);
          filePath = freeSibling(replace.original);
          try {
            await fs.promises.rename(replace.temp, filePath);
          } catch (e2) {
            console.error('[Save] Could not keep the result either', e2);
            return;
          }
          overwriteFailed = true;
        }
      }
      if (state !== 'completed' || !filePath) return;
      const extension = path.extname(filePath).toLowerCase();
      const isPdf = extension === '.pdf';
      savedDownloads.add(filePath);
      if (isPdf) allowedOpenPaths.add(filePath);
      if (contents.isDestroyed()) return;
      const saved: SavedDownload = {
        path: filePath,
        name: path.basename(filePath),
        isPdf,
        canOpen: OPENABLE_EXTENSIONS.has(extension),
        overwritten,
        overwriteFailed,
      };
      contents.send(IPC_CHANNELS.DOWNLOAD_SAVED, saved);
    });
  });
}

ipcMain.handle(
  IPC_CHANNELS.SHOW_SAVED_IN_FOLDER,
  (_event, filePath: unknown): boolean => {
    if (typeof filePath !== 'string' || !savedDownloads.has(filePath)) {
      return false;
    }
    shell.showItemInFolder(filePath);
    return true;
  }
);

ipcMain.handle(
  IPC_CHANNELS.OPEN_SAVED_FILE,
  async (_event, filePath: unknown): Promise<boolean> => {
    if (typeof filePath !== 'string' || !savedDownloads.has(filePath)) {
      return false;
    }
    if (!OPENABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return false;
    }
    return (await shell.openPath(filePath)) === '';
  }
);

const WINDOW_CASCADE_OFFSET = 28;

function createWindow(filePath?: string): BrowserWindow {
  // A further window opens slightly offset so it does not hide the first.
  const [x, y] =
    activeWindow && !activeWindow.isMaximized()
      ? activeWindow.getPosition()
      : [];

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    ...(x !== undefined && y !== undefined
      ? { x: x + WINDOW_CASCADE_OFFSET, y: y + WINDOW_CASCADE_OFFSET }
      : {}),
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#1f2328',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Tools render PDF pages on canvases. With throttling on, that work
      // pauses whenever the window is minimised or covered, so a long
      // conversion would stall until the user comes back.
      backgroundThrottling: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  const contentsId = win.webContents.id;
  if (filePath) pendingOpenFiles.set(contentsId, filePath);
  activeWindow = win;
  win.on('focus', () => {
    activeWindow = win;
  });

  // Handle external links safely
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (url.startsWith('http:') || url.startsWith('https:')) {
        shell.openExternal(url);
      }
    }
  });

  // An editor with unsaved changes objects to being left. Electron then
  // cancels the navigation or close without a word, so ask the user here.
  win.webContents.on('will-prevent-unload', (event) => {
    const text = ui();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [text.leaveDiscard, text.leaveStay],
      defaultId: 1,
      cancelId: 1,
      title: text.leaveTitle,
      message: text.leaveMessage,
      detail: text.leaveDetail,
    });
    if (choice === 0) event.preventDefault();
  });

  // Tool pages carry the upstream brand in their <title>; show ours instead.
  win.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    win.setTitle(title.replace(/Bento ?PDF/gi, APP_NAME));
  });

  // Load the application
  win.loadURL(`${APP_ORIGIN}/index.html`);

  win.on('closed', () => {
    pendingOpenFiles.delete(contentsId);
    if (activeWindow === win) {
      activeWindow = BrowserWindow.getAllWindows()[0] ?? null;
    }
  });
  return win;
}

function windowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

// IPC Handlers
function progressTo(
  event: Electron.IpcMainInvokeEvent
): (progress: ModuleProgress) => void {
  return (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC_CHANNELS.MODULE_PROGRESS, progress);
    }
  };
}

/** Asks for a folder and installs the missing engines found in it. */
async function installFromPickedFolder(
  win: BrowserWindow,
  manager: ModulesManager,
  onProgress: (progress: ModuleProgress) => void
): Promise<FolderInstallResult> {
  const text = ui();
  const picked = await dialog.showOpenDialog(win, {
    title: text.pickModulesFolder,
    properties: ['openDirectory'],
  });
  const dir = picked.filePaths[0];
  if (picked.canceled || !dir) {
    return { picked: false, installed: [], failed: [] };
  }
  const result = await manager.installFromFolder(dir, onProgress);
  if (result.failed.length > 0) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: text.downloadFailedTitle,
      message: result.failed
        .map(({ name, error }) => fill(text.folderFailed, { name, error }))
        .join('\n'),
    });
  } else if (result.installed.length === 0) {
    const examples = (['pymupdf', 'libreoffice'] as DesktopModuleName[])
      .flatMap((name) => manager.packFiles(name))
      .join(', ');
    await dialog.showMessageBox(win, {
      type: 'info',
      title: text.installFromFolder.replace('…', ''),
      message: text.folderNothing,
      detail: fill(text.folderNothingDetail, { files: examples }),
    });
  }
  return { picked: true, ...result };
}

ipcMain.handle(
  IPC_CHANNELS.ENSURE_MODULES,
  async (event, names: DesktopModuleName[]): Promise<EnsureResult> => {
    if (!modulesManager) {
      return { ok: false, error: 'Modules manager not initialized' };
    }
    const win = windowOf(event);
    const onProgress = progressTo(event);
    const result = await modulesManager.ensureModules(names, onProgress, win);
    if (result.ok || result.cancelled || !win || !result.error) return result;

    // A download that failed (often a network blocking the source) can be
    // replaced by an offline pack copied from another computer.
    const text = ui();
    const choice = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [text.installFromFolder, text.close],
      defaultId: 0,
      cancelId: 1,
      title: text.downloadFailedTitle,
      message: text.downloadFailedMessage,
      detail: fill(text.downloadFailedDetail, { error: result.error }),
    });
    if (choice.response !== 0) return result;
    await installFromPickedFolder(win, modulesManager, onProgress);
    const missing = names.filter((name) => !modulesManager?.isInstalled(name));
    return missing.length === 0 ? { ok: true } : result;
  }
);

ipcMain.handle(
  IPC_CHANNELS.INSTALL_MODULES_FROM_FOLDER,
  async (event): Promise<FolderInstallResult> => {
    const win = windowOf(event);
    if (!modulesManager || !win) {
      return { picked: false, installed: [], failed: [] };
    }
    return installFromPickedFolder(win, modulesManager, progressTo(event));
  }
);

ipcMain.handle(IPC_CHANNELS.GET_MODULES_STATUS, (): ModuleStatus[] => {
  return modulesManager?.getStatus() ?? [];
});

ipcMain.handle(IPC_CHANNELS.CANCEL_MODULE_DOWNLOADS, (): void => {
  modulesManager?.cancelDownloads();
});

ipcMain.handle(
  IPC_CHANNELS.REMOVE_MODULE,
  async (event, name: DesktopModuleName): Promise<boolean> => {
    const win = windowOf(event);
    if (!modulesManager || !win) return false;
    const text = ui();
    const choice = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [text.remove, text.cancel],
      defaultId: 1,
      cancelId: 1,
      title: text.removeModuleTitle,
      message: fill(text.removeModuleMessage, { name }),
      detail: text.removeModuleDetail,
    });
    if (choice.response !== 0) return false;
    return modulesManager.removeModule(name);
  }
);

ipcMain.handle(IPC_CHANNELS.TAKE_OPENED_FILE, (event): OpenedFile | null => {
  const filePath = pendingOpenFiles.get(event.sender.id);
  if (!filePath) return null;
  pendingOpenFiles.delete(event.sender.id);
  return { path: filePath, name: path.basename(filePath) };
});

// A window that already shows a document passes a newly opened file on, so
// both stay open side by side.
ipcMain.handle(
  IPC_CHANNELS.OPEN_IN_NEW_WINDOW,
  (_event, filePath: unknown): boolean => {
    if (typeof filePath !== 'string' || !allowedOpenPaths.has(filePath)) {
      return false;
    }
    createWindow(filePath);
    return true;
  }
);

ipcMain.handle(
  IPC_CHANNELS.READ_OPENED_FILE,
  async (_event, filePath: string): Promise<Uint8Array> => {
    if (!allowedOpenPaths.has(filePath)) {
      throw new Error('File was not opened by the user');
    }
    return fs.promises.readFile(filePath);
  }
);

ipcMain.handle(
  IPC_CHANNELS.OPEN_EXTERNAL,
  async (_event, url: string): Promise<void> => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      await shell.openExternal(url);
    }
  }
);

// Lets a PDF the user picked inside a page be handed to another tool the
// same way as one opened from the OS. The path comes from the preload.
ipcMain.handle(
  IPC_CHANNELS.REGISTER_PICKED_FILE,
  async (_event, filePath: unknown): Promise<OpenedFile | null> => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null;
    if (path.extname(filePath).toLowerCase() !== '.pdf') return null;
    try {
      if (!(await fs.promises.stat(filePath)).isFile()) return null;
    } catch {
      return null;
    }
    allowedOpenPaths.add(filePath);
    return { path: filePath, name: path.basename(filePath) };
  }
);

// Documents read in the viewer lately, newest first, kept across launches.
const MAX_RECENT_FILES = 10;

function recentFilesFile(): string {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

interface RecentFile {
  path: string;
  /** When it was last opened, in ms since the epoch; 0 if unknown. */
  at: number;
}

function readRecentFiles(): RecentFile[] {
  try {
    const list: unknown = JSON.parse(
      fs.readFileSync(recentFilesFile(), 'utf8')
    );
    if (!Array.isArray(list)) return [];
    return list
      .map((item): RecentFile | null => {
        // 1.0.2 kept bare paths.
        if (typeof item === 'string') return { path: item, at: 0 };
        if (item && typeof item.path === 'string') {
          return { path: item.path, at: Number(item.at) || 0 };
        }
        return null;
      })
      .filter(
        (item): item is RecentFile =>
          item !== null &&
          path.isAbsolute(item.path) &&
          path.extname(item.path).toLowerCase() === '.pdf'
      );
  } catch {
    return [];
  }
}

function writeRecentFiles(list: RecentFile[]): void {
  try {
    fs.writeFileSync(recentFilesFile(), JSON.stringify(list), 'utf8');
  } catch (e) {
    console.warn('[Main] Could not save the recent files:', e);
  }
}

ipcMain.handle(
  IPC_CHANNELS.NOTE_RECENT_FILE,
  (_event, filePath: unknown): boolean => {
    if (typeof filePath !== 'string' || !allowedOpenPaths.has(filePath)) {
      return false;
    }
    const list = readRecentFiles().filter((item) => item.path !== filePath);
    writeRecentFiles(
      [{ path: filePath, at: Date.now() }, ...list].slice(0, MAX_RECENT_FILES)
    );
    return true;
  }
);

// Every file on the list was opened by the user before, so listing it lets
// the page read it again. Files that are gone are left out.
ipcMain.handle(
  IPC_CHANNELS.LIST_RECENT_FILES,
  async (): Promise<OpenedFile[]> => {
    const files: OpenedFile[] = [];
    for (const { path: filePath, at } of readRecentFiles()) {
      try {
        if (!(await fs.promises.stat(filePath)).isFile()) continue;
      } catch {
        continue;
      }
      allowedOpenPaths.add(filePath);
      files.push({
        path: filePath,
        name: path.basename(filePath),
        openedAt: at || undefined,
      });
    }
    return files;
  }
);

ipcMain.handle(IPC_CHANNELS.CLEAR_RECENT_FILES, (): void => {
  writeRecentFiles([]);
});

// Run from source, Electron reports the version of the root package (the
// upstream web app), not of the desktop app.
function appVersion(): string {
  if (app.isPackaged) return app.getVersion();
  try {
    const manifest = path.resolve(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  } catch {
    return app.getVersion();
  }
}

// Update check, on the user's request only: compares this version with the
// latest published GitHub release. Nothing is downloaded or installed.
ipcMain.handle(
  IPC_CHANNELS.CHECK_UPDATE,
  async (): Promise<UpdateCheckResult> => {
    const current = appVersion();
    try {
      const response = await net.fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      });
      // GitHub answers 404 while the repository has no published release.
      if (response.status === 404) {
        return { ok: false, current, error: 'no-release' };
      }
      if (!response.ok) return { ok: false, current, error: 'network' };

      const release = (await response.json()) as {
        tag_name?: unknown;
        html_url?: unknown;
        assets?: unknown;
        body?: unknown;
      };
      if (typeof release.tag_name !== 'string') {
        return { ok: false, current, error: 'network' };
      }
      // The link is opened in the browser: only accept our releases page.
      const url =
        typeof release.html_url === 'string' &&
        release.html_url.startsWith(`${RELEASES_PAGE}/`)
          ? release.html_url
          : RELEASES_PAGE;
      const latest = release.tag_name.replace(/^v/i, '');
      const newer = isNewerVersion(latest, current);
      pendingInstaller =
        newer && canSelfUpdate()
          ? findInstaller(release, `${RELEASES_PAGE}/download/`, process.arch)
          : null;
      return {
        ok: true,
        current,
        latest,
        newer,
        url,
        canInstall: pendingInstaller !== null,
      };
    } catch (e) {
      console.warn('[Main] Update check failed:', e);
      return { ok: false, current, error: 'network' };
    }
  }
);

// "Update and restart" works for the installed app on Windows; the portable
// one and a run from source get the download page instead.
function canSelfUpdate(): boolean {
  return (
    app.isPackaged &&
    process.platform === 'win32' &&
    !process.env.PORTABLE_EXECUTABLE_FILE
  );
}

// The installer of the release the last check found newer. Kept here, so
// the page only asks to install and never hands over a URL to run.
let pendingInstaller: ReleaseInstaller | null = null;

async function downloadInstaller(
  installer: ReleaseInstaller,
  dest: string,
  onProgress: (p: UpdateProgress) => void
): Promise<string> {
  const response = await net.fetch(installer.url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const total =
    Number(response.headers.get('content-length')) || installer.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let received = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(Buffer.from(value))) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
      onProgress({ received, total });
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  return hash.digest('hex');
}

ipcMain.handle(
  IPC_CHANNELS.INSTALL_UPDATE,
  async (event): Promise<InstallUpdateResult> => {
    const installer = pendingInstaller;
    if (!installer || !canSelfUpdate()) return { ok: false, error: 'manual' };

    const dir = path.join(os.tmpdir(), 'CIT-PDF-update');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, installer.name);
    let sha256: string;
    try {
      sha256 = await downloadInstaller(installer, file, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.UPDATE_PROGRESS, progress);
        }
      });
    } catch (e) {
      console.warn('[Main] Update download failed:', e);
      return { ok: false, error: 'download' };
    }
    if (sha256 !== installer.sha256) {
      console.warn('[Main] Update hash mismatch:', sha256, installer.sha256);
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: false, error: 'verify' };
    }

    // Silent install over the current one, then the installer starts the
    // app again (--force-run). The app quits so its files can be replaced.
    try {
      const child = spawn(file, ['/S', '--force-run'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      console.warn('[Main] Could not start the installer:', e);
      return { ok: false, error: 'launch' };
    }
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  }
);

ipcMain.handle(IPC_CHANNELS.SHOW_SAVE_DIALOG, async (event, options) => {
  const win = windowOf(event);
  if (!win) return { canceled: true };
  return dialog.showSaveDialog(win, options);
});

// Electron's printer list does not say which one is the default, so ask the
// OS. Resolves to null when it cannot be determined.
function getDefaultPrinterName(): Promise<string | null> {
  const [command, args, parse]: [
    string,
    string[],
    (output: string) => string | undefined,
  ] =
    process.platform === 'win32'
      ? [
          'reg',
          [
            'query',
            'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows',
            '/v',
            'Device',
          ],
          // "    Device    REG_SZ    <name>,winspool,<port>"
          (output) => /REG_SZ\s+(.+?),[^,]*,[^,]*\s*$/m.exec(output)?.[1],
        ]
      : ['lpstat', ['-d'], (output) => /:\s*(\S+)\s*$/m.exec(output)?.[1]];

  return new Promise((resolve) => {
    execFile(command, args, { timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : (parse(stdout) ?? null));
    });
  });
}

ipcMain.handle(
  IPC_CHANNELS.LIST_PRINTERS,
  async (event): Promise<PrinterInfo[]> => {
    const [printers, defaultName] = await Promise.all([
      event.sender.getPrintersAsync(),
      getDefaultPrinterName(),
    ]);
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: printer.name === defaultName,
    }));
  }
);

/**
 * Opens the driver's Printing Preferences dialog for `deviceName`
 * (tray, quality, watermark, …). Windows only — other platforms have no
 * stable equivalent short of the full system print dialog.
 */
ipcMain.handle(
  IPC_CHANNELS.OPEN_PRINTER_PREFERENCES,
  async (event, deviceName: string): Promise<boolean> => {
    if (typeof deviceName !== 'string' || !deviceName.trim()) return false;
    const known = await event.sender.getPrintersAsync();
    if (!known.some((printer) => printer.name === deviceName)) return false;

    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        // /e = Printing Preferences. Must stay detached: rundll32 owns the
        // dialog, and killing it (execFile timeout) closes the window the
        // moment it appears — "opens then shuts itself".
        const child = spawn(
          'rundll32.exe',
          ['printui.dll,PrintUIEntry', '/n', deviceName, '/e'],
          { detached: true, stdio: 'ignore', windowsHide: true }
        );
        child.once('error', (error) => {
          console.error('[Main] Open printer preferences failed:', error);
          resolve(false);
        });
        child.once('spawn', () => {
          child.unref();
          resolve(true);
        });
      });
    }

    if (process.platform === 'darwin') {
      // System Settings → Printers & Scanners; no per-printer prefs deep-link.
      return shell
        .openExternal(
          'x-apple.systempreferences:com.apple.preference.print'
        )
        .then(() => true)
        .catch(() => false);
    }

    return false;
  }
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, sleep(ms).then(() => null)]);
}

/** Chromium's silent PDF print often never calls back; do not wait minutes. */
const VECTOR_PRINT_TIMEOUT_MS = 25_000;
/** Raster/window print: same hang risk, shorter than leaving the dialog stuck. */
const WINDOW_PRINT_TIMEOUT_MS = 60_000;
/** PrintTo reads the temp file after Start-Process returns; delete later. */
const PRINT_TEMP_KEEP_MS = 120_000;

function deletePrintTempLater(file: string): void {
  setTimeout(() => {
    fs.promises.rm(file, { force: true }).catch(() => {});
  }, PRINT_TEMP_KEEP_MS);
}

/** IPC may hand a Buffer or ArrayBuffer; normalise before writing/printing. */
function asPdfBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array && value.byteLength > 0) return value;
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return new Uint8Array(value);
  }
  if (
    value &&
    typeof value === 'object' &&
    'buffer' in value &&
    (value as { buffer: unknown }).buffer instanceof ArrayBuffer
  ) {
    const view = value as ArrayBufferView;
    if (view.byteLength > 0) {
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
  }
  return null;
}

/**
 * ProgIds of PDF readers that register shell\print and shell\printto.
 * The user's .pdf association is often CIT-PDF itself (no print verb), so
 * we look these up directly instead of printing "with the default app".
 */
const PDF_READER_PROGIDS = [
  'FoxitReader.Document',
  'AcroExch.Document.DC',
  'AcroExch.Document',
  'Acrobat.Document.DC',
  'SumatraPDF',
  'PDFXEdit.PDF',
];

function regDefault(key: string): string | null {
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    return /REG_SZ\s+(.+)\s*$/m.exec(out)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function isOurExecutable(exe: string): boolean {
  const base = path.basename(exe).toLowerCase();
  return (
    base.includes('cit-pdf') ||
    base === path.basename(process.execPath).toLowerCase()
  );
}

/** Split a registry command line, keeping quoted paths intact. */
function splitCommandLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The print or printto command of an installed PDF reader, or null when
 * none is installed (Edge/Chrome/CIT-PDF do not count — they cannot silent-
 * print a PDF file). %1 file, %2 printer, %3 driver, %4 port.
 */
function readerPrintCommand(verb: 'print' | 'printto'): string | null {
  for (const progId of PDF_READER_PROGIDS) {
    const command = regDefault(`HKCR\\${progId}\\shell\\${verb}\\command`);
    if (!command) continue;
    const exe = splitCommandLine(command)[0];
    if (!exe || isOurExecutable(exe) || !fs.existsSync(exe)) continue;
    return command;
  }
  return null;
}

/**
 * Launch a print helper and return as soon as it starts. Waiting for exit
 * would hold our dialog open while Foxit/Acrobat shows a splash for many
 * seconds then quit — "print window opens then closes by itself".
 */
function runDetached(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', (error) => {
      console.error('[Main] Print helper failed:', command, error.message);
      resolve(false);
    });
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

function runPowerShell(
  script: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000
): Promise<boolean> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, env },
      (error) => {
        if (error) {
          console.error('[Main] Print ticket script failed:', error.message);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

/** Snapshot the user's ticket, then set duplex / colour / paper / copies. */
const APPLY_PRINT_TICKET = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Printing
$queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($env:CIT_PRINT_PRINTER)
$src = $queue.UserPrintTicket.GetXmlStream()
$ms = New-Object System.IO.MemoryStream
$src.CopyTo($ms)
[System.IO.File]::WriteAllBytes($env:CIT_TICKET_BACKUP, $ms.ToArray())
$ticket = New-Object System.Printing.PrintTicket (New-Object System.IO.MemoryStream (,([System.IO.File]::ReadAllBytes($env:CIT_TICKET_BACKUP))))
try {
  $ticket.Duplexing = switch ($env:CIT_PRINT_DUPLEX) {
    'longEdge' { [System.Printing.Duplexing]::TwoSidedLongEdge }
    'shortEdge' { [System.Printing.Duplexing]::TwoSidedShortEdge }
    default { [System.Printing.Duplexing]::OneSided }
  }
} catch {}
try {
  if ($env:CIT_PRINT_COLOR -eq '0') { $ticket.OutputColor = [System.Printing.OutputColor]::Grayscale }
  else { $ticket.OutputColor = [System.Printing.OutputColor]::Color }
} catch {}
try {
  $media = switch ($env:CIT_PRINT_PAPER) {
    'A3' { [System.Printing.PageMediaSizeName]::ISOA3 }
    'A5' { [System.Printing.PageMediaSizeName]::ISOA5 }
    'Letter' { [System.Printing.PageMediaSizeName]::NorthAmericaLetter }
    'Legal' { [System.Printing.PageMediaSizeName]::NorthAmericaLegal }
    default { [System.Printing.PageMediaSizeName]::ISOA4 }
  }
  $ticket.PageMediaSize = New-Object System.Printing.PageMediaSize $media
} catch {}
try {
  if ($env:CIT_PRINT_LANDSCAPE -eq '1') { $ticket.PageOrientation = [System.Printing.PageOrientation]::Landscape }
  else { $ticket.PageOrientation = [System.Printing.PageOrientation]::Portrait }
} catch {}
try {
  $n = [int]$env:CIT_PRINT_COPIES
  if ($n -lt 1) { $n = 1 }
  if ($n -gt 999) { $n = 999 }
  $ticket.CopyCount = $n
} catch {}
try {
  if ($env:CIT_PRINT_COLLATE -eq '1') { $ticket.Collation = [System.Printing.Collation]::Collated }
  else { $ticket.Collation = [System.Printing.Collation]::Uncollated }
} catch {}
$queue.UserPrintTicket = $ticket
$queue.Commit()
`;

const RESTORE_PRINT_TICKET = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Printing
$queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($env:CIT_PRINT_PRINTER)
$bytes = [System.IO.File]::ReadAllBytes($env:CIT_TICKET_BACKUP)
$ticket = New-Object System.Printing.PrintTicket (New-Object System.IO.MemoryStream (,$bytes))
$queue.UserPrintTicket = $ticket
$queue.Commit()
`;

/**
 * Windows: if Foxit, Adobe, Sumatra or PDF-XChange is installed, hand the
 * PDF to that reader so text stays vectors. Foxit's own command cannot say
 * "duplex", so the printer's per-user ticket is set first (two-sided, colour,
 * paper, copies) and restored after the reader has taken the job.
 * When no reader is installed, returns false — never via the .pdf association,
 * which on this app is CIT-PDF itself.
 */
async function printPdfViaWindowsShell(
  file: string,
  options: VectorPrintOptions
): Promise<boolean> {
  const template = readerPrintCommand(options.systemDialog ? 'print' : 'printto');
  if (!template) return false;

  const parts = splitCommandLine(template)
    .map((part) =>
      part
        .replaceAll('%1', file)
        .replaceAll('%2', options.deviceName)
        .replaceAll('%3', '')
        .replaceAll('%4', '')
    )
    .filter((part) => part !== '');
  const [exe, ...args] = parts;
  if (!exe) return false;

  // The system dialog has its own duplex / Properties controls.
  if (options.systemDialog) return runDetached(exe, args);

  const backup = path.join(os.tmpdir(), `cit-ticket-${crypto.randomUUID()}.xml`);
  const ticketEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CIT_TICKET_BACKUP: backup,
    CIT_PRINT_PRINTER: options.deviceName,
    CIT_PRINT_DUPLEX: options.duplexMode,
    CIT_PRINT_COLOR: options.color ? '1' : '0',
    CIT_PRINT_PAPER: options.paperSize,
    CIT_PRINT_LANDSCAPE: options.landscape ? '1' : '0',
    CIT_PRINT_COPIES: String(options.copies),
    CIT_PRINT_COLLATE: options.collate ? '1' : '0',
  };
  const applied = await runPowerShell(APPLY_PRINT_TICKET, ticketEnv);
  if (!applied) return false;
  try {
    const handed = await new Promise<boolean>((resolve) => {
      execFile(exe, args, { timeout: 90_000, windowsHide: true }, (error) => {
        if (error) {
          console.error('[Main] PDF reader print failed:', error.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
    // The reader copies the ticket when it spools; keep it that long.
    if (handed) await sleep(2000);
    return handed;
  } finally {
    await runPowerShell(RESTORE_PRINT_TICKET, ticketEnv);
    fs.promises.rm(backup, { force: true }).catch(() => {});
  }
}

interface VectorPrintOptions {
  deviceName: string;
  copies: number;
  paperSize: PrintPaperSize;
  landscape: boolean;
  duplexMode: PrintDuplexMode;
  color: boolean;
  printableArea: boolean;
  collate: boolean;
  systemDialog: boolean;
  dryRunPath?: string;
}

/**
 * Native Windows print: Windows.Data.Pdf (built into Windows 10/11) draws
 * each page and System.Drawing.Printing sends it to the spooler. No Foxit,
 * Adobe or other PDF app. The system-dialog mode is the real Windows print
 * dialog, Properties included.
 *
 * Pages are bitmaps (Windows has no public "print this PDF as vectors" API).
 * A installed reader is still preferred when it can honour the job, because
 * that path stays vector.
 */
function printPdfViaWindowsNative(
  file: string,
  options: VectorPrintOptions
): Promise<'ok' | 'cancel' | 'fail'> {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]

function Await-Op($op, $type) {
  $method = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  } | Select-Object -First 1).MakeGenericMethod($type)
  $task = $method.Invoke($null, @($op))
  $task.Wait()
  return $task.Result
}
function Await-Act($act) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  } | Select-Object -First 1
  $task = $method.Invoke($null, @($act))
  $task.Wait()
}

$file = Await-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:CIT_PRINT_FILE)) ([Windows.Storage.StorageFile])
$pdf = Await-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $env:CIT_PRINT_PRINTER
if (-not $doc.PrinterSettings.IsValid) { throw 'Unknown printer' }
$copies = [int]$env:CIT_PRINT_COPIES
if ($copies -lt 1) { $copies = 1 }
if ($copies -gt 999) { $copies = 999 }
$doc.PrinterSettings.Copies = [int16]$copies
$doc.PrinterSettings.Collate = $env:CIT_PRINT_COLLATE -eq '1'
$doc.DefaultPageSettings.Landscape = $env:CIT_PRINT_LANDSCAPE -eq '1'
$doc.DefaultPageSettings.Color = $env:CIT_PRINT_COLOR -ne '0'
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
if ($doc.PrinterSettings.CanDuplex) {
  $doc.PrinterSettings.Duplex = switch ($env:CIT_PRINT_DUPLEX) {
    'longEdge' { [System.Drawing.Printing.Duplex]::Vertical }
    'shortEdge' { [System.Drawing.Printing.Duplex]::Horizontal }
    default { [System.Drawing.Printing.Duplex]::Simplex }
  }
}
$kind = switch ($env:CIT_PRINT_PAPER) {
  'A3' { 8 } 'A5' { 11 } 'Letter' { 1 } 'Legal' { 5 } default { 9 }
}
$paper = $doc.PrinterSettings.PaperSizes | Where-Object { [int]$_.RawKind -eq $kind } | Select-Object -First 1
if ($paper) { $doc.DefaultPageSettings.PaperSize = $paper }

$script:pageIndex = 0
$doc.add_PrintPage({
  param($sender, $ev)
  $page = $pdf.GetPage([uint32]$script:pageIndex)
  $dpi = 600
  if ($pdf.PageCount -gt 20) { $dpi = 300 }
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = [uint32][Math]::Max(1, [Math]::Ceiling($page.Size.Width / 96.0 * $dpi))
  $opts.DestinationHeight = [uint32][Math]::Max(1, [Math]::Ceiling($page.Size.Height / 96.0 * $dpi))
  $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  Await-Act ($page.RenderToStreamAsync($ras, $opts))
  $ras.Seek(0)
  $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($ras)
  $stream.Position = 0
  $bmp = New-Object System.Drawing.Bitmap $stream
  $ev.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $ev.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $bounds = $ev.MarginBounds
  if ($env:CIT_PRINT_FIT -eq '1') {
    $ev.Graphics.DrawImage($bmp, $bounds)
  } else {
    $wantW = [int]($page.Size.Width / 96.0 * 100)
    $wantH = [int]($page.Size.Height / 96.0 * 100)
    $scale = [Math]::Min(1.0, [Math]::Min($bounds.Width / [double]$wantW, $bounds.Height / [double]$wantH))
    $dw = [Math]::Max(1, [int]($wantW * $scale))
    $dh = [Math]::Max(1, [int]($wantH * $scale))
    $x = $bounds.X + [int](($bounds.Width - $dw) / 2)
    $y = $bounds.Y + [int](($bounds.Height - $dh) / 2)
    $ev.Graphics.DrawImage($bmp, $x, $y, $dw, $dh)
  }
  $bmp.Dispose()
  $stream.Dispose()
  $ras.Dispose()
  $script:pageIndex++
  $ev.HasMorePages = $script:pageIndex -lt $pdf.PageCount
})

if ($env:CIT_PRINT_DIALOG -eq '1') {
  $dlg = New-Object System.Windows.Forms.PrintDialog
  $dlg.Document = $doc
  $dlg.UseEXDialog = $true
  $dlg.AllowPrintToFile = $false
  $dlg.AllowSomePages = $false
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
}
$doc.Print()
exit 0
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        timeout: options.systemDialog ? 300_000 : 120_000,
        windowsHide: !options.systemDialog,
        env: {
          ...process.env,
          CIT_PRINT_FILE: file,
          CIT_PRINT_PRINTER: options.deviceName,
          CIT_PRINT_COPIES: String(options.copies),
          CIT_PRINT_PAPER: options.paperSize,
          CIT_PRINT_LANDSCAPE: options.landscape ? '1' : '0',
          CIT_PRINT_DUPLEX: options.duplexMode,
          CIT_PRINT_COLOR: options.color ? '1' : '0',
          CIT_PRINT_COLLATE: options.collate ? '1' : '0',
          CIT_PRINT_FIT: options.printableArea ? '1' : '0',
          CIT_PRINT_DIALOG: options.systemDialog ? '1' : '0',
        },
      },
      (error) => {
        if (!error) {
          resolve('ok');
          return;
        }
        const code =
          typeof error === 'object' && error && 'code' in error
            ? (error as { code?: number | string }).code
            : undefined;
        if (code === 2) {
          resolve('cancel');
          return;
        }
        console.error('[Main] Native Windows print failed:', error);
        resolve('fail');
      }
    );
  });
}

/**
 * Waits until Chromium's PDF viewer in `win` has loaded the whole document.
 * Printing earlier does not fail: the job just never finishes. The viewer
 * runs in an extension frame whose toolbar reports the load progress; if
 * that is not found (a later Chromium may change it), a first-page print to
 * memory, with a time limit, tells instead.
 */
async function pdfViewerReady(win: BrowserWindow): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  let progressUnknownSince = 0;
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return false;
    const viewer = win.webContents.mainFrame.framesInSubtree.find((f) =>
      f.url.startsWith('chrome-extension://')
    );
    if (viewer) {
      const progress = await withTimeout(
        viewer
          .executeJavaScript(
            `(() => {
              const v = document.querySelector('pdf-viewer');
              const bar = v && v.shadowRoot && v.shadowRoot.querySelector('viewer-toolbar');
              return bar && typeof bar.loadProgress === 'number' ? bar.loadProgress : -1;
            })()`
          )
          .catch(() => -1),
        2000
      );
      if (typeof progress === 'number' && progress >= 100) {
        await sleep(150);
        return true;
      }
      if (progress === -1 || progress === null) {
        progressUnknownSince ||= Date.now();
        if (Date.now() - progressUnknownSince > 3000) {
          const probe = await withTimeout(
            win.webContents.printToPDF({ pageRanges: '1' }).catch(() => null),
            8_000
          );
          return !!probe && probe.length > 0;
        }
      } else {
        progressUnknownSince = 0;
      }
    }
    await sleep(100);
  }
  return false;
}

const PRINT_DPI = { horizontal: 600, vertical: 600 };

/**
 * Prints a PDF as vectors.
 * Windows: OS Print / PrintTo first when those can honour the request
 * (Chromium silent PDF print often never calls back). Chromium is used when
 * duplex/mono must be set from the app, on other OSes, or as fallback.
 */
async function printPdfVector(
  bytes: Uint8Array,
  options: VectorPrintOptions
): Promise<PrintResult> {
  const file = path.join(
    os.tmpdir(),
    `cit-pdf-print-${crypto.randomUUID()}.pdf`
  );
  let win: BrowserWindow | null = null;
  let keepTemp = false;
  try {
    await fs.promises.writeFile(file, Buffer.from(bytes));

    if (options.dryRunPath) {
      // Need the Chromium viewer only to re-encode for the dry-run file.
    } else if (process.platform === 'win32') {
      // A PDF reader keeps vectors. Duplex, colour and paper are written
      // onto the printer ticket first — the reader's command has no such flags.
      const handedOff = await printPdfViaWindowsShell(file, options);
      if (handedOff) {
        keepTemp = true;
        return { success: true };
      }
      // Built-in Windows print: spooler + Windows.Data.Pdf. Applies paper,
      // duplex, colour and the real Windows print dialog. No extra app.
      const native = await printPdfViaWindowsNative(file, options);
      if (native === 'ok') return { success: true };
      if (native === 'cancel') {
        return { success: false, error: 'Print job canceled' };
      }
      console.warn('[Main] Native Windows print failed; trying Chromium');
    }

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        plugins: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    await win.loadFile(file);

    if (!(await pdfViewerReady(win)))
      return { success: false, error: 'vector-unavailable' };

    if (options.dryRunPath) {
      const pdf = await win.webContents.printToPDF({
        pageSize: options.paperSize,
        landscape: options.landscape,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      await fs.promises.writeFile(options.dryRunPath, pdf);
      return { success: true };
    }

    const silent = !options.systemDialog;
    return await new Promise<PrintResult>((resolve) => {
      let settled = false;
      const finish = (result: PrintResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      // Silent PDF print may never call back; cancel and let the dialog
      // fall back to pictures. System dialog waits longer for the user.
      const timer = setTimeout(
        () => {
          console.error('[Main] Chromium PDF print timed out');
          if (silent && win && !win.isDestroyed()) {
            win.destroy();
            win = null;
          }
          finish({
            success: false,
            error: silent ? 'vector-unavailable' : 'Printer did not answer',
          });
        },
        silent ? VECTOR_PRINT_TIMEOUT_MS : 300_000
      );
      win!.webContents.print(
        {
          silent,
          printBackground: true,
          deviceName: silent ? options.deviceName : '',
          copies: options.copies,
          collate: options.collate,
          pageSize: options.paperSize,
          landscape: options.landscape,
          duplexMode: options.duplexMode,
          color: options.color,
          dpi: PRINT_DPI,
          margins: {
            marginType: options.printableArea ? 'printableArea' : 'none',
          },
        },
        (success, failureReason) => {
          finish(
            success
              ? { success }
              : {
                  success,
                  error: failureReason || 'vector-unavailable',
                }
          );
        }
      );
    });
  } catch (e) {
    console.error('[Main] Vector print failed:', e);
    return { success: false, error: 'vector-unavailable' };
  } finally {
    if (win && !win.isDestroyed()) {
      // Give the spooler a moment to finish reading before tearing down.
      await sleep(1500);
      if (win && !win.isDestroyed()) win.destroy();
    }
    if (keepTemp) deletePrintTempLater(file);
    else fs.promises.rm(file, { force: true }).catch(() => {});
  }
}

ipcMain.handle(
  IPC_CHANNELS.PRINT,
  async (event, request: PrintRequest): Promise<PrintResult> => {
    const contents = event.sender;

    // The request comes from the renderer: only pass on known values.
    const paperSize = PRINT_PAPER_SIZES.includes(request.paperSize)
      ? request.paperSize
      : 'A4';
    const duplexMode = PRINT_DUPLEX_MODES.includes(request.duplexMode)
      ? request.duplexMode
      : 'simplex';
    const landscape = request.landscape === true;
    const copies = Math.min(999, Math.max(1, Math.floor(request.copies) || 1));
    const collate = request.collate !== false;
    const systemDialog = request.systemDialog === true;
    const color = request.color !== false;

    // Development aid: write the print layout to a PDF instead of printing.
    const dryRunPath = process.env.CIT_PRINT_TO_FILE;

    const pdfBytes = asPdfBytes(request.pdf);
    if (pdfBytes) {
      if (!dryRunPath && !systemDialog) {
        const known = await contents.getPrintersAsync();
        if (!known.some((printer) => printer.name === request.deviceName)) {
          return { success: false, error: 'Unknown printer' };
        }
      }
      return printPdfVector(pdfBytes, {
        deviceName: request.deviceName,
        copies,
        paperSize,
        landscape,
        duplexMode,
        color,
        printableArea: request.printableArea === true,
        collate,
        systemDialog,
        dryRunPath,
      });
    }
    if (dryRunPath) {
      const pdf = await contents.printToPDF({
        pageSize: paperSize,
        landscape,
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      await fs.promises.writeFile(dryRunPath, pdf);
      return { success: true };
    }

    if (!systemDialog) {
      const printers = await contents.getPrintersAsync();
      if (!printers.some((printer) => printer.name === request.deviceName)) {
        return { success: false, error: 'Unknown printer' };
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PrintResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(
        () => {
          console.error('[Main] Window print timed out');
          finish({ success: false, error: 'Printer did not answer' });
        },
        systemDialog ? 300_000 : WINDOW_PRINT_TIMEOUT_MS
      );
      contents.print(
        {
          silent: !systemDialog,
          printBackground: true,
          deviceName: systemDialog ? '' : request.deviceName,
          copies,
          collate,
          pageSize: paperSize,
          landscape,
          duplexMode,
          color,
          dpi: PRINT_DPI,
          margins: {
            marginType: request.printableArea ? 'printableArea' : 'none',
          },
        },
        (success, failureReason) => {
          finish(
            success
              ? { success }
              : { success, error: failureReason || 'Print job failed' }
          );
        }
      );
    });
  }
);

// The pages tell us their language; remember it so the menu is right from
// the first frame of the next launch.
function languageFile(): string {
  return path.join(app.getPath('userData'), 'ui-language');
}

function readSavedLanguage(): string {
  try {
    return fs.readFileSync(languageFile(), 'utf8').trim();
  } catch {
    return 'vi';
  }
}

function buildMenu(): void {
  const text = ui();
  const isMac = process.platform === 'darwin';
  // Electron's built-in role menus come with English labels, so each item
  // is spelled out to keep the whole menu bar in the app's language.
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: text.menuFile,
      submenu: [
        {
          label: text.newWindow,
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            createWindow();
          },
        },
        {
          label: text.openPdf,
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            void showOpenFileDialog();
          },
        },
        {
          label: text.findTool,
          accelerator: 'CmdOrCtrl+K',
          click: (_item, window) => {
            const target =
              window instanceof BrowserWindow
                ? window
                : BrowserWindow.getFocusedWindow();
            target?.webContents.send(IPC_CHANNELS.FIND_TOOL);
          },
        },
        { type: 'separator' as const },
        isMac
          ? { role: 'close' as const, label: text.closeWindow }
          : { role: 'quit' as const, label: text.quit },
      ],
    },
    {
      label: text.menuEdit,
      submenu: [
        { role: 'undo' as const, label: text.undo },
        { role: 'redo' as const, label: text.redo },
        { type: 'separator' as const },
        { role: 'cut' as const, label: text.cut },
        { role: 'copy' as const, label: text.copy },
        { role: 'paste' as const, label: text.paste },
        { role: 'delete' as const, label: text.delete },
        { type: 'separator' as const },
        { role: 'selectAll' as const, label: text.selectAll },
      ],
    },
    {
      label: text.menuView,
      submenu: [
        // Developer items only make sense when running from source.
        ...(app.isPackaged
          ? []
          : [
              { role: 'reload' as const, label: text.reload },
              { role: 'forceReload' as const, label: text.forceReload },
              { role: 'toggleDevTools' as const, label: text.devTools },
              { type: 'separator' as const },
            ]),
        { role: 'resetZoom' as const, label: text.resetZoom },
        { role: 'zoomIn' as const, label: text.zoomIn },
        { role: 'zoomOut' as const, label: text.zoomOut },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: text.fullscreen },
      ],
    },
    {
      label: text.menuWindow,
      submenu: [
        { role: 'minimize' as const, label: text.minimize },
        { role: 'zoom' as const, label: text.zoomWindow },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: text.bringAllToFront },
            ]
          : [{ role: 'close' as const, label: text.closeWindow }]),
      ],
    },
    {
      role: 'help' as const,
      label: text.menuHelp,
      submenu: [
        {
          label: fill(text.about, { app: APP_NAME }),
          click: () => {
            activeWindow?.loadURL(`${APP_ORIGIN}/cit-about.html`);
          },
        },
        {
          label: fill(text.sourceCode, { app: APP_NAME }),
          click: async () => {
            await shell.openExternal('https://github.com/Cuongyd196/cit-pdf');
          },
        },
        {
          label: 'BentoPDF (GitHub)',
          click: async () => {
            await shell.openExternal('https://github.com/alam00000/bentopdf');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on(IPC_CHANNELS.SET_LANGUAGE, (_event, lang: unknown) => {
  if (typeof lang !== 'string' || !setUiLanguage(lang)) return;
  buildMenu();
  try {
    fs.writeFileSync(languageFile(), lang, 'utf8');
  } catch (e) {
    console.warn('[Main] Could not save the UI language:', e);
  }
});

app.on('second-instance', (_event, argv, workingDirectory) => {
  if (activeWindow) {
    if (activeWindow.isMinimized()) activeWindow.restore();
    activeWindow.focus();
  }
  const filePath = findPdfArg(argv, workingDirectory);
  if (filePath) queueOpenFile(filePath);
});

// macOS delivers "Open with" through this event instead of argv.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFile(filePath);
});

app.whenReady().then(() => {
  setupApp();
  const firstFile = findPdfArg(process.argv) ?? startupFile;
  if (firstFile) allowedOpenPaths.add(firstFile);
  createWindow(firstFile ?? undefined);

  setUiLanguage(readSavedLanguage());
  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
