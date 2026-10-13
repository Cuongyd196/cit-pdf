/**
 * Reshapes the embedded PDF.js viewer into the CIT-PDF look: app colours and
 * light/dark mode, the app language, and a single toolbar that also carries
 * the file name, Tools and Close. PDF.js itself is left untouched; this only
 * moves its existing controls and adds a few of ours around them.
 */
import themeCss from '../../css/pdfjs-theme.css?raw';

interface ViewerEventBus {
  on(name: string, listener: (event: { mode?: number }) => void): void;
}

interface ViewerApp {
  initializedPromise?: Promise<void>;
  eventBus?: ViewerEventBus;
  pdfViewer?: { currentScaleValue: string };
}

type ViewerWindow = Window & { PDFViewerApplication?: ViewerApp };

export interface ViewerChromeOptions {
  fileName: string;
  closeLabel: string;
  twoPagesLabel: string;
  onClose: () => void;
}

// PDF.js ships its own translations; pick the closest one to the app language.
const PDFJS_LOCALES: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  sv: 'sv-SE',
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
};

export function pdfjsLocale(appLanguage: string): string {
  return PDFJS_LOCALES[appLanguage] ?? appLanguage;
}

// SpreadMode.NONE in PDF.js: one page at a time.
const SPREAD_NONE = 0;

const ICONS = {
  twoPages:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216 48H40a16 16 0 0 0-16 16v128a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V64a16 16 0 0 0-16-16ZM40 64h80v128H40Zm176 128h-80V64h80v128Z"/></svg>',
  close:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M205.66 194.34a8 8 0 0 1-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 0 1-11.32-11.32L116.69 128 50.34 61.66a8 8 0 0 1 11.32-11.32L128 116.69l66.34-66.35a8 8 0 0 1 11.32 11.32L139.31 128Z"/></svg>',
};

function button(
  doc: Document,
  icon: keyof typeof ICONS,
  label: string,
  showLabel: boolean
): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = 'cit-button';
  el.title = label;
  el.setAttribute('aria-label', label);
  // The icons are fixed markup defined above, never user data.
  el.innerHTML = ICONS[icon]; // eslint-disable-line no-unsanitized/property
  if (showLabel) {
    const text = doc.createElement('span');
    text.className = 'cit-label';
    text.textContent = label;
    el.append(text);
  }
  return el;
}

function separator(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.className = 'verticalToolbarSeparator cit-hide-medium';
  return el;
}

/** Copies the app's Inter @font-face rules so the frame can use the font. */
function sharedFontFaces(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(cssRules)) {
      if (rule instanceof CSSFontFaceRule && /Inter/.test(rule.cssText)) {
        rules.push(rule.cssText);
      }
    }
  }
  return rules.join('\n');
}

/** Light or dark, following the app. */
export function applyViewerTheme(doc: Document): void {
  const light = document.documentElement.dataset.theme === 'light';
  doc.documentElement.style.colorScheme = light ? 'light' : 'dark';
}

function moveToToolbar(doc: Document, id: string, into: HTMLElement): void {
  const el = doc.getElementById(id);
  if (!el) return;
  el.classList.remove('labeled');
  el.classList.add('cit-icon-only');
  into.append(el);
}

function addSpreadToggle(
  doc: Document,
  app: ViewerApp,
  into: HTMLElement,
  label: string
): void {
  const toggle = button(doc, 'twoPages', label, false);
  toggle.setAttribute('aria-pressed', 'false');
  // Drive PDF.js's own menu buttons so its state and preferences stay in sync.
  toggle.addEventListener('click', () => {
    const pressed = toggle.getAttribute('aria-pressed') === 'true';
    doc.getElementById(pressed ? 'spreadNone' : 'spreadOdd')?.click();
  });
  app.eventBus?.on('spreadmodechanged', (event) => {
    const twoPages = event.mode !== undefined && event.mode !== SPREAD_NONE;
    toggle.setAttribute('aria-pressed', String(twoPages));
  });
  into.append(toggle);
}

const FITTED_SCALES = new Set(['auto', 'page-width', 'page-fit']);

/**
 * PDF.js refits "auto"/"page width" zoom on window resize but not when its
 * own sidebar opens or closes, which leaves the page wider than the view.
 * Refit whenever the page area changes width.
 */
function keepPageFitted(doc: Document, app: ViewerApp): void {
  const container = doc.getElementById('viewerContainer');
  if (!container || typeof ResizeObserver === 'undefined') return;
  let width = container.clientWidth;
  new ResizeObserver(() => {
    if (container.clientWidth === width) return;
    width = container.clientWidth;
    const viewer = app.pdfViewer;
    if (viewer && FITTED_SCALES.has(viewer.currentScaleValue)) {
      viewer.currentScaleValue = viewer.currentScaleValue;
    }
  }).observe(container);
}

/** Apply the CIT-PDF look and toolbar to a loaded viewer frame. */
export async function applyViewerChrome(
  iframe: HTMLIFrameElement,
  options: ViewerChromeOptions
): Promise<void> {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow as ViewerWindow | null;
  if (!doc || !win) return;

  const style = doc.createElement('style');
  style.textContent = `${sharedFontFaces()}\n${themeCss}`;
  doc.head.append(style);
  applyViewerTheme(doc);

  const app = win.PDFViewerApplication;
  await app?.initializedPromise;

  if (app) keepPageFitted(doc, app);

  const left = doc.getElementById('toolbarViewerLeft');
  const right = doc.getElementById('toolbarViewerRight');
  if (!left || !right) return;

  // File name, after the search button.
  const name = doc.createElement('span');
  name.className = 'cit-file-name';
  name.textContent = options.fileName;
  name.title = options.fileName;
  name.setAttribute('data-no-translate', '');
  const find = doc.getElementById('viewFindButton')?.parentElement;
  if (find) find.after(name);
  else left.append(name);

  // View controls, at the start of the right-hand group.
  const view = doc.createElement('div');
  view.className = 'cit-group cit-hide-medium';
  moveToToolbar(doc, 'pageRotateCcw', view);
  moveToToolbar(doc, 'pageRotateCw', view);
  if (app) addSpreadToggle(doc, app, view, options.twoPagesLabel);
  moveToToolbar(doc, 'presentationMode', view);
  right.prepend(view, separator(doc));

  // Close, after the ⋯ menu.
  const actions = doc.createElement('div');
  actions.className = 'cit-group';
  const close = button(doc, 'close', options.closeLabel, false);
  close.addEventListener('click', options.onClose);
  actions.append(close);
  right.append(separator(doc), actions);
}
