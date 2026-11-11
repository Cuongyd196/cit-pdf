import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC_CHANNELS,
  type DesktopModuleName,
  type FolderInstallResult,
  type ModuleProgress,
  type ModuleStatus,
  type OpenedFile,
  type EnsureResult,
  type InstallUpdateResult,
  type PrinterInfo,
  type PrintRequest,
  type PrintResult,
  type SaveMode,
  type SavedDownload,
  type UpdateCheckResult,
  type UpdateProgress,
} from './types.js';

const bridge = {
  platform: process.platform,

  ensureModules: (names: DesktopModuleName[]): Promise<EnsureResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ENSURE_MODULES, names);
  },

  onModuleProgress: (cb: (p: ModuleProgress) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: ModuleProgress
    ) => {
      cb(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.MODULE_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MODULE_PROGRESS, handler);
    };
  },

  cancelModuleDownloads: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_MODULE_DOWNLOADS);
  },

  getModulesStatus: (): Promise<ModuleStatus[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_MODULES_STATUS);
  },

  removeModule: (name: DesktopModuleName): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_MODULE, name);
  },

  installModulesFromFolder: (): Promise<FolderInstallResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.INSTALL_MODULES_FROM_FOLDER);
  },

  // Files handed to the app by the OS ("Open with") or the File menu.
  onFileOpened: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC_CHANNELS.FILE_OPENED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FILE_OPENED, handler);
    };
  },

  onFindTool: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC_CHANNELS.FIND_TOOL, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FIND_TOOL, handler);
    };
  },

  takeOpenedFile: (): Promise<OpenedFile | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.TAKE_OPENED_FILE);
  },

  readOpenedFile: (filePath: string): Promise<Uint8Array> => {
    return ipcRenderer.invoke(IPC_CHANNELS.READ_OPENED_FILE, filePath);
  },

  openExternal: (url: string): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url);
  },

  showSaveDialog: (options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_SAVE_DIALOG, options);
  },

  listPrinters: (): Promise<PrinterInfo[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIST_PRINTERS);
  },

  /** Opens the OS printing-preferences dialog for one printer (Windows). */
  openPrinterPreferences: (deviceName: string): Promise<boolean> => {
    return ipcRenderer.invoke(
      IPC_CHANNELS.OPEN_PRINTER_PREFERENCES,
      deviceName
    );
  },

  // Prints the page as it currently renders for print media, without
  // showing the OS print dialog.
  print: (request: PrintRequest): Promise<PrintResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.PRINT, request);
  },

  // A file the user picked or dropped in a page. The path is read here, from
  // the File object itself, so a page cannot name an arbitrary path.
  registerPickedFile: (file: File): Promise<OpenedFile | null> => {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) return Promise.resolve(null);
    return ipcRenderer.invoke(IPC_CHANNELS.REGISTER_PICKED_FILE, filePath);
  },

  // Opens a file the user already handed to the app in a window of its own.
  openInNewWindow: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_NEW_WINDOW, filePath);
  },

  // A result the user just saved: lets the page offer to show it.
  onDownloadSaved: (cb: (saved: SavedDownload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, saved: SavedDownload) =>
      cb(saved);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_SAVED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_SAVED, handler);
    };
  },

  // The next PDF this page downloads replaces the file it opened, or opens
  // "Save as" in that file's folder. Only a file the user opened is accepted.
  setSaveTarget: (mode: SaveMode, filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_SAVE_TARGET, mode, filePath);
  },

  showSavedInFolder: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_SAVED_IN_FOLDER, filePath);
  },

  openSavedFile: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_SAVED_FILE, filePath);
  },

  // Documents read in the viewer lately, newest first. Listing them lets the
  // page open them again; only files the user opened before can be on it.
  noteRecentFile: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_RECENT_FILE, filePath);
  },

  listRecentFiles: (): Promise<OpenedFile[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIST_RECENT_FILES);
  },

  clearRecentFiles: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLEAR_RECENT_FILES);
  },

  // Asks GitHub whether a newer release exists. Runs only on request.
  checkForUpdate: (): Promise<UpdateCheckResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_UPDATE);
  },

  // Downloads the installer the last check found, checks its hash, runs it
  // and quits. Answers only when it could not.
  installUpdate: (): Promise<InstallUpdateResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.INSTALL_UPDATE);
  },

  onUpdateProgress: (cb: (p: UpdateProgress) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: UpdateProgress
    ) => cb(progress);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_PROGRESS, handler);
    };
  },

  // Keeps the menu bar and native dialogs in the language of the pages.
  setLanguage: (lang: string): void => {
    ipcRenderer.send(IPC_CHANNELS.SET_LANGUAGE, lang);
  },
};

contextBridge.exposeInMainWorld('bentoDesktop', bridge);
