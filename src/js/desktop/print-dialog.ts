/**
 * Desktop print dialog. Electron has no print preview and the Windows system
 * dialog cannot show one for it, so the app brings its own: settings on the
 * left, a preview of each sheet on the right, and a silent print through the
 * main process.
 *
 * Pages are rasterised into a print-only container in this document; the main
 * process then prints the window, where print CSS hides everything else.
 */
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import {
  getBridge,
  type PrintDuplexMode,
  type PrintPaperSize,
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
  /** The print path the dialog replaces, kept as a way out. */
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

const PRINT_DPI = 200;
const PREVIEW_SCALE = 1.5;
// Keeps very large pages (posters, plans) from exhausting canvas memory.
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
  const printerSelect = select(
    printers.map((printer): [string, string] => [
      printer.name,
      printer.isDefault
        ? `${printer.displayName} (${ds('printDefault')})`
        : printer.displayName,
    ]),
    ''
  );
  const preferred =
    printers.find((printer) => printer.name === saved.printer) ??
    printers.find((printer) => printer.isDefault) ??
    printers[0];
  if (preferred) printerSelect.value = preferred.name;

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
    saved.paper && saved.paper in PAPER_POINTS ? saved.paper : 'A4'
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
  if (printers.length > 0) {
    settings.append(field('printPrinter', printerSelect));
  } else {
    settings.append(
      el(
        'p',
        'rounded-md bg-gray-900 px-3 py-2 text-sm text-gray-300',
        ds('printNoPrinters')
      )
    );
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
  // Literal white: the light theme remaps the white color token.
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
  // Natural size of each page in points, for layout decisions.
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
    if (pagesSelect.value === 'current') return [source.currentPage];
    if (pagesSelect.value === 'custom') {
      return parsePageRanges(rangeInput.value, total);
    }
    return Array.from({ length: total }, (_, i) => i + 1);
  };

  const isLandscape = async (pages: number[]): Promise<boolean> => {
    if (orientationSelect.value !== 'auto') {
      return orientationSelect.value === 'landscape';
    }
    const first = await pageSize(pages[0]);
    return first.width > first.height;
  };

  // A page lying the other way from the paper is turned to match it, so a
  // landscape table in a portrait document still fills its sheet.
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

    // Fit the sheet into the stage, then place the page on it the way the
    // print layout will.
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
    // Copy onto a canvas of this document for display.
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
    previewToken++;
    window.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
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
    ]) {
      control.disabled = value;
    }
    printButton.disabled = value;
  }

  async function print(): Promise<void> {
    const pages = selectedPages();
    if (busy || !pages || pages.length === 0 || printers.length === 0) return;

    setBusy(true);
    try {
      const landscape = await isLandscape(pages);
      const fit = scaleSelect.value === 'fit';

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
            PRINT_DPI / 72,
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
      document.head.append(style);
      document.body.append(root);

      status.textContent = ds('printSending');
      const result = await bridge!.print({
        deviceName: printerSelect.value,
        copies: copies(),
        paperSize: paperSelect.value as PrintPaperSize,
        landscape,
        duplexMode: duplexSelect.value as PrintDuplexMode,
        color: colorSelect.value === 'color',
        printableArea: fit,
      });
      if (!result.success) throw new Error(result.error || '');

      const next: SavedSettings = {
        printer: printerSelect.value,
        paper: paperSelect.value as PrintPaperSize,
        duplex: duplexSelect.value as PrintDuplexMode,
        color: colorSelect.value === 'color',
        scale: scaleSelect.value as Scale,
      };
      setStoredItem(SETTINGS_KEY, JSON.stringify(next));
      close();
    } catch (e) {
      console.error('[Desktop] Print failed:', e);
      const reason = e instanceof Error && e.message ? `: ${e.message}` : '';
      setBusy(false, `${ds('printFailed')}${reason}`);
      status.classList.add('text-red-500');
      void updatePreview();
    } finally {
      removePrintRoot();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && !printButton.disabled) {
      e.preventDefault();
      void print();
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
  closeButton.addEventListener('click', () => !busy && close());
  cancelButton.addEventListener('click', () => !busy && close());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !busy) close();
  });
  printButton.addEventListener('click', () => void print());
  systemButton.addEventListener('click', () => {
    close();
    source.systemPrint();
  });
  window.addEventListener('keydown', onKeydown, true);

  document.body.append(overlay);
  await updatePreview();
}
