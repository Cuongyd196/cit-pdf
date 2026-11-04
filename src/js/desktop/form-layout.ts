/**
 * Form tools (desktop only). Most tool pages are one card: title, drop zone,
 * the files, then the tool's options ending in its run button, all in one
 * column that grows down the window. Once a file is in, the card turns into
 * two columns: the files (and the first page of a lone PDF) on the left, the
 * options on the right with the run button kept in view at their foot.
 *
 * Elements are moved into the columns, not copied, so the tool's own code
 * keeps finding them by id and keeps its listeners. Before a file is in, the
 * columns sit one under the other and the card looks as it always did.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { hasWorkspace } from './workspace.js';

/**
 * Pages whose options hold a file list or a preview of their own, which a
 * narrow column would cramp. They keep the single column.
 */
const SINGLE_COLUMN = new Set([
  'add-attachments',
  'adjust-colors',
  'alternate-merge',
  'bates-numbering',
  'duplex-collate',
  'edit-attachments',
  'form-filler',
  'merge-pdf',
  'posterize-pdf',
  'remove-blank-pages',
  'scanner-effect',
  'split-pdf',
]);

// The preview is drawn this wide at most (CSS pixels).
const PREVIEW_WIDTH = 520;

function pageSlug(): string {
  const last = window.location.pathname.split('/').pop() || '';
  return last.replace(/\.html$/, '');
}

function make(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isShown(node: HTMLElement): boolean {
  return (
    !node.classList.contains('hidden') &&
    getComputedStyle(node).display !== 'none'
  );
}

export function initFormLayout(): void {
  const slug = pageSlug();
  if (SINGLE_COLUMN.has(slug) || hasWorkspace(slug)) return;

  const card = document.getElementById('tool-uploader');
  const run = document.getElementById('process-btn');
  const drop = document.getElementById('drop-zone');
  if (!card || !run || !drop) return;
  const [back, title, blurb] = Array.from(card.children);
  if (back?.id !== 'back-to-tools' || title?.tagName !== 'H1') return;

  // The options: the card's child that holds the run button.
  let options: Element | null = run;
  while (options && options.parentElement !== card) {
    options = options.parentElement;
  }
  if (!(options instanceof HTMLElement)) return;

  const header = blurb?.tagName === 'P' ? [back, title, blurb] : [back, title];
  const form = make('desktop-form');
  const main = make('desktop-form-main');
  const side = make('desktop-form-side');
  const preview = make('desktop-form-preview hidden');
  const rest = Array.from(card.children).filter(
    (child) => !header.includes(child) && child !== options
  );
  main.append(...rest, preview);
  side.append(options);
  form.append(main, side);
  card.append(form);

  // The file the tool was given last: picked, dropped, or opened by the app
  // (which goes through the input too).
  let file: File | null = null;
  const input = document.getElementById('file-input');
  input?.addEventListener('change', () => {
    file = (input as HTMLInputElement).files?.[0] ?? null;
    refresh();
  });
  drop.addEventListener('drop', (event) => {
    file = event.dataTransfer?.files?.[0] ?? null;
    refresh();
  });

  let on = false;
  let shownFile: File | null = null;
  let pdf: PDFDocumentProxy | null = null;
  // Bumped per preview, so a slow render of an old file stops.
  let generation = 0;

  async function showPreview(next: File): Promise<void> {
    const gen = ++generation;
    shownFile = next;
    try {
      const [{ getPDFDocument }] = await Promise.all([
        import('../utils/helpers.js'),
        import('../utils/setup-pdf-worker.js'),
      ]);
      const data = new Uint8Array(await next.arrayBuffer());
      const doc = await getPDFDocument({ data }).promise;
      if (gen !== generation) {
        void doc.destroy();
        return;
      }
      void pdf?.destroy();
      pdf = doc;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const width = Math.min(PREVIEW_WIDTH, main.clientWidth || PREVIEW_WIDTH);
      const viewport = page.getViewport({
        scale: (width / base.width) * (window.devicePixelRatio || 1),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      if (gen !== generation) return;
      preview.replaceChildren(canvas);
      preview.classList.remove('hidden');
    } catch (e) {
      // A locked or broken PDF: the tool says so itself.
      if (gen === generation) preview.classList.add('hidden');
      console.warn('[Form layout] Preview failed:', e);
    }
  }

  function hidePreview(): void {
    generation++;
    shownFile = null;
    preview.classList.add('hidden');
    preview.replaceChildren();
    void pdf?.destroy();
    pdf = null;
  }

  function refresh(): void {
    const next = isShown(options as HTMLElement);
    if (next !== on) {
      on = next;
      document.body.classList.toggle('desktop-form-on', on);
    }
    // A lone PDF only: with several, the list says more than one page.
    const list = document.getElementById('file-display-area');
    const files = list ? list.children.length : 1;
    const lone = on && file && isPdf(file) && files === 1 ? file : null;
    if (!lone) {
      if (shownFile) hidePreview();
    } else if (lone !== shownFile) {
      void showPreview(lone);
    }
  }

  // Tools show their options by dropping a class; one look per frame.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refresh();
    });
  }).observe(card, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  refresh();
}
