/**
 * Desktop (Electron) bridge.
 *
 * In the desktop app, heavy WASM engines (PyMuPDF, Ghostscript, LibreOffice)
 * are not shipped in the installer. They are downloaded on first use from
 * their official sources (npm registry / upstream GitHub repo), verified by
 * hash, and cached locally so they keep working offline afterwards.
 *
 * On the web build `window.bentoDesktop` is undefined and every function here
 * is a no-op.
 */

export type DesktopModuleName =
  | 'pymupdf'
  | 'ghostscript'
  | 'libreoffice'
  | 'cpdf';

interface ModuleProgress {
  name: string;
  label: string;
  received: number;
  total: number;
}

interface EnsureResult {
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

export type PrintPaperSize = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal';
export type PrintDuplexMode = 'simplex' | 'longEdge' | 'shortEdge';

export interface PrintRequest {
  deviceName: string;
  copies: number;
  paperSize: PrintPaperSize;
  landscape: boolean;
  duplexMode: PrintDuplexMode;
  color: boolean;
  printableArea: boolean;
}

export interface PrintResult {
  success: boolean;
  error?: string;
}

interface DesktopBridge {
  platform: string;
  ensureModules(names: DesktopModuleName[]): Promise<EnsureResult>;
  onModuleProgress(cb: (p: ModuleProgress) => void): () => void;
  getModulesStatus(): Promise<ModuleStatus[]>;
  removeModule(name: DesktopModuleName): Promise<boolean>;
  onFileOpened(cb: () => void): () => void;
  takeOpenedFile(): Promise<OpenedFile | null>;
  readOpenedFile(path: string): Promise<Uint8Array>;
  listPrinters(): Promise<PrinterInfo[]>;
  print(request: PrintRequest): Promise<PrintResult>;
  setLanguage(lang: string): void;
  registerPickedFile(file: File): Promise<OpenedFile | null>;
}

declare global {
  interface Window {
    bentoDesktop?: DesktopBridge;
  }
}

export function getBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.bentoDesktop;
}

export function isDesktopApp(): boolean {
  return !!getBridge();
}

const OVERLAY_ID = 'bento-desktop-module-progress';

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function showProgress(p: ModuleProgress): void {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className =
      'fixed bottom-4 right-4 z-[9999] w-80 rounded-xl border border-gray-700 bg-gray-800/95 p-4 shadow-2xl backdrop-blur';

    const title = document.createElement('p');
    title.className = 'mb-2 text-sm font-semibold text-white';
    title.dataset.role = 'title';

    const track = document.createElement('div');
    track.className = 'h-2 w-full overflow-hidden rounded-full bg-gray-700';
    const bar = document.createElement('div');
    bar.className =
      'h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-200';
    bar.style.width = '0%';
    bar.dataset.role = 'bar';
    track.appendChild(bar);

    const detail = document.createElement('p');
    detail.className = 'mt-2 text-xs text-gray-400';
    detail.dataset.role = 'detail';

    overlay.append(title, track, detail);
    document.body.appendChild(overlay);
  }

  const pct = p.total > 0 ? Math.min(100, (p.received / p.total) * 100) : 0;
  const title = overlay.querySelector<HTMLElement>('[data-role="title"]');
  const bar = overlay.querySelector<HTMLElement>('[data-role="bar"]');
  const detail = overlay.querySelector<HTMLElement>('[data-role="detail"]');
  if (title) title.textContent = `⬇ ${p.label}`;
  if (bar) bar.style.width = `${pct.toFixed(1)}%`;
  if (detail) {
    detail.textContent =
      p.total > 0
        ? `${formatMB(p.received)} / ${formatMB(p.total)} MB (${pct.toFixed(0)}%)`
        : `${formatMB(p.received)} MB`;
  }
}

function hideProgress(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Make sure the given engine modules are installed locally (desktop only).
 * Prompts the user and downloads them if needed. Throws if the user cancels
 * or the download/verification fails. Resolves immediately on the web.
 */
export async function ensureDesktopModules(
  names: DesktopModuleName[]
): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;

  const off = bridge.onModuleProgress(showProgress);
  try {
    const result = await bridge.ensureModules(names);
    if (!result.ok) {
      throw new Error(
        result.cancelled
          ? 'Required component was not downloaded (cancelled by user).'
          : `Required component could not be installed: ${result.error ?? 'unknown error'}`
      );
    }
  } finally {
    off();
    hideProgress();
  }
}
