// PDF viewer page: shows one PDF in the embedded PDF.js viewer, read-only.
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
  VIEWER_TOOLS_EVENT,
  type ViewerToolsDetail,
} from './view-pdf-events.js';

interface ViewerOptions {
  set(name: string, value: unknown): void;
}

interface ViewerWindow extends Window {
  PDFViewerApplicationOptions?: ViewerOptions;
  PDFViewerApplication?: {
    pdfDocument?: PrintSource['pdfDocument'] | null;
    page?: number;
  };
}

let blobUrl: string | null = null;
let currentFile: File | null = null;

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function releaseBlob() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
}

function closeViewer() {
  releaseBlob();
  currentFile = null;
  document.getElementById('pdf-viewer-container')?.replaceChildren();
  document.getElementById('viewer-panel')?.classList.add('hidden');
  document.getElementById('uploader')?.classList.remove('hidden');
  const fileInput = document.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
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

function openFile(file: File) {
  if (!isPdf(file)) {
    showAlert(t('alert.title'), t('tools:viewPdf.invalidFile'));
    return;
  }

  const container = document.getElementById('pdf-viewer-container');
  if (!container) return;

  releaseBlob();
  currentFile = file;
  blobUrl = URL.createObjectURL(file);

  const iframe = document.createElement('iframe');
  iframe.className = 'h-full w-full border-0';
  iframe.title = file.name;
  iframe.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodeURIComponent(blobUrl)}`;
  iframe.addEventListener('load', () => {
    if (__DESKTOP__) installDesktopPrint(iframe);
    void applyViewerChrome(iframe, {
      fileName: file.name,
      closeLabel: t('tools:viewPdf.close'),
      twoPagesLabel: t('tools:viewPdf.twoPages'),
      onClose: closeViewer,
      tools: __DESKTOP__
        ? {
            label: t('tools:viewPdf.tools'),
            onClick: () => {
              if (!currentFile) return;
              document.dispatchEvent(
                new CustomEvent<ViewerToolsDetail>(VIEWER_TOOLS_EVENT, {
                  detail: { file: currentFile },
                })
              );
            },
          }
        : undefined,
    });
  });
  container.replaceChildren(iframe);

  document.getElementById('uploader')?.classList.add('hidden');
  document.getElementById('viewer-panel')?.classList.remove('hidden');
}

// The viewer announces itself on the parent document before it reads its
// options, which is the only point where editing can be switched off.
document.addEventListener('webviewerloaded', (event) => {
  const source = (event as CustomEvent<{ source: ViewerWindow }>).detail
    ?.source;
  const options = source?.PDFViewerApplicationOptions;
  if (!options) return;
  options.set('disablePreferences', true);
  options.set('annotationEditorMode', -1);
  // Without this PDF.js follows the OS language, not the app's.
  options.set('localeProperties', { lang: pdfjsLocale(getLanguageFromUrl()) });
});

// Follow the app's light/dark switch while a file is open.
document.addEventListener(THEME_EVENT, () => {
  const doc = document.querySelector<HTMLIFrameElement>(
    '#pdf-viewer-container iframe'
  )?.contentDocument;
  if (doc) applyViewerTheme(doc);
});

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const dropZone = document.getElementById('drop-zone');

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) openFile(file);
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

  // Ctrl+P while focus is outside the viewer frame.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'p') return;
    const iframe = document.querySelector<HTMLIFrameElement>(
      '#pdf-viewer-container iframe'
    );
    if (!iframe?.contentWindow) return;
    e.preventDefault();
    iframe.contentWindow.print();
  });

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
});

window.addEventListener('beforeunload', releaseBlob);
