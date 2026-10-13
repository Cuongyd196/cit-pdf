// PDF viewer page: shows PDFs in the embedded PDF.js viewer, read-only, one
// tab per document.
import { showAlert } from '../ui.js';
import { getLanguageFromUrl, t } from '../i18n/i18n.js';
import { getBridge } from '../desktop/bridge.js';
import { THEME_EVENT } from '../desktop/theme.js';
import type { PrintSource } from '../desktop/print-dialog.js';
import {
  applyViewerChrome,
  applyViewerTheme,
  pdfjsLocale,
} from './pdf-viewer-chrome.js';
import {
  VIEWER_SELECT_EVENT,
  VIEWER_TABS_EVENT,
  type ViewerSelectDetail,
  type ViewerTabsDetail,
} from './view-pdf-events.js';

interface ViewerOptions {
  set(name: string, value: unknown): void;
}

interface ViewerWindow extends Window {
  PDFViewerApplicationOptions?: ViewerOptions;
  PDFViewerApplication?: {
    pdfDocument?:
      | (PrintSource['pdfDocument'] & { fingerprints?: Array<string | null> })
      | null;
    page?: number;
  };
}

interface ViewHistoryEntry {
  fingerprint?: string;
}

interface ViewerTab {
  file: File;
  blobUrl: string;
  iframe: HTMLIFrameElement;
}

const tabs: ViewerTab[] = [];
let activeTab: ViewerTab | null = null;

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function getFileInput(): HTMLInputElement | null {
  return document.getElementById('file-input') as HTMLInputElement | null;
}

/** Tells the desktop shell which documents are open and which one shows. */
function announceTabs() {
  document.dispatchEvent(
    new CustomEvent<ViewerTabsDetail>(VIEWER_TABS_EVENT, {
      detail: {
        files: tabs.map((tab) => tab.file),
        active: activeTab ? tabs.indexOf(activeTab) : -1,
      },
    })
  );
}

function renderTabs() {
  const strip = document.getElementById('viewer-tabs');
  if (!strip) return;

  const items = tabs.map((tab) => {
    const item = document.createElement('div');
    item.className = 'pdf-view-tab' + (tab === activeTab ? ' active' : '');
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(tab === activeTab));
    item.title = tab.file.name;
    item.dataset.noTranslate = '';

    const name = document.createElement('span');
    name.className = 'truncate';
    name.textContent = tab.file.name;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pdf-view-tab-close';
    close.title = t('tools:viewPdf.close');
    close.setAttribute('aria-label', close.title);
    close.innerHTML = '<i class="ph ph-x"></i>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab);
    });

    item.append(name, close);
    item.addEventListener('click', () => selectTab(tab));
    // Middle click closes, as in a browser.
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab);
    });
    return item;
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'pdf-view-tab-add';
  add.title = t('tools:viewPdf.openAnother');
  add.setAttribute('aria-label', add.title);
  add.innerHTML = '<i class="ph ph-plus"></i>';
  add.addEventListener('click', () => getFileInput()?.click());

  strip.replaceChildren(...items, add);
  strip.querySelector('.pdf-view-tab.active')?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });
}

function selectTab(tab: ViewerTab) {
  activeTab = tab;
  for (const other of tabs) {
    other.iframe.classList.toggle('pdf-view-frame-hidden', other !== tab);
  }
  renderTabs();
  announceTabs();
}

function closeTab(tab: ViewerTab) {
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  tabs.splice(index, 1);
  tab.iframe.remove();
  URL.revokeObjectURL(tab.blobUrl);

  if (tabs.length > 0) {
    // Closing the visible tab shows its neighbour.
    selectTab(
      tab === activeTab
        ? tabs[Math.min(index, tabs.length - 1)]
        : (activeTab ?? tabs[0])
    );
    return;
  }

  activeTab = null;
  document.getElementById('viewer-panel')?.classList.add('hidden');
  document.getElementById('uploader')?.classList.remove('hidden');
  const fileInput = getFileInput();
  if (fileInput) fileInput.value = '';
  announceTabs();
}

/**
 * Desktop: route the viewer's print button and Ctrl+P to the app's own print
 * dialog, since the system dialog cannot show a preview for Electron.
 */
function installDesktopPrint(iframe: HTMLIFrameElement) {
  const viewer = iframe.contentWindow as ViewerWindow | null;
  if (!viewer || typeof getBridge()?.print !== 'function') return;

  const systemPrint = viewer.print.bind(viewer);
  viewer.print = () => {
    const app = viewer.PDFViewerApplication;
    const pdfDocument = app?.pdfDocument;
    const fontDocument = iframe.contentDocument;
    if (!pdfDocument || !fontDocument) return;
    void import('../desktop/print-dialog.js').then(({ openPrintDialog }) =>
      openPrintDialog({
        pdfDocument,
        fontDocument,
        currentPage: app.page ?? 1,
        systemPrint,
      })
    );
  };
}

/**
 * Tab shortcuts, as in a browser: Ctrl+Tab and Ctrl+Shift+Tab step through
 * the documents, Ctrl+W closes the one on screen. Listens on the page and on
 * every viewer frame, since the frame usually has the focus.
 */
function onTabShortcut(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || !activeTab) return;
  if (e.key === 'Tab') {
    if (tabs.length < 2) return;
    e.preventDefault();
    const step = e.shiftKey ? tabs.length - 1 : 1;
    selectTab(tabs[(tabs.indexOf(activeTab) + step) % tabs.length]);
  } else if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
    e.preventDefault();
    closeTab(activeTab);
  } else {
    return;
  }
  // Keep the keyboard on the document now showing. Not in this same turn:
  // the frame that had the focus may just have been removed, and focus
  // moved right then is lost.
  window.setTimeout(() => activeTab?.iframe.contentWindow?.focus());
}

const VIEW_HISTORY_KEY = 'pdfjs.history';
const VIEW_HISTORY_MAX = 50;

/**
 * PDF.js remembers the page and zoom of each document, which is what brings
 * a reader back to where they stopped. But every viewer frame holds its own
 * copy of the whole list and writes all of it back, wiping what the other
 * tabs saved in the meantime. Let a frame save only its own document's entry.
 */
function isolateViewHistory(viewer: ViewerWindow) {
  const storage = viewer.localStorage;
  const proto = Object.getPrototypeOf(storage) as Storage;
  const setItem = proto.setItem;
  proto.setItem = function (key: string, value: string) {
    const merged =
      this === storage && key === VIEW_HISTORY_KEY
        ? mergeViewHistory(viewer, value)
        : value;
    setItem.call(this, key, merged);
  };
}

function mergeViewHistory(viewer: ViewerWindow, value: string): string {
  try {
    const fingerprint =
      viewer.PDFViewerApplication?.pdfDocument?.fingerprints?.[0];
    const stored = JSON.parse(
      viewer.localStorage.getItem(VIEW_HISTORY_KEY) || '{}'
    ) as { files?: ViewHistoryEntry[] };
    const files = Array.isArray(stored.files) ? stored.files : [];
    const own = (
      JSON.parse(value) as { files?: ViewHistoryEntry[] }
    ).files?.find((file) => file.fingerprint === fingerprint);
    if (!fingerprint || !own)
      return files.length > 0 ? JSON.stringify(stored) : value;
    const others = files.filter((file) => file.fingerprint !== fingerprint);
    return JSON.stringify({
      files: [...others, own].slice(-VIEW_HISTORY_MAX),
    });
  } catch {
    return value;
  }
}

/** Opens a file in a tab of its own and shows it. */
function openFile(file: File) {
  if (!isPdf(file)) {
    showAlert(t('alert.title'), t('tools:viewPdf.invalidFile'));
    return;
  }

  const container = document.getElementById('pdf-viewer-container');
  if (!container) return;

  const blobUrl = URL.createObjectURL(file);
  const iframe = document.createElement('iframe');
  iframe.className = 'pdf-view-frame';
  iframe.title = file.name;
  iframe.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodeURIComponent(blobUrl)}`;
  const tab: ViewerTab = { file, blobUrl, iframe };

  iframe.addEventListener('load', () => {
    if (__DESKTOP__) installDesktopPrint(iframe);
    iframe.contentWindow?.addEventListener('keydown', onTabShortcut, true);
    void applyViewerChrome(iframe, {
      fileName: file.name,
      closeLabel: t('tools:viewPdf.close'),
      twoPagesLabel: t('tools:viewPdf.twoPages'),
      onClose: () => closeTab(tab),
    });
  });

  tabs.push(tab);
  container.append(iframe);
  document.getElementById('uploader')?.classList.add('hidden');
  document.getElementById('viewer-panel')?.classList.remove('hidden');
  selectTab(tab);
}

// The viewer announces itself on the parent document before it reads its
// options, which is the only point where editing can be switched off.
document.addEventListener('webviewerloaded', (event) => {
  const source = (event as CustomEvent<{ source: ViewerWindow }>).detail
    ?.source;
  const options = source?.PDFViewerApplicationOptions;
  if (!options) return;
  isolateViewHistory(source);
  options.set('disablePreferences', true);
  options.set('annotationEditorMode', -1);
  // Without this PDF.js follows the OS language, not the app's.
  options.set('localeProperties', { lang: pdfjsLocale(getLanguageFromUrl()) });
});

// Follow the app's light/dark switch while files are open.
document.addEventListener(THEME_EVENT, () => {
  for (const tab of tabs) {
    const doc = tab.iframe.contentDocument;
    if (doc) applyViewerTheme(doc);
  }
});

// The desktop shell asks for a tab by position, e.g. when the user opens a
// file that is already in one.
document.addEventListener(VIEWER_SELECT_EVENT, (event) => {
  const tab = tabs[(event as CustomEvent<ViewerSelectDetail>).detail.index];
  if (tab) selectTab(tab);
});

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = getFileInput();
  const dropZone = document.getElementById('drop-zone');

  fileInput?.addEventListener('change', () => {
    for (const file of Array.from(fileInput.files ?? [])) openFile(file);
  });

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500');
  });

  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500');
    const files = e.dataTransfer?.files;
    if (!fileInput || !files?.length) return;
    // Go through the input so every load takes the same path.
    fileInput.files = files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  window.addEventListener('keydown', onTabShortcut);

  // Ctrl+P while focus is outside the viewer frame.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'p') return;
    if (!activeTab?.iframe.contentWindow) return;
    e.preventDefault();
    activeTab.iframe.contentWindow.print();
  });

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
});

window.addEventListener('beforeunload', () => {
  for (const tab of tabs) URL.revokeObjectURL(tab.blobUrl);
});
