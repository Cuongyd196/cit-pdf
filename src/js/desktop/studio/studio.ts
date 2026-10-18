/**
 * Studio: tools applied in place to the document on screen in the viewer,
 * with undo, saved once at the end (over the original, or as a new file).
 * The drawer on the right lists the tools; the quick-action row carries the
 * Studio button and, once a document has changes, Undo, Redo and Save.
 */
import { downloadFile } from '../../utils/helpers.js';
import { getStoredItem, setStoredItem } from '../../utils/safe-storage.js';
import {
  VIEWER_KEYDOWN_EVENT,
  setCloseGuard,
  whenViewerDocuments,
  type ViewerDocuments,
} from '../../logic/viewer-document.js';
import {
  VIEWER_TABS_EVENT,
  type ViewerTabsDetail,
} from '../../logic/view-pdf-events.js';
import { getBridge, type OpenedFile, type SaveMode } from '../bridge.js';
import { confirmOverwrite, overwriteConfirmed } from '../confirm-overwrite.js';
import { ds } from '../strings.js';
import { EditHistory } from './history.js';
import {
  STUDIO_TOOLS,
  StudioInputError,
  type StudioField,
  type StudioTool,
  type StudioValues,
} from './tools.js';

const OPEN_KEY = 'cit:studio-open';

export interface StudioOptions {
  /** The quick-action row above the document. */
  row: HTMLElement;
  /** The file on disk behind the tab on screen, if it has one. */
  currentFile: () => OpenedFile | null;
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

function icon(name: string): HTMLElement {
  return make('i', `ph ph-${name}`);
}

function iconButton(
  name: string,
  title: string,
  className = 'pdf-view-action pdf-view-action-icon'
): HTMLButtonElement {
  const button = make('button', className);
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(icon(name));
  return button;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim();

/** 2: the name matches, 1: only the description, 0: no match. */
function score(tool: StudioTool, query: string): number {
  const q = fold(query);
  if (fold(ds(tool.name)).includes(q)) return 2;
  return fold(ds(tool.hint)).includes(q) ? 1 : 0;
}

/** Tools for a search, those named after it first. */
function search(query: string): StudioTool[] {
  return STUDIO_TOOLS.map((tool) => ({ tool, score: score(tool, query) }))
    .filter((found) => found.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((found) => found.tool);
}

/** Asked before a tab with unsaved changes closes. */
function confirmDiscard(name: string): Promise<boolean> {
  document.getElementById('studio-confirm-discard')?.remove();
  return new Promise((resolve) => {
    const overlay = make(
      'div',
      'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
    );
    overlay.id = 'studio-confirm-discard';
    const dialog = make(
      'div',
      'w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-2xl'
    );
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = make(
      'h2',
      'text-lg font-bold text-white',
      ds('studioDiscardTitle')
    );
    title.id = 'studio-confirm-discard-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const body = make(
      'p',
      'mt-2 text-sm text-gray-300',
      ds('studioDiscardBody', { name })
    );
    const actions = make('div', 'mt-6 flex justify-end gap-2');
    const stay = make(
      'button',
      'rounded-lg px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700',
      ds('cancel')
    );
    const discard = make(
      'button',
      'rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800',
      ds('studioDiscard')
    );
    stay.type = discard.type = 'button';
    actions.append(stay, discard);
    dialog.append(title, body, actions);
    overlay.append(dialog);

    const finish = (answer: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish(false);
    };
    stay.addEventListener('click', () => finish(false));
    discard.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    stay.focus();
  });
}

export async function initStudio(options: StudioOptions): Promise<void> {
  const drawer = document.getElementById('studio-drawer');
  const bridge = getBridge();
  if (!drawer || !bridge) return;
  const docs: ViewerDocuments = await whenViewerDocuments();

  const histories = new Map<File, EditHistory>();
  let tool: StudioTool | null = null;
  let busy = false;
  let pendingSave: { file: File; bytes: Uint8Array } | null = null;
  let message: { text: string; error: boolean } | null = null;

  // ---- Studio button on the quick-action row
  const toggle = make('button', 'pdf-view-action studio-toggle');
  toggle.type = 'button';
  toggle.title = ds('studioOpenHint');
  toggle.append(icon('toolbox'), make('span', '', ds('studioOpen')));
  toggle.addEventListener('click', () => setOpen(drawer.hidden));
  const divider = options.row.querySelector('.pdf-view-actions-divider');
  if (divider) divider.after(toggle, make('span', 'pdf-view-actions-divider'));
  else options.row.prepend(toggle);

  // ---- Undo, Redo, Save on the same row, once there are changes
  const cluster = make('div', 'studio-cluster hidden');
  const undo = iconButton('arrow-counter-clockwise', ds('studioUndo'));
  const redo = iconButton('arrow-clockwise', ds('studioRedo'));
  const unsaved = make('span', 'studio-unsaved', ds('studioUnsaved'));
  const saveAs = make('button', 'pdf-view-action studio-save-as');
  saveAs.type = 'button';
  saveAs.title = ds('saveAsHint');
  saveAs.append(icon('copy'), make('span', '', ds('workspaceSaveAs')));
  const save = make('button', 'studio-save');
  save.type = 'button';
  save.title = ds('studioSaveHint');
  save.append(icon('floppy-disk'), make('span', '', ds('studioSave')));
  cluster.append(undo, redo, unsaved, saveAs, save);
  options.row.append(cluster);
  undo.addEventListener('click', () => void step('undo'));
  redo.addEventListener('click', () => void step('redo'));
  saveAs.addEventListener('click', () => void saveActive(true));
  save.addEventListener('click', () => void saveActive(false));

  // ---- Drawer
  const head = make('div', 'studio-head');
  const title = make('h2', 'studio-title', ds('studioOpen'));
  const close = iconButton('x', ds('studioClose'), 'studio-icon-button');
  close.addEventListener('click', () => setOpen(false));
  head.append(title, close);
  const body = make('div', 'studio-body');
  const historyBox = make('section', 'studio-history');
  drawer.replaceChildren(head, body, historyBox);

  function setOpen(open: boolean): void {
    drawer!.hidden = !open;
    drawer!.classList.toggle('hidden', !open);
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    setStoredItem(OPEN_KEY, open ? '1' : '0');
    if (open && !tool) {
      window.setTimeout(() =>
        body.querySelector<HTMLInputElement>('.studio-search')?.focus()
      );
    }
  }

  function activeHistory(): EditHistory | undefined {
    const file = docs.active();
    return file ? histories.get(file) : undefined;
  }

  function showList(query = ''): void {
    tool = null;
    message = null;
    const input = make('input', 'studio-search');
    input.type = 'search';
    input.placeholder = ds('studioSearch');
    input.value = query;
    const list = make('div', 'studio-tools');
    const fill = () => {
      const found = search(input.value);
      list.replaceChildren(
        ...found.map((t) => {
          const item = make('button', 'studio-tool');
          item.type = 'button';
          item.dataset.tool = t.id;
          const text = make('span', 'min-w-0');
          text.append(
            make('span', 'studio-tool-name', ds(t.name)),
            make('span', 'studio-tool-hint', ds(t.hint))
          );
          item.append(icon(t.icon), text);
          item.addEventListener('click', () => showTool(t));
          return item;
        })
      );
      if (found.length === 0) {
        list.append(make('p', 'studio-empty', ds('studioNoResults')));
      }
    };
    input.addEventListener('input', fill);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = search(input.value)[0];
      if (first) showTool(first);
    });
    fill();
    body.replaceChildren(input, list);
    render();
  }

  function fieldInput(field: StudioField): HTMLElement {
    let input: HTMLInputElement | HTMLSelectElement;
    if (field.kind === 'select') {
      input = make('select', 'studio-input');
      for (const [value, label] of field.options) {
        const option = make('option', '', ds(label));
        option.value = value;
        input.append(option);
      }
      input.value = field.value;
    } else {
      input = make(
        'input',
        field.kind === 'color' ? 'studio-color' : 'studio-input'
      );
      input.type = field.kind;
      if (field.kind === 'number') {
        input.min = String(field.min);
        input.max = String(field.max);
      }
      if (field.kind === 'text' && field.placeholder) {
        input.placeholder = ds(field.placeholder);
      }
      input.value = String(field.value);
    }
    input.name = field.id;
    input.id = `studio-field-${field.id}`;
    const label = make('label', 'studio-label', ds(field.label));
    label.htmlFor = input.id;
    const wrap = make('div', 'studio-field');
    wrap.append(label, input);
    return wrap;
  }

  function showTool(next: StudioTool): void {
    tool = next;
    message = null;
    const back = make('button', 'studio-back');
    back.type = 'button';
    back.append(icon('caret-left'), make('span', '', ds('studioBack')));
    back.addEventListener('click', () => showList());
    const heading = make('div', 'studio-tool-head');
    heading.append(
      icon(next.icon),
      make('h3', 'studio-tool-title', ds(next.name))
    );
    const hint = make('p', 'studio-tool-hint', ds(next.hint));
    const form = make('form', 'studio-form');
    form.noValidate = true;
    form.append(...next.fields.map(fieldInput));
    const note = make('p', 'studio-message');
    note.setAttribute('role', 'status');
    const apply = make('button', 'studio-apply');
    apply.type = 'submit';
    apply.textContent = ds('studioApply');
    form.append(note, apply);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values: StudioValues = {};
      for (const field of next.fields) {
        const input = form.elements.namedItem(field.id) as
          | HTMLInputElement
          | HTMLSelectElement
          | null;
        values[field.id] = input?.value ?? String(field.value);
      }
      void applyTool(next, values);
    });
    body.replaceChildren(back, heading, hint, form);
    render();
    form.querySelector<HTMLElement>('input, select')?.focus();
  }

  async function show(file: File, bytes: Uint8Array): Promise<void> {
    await docs.show(file, bytes);
    docs.setDirty(file, histories.get(file)?.dirty ?? false);
  }

  async function applyTool(
    which: StudioTool,
    values: StudioValues
  ): Promise<void> {
    const file = docs.active();
    if (!file || busy) return;
    busy = true;
    message = null;
    render();
    try {
      let history = histories.get(file);
      if (!history) {
        history = new EditHistory(new Uint8Array(await file.arrayBuffer()));
        histories.set(file, history);
      }
      const result = await which.apply(history.current, values);
      history.push(result.label, result.bytes);
      await show(file, result.bytes);
      message = {
        text: ds('studioApplied', { step: result.label }),
        error: false,
      };
    } catch (e) {
      if (!(e instanceof StudioInputError)) console.error('[Studio]', e);
      message = {
        text: e instanceof StudioInputError ? e.message : ds('studioFailed'),
        error: true,
      };
    } finally {
      busy = false;
      render();
    }
  }

  async function step(kind: 'undo' | 'redo' | 'revert'): Promise<void> {
    const file = docs.active();
    const history = file ? histories.get(file) : undefined;
    if (!file || !history || busy) return;
    const bytes =
      kind === 'undo'
        ? history.undo()
        : kind === 'redo'
          ? history.redo()
          : history.revert(ds('studioRevert'));
    if (!bytes) return;
    busy = true;
    message = null;
    render();
    try {
      await show(file, bytes);
    } finally {
      busy = false;
      render();
    }
  }

  /** Saves the tab on screen; false when it has nothing Studio changed. */
  async function saveActive(asCopy: boolean): Promise<boolean> {
    const file = docs.active();
    const history = file ? histories.get(file) : undefined;
    if (!file || !history || busy) return false;
    if (!asCopy && !history.dirty) return true;
    const opened = options.currentFile();
    const onDisk = opened && opened.name === file.name ? opened : null;
    let mode: SaveMode | null = asCopy ? 'saveAs' : onDisk ? 'overwrite' : null;
    if (mode === 'overwrite' && onDisk && !overwriteConfirmed()) {
      const answer = await confirmOverwrite(onDisk.name);
      if (answer === 'cancel') return true;
      mode = answer;
    }
    if (mode && onDisk) await bridge!.setSaveTarget(mode, onDisk.path);
    const bytes = history.current;
    pendingSave = { file, bytes };
    downloadFile(
      new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      file.name
    );
    return true;
  }

  // A save reported by the main process clears the tab's "unsaved" mark.
  bridge.onDownloadSaved(() => {
    if (!pendingSave) return;
    const { file, bytes } = pendingSave;
    pendingSave = null;
    const history = histories.get(file);
    if (!history) return;
    history.markSaved(bytes);
    docs.setDirty(file, history.dirty);
    render();
  });

  function renderHistory(history: EditHistory | undefined): void {
    const heading = make('h3', 'studio-history-title', ds('studioHistory'));
    if (!history || (history.steps.length === 0 && !history.canRedo)) {
      historyBox.replaceChildren(
        heading,
        make('p', 'studio-empty', ds('studioHistoryEmpty'))
      );
      return;
    }
    const list = make('ol', 'studio-steps');
    const item = (text: string, state: 'done' | 'current' | 'undone') =>
      list.append(make('li', `studio-step ${state}`, text));
    const steps = history.steps;
    item(ds('studioOriginal'), steps.length === 0 ? 'current' : 'done');
    steps.forEach((label, i) =>
      item(label, i === steps.length - 1 ? 'current' : 'done')
    );
    history.undone.forEach((label) => item(label, 'undone'));
    const revert = make('button', 'studio-revert');
    revert.type = 'button';
    revert.append(
      icon('clock-counter-clockwise'),
      make('span', '', ds('studioRevert'))
    );
    revert.disabled = busy || history.current === history.original;
    revert.addEventListener('click', () => void step('revert'));
    historyBox.replaceChildren(heading, list, revert);
    list.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  function render(): void {
    const file = docs.active();
    const history = activeHistory();
    cluster.classList.toggle('hidden', !history);
    undo.disabled = busy || !history?.canUndo;
    redo.disabled = busy || !history?.canRedo;
    const dirty = Boolean(history?.dirty);
    unsaved.hidden = !dirty;
    save.disabled = busy || !dirty;
    saveAs.disabled = busy;
    const onDisk = options.currentFile();
    save.title =
      onDisk && file && onDisk.name === file.name
        ? ds('saveOverwriteHint', { name: onDisk.name })
        : ds('studioSaveHint');

    const apply = body.querySelector<HTMLButtonElement>('.studio-apply');
    if (apply) {
      apply.disabled = busy || !file;
      apply.textContent = ds(busy ? 'studioApplying' : 'studioApply');
    }
    const note = body.querySelector<HTMLElement>('.studio-message');
    if (note) {
      note.textContent = message?.text ?? '';
      note.classList.toggle('error', Boolean(message?.error));
    }
    drawer!.classList.toggle('busy', busy);
    renderHistory(history);
  }

  // Tabs come and go: drop what closed tabs kept, follow the one on screen.
  document.addEventListener(VIEWER_TABS_EVENT, (event) => {
    const { files } = (event as CustomEvent<ViewerTabsDetail>).detail;
    for (const file of [...histories.keys()]) {
      if (!files.includes(file)) histories.delete(file);
    }
    if (pendingSave && !files.includes(pendingSave.file)) pendingSave = null;
    message = null;
    render();
  });

  setCloseGuard((file) => confirmDiscard(file.name));

  // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) / Ctrl+S (Ctrl+Shift+S), in the page and
  // in the viewer frames. Typing in a field keeps its own undo.
  const onKey = (e: KeyboardEvent): boolean => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const key = e.key.toLowerCase();
    // Duck-typed: a key from a viewer frame has a target from another realm.
    const target = e.target as Element | null;
    const typing =
      typeof target?.closest === 'function' &&
      target.closest('input, textarea, select, [contenteditable]') !== null;
    if (key === 's') {
      if (!activeHistory()) return false;
      void saveActive(e.shiftKey);
      return true;
    }
    if (typing || !activeHistory()) return false;
    if (key === 'z' && !e.shiftKey) {
      void step('undo');
      return true;
    }
    if (key === 'y' || (key === 'z' && e.shiftKey)) {
      void step('redo');
      return true;
    }
    return false;
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (onKey(e)) e.preventDefault();
    },
    true
  );
  document.addEventListener(VIEWER_KEYDOWN_EVENT, (event) => {
    if (onKey((event as CustomEvent<KeyboardEvent>).detail)) {
      event.preventDefault();
    }
  });

  showList();
  setOpen(getStoredItem(OPEN_KEY) === '1');
}
