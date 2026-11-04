/**
 * Ghostscript off the page's thread: one task per worker (PDF/A, fonts to
 * outlines), started by ghostscript-loader's offThread with the engine's
 * base URL and the PDF; sends progress, then the result or an error.
 */
import {
  convertFontsToOutlines,
  convertToPdfA,
  setGhostscriptBaseUrl,
  type GhostscriptTask,
} from './ghostscript-loader.js';

type Job = GhostscriptTask & { base: string; pdfData: Uint8Array };

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Job>) => void) | null;
};

ctx.onmessage = async (event) => {
  const job = event.data;
  const progress = (message: string) =>
    ctx.postMessage({ type: 'progress', message });
  try {
    setGhostscriptBaseUrl(job.base);
    const bytes =
      job.task === 'pdfa'
        ? await convertToPdfA(job.pdfData, job.level, progress)
        : await convertFontsToOutlines(job.pdfData, progress);
    ctx.postMessage({ type: 'result', bytes }, [bytes.buffer]);
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
