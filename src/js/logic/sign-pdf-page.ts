import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import {
  readFileAsArrayBuffer,
  formatBytes,
  downloadFile,
} from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { getLanguageFromUrl, t } from '../i18n/i18n';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import { flattenAnnotations } from '../utils/flatten-annotations.js';
import { pdfjsLocale } from './pdf-viewer-chrome.js';
import {
  drawSignImages,
  prepareSignImage,
  type PreparedSignImage,
  type SignImagePlacement,
} from './sign-images.js';
import type { SignState, PDFViewerWindow } from '@/types';

interface ViewerOptions {
  set(name: string, value: unknown): void;
}

// The viewer announces itself on this document before it reads its options:
// the moment to give it the app's language, or it follows the OS.
document.addEventListener('webviewerloaded', (event) => {
  const source = (
    event as CustomEvent<{
      source: Window & { PDFViewerApplicationOptions?: ViewerOptions };
    }>
  ).detail?.source;
  source?.PDFViewerApplicationOptions?.set('localeProperties', {
    lang: pdfjsLocale(getLanguageFromUrl()),
  });
});

/** A colour signature or stamp placed on a page (see sign-images.ts). */
interface PlacedImage extends Omit<SignImagePlacement, 'png'> {
  image: PreparedSignImage;
  element: HTMLElement | null;
}

const placedImages: PlacedImage[] = [];
// A new image starts this wide, as a share of the page width.
const NEW_IMAGE_WIDTH = 0.28;

const OVERLAY_CSS = `
.cit-sign-layer { position: absolute; inset: 0; z-index: 100; pointer-events: none; }
.cit-sign-image { position: absolute; pointer-events: auto; cursor: move; touch-action: none; outline: 1px dashed rgba(13, 148, 136, 0.9); }
.cit-sign-image img { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; }
.cit-sign-image .cit-sign-resize { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border-radius: 3px; background: #0d9488; border: 2px solid #fff; cursor: nwse-resize; }
.cit-sign-image .cit-sign-delete { position: absolute; right: -11px; top: -11px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: #dc2626; color: #fff; font: 600 14px/22px sans-serif; text-align: center; padding: 0; cursor: pointer; }
`;

const signState: SignState = {
  file: null,
  pdfDoc: null,
  viewerIframe: null,
  viewerReady: false,
  blobUrl: null,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

function initializePage() {
  createIcons({ icons });

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');

  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        handleFile(droppedFiles[0]);
      }
    });

    // Clear value on click to allow re-selecting the same file
    fileInput?.addEventListener('click', () => {
      if (fileInput) fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', applyAndSaveSignatures);
  }

  const imageInput = document.getElementById(
    'sign-image-input'
  ) as HTMLInputElement | null;
  document.getElementById('sign-image-btn')?.addEventListener('click', () => {
    imageInput?.click();
  });
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    imageInput.value = '';
    if (file) void insertSignImage(file);
  });

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    cleanup();
    window.location.href = import.meta.env.BASE_URL;
  });
}

function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    handleFile(input.files[0]);
  }
}

function handleFile(file: File) {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    showAlert('Invalid File', 'Please select a PDF file.');
    return;
  }

  signState.file = file;
  updateFileDisplay();
  setupSignTool();
}

async function updateFileDisplay() {
  const fileDisplayArea = document.getElementById('file-display-area');

  if (!fileDisplayArea || !signState.file) return;

  fileDisplayArea.innerHTML = '';

  const fileDiv = document.createElement('div');
  fileDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = signState.file.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = `${formatBytes(signState.file.size)} • ${t('common.loadingPageCount')}`;

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
  removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
  removeBtn.onclick = () => {
    signState.file = null;
    signState.pdfDoc = null;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
  };

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });

  const result = await loadPdfWithPasswordPrompt(signState.file);
  if (!result) {
    signState.file = null;
    signState.pdfDoc = null;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
    return;
  }
  signState.file = result.file;
  nameSpan.textContent = result.file.name;
  metaSpan.textContent = `${formatBytes(result.file.size)} • ${result.pdf.numPages} pages`;
  result.pdf.destroy();
}

async function setupSignTool() {
  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.remove('hidden');
  }

  showLoader('Loading PDF viewer...');

  const container = document.getElementById('canvas-container-sign');
  if (!container) {
    console.error('Sign tool canvas container not found');
    hideLoader();
    return;
  }

  if (!signState.file) {
    console.error('No file loaded for signing');
    hideLoader();
    return;
  }

  container.textContent = '';
  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  container.appendChild(iframe);
  signState.viewerIframe = iframe;

  const pdfBytes = await readFileAsArrayBuffer(signState.file);
  const blob = new Blob([new Uint8Array(pdfBytes as ArrayBuffer)], {
    type: 'application/pdf',
  });
  signState.blobUrl = URL.createObjectURL(blob);

  try {
    const existingPrefsRaw = localStorage.getItem('pdfjs.preferences');
    const existingPrefs: Record<string, unknown> = existingPrefsRaw
      ? JSON.parse(existingPrefsRaw)
      : {};
    delete existingPrefs.annotationEditorMode;
    const newPrefs = {
      ...existingPrefs,
      enableSignatureEditor: true,
      enablePermissions: false,
    };
    localStorage.setItem('pdfjs.preferences', JSON.stringify(newPrefs));
  } catch (e) {
    console.warn('Failed to update pdfjs.preferences in localStorage', e);
  }

  const viewerUrl = new URL(
    `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html`,
    window.location.origin
  );
  const query = new URLSearchParams({ file: signState.blobUrl });
  iframe.src = `${viewerUrl.toString()}?${query.toString()}`;

  iframe.onload = () => {
    hideLoader();
    signState.viewerReady = true;
    try {
      const viewerWindow = iframe.contentWindow as PDFViewerWindow | null;
      if (viewerWindow && viewerWindow.PDFViewerApplication) {
        const app = viewerWindow.PDFViewerApplication;
        const doc = viewerWindow.document;
        const eventBus = app.eventBus;
        const style = doc.createElement('style');
        style.textContent = OVERLAY_CSS;
        doc.head.append(style);
        // PDF.js clears a page's own nodes when it redraws it.
        eventBus?._on('pagerendered', () => {
          for (const item of placedImages) showPlacedImage(item);
        });
        eventBus?._on('annotationeditoruimanager', () => {
          const editorModeButtons = doc.getElementById('editorModeButtons');
          editorModeButtons?.classList.remove('hidden');
          const editorSignature = doc.getElementById('editorSignature');
          editorSignature?.removeAttribute('hidden');
          const editorSignatureButton = doc.getElementById(
            'editorSignatureButton'
          ) as HTMLButtonElement | null;
          if (editorSignatureButton) {
            editorSignatureButton.disabled = false;
          }
          // PDF.js's image editor fails when saving; images go through
          // "Insert signature or stamp" above the viewer instead.
          doc.getElementById('editorStamp')?.setAttribute('hidden', '');
          try {
            const highlightBtn = doc.getElementById(
              'editorHighlightButton'
            ) as HTMLButtonElement | null;
            highlightBtn?.click();
          } catch (e) {
            console.warn(
              'Failed to auto-click highlight button in PDF viewer',
              e
            );
          }
        });
      }
    } catch (e) {
      console.error('Could not initialize PDF.js viewer for signing:', e);
    }

    const saveBtn = document.getElementById(
      'process-btn'
    ) as HTMLButtonElement | null;
    if (saveBtn) {
      saveBtn.style.display = '';
    }
  };
}

async function applyAndSaveSignatures() {
  if (!signState.viewerReady || !signState.viewerIframe) {
    showAlert('Viewer not ready', 'Please wait for the PDF viewer to load.');
    return;
  }

  try {
    const viewerWindow = signState.viewerIframe
      .contentWindow as PDFViewerWindow | null;
    if (!viewerWindow || !viewerWindow.PDFViewerApplication) {
      showAlert('Viewer not ready', 'The PDF viewer is still initializing.');
      return;
    }

    const app = viewerWindow.PDFViewerApplication;
    const flattenCheckbox = document.getElementById(
      'flatten-signature-toggle'
    ) as HTMLInputElement | null;
    const shouldFlatten = flattenCheckbox?.checked;

    showLoader(
      shouldFlatten ? 'Flattening and saving PDF...' : 'Saving signed PDF...'
    );
    const rawPdfBytes = await app.pdfDocument.saveDocument(
      app.pdfDocument.annotationStorage
    );
    const pdfBytes = await drawSignImages(
      new Uint8Array(rawPdfBytes),
      placedImages.map((item) => ({
        pageIndex: item.pageIndex,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        png: item.image.png,
      }))
    );

    if (shouldFlatten) {
      const pdfDoc = await loadPdfDocument(pdfBytes);
      try {
        pdfDoc.getForm().flatten();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('getForm')) {
          throw e;
        }
      }
      try {
        flattenAnnotations(pdfDoc);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Could not flatten annotations:', msg);
      }
      const flattenedPdfBytes = await pdfDoc.save();

      const blob = new Blob([new Uint8Array(flattenedPdfBytes)], {
        type: 'application/pdf',
      });
      downloadFile(blob, signState.file?.name || 'document.pdf');

      hideLoader();
      showAlert('Success', 'Signed PDF saved successfully!', 'success', () => {
        resetState();
      });
    } else {
      downloadFile(
        new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
        signState.file?.name || 'document.pdf'
      );
      hideLoader();
      showAlert(
        'Success',
        'Signed PDF downloaded successfully!',
        'success',
        () => {
          resetState();
        }
      );
    }
  } catch (error) {
    console.error('Failed to export the signed PDF:', error);
    hideLoader();
    showAlert(
      'Export failed',
      'Could not export the signed PDF. Please try again.'
    );
  }
}

function resetState() {
  cleanup();
  signState.file = null;
  signState.viewerIframe = null;
  signState.viewerReady = false;

  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.add('hidden');
  }

  const container = document.getElementById('canvas-container-sign');
  if (container) {
    container.textContent = '';
  }

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) {
    fileDisplayArea.innerHTML = '';
  }

  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  if (processBtn) {
    processBtn.style.display = 'none';
  }

  const flattenCheckbox = document.getElementById(
    'flatten-signature-toggle'
  ) as HTMLInputElement | null;
  if (flattenCheckbox) {
    flattenCheckbox.checked = false;
  }
}

function cleanup() {
  if (signState.blobUrl) {
    URL.revokeObjectURL(signState.blobUrl);
    signState.blobUrl = null;
  }
  for (const item of placedImages.splice(0)) {
    item.element?.remove();
    URL.revokeObjectURL(item.image.url);
  }
}

function viewerParts() {
  const win = signState.viewerIframe?.contentWindow as
    | (PDFViewerWindow & {
        PDFViewerApplication?: { page?: number };
      })
    | null;
  const doc = signState.viewerIframe?.contentDocument;
  return win && doc ? { win, doc } : null;
}

function pageElement(doc: Document, pageIndex: number): HTMLElement | null {
  return doc.querySelector<HTMLElement>(
    `.page[data-page-number="${pageIndex + 1}"]`
  );
}

/** Puts an image on its page (again, after PDF.js redrew the page). */
function showPlacedImage(item: PlacedImage): void {
  const parts = viewerParts();
  if (!parts) return;
  const page = pageElement(parts.doc, item.pageIndex);
  if (!page) return;
  let layer = page.querySelector<HTMLElement>(':scope > .cit-sign-layer');
  if (!layer) {
    layer = parts.doc.createElement('div');
    layer.className = 'cit-sign-layer';
    page.append(layer);
  }
  if (!item.element) item.element = buildPlacedImage(parts.doc, item);
  if (item.element.parentElement !== layer) layer.append(item.element);
  Object.assign(item.element.style, {
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: `${item.width * 100}%`,
    height: `${item.height * 100}%`,
  });
}

function buildPlacedImage(doc: Document, item: PlacedImage): HTMLElement {
  const box = doc.createElement('div');
  box.className = 'cit-sign-image';
  const img = doc.createElement('img');
  img.src = item.image.url;
  img.alt = '';
  const resize = doc.createElement('span');
  resize.className = 'cit-sign-resize';
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'cit-sign-delete';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    box.remove();
    placedImages.splice(placedImages.indexOf(item), 1);
    URL.revokeObjectURL(item.image.url);
  });
  box.append(img, resize, remove);

  // Drag to move, drag the corner to resize (keeping the proportions).
  box.addEventListener('pointerdown', (event) => {
    if (event.target === remove) return;
    event.preventDefault();
    event.stopPropagation();
    const page = box.closest<HTMLElement>('.page');
    if (!page) return;
    const resizing = event.target === resize;
    const start = { x: event.clientX, y: event.clientY };
    const from = { ...item };
    const pageWidth = page.clientWidth;
    const pageHeight = page.clientHeight;
    const ratio = item.image.width / item.image.height;
    box.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / pageWidth;
      const dy = (e.clientY - start.y) / pageHeight;
      if (resizing) {
        item.width = Math.min(1 - item.x, Math.max(0.03, from.width + dx));
        item.height = (item.width * pageWidth) / ratio / pageHeight;
      } else {
        item.x = Math.min(1 - item.width, Math.max(0, from.x + dx));
        item.y = Math.min(1 - item.height, Math.max(0, from.y + dy));
      }
      showPlacedImage(item);
    };
    const end = () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', end);
      box.removeEventListener('pointercancel', end);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  });
  return box;
}

/** "Insert signature or stamp": a picture, kept in colour. */
async function insertSignImage(file: File): Promise<void> {
  const parts = viewerParts();
  if (!parts) return;
  const removeWhite =
    (
      document.getElementById(
        'sign-image-clear-white'
      ) as HTMLInputElement | null
    )?.checked ?? true;
  let image: PreparedSignImage;
  try {
    image = await prepareSignImage(file, removeWhite);
  } catch (e) {
    console.error('Could not read the image:', e);
    showAlert('Invalid File', 'Please choose a PNG or JPG image.');
    return;
  }
  const pageIndex = Math.max(
    0,
    (parts.win.PDFViewerApplication?.page ?? 1) - 1
  );
  const page = pageElement(parts.doc, pageIndex);
  const pageRatio = page ? page.clientWidth / page.clientHeight : 0.7;
  const width = NEW_IMAGE_WIDTH;
  const height = (width * pageRatio * image.height) / image.width;
  const item: PlacedImage = {
    pageIndex,
    x: (1 - width) / 2,
    y: Math.max(0, (1 - height) / 2),
    width,
    height: Math.min(height, 1),
    image,
    element: null,
  };
  placedImages.push(item);
  showPlacedImage(item);
}
