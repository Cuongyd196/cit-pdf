export type DesktopModuleName =
  | 'pymupdf'
  | 'ghostscript'
  | 'libreoffice'
  | 'cpdf';

export interface ModuleManifestFileItem {
  path: string;
  url: string;
  sha256?: string;
  size?: number;
}

export interface ModuleManifestItem {
  version: string;
  bundled?: boolean;
  mount: string;
  probe: string;
  label: Record<string, string>;
  source: string;
  kind: 'npm-tarball' | 'files';
  url?: string;
  integrity?: string; // e.g. sha512-...
  files?: ModuleManifestFileItem[];
  size?: number;
}

export interface ModulesManifest {
  modules: Record<string, ModuleManifestItem>;
}

export interface ModuleProgress {
  name: string;
  label: string;
  received: number;
  total: number;
}

export interface EnsureResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface ModuleStatus {
  name: DesktopModuleName;
  label: Record<string, string>;
  version: string;
  source: string;
  size: number;
  installed: boolean;
  /** Shipped inside the installer; cannot be removed. */
  bundled: boolean;
}

export interface OpenedFile {
  path: string;
  name: string;
}

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export const PRINT_PAPER_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const;
export type PrintPaperSize = (typeof PRINT_PAPER_SIZES)[number];

export const PRINT_DUPLEX_MODES = ['simplex', 'longEdge', 'shortEdge'] as const;
export type PrintDuplexMode = (typeof PRINT_DUPLEX_MODES)[number];

export interface PrintRequest {
  deviceName: string;
  copies: number;
  paperSize: PrintPaperSize;
  landscape: boolean;
  duplexMode: PrintDuplexMode;
  color: boolean;
  /** Keep content inside the printer's printable area. */
  printableArea: boolean;
}

export interface PrintResult {
  success: boolean;
  error?: string;
}

export const IPC_CHANNELS = {
  GET_MODULES_STATUS: 'bento:get-modules-status',
  REMOVE_MODULE: 'bento:remove-module',
  FILE_OPENED: 'bento:file-opened',
  TAKE_OPENED_FILE: 'bento:take-opened-file',
  READ_OPENED_FILE: 'bento:read-opened-file',
  ENSURE_MODULES: 'bento:ensure-modules',
  MODULE_PROGRESS: 'bento:module-progress',
  GET_PLATFORM: 'bento:get-platform',
  OPEN_EXTERNAL: 'bento:open-external',
  SHOW_SAVE_DIALOG: 'bento:show-save-dialog',
  LIST_PRINTERS: 'bento:list-printers',
  PRINT: 'bento:print',
} as const;
