/**
 * "How to pick pages": a folded table of range examples, the same on every
 * page that takes a page range (strings under tools:pageRange).
 */
import { t } from '../i18n/index.js';

/**
 * An element whose text is the translation of `key`: filled now if the
 * strings are loaded, and marked so the page's translation pass fills it
 * when they arrive later.
 */
function translated<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  key: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.i18n = `tools:pageRange.${key}`;
  const text = t(`tools:pageRange.${key}`);
  if (text && !text.endsWith(key)) node.textContent = text;
  return node;
}

export function pageRangeHelp(): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'merge-help';
  const summary = document.createElement('summary');
  const icon = document.createElement('i');
  icon.className = 'ph ph-question';
  summary.append(icon, translated('span', 'helpTitle'));

  const table = document.createElement('table');
  // [example, or the key of a translated example; meaning key; as code]
  const rows: Array<[string | null, string, string | null]> = [
    [null, 'helpBlank', 'helpBlankCode'],
    ['5', 'helpOne', null],
    ['1-3', 'helpRange', null],
    ['1-3, 5, 8', 'helpList', null],
    [null, 'helpEnd', 'helpEndCode'],
    [null, 'helpOddEven', 'helpOddEvenCode'],
  ];
  for (const [example, meaning, exampleKey] of rows) {
    const tr = document.createElement('tr');
    const left = document.createElement('td');
    let sample: HTMLElement;
    if (exampleKey) {
      sample = translated(
        exampleKey === 'helpBlankCode' ? 'span' : 'code',
        exampleKey
      );
    } else {
      sample = document.createElement('code');
      sample.textContent = example;
    }
    left.append(sample);
    tr.append(left, translated('td', meaning));
    table.append(tr);
  }
  details.append(summary, table);
  return details;
}

/** Fills each `[data-page-range-help]` placeholder on the page. */
export function mountPageRangeHelp(): void {
  document
    .querySelectorAll<HTMLElement>('[data-page-range-help]')
    .forEach((slot) => {
      const help = pageRangeHelp();
      // A page may leave out the blank line (a range is required there).
      if (slot.dataset.pageRangeHelp === 'required')
        help.querySelector('tr')?.remove();
      slot.replaceWith(help);
    });
}
