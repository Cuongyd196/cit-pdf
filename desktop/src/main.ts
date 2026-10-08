import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from 'electron';
import { registerAppScheme, setupAppProtocol } from './protocol.js';
import { ModulesManager } from './modules-manager.js';
import { fill, setUiLanguage, ui } from './ui-strings.js';
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
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Must register privileged scheme before app is ready
registerAppScheme();

// 2. Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

const APP_NAME = 'CIT-PDF';
const APP_ORIGIN = 'app://bentopdf';

let mainWindow: BrowserWindow | null = null;
let modulesManager: ModulesManager | null = null;

// Files the user explicitly handed to the app (OS "Open with", File > Open).
// The renderer may only read paths that are in this set.
const allowedOpenPaths = new Set<string>();
let pendingOpenFile: string | null = null;

function findPdfArg(argv: string[], cwd = process.cwd()): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || !/\.pdf$/i.test(arg)) continue;
    const resolved = path.resolve(cwd, arg);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function queueOpenFile(filePath: string) {
  allowedOpenPaths.add(filePath);
  pendingOpenFile = filePath;
  mainWindow?.webContents.send(IPC_CHANNELS.FILE_OPENED);
}

async function showOpenFileDialog() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
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

function createWindow() {
  const { distDir, manifestPath, iconPath } = resolveAppPaths();

  modulesManager = new ModulesManager(manifestPath);
  setupAppProtocol(distDir, modulesManager);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // Handle external links safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (url.startsWith('http:') || url.startsWith('https:')) {
        shell.openExternal(url);
      }
    }
  });

  // Tool pages carry the upstream brand in their <title>; show ours instead.
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    mainWindow?.setTitle(title.replace(/Bento ?PDF/gi, APP_NAME));
  });

  // Load the application
  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle(
  IPC_CHANNELS.ENSURE_MODULES,
  async (_event, names: DesktopModuleName[]): Promise<EnsureResult> => {
    if (!modulesManager) {
      return { ok: false, error: 'Modules manager not initialized' };
    }
    return modulesManager.ensureModules(
      names,
      (progress) => {
        mainWindow?.webContents.send(IPC_CHANNELS.MODULE_PROGRESS, progress);
      },
      mainWindow
    );
  }
);

ipcMain.handle(IPC_CHANNELS.GET_MODULES_STATUS, (): ModuleStatus[] => {
  return modulesManager?.getStatus() ?? [];
});

ipcMain.handle(
  IPC_CHANNELS.REMOVE_MODULE,
  async (_event, name: DesktopModuleName): Promise<boolean> => {
    if (!modulesManager || !mainWindow) return false;
    const text = ui();
    const choice = await dialog.showMessageBox(mainWindow, {
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

ipcMain.handle(IPC_CHANNELS.TAKE_OPENED_FILE, (): OpenedFile | null => {
  if (!pendingOpenFile) return null;
  const filePath = pendingOpenFile;
  pendingOpenFile = null;
  return { path: filePath, name: path.basename(filePath) };
});

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

ipcMain.handle(IPC_CHANNELS.SHOW_SAVE_DIALOG, async (_event, options) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showSaveDialog(mainWindow, options);
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

ipcMain.handle(IPC_CHANNELS.LIST_PRINTERS, async (): Promise<PrinterInfo[]> => {
  if (!mainWindow) return [];
  const [printers, defaultName] = await Promise.all([
    mainWindow.webContents.getPrintersAsync(),
    getDefaultPrinterName(),
  ]);
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: printer.name === defaultName,
  }));
});

ipcMain.handle(
  IPC_CHANNELS.PRINT,
  async (_event, request: PrintRequest): Promise<PrintResult> => {
    if (!mainWindow) return { success: false, error: 'No window' };
    const contents = mainWindow.webContents;

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
          label: text.openPdf,
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            void showOpenFileDialog();
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
            mainWindow?.loadURL(`${APP_ORIGIN}/cit-about.html`);
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
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
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
  const startupFile = findPdfArg(process.argv);
  if (startupFile) queueOpenFile(startupFile);

  createWindow();

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
