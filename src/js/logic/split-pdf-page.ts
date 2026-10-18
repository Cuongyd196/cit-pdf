import { showLoader, hideLoader, showAlert } from '../ui.js';
import { t } from '../i18n/i18n';
import { createIcons, icons } from 'lucide';
import { downloadFile, formatBytes, initializeQpdf } from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { state } from '../state.js';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import { showWasmRequiredDialog } from '../utils/wasm-provider.js';
import JSZip from 'jszip';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import type { QpdfInstanceExtended } from '@/types';
import '../utils/setup-pdf-worker.js';
import {
  evenOddIndices,
  allPagesIndices,
  nTimesGroups,
  bookmarkSplitGroups,
  uniqueZipName,
  extractPagesWithQpdf,
} from '../utils/split-pdf-helpers.js';
import { formatPageRanges, parseRangeParts } from '../utils/page-range.js';
import { mountPageRangeHelp } from '../utils/page-range-help.js';
import { createPagePicker, type PagePicker } from '../utils/page-picker.js';

/** What a split will make: page groups (0-based), or "per bookmark". */
type SplitPlan =
  | { kind: 'groups'; groups: number[][] }
  | { kind: 'bookmarks' }
  | { kind: 'invalid' }
  | { kind: 'empty' };

// At most this many files are listed before "… and N more".
const PLAN_SHOWN = 8;

document.addEventListener('DOMContentLoaded', () => {
  let isSplitting = false;
  let picker: PagePicker | null = null;
  let pickerLoading = false;
  let sourceFileBytes: Uint8Array | null = null;

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  const fileDisplayArea = document.getElementById('file-display-area');
  const splitOptions = document.getElementById('split-options');
  const backBtn = document.getElementById('back-to-tools');

  // Split Mode Elements
  const splitModeSelect = document.getElementById(
    'split-mode'
  ) as HTMLSelectElement;
  const rangePanel = document.getElementById('range-panel');
  const visualPanel = document.getElementById('visual-select-panel');
  const evenOddPanel = document.getElementById('even-odd-panel');
  const outputModeWrapper = document.getElementById('output-mode-wrapper');
  const outputSeparateLabel = document.getElementById('output-separate-label');
  const allPagesPanel = document.getElementById('all-pages-panel');
  const bookmarksPanel = document.getElementById('bookmarks-panel');
  const nTimesPanel = document.getElementById('n-times-panel');
  const pageRangeInput = document.getElementById(
    'page-range'
  ) as HTMLInputElement | null;
  const nValueInput = document.getElementById(
    'split-n-value'
  ) as HTMLInputElement | null;

  mountPageRangeHelp();

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  const totalPages = () => state.pdfDoc?.getPageCount() ?? 0;
  const baseName = () =>
    (state.files[0]?.name ?? 'document').replace(/\.pdf$/i, '');
  const oneFilePerUnit = () =>
    (
      document.querySelector(
        'input[name="split-output-mode"]:checked'
      ) as HTMLInputElement | null
    )?.value === 'separate';

  /**
   * "Bao cao (trang 1-5).pdf" for the pages of a group (0-based); odd or
   * even pages and long lists get a short name instead of every number.
   */
  const groupName = (group: number[]) => {
    const ranges = formatPageRanges(group.map((i) => i + 1));
    let label = t('tools:splitPdf.namePages', { pages: ranges });
    if (splitModeSelect.value === 'even-odd') {
      label = t(
        group[0] % 2 === 0
          ? 'tools:splitPdf.nameOdd'
          : 'tools:splitPdf.nameEven'
      );
    } else if (ranges.length > 30) {
      label = t('tools:splitPdf.nameCount', { count: group.length });
    }
    return `${baseName()} (${label}).pdf`;
  };

  /** The files the current choices would make. */
  const currentPlan = (): SplitPlan => {
    const total = totalPages();
    if (!total) return { kind: 'empty' };
    switch (splitModeSelect.value) {
      case 'range': {
        const value = pageRangeInput?.value.trim() ?? '';
        if (!value) return { kind: 'empty' };
        const parts = parseRangeParts(value, total);
        if (!parts) return { kind: 'invalid' };
        const groups = parts.map((part) => part.map((p) => p - 1));
        return {
          kind: 'groups',
          groups: oneFilePerUnit() ? groups : [[...new Set(groups.flat())]],
        };
      }
      case 'even-odd': {
        const choice =
          (
            document.querySelector(
              'input[name="even-odd-choice"]:checked'
            ) as HTMLInputElement | null
          )?.value === 'even'
            ? 'even'
            : 'odd';
        const pages = evenOddIndices(choice, total);
        return pages.length
          ? { kind: 'groups', groups: [pages] }
          : { kind: 'empty' };
      }
      case 'all':
        return {
          kind: 'groups',
          groups: allPagesIndices(total).map((i) => [i]),
        };
      case 'visual': {
        const pages = (picker?.selected() ?? []).map((p) => p - 1);
        if (!pages.length) return { kind: 'empty' };
        return {
          kind: 'groups',
          groups: oneFilePerUnit() ? pages.map((i) => [i]) : [pages],
        };
      }
      case 'n-times': {
        const n = parseInt(nValueInput?.value || '0', 10);
        if (!(n >= 1)) return { kind: 'invalid' };
        return { kind: 'groups', groups: nTimesGroups(n, total) };
      }
      case 'bookmarks':
        return { kind: 'bookmarks' };
    }
    return { kind: 'empty' };
  };

  /** Shows what will be made, and words the button after it. */
  const updatePlan = () => {
    const plan = currentPlan();
    const box = document.getElementById('split-plan');
    const mode = splitModeSelect.value;

    const rangeError = document.getElementById('range-error');
    const rangeInvalid = mode === 'range' && plan.kind === 'invalid';
    pageRangeInput?.classList.toggle('invalid', rangeInvalid);
    if (rangeError) {
      rangeError.hidden = !rangeInvalid;
      rangeError.textContent = rangeInvalid
        ? t('tools:splitPdf.rangeInvalid', { total: totalPages() })
        : '';
    }

    if (box) {
      box.textContent = '';
      if (plan.kind === 'groups') {
        const title = document.createElement('p');
        title.className = 'split-plan-title';
        title.textContent = t('tools:splitPdf.planCount', {
          count: plan.groups.length,
        });
        const list = document.createElement('ol');
        plan.groups.slice(0, PLAN_SHOWN).forEach((group, i) => {
          const item = document.createElement('li');
          item.textContent = `${i + 1}. ${t('tools:splitPdf.planItem', {
            pages: formatPageRanges(group.map((p) => p + 1)),
          })}`;
          list.append(item);
        });
        if (plan.groups.length > PLAN_SHOWN) {
          const more = document.createElement('li');
          more.className = 'more';
          more.textContent = t('tools:splitPdf.planMore', {
            count: plan.groups.length - PLAN_SHOWN,
          });
          list.append(more);
        }
        box.append(title, list);
      } else if (plan.kind === 'bookmarks') {
        box.textContent = t('tools:splitPdf.planBookmarks');
      }
    }

    if (processBtn && !isSplitting) {
      processBtn.disabled = plan.kind === 'invalid' || plan.kind === 'empty';
      processBtn.textContent =
        plan.kind === 'groups'
          ? plan.groups.length === 1
            ? t('tools:splitPdf.buttonOne')
            : t('tools:splitPdf.button', { count: plan.groups.length })
          : plan.kind === 'bookmarks'
            ? t('tools:splitPdf.buttonBookmarks')
            : mode === 'visual'
              ? t('tools:splitPdf.buttonNeedPages')
              : t('tools:splitPdf.buttonNeedRange');
    }
  };

  const updateUI = async () => {
    if (state.files.length > 0) {
      const file = state.files[0];
      if (fileDisplayArea) {
        fileDisplayArea.innerHTML = '';
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
        metaSpan.textContent = `${formatBytes(file.size)} • ${t('common.loadingPageCount')}`; // Placeholder

        infoContainer.append(nameSpan, metaSpan);

        // Add remove button
        const removeBtn = document.createElement('button');
        removeBtn.className =
          'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
        removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
        removeBtn.onclick = () => {
          state.files = [];
          state.pdfDoc = null;
          updateUI();
        };

        fileDiv.append(infoContainer, removeBtn);
        fileDisplayArea.appendChild(fileDiv);
        createIcons({ icons });

        // Load PDF Document
        try {
          const result = await loadPdfWithPasswordPrompt(file);
          if (!result) {
            state.files = [];
            updateUI();
            return;
          }
          const pageCount = result.pdf.numPages;
          result.pdf.destroy();
          state.files[0] = result.file;
          sourceFileBytes = new Uint8Array(result.bytes);
          state.pdfDoc = await loadPdfDocument(result.bytes);
          metaSpan.textContent = `${formatBytes(file.size)} • ${pageCount} pages`;
        } catch (error) {
          console.error('Error loading PDF:', error);
          showAlert('Error', 'Failed to load PDF file.');
          state.files = [];
          updateUI();
          return;
        }
      }

      if (splitOptions) splitOptions.classList.remove('hidden');
      dropPicker();
      if (splitModeSelect.value === 'visual') void renderVisualSelector();
    } else {
      if (fileDisplayArea) fileDisplayArea.innerHTML = '';
      if (splitOptions) splitOptions.classList.add('hidden');
      state.pdfDoc = null;
      sourceFileBytes = null;
      dropPicker();
    }
    updatePlan();
  };

  const dropPicker = () => {
    picker?.destroy();
    picker = null;
  };

  const renderVisualSelector = async () => {
    if (picker || pickerLoading || !sourceFileBytes) return;
    const container = document.getElementById('page-selector-grid');
    if (!container) return;
    pickerLoading = true;
    try {
      picker = await createPagePicker(container, sourceFileBytes, {
        pageLabel: (page) => t('tools:splitPdf.pageLabel', { page }),
        onChange: () => updatePlan(),
      });
    } catch (error) {
      console.error('Error rendering visual selector:', error);
      showAlert('Error', 'Failed to render page previews.');
    } finally {
      pickerLoading = false;
      updatePlan();
    }
  };

  const resetState = () => {
    state.files = [];
    state.pdfDoc = null;
    sourceFileBytes = null;
    dropPicker();

    if (pageRangeInput) pageRangeInput.value = '';
    if (nValueInput) nValueInput.value = '5';

    const separateRadio = document.getElementById(
      'output-separate'
    ) as HTMLInputElement;
    if (separateRadio) separateRadio.checked = true;

    const rangeCard = document.querySelector(
      'input[name="split-mode-card"][value="range"]'
    ) as HTMLInputElement | null;
    if (rangeCard) rangeCard.checked = true;
    if (splitModeSelect) {
      splitModeSelect.value = 'range';
      splitModeSelect.dispatchEvent(new Event('change'));
    }

    updateUI();
  };

  const split = async () => {
    if (isSplitting) return;
    const plan = currentPlan();
    if (plan.kind === 'invalid' || plan.kind === 'empty') {
      updatePlan();
      return;
    }
    isSplitting = true;
    if (processBtn) processBtn.disabled = true;

    showLoader('Splitting PDF...');

    let qpdf: QpdfInstanceExtended | null = null;
    const inputPath = '/split-input.pdf';

    try {
      if (!state.pdfDoc) throw new Error('No PDF document loaded.');
      const srcDoc = state.pdfDoc;
      const total = srcDoc.getPageCount();

      let sourceBytes: Uint8Array | null = null;
      const getSourceBytes = async (): Promise<Uint8Array> => {
        if (sourceBytes) return sourceBytes;
        sourceBytes = new Uint8Array(await srcDoc.save());
        return sourceBytes;
      };

      const ensureQpdf = async (): Promise<QpdfInstanceExtended> => {
        if (qpdf) return qpdf;
        const instance = await initializeQpdf();
        instance.FS.writeFile(inputPath, await getSourceBytes());
        qpdf = instance;
        return instance;
      };

      const extractPages = async (indices: number[]): Promise<Uint8Array> => {
        const instance = await ensureQpdf();
        return extractPagesWithQpdf(instance, inputPath, indices);
      };

      let groups: number[][];
      if (plan.kind === 'bookmarks') {
        if (!isCpdfAvailable()) {
          showWasmRequiredDialog('cpdf');
          hideLoader();
          return;
        }
        const { getCpdf } = await import('../utils/cpdf-helper.js');
        const cpdf = await getCpdf();
        const pdf = cpdf.fromMemory(new Uint8Array(await getSourceBytes()), '');

        cpdf.startGetBookmarkInfo(pdf);
        const bookmarkCount = cpdf.numberBookmarks();
        const bookmarkLevel = (
          document.getElementById('bookmark-level') as HTMLSelectElement
        )?.value;

        const splitPages: number[] = [];
        for (let i = 0; i < bookmarkCount; i++) {
          const level = cpdf.getBookmarkLevel(i);
          const page = cpdf.getBookmarkPage(pdf, i);

          if (bookmarkLevel === 'all' || level === parseInt(bookmarkLevel)) {
            if (page > 1 && !splitPages.includes(page - 1)) {
              splitPages.push(page - 1);
            }
          }
        }
        cpdf.endGetBookmarkInfo();
        cpdf.deletePdf(pdf);

        if (splitPages.length === 0) {
          throw new Error('No bookmarks found at the selected level.');
        }
        groups = bookmarkSplitGroups(splitPages, total);
      } else {
        groups = plan.groups;
      }

      if (groups.length === 1) {
        const pdfBytes = await extractPages(groups[0]);
        downloadFile(
          new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
          groupName(groups[0])
        );
      } else {
        showLoader('Creating ZIP file...');
        const zip = new JSZip();
        const usedNames = new Map<string, number>();
        for (const group of groups) {
          const pdfBytes = await extractPages(group);
          zip.file(uniqueZipName(groupName(group), usedNames), pdfBytes);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(
          zipBlob,
          `${baseName()} (${t('tools:splitPdf.nameFiles', { count: groups.length })}).zip`
        );
      }

      showAlert('Success', 'PDF split successfully!', 'success', () => {
        resetState();
      });
    } catch (e: unknown) {
      console.error(e);
      showAlert(
        'Error',
        e instanceof Error
          ? e.message
          : 'Failed to split PDF. Please check your selection.'
      );
    } finally {
      if (qpdf) {
        try {
          qpdf.FS.unlink(inputPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up qpdf input file:', cleanupError);
        }
      }
      isSplitting = false;
      hideLoader();
      updatePlan();
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (files && files.length > 0) {
      // Split tool only supports one file at a time
      state.files = [files[0]];
      await updateUI();
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
      if (files) {
        const pdfFiles = Array.from(files).filter(
          (f) =>
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
        );
        if (pdfFiles.length > 0) {
          // Take only the first PDF
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(pdfFiles[0]);
          handleFileSelect(dataTransfer.files);
        }
      }
    });

    // Clear value on click to allow re-selecting the same file
    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  // The cards choose the mode; the (hidden) select keeps it.
  document
    .querySelectorAll<HTMLInputElement>('input[name="split-mode-card"]')
    .forEach((card) => {
      card.addEventListener('change', () => {
        if (!card.checked) return;
        splitModeSelect.value = card.value;
        splitModeSelect.dispatchEvent(new Event('change'));
      });
    });

  if (splitModeSelect) {
    splitModeSelect.addEventListener('change', () => {
      const mode = splitModeSelect.value;

      rangePanel?.classList.toggle('hidden', mode !== 'range');
      visualPanel?.classList.toggle('hidden', mode !== 'visual');
      evenOddPanel?.classList.toggle('hidden', mode !== 'even-odd');
      allPagesPanel?.classList.toggle('hidden', mode !== 'all');
      bookmarksPanel?.classList.toggle('hidden', mode !== 'bookmarks');
      nTimesPanel?.classList.toggle('hidden', mode !== 'n-times');
      outputModeWrapper?.classList.toggle(
        'hidden',
        mode !== 'range' && mode !== 'visual'
      );
      if (outputSeparateLabel)
        outputSeparateLabel.textContent = t(
          mode === 'visual'
            ? 'tools:splitPdf.outputSeparatePage'
            : 'tools:splitPdf.outputSeparateRange'
        );
      if (mode === 'visual') void renderVisualSelector();
      updatePlan();
    });
  }

  // Anything that changes what the split makes updates the plan.
  pageRangeInput?.addEventListener('input', updatePlan);
  nValueInput?.addEventListener('input', updatePlan);
  document
    .querySelectorAll<HTMLInputElement>(
      'input[name="split-output-mode"], input[name="even-odd-choice"]'
    )
    .forEach((radio) => radio.addEventListener('change', updatePlan));

  if (outputSeparateLabel)
    outputSeparateLabel.textContent = t('tools:splitPdf.outputSeparateRange');

  if (processBtn) {
    processBtn.addEventListener('click', split);
  }
});
