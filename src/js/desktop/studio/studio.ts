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
import type { MenuChoice } from '../menu.js';
import { ds, type DesktopStringKey } from '../strings.js';
import {
  exportEmbedEditorPdf,
  startEmbedEditor,
} from '../../logic/embed-editor.js';
import { EditHistory } from './history.js';
import {
  STUDIO_TOOLS,
  StudioInputError,
  type StudioField,
  type StudioTool,
  type StudioValues,
} from './tools.js';

const OPEN_KEY = 'cit:studio-open';

// On the row above the document, by tool id, with the label they get there;
// the rest of Studio's tools are in its "More" menu.
const ROW_TOOLS: Array<[string, DesktopStringKey]> = [
  ['edit', 'studioEdit'],
  ['rotate', 'quickRotate'],
  ['compress', 'quickCompress'],
  ['delete-pages', 'studioDelete'],
  ['insert', 'studioInsertShort'],
  ['extract', 'studioExtractShort'],
];
const MORE_TOOLS = ['watermark', 'page-numbers', 'flatten'];

export interface StudioOptions {
  /** The quick-action row above the document. */
  row: HTMLElement;
  /** The file on disk behind the tab on screen, if it has one. */
  currentFile: () => OpenedFile | null;
  /** Hands the tools not on the row to the row's "Other tools" menu. */
  inPlaceChoices: (list: () => MenuChoice[]) => void;
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
  // The full editor, open over one document's viewer.
  let editing: {
    file: File;
    host: HTMLElement;
    registry: Awaited<ReturnType<typeof startEmbedEditor>>['registry'] | null;
    drawerWasOpen: boolean;
  } | null = null;

  // ---- Tools on the row above the document: each opens its options in the
  // drawer (or, for editing, the editor itself).
  const toolById = (id: string) => STUDIO_TOOLS.find((t) => t.id === id);
  const openTool = (next: StudioTool) => {
    if (next.opensEditor) {
      void startEditing();
      return;
    }
    // Its button again closes the drawer.
    if (!drawer.hidden && tool === next) {
      setOpen(false);
      return;
    }
    showTool(next);
    setOpen(true);
  };
  const rowButtons = new Map<string, HTMLElement>();
  for (const [id, label] of ROW_TOOLS) {
    const rowTool = toolById(id);
    if (!rowTool) continue;
    const button = make('button', 'pdf-view-action studio-row-tool');
    button.type = 'button';
    button.dataset.tool = id;
    button.title = ds(rowTool.hint);
    button.append(icon(rowTool.icon), make('span', '', ds(label)));
    button.addEventListener('click', () => openTool(rowTool));
    rowButtons.set(id, button);
  }
  options.inPlaceChoices(() =>
    MORE_TOOLS.flatMap((id) => {
      const moreTool = toolById(id);
      return moreTool
        ? [
            {
              icon: `ph-${moreTool.icon}`,
              label: ds(moreTool.name),
              id,
              run: () => openTool(moreTool),
            },
          ]
        : [];
    })
  );
  const divider = options.row.querySelector('.pdf-view-actions-divider');
  if (divider) divider.after(...rowButtons.values());
  else options.row.prepend(...rowButtons.values());

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
    setStoredItem(OPEN_KEY, open ? '1' : '0');
    render();
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
          item.addEventListener('click', () => pick(t));
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
      if (first) pick(first);
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
        field.kind === 'color'
          ? 'studio-color'
          : field.kind === 'file'
            ? 'studio-file'
            : 'studio-input'
      );
      input.type = field.kind;
      if (field.kind === 'file') input.accept = '.pdf,application/pdf';
      if (field.kind === 'number') {
        input.min = String(field.min);
        input.max = String(field.max);
      }
      if (field.kind === 'text' && field.placeholder) {
        input.placeholder = ds(field.placeholder);
      }
      if (field.kind !== 'file') input.value = String(field.value);
    }
    input.name = field.id;
    input.id = `studio-field-${field.id}`;
    const label = make('label', 'studio-label', ds(field.label));
    label.htmlFor = input.id;
    const wrap = make('div', 'studio-field');
    wrap.dataset.field = field.id;
    if (field.kind === 'file' && input instanceof HTMLInputElement) {
      // The system's own button speaks the system's language; ours, the app's.
      const file = input;
      file.hidden = true;
      const pick = make('button', 'studio-file-pick');
      pick.type = 'button';
      pick.append(
        icon('folder-open'),
        make('span', '', ds('studioChooseFile'))
      );
      const chosen = make('span', 'studio-file-name', ds('studioNoFile'));
      pick.addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        chosen.textContent = file.files?.[0]?.name ?? ds('studioNoFile');
        chosen.classList.toggle('chosen', Boolean(file.files?.[0]));
      });
      const row = make('div', 'studio-file-row');
      row.append(pick, chosen);
      wrap.append(label, file, row);
      return wrap;
    }
    if (field.kind === 'number' && field.shownWhen) wrap.hidden = true;
    wrap.append(label, input);
    return wrap;
  }

  /** Shows the fields that depend on another field's value. */
  function followShownWhen(form: HTMLFormElement, fields: StudioField[]): void {
    const update = () => {
      for (const field of fields) {
        if (field.kind !== 'number' || !field.shownWhen) continue;
        const other = form.elements.namedItem(
          field.shownWhen.field
        ) as HTMLSelectElement | null;
        const wrap = form.querySelector<HTMLElement>(
          `[data-field="${field.id}"]`
        );
        if (wrap) wrap.hidden = other?.value !== field.shownWhen.value;
      }
    };
    form.addEventListener('change', update);
    update();
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
    followShownWhen(form, next.fields);
    const note = make('p', 'studio-message');
    note.setAttribute('role', 'status');
    const apply = make('button', 'studio-apply');
    apply.type = 'submit';
    apply.textContent = ds('studioApply');
    form.append(note, apply);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values: StudioValues = {};
      const files: Record<string, File | undefined> = {};
      for (const field of next.fields) {
        const input = form.elements.namedItem(field.id) as
          | HTMLInputElement
          | HTMLSelectElement
          | null;
        values[field.id] = input?.value ?? String(field.value);
        if (field.kind === 'file' && input instanceof HTMLInputElement) {
          files[field.id] = input.files?.[0];
        }
      }
      void applyTool(next, values, files);
    });
    body.replaceChildren(back, heading, hint, form);
    render();
    form.querySelector<HTMLElement>('input, select')?.focus();
  }

  function pick(next: StudioTool): void {
    if (next.opensEditor) void startEditing();
    else showTool(next);
  }

  async function historyFor(file: File): Promise<EditHistory> {
    const known = histories.get(file);
    if (known) return known;
    const buffer = await file.arrayBuffer();
    const made = histories.get(file);
    if (made) return made;
    const history = new EditHistory(new Uint8Array(buffer));
    histories.set(file, history);
    return history;
  }

  /**
   * Opens the full editor over the document on screen, on its current
   * version. "Done" makes what was edited one step of the history.
   */
  async function startEditing(): Promise<void> {
    const file = docs.active();
    const container = document.getElementById('pdf-viewer-container');
    if (!file || !container || busy || editing) return;
    const history = await historyFor(file);

    const host = make('div', 'studio-edit');
    const bar = make('div', 'studio-edit-bar');
    const title = make('div', 'studio-edit-title');
    title.append(
      icon('pencil-simple-line'),
      make('span', 'font-semibold text-white', ds('studioEdit')),
      make('span', 'studio-edit-hint', ds('studioEditDoneHint'))
    );
    const note = make('span', 'studio-edit-note');
    note.setAttribute('role', 'status');
    const cancel = make('button', 'studio-edit-cancel', ds('cancel'));
    const done = make('button', 'studio-edit-done');
    cancel.type = done.type = 'button';
    done.append(icon('check'), make('span', '', ds('studioEditDone')));
    cancel.addEventListener('click', () => void finishEditing(false));
    done.addEventListener('click', () => void finishEditing(true));
    bar.append(title, note, cancel, done);
    const area = make('div', 'studio-edit-body');
    area.append(make('p', 'studio-edit-loading', ds('studioEditLoading')));
    host.append(bar, area);
    container.append(host);

    editing = {
      file,
      host,
      registry: null,
      drawerWasOpen: !drawer!.hidden,
    };
    setOpen(false);
    // Until "Done", leaving or closing the tab asks first.
    docs.setDirty(file, true);
    render();
    try {
      const started = await startEmbedEditor(area, {
        fileName: file.name,
        tabBar: 'never',
        maxDocuments: 1,
      });
      if (editing?.host !== host) {
        host.remove();
        return;
      }
      const manager = started.registry
        .getPlugin('document-manager')
        .provides() as unknown as {
        openDocumentBuffer(options: {
          buffer: ArrayBuffer;
          name: string;
          autoActivate: boolean;
        }): void;
      };
      manager.openDocumentBuffer({
        buffer: history.current.slice().buffer,
        name: file.name,
        autoActivate: true,
      });
      editing.registry = started.registry;
    } catch (e) {
      console.error('[Studio] The editor did not start:', e);
      note.textContent = ds('studioFailed');
    }
    render();
  }

  /** Leaves the editor, keeping what was edited as a step, or not. */
  async function finishEditing(keep: boolean): Promise<void> {
    const session = editing;
    if (!session || busy) return;
    const history = histories.get(session.file);
    if (keep && session.registry && history) {
      busy = true;
      render();
      const note = session.host.querySelector('.studio-edit-note');
      if (note) note.textContent = ds('studioApplying');
      try {
        const bytes = await exportEmbedEditorPdf(session.registry);
        history.push(ds('studioEdit'), bytes);
        editing = null;
        session.host.remove();
        await show(session.file, bytes);
      } catch (e) {
        console.error('[Studio] Could not take the edits:', e);
        if (note) note.textContent = ds('studioFailed');
        busy = false;
        render();
        return;
      } finally {
        busy = false;
      }
    } else {
      editing = null;
      session.host.remove();
      docs.setDirty(session.file, history?.dirty ?? false);
    }
    if (session.drawerWasOpen) setOpen(true);
    render();
  }

  async function show(file: File, bytes: Uint8Array): Promise<void> {
    await docs.show(file, bytes);
    docs.setDirty(file, histories.get(file)?.dirty ?? false);
  }

  async function applyTool(
    which: StudioTool,
    values: StudioValues,
    files: Record<string, File | undefined> = {}
  ): Promise<void> {
    const file = docs.active();
    if (!file || busy) return;
    busy = true;
    message = null;
    render();
    try {
      const history = await historyFor(file);
      const result = await which.apply(history.current, values, {
        files,
        fileName: file.name,
      });
      if (which.makesFile) {
        await saveNewFile(result.bytes, result.fileName ?? file.name);
        message = {
          text: ds('studioMadeFile', { name: result.fileName ?? file.name }),
          error: false,
        };
        return;
      }
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
    if (editing) return;
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

  /** A file made from the document, offered in its folder under its name. */
  async function saveNewFile(bytes: Uint8Array, name: string): Promise<void> {
    const file = docs.active();
    const opened = options.currentFile();
    if (file && opened && opened.name === file.name) {
      await bridge!.setSaveTarget('saveAs', opened.path);
    }
    downloadFile(
      new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      name
    );
  }

  /** Saves the tab on screen; false when it has nothing Studio changed. */
  async function saveActive(asCopy: boolean): Promise<boolean> {
    // Saving from the editor keeps what was edited first.
    if (editing) await finishEditing(true);
    if (editing) return true;
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
    // While the editor is open, its own undo applies.
    undo.disabled = busy || Boolean(editing) || !history?.canUndo;
    redo.disabled = busy || Boolean(editing) || !history?.canRedo;
    const dirty = Boolean(history?.dirty) || Boolean(editing);
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
    // The row shows which tool the drawer holds.
    const shown = drawer!.hidden ? null : tool?.id;
    for (const [id, button] of rowButtons) {
      button.classList.toggle(
        'active',
        id === shown || (id === 'edit' && Boolean(editing))
      );
    }
    options.row
      .querySelector('.studio-more')
      ?.classList.toggle(
        'active',
        Boolean(shown && MORE_TOOLS.includes(shown))
      );
    renderHistory(history);
  }

  // Tabs come and go: drop what closed tabs kept, follow the one on screen.
  document.addEventListener(VIEWER_TABS_EVENT, (event) => {
    const { files } = (event as CustomEvent<ViewerTabsDetail>).detail;
    for (const file of [...histories.keys()]) {
      if (!files.includes(file)) histories.delete(file);
    }
    if (pendingSave && !files.includes(pendingSave.file)) pendingSave = null;
    if (editing && !files.includes(editing.file)) {
      // Its tab was closed (the user chose to discard).
      editing.host.remove();
      editing = null;
    } else if (editing && docs.active() !== editing.file) {
      // Another tab: keep what was edited, then show that tab.
      void finishEditing(true);
    }
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
      if (!activeHistory() && !editing) return false;
      void saveActive(e.shiftKey);
      return true;
    }
    // In the editor, Ctrl+Z / Ctrl+Y are its own.
    if (typing || editing || !activeHistory()) return false;
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
