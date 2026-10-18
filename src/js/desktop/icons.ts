/**
 * One icon family in the app. The desktop shell draws Phosphor; the tool
 * pages ask for Lucide (`<i data-lucide="…">`, turned into an <svg> by
 * `createIcons`). Each Lucide icon that has a Phosphor counterpart
 * (icon-map.ts) is swapped for it, at load and whenever a page adds or
 * redraws one. Unmapped names keep their Lucide drawing.
 *
 * The swap keeps `data-lucide` and the element's own classes, so page code
 * that finds an icon by that attribute (the password field's eye) and calls
 * `createIcons` again still works: Lucide redraws it, and it is swapped back.
 */
import { LUCIDE_TO_PHOSPHOR } from './icon-map.js';

// Tailwind sizing on the icon (w-4, h-5, size-6): Phosphor is sized by font.
const SIZE_CLASS = /^(?:w|h|size)-(\d+(?:\.5)?)$/;
// Lucide's own default when the page gives no size.
const DEFAULT_SIZE = '1.5rem';

function iconSize(classes: string[]): string {
  for (const name of classes) {
    const match = SIZE_CLASS.exec(name);
    if (match) return `${Number(match[1]) * 0.25}rem`;
  }
  return DEFAULT_SIZE;
}

function swap(element: Element): void {
  const name = element.getAttribute('data-lucide');
  const phosphor = name ? LUCIDE_TO_PHOSPHOR[name] : undefined;
  if (!name || !phosphor) return;
  if (
    element.tagName === 'I' &&
    (element as HTMLElement).dataset.phosphor === phosphor
  ) {
    return;
  }
  const own = [...element.classList].filter(
    (c) => !/^(lucide|ph$|ph-|cit-icon$)/.test(c)
  );
  const icon = document.createElement('i');
  icon.className = ['ph', `ph-${phosphor}`, 'cit-icon', ...own].join(' ');
  icon.setAttribute('data-lucide', name);
  icon.dataset.phosphor = phosphor;
  icon.setAttribute('aria-hidden', 'true');
  if (element.id) icon.id = element.id;
  const style = element.getAttribute('style');
  if (style) icon.setAttribute('style', style);
  icon.style.fontSize = iconSize(own);
  element.replaceWith(icon);
}

function swapAll(root: ParentNode): void {
  for (const element of root.querySelectorAll('[data-lucide]')) swap(element);
}

export function initIconFamily(): void {
  swapAll(document);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.hasAttribute('data-lucide')) swap(node);
        else if (node.firstElementChild) swapAll(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
