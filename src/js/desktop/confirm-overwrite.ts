/**
 * Asked the first time "Save" would replace the file a tool opened: replace
 * it, save a new copy instead, or cancel. "Don't ask again" makes Save
 * replace from then on.
 */
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import { ds } from './strings.js';

const CONFIRMED_KEY = 'cit:overwrite-confirmed';

export type OverwriteAnswer = 'overwrite' | 'saveAs' | 'cancel';

export function overwriteConfirmed(): boolean {
  return getStoredItem(CONFIRMED_KEY) === '1';
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function confirmOverwrite(fileName: string): Promise<OverwriteAnswer> {
  document.getElementById('desktop-confirm-overwrite')?.remove();
  return new Promise((resolve) => {
    const overlay = make(
      'div',
      'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
    );
    overlay.id = 'desktop-confirm-overwrite';
    const dialog = make(
      'div',
      'w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-2xl'
    );
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = make(
      'h2',
      'text-lg font-bold text-white',
      ds('overwriteTitle')
    );
    title.id = 'desktop-confirm-overwrite-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const body = make('p', 'mt-2 text-sm text-gray-300');
    body.append(
      ds('overwriteBefore'),
      make('strong', 'font-semibold text-white', fileName),
      ds('overwriteAfter')
    );

    const remember = make(
      'label',
      'mt-4 flex cursor-pointer items-center gap-2 text-sm text-gray-300'
    );
    const box = make('input', 'h-4 w-4');
    box.type = 'checkbox';
    box.style.accentColor = 'var(--color-indigo-600)';
    remember.append(box, make('span', '', ds('overwriteDontAsk')));

    const actions = make('div', 'mt-6 flex flex-wrap justify-end gap-2');
    const button = (
      label: string,
      className: string,
      answer: OverwriteAnswer
    ) => {
      const b = make('button', className, label);
      b.type = 'button';
      b.addEventListener('click', () => finish(answer));
      return b;
    };
    const cancel = button(
      ds('cancel'),
      'rounded-lg px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700',
      'cancel'
    );
    const copy = button(
      ds('overwriteSaveCopy'),
      'rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700',
      'saveAs'
    );
    const replace = button(
      ds('overwriteReplace'),
      'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700',
      'overwrite'
    );
    actions.append(cancel, copy, replace);
    dialog.append(title, body, remember, actions);
    overlay.append(dialog);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish('cancel');
      }
    };
    function finish(answer: OverwriteAnswer): void {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (answer === 'overwrite' && box.checked) {
        setStoredItem(CONFIRMED_KEY, '1');
      }
      resolve(answer);
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish('cancel');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    replace.focus();
  });
}
