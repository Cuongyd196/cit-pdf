/**
 * Desktop print dialog. Electron has no print preview and the Windows system
 * dialog cannot show one for it, so the app brings its own: settings on the
 * left, a preview of each sheet on the right, and a silent print through the
 * main process.
 *
 * Paths (in order):
 * 1. Hand the PDF to the OS (Windows PrintTo / Print) or Chromium's PDF
 *    viewer — text and lines stay vectors.
 * 2. If that is unavailable, rasterise pages into a print-only container and
 *    print the window (print CSS hides everything else).
 *
 * "System dialog" prepares the selected pages as a PDF first, then opens the
 * OS dialog so Properties / advanced settings apply to this job.
 */
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import {
  getBridge,
  type PrintDuplexMode,
  type PrintPaperSize,
  type PrintRequest,
  type PrinterInfo,
} from './bridge.js';
import { parsePageRanges } from './print-ranges.js';
import { ds, type DesktopStringKey } from './strings.js';

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  /** Rotation stored in the PDF, in degrees. */
  rotate: number;
  getViewport(params: { scale: number; rotation?: number }): PdfViewport;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    intent?: string;
  }): { promise: Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  /** The file as loaded. */
  getData?(): Promise<Uint8Array>;
  /** The file with form values and drawings the user added in the viewer. */
  saveDocument?(): Promise<Uint8Array>;
  annotationStorage?: { size: number };
}

export interface PrintSource {
  pdfDocument: PdfDocument;
  /**
   * The document that loaded the PDF. Its embedded fonts are registered
   * there, so pages must be drawn on a canvas of that document; drawn
   * anywhere else, text comes out as empty boxes.
   */
  fontDocument: Document;
  currentPage: number;
  /** Last-resort escape: the viewer's own window.print. */
  systemPrint: () => void;
}

type Orientation = 'auto' | 'portrait' | 'landscape';
type Scale = 'fit' | 'actual';
type PageMode = 'all' | 'current' | 'custom';

interface SavedSettings {
  printer?: string;
  paper?: PrintPaperSize;
  duplex?: PrintDuplexMode;
  color?: boolean;
  scale?: Scale;
}

const SETTINGS_KEY = 'cit:print-settings';
const DIALOG_ID = 'desktop-print-dialog';
const PRINT_ROOT_ID = 'cit-print-root';
const PRINT_STYLE_ID = 'cit-print-style';

// Paper sizes in PDF points (1/72 inch), portrait.
const PAPER_POINTS: Record<PrintPaperSize, [number, number]> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};

// Pages printed as pictures (see rasterDpi). 600 is close to a vector print
// for short documents; long ones drop toward MIN within the pixel budget.
const MAX_PRINT_DPI = 600;
const MIN_PRINT_DPI = 300;
const PRINT_PIXEL_BUDGET = 200e6;
const PREVIEW_SCALE = 1.5;
const MAX_CANVAS_SIDE = 5000;

const FIELD_CLASS =
  'w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';
const LABEL_CLASS = 'mb-1 block text-xs font-medium text-gray-400';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function loadSettings(): SavedSettings {
  try {
    const parsed = JSON.parse(getStoredItem(SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Closest named paper to a page's media box (points). */
function guessPaper(width: number, height: number): PrintPaperSize {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  let best: PrintPaperSize = 'A4';
  let bestDist = Infinity;
  for (const name of Object.keys(PAPER_POINTS) as PrintPaperSize[]) {
    const [w, h] = PAPER_POINTS[name];
    const dist = Math.hypot(short - w, long - h);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

function localizePrintError(message: string): string {
  const key =
    message === 'Unknown printer'
      ? 'printUnknownPrinter'
      : message === 'Printer did not answer'
        ? 'printNoAnswer'
        : message === 'Print job failed' || message === 'Print job canceled'
          ? 'printJobFailed'
          : null;
  return key ? ds(key) : message;
}

async function renderPage(
  fontDocument: Document,
  page: PdfPage,
  scale: number,
  quarterTurn: boolean
): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const longest = Math.max(base.width, base.height) * scale;
  const viewport = page.getViewport({
    scale:
      longest > MAX_CANVAS_SIDE ? (scale * MAX_CANVAS_SIDE) / longest : scale,
    rotation: (page.rotate + (quarterTurn ? 90 : 0)) % 360,
  });
  const canvas = fontDocument.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  // PDFs assume white paper; transparent pixels would print as black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, intent: 'print' })
    .promise;
  return canvas;
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error('Could not encode the page'));
    }, 'image/png');
  });
}

function removePrintRoot(): void {
  const root = document.getElementById(PRINT_ROOT_ID);
  root?.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
  root?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

function select<T extends string>(
  options: Array<[T, string]>,
  value: T
): HTMLSelectElement {
  const node = el('select', FIELD_CLASS);
  for (const [optionValue, label] of options) {
    const option = el('option', '', label);
    option.value = optionValue;
    node.append(option);
  }
  node.value = value;
  return node;
}

function field(labelKey: DesktopStringKey, control: HTMLElement): HTMLElement {
  const wrapper = el('label', 'block');
  wrapper.append(el('span', LABEL_CLASS, ds(labelKey)), control);
  return wrapper;
}

function fillPrinterSelect(
  node: HTMLSelectElement,
  printers: PrinterInfo[],
  preferredName: string
): void {
  node.replaceChildren();
  for (const printer of printers) {
    const option = el(
      'option',
      '',
      printer.isDefault
        ? `${printer.displayName} (${ds('printDefault')})`
        : printer.displayName
    );
    option.value = printer.name;
    node.append(option);
  }
  const preferred =
    printers.find((p) => p.name === preferredName) ??
    printers.find((p) => p.isDefault) ??
    printers[0];
  if (preferred) node.value = preferred.name;
}

export async function openPrintDialog(source: PrintSource): Promise<void> {
  const bridge = getBridge();
  if (!bridge || document.getElementById(DIALOG_ID)) return;

  const { pdfDocument } = source;
  const total = pdfDocument.numPages;
  const saved = loadSettings();

  let printers: PrinterInfo[] = [];
  try {
    printers = await bridge.listPrinters();
  } catch (e) {
    console.error('[Desktop] Could not list printers:', e);
  }

  let defaultPaper: PrintPaperSize =
    saved.paper && saved.paper in PAPER_POINTS ? saved.paper : 'A4';
  try {
    const first = await pdfDocument.getPage(1);
    const box = first.getViewport({ scale: 1 });
    if (!(saved.paper && saved.paper in PAPER_POINTS)) {
      defaultPaper = guessPaper(box.width, box.height);
    }
  } catch {
    /* keep A4 */
  }

  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
  );
  overlay.id = DIALOG_ID;
  const dialog = el(
    'div',
    'flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-800 shadow-2xl'
  );
  overlay.append(dialog);

  // Header
  const header = el(
    'div',
    'flex items-center justify-between border-b border-gray-700 px-6 py-4'
  );
  const title = el(
    'h3',
    'flex items-center gap-2 text-lg font-semibold text-white'
  );
  title.append(
    el('i', 'ph ph-printer text-xl text-indigo-400'),
    ds('printTitle')
  );
  const closeButton = el(
    'button',
    'rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white'
  );
  closeButton.type = 'button';
  closeButton.append(el('i', 'ph ph-x text-xl'));
  header.append(title, closeButton);

  // Settings column
  const printerSelect = el('select', FIELD_CLASS);
  fillPrinterSelect(printerSelect, printers, saved.printer || '');

  const refreshPrintersButton = el(
    'button',
    'rounded-md p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-40'
  );
  refreshPrintersButton.type = 'button';
  refreshPrintersButton.title = ds('printRefreshPrinters');
  refreshPrintersButton.append(el('i', 'ph ph-arrow-clockwise text-base'));

  const printerRow = el('div', 'flex items-end gap-2');
  const printerField = field('printPrinter', printerSelect);
  printerField.classList.add('min-w-0', 'flex-1');
  printerRow.append(printerField, refreshPrintersButton);

  const advancedButton = el(
    'button',
    'mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-gray-600 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
  );
  advancedButton.type = 'button';
  advancedButton.title = ds('printAdvancedHint');
  advancedButton.append(
    el('i', 'ph ph-sliders-horizontal text-base'),
    ds('printAdvanced')
  );
  const canOpenAdvanced =
    typeof bridge.openPrinterPreferences === 'function' &&
    (bridge.platform === 'win32' || bridge.platform === 'darwin');
  advancedButton.disabled = !canOpenAdvanced || printers.length === 0;

  const copiesInput = el('input', FIELD_CLASS);
  copiesInput.type = 'number';
  copiesInput.min = '1';
  copiesInput.max = '999';
  copiesInput.value = '1';

  const pagesSelect = select<PageMode>(
    [
      ['all', ds('printPagesAll', { n: total })],
      ['current', ds('printPagesCurrent', { n: source.currentPage })],
      ['custom', ds('printPagesCustom')],
    ],
    'all'
  );
  const rangeInput = el('input', `${FIELD_CLASS} mt-2 hidden`);
  rangeInput.type = 'text';
  rangeInput.placeholder = ds('printPagesHint');
  const rangeError = el('p', 'mt-1 hidden text-xs text-red-500');
  rangeError.textContent = ds('printPagesInvalid', { n: total });
  const pagesField = field('printPages', pagesSelect);
  pagesField.append(rangeInput, rangeError);

  const paperSelect = select<PrintPaperSize>(
    (Object.keys(PAPER_POINTS) as PrintPaperSize[]).map((name) => [name, name]),
    defaultPaper
  );
  const orientationSelect = select<Orientation>(
    [
      ['auto', ds('printAuto')],
      ['portrait', ds('printPortrait')],
      ['landscape', ds('printLandscape')],
    ],
    'auto'
  );
  const scaleSelect = select<Scale>(
    [
      ['fit', ds('printFit')],
      ['actual', ds('printActual')],
    ],
    saved.scale === 'actual' ? 'actual' : 'fit'
  );
  const duplexSelect = select<PrintDuplexMode>(
    [
      ['simplex', ds('printSimplex')],
      ['longEdge', ds('printLongEdge')],
      ['shortEdge', ds('printShortEdge')],
    ],
    saved.duplex ?? 'simplex'
  );
  const colorSelect = select<'color' | 'mono'>(
    [
      ['color', ds('printColorOn')],
      ['mono', ds('printColorOff')],
    ],
    saved.color === false ? 'mono' : 'color'
  );

  const settings = el(
    'div',
    'w-80 flex-shrink-0 space-y-4 overflow-y-auto border-r border-gray-700 p-6'
  );
  const noPrintersMsg = el(
    'p',
    'rounded-md bg-gray-900 px-3 py-2 text-sm text-gray-300',
    ds('printNoPrinters')
  );
  if (printers.length > 0) {
    settings.append(printerRow);
    if (canOpenAdvanced) settings.append(advancedButton);
  } else {
    settings.append(noPrintersMsg, refreshPrintersButton);
  }
  const twoColumns = (a: HTMLElement, b: HTMLElement) => {
    const row = el('div', 'grid grid-cols-2 gap-3');
    row.append(a, b);
    return row;
  };
  settings.append(
    twoColumns(
      field('printCopies', copiesInput),
      field('printPaper', paperSelect)
    ),
    pagesField,
    twoColumns(
      field('printOrientation', orientationSelect),
      field('printColor', colorSelect)
    ),
    field('printScale', scaleSelect),
    field('printSides', duplexSelect)
  );

  // Preview column
  const preview = el('div', 'flex min-w-0 flex-1 flex-col bg-gray-900');
  const stage = el(
    'div',
    'flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6'
  );
  const paper = el(
    'div',
    'relative flex items-center justify-center overflow-hidden shadow-lg'
  );
  paper.style.background = '#ffffff';
  paper.style.border = '1px solid rgba(0, 0, 0, 0.15)';
  stage.append(paper);
  const pager = el(
    'div',
    'flex items-center justify-center gap-3 border-t border-gray-700 px-4 py-2 text-sm text-gray-300'
  );
  const pagerButton = (icon: string, labelKey: DesktopStringKey) => {
    const button = el(
      'button',
      'rounded-md p-1.5 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent'
    );
    button.type = 'button';
    button.title = ds(labelKey);
    button.append(el('i', `ph ${icon} text-base`));
    return button;
  };
  const prevButton = pagerButton('ph-caret-left', 'printPrev');
  const nextButton = pagerButton('ph-caret-right', 'printNext');
  const pagerLabel = el('span', 'min-w-28 text-center');
  pager.append(prevButton, pagerLabel, nextButton);
  preview.append(stage, pager);

  const body = el('div', 'flex min-h-0 flex-1');
  body.append(settings, preview);

  // Footer
  const footer = el(
    'div',
    'flex items-center justify-between gap-4 border-t border-gray-700 px-6 py-3'
  );
  const systemButton = el(
    'button',
    'text-sm text-gray-400 underline-offset-2 transition-colors hover:text-white hover:underline',
    ds('printSystem')
  );
  systemButton.type = 'button';
  systemButton.title = ds('printSystemHint');
  const status = el(
    'span',
    'min-w-0 flex-1 truncate text-right text-sm text-gray-400'
  );
  const cancelButton = el(
    'button',
    'rounded-md border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white',
    ds('cancel')
  );
  cancelButton.type = 'button';
  const printButton = el(
    'button',
    'flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
  );
  printButton.type = 'button';
  printButton.append(el('i', 'ph ph-printer text-base'), ds('printDo'));
  const actions = el('div', 'flex flex-shrink-0 items-center gap-2');
  actions.append(cancelButton, printButton);
  footer.append(systemButton, status, actions);

  dialog.append(header, body, footer);

  // ------------------------------------------------------------- state
  let previewIndex = 0;
  let previewToken = 0;
  let busy = false;
  let cancelled = false;
  const pageSizes = new Map<number, PdfViewport>();

  const pageSize = async (pageNumber: number): Promise<PdfViewport> => {
    let size = pageSizes.get(pageNumber);
    if (!size) {
      const page = await pdfDocument.getPage(pageNumber);
      size = page.getViewport({ scale: 1 });
      pageSizes.set(pageNumber, size);
    }
    return size;
  };

  const selectedPages = (): number[] | null => {
    let pages: number[] | null;
    if (pagesSelect.value === 'current') pages = [source.currentPage];
    else if (pagesSelect.value === 'custom') {
      pages = parsePageRanges(rangeInput.value, total);
    } else {
      pages = Array.from({ length: total }, (_, i) => i + 1);
    }
    return pages;
  };

  const isLandscape = async (pages: number[]): Promise<boolean> => {
    if (orientationSelect.value !== 'auto') {
      return orientationSelect.value === 'landscape';
    }
    const first = await pageSize(pages[0]);
    return first.width > first.height;
  };

  const placement = async (
    pageNumber: number,
    landscape: boolean
  ): Promise<{ width: number; height: number; quarterTurn: boolean }> => {
    const { width, height } = await pageSize(pageNumber);
    const quarterTurn = width !== height && width > height !== landscape;
    return quarterTurn
      ? { width: height, height: width, quarterTurn }
      : { width, height, quarterTurn };
  };

  const paperPoints = (landscape: boolean): [number, number] => {
    const [short, long] = PAPER_POINTS[paperSelect.value as PrintPaperSize];
    return landscape ? [long, short] : [short, long];
  };

  const copies = (): number =>
    Math.min(999, Math.max(1, Math.floor(Number(copiesInput.value)) || 1));

  const syncPrinterUi = (): void => {
    const has = printers.length > 0;
    noPrintersMsg.classList.toggle('hidden', has);
    advancedButton.disabled = !canOpenAdvanced || !has || busy;
    refreshPrintersButton.disabled = busy;
    printButton.disabled = busy || !has || !selectedPages()?.length;
  };

  async function updatePreview(): Promise<void> {
    const token = ++previewToken;
    const pages = selectedPages();
    const valid = Boolean(pages && pages.length > 0);
    rangeError.classList.toggle(
      'hidden',
      valid || pagesSelect.value !== 'custom' || rangeInput.value.trim() === ''
    );
    printButton.disabled = busy || !valid || printers.length === 0;

    if (!pages || pages.length === 0) {
      paper.replaceChildren();
      pagerLabel.textContent = '';
      prevButton.disabled = nextButton.disabled = true;
      return;
    }

    previewIndex = Math.min(Math.max(previewIndex, 0), pages.length - 1);
    pagerLabel.textContent = ds('printSheet', {
      n: previewIndex + 1,
      m: pages.length,
    });
    prevButton.disabled = previewIndex === 0;
    nextButton.disabled = previewIndex === pages.length - 1;

    const pageNumber = pages[previewIndex];
    const landscape = await isLandscape(pages);
    const [paperWidth, paperHeight] = paperPoints(landscape);
    const size = await placement(pageNumber, landscape);
    const page = await pdfDocument.getPage(pageNumber);
    const rendered = await renderPage(
      source.fontDocument,
      page,
      PREVIEW_SCALE,
      size.quarterTurn
    );
    if (token !== previewToken) return;

    const available = stage.getBoundingClientRect();
    const sheetScale = Math.min(
      (available.width - 48) / paperWidth,
      (available.height - 48) / paperHeight
    );
    paper.style.width = `${paperWidth * sheetScale}px`;
    paper.style.height = `${paperHeight * sheetScale}px`;

    const pageScale =
      scaleSelect.value === 'actual'
        ? 1
        : Math.min(paperWidth / size.width, paperHeight / size.height);
    const canvas = el('canvas');
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    canvas.getContext('2d')?.drawImage(rendered, 0, 0);
    canvas.style.width = `${size.width * pageScale * sheetScale}px`;
    canvas.style.height = `${size.height * pageScale * sheetScale}px`;
    canvas.style.flexShrink = '0';
    canvas.style.filter = colorSelect.value === 'mono' ? 'grayscale(1)' : '';
    paper.replaceChildren(canvas);
  }

  function close(): void {
    cancelled = true;
    previewToken++;
    window.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    removePrintRoot();
  }

  function setBusy(value: boolean, message = ''): void {
    busy = value;
    status.textContent = message;
    status.classList.remove('text-red-500');
    for (const control of [
      printerSelect,
      copiesInput,
      pagesSelect,
      rangeInput,
      paperSelect,
      orientationSelect,
      scaleSelect,
      duplexSelect,
      colorSelect,
      systemButton,
      advancedButton,
      refreshPrintersButton,
    ]) {
      control.disabled = value;
    }
    if (!value) {
      advancedButton.disabled = !canOpenAdvanced || printers.length === 0;
      refreshPrintersButton.disabled = false;
    }
    // Keep Cancel enabled while busy so the user can abort preparation.
    cancelButton.disabled = false;
    printButton.disabled = value;
    closeButton.disabled = value;
  }

  async function pdfBytes(pages: number[]): Promise<Uint8Array | null> {
    try {
      const whole =
        (pdfDocument.annotationStorage?.size ?? 0) > 0 &&
        pdfDocument.saveDocument
          ? await pdfDocument.saveDocument()
          : pdfDocument.getData
            ? await pdfDocument.getData()
            : null;
      if (!whole) return null;
      // Copy out of the viewer frame's realm for IPC / pdf-lib.
      const local = new Uint8Array(whole);
      const all =
        pages.length === total && pages.every((p, i) => p === i + 1);
      if (all) return local;
      const { PDFDocument } = await import('pdf-lib');
      const src = await PDFDocument.load(local, { ignoreEncryption: true });
      if (src.isEncrypted) return null;
      const out = await PDFDocument.create();
      const copied = await out.copyPages(
        src,
        pages.map((p) => p - 1)
      );
      copied.forEach((page) => out.addPage(page));
      return await out.save();
    } catch (e) {
      console.warn('[Desktop] Print: could not prepare the PDF itself:', e);
      return null;
    }
  }

  async function rasterDpi(pages: number[]): Promise<number> {
    let squareInches = 0;
    for (const n of pages) {
      const v = (await pdfDocument.getPage(n)).getViewport({ scale: 1 });
      squareInches += (v.width / 72) * (v.height / 72);
    }
    if (!(squareInches > 0)) return MIN_PRINT_DPI;
    const fits = Math.sqrt(PRINT_PIXEL_BUDGET / squareInches);
    return Math.max(MIN_PRINT_DPI, Math.min(MAX_PRINT_DPI, Math.floor(fits)));
  }

  function buildRequest(
    landscape: boolean,
    extras: Partial<PrintRequest> = {}
  ): PrintRequest {
    return {
      deviceName: printerSelect.value,
      copies: copies(),
      paperSize: paperSelect.value as PrintPaperSize,
      landscape,
      duplexMode: duplexSelect.value as PrintDuplexMode,
      color: colorSelect.value === 'color',
      printableArea: scaleSelect.value === 'fit',
      collate: true,
      ...extras,
    };
  }

  function remember(): void {
    const next: SavedSettings = {
      printer: printerSelect.value,
      paper: paperSelect.value as PrintPaperSize,
      duplex: duplexSelect.value as PrintDuplexMode,
      color: colorSelect.value === 'color',
      scale: scaleSelect.value as Scale,
    };
    setStoredItem(SETTINGS_KEY, JSON.stringify(next));
  }

  async function runPrint(systemDialog: boolean): Promise<void> {
    const pages = selectedPages();
    if (busy || !pages || pages.length === 0) return;
    if (!systemDialog && printers.length === 0) return;

    cancelled = false;
    setBusy(true);
    try {
      const landscape = await isLandscape(pages);
      const fit = scaleSelect.value === 'fit';
      const request = buildRequest(landscape, { systemDialog });

      const pdf = await pdfBytes(pages);
      if (cancelled) throw new Error('cancelled');

      if (pdf) {
        status.textContent = systemDialog
          ? ds('printOpeningSystem')
          : ds('printSending');
        const vector = await bridge!.print({ ...request, pdf });
        if (cancelled) throw new Error('cancelled');
        if (vector.success) {
          remember();
          close();
          return;
        }
        if (vector.error === 'Unknown printer') {
          throw new Error(vector.error);
        }
        if (systemDialog) {
          // Cancel is not a failure and must not print the pages again.
          if (vector.error === 'Print job canceled') throw new Error('cancelled');
          throw new Error(vector.error || 'Print job failed');
        }
        console.warn(
          '[Desktop] Vector print unavailable, falling back to pictures:',
          vector.error
        );
      } else if (systemDialog) {
        // No PDF bytes: fall back to the viewer's own print of the open tab.
        close();
        source.systemPrint();
        return;
      }

      const dpi = await rasterDpi(pages);
      removePrintRoot();
      const style = el('style');
      style.id = PRINT_STYLE_ID;
      style.textContent = `
        #${PRINT_ROOT_ID} { display: none; }
        @media print {
          @page { margin: 0; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            background: #fff !important;
          }
          body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
          #${PRINT_ROOT_ID} { display: block; }
          .cit-print-page {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            break-after: page;
            break-inside: avoid;
          }
          .cit-print-page:last-child { break-after: auto; }
          .cit-print-page img { display: block; flex-shrink: 0; }
          .cit-print-page img.cit-print-fit {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
        }`;
      const root = el('div');
      root.id = PRINT_ROOT_ID;

      for (let i = 0; i < pages.length; i++) {
        if (cancelled) throw new Error('cancelled');
        status.textContent = ds('printPreparing', {
          n: i + 1,
          m: pages.length,
        });
        const page = await pdfDocument.getPage(pages[i]);
        const size = await placement(pages[i], landscape);
        const image = el('img');
        image.src = await canvasToUrl(
          await renderPage(
            source.fontDocument,
            page,
            dpi / 72,
            size.quarterTurn
          )
        );
        if (fit) {
          image.className = 'cit-print-fit';
        } else {
          image.style.width = `${size.width}pt`;
          image.style.height = `${size.height}pt`;
        }
        await image.decode();
        const sheet = el('div', 'cit-print-page');
        sheet.append(image);
        root.append(sheet);
      }
      if (cancelled) throw new Error('cancelled');
      document.head.append(style);
      document.body.append(root);

      status.textContent = ds('printSending');
      const result = await bridge!.print(request);
      if (!result.success) throw new Error(result.error || '');
      remember();
      close();
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') {
        setBusy(false, ds('printCancelled'));
        void updatePreview();
        return;
      }
      console.error('[Desktop] Print failed:', e);
      const raw = e instanceof Error && e.message ? e.message : '';
      const reason = raw ? `: ${localizePrintError(raw)}` : '';
      setBusy(false, `${ds('printFailed')}${reason}`);
      status.classList.add('text-red-500');
      void updatePreview();
    } finally {
      removePrintRoot();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (busy) {
        cancelled = true;
        status.textContent = ds('printCancelled');
      } else {
        close();
      }
    } else if (e.key === 'Enter' && !printButton.disabled && !busy) {
      e.preventDefault();
      void runPrint(false);
    }
  }

  // ------------------------------------------------------------ wiring
  const refresh = (): void => {
    void updatePreview();
  };
  pagesSelect.addEventListener('change', () => {
    rangeInput.classList.toggle('hidden', pagesSelect.value !== 'custom');
    if (pagesSelect.value === 'custom') rangeInput.focus();
    previewIndex = 0;
    refresh();
  });
  rangeInput.addEventListener('input', () => {
    previewIndex = 0;
    refresh();
  });
  for (const control of [
    paperSelect,
    orientationSelect,
    scaleSelect,
    colorSelect,
  ]) {
    control.addEventListener('change', refresh);
  }
  prevButton.addEventListener('click', () => {
    previewIndex--;
    refresh();
  });
  nextButton.addEventListener('click', () => {
    previewIndex++;
    refresh();
  });
  closeButton.addEventListener('click', () => {
    if (busy) cancelled = true;
    else close();
  });
  cancelButton.addEventListener('click', () => {
    if (busy) {
      cancelled = true;
      status.textContent = ds('printCancelled');
    } else {
      close();
    }
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !busy) close();
  });
  printButton.addEventListener('click', () => void runPrint(false));
  systemButton.addEventListener('click', () => void runPrint(true));
  refreshPrintersButton.addEventListener('click', () => {
    if (busy) return;
    void (async () => {
      refreshPrintersButton.disabled = true;
      try {
        printers = await bridge!.listPrinters();
        fillPrinterSelect(printerSelect, printers, printerSelect.value);
        if (printers.length > 0 && !settings.contains(printerRow)) {
          noPrintersMsg.replaceWith(printerRow);
          if (canOpenAdvanced) printerRow.after(advancedButton);
        }
        syncPrinterUi();
        refresh();
      } catch (e) {
        console.error('[Desktop] Refresh printers failed:', e);
      } finally {
        refreshPrintersButton.disabled = false;
      }
    })();
  });
  advancedButton.addEventListener('click', () => {
    if (busy || !canOpenAdvanced || !printerSelect.value) return;
    status.classList.remove('text-red-500');
    void bridge!
      .openPrinterPreferences!(printerSelect.value)
      .then((ok) => {
        if (!ok) {
          status.textContent = ds('printAdvancedFailed');
          status.classList.add('text-red-500');
        }
      })
      .catch((e) => {
        console.error('[Desktop] Open printer preferences failed:', e);
        status.textContent = ds('printAdvancedFailed');
        status.classList.add('text-red-500');
      });
  });
  window.addEventListener('keydown', onKeydown, true);

  document.body.append(overlay);
  syncPrinterUi();
  await updatePreview();
}
