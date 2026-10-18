import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, formatBytes } from '../utils/helpers.js';
import { t } from '../i18n/index.js';
import { state } from '../state.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import {
  renderPagesProgressively,
  cleanupLazyRendering,
} from '../utils/render-utils.js';
import { initPagePreview } from '../utils/page-preview.js';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import {
  showWasmRequiredDialog,
  WasmProvider,
} from '../utils/wasm-provider.js';

import { createIcons, icons } from 'lucide';
import * as pdfjsLib from 'pdfjs-dist';
import Sortable from 'sortablejs';
import type { MergeJob, MergeFile, MergeMessage, MergeResponse } from '@/types';
import '../utils/setup-pdf-worker.js';

interface MergeState {
  pdfDocs: Record<string, pdfjsLib.PDFDocumentProxy>;
  pdfBytes: Record<string, ArrayBuffer>;
  activeMode: 'file' | 'page';
  sortableInstances: {
    fileList?: Sortable;
    pageThumbnails?: Sortable;
  };
  isRendering: boolean;
  cachedThumbnails: boolean | null;
  lastFileHash: string | null;
  mergeSuccess: boolean;
}

const mergeState: MergeState = {
  pdfDocs: {},
  pdfBytes: {},
  activeMode: 'file',
  sortableInstances: {},
  isRendering: false,
  cachedThumbnails: null,
  lastFileHash: null,
  mergeSuccess: false,
};

const mergeWorker = new Worker(
  import.meta.env.BASE_URL + 'workers/merge.worker.js'
);

function initializeFileListSortable() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;

  if (mergeState.sortableInstances.fileList) {
    mergeState.sortableInstances.fileList.destroy();
  }

  mergeState.sortableInstances.fileList = Sortable.create(fileList, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '0.5';
    },
    onEnd: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '1';
      renumberFileList();
    },
  });
}

/**
 * A page range as typed, in the merge engine's (cpdf) words: Vietnamese
 * "cuối", "lẻ", "chẵn" become "end", "odd", "even"; long dashes and ";"
 * become "-" and ",".
 */
function normalizeRange(range: string): string {
  return range
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/;/g, ',')
    .replace(/cuối/g, 'end')
    .replace(/lẻ/g, 'odd')
    .replace(/chẵn/g, 'even')
    .replace(/\s+/g, '')
    .replace(/,+$/, '');
}

/** Pages a range like "1-3, 5" takes from a file, or null if it is not one. */
function countRangePages(range: string, total: number): number | null {
  const pages = new Set<number>();
  for (const piece of normalizeRange(range).split(',')) {
    if (!piece) continue;
    if (piece === 'odd' || piece === 'even') {
      for (let page = piece === 'odd' ? 1 : 2; page <= total; page += 2)
        pages.add(page);
      continue;
    }
    const match = /^(\d+|end)(?:-(\d+|end))?$/.exec(piece);
    if (!match) return null;
    const at = (word: string) => (word === 'end' ? total : Number(word));
    const from = at(match[1]);
    const to = match[2] ? at(match[2]) : from;
    if (from < 1 || to < from || to > total) return null;
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return pages.size || null;
}

/** Numbers the rows in their current order and updates the totals. */
function renumberFileList() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;
  const rows = Array.from(fileList.children) as HTMLElement[];
  rows.forEach((row, i) => {
    const number = row.querySelector('.merge-row-number');
    if (number) number.textContent = String(i + 1);
    row.querySelector<HTMLButtonElement>('.merge-up')!.disabled = i === 0;
    row.querySelector<HTMLButtonElement>('.merge-down')!.disabled =
      i === rows.length - 1;
  });
  updateMergeSummary();
}

/** "3 files · 10 pages", above the list and on the merge button. */
function updateMergeSummary() {
  const files = state.files.length;
  let pages = 0;
  let invalid = false;
  for (const [key, doc] of Object.entries(mergeState.pdfDocs)) {
    const total = doc.numPages;
    if (mergeState.activeMode === 'page') {
      pages += total;
      continue;
    }
    const safe = key.replace(/[^a-zA-Z0-9]/g, '_');
    const input = document.getElementById(
      `range-${safe}`
    ) as HTMLInputElement | null;
    const range = input?.value.trim() ?? '';
    const counted = range ? countRangePages(range, total) : total;
    if (counted === null) invalid = true;
    input?.classList.toggle('invalid', counted === null);
    const error = input
      ?.closest('.merge-row')
      ?.querySelector<HTMLElement>('.merge-row-error');
    if (error) {
      error.textContent =
        counted === null ? t('tools:mergePdf.rangeInvalid', { total }) : '';
      error.hidden = counted === null ? false : true;
    }
    pages += counted ?? 0;
  }
  const summary = document.getElementById('merge-summary');
  if (summary) {
    summary.textContent = files
      ? t('tools:mergePdf.summary', { files, pages })
      : '';
  }
  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  if (processBtn && files) {
    processBtn.textContent = t('tools:mergePdf.mergeButton', { files, pages });
    // A range the engine would not understand would quietly take the
    // whole file: no merge until it is fixed.
    processBtn.disabled = invalid;
    processBtn.title = invalid ? t('tools:mergePdf.rangeFixFirst') : '';
  }
}

/** state.files in the order the list shows, so a rebuild keeps it. */
function syncFileOrderFromList() {
  const fileList = document.getElementById('file-list');
  if (!fileList || fileList.children.length !== state.files.length) return;
  const byKey = new Map(
    (state.files as File[]).map((f, i) => [`${i}_${f.name}`, f])
  );
  const ordered = Array.from(fileList.children)
    .map((li) => byKey.get((li as HTMLElement).dataset.fileName ?? ''))
    .filter((f): f is File => Boolean(f));
  if (ordered.length === state.files.length) state.files = ordered;
}

/** First page, small, beside the file's name. */
async function renderRowThumbnail(
  doc: pdfjsLib.PDFDocumentProxy,
  canvas: HTMLCanvasElement
) {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 96 / base.height });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (context)
      await page.render({ canvasContext: context, viewport, canvas }).promise;
  } catch (e) {
    console.warn('[Merge] No thumbnail:', e);
  }
}

function initializePageThumbnailsSortable() {
  const container = document.getElementById('page-merge-preview');
  if (!container) return;

  if (mergeState.sortableInstances.pageThumbnails) {
    mergeState.sortableInstances.pageThumbnails.destroy();
  }

  mergeState.sortableInstances.pageThumbnails = Sortable.create(container, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '0.5';
    },
    onEnd: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '1';
    },
  });
}

function generateFileHash() {
  return (state.files as File[])
    .map((f) => `${f.name}-${f.size}-${f.lastModified}`)
    .join('|');
}

async function renderPageMergeThumbnails() {
  const container = document.getElementById('page-merge-preview');
  if (!container) return;

  const currentFileHash = generateFileHash();
  const filesChanged = currentFileHash !== mergeState.lastFileHash;

  if (!filesChanged && mergeState.cachedThumbnails !== null) {
    // Simple check to see if it's already rendered to avoid flicker.
    if (container.firstChild) {
      initializePageThumbnailsSortable();
      return;
    }
  }

  if (mergeState.isRendering) {
    return;
  }

  mergeState.isRendering = true;
  container.textContent = '';

  cleanupLazyRendering();

  let totalPages = 0;
  for (let i = 0; i < state.files.length; i++) {
    const fileKey = `${i}_${state.files[i].name}`;
    const doc = mergeState.pdfDocs[fileKey];
    if (doc) totalPages += doc.numPages;
  }

  try {
    let currentPageNumber = 0;

    // Function to create wrapper element for each page
    const createWrapper = (
      canvas: HTMLCanvasElement,
      pageNumber: number,
      fileKey: string,
      displayName: string
    ) => {
      const wrapper = document.createElement('div');
      wrapper.className =
        'page-thumbnail relative cursor-move flex flex-col items-center gap-1 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors';
      wrapper.dataset.fileName = fileKey;
      wrapper.dataset.pageIndex = (pageNumber - 1).toString();

      const imgContainer = document.createElement('div');
      imgContainer.className = 'relative';

      const img = document.createElement('img');
      img.src = canvas.toDataURL();
      img.className = 'rounded-md shadow-md max-w-full h-auto';

      const pageNumDiv = document.createElement('div');
      pageNumDiv.className =
        'absolute top-1 left-1 bg-indigo-600 text-white text-xs px-2 py-1 rounded-md font-semibold shadow-lg';
      pageNumDiv.textContent = pageNumber.toString();

      imgContainer.append(img, pageNumDiv);

      const fileNamePara = document.createElement('p');
      fileNamePara.className =
        'text-xs text-gray-400 truncate w-full text-center';
      const fullTitle = displayName
        ? `${displayName} (page ${pageNumber})`
        : `Page ${pageNumber}`;
      fileNamePara.title = fullTitle;
      fileNamePara.textContent = displayName
        ? `${displayName.substring(0, 10)}... (p${pageNumber})`
        : `Page ${pageNumber}`;

      wrapper.append(imgContainer, fileNamePara);
      return wrapper;
    };

    for (let idx = 0; idx < state.files.length; idx++) {
      const file = state.files[idx];
      const fileKey = `${idx}_${file.name}`;
      const pdfjsDoc = mergeState.pdfDocs[fileKey];
      if (!pdfjsDoc) continue;

      const createWrapperWithFileName = (
        canvas: HTMLCanvasElement,
        pageNumber: number
      ) => {
        return createWrapper(canvas, pageNumber, fileKey, file.name);
      };

      // Render pages progressively with lazy loading
      await renderPagesProgressively(
        pdfjsDoc,
        container,
        createWrapperWithFileName,
        {
          batchSize: 8,
          useLazyLoading: true,
          lazyLoadMargin: '300px',
          onProgress: () => {
            currentPageNumber++;
            showLoader(`Rendering page previews...`);
          },
          onBatchComplete: () => {
            createIcons({ icons });
          },
        }
      );

      initPagePreview(container, pdfjsDoc);
    }

    mergeState.cachedThumbnails = true;
    mergeState.lastFileHash = currentFileHash;

    initializePageThumbnailsSortable();
  } catch (error) {
    console.error('Error rendering page thumbnails:', error);
    showAlert('Error', 'Failed to render page thumbnails');
  } finally {
    hideLoader();
    mergeState.isRendering = false;
  }
}

const updateUI = async () => {
  const fileControls = document.getElementById('file-controls');
  const mergeOptions = document.getElementById('merge-options');

  if (state.files.length > 0) {
    if (fileControls) fileControls.classList.remove('hidden');
    if (mergeOptions) mergeOptions.classList.remove('hidden');
    await refreshMergeUI();
  } else {
    if (fileControls) fileControls.classList.add('hidden');
    if (mergeOptions) mergeOptions.classList.add('hidden');
    // Clear file list UI
    const fileList = document.getElementById('file-list');
    if (fileList) fileList.innerHTML = '';
  }
};

const resetState = async () => {
  state.files = [];
  state.pdfDoc = null;

  mergeState.pdfDocs = {};
  mergeState.pdfBytes = {};
  mergeState.activeMode = 'file';
  mergeState.cachedThumbnails = null;
  mergeState.lastFileHash = null;
  mergeState.mergeSuccess = false;

  const fileList = document.getElementById('file-list');
  if (fileList) fileList.innerHTML = '';

  const pageMergePreview = document.getElementById('page-merge-preview');
  if (pageMergePreview) pageMergePreview.innerHTML = '';

  const fileModeBtn = document.getElementById('file-mode-btn');
  const pageModeBtn = document.getElementById('page-mode-btn');
  const filePanel = document.getElementById('file-mode-panel');
  const pagePanel = document.getElementById('page-mode-panel');

  if (fileModeBtn && pageModeBtn && filePanel && pagePanel) {
    fileModeBtn.classList.add('bg-indigo-600', 'text-white');
    fileModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    pageModeBtn.classList.remove('bg-indigo-600', 'text-white');
    pageModeBtn.classList.add('bg-gray-700', 'text-gray-300');

    filePanel.classList.remove('hidden');
    pagePanel.classList.add('hidden');
  }

  await updateUI();
};

export async function merge() {
  // Check if CPDF is configured
  if (!isCpdfAvailable()) {
    showWasmRequiredDialog('cpdf');
    return;
  }

  showLoader('Merging PDFs...');
  try {
    const jobs: MergeJob[] = [];
    const filesToMerge: MergeFile[] = [];
    const uniqueFileNames = new Set<string>();

    if (mergeState.activeMode === 'file') {
      const fileList = document.getElementById('file-list');
      if (!fileList) throw new Error('File list not found');

      const sortedFileKeys = Array.from(fileList.children)
        .map((li) => (li as HTMLElement).dataset.fileName)
        .filter((key): key is string => !!key);

      for (const fileKey of sortedFileKeys) {
        const safeFileName = fileKey.replace(/[^a-zA-Z0-9]/g, '_');
        const rangeInput = document.getElementById(
          `range-${safeFileName}`
        ) as HTMLInputElement;

        uniqueFileNames.add(fileKey);

        if (rangeInput && rangeInput.value.trim()) {
          if (rangeInput.classList.contains('invalid')) {
            hideLoader();
            showAlert('Error', t('tools:mergePdf.rangeFixFirst'));
            return;
          }
          jobs.push({
            fileName: fileKey,
            rangeType: 'specific',
            rangeString: normalizeRange(rangeInput.value),
          });
        } else {
          jobs.push({
            fileName: fileKey,
            rangeType: 'all',
          });
        }
      }
    } else {
      // Page Mode
      const pageContainer = document.getElementById('page-merge-preview');
      if (!pageContainer) throw new Error('Page container not found');
      const pageElements = Array.from(pageContainer.children);

      const rawPages: { fileName: string; pageIndex: number }[] = [];
      for (const el of pageElements) {
        const element = el as HTMLElement;
        const fileName = element.dataset.fileName;
        const pageIndex = parseInt(element.dataset.pageIndex || '', 10); // 0-based index from dataset

        if (fileName && !isNaN(pageIndex)) {
          uniqueFileNames.add(fileName);
          rawPages.push({ fileName, pageIndex });
        }
      }

      // Group contiguous pages
      for (let i = 0; i < rawPages.length; i++) {
        const current = rawPages[i];
        let endPage = current.pageIndex;

        while (
          i + 1 < rawPages.length &&
          rawPages[i + 1].fileName === current.fileName &&
          rawPages[i + 1].pageIndex === endPage + 1
        ) {
          endPage++;
          i++;
        }

        if (endPage === current.pageIndex) {
          // Single page
          jobs.push({
            fileName: current.fileName,
            rangeType: 'single',
            pageIndex: current.pageIndex,
          });
        } else {
          // Range of pages
          jobs.push({
            fileName: current.fileName,
            rangeType: 'range',
            startPage: current.pageIndex + 1,
            endPage: endPage + 1,
          });
        }
      }
    }

    if (jobs.length === 0) {
      showAlert('Error', 'No files or pages selected to merge.');
      hideLoader();
      return;
    }

    for (const name of uniqueFileNames) {
      const bytes = mergeState.pdfBytes[name];
      if (bytes) {
        filesToMerge.push({ name, data: bytes });
      }
    }

    const retainCheckbox = document.getElementById(
      'retain-page-labels'
    ) as HTMLInputElement | null;

    const removeDuplicateFontsCheckbox = document.getElementById(
      'remove-duplicate-fonts'
    ) as HTMLInputElement | null;

    const message: MergeMessage = {
      command: 'merge',
      files: filesToMerge,
      jobs: jobs,
      cpdfUrl: WasmProvider.getUrl('cpdf')! + 'coherentpdf.browser.min.js',
      retainPageLabels: retainCheckbox?.checked ?? false,
      removeDuplicateFonts: removeDuplicateFontsCheckbox?.checked ?? false,
    };

    mergeWorker.postMessage(
      message,
      filesToMerge.map((f) => f.data)
    );

    mergeWorker.onmessage = (e: MessageEvent<MergeResponse>) => {
      hideLoader();
      if (e.data.status === 'success') {
        const blob = new Blob([e.data.pdfBytes], { type: 'application/pdf' });
        downloadFile(blob, 'merged.pdf');
        mergeState.mergeSuccess = true;
        showAlert(
          'Success',
          'PDFs merged successfully!',
          'success',
          async () => {
            await resetState();
          }
        );
      } else {
        console.error('Worker merge error:', e.data.message);
        showAlert('Error', e.data.message || 'Failed to merge PDFs.');
      }
    };

    mergeWorker.onerror = (e) => {
      hideLoader();
      console.error('Worker error:', e);
      showAlert('Error', 'An unexpected error occurred in the merge worker.');
    };
  } catch (e) {
    console.error('Merge error:', e);
    showAlert(
      'Error',
      'Failed to merge PDFs. Please check that all files are valid and not password-protected.'
    );
    hideLoader();
  }
}

/** One file in the list: number, first page, name, pages and size, range. */
function fileRow(f: File, index: number): HTMLLIElement {
  const fileKey = `${index}_${f.name}`;
  const doc = mergeState.pdfDocs[fileKey];
  const safeFileName = fileKey.replace(/[^a-zA-Z0-9]/g, '_');

  const li = document.createElement('li');
  li.className = 'merge-row';
  li.dataset.fileName = fileKey;
  li.dataset.added = String(index);

  const number = document.createElement('span');
  number.className = 'merge-row-number';

  const thumb = document.createElement('canvas');
  thumb.className = 'merge-row-thumb';
  if (doc) void renderRowThumbnail(doc, thumb);

  const info = document.createElement('div');
  info.className = 'merge-row-info';
  const name = document.createElement('span');
  name.className = 'merge-row-name';
  name.title = f.name;
  name.textContent = f.name;
  const meta = document.createElement('span');
  meta.className = 'merge-row-meta';
  meta.textContent = `${doc ? t('tools:mergePdf.pageCount', { count: doc.numPages }) : '?'} · ${formatBytes(f.size)}`;
  const error = document.createElement('span');
  error.className = 'merge-row-error';
  error.hidden = true;
  info.append(name, meta, error);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = `range-${safeFileName}`;
  input.className = 'merge-row-range';
  input.placeholder = t('tools:mergePdf.allPages');
  input.title = t('tools:mergePdf.rangeTip');
  input.addEventListener('input', updateMergeSummary);

  const button = (cls: string, iconName: string, title: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `merge-row-btn ${cls}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    const i = document.createElement('i');
    i.className = `ph ph-${iconName}`;
    b.append(i);
    return b;
  };
  const up = button('merge-up', 'arrow-up', t('tools:mergePdf.moveUp'));
  const down = button('merge-down', 'arrow-down', t('tools:mergePdf.moveDown'));
  const remove = button('merge-remove', 'x', t('tools:mergePdf.removeFile'));
  up.addEventListener('click', () => {
    li.previousElementSibling?.before(li);
    renumberFileList();
  });
  down.addEventListener('click', () => {
    li.nextElementSibling?.after(li);
    renumberFileList();
  });
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    syncFileOrderFromList();
    state.files = state.files.filter((file) => file !== f);
    updateUI();
  });

  const handle = document.createElement('span');
  handle.className = 'drag-handle merge-row-handle';
  const grip = document.createElement('i');
  grip.className = 'ph ph-dots-six-vertical';
  handle.append(grip);

  li.append(number, thumb, info, input, up, down, remove, handle);
  return li;
}

export async function refreshMergeUI() {
  document.getElementById('merge-options')?.classList.remove('hidden');
  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement;
  if (processBtn) processBtn.disabled = false;

  const wasInPageMode = mergeState.activeMode === 'page';

  showLoader('Loading PDF documents...');
  try {
    mergeState.pdfDocs = {};
    mergeState.pdfBytes = {};

    hideLoader();
    state.files = await batchDecryptIfNeeded(state.files);
    showLoader('Loading PDF documents...');

    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      const fileKey = `${i}_${file.name}`;

      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      mergeState.pdfBytes[fileKey] = bytes;
      mergeState.pdfDocs[fileKey] = pdf;
    }

    if (state.files.length === 0) {
      hideLoader();
      return;
    }
  } catch (error) {
    console.error('Error loading PDFs:', error);
    showAlert('Error', 'Failed to load one or more PDF files');
    return;
  } finally {
    hideLoader();
  }

  const fileModeBtn = document.getElementById('file-mode-btn');
  const pageModeBtn = document.getElementById('page-mode-btn');
  const filePanel = document.getElementById('file-mode-panel');
  const pagePanel = document.getElementById('page-mode-panel');
  const fileList = document.getElementById('file-list');

  if (!fileModeBtn || !pageModeBtn || !filePanel || !pagePanel || !fileList)
    return;

  fileList.textContent = ''; // Clear list safely
  (state.files as File[]).forEach((f, index) => {
    fileList.appendChild(fileRow(f, index));
  });
  renumberFileList();
  const sort = document.getElementById(
    'merge-sort'
  ) as HTMLSelectElement | null;
  if (sort) sort.value = 'added';

  createIcons({ icons });
  initializeFileListSortable();

  const newFileModeBtn = fileModeBtn.cloneNode(true) as HTMLElement;
  const newPageModeBtn = pageModeBtn.cloneNode(true) as HTMLElement;
  fileModeBtn.replaceWith(newFileModeBtn);
  pageModeBtn.replaceWith(newPageModeBtn);

  newFileModeBtn.addEventListener('click', () => {
    if (mergeState.activeMode === 'file') return;

    mergeState.activeMode = 'file';
    filePanel.classList.remove('hidden');
    pagePanel.classList.add('hidden');

    newFileModeBtn.classList.add('bg-indigo-600', 'text-white');
    newFileModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    newPageModeBtn.classList.remove('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.add('bg-gray-700', 'text-gray-300');
    updateMergeSummary();
  });

  newPageModeBtn.addEventListener('click', async () => {
    if (mergeState.activeMode === 'page') return;

    mergeState.activeMode = 'page';
    filePanel.classList.add('hidden');
    pagePanel.classList.remove('hidden');

    newPageModeBtn.classList.add('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    newFileModeBtn.classList.remove('bg-indigo-600', 'text-white');
    newFileModeBtn.classList.add('bg-gray-700', 'text-gray-300');
    updateMergeSummary();

    await renderPageMergeThumbnails();
  });

  if (wasInPageMode) {
    mergeState.activeMode = 'page';
    filePanel.classList.add('hidden');
    pagePanel.classList.remove('hidden');

    newPageModeBtn.classList.add('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    newFileModeBtn.classList.remove('bg-indigo-600', 'text-white');
    newFileModeBtn.classList.add('bg-gray-700', 'text-gray-300');

    await renderPageMergeThumbnails();
  } else {
    newFileModeBtn.classList.add('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.add('bg-gray-700', 'text-gray-300');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');

  const fileControls = document.getElementById('file-controls');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const backBtn = document.getElementById('back-to-tools');
  const mergeOptions = document.getElementById('merge-options');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        syncFileOrderFromList();
        state.files = [...state.files, ...Array.from(files)];
        await updateUI();
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const pdfFiles = Array.from(files).filter(
          (f) =>
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
        );
        if (pdfFiles.length > 0) {
          syncFileOrderFromList();
          state.files = [...state.files, ...pdfFiles];
          await updateUI();
        }
      }
    });

    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', async () => {
      state.files = [];
      await updateUI();
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', async () => {
      await merge();
    });
  }

  // Sort the list by name, or back to the order the files were added.
  const sort = document.getElementById(
    'merge-sort'
  ) as HTMLSelectElement | null;
  sort?.addEventListener('change', () => {
    const fileList = document.getElementById('file-list');
    if (!fileList) return;
    const rows = Array.from(fileList.children) as HTMLElement[];
    const nameOf = (row: HTMLElement) =>
      row.querySelector('.merge-row-name')?.textContent ?? '';
    rows.sort((a, b) =>
      sort.value === 'added'
        ? Number(a.dataset.added) - Number(b.dataset.added)
        : nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }) *
          (sort.value === 'desc' ? -1 : 1)
    );
    fileList.append(...rows);
    renumberFileList();
  });
});
