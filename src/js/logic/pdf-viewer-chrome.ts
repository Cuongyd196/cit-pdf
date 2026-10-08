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
  /** Desktop only: hand the open file to another tool. */
  tools?: { label: string; onClick: () => void };
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
  tools:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M226.76 69a8 8 0 0 0-12.84-2.88l-40.3 37.19-17.23-3.7-3.7-17.23 37.19-40.3A8 8 0 0 0 187 29.24 72 72 0 0 0 88 96a72.34 72.34 0 0 0 6 28.94L33.79 177c-.15.12-.29.26-.43.39a32 32 0 0 0 45.26 45.26c.13-.13.27-.28.39-.42L131.06 162A72 72 0 0 0 232 96a71.56 71.56 0 0 0-5.24-27ZM160 152a56.14 56.14 0 0 1-27.07-7 8 8 0 0 0-9.92 1.77L67.11 211.51a16 16 0 0 1-22.62-22.62L109.18 133a8 8 0 0 0 1.77-9.93 56 56 0 0 1 58.36-82.31l-31.2 33.81a8 8 0 0 0-1.94 7.1l5.66 26.33a8 8 0 0 0 6.14 6.14l26.35 5.66a8 8 0 0 0 7.1-1.94l33.81-31.2A56.06 56.06 0 0 1 160 152Z"/></svg>',
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

  // App actions, after the ⋯ menu.
  const actions = doc.createElement('div');
  actions.className = 'cit-group';
  if (options.tools) {
    const tools = button(doc, 'tools', options.tools.label, true);
    tools.classList.add('cit-primary');
    tools.addEventListener('click', options.tools.onClick);
    actions.append(tools);
  }
  const close = button(doc, 'close', options.closeLabel, false);
  close.addEventListener('click', options.onClose);
  actions.append(close);
  right.append(separator(doc), actions);
}
