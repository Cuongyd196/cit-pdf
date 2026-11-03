import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  NO_SELECTION,
  clampSelection,
  clickPage,
  describePages,
  isSameOrder,
  movePages,
  selectAll,
  selectionAfterMove,
} from '../js/desktop/studio/page-selection.js';
import {
  deletePages,
  insertBlankPage,
  reorderPages,
  rotatePages,
} from '../js/desktop/studio/page-ops.js';

describe('page selection', () => {
  it('selects one page on a plain click', () => {
    const one = clickPage(NO_SELECTION, 3);
    expect(one).toEqual({ pages: [3], anchor: 3 });
    expect(clickPage(one, 5).pages).toEqual([5]);
  });

  it('adds and removes pages with Ctrl', () => {
    let sel = clickPage(NO_SELECTION, 4);
    sel = clickPage(sel, 1, { toggle: true });
    expect(sel.pages).toEqual([1, 4]);
    sel = clickPage(sel, 4, { toggle: true });
    expect(sel.pages).toEqual([1]);
    expect(sel.anchor).toBe(4);
  });

  it('selects a run with Shift, either way from the anchor', () => {
    const start = clickPage(NO_SELECTION, 5);
    expect(clickPage(start, 2, { range: true }).pages).toEqual([2, 3, 4, 5]);
    expect(clickPage(start, 7, { range: true }).pages).toEqual([5, 6, 7]);
    // The anchor stays, so a second Shift+click re-forms the run.
    const twice = clickPage(clickPage(start, 7, { range: true }), 3, {
      range: true,
    });
    expect(twice.pages).toEqual([3, 4, 5]);
  });

  it('adds a run to the selection with Ctrl+Shift', () => {
    let sel = clickPage(NO_SELECTION, 0);
    sel = clickPage(sel, 6, { toggle: true });
    sel = clickPage(sel, 8, { toggle: true, range: true });
    expect(sel.pages).toEqual([0, 6, 7, 8]);
  });

  it('selects all and drops pages past the end', () => {
    expect(selectAll(3).pages).toEqual([0, 1, 2]);
    expect(selectAll(0)).toEqual(NO_SELECTION);
    expect(clampSelection({ pages: [1, 4, 5], anchor: 5 }, 5)).toEqual({
      pages: [1, 4],
      anchor: 1,
    });
  });

  it('moves the selected pages before the target', () => {
    // Pages 3 and 4 (positions 2, 3) to the front.
    expect(movePages(6, [2, 3], 0)).toEqual([2, 3, 0, 1, 4, 5]);
    // To the end.
    expect(movePages(5, [0, 2], 5)).toEqual([1, 3, 4, 0, 2]);
    // Scattered pages keep their order and land together.
    expect(movePages(6, [4, 1], 3)).toEqual([0, 2, 1, 4, 3, 5]);
    // Dropped onto itself: nothing moves.
    expect(isSameOrder(movePages(4, [1], 1))).toBe(true);
    expect(isSameOrder(movePages(4, [1], 2))).toBe(true);
  });

  it('keeps the moved pages selected where they land', () => {
    const order = movePages(6, [2, 3], 0);
    expect(selectionAfterMove(order, [2, 3]).pages).toEqual([0, 1]);
  });

  it('describes pages as runs of page numbers', () => {
    expect(describePages([0, 3, 4, 5, 8])).toBe('1, 4–6, 9');
    expect(describePages([])).toBe('');
  });
});

/** A PDF whose pages are told apart by width: 100, 110, 120, … */
async function numbered(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([100 + i * 10, 200]);
  return new Uint8Array(await doc.save());
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe('page operations', () => {
  it('rotates only the given pages, either way', async () => {
    const turned = await rotatePages(await numbered(3), [0, 2], 90);
    const back = await rotatePages(turned, [2], -180);
    const doc = await PDFDocument.load(back);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([
      90, 0, 270,
    ]);
  });

  it('deletes pages but never the last one', async () => {
    expect(await widths(await deletePages(await numbered(4), [1, 2]))).toEqual([
      100, 130,
    ]);
    await expect(deletePages(await numbered(2), [0, 1])).rejects.toThrow();
  });

  it('puts pages in a new order', async () => {
    const bytes = await reorderPages(await numbered(4), [2, 3, 0, 1]);
    expect(await widths(bytes)).toEqual([120, 130, 100, 110]);
  });

  it('inserts a blank page sized like the page before it', async () => {
    const bytes = await insertBlankPage(await numbered(3), 2);
    expect(await widths(bytes)).toEqual([100, 110, 110, 120]);
    const first = await insertBlankPage(await numbered(2), 0);
    expect(await widths(first)).toEqual([100, 100, 110]);
  });
});
