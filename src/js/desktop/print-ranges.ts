/**
 * Parse a page list such as "1-3, 5" into sorted, unique page numbers.
 * Returns null when the text is empty, malformed, or names a page outside
 * 1..total.
 */
export function parsePageRanges(text: string, total: number): number[] | null {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const pages = new Set<number>();
  for (const part of parts) {
    const bounds = part.split('-').map((bound) => bound.trim());
    if (bounds.length > 2 || !bounds.every((bound) => /^\d+$/.test(bound))) {
      return null;
    }
    const a = Number(bounds[0]);
    const b = Number(bounds[bounds.length - 1]);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    if (from < 1 || to > total) return null;
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return [...pages].sort((x, y) => x - y);
}
