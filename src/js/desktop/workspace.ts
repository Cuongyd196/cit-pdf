/**
 * Tool workspace (desktop only). A tool page starts as a card: title,
 * description, drop zone. Once a file is open in a tool that works on the
 * page itself (the PDF editor, Sign) or shows every page (Organize, Rotate,
 * Delete pages), that card only pushes the work down the window. The page then switches to a workspace: one slim bar
 * (back, tool name, the file, the tool's options, Save) above a working
 * area that fills the rest of the window.
 *
 * Controls are moved onto the bar, not copied, so the tool's own code keeps
 * finding them by id and keeps its listeners.
 */
import { getBridge, type OpenedFile, type SaveMode } from './bridge.js';
import { confirmOverwrite, overwriteConfirmed } from './confirm-overwrite.js';
import { ds, type DesktopStringKey } from './strings.js';

interface WorkspaceTool {
  /** The tool's working area, shown once a file is open. */
  area: string;
  /**
   * "fill": the area is a viewer that takes the whole height (default).
   * "scroll": the area is page thumbnails that scroll under the bar.
   */
  layout?: 'fill' | 'scroll';
  /** Show the open file (the first row of #file-display-area) on the bar. */
  file?: boolean;
  /** Controls moved onto the bar, in order. */
  controls?: string[];
  /** New text for a moved label or button, by selector. */
  relabel?: Record<string, DesktopStringKey>;
  /** A short caption put before a moved control (an input on its own). */
  captions?: Record<string, DesktopStringKey>;
  /** Moved buttons drawn in the accent colour (the others are plain). */
  accent?: string[];
  /** A control's hint text, read from an element that is then hidden. */
  hints?: Array<[control: string, from: string]>;
  /** The tool's save button; it may appear only once the area is ready. */
  save?: string;
  /** Containers the moved controls leave behind, hidden in the workspace. */
  leftovers?: string[];
  /**
   * "Save" may replace the file the tool opened (with "Save as…" beside it):
   * true when the bar shows that same file, or a check of its own.
   */
  overwrite?: true | ((file: OpenedFile) => boolean);
}

/**
 * The PDF editor exports the document on screen but names it after the first
 * one opened, so it replaces a file only while it holds just that file. Its
 * page lists the open documents in data-editor-documents.
 */
function editorHoldsOnly(file: OpenedFile): boolean {
  try {
    const names = JSON.parse(document.body.dataset.editorDocuments || '[]');
    return Array.isArray(names) && names.length === 1 && names[0] === file.name;
  } catch {
    return false;
  }
}

const WORKSPACE_TOOLS: Record<string, WorkspaceTool> = {
  'edit-pdf': {
    area: '#embed-pdf-wrapper',
    save: '#download-edited-pdf',
    overwrite: editorHoldsOnly,
  },
  'sign-pdf': {
    area: '#signature-editor',
    file: true,
    controls: [
      '#sign-image-btn',
      'label:has(#sign-image-clear-white)',
      'label:has(#flatten-signature-toggle)',
    ],
    relabel: { 'label:has(#flatten-signature-toggle)': 'workspaceFlatten' },
    accent: ['#sign-image-btn'],
    hints: [
      ['#sign-image-btn', '#signature-editor > div:has(#sign-image-btn) > p'],
    ],
    save: '#process-btn',
    overwrite: true,
    leftovers: [
      '#signature-editor > div:has(#sign-image-btn)',
      '#signature-editor > div:has(#flatten-signature-toggle)',
    ],
  },
  'organize-pdf': {
    area: '#page-grid',
    layout: 'scroll',
    file: true,
    controls: ['#page-order-input', '#apply-order-btn'],
    captions: { '#page-order-input': 'workspacePageOrder' },
    save: '#process-btn',
    overwrite: true,
    leftovers: ['#advanced-settings'],
  },
  'rotate-pdf': {
    area: '#tool-options',
    layout: 'scroll',
    file: true,
    controls: ['#rotate-all-left', '#rotate-all-right'],
    captions: { '#rotate-all-left': 'workspaceRotateAll' },
    save: '#process-btn',
    overwrite: true,
    leftovers: ['#tool-options > div:has(#rotate-all-left)'],
  },
  'rotate-custom': {
    area: '#tool-options',
    layout: 'scroll',
    file: true,
    controls: [
      '#batch-decrement',
      '#batch-custom-angle',
      '#batch-increment',
      '#batch-apply',
    ],
    captions: { '#batch-decrement': 'workspaceRotateAll' },
    save: '#process-btn',
    overwrite: true,
    leftovers: ['#tool-options > div:has(#batch-apply)'],
  },
  'delete-pages': {
    area: '#delete-options',
    layout: 'scroll',
    file: true,
    controls: ['#pages-to-delete'],
    captions: { '#pages-to-delete': 'workspaceDeletePages' },
    save: '#process-btn',
    overwrite: true,
    leftovers: ['label[for="pages-to-delete"]'],
  },
};

export interface WorkspaceOptions {
  /** Back: to the document in the viewer, or to the tools. */
  back: () => void;
  /** Shrinks the sidebar to its rail while the workspace is on. */
  setReading: (on: boolean) => void;
  /** The file this page works on, when the app knows where it is on disk. */
  currentFile: () => OpenedFile | null;
}

function pageSlug(): string {
  const last = window.location.pathname.split('/').pop() || '';
  return last.replace(/\.html$/, '');
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

function icon(name: string): HTMLElement {
  const i = make('i', `ph ph-${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Replaces a label's or button's own text, keeping its input or icon. */
function relabel(control: Element, text: string): void {
  for (const node of [...control.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) node.remove();
    else if (node instanceof HTMLSpanElement) node.remove();
  }
  control.append(make('span', '', text));
}

export function initToolWorkspace(options: WorkspaceOptions): void {
  const tool = WORKSPACE_TOOLS[pageSlug()];
  const uploader = document.getElementById('uploader');
  const area = tool && document.querySelector<HTMLElement>(tool.area);
  if (!tool || !uploader || !area) return;

  const leftovers = (tool.leftovers ?? []).flatMap((selector) => [
    ...document.querySelectorAll<HTMLElement>(selector),
  ]);

  const bar = make('div', 'desktop-workspace-bar');
  const back = make('button', 'desktop-workspace-icon');
  back.type = 'button';
  back.title = ds('workspaceBack');
  back.setAttribute('aria-label', back.title);
  back.append(icon('arrow-left'));
  back.addEventListener('click', options.back);

  const title = make('span', 'desktop-workspace-title');
  bar.append(back, title);

  let fileName: HTMLElement | null = null;
  let fileMeta: HTMLElement | null = null;
  const fileRow = () =>
    document.querySelector<HTMLElement>('#file-display-area > div');
  if (tool.file) {
    const file = make('span', 'desktop-workspace-file');
    fileName = make('span', 'desktop-workspace-file-name');
    fileMeta = make('span', 'desktop-workspace-file-meta');
    file.append(icon('file-pdf'), fileName, fileMeta);

    const change = make('button', 'desktop-workspace-button');
    change.type = 'button';
    change.append(
      icon('folder-open'),
      make('span', '', ds('workspaceChangeFile'))
    );
    change.addEventListener('click', () =>
      document.getElementById('file-input')?.click()
    );

    const close = make('button', 'desktop-workspace-icon danger');
    close.type = 'button';
    close.title = ds('workspaceCloseFile');
    close.setAttribute('aria-label', close.title);
    close.append(icon('trash'));
    close.addEventListener('click', () => {
      const buttons = fileRow()?.querySelectorAll('button');
      buttons?.[buttons.length - 1]?.click();
    });

    bar.append(make('span', 'desktop-workspace-divider'), file, change, close);
  }

  bar.append(make('span', 'desktop-workspace-spacer'));
  const controls = make('div', 'desktop-workspace-controls');
  bar.append(controls);

  // "Save as…" sits before Save, shown while Save would replace the file.
  const saveAs = make(
    'button',
    'desktop-workspace-button desktop-workspace-save-as'
  );
  saveAs.type = 'button';
  saveAs.hidden = true;
  saveAs.title = ds('saveAsHint');
  saveAs.setAttribute('aria-label', ds('workspaceSaveAs'));
  saveAs.append(icon('copy'), make('span', '', ds('workspaceSaveAs')));
  bar.append(saveAs);
  uploader.prepend(bar);

  // Moves what exists now; the rest (a save button made once the viewer is
  // up) is picked up as it appears.
  const moved = new Set<string>();
  const adopt = (): void => {
    for (const selector of tool.controls ?? []) {
      if (moved.has(selector)) continue;
      const control = document.querySelector<HTMLElement>(selector);
      if (!control) continue;
      moved.add(selector);
      const key = tool.relabel?.[selector];
      if (key) relabel(control, ds(key));
      control.className =
        control.tagName === 'LABEL'
          ? 'desktop-workspace-check'
          : control.tagName === 'INPUT'
            ? 'desktop-workspace-input'
            : 'desktop-workspace-button' +
              (tool.accent?.includes(selector) ? ' accent' : '');
      const caption = tool.captions?.[selector];
      if (caption) {
        controls.append(make('span', 'desktop-workspace-caption', ds(caption)));
        if (control.tagName === 'INPUT') {
          control.setAttribute('aria-label', ds(caption));
        }
      }
      const hint = tool.hints?.find(([target]) => target === selector);
      const hintText = hint && document.querySelector(hint[1])?.textContent;
      if (hintText) control.title = hintText.replace(/\s+/g, ' ').trim();
      controls.append(control);
    }
    if (tool.save && !moved.has(tool.save)) {
      const save = document.querySelector<HTMLElement>(tool.save);
      if (save) {
        moved.add(tool.save);
        // Keeps "hidden" if the tool set it; the tool still toggles it.
        const hidden = save.classList.contains('hidden');
        save.className = 'desktop-workspace-save' + (hidden ? ' hidden' : '');
        save.replaceChildren(
          icon('floppy-disk'),
          make('span', '', ds('workspaceSave'))
        );
        bar.append(save);
        refreshSave();
      }
    }
  };

  // Writes only what changed: each write is itself a mutation this page
  // watches.
  const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };
  const refreshFile = (): void => {
    if (!fileName || !fileMeta) return;
    const name = fileRow()?.querySelector('.truncate');
    setText(fileName, name?.textContent?.trim() ?? '');
    setText(fileMeta, name?.nextElementSibling?.textContent?.trim() ?? '');
    fileName.title = fileName.textContent ?? '';
  };
  // ---- Save over the opened file, or Save as
  const saveButton = (): HTMLElement | null =>
    tool.save ? document.querySelector<HTMLElement>(tool.save) : null;
  const shown = (el: HTMLElement | null): el is HTMLElement =>
    !!el && !el.classList.contains('hidden') && el.style.display !== 'none';
  const overwriteFile = (): OpenedFile | null => {
    const file = options.currentFile();
    if (!file || !tool.overwrite) return null;
    if (typeof tool.overwrite === 'function') {
      return tool.overwrite(file) ? file : null;
    }
    return fileName?.textContent === file.name ? file : null;
  };
  const refreshSave = (): void => {
    const save = saveButton();
    const file = overwriteFile();
    const canReplace = shown(save) && !!file;
    if (saveAs.hidden === canReplace) saveAs.hidden = !canReplace;
    if (save) {
      const hint = file ? ds('saveOverwriteHint', { name: file.name }) : '';
      if (save.title !== hint) save.title = hint;
    }
  };

  // Every route to the tool's save (its button, Ctrl+S, the viewer's own
  // save) comes through here: say where the file goes, then let it run.
  let passThrough = false;
  let asked: SaveMode | null = null;
  const runSave = async (save: HTMLElement): Promise<void> => {
    const file = overwriteFile();
    let mode: SaveMode | null = asked ?? (file ? 'overwrite' : null);
    asked = null;
    if (mode === 'overwrite' && file && !overwriteConfirmed()) {
      const answer = await confirmOverwrite(file.name);
      if (answer === 'cancel') return;
      mode = answer;
    }
    const bridge = getBridge();
    if (mode && file && bridge) await bridge.setSaveTarget(mode, file.path);
    passThrough = true;
    try {
      save.click();
    } finally {
      passThrough = false;
    }
  };
  document.addEventListener(
    'click',
    (e) => {
      if (passThrough) return;
      const save = saveButton();
      const target = e.target as Element | null;
      if (!save || !target || !save.contains(target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void runSave(save);
    },
    true
  );
  saveAs.addEventListener('click', () => {
    const save = saveButton();
    if (!shown(save)) return;
    asked = 'saveAs';
    save.click();
  });
  const requestSave = (asCopy: boolean): boolean => {
    const save = saveButton();
    if (!on || !shown(save)) return false;
    if (asCopy && !saveAs.hidden) asked = 'saveAs';
    save.click();
    return true;
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        e.key.toLowerCase() !== 's'
      ) {
        return;
      }
      if (requestSave(e.shiftKey)) e.preventDefault();
    },
    true
  );
  // A viewer frame's own Ctrl+S or download button (Sign) asks this way.
  document.addEventListener('cit:save-request', (e) => {
    const asCopy = !!(e as CustomEvent<{ saveAs?: boolean }>).detail?.saveAs;
    if (requestSave(asCopy)) e.preventDefault();
  });

  const allMoved = (): boolean =>
    (tool.controls ?? []).every((selector) => moved.has(selector)) &&
    (!tool.save || moved.has(tool.save));

  let on = false;
  const update = (): void => {
    const open = area.isConnected && !area.classList.contains('hidden');
    if (open) {
      if (!allMoved()) adopt();
      refreshFile();
      refreshSave();
    }
    if (open === on) return;
    on = open;
    if (open) {
      setText(
        title,
        document.querySelector('#tool-uploader h1')?.textContent?.trim() ?? ''
      );
      area.classList.add('desktop-workspace-area', tool.layout ?? 'fill');
      for (const leftover of leftovers) {
        leftover.classList.add('desktop-workspace-leftover');
      }
    }
    document.body.classList.toggle('desktop-workspace', open);
    options.setReading(open);
  };

  // The PDF editor redraws a lot; one look per frame is plenty.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'data-editor-documents'],
  });
  update();
}
