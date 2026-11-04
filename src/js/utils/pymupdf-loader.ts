import { WasmProvider } from './wasm-provider.js';
import { ensureDesktopModules } from '../desktop/bridge.js';
import type {
  PyMuPDFInstance,
  PyMuPDFCompressOptions,
  PyMuPDFExtractTextOptions,
  PyMuPDFRasterizeOptions,
} from '@/types';

export interface PyMuPDFInterface {
  load(): Promise<void>;
  compressPdf(
    file: Blob,
    options: PyMuPDFCompressOptions
  ): Promise<{ blob: Blob; compressedSize: number }>;
  convertToPdf(file: Blob, ext: string): Promise<Blob>;
  extractText(file: Blob, options?: PyMuPDFExtractTextOptions): Promise<string>;
  extractImages(file: Blob): Promise<Array<{ data: Uint8Array; ext: string }>>;
  extractTables(file: Blob): Promise<unknown[]>;
  toSvg(file: Blob, pageNum: number): Promise<string>;
  renderPageToImage(file: Blob, pageNum: number, scale: number): Promise<Blob>;
  getPageCount(file: Blob): Promise<number>;
  rasterizePdf(
    file: Blob | File,
    options: PyMuPDFRasterizeOptions
  ): Promise<Blob>;
}

interface EngineUrls {
  /** The package root, ending in "/". */
  pymupdf: string;
  /**
   * Given to PyMuPDF, which uses it only in pdfToDocx: a Ghostscript pass
   * to RGB with JPEG-recompressed images before pdf2docx. Left empty, so
   * that pass is skipped: it is lossy, costs ~10 s per 150 pages, and the
   * wrapper's own pixmap patch already turns CMYK images into RGB.
   */
  ghostscript: string;
}

let urlsPromise: Promise<EngineUrls> | null = null;

/** Checks the configuration and, on the desktop, installs the engines. */
function prepare(): Promise<EngineUrls> {
  urlsPromise ??= (async () => {
    if (!WasmProvider.isConfigured('pymupdf')) {
      throw new Error(
        'PyMuPDF is not configured. Please configure it in Advanced Settings.'
      );
    }
    // Ghostscript is not needed here (see EngineUrls); tools that use it
    // load it through ghostscript-loader.
    await ensureDesktopModules(['pymupdf']);
    const absolute = (url: string) =>
      new URL(url.endsWith('/') ? url : `${url}/`, location.href).href;
    return {
      pymupdf: absolute(WasmProvider.getUrl('pymupdf')!),
      ghostscript: '',
    };
  })().catch((error: unknown) => {
    urlsPromise = null;
    throw error;
  });
  return urlsPromise;
}

function loadError(error: unknown): Error {
  const msg = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to load PyMuPDF from CDN: ${msg}`, { cause: error });
}

// ---- In the page itself: needed by open(), whose documents have
// synchronous methods that cannot cross to a worker.

let mainThread: Promise<PyMuPDFInstance> | null = null;

/**
 * PyMuPDF on the page's own thread. Use it for `open()` and the document
 * objects it returns; everything else goes through `loadPyMuPDF()`, which
 * keeps the window responsive.
 */
export function loadPyMuPDFMainThread(): Promise<PyMuPDFInstance> {
  mainThread ??= (async () => {
    try {
      const urls = await prepare();
      const module = await import(
        /* @vite-ignore */ `${urls.pymupdf}dist/index.js`
      );
      if (typeof module.PyMuPDF !== 'function') {
        throw new Error(
          'PyMuPDF module did not export expected PyMuPDF class.'
        );
      }
      const instance = new module.PyMuPDF({
        assetPath: `${urls.pymupdf}assets/`,
        ghostscriptUrl: urls.ghostscript,
      }) as PyMuPDFInstance;
      await instance.load();
      console.log('[PyMuPDF Loader] Loaded on the page thread');
      return instance;
    } catch (error: unknown) {
      mainThread = null;
      throw loadError(error);
    }
  })();
  return mainThread;
}

// ---- In a worker

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

type LogListener = (text: string) => void;

const logListeners = new Set<LogListener>();
const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let nextId = 1;

function startWorker(urls: EngineUrls): Promise<void> {
  if (workerReady) return workerReady;
  const started = new Worker(new URL('./pymupdf.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker = started;
  workerReady = new Promise<void>((resolve, reject) => {
    started.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        id?: number;
        result?: unknown;
        message?: string;
        text?: string;
      };
      if (data.type === 'log') {
        for (const listener of logListeners) listener(data.text ?? '');
      } else if (data.type === 'ready') {
        resolve();
      } else if (data.type === 'failed') {
        reject(new Error(data.message));
      } else if (data.id !== undefined) {
        const call = pending.get(data.id);
        pending.delete(data.id);
        if (data.type === 'result') {
          call?.resolve(data.result);
          return;
        }
        call?.reject(new Error(data.message));
        // Out of memory leaves Pyodide unusable: start afresh next time.
        if (/fatal|out of memory|RuntimeError/i.test(data.message ?? '')) {
          if (worker === started) stopPyMuPDFWork();
        }
      }
    };
    started.onerror = (event) => {
      event.preventDefault();
      const message = event.message || 'PyMuPDF worker failed';
      reject(new Error(message));
      if (worker === started) {
        for (const call of pending.values()) call.reject(new Error(message));
        pending.clear();
        stopPyMuPDFWork();
      }
    };
  }).catch((error: unknown) => {
    stopPyMuPDFWork();
    throw error;
  });
  started.postMessage({
    type: 'init',
    pymupdfUrl: urls.pymupdf,
    ghostscriptUrl: urls.ghostscript,
  });
  return workerReady;
}

function callWorker(method: string, args: unknown[]): Promise<unknown> {
  if (!worker) {
    return Promise.reject(new Error('PyMuPDF work was stopped.'));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: 'call', id, method, args });
  });
}

/** Methods whose results are live objects, kept on the page's thread. */
const MAIN_THREAD_METHODS = new Set(['open', 'create', 'openUrl']);

function workerProxy(): PyMuPDFInstance {
  return new Proxy({} as PyMuPDFInstance, {
    get(_target, prop) {
      // Not a thenable: the proxy is returned from an async function.
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop === 'load') return () => Promise.resolve();
      if (MAIN_THREAD_METHODS.has(prop)) {
        return async (...args: unknown[]) => {
          const instance = (await loadPyMuPDFMainThread()) as unknown as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          return instance[prop](...args);
        };
      }
      return async (...args: unknown[]) => {
        // Restarted when an earlier piece of work was stopped.
        await startWorker(await prepare());
        return callWorker(prop, args);
      };
    },
  });
}

let proxy: PyMuPDFInstance | null = null;

/**
 * PyMuPDF for conversions: the engine runs in a worker, so the page keeps
 * drawing (spinner, progress) while it works. Falls back to the page's
 * thread where a worker cannot start.
 */
export async function loadPyMuPDF(): Promise<PyMuPDFInstance> {
  if (proxy) return proxy;
  let urls: EngineUrls;
  try {
    urls = await prepare();
  } catch (error: unknown) {
    throw loadError(error);
  }
  try {
    await startWorker(urls);
  } catch (error: unknown) {
    console.warn(
      '[PyMuPDF Loader] Worker unavailable, using the page thread:',
      error
    );
    return loadPyMuPDFMainThread();
  }
  console.log('[PyMuPDF Loader] Loaded in a worker');
  proxy = workerProxy();
  return proxy;
}

/** Text the engine prints while it works (pdf2docx reports pages so). */
export function onPyMuPDFLog(listener: LogListener): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

/**
 * Stops the work in progress: its calls reject, and the next call starts
 * the engine again.
 */
export function stopPyMuPDFWork(): void {
  worker?.terminate();
  worker = null;
  workerReady = null;
  for (const call of pending.values()) {
    call.reject(new Error('PyMuPDF work was stopped.'));
  }
  pending.clear();
}

export function isPyMuPDFAvailable(): boolean {
  return WasmProvider.isConfigured('pymupdf');
}

export function clearPyMuPDFCache(): void {
  stopPyMuPDFWork();
  proxy = null;
  mainThread = null;
  urlsPromise = null;
}
