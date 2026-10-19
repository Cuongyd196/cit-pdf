import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, formatBytes } from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import {
  compressToTarget,
  formatMegabytes,
  splitUnderLimit,
  type CompressStatus,
  type CompressToTargetResult,
} from '../utils/compress-to-target.js';
import type { CondenseCustomSettings } from '../utils/compress.js';
import { showChoiceDialog } from '../utils/choice-dialog.js';
import { t } from '../i18n/i18n.js';
import { state } from '../state.js';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { createIcons, icons } from 'lucide';
import { showWasmRequiredDialog } from '../utils/wasm-provider.js';
import { isPyMuPDFAvailable } from '../utils/pymupdf-loader.js';
import '../utils/setup-pdf-worker.js';

type CustomSettings = CondenseCustomSettings;

interface CompressRequest {
  algorithm: string;
  level: string;
  customSettings?: CustomSettings;
  /** Size the result must fit in, or null for no limit. */
  targetBytes: number | null;
}

interface CompressOutcome extends CompressToTargetResult {
  /** How it was compressed, for the message. */
  label: string;
}

const STATUS_TEXT: Record<Exclude<CompressStatus, 'images'>, string> = {
  loading: 'Loading compression engine...',
  condense: 'Running Condense compression...',
  'condense-stronger':
    'Still above the size limit. Trying stronger compression...',
};

/**
 * Compresses one file, down to the size limit when there is one (see
 * compressToTarget). Returns null when the user cancelled a password prompt.
 */
async function compressFile(
  file: File,
  request: CompressRequest,
  status: (text: string) => void
): Promise<CompressOutcome | null> {
  const photon = request.algorithm === 'photon';
  const outcome = await compressToTarget(file, {
    algorithm: photon ? 'photon' : 'condense',
    level: request.level,
    targetBytes: request.targetBytes,
    customSettings: request.customSettings,
    grayscale: request.customSettings?.convertToGrayscale,
    loadPdf: async () => {
      hideLoader();
      return (await loadPdfWithPasswordPrompt(file))?.pdf ?? null;
    },
    status: (key, page, total) =>
      status(
        key === 'images'
          ? `Turning page ${page} of ${total} into an image...`
          : STATUS_TEXT[key]
      ),
  });
  if (!outcome) return null;
  const label =
    outcome.method === 'condense'
      ? 'Condense'
      : outcome.method === 'condense-plain'
        ? 'Condense (without image optimization due to unsupported patterns)'
        : photon
          ? 'Photon'
          : 'Photon (pages turned into images to fit the size limit)';
  return { ...outcome, label };
}

/** "Bao cao.pdf" → "Bao cao". */
const baseName = (name: string) => name.replace(/\.pdf$/i, '');

/**
 * The result is still above the limit: say why, and let the user cut it
 * into parts that fit, keep it as it is, or drop it.
 */
async function offerOverLimit(
  original: File,
  outcome: CompressOutcome,
  targetBytes: number
): Promise<void> {
  showLoader(t('tools:compressPdf.overLimitChecking'));
  const bytes = new Uint8Array(await outcome.blob.arrayBuffer());
  let pages = 0;
  let parts: Uint8Array[] | null = null;
  try {
    pages = (
      await PDFDocument.load(bytes, { ignoreEncryption: true })
    ).getPageCount();
    parts = await splitUnderLimit(bytes, targetBytes);
  } catch (e) {
    console.warn('[CompressPDF] Could not work out the parts:', e);
  }
  hideLoader();

  const limit = formatMegabytes(targetBytes);
  const size = formatMegabytes(outcome.blob.size);
  const reasons = [
    outcome.rasterized || outcome.atFloor
      ? t('tools:compressPdf.overLimitFloor', { pages })
      : t('tools:compressPdf.overLimitStrongest'),
  ];
  if (!parts) reasons.push(t('tools:compressPdf.overLimitNoSplit', { limit }));
  const canSplit = Boolean(parts && parts.length > 1);

  const choice = await showChoiceDialog({
    title: t('tools:compressPdf.overLimitTitle', { limit }),
    message: t('tools:compressPdf.overLimitBody', {
      size,
      original: formatMegabytes(original.size),
      reason: reasons.join(' '),
    }),
    choices: [
      ...(canSplit
        ? [
            {
              id: 'split',
              label: t('tools:compressPdf.overLimitSplit', {
                count: parts!.length,
                limit,
              }),
              primary: true,
            },
          ]
        : []),
      {
        id: 'save',
        label: t('tools:compressPdf.overLimitSave', { size }),
        primary: !canSplit,
      },
      { id: 'cancel', label: t('tools:compressPdf.overLimitCancel') },
    ],
  });

  if (choice === 'save') {
    downloadFile(outcome.blob, original.name);
  } else if (choice === 'split' && parts) {
    const zip = new JSZip();
    const base = baseName(original.name);
    parts.forEach((part, i) =>
      zip.file(t('tools:compressPdf.partName', { base, n: i + 1 }), part)
    );
    downloadFile(
      await zip.generateAsync({ type: 'blob' }),
      t('tools:compressPdf.partsZip', { base, count: parts.length })
    );
    showAlert(
      t('tools:compressPdf.splitDoneTitle'),
      t('tools:compressPdf.splitDone', { count: parts.length, limit }),
      'success'
    );
  }
}

const BYTES_PER_MB = 1000 * 1000;

function readTargetBytes(): number | null {
  const select = document.getElementById(
    'target-size'
  ) as HTMLSelectElement | null;
  if (!select || !select.value) return null;
  const megabytes =
    select.value === 'custom'
      ? parseFloat(
          (document.getElementById('target-size-custom') as HTMLInputElement)
            ?.value
        )
      : parseFloat(select.value);
  return megabytes > 0 ? Math.floor(megabytes * BYTES_PER_MB) : null;
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const compressOptions = document.getElementById('compress-options');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const processBtn = document.getElementById('process-btn');
  const backBtn = document.getElementById('back-to-tools');
  const algorithmSelect = document.getElementById(
    'compression-algorithm'
  ) as HTMLSelectElement;
  const condenseInfo = document.getElementById('condense-info');
  const photonInfo = document.getElementById('photon-info');
  const toggleCustomSettings = document.getElementById(
    'toggle-custom-settings'
  );
  const customSettingsPanel = document.getElementById('custom-settings-panel');
  const customSettingsChevron = document.getElementById(
    'custom-settings-chevron'
  );

  let useCustomSettings = false;

  const targetSelect = document.getElementById(
    'target-size'
  ) as HTMLSelectElement | null;
  const targetCustom = document.getElementById('target-size-custom');
  targetSelect?.addEventListener('change', () => {
    targetCustom?.classList.toggle('hidden', targetSelect.value !== 'custom');
  });

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  // Toggle algorithm info
  if (algorithmSelect && condenseInfo && photonInfo) {
    algorithmSelect.addEventListener('change', () => {
      if (algorithmSelect.value === 'condense') {
        condenseInfo.classList.remove('hidden');
        photonInfo.classList.add('hidden');
      } else {
        condenseInfo.classList.add('hidden');
        photonInfo.classList.remove('hidden');
      }
    });
  }

  // Toggle custom settings panel
  if (toggleCustomSettings && customSettingsPanel && customSettingsChevron) {
    toggleCustomSettings.addEventListener('click', () => {
      customSettingsPanel.classList.toggle('hidden');
      customSettingsChevron.style.transform =
        customSettingsPanel.classList.contains('hidden')
          ? 'rotate(0deg)'
          : 'rotate(180deg)';
      // Mark that user wants to use custom settings
      if (!customSettingsPanel.classList.contains('hidden')) {
        useCustomSettings = true;
      }
    });
  }

  const updateUI = async () => {
    if (!compressOptions) return;

    if (state.files.length > 0) {
      const fileDisplayArea = document.getElementById('file-display-area');
      if (fileDisplayArea) {
        fileDisplayArea.innerHTML = '';

        for (let index = 0; index < state.files.length; index++) {
          const file = state.files[index];
          const fileDiv = document.createElement('div');
          fileDiv.className =
            'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';

          const infoContainer = document.createElement('div');
          infoContainer.className = 'flex flex-col overflow-hidden';

          const nameSpan = document.createElement('div');
          nameSpan.className =
            'truncate font-medium text-gray-200 text-sm mb-1';
          nameSpan.textContent = file.name;

          const metaSpan = document.createElement('div');
          metaSpan.className = 'text-xs text-gray-400';
          metaSpan.textContent = formatBytes(file.size);

          infoContainer.append(nameSpan, metaSpan);

          const removeBtn = document.createElement('button');
          removeBtn.className =
            'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
          removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
          removeBtn.onclick = () => {
            state.files = state.files.filter((_, i) => i !== index);
            updateUI();
          };

          fileDiv.append(infoContainer, removeBtn);
          fileDisplayArea.appendChild(fileDiv);
        }

        createIcons({ icons });
      }
      compressOptions.classList.remove('hidden');
    } else {
      compressOptions.classList.add('hidden');
      // Clear file display area
      const fileDisplayArea = document.getElementById('file-display-area');
      if (fileDisplayArea) fileDisplayArea.innerHTML = '';
    }
  };

  const resetState = () => {
    state.files = [];
    state.pdfDoc = null;

    const compressionLevel = document.getElementById(
      'compression-level'
    ) as HTMLSelectElement;
    if (compressionLevel) compressionLevel.value = 'balanced';

    if (algorithmSelect) algorithmSelect.value = 'condense';

    if (targetSelect) targetSelect.value = '';
    targetCustom?.classList.add('hidden');

    useCustomSettings = false;
    if (customSettingsPanel) customSettingsPanel.classList.add('hidden');
    if (customSettingsChevron)
      customSettingsChevron.style.transform = 'rotate(0deg)';

    const imageQuality = document.getElementById(
      'image-quality'
    ) as HTMLInputElement;
    const dpiTarget = document.getElementById('dpi-target') as HTMLInputElement;
    const dpiThreshold = document.getElementById(
      'dpi-threshold'
    ) as HTMLInputElement;
    const removeMetadata = document.getElementById(
      'remove-metadata'
    ) as HTMLInputElement;
    const subsetFonts = document.getElementById(
      'subset-fonts'
    ) as HTMLInputElement;
    const convertToGrayscale = document.getElementById(
      'convert-to-grayscale'
    ) as HTMLInputElement;
    const removeThumbnails = document.getElementById(
      'remove-thumbnails'
    ) as HTMLInputElement;

    if (imageQuality) imageQuality.value = '75';
    if (dpiTarget) dpiTarget.value = '96';
    if (dpiThreshold) dpiThreshold.value = '150';
    if (removeMetadata) removeMetadata.checked = true;
    if (subsetFonts) subsetFonts.checked = true;
    if (convertToGrayscale) convertToGrayscale.checked = false;
    if (removeThumbnails) removeThumbnails.checked = true;

    if (condenseInfo) condenseInfo.classList.remove('hidden');
    if (photonInfo) photonInfo.classList.add('hidden');

    updateUI();
  };

  const compress = async () => {
    const level = (
      document.getElementById('compression-level') as HTMLSelectElement
    ).value;
    const algorithm = (
      document.getElementById('compression-algorithm') as HTMLSelectElement
    ).value;
    const convertToGrayscale =
      (document.getElementById('convert-to-grayscale') as HTMLInputElement)
        ?.checked ?? false;

    let customSettings: CustomSettings | undefined;

    if (useCustomSettings) {
      const imageQuality =
        parseInt(
          (document.getElementById('image-quality') as HTMLInputElement)?.value
        ) || 75;
      const dpiTarget =
        parseInt(
          (document.getElementById('dpi-target') as HTMLInputElement)?.value
        ) || 96;
      const dpiThreshold =
        parseInt(
          (document.getElementById('dpi-threshold') as HTMLInputElement)?.value
        ) || 150;
      const removeMetadata =
        (document.getElementById('remove-metadata') as HTMLInputElement)
          ?.checked ?? true;
      const subsetFonts =
        (document.getElementById('subset-fonts') as HTMLInputElement)
          ?.checked ?? true;
      const removeThumbnails =
        (document.getElementById('remove-thumbnails') as HTMLInputElement)
          ?.checked ?? true;

      customSettings = {
        imageQuality,
        dpiTarget,
        dpiThreshold,
        removeMetadata,
        subsetFonts,
        convertToGrayscale,
        removeThumbnails,
      };
    } else {
      customSettings = convertToGrayscale ? { convertToGrayscale } : undefined;
    }

    try {
      if (state.files.length === 0) {
        showAlert('No Files', 'Please select at least one PDF file.');
        hideLoader();
        return;
      }

      // Check WASM availability for Condense mode
      const algorithm = (
        document.getElementById('compression-algorithm') as HTMLSelectElement
      ).value;
      if (algorithm === 'condense' && !isPyMuPDFAvailable()) {
        showWasmRequiredDialog('pymupdf');
        return;
      }

      const targetBytes = readTargetBytes();
      const request: CompressRequest = {
        algorithm,
        level,
        customSettings,
        targetBytes,
      };
      const limit = targetBytes === null ? '' : formatMegabytes(targetBytes);

      if (state.files.length === 1) {
        const originalFile = state.files[0];

        const outcome = await compressFile(originalFile, request, showLoader);
        hideLoader();
        if (!outcome) return;

        const resultSize = outcome.blob.size;
        const originalSize = formatBytes(originalFile.size);
        const compressedSize = formatBytes(resultSize);
        const savings = originalFile.size - resultSize;
        const savingsPercent =
          savings > 0 ? ((savings / originalFile.size) * 100).toFixed(1) : 0;

        if (!outcome.reachedTarget && targetBytes !== null) {
          await offerOverLimit(originalFile, outcome, targetBytes);
          return;
        }
        downloadFile(outcome.blob, originalFile.name);

        if (savings > 0) {
          showAlert(
            'Compression Complete',
            `Method: ${outcome.label}. File size reduced from ${originalSize} to ${compressedSize} (Saved ${savingsPercent}%).`,
            'success',
            () => resetState()
          );
        } else {
          showAlert(
            'Compression Finished',
            `Method: ${outcome.label}. Could not reduce file size further. Original: ${originalSize}, New: ${compressedSize}.`,
            'warning',
            () => resetState()
          );
        }
      } else {
        showLoader('Compressing multiple PDFs...');
        const zip = new JSZip();
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;
        let overLimit = 0;

        for (let i = 0; i < state.files.length; i++) {
          const file = state.files[i];
          showLoader(
            `Compressing ${i + 1}/${state.files.length}: ${file.name}...`
          );
          totalOriginalSize += file.size;

          // The file counter stays on screen unless a size limit makes the
          // work long enough to need step-by-step progress.
          const outcome = await compressFile(
            file,
            request,
            targetBytes === null ? () => {} : showLoader
          );
          if (!outcome) {
            hideLoader();
            return;
          }
          if (!outcome.reachedTarget) overLimit++;

          totalCompressedSize += outcome.blob.size;
          zip.file(file.name, await outcome.blob.arrayBuffer());
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const totalSavings = totalOriginalSize - totalCompressedSize;
        const totalSavingsPercent =
          totalSavings > 0
            ? ((totalSavings / totalOriginalSize) * 100).toFixed(1)
            : 0;

        downloadFile(zipBlob, 'compressed-pdfs.zip');

        hideLoader();

        if (overLimit > 0) {
          showAlert(
            'Size Limit Not Reached',
            `Compressed ${state.files.length} PDF(s), but ${overLimit} could not get below ${limit}. Total size: ${formatBytes(totalCompressedSize)}.`,
            'warning',
            () => resetState()
          );
        } else if (totalSavings > 0) {
          showAlert(
            'Compression Complete',
            `Compressed ${state.files.length} PDF(s). Total size reduced from ${formatBytes(totalOriginalSize)} to ${formatBytes(totalCompressedSize)} (Saved ${totalSavingsPercent}%).`,
            'success',
            () => resetState()
          );
        } else {
          showAlert(
            'Compression Finished',
            `Compressed ${state.files.length} PDF(s). Total size: ${formatBytes(totalCompressedSize)}.`,
            'info',
            () => resetState()
          );
        }
      }
    } catch (e: unknown) {
      hideLoader();
      console.error('[CompressPDF] Error:', e);
      showAlert(
        'Error',
        `An error occurred during compression. Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      state.files = [...state.files, ...Array.from(files)];
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
        const pdfFiles = Array.from(files).filter(
          (f) => f.type === 'application/pdf'
        );
        if (pdfFiles.length > 0) {
          const dataTransfer = new DataTransfer();
          pdfFiles.forEach((f) => dataTransfer.items.add(f));
          handleFileSelect(dataTransfer.files);
        }
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
    processBtn.addEventListener('click', compress);
  }
});
