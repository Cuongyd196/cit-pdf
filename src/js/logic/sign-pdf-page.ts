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
import {
  deleteSavedSignImage,
  listSavedSignImages,
  saveSignImage,
  type SavedSignImage,
} from './sign-library.js';
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
.cit-sign-image { position: absolute; pointer-events: auto; cursor: move; touch-action: none; }
.cit-sign-image.selected { outline: 1px dashed rgba(13, 148, 136, 0.9); }
.cit-sign-image:not(.selected) .cit-sign-resize, .cit-sign-image:not(.selected) .cit-sign-delete { display: none; }
.cit-sign-image img { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; }
.cit-sign-image .cit-sign-resize { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border-radius: 3px; background: #0d9488; border: 2px solid #fff; cursor: nwse-resize; }
.cit-sign-image .cit-sign-delete { position: absolute; right: -11px; top: -11px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: #dc2626; color: #fff; font: 600 14px/22px sans-serif; text-align: center; padding: 0; cursor: pointer; }
.cit-dialog-preview { position: absolute; inset: 12px; width: calc(100% - 24px); height: calc(100% - 24px); object-fit: contain; pointer-events: none; }
.cit-saved-sign .toolbarAddSignatureButton > img { display: inline-block; height: 100%; aspect-ratio: 1; object-fit: contain; flex: none; padding: 4px; box-sizing: border-box; border-radius: 4px; background-color: var(--signature-bg); }
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
        routeSignatureImages(doc);
        routeViewerSave(viewerWindow, doc);
        trackSelection(doc);
        void renderSavedSignImages(doc);
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
        PDFViewerApplication?: {
          page?: number;
          l10n?: { translate(element: Element): Promise<void> };
        };
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
    removePlacedImage(item);
  });
  box.append(img, resize, remove);

  // Drag to move, drag the corner to resize (keeping the proportions).
  box.addEventListener('pointerdown', (event) => {
    if (event.target === remove) return;
    event.preventDefault();
    event.stopPropagation();
    selectPlacedImage(item);
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

/**
 * PDF.js's "Add signature" dialog turns a picture from its Image tab into a
 * one-colour outline. Here a picture picked or dropped there is shown in
 * colour in the dialog instead; "Add" places it like "Insert signature or
 * stamp" does and, with "Save signature" ticked, keeps it in the saved list.
 */
function routeSignatureImages(doc: Document): void {
  let pending: PreparedSignImage | null = null;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    doc.getElementById(id) as T | null;
  const imageTabOpen = () =>
    byId('addSignatureImageButton')?.getAttribute('aria-selected') === 'true';
  const showPlaceholder = (show: boolean) => {
    const placeholder = byId('addSignatureImagePlaceholder');
    if (placeholder) placeholder.hidden = !show;
  };
  const enableControls = () => {
    for (const id of [
      'addSignatureAddButton',
      'clearSignatureButton',
      'addSignatureDescInput',
      'addSignatureSaveCheckbox',
    ]) {
      const control = byId<HTMLButtonElement>(id);
      if (control) control.disabled = false;
    }
  };
  const dropPending = (revoke: boolean) => {
    if (pending && revoke) URL.revokeObjectURL(pending.url);
    pending = null;
    doc.querySelector('.cit-dialog-preview')?.remove();
    showPlaceholder(true);
  };
  const take = async (file: File | undefined, e: Event): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    byId('addSignatureDialog')?.classList.remove('waiting');
    let image: PreparedSignImage;
    try {
      image = await prepareSignImage(file, removeWhiteChecked());
    } catch (error) {
      console.error('Could not read the image:', error);
      showAlert('Invalid File', 'Please choose a PNG or JPG image.');
      return;
    }
    dropPending(true);
    pending = image;
    const preview = doc.createElement('img');
    preview.className = 'cit-dialog-preview';
    preview.src = image.url;
    preview.alt = '';
    byId('addSignatureImageContainer')?.append(preview);
    showPlaceholder(false);
    const description = byId<HTMLInputElement>('addSignatureDescInput');
    if (description && !description.value) {
      description.value = file.name.replace(/\.[^.]+$/, '');
    }
    enableControls();
  };
  doc.addEventListener(
    'change',
    (e) => {
      const input = e.target as HTMLInputElement;
      if (input.id !== 'addSignatureFilePicker') return;
      void take(input.files?.[0], e);
      input.value = '';
    },
    true
  );
  doc.addEventListener(
    'drop',
    (e) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('#addSignatureImageContainer')) return;
      const file = [...(e.dataTransfer?.files ?? [])].find((f) =>
        f.type.startsWith('image/')
      );
      void take(file, e);
    },
    true
  );
  doc.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!pending || !target?.closest) return;
      if (target.closest('#addSignatureAddButton') && imageTabOpen()) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const image = pending;
        const name =
          byId<HTMLInputElement>('addSignatureDescInput')?.value.trim() || '';
        const save = byId<HTMLInputElement>('addSignatureSaveCheckbox');
        const keep = !!save?.checked && !save.disabled;
        dropPending(false);
        byId<HTMLButtonElement>('addSignatureCancelButton')?.click();
        if (keep) {
          const fallback =
            getLanguageFromUrl() === 'vi' ? 'Chữ ký' : 'Signature';
          void keepSignImage(doc, name || fallback, image);
        }
        placeSignImage(image);
      } else if (target.closest('#clearSignatureButton') && imageTabOpen()) {
        dropPending(true);
      } else if (target.closest('#addSignatureImageButton')) {
        // PDF.js greys the buttons out again when the tab is shown.
        setTimeout(() => {
          if (!pending) return;
          showPlaceholder(false);
          enableControls();
        }, 0);
      }
    },
    true
  );
  byId('addSignatureDialog')?.addEventListener('close', () =>
    dropPending(true)
  );
}

/** Keeps a picture in the saved list and shows it there. */
async function keepSignImage(
  doc: Document,
  name: string,
  image: PreparedSignImage
): Promise<void> {
  try {
    if (!(await saveSignImage(name, image))) {
      showAlert(
        'Saved list is full',
        'Delete a saved signature or stamp image to keep a new one.'
      );
      return;
    }
  } catch (e) {
    console.error('Could not save the signature image:', e);
    return;
  }
  await renderSavedSignImages(doc);
}

/**
 * Saved pictures, in PDF.js's saved-signature menu after its own entries,
 * in the same row style: the picture, its name, a delete button.
 */
async function renderSavedSignImages(doc: Document): Promise<void> {
  const addButton = doc.getElementById('editorSignatureAddSignature');
  if (!addButton) return;
  let saved: SavedSignImage[] = [];
  try {
    saved = await listSavedSignImages();
  } catch (e) {
    console.warn('Could not read the saved signature images:', e);
  }
  for (const old of doc.querySelectorAll('.cit-saved-sign')) {
    const thumb = old.querySelector('img');
    if (thumb) URL.revokeObjectURL(thumb.src);
    old.remove();
  }
  for (const item of saved) {
    const row = doc.createElement('div');
    row.className = 'toolbarAddSignatureButtonContainer cit-saved-sign';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'toolbarAddSignatureButton';
    button.setAttribute(
      'data-l10n-id',
      'pdfjs-editor-add-saved-signature-button'
    );
    button.setAttribute(
      'data-l10n-args',
      JSON.stringify({ description: item.name })
    );
    const thumb = doc.createElement('img');
    thumb.src = URL.createObjectURL(
      new Blob([new Uint8Array(item.png)], { type: 'image/png' })
    );
    thumb.alt = '';
    const label = doc.createElement('span');
    label.ariaHidden = 'true';
    label.textContent = item.name;
    button.append(thumb, label);
    button.addEventListener('click', () => {
      placeSignImage({
        png: item.png,
        width: item.width,
        height: item.height,
        url: URL.createObjectURL(
          new Blob([new Uint8Array(item.png)], { type: 'image/png' })
        ),
      });
      // Leaves signature mode, which closes this menu, as PDF.js does once
      // one of its own saved signatures is on the page.
      viewerParts()?.win.PDFViewerApplication?.eventBus?.dispatch(
        'switchannotationeditormode',
        { source: null, mode: 0 }
      );
    });
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'toolbarButton deleteButton';
    remove.setAttribute(
      'data-l10n-id',
      'pdfjs-editor-delete-signature-button1'
    );
    const removeLabel = doc.createElement('span');
    removeLabel.setAttribute(
      'data-l10n-id',
      'pdfjs-editor-delete-signature-button-label1'
    );
    remove.append(removeLabel);
    remove.addEventListener('click', async () => {
      try {
        await deleteSavedSignImage(item.id);
      } catch (e) {
        console.error('Could not delete the saved signature image:', e);
        return;
      }
      URL.revokeObjectURL(thumb.src);
      row.remove();
    });
    row.append(button, remove);
    addButton.before(row);
    void viewerParts()?.win.PDFViewerApplication?.l10n?.translate(row);
  }
}

/** Only the picture last touched shows its frame, resize and delete. */
function selectPlacedImage(item: PlacedImage | null): void {
  for (const other of placedImages) {
    other.element?.classList.toggle('selected', other === item);
  }
}

function removePlacedImage(item: PlacedImage): void {
  item.element?.remove();
  const index = placedImages.indexOf(item);
  if (index >= 0) placedImages.splice(index, 1);
  URL.revokeObjectURL(item.image.url);
}

/**
 * A click anywhere else in the viewer deselects, like PDF.js's own editors;
 * Delete or Backspace removes the selected picture.
 */
function trackSelection(doc: Document): void {
  doc.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('.cit-sign-image')) selectPlacedImage(null);
    },
    true
  );
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const selected = placedImages.find((item) =>
      item.element?.classList.contains('selected')
    );
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    removePlacedImage(selected);
  });
}

/**
 * The viewer's own download button and Ctrl+S save only what PDF.js drew,
 * without the pictures the page placed. Both go through the tool's save.
 * Printing from the viewer would leave the pictures out too, so it waits
 * until they are saved into a file.
 */
function routeViewerSave(win: Window, doc: Document): void {
  const save = (e: Event): void => {
    e.stopImmediatePropagation();
    e.preventDefault();
    void applyAndSaveSignatures();
  };
  const print = (e: Event): void => {
    if (!placedImages.length) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    showAlert(
      'Save first',
      'Inserted signature and stamp images are only in the saved file. Save the PDF, then print the saved file.'
    );
  };
  doc.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (target?.closest?.('#downloadButton, #secondaryDownload')) save(e);
      else if (target?.closest?.('#printButton, #secondaryPrint')) print(e);
    },
    true
  );
  win.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') save(e);
      else if (key === 'p') print(e);
    },
    true
  );
}

function removeWhiteChecked(): boolean {
  return (
    (
      document.getElementById(
        'sign-image-clear-white'
      ) as HTMLInputElement | null
    )?.checked ?? true
  );
}

/** "Insert signature or stamp": a picture, kept in colour. */
async function insertSignImage(file: File): Promise<void> {
  let image: PreparedSignImage;
  try {
    image = await prepareSignImage(file, removeWhiteChecked());
  } catch (e) {
    console.error('Could not read the image:', e);
    showAlert('Invalid File', 'Please choose a PNG or JPG image.');
    return;
  }
  placeSignImage(image);
}

/** Puts a prepared picture on the page being read, centred and selected. */
function placeSignImage(image: PreparedSignImage): void {
  const parts = viewerParts();
  if (!parts) {
    URL.revokeObjectURL(image.url);
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
  selectPlacedImage(item);
}
