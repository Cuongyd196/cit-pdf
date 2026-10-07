import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type DesktopModuleName,
  type ModuleProgress,
  type ModuleStatus,
  type OpenedFile,
  type EnsureResult,
  type PrinterInfo,
  type PrintRequest,
  type PrintResult,
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

  getModulesStatus: (): Promise<ModuleStatus[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_MODULES_STATUS);
  },

  removeModule: (name: DesktopModuleName): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_MODULE, name);
  },

  // Files handed to the app by the OS ("Open with") or the File menu.
  onFileOpened: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC_CHANNELS.FILE_OPENED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FILE_OPENED, handler);
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

  // Prints the page as it currently renders for print media, without
  // showing the OS print dialog.
  print: (request: PrintRequest): Promise<PrintResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.PRINT, request);
  },
};

contextBridge.exposeInMainWorld('bentoDesktop', bridge);
