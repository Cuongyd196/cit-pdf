/**
 * Page ranges as people type them: "2, 4-6", "3-end", "odd". Vietnamese
 * words ("cuối", "lẻ", "chẵn"), long dashes and ";" are accepted too.
 * Pages are 1-based throughout.
 */

/** The range in plain form: lower case, no spaces, English words. */
export function normalizeRange(range: string): string {
  return range
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/;/g, ',')
    .replace(/cuối/g, 'end')
    .replace(/lẻ/g, 'odd')
    .replace(/chẵn/g, 'even')
    .replace(/\s+/g, '')
    .replace(/^,+|,+$/g, '');
}

/**
 * The pages a range takes from a document of `total` pages, sorted and
 * without repeats, or null when any part of it is not a page range.
 * An empty range takes no pages.
 */
export function parseRangePages(range: string, total: number): number[] | null {
  const pages = new Set<number>();
  for (const piece of normalizeRange(range).split(',')) {
    if (!piece) continue;
    if (piece === 'odd' || piece === 'even') {
      for (let page = piece === 'odd' ? 1 : 2; page <= total; page += 2)
        pages.add(page);
      continue;
    }
    const match = /^(\d+|end)(?:-(\d+|end))?$/.exec(piece);
    if (!match) return null;
    const at = (word: string) => (word === 'end' ? total : Number(word));
    const from = at(match[1]);
    const to = match[2] ? at(match[2]) : from;
    if (from < 1 || to < from || to > total) return null;
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Ranges in the order typed, each kept apart ("1-3, 4-8" is two parts),
 * for splitting into one file per part. Null when one is not a range.
 */
export function parseRangeParts(
  range: string,
  total: number
): number[][] | null {
  const parts: number[][] = [];
  for (const piece of normalizeRange(range).split(',')) {
    if (!piece) continue;
    const pages = parseRangePages(piece, total);
    if (!pages || pages.length === 0) return null;
    parts.push(pages);
  }
  return parts;
}

/** Pages written back as short ranges: [2, 4, 5, 6] -> "2, 4-6". */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(sorted[i] === start ? `${start}` : `${start}-${sorted[i]}`);
  }
  return out.join(', ');
}
