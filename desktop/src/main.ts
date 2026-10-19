import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
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
import {
  IPC_CHANNELS,
  PRINT_DUPLEX_MODES,
  PRINT_PAPER_SIZES,
  type DesktopModuleName,
  type EnsureResult,
  type ModuleStatus,
  type OpenedFile,
  type PrinterInfo,
  type PrintRequest,
  type PrintResult,
  type SaveMode,
  type SavedDownload,
  type UpdateCheckResult,
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
ipcMain.handle(
  IPC_CHANNELS.ENSURE_MODULES,
  async (event, names: DesktopModuleName[]): Promise<EnsureResult> => {
    if (!modulesManager) {
      return { ok: false, error: 'Modules manager not initialized' };
    }
    return modulesManager.ensureModules(
      names,
      (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.MODULE_PROGRESS, progress);
        }
      },
      windowOf(event)
    );
  }
);

ipcMain.handle(IPC_CHANNELS.GET_MODULES_STATUS, (): ModuleStatus[] => {
  return modulesManager?.getStatus() ?? [];
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
      return {
        ok: true,
        current,
        latest,
        newer: isNewerVersion(latest, current),
        url,
      };
    } catch (e) {
      console.warn('[Main] Update check failed:', e);
      return { ok: false, current, error: 'network' };
    }
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

    // Development aid: write the print layout to a PDF instead of printing.
    const dryRunPath = process.env.CIT_PRINT_TO_FILE;
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

    const printers = await contents.getPrintersAsync();
    if (!printers.some((printer) => printer.name === request.deviceName)) {
      return { success: false, error: 'Unknown printer' };
    }

    return new Promise((resolve) => {
      contents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: request.deviceName,
          copies,
          collate: true,
          pageSize: paperSize,
          landscape,
          duplexMode,
          color: request.color !== false,
          margins: {
            marginType: request.printableArea ? 'printableArea' : 'none',
          },
        },
        (success, failureReason) => {
          resolve(success ? { success } : { success, error: failureReason });
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
