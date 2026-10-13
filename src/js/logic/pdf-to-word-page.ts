import { showLoader, hideLoader, showAlert } from '../ui.js';
import { t } from '../i18n/i18n';
import {
  downloadFile,
  readFileAsArrayBuffer,
  formatBytes,
  getPDFDocument,
} from '../utils/helpers.js';
import { state } from '../state.js';
import { createIcons, icons } from 'lucide';
import { loadPyMuPDF } from '../utils/pymupdf-loader.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import { deduplicateFileName } from '../utils/deduplicate-filename.js';
import { performOcr } from '../utils/ocr.js';
import { resolveConfiguredTesseractAvailableLanguages } from '../utils/tesseract-language-availability.js';

// A scan has no text for the converter to find. Fewer characters than this
// over the sampled pages counts as "no text".
const MIN_TEXT_CHARS = 20;
const TEXT_SAMPLE_PAGES = 5;
// Render scale for recognition: about 200 DPI.
const OCR_SCALE = 2.8;

async function hasText(file: File): Promise<boolean> {
  const data = await readFileAsArrayBuffer(file);
  const pdf = await getPDFDocument({ data }).promise;
  try {
    let chars = 0;
    const pages = Math.min(pdf.numPages, TEXT_SAMPLE_PAGES);
    for (let i = 1; i <= pages && chars < MIN_TEXT_CHARS; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      for (const item of content.items) {
        if ('str' in item) chars += item.str.replace(/\s/g, '').length;
      }
    }
    return chars >= MIN_TEXT_CHARS;
  } finally {
    await pdf.destroy();
  }
}

// Vietnamese and English, limited to what this build offers. English goes
// last: put first, it costs Vietnamese capitals their diacritics.
function ocrLanguages(): string {
  const available = resolveConfiguredTesseractAvailableLanguages();
  const wanted = ['vie', 'eng'].filter(
    (code) => !available || available.includes(code)
  );
  return wanted.join('+') || 'eng';
}

/**
 * A scanned PDF is replaced by pages holding its recognized text, so the
 * Word file gets editable text instead of one picture per page.
 */
async function recognizeIfScanned(
  file: File
): Promise<{ file: File; recognized: boolean }> {
  if (await hasText(file)) return { file, recognized: false };

  showLoader('Scanned document: recognizing text (OCR)...');
  const bytes = (await readFileAsArrayBuffer(file)) as ArrayBuffer;
  const result = await performOcr(new Uint8Array(bytes), {
    language: ocrLanguages(),
    resolution: OCR_SCALE,
    binarize: false,
    whitelist: '',
    textOnly: true,
    onProgress: (status) => {
      // Page counts are worth showing; the engine's own states are noise.
      if (status.startsWith('Processing page')) {
        showLoader(`Recognizing text (OCR): ${status}`);
      }
    },
  });
  return {
    file: new File([result.pdfBytes as BlobPart], file.name, {
      type: 'application/pdf',
    }),
    recognized: true,
  };
}

const OCR_NOTE =
  ' The PDF was a scan, so its text was recognized with OCR: please check it against the original.';

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const fileDisplayArea = document.getElementById('file-display-area');
  const convertOptions = document.getElementById('convert-options');
  const fileControls = document.getElementById('file-controls');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const backBtn = document.getElementById('back-to-tools');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  const updateUI = async () => {
    if (!fileDisplayArea || !convertOptions || !processBtn || !fileControls)
      return;

    if (state.files.length > 0) {
      fileDisplayArea.innerHTML = '';

      for (let index = 0; index < state.files.length; index++) {
        const file = state.files[index];
        const fileDiv = document.createElement('div');
        fileDiv.className =
          'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';

        const infoContainer = document.createElement('div');
        infoContainer.className = 'flex flex-col overflow-hidden';

        const nameSpan = document.createElement('div');
        nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
        nameSpan.textContent = file.name;

        const metaSpan = document.createElement('div');
        metaSpan.className = 'text-xs text-gray-400';
        metaSpan.textContent = `${formatBytes(file.size)} • ${t('common.loadingPageCount')}`;

        infoContainer.append(nameSpan, metaSpan);

        const removeBtn = document.createElement('button');
        removeBtn.className =
          'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
        removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
        removeBtn.onclick = () => {
          state.files = state.files.filter((_: File, i: number) => i !== index);
          updateUI();
        };

        fileDiv.append(infoContainer, removeBtn);
        fileDisplayArea.appendChild(fileDiv);

        try {
          const arrayBuffer = await readFileAsArrayBuffer(file);
          const pdfDoc = await getPDFDocument({ data: arrayBuffer }).promise;
          metaSpan.textContent = `${formatBytes(file.size)} • ${pdfDoc.numPages} pages`;
        } catch {
          metaSpan.textContent = `${formatBytes(file.size)} • Could not load page count`;
        }
      }

      createIcons({ icons });
      fileControls.classList.remove('hidden');
      convertOptions.classList.remove('hidden');
      (processBtn as HTMLButtonElement).disabled = false;
    } else {
      fileDisplayArea.innerHTML = '';
      fileControls.classList.add('hidden');
      convertOptions.classList.add('hidden');
      (processBtn as HTMLButtonElement).disabled = true;
    }
  };

  const resetState = () => {
    state.files = [];
    state.pdfDoc = null;
    updateUI();
  };

  const convert = async () => {
    try {
      if (state.files.length === 0) {
        showAlert('No Files', 'Please select at least one PDF file.');
        return;
      }

      showLoader('Loading PDF converter...');
      const pymupdf = await loadPyMuPDF();

      hideLoader();
      state.files = await batchDecryptIfNeeded(state.files);
      showLoader('Converting...');

      if (state.files.length === 1) {
        const file = state.files[0];
        showLoader(`Converting ${file.name}...`);

        const source = await recognizeIfScanned(file);
        showLoader(`Converting ${file.name}...`);
        const docxBlob = await pymupdf.pdfToDocx(source.file);
        const outName = file.name.replace(/\.pdf$/i, '') + '.docx';

        downloadFile(docxBlob, outName);
        hideLoader();

        showAlert(
          'Conversion Complete',
          `Successfully converted ${file.name} to DOCX.${source.recognized ? OCR_NOTE : ''}`,
          'success',
          () => resetState()
        );
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const usedNames = new Set<string>();
        let recognized = false;

        for (let i = 0; i < state.files.length; i++) {
          const file = state.files[i];
          showLoader(
            `Converting ${i + 1}/${state.files.length}: ${file.name}...`
          );

          const source = await recognizeIfScanned(file);
          recognized ||= source.recognized;
          showLoader(
            `Converting ${i + 1}/${state.files.length}: ${file.name}...`
          );
          const docxBlob = await pymupdf.pdfToDocx(source.file);
          const baseName = file.name.replace(/\.pdf$/i, '');
          const arrayBuffer = await docxBlob.arrayBuffer();
          const zipEntryName = deduplicateFileName(
            `${baseName}.docx`,
            usedNames
          );
          zip.file(zipEntryName, arrayBuffer);
        }

        showLoader('Creating ZIP archive...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        downloadFile(zipBlob, 'converted-documents.zip');
        hideLoader();

        showAlert(
          'Conversion Complete',
          `Successfully converted ${state.files.length} PDF(s) to DOCX.${recognized ? OCR_NOTE : ''}`,
          'success',
          () => resetState()
        );
      }
    } catch (e: unknown) {
      hideLoader();
      showAlert(
        'Error',
        `An error occurred during conversion. Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      const pdfFiles = Array.from(files).filter(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      state.files = [...state.files, ...pdfFiles];
      updateUI();
    }
  };

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', (e) => {
      handleFileSelect((e.target as HTMLInputElement).files);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFileSelect(files);
      }
    });

    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => {
      resetState();
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', convert);
  }
});
