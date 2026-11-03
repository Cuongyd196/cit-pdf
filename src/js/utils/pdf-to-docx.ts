/**
 * PDF to Word, shared by the PDF to Word page and the viewer's Convert tab:
 * a scan is first replaced by pages holding its recognized text (OCR), then
 * pdf2docx (PyMuPDF, in its worker) makes the .docx.
 */
import type { PyMuPDFInstance } from '@/types';
import { getPDFDocument, readFileAsArrayBuffer } from './helpers.js';
import { onPyMuPDFLog } from './pymupdf-loader.js';
import { performOcr } from './ocr.js';
import { resolveConfiguredTesseractAvailableLanguages } from './tesseract-language-availability.js';

// A scan has no text for the converter to find. Fewer characters than this
// over the sampled pages counts as "no text".
const MIN_TEXT_CHARS = 20;
const TEXT_SAMPLE_PAGES = 5;
// Render scale for recognition: about 200 DPI.
const OCR_SCALE = 2.8;

export async function hasText(file: Blob): Promise<boolean> {
  const data = await readFileAsArrayBuffer(file as File);
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
export async function recognizeIfScanned(
  file: File,
  progress: {
    /** It is a scan: recognition starts. */
    onScan?: () => void;
    onPage?: (at: number, total: number) => void;
  } = {}
): Promise<{ file: File; recognized: boolean }> {
  if (await hasText(file)) return { file, recognized: false };
  progress.onScan?.();
  const onPage = progress.onPage;

  const bytes = (await readFileAsArrayBuffer(file)) as ArrayBuffer;
  const result = await performOcr(new Uint8Array(bytes), {
    language: ocrLanguages(),
    resolution: OCR_SCALE,
    binarize: false,
    whitelist: '',
    textOnly: true,
    onProgress: (status) => {
      // Page counts are worth showing; the engine's own states are noise.
      const page = /^Processing page (\d+) of (\d+)/.exec(status);
      if (page) onPage?.(Number(page[1]), Number(page[2]));
    },
  });
  return {
    file: new File([result.pdfBytes as BlobPart], file.name, {
      type: 'application/pdf',
    }),
    recognized: true,
  };
}

/**
 * Makes the .docx, following the page pdf2docx is on: it reads every page
 * ("[3/4] Parsing pages"), then writes every page ("[4/4] Creating pages").
 */
export async function convertToDocx(
  pymupdf: PyMuPDFInstance,
  file: File,
  onPage?: (writing: boolean, at: number, total: number) => void
): Promise<Blob> {
  let writing = false;
  const stop = onPyMuPDFLog((text) => {
    if (text.includes('[4/4]')) writing = true;
    const page = /\((\d+)\/(\d+)\) Page/.exec(text);
    if (page) onPage?.(writing, Number(page[1]), Number(page[2]));
  });
  try {
    return await pymupdf.pdfToDocx(file);
  } finally {
    stop();
  }
}

export const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
