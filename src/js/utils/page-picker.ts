/**
 * A grid of page thumbnails to pick pages by clicking: click toggles a
 * page, Shift+click takes every page from the last one clicked. Thumbnails
 * are drawn as they scroll into view.
 */
import * as pdfjsLib from 'pdfjs-dist';
import './setup-pdf-worker.js';

export interface PagePicker {
  /** Picked pages, 1-based, sorted. */
  selected(): number[];
  /** Picks exactly these pages (1-based); does not call onChange. */
  set(pages: number[]): void;
  destroy(): void;
}

export interface PagePickerOptions {
  /** After the user changes the picked pages. */
  onChange: (pages: number[]) => void;
  /** Label under each page, e.g. "Trang 3". */
  pageLabel: (page: number) => string;
}

const THUMB_WIDTH = 120;

export async function createPagePicker(
  container: HTMLElement,
  bytes: ArrayBuffer | Uint8Array,
  options: PagePickerOptions
): Promise<PagePicker> {
  const data = bytes instanceof Uint8Array ? bytes.slice() : bytes.slice(0);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const picked = new Set<number>();
  let anchor: number | null = null;

  container.textContent = '';
  container.classList.add('page-picker');
  const tiles: HTMLButtonElement[] = [];

  const draw = async (page: number, canvas: HTMLCanvasElement) => {
    try {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({
        scale: (THUMB_WIDTH * 1.5) / base.width,
      });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (context)
        await pdfPage.render({ canvasContext: context, viewport, canvas })
          .promise;
    } catch (e) {
      console.warn('[PagePicker] Page not drawn:', page, e);
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const tile = entry.target as HTMLButtonElement;
        observer.unobserve(tile);
        void draw(Number(tile.dataset.page), tile.querySelector('canvas')!);
      }
    },
    { root: container, rootMargin: '200px' }
  );

  const render = () => {
    tiles.forEach((tile, i) => {
      const on = picked.has(i + 1);
      tile.classList.toggle('picked', on);
      tile.setAttribute('aria-pressed', String(on));
    });
  };

  for (let page = 1; page <= doc.numPages; page++) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'page-tile';
    tile.dataset.page = String(page);
    tile.setAttribute('aria-pressed', 'false');
    const frame = document.createElement('span');
    frame.className = 'page-tile-frame';
    const canvas = document.createElement('canvas');
    const check = document.createElement('i');
    check.className = 'ph ph-check page-tile-check';
    frame.append(canvas, check);
    const label = document.createElement('span');
    label.className = 'page-tile-label';
    label.textContent = options.pageLabel(page);
    tile.append(frame, label);
    tile.addEventListener('click', (e) => {
      if (e.shiftKey && anchor !== null) {
        const [from, to] = anchor < page ? [anchor, page] : [page, anchor];
        for (let p = from; p <= to; p++) picked.add(p);
      } else if (picked.has(page)) {
        picked.delete(page);
      } else {
        picked.add(page);
      }
      anchor = page;
      render();
      options.onChange([...picked].sort((a, b) => a - b));
    });
    tiles.push(tile);
    container.append(tile);
    observer.observe(tile);
  }

  return {
    selected: () => [...picked].sort((a, b) => a - b),
    set(pages: number[]) {
      picked.clear();
      for (const page of pages)
        if (page >= 1 && page <= doc.numPages) picked.add(page);
      render();
    },
    destroy() {
      observer.disconnect();
      container.textContent = '';
      void doc.destroy();
    },
  };
}
