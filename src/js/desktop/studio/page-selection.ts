/**
 * Which pages of the page grid are selected, by zero-based position, and
 * what moving them does to the order. Pure: the grid keeps one of these and
 * replaces it on every click.
 */

export interface PageSelection {
  /** Selected positions, ascending. */
  pages: number[];
  /** Where a Shift+click range starts. */
  anchor: number | null;
}

export const NO_SELECTION: PageSelection = { pages: [], anchor: null };

export interface ClickKeys {
  /** Ctrl (Cmd on a Mac): add or remove the page. */
  toggle?: boolean;
  /** Shift: every page from the anchor to this one. */
  range?: boolean;
}

const sorted = (pages: Iterable<number>) =>
  [...new Set(pages)].sort((a, b) => a - b);

/** A click on the page at `index`, as a file manager answers one. */
export function clickPage(
  selection: PageSelection,
  index: number,
  keys: ClickKeys = {}
): PageSelection {
  if (keys.range && selection.anchor !== null) {
    const from = Math.min(selection.anchor, index);
    const to = Math.max(selection.anchor, index);
    const run = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    // Ctrl+Shift adds the run to what was selected.
    const pages = keys.toggle ? sorted([...selection.pages, ...run]) : run;
    return { pages, anchor: selection.anchor };
  }
  if (keys.toggle) {
    const pages = selection.pages.includes(index)
      ? selection.pages.filter((page) => page !== index)
      : sorted([...selection.pages, index]);
    return { pages, anchor: index };
  }
  return { pages: [index], anchor: index };
}

export function selectAll(count: number): PageSelection {
  return {
    pages: Array.from({ length: count }, (_, i) => i),
    anchor: count > 0 ? 0 : null,
  };
}

/** Drops positions past the end, after the document lost pages. */
export function clampSelection(
  selection: PageSelection,
  count: number
): PageSelection {
  const pages = selection.pages.filter((page) => page < count);
  const anchor =
    selection.anchor !== null && selection.anchor < count
      ? selection.anchor
      : (pages[0] ?? null);
  return { pages, anchor };
}

/**
 * The page order after moving the selected pages, in their order, to just
 * before the page now at `target` (`count` for the end). Returns original
 * positions in their new order.
 */
export function movePages(
  count: number,
  selected: number[],
  target: number
): number[] {
  const moving = sorted(selected).filter((page) => page >= 0 && page < count);
  const staying = Array.from({ length: count }, (_, i) => i).filter(
    (page) => !moving.includes(page)
  );
  // Where the target lands among the pages that stay.
  let at = staying.findIndex((page) => page >= target);
  if (at < 0) at = staying.length;
  return [...staying.slice(0, at), ...moving, ...staying.slice(at)];
}

/** The moved pages, selected where they now are. */
export function selectionAfterMove(
  order: number[],
  moved: number[]
): PageSelection {
  const pages = sorted(
    order
      .map((original, position) => (moved.includes(original) ? position : -1))
      .filter((position) => position >= 0)
  );
  return { pages, anchor: pages[0] ?? null };
}

/** True when the order is the identity: the move changed nothing. */
export function isSameOrder(order: number[]): boolean {
  return order.every((original, position) => original === position);
}

/** "2, 4–6, 9": positions as page numbers, runs joined. */
export function describePages(pages: number[]): string {
  const runs: string[] = [];
  const list = sorted(pages);
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    runs.push(j > i ? `${list[i] + 1}–${list[j] + 1}` : String(list[i] + 1));
    i = j + 1;
  }
  return runs.join(', ');
}
