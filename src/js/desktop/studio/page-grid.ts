/**
 * The page grid of the ribbon's Trang tab: the document's pages as
 * thumbnails over the viewer, selected with the mouse (Ctrl and Shift as
 * in a file manager), dragged to a new place, turned or removed. Every
 * change is one Studio step, so Ctrl+Z takes it back.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import '../../utils/setup-pdf-worker.js';
import { getPDFDocument } from '../../utils/helpers.js';
import { ds } from '../strings.js';
import type { GridOp } from './commands.js';
import {
  NO_SELECTION,
  clampSelection,
  clickPage,
  describePages,
  isSameOrder,
  movePages,
  selectAll,
  selectionAfterMove,
  type PageSelection,
} from './page-selection.js';
import {
  deletePages,
  insertBlankPage,
  reorderPages,
  rotatePages,
} from './page-ops.js';
import { splitPdf } from '../../utils/pdf-operations.js';
import type { StudioApi } from './studio.js';

/** Thumbnail width in CSS pixels. */
const THUMB_WIDTH = 150;

export interface PageGrid {
  show(): void;
  hide(): void;
  visible(): boolean;
  /** Selected positions, ascending. */
  selection(): number[];
  pageCount(): number;
  /** Whether a toolbar command can run now. */
  canRun(op: GridOp): boolean;
  run(op: GridOp): Promise<void>;
  /** Called when the selection, the pages or the status line change. */
  onChange(listener: () => void): void;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initPageGrid(options: {
  container: HTMLElement;
  studio: StudioApi;
  /** Double-click: read this page (1-based) in the viewer. */
  openPage: (page: number) => void;
}): PageGrid {
  const { container, studio } = options;
  const listeners: Array<() => void> = [];
  const host = make('div', 'page-grid hidden');
  host.tabIndex = -1;
  host.setAttribute('role', 'listbox');
  host.setAttribute('aria-multiselectable', 'true');
  host.setAttribute('aria-label', ds('ribbonPages'));
  const status = make('p', 'page-grid-status');
  status.setAttribute('role', 'status');
  const cells = make('div', 'page-grid-cells');
  host.append(cells, status);
  container.append(host);

  let shown = false;
  let selection: PageSelection = NO_SELECTION;
  let count = 0;
  let file: File | null = null;
  let bytes: Uint8Array | null = null;
  let pdf: PDFDocumentProxy | null = null;
  // Bumped for each new set of bytes, so late renders of old pages stop.
  let generation = 0;
  let note: { text: string; error: boolean } | null = null;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void drawThumb(entry.target as HTMLElement, generation);
      }
    },
    { root: host, rootMargin: '400px 0px' }
  );

  const changed = () => {
    for (const listener of listeners) listener();
  };

  function renderStatus(): void {
    const picked = selection.pages.length;
    status.classList.toggle('error', Boolean(note?.error));
    // How to select is each page's tooltip; the line shows only when there
    // is something to say.
    status.textContent =
      note?.text ??
      (picked === 0
        ? ''
        : ds('gridSelected', {
            n: picked,
            pages: describePages(selection.pages),
          }));
    status.classList.toggle('hidden', !status.textContent);
  }

  function renderSelection(): void {
    cells.querySelectorAll<HTMLElement>('.page-cell').forEach((cell) => {
      const on = selection.pages.includes(Number(cell.dataset.index));
      cell.classList.toggle('selected', on);
      cell.setAttribute('aria-selected', String(on));
    });
    renderStatus();
    changed();
  }

  function select(next: PageSelection): void {
    selection = next;
    note = null;
    renderSelection();
  }

  async function drawThumb(cell: HTMLElement, gen: number): Promise<void> {
    const doc = pdf;
    if (!doc || gen !== generation) return;
    const index = Number(cell.dataset.index);
    try {
      const pdfPage = await doc.getPage(index + 1);
      if (gen !== generation) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = (THUMB_WIDTH / base.width) * (window.devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = make('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;
      await pdfPage.render({ canvasContext: context, viewport, canvas })
        .promise;
      if (gen !== generation) return;
      const thumb = cell.querySelector('.page-thumb');
      thumb?.replaceChildren(canvas);
      thumb?.classList.remove('loading');
    } catch (e) {
      if (gen === generation) console.warn('[Page grid] Thumbnail failed:', e);
    }
  }

  /** Lays out one cell per page, sized before its picture is drawn. */
  async function load(next: Uint8Array): Promise<void> {
    const gen = ++generation;
    const old = pdf;
    pdf = null;
    void old?.destroy();
    let doc: PDFDocumentProxy;
    try {
      doc = await getPDFDocument({ data: next.slice() }).promise;
    } catch (e) {
      console.error('[Page grid] Could not read the document:', e);
      note = { text: ds('studioFailed'), error: true };
      renderStatus();
      return;
    }
    if (gen !== generation) {
      void doc.destroy();
      return;
    }
    pdf = doc;
    bytes = next;
    count = doc.numPages;
    // Page shapes first, so the grid does not jump while pictures arrive.
    const shapes = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        doc.getPage(i + 1).then((p) => {
          const { width, height } = p.getViewport({ scale: 1 });
          return height / width;
        })
      )
    );
    if (gen !== generation) return;
    cells.replaceChildren(
      ...shapes.map((ratio, index) => {
        const cell = make('div', 'page-cell');
        cell.dataset.index = String(index);
        cell.draggable = true;
        cell.setAttribute('role', 'option');
        cell.title = `${ds('gridPage', { n: index + 1 })}\n${ds('gridHint')}`;
        const thumb = make('div', 'page-thumb loading');
        thumb.style.width = `${THUMB_WIDTH}px`;
        thumb.style.height = `${Math.round(THUMB_WIDTH * ratio)}px`;
        cell.append(thumb, make('span', 'page-num', String(index + 1)));
        observer.observe(cell);
        return cell;
      })
    );
    selection = clampSelection(selection, count);
    renderSelection();
  }

  /** Follows the tab on screen and the history, while shown. */
  async function refresh(): Promise<void> {
    if (!shown) return;
    const current = await studio.current();
    if (!current) return;
    if (current.file !== file) {
      file = current.file;
      selection = NO_SELECTION;
    }
    if (current.bytes !== bytes) await load(current.bytes);
  }
  studio.onChange(() => void refresh());

  async function change(
    label: string,
    edit: (from: Uint8Array) => Promise<Uint8Array>,
    after: PageSelection
  ): Promise<void> {
    const result = await studio.apply(label, edit);
    if (!result.ok) {
      note = { text: ds('studioFailed'), error: true };
      renderStatus();
      changed();
      return;
    }
    selection = after;
    note = null;
    await refresh();
    renderSelection();
  }

  const picked = () => selection.pages;
  const names = () => describePages(selection.pages);

  async function run(op: GridOp): Promise<void> {
    if (!canRun(op)) return;
    switch (op) {
      case 'select-all':
        select(selectAll(count));
        return;
      case 'clear':
        select(NO_SELECTION);
        return;
      case 'rotate-left':
      case 'rotate-right': {
        const delta = op === 'rotate-left' ? -90 : 90;
        const pages = picked();
        await change(
          ds(
            op === 'rotate-left' ? 'gridStepRotateLeft' : 'gridStepRotateRight',
            {
              pages: names(),
            }
          ),
          (from) => rotatePages(from, pages, delta),
          selection
        );
        return;
      }
      case 'delete': {
        const pages = picked();
        const first = pages[0] ?? 0;
        await change(
          ds('gridStepDelete', { pages: names() }),
          (from) => deletePages(from, pages),
          { pages: [], anchor: Math.min(first, count - pages.length - 1) }
        );
        return;
      }
      case 'blank': {
        const at = picked().length ? Math.max(...picked()) + 1 : count;
        await change(
          ds('gridStepBlank', { n: at + 1 }),
          (from) => insertBlankPage(from, at),
          { pages: [at], anchor: at }
        );
        return;
      }
      case 'insert': {
        const after = picked().length ? Math.max(...picked()) + 1 : count;
        studio.openTool(
          'insert',
          after >= count
            ? { where: 'end' }
            : { where: 'after', after: String(after) }
        );
        return;
      }
      case 'extract': {
        const current = await studio.current();
        if (!current) return;
        const pages = picked();
        const stem = current.file.name.replace(/\.pdf$/i, '');
        const name = `${ds('studioExtractName', {
          name: stem,
          pages: names()
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ''),
        })}.pdf`;
        await studio.saveNewFile(await splitPdf(current.bytes, pages), name);
        note = { text: ds('studioMadeFile', { name }), error: false };
        renderStatus();
        changed();
        return;
      }
    }
  }

  function canRun(op: GridOp): boolean {
    if (studio.isBusy() || !pdf) return false;
    const n = selection.pages.length;
    switch (op) {
      case 'select-all':
        return n < count;
      case 'clear':
        return n > 0;
      case 'delete':
        return n > 0 && n < count;
      case 'blank':
      case 'insert':
        return true;
      default:
        return n > 0;
    }
  }

  // ---- Mouse: click, double-click, drag to reorder
  const cellOf = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest<HTMLElement>('.page-cell') ?? null;

  cells.addEventListener('click', (e) => {
    const cell = cellOf(e.target);
    if (!cell) return;
    select(
      clickPage(selection, Number(cell.dataset.index), {
        toggle: e.ctrlKey || e.metaKey,
        range: e.shiftKey,
      })
    );
    host.focus({ preventScroll: true });
  });
  cells.addEventListener('dblclick', (e) => {
    const cell = cellOf(e.target);
    if (cell) options.openPage(Number(cell.dataset.index) + 1);
  });
  // A click on the space between pages clears the selection.
  host.addEventListener('click', (e) => {
    if (e.target === host || e.target === cells) select(NO_SELECTION);
  });

  let dropAt: { cell: HTMLElement; before: boolean } | null = null;
  const clearDrop = () => {
    dropAt?.cell.classList.remove('drop-before', 'drop-after');
    dropAt = null;
  };
  cells.addEventListener('dragstart', (e) => {
    const cell = cellOf(e.target);
    if (!cell || studio.isBusy()) {
      e.preventDefault();
      return;
    }
    const index = Number(cell.dataset.index);
    if (!selection.pages.includes(index)) select(clickPage(selection, index));
    e.dataTransfer?.setData('application/x-cit-pages', names());
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    host.classList.add('dragging');
  });
  cells.addEventListener('dragover', (e) => {
    const cell = cellOf(e.target);
    if (!cell || !e.dataTransfer?.types.includes('application/x-cit-pages')) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = cell.getBoundingClientRect();
    const before = e.clientX < box.left + box.width / 2;
    if (dropAt?.cell === cell && dropAt.before === before) return;
    clearDrop();
    dropAt = { cell, before };
    cell.classList.add(before ? 'drop-before' : 'drop-after');
  });
  cells.addEventListener('dragleave', (e) => {
    if (!cells.contains(e.relatedTarget as Node | null)) clearDrop();
  });
  cells.addEventListener('dragend', () => {
    clearDrop();
    host.classList.remove('dragging');
  });
  cells.addEventListener('drop', (e) => {
    e.preventDefault();
    host.classList.remove('dragging');
    if (!dropAt) return;
    const target = Number(dropAt.cell.dataset.index) + (dropAt.before ? 0 : 1);
    clearDrop();
    const moved = selection.pages;
    const order = movePages(count, moved, target);
    if (isSameOrder(order)) return;
    void change(
      ds('gridStepMove', { pages: names() }),
      (from) => reorderPages(from, order),
      selectionAfterMove(order, moved)
    );
  });

  // ---- Keys while the grid has the focus
  host.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      void run('select-all');
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void run('delete');
    } else if (e.key === 'Escape' && selection.pages.length) {
      e.preventDefault();
      void run('clear');
    }
  });

  return {
    show() {
      if (shown) return;
      shown = true;
      host.classList.remove('hidden');
      container.classList.add('page-grid-open');
      void refresh();
      host.focus({ preventScroll: true });
    },
    hide() {
      if (!shown) return;
      shown = false;
      host.classList.add('hidden');
      container.classList.remove('page-grid-open');
    },
    visible: () => shown,
    selection: () => selection.pages,
    pageCount: () => count,
    canRun,
    run,
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
