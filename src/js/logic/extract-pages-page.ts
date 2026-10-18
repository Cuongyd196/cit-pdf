import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { formatBytes, downloadFile } from '../utils/helpers.js';
import { PDFDocument } from 'pdf-lib';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import JSZip from 'jszip';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import { t } from '../i18n/index.js';
import { formatPageRanges, parseRangePages } from '../utils/page-range.js';
import { mountPageRangeHelp } from '../utils/page-range-help.js';
import { createPagePicker, type PagePicker } from '../utils/page-picker.js';

interface ExtractState {
  file: File | null;
  pdfDoc: PDFDocument | null;
  totalPages: number;
  /** Pages to extract, 1-based, sorted. */
  pages: number[];
  picker: PagePicker | null;
}

const extractState: ExtractState = {
  file: null,
  pdfDoc: null,
  totalPages: 0,
  pages: [],
  picker: null,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

function initializePage() {
  createIcons({ icons });
  mountPageRangeHelp();

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const pagesInput = document.getElementById(
    'pages-to-extract'
  ) as HTMLInputElement | null;

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
    processBtn.addEventListener('click', extractPages);
  }

  // Typing a range picks those pages in the grid.
  pagesInput?.addEventListener('input', () => {
    const pages = parseRangePages(pagesInput.value, extractState.totalPages);
    if (pages) {
      extractState.pages = pages;
      extractState.picker?.set(pages);
    }
    render(pages === null);
  });

  // Quick picks: all, none, odd, even.
  document
    .querySelectorAll<HTMLButtonElement>('[data-pick]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const total = extractState.totalPages;
        const all = Array.from({ length: total }, (_, i) => i + 1);
        const pick = button.dataset.pick;
        const pages =
          pick === 'all'
            ? all
            : pick === 'odd'
              ? all.filter((p) => p % 2 === 1)
              : pick === 'even'
                ? all.filter((p) => p % 2 === 0)
                : [];
        choose(pages);
      });
    });

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
}

/** Picks these pages everywhere: grid, range box, count, button. */
function choose(pages: number[]) {
  extractState.pages = pages;
  extractState.picker?.set(pages);
  const pagesInput = document.getElementById(
    'pages-to-extract'
  ) as HTMLInputElement | null;
  if (pagesInput) pagesInput.value = formatPageRanges(pages);
  render(false);
}

function render(invalid: boolean) {
  const count = extractState.pages.length;
  const total = extractState.totalPages;
  const counter = document.getElementById('pick-count');
  if (counter)
    counter.textContent = t('tools:extractPages.countSelected', {
      count,
      total,
    });
  const error = document.getElementById('pages-error');
  if (error) {
    error.hidden = !invalid;
    error.textContent = invalid
      ? t('tools:extractPages.invalid', { total })
      : '';
  }
  document
    .getElementById('pages-to-extract')
    ?.classList.toggle('invalid', invalid);
  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  if (processBtn) {
    processBtn.disabled = invalid || count === 0;
    processBtn.textContent =
      count === 0
        ? t('tools:extractPages.buttonNone')
        : t('tools:extractPages.button', { count });
  }
}

function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    handleFile(input.files[0]);
  }
}

async function handleFile(file: File) {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    showAlert('Invalid File', 'Please select a PDF file.');
    return;
  }

  extractState.file = file;

  try {
    const result = await loadPdfWithPasswordPrompt(file);
    if (!result) {
      extractState.file = null;
      return;
    }
    showLoader('Loading PDF...');
    extractState.file = result.file;
    result.pdf.destroy();
    extractState.pdfDoc = await loadPdfDocument(result.bytes);
    extractState.totalPages = extractState.pdfDoc.getPageCount();

    updateFileDisplay();
    showOptions();
    hideLoader();

    extractState.picker?.destroy();
    const grid = document.getElementById('page-picker');
    if (grid) {
      extractState.picker = await createPagePicker(grid, result.bytes, {
        pageLabel: (page) => t('tools:extractPages.pageLabel', { page }),
        onChange: (pages) => choose(pages),
      });
    }
    choose([]);
  } catch (error) {
    console.error('Error loading PDF:', error);
    hideLoader();
    showAlert('Error', 'Failed to load PDF file.');
  }
}

function updateFileDisplay() {
  const fileDisplayArea = document.getElementById('file-display-area');
  if (!fileDisplayArea || !extractState.file) return;

  fileDisplayArea.innerHTML = '';
  const fileDiv = document.createElement('div');
  fileDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = extractState.file.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = `${formatBytes(extractState.file.size)} • ${extractState.totalPages} pages`;

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
  removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
  removeBtn.onclick = () => resetState();

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });
}

function showOptions() {
  document.getElementById('extract-options')?.classList.remove('hidden');
}

/** "Bao cao (trang 2, 4-6).pdf"; a long list gives "(5 trang)". */
function outputName(baseName: string, pages: number[]): string {
  const ranges = formatPageRanges(pages);
  const label =
    ranges.length <= 30
      ? t('tools:extractPages.namePages', { pages: ranges })
      : t('tools:extractPages.nameCount', { count: pages.length });
  return `${baseName} (${label}).pdf`;
}

async function extractPages() {
  const pages = extractState.pages;
  if (!extractState.pdfDoc || pages.length === 0) {
    showAlert(
      t('tools:extractPages.buttonNone'),
      t('tools:extractPages.invalid', { total: extractState.totalPages })
    );
    return;
  }

  const asZip =
    (
      document.querySelector(
        'input[name="extract-output"]:checked'
      ) as HTMLInputElement | null
    )?.value === 'zip';

  showLoader('Extracting pages...');

  try {
    const baseName =
      extractState.file?.name.replace(/\.pdf$/i, '') || 'document';

    if (asZip) {
      const zip = new JSZip();
      for (const pageNum of pages) {
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(extractState.pdfDoc, [
          pageNum - 1,
        ]);
        newPdf.addPage(copiedPage);
        zip.file(outputName(baseName, [pageNum]), await newPdf.save());
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(
        zipBlob,
        `${baseName} (${t('tools:extractPages.nameCount', { count: pages.length })}).zip`
      );
    } else {
      const newPdf = await PDFDocument.create();
      const copied = await newPdf.copyPages(
        extractState.pdfDoc,
        pages.map((p) => p - 1)
      );
      copied.forEach((page) => newPdf.addPage(page));
      downloadFile(
        new Blob([(await newPdf.save()) as BlobPart], {
          type: 'application/pdf',
        }),
        outputName(baseName, pages)
      );
    }

    hideLoader();
    showAlert(
      'Success',
      `Extracted ${pages.length} page(s) successfully!`,
      'success',
      () => {
        resetState();
      }
    );
  } catch (error) {
    console.error('Error extracting pages:', error);
    hideLoader();
    showAlert('Error', 'Failed to extract pages.');
  }
}

function resetState() {
  extractState.file = null;
  extractState.pdfDoc = null;
  extractState.totalPages = 0;
  extractState.pages = [];
  extractState.picker?.destroy();
  extractState.picker = null;

  document.getElementById('extract-options')?.classList.add('hidden');

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) {
    fileDisplayArea.innerHTML = '';
  }

  const pagesInput = document.getElementById(
    'pages-to-extract'
  ) as HTMLInputElement;
  if (pagesInput) {
    pagesInput.value = '';
  }
}
