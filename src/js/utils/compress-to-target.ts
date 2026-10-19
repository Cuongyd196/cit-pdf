/**
 * Compressing to a size limit, shared by the Compress page and Studio:
 * first the Condense levels, which keep text selectable, then (unless the
 * caller wants text kept) pages turned into images at lower and lower
 * resolution, down to a floor where body text is still readable. When even
 * that is too large, splitUnderLimit cuts the result into parts that fit.
 */
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  PHOTON_PRESETS,
  performCondenseCompression,
  type CondenseCustomSettings,
} from './compress.js';
import {
  RASTER_START,
  condenseLadder,
  nextRasterSettings,
  type RasterSettings,
} from './compress-target.js';

/**
 * Sizes as the size limit counts them (1 MB = 1,000,000 bytes), so a limit
 * of "2 MB" reads back as 2 MB and a result just over it as "2.04 MB".
 */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1000 / 1000;
  return `${Number(mb.toFixed(mb < 10 ? 2 : 1))} MB`;
}

// Each image attempt renders every page again, so keep the number bounded.
const MAX_RASTER_ATTEMPTS = 8;

export type CompressMethod = 'condense' | 'condense-plain' | 'images';

export interface CompressToTargetOptions {
  algorithm?: 'condense' | 'photon';
  /** Condense level to start from: light, balanced, aggressive, extreme. */
  level: string;
  /** Size the result must fit in, or null for no limit. */
  targetBytes: number | null;
  /** Shapes the first Condense attempt only. */
  customSettings?: CondenseCustomSettings;
  grayscale?: boolean;
  /** Never turn pages into images, even when the limit is not reached. */
  keepText?: boolean;
  /** The document for image attempts; null when the user gave up. */
  loadPdf: () => Promise<PDFDocumentProxy | null>;
  status?: (key: CompressStatus, page?: number, total?: number) => void;
}

export type CompressStatus =
  | 'loading'
  | 'condense'
  | 'condense-stronger'
  | 'images';

export interface CompressToTargetResult {
  blob: Blob;
  method: CompressMethod;
  reachedTarget: boolean;
  /** Pages were turned into images: text is no longer selectable. */
  rasterized: boolean;
  /** The image attempts reached their floor and could go no lower. */
  atFloor: boolean;
}

export async function renderPagesAsImages(
  pdf: PDFDocumentProxy,
  settings: RasterSettings,
  onPage: (page: number, total: number) => void = () => {},
  grayscale = false
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    onPage(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: settings.scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create canvas context');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport, canvas }).promise;

    let source: HTMLCanvasElement = canvas;
    if (grayscale) {
      source = document.createElement('canvas');
      source.width = canvas.width;
      source.height = canvas.height;
      const gray = source.getContext('2d');
      if (!gray) throw new Error('Failed to create canvas context');
      gray.filter = 'grayscale(1)';
      gray.drawImage(canvas, 0, 0);
    }
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      source.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Failed to create JPEG')),
        'image/jpeg',
        settings.quality
      )
    );
    canvas.width = canvas.height = source.width = source.height = 0;

    const image = await out.embedJpg(await jpeg.arrayBuffer());
    // The page keeps its real size; only the image on it gets coarser.
    const size = page.getViewport({ scale: 1 });
    out
      .addPage([size.width, size.height])
      .drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
  }
  return out.save();
}

/** Compresses one PDF; the smallest result, or null when cancelled. */
export async function compressToTarget(
  file: Blob,
  options: CompressToTargetOptions
): Promise<CompressToTargetResult | null> {
  const { targetBytes, level } = options;
  const algorithm = options.algorithm ?? 'condense';
  const status = options.status ?? (() => {});
  const fits = (blob: Blob) => targetBytes === null || blob.size <= targetBytes;
  const results: Array<{
    blob: Blob;
    method: CompressMethod;
    rasterized: boolean;
  }> = [];
  const gray = options.grayscale ? { convertToGrayscale: true } : undefined;

  if (algorithm === 'condense') {
    status('loading');
    const levels = targetBytes === null ? [level] : condenseLadder(level);
    for (let i = 0; i < levels.length; i++) {
      status(i === 0 ? 'condense' : 'condense-stronger');
      // The user's own settings shape the first attempt only.
      const settings =
        i === 0 && options.customSettings
          ? { ...options.customSettings, ...gray }
          : gray;
      const result = await performCondenseCompression(
        file,
        levels[i],
        settings
      );
      const plain = (result as { usedFallback?: boolean }).usedFallback;
      results.push({
        blob: result.blob,
        method: plain ? 'condense-plain' : 'condense',
        rasterized: false,
      });
      if (fits(result.blob)) break;
    }
  }

  const smallest = () =>
    results.reduce((a, b) => (b.blob.size < a.blob.size ? b : a));

  let atFloor = false;
  const needImages =
    algorithm === 'photon' ||
    (!options.keepText && results.length > 0 && !fits(smallest().blob));
  if (needImages) {
    const pdf = await options.loadPdf();
    if (!pdf) return null;
    let settings: RasterSettings | null =
      algorithm === 'photon'
        ? PHOTON_PRESETS[level as keyof typeof PHOTON_PRESETS] ||
          PHOTON_PRESETS.balanced
        : RASTER_START;
    for (let i = 0; settings && i < MAX_RASTER_ATTEMPTS; i++) {
      const bytes = await renderPagesAsImages(
        pdf,
        settings,
        (page, total) => status('images', page, total),
        options.grayscale
      );
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      results.push({ blob, method: 'images', rasterized: true });
      if (targetBytes === null || fits(blob)) break;
      settings = nextRasterSettings(settings, blob.size, targetBytes);
      if (!settings) atFloor = true;
    }
  }

  const best = smallest();
  return {
    blob: best.blob,
    method: best.method,
    rasterized: best.rasterized,
    reachedTarget: fits(best.blob),
    atFloor,
  };
}

/**
 * Cuts a PDF into as few parts as possible, each at most `limit` bytes, by
 * whole pages and in order. Null when a single page is already too large.
 */
export async function splitUnderLimit(
  bytes: Uint8Array,
  limit: number
): Promise<Uint8Array[] | null> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = source.getPageCount();

  const build = async (from: number, to: number) => {
    const part = await PDFDocument.create();
    const pages = await part.copyPages(
      source,
      Array.from({ length: to - from }, (_, i) => from + i)
    );
    pages.forEach((page) => part.addPage(page));
    return part.save();
  };

  const parts: Uint8Array[] = [];
  let start = 0;
  while (start < total) {
    // Largest run of pages from `start` that fits: grow, then bisect.
    let good = start;
    let goodBytes: Uint8Array | null = null;
    let step = Math.max(1, Math.round((total * limit) / bytes.length / 2));
    let bad = total + 1;
    while (good + 1 < bad) {
      const end = Math.min(bad - 1, good + step, total);
      const candidate = await build(start, end);
      if (candidate.length <= limit) {
        good = end;
        goodBytes = candidate;
        if (end === total) break;
        step *= 2;
      } else {
        bad = end;
        step = Math.max(1, Math.floor((bad - good) / 2));
      }
    }
    if (!goodBytes) return null;
    parts.push(goodBytes);
    start = good;
  }
  return parts;
}
