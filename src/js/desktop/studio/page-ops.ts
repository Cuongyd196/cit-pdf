/**
 * What the page grid does to a document: each takes the current bytes and
 * returns new ones, one history step. Pages are zero-based positions.
 */
import { degrees } from 'pdf-lib';
import { loadPdfDocument } from '../../utils/load-pdf-document.js';

async function edit(
  bytes: Uint8Array,
  change: (doc: Awaited<ReturnType<typeof loadPdfDocument>>) => void
): Promise<Uint8Array> {
  const doc = await loadPdfDocument(bytes);
  change(doc);
  return new Uint8Array(await doc.save());
}

/** Turns the pages by `delta` degrees (a multiple of 90). */
export function rotatePages(
  bytes: Uint8Array,
  pages: number[],
  delta: number
): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    for (const index of pages) {
      const page = doc.getPage(index);
      const angle = (((page.getRotation().angle + delta) % 360) + 360) % 360;
      page.setRotation(degrees(angle));
    }
  });
}

export function deletePages(
  bytes: Uint8Array,
  pages: number[]
): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    if (pages.length >= doc.getPageCount()) {
      throw new Error('A document keeps at least one page');
    }
    for (const index of [...pages].sort((a, b) => b - a)) {
      doc.removePage(index);
    }
  });
}

/**
 * Puts the pages in `order` (original positions). The same page objects
 * are moved, so links, form fields and annotations stay with them.
 */
export function reorderPages(
  bytes: Uint8Array,
  order: number[]
): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    const pages = order.map((index) => doc.getPage(index));
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    for (const page of pages) doc.addPage(page);
  });
}

/** A blank page, the size of the page before it, at position `at`. */
export function insertBlankPage(
  bytes: Uint8Array,
  at: number
): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    const count = doc.getPageCount();
    const model =
      count > 0 ? doc.getPage(Math.min(Math.max(at - 1, 0), count - 1)) : null;
    const { width, height } = model?.getSize() ?? {
      width: 595.28,
      height: 841.89,
    };
    const turned = model ? model.getRotation().angle % 180 !== 0 : false;
    // A turned page shows its sides swapped; the new page looks the same.
    doc.insertPage(
      Math.min(at, count),
      turned ? [height, width] : [width, height]
    );
  });
}
