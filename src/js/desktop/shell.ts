/**
 * Desktop (Electron) app shell: the persistent left sidebar (search,
 * favorites, recent tools, tool groups), the status bar, and handling of
 * files handed to the app by the OS. Only loaded when __DESKTOP__ is set.
 */
import { categories } from '../config/tools.js';
import { t, rewriteLinks } from '../i18n/i18n.js';
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import { getBridge, type OpenedFile } from './bridge.js';
import { VIEWER_SLUG, openFileAction } from './open-file.js';
import { applyDesktopStrings, ds } from './strings.js';
import { THEME_EVENT, currentTheme, setTheme } from './theme.js';
import { initUpdateBanner } from './update-check.js';
import { showAlert } from '../ui.js';
import {
  VIEWER_SELECT_EVENT,
  VIEWER_TABS_EVENT,
  VIEWER_TOOLS_EVENT,
  type ViewerSelectDetail,
  type ViewerTabsDetail,
  type ViewerToolsDetail,
} from '../logic/view-pdf-events.js';

interface ShellOptions {
  categoryTranslationKeys: Record<string, string>;
  toolTranslationKeys: Record<string, string>;
}

interface ShellTool {
  slug: string;
  href: string;
  name: string;
  subtitle: string;
  icon: string;
}

interface ShellCategory {
  name: string;
  tools: ShellTool[];
}

const FAVORITES_KEY = 'cit:favorites';
const RECENT_KEY = 'cit:recent';
const PENDING_FILE_KEY = 'cit:pending-file';
const VIEWER_TABS_KEY = 'cit:viewer-tabs';
const MAX_RECENT = 5;

// Tools offered when a PDF is opened from the OS, most common first.
const OPEN_FILE_TOOLS = [
  'merge-pdf',
  'split-pdf',
  'compress-pdf',
  'edit-pdf',
  'edit-pdf-text',
  'organize-pdf',
  'rotate-pdf',
  'extract-pages',
  'delete-pages',
  'pdf-to-word',
  'pdf-to-jpg',
  'sign-pdf',
  'protect-pdf',
  'unlock-pdf',
  'add-watermark',
  'ocr-pdf',
];

function slugOf(href: string): string {
  const last = href.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
  return last.replace(/\.html$/, '');
}

function readList(key: string): string[] {
  try {
    const parsed = JSON.parse(getStoredItem(key) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((s) => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconEl(icon: string, className = ''): HTMLElement {
  const name = icon.startsWith('ph-') ? icon : 'ph-file-pdf';
  return el('i', `ph ${name} ${className}`);
}

export function initDesktopShell(options: ShellOptions): void {
  const nav = document.getElementById('desktop-nav');
  if (!nav) return;

  applyDesktopStrings();

  const shellCategories: ShellCategory[] = categories.map((category) => {
    const categoryKey = options.categoryTranslationKeys[category.name];
    return {
      name: categoryKey ? t(categoryKey) : category.name,
      tools: category.tools
        .filter((tool) => tool.href)
        .map((tool) => {
          const toolKey = options.toolTranslationKeys[tool.name];
          return {
            slug: slugOf(tool.href),
            href: tool.href,
            name: toolKey ? t(`${toolKey}.name`) : tool.name,
            subtitle: toolKey ? t(`${toolKey}.subtitle`) : tool.subtitle,
            icon: tool.icon,
          };
        }),
    };
  });

  const toolsBySlug = new Map<string, ShellTool>();
  for (const category of shellCategories) {
    for (const tool of category.tools) {
      if (!toolsBySlug.has(tool.slug)) toolsBySlug.set(tool.slug, tool);
    }
  }

  const currentSlug = slugOf(window.location.pathname);
  const currentTool = toolsBySlug.get(currentSlug);

  let favorites = readList(FAVORITES_KEY);
  let recent = readList(RECENT_KEY);
  if (currentTool) {
    recent = [currentSlug, ...recent.filter((s) => s !== currentSlug)].slice(
      0,
      MAX_RECENT
    );
    setStoredItem(RECENT_KEY, JSON.stringify(recent));
  }

  const searchInput = document.getElementById(
    'desktop-search'
  ) as HTMLInputElement | null;
  const openCategories = new Set<string>(
    shellCategories
      .filter((c, i) => i > 0 && c.tools.some((x) => x.slug === currentSlug))
      .map((c) => c.name)
  );

  function toggleFavorite(slug: string) {
    favorites = favorites.includes(slug)
      ? favorites.filter((s) => s !== slug)
      : [...favorites, slug];
    setStoredItem(FAVORITES_KEY, JSON.stringify(favorites));
    render();
  }

  function toolItem(tool: ShellTool): HTMLElement {
    const row = el(
      'div',
      'desktop-nav-item group' + (tool.slug === currentSlug ? ' active' : '')
    );

    const link = el('a', 'flex min-w-0 flex-1 items-center gap-2');
    link.href = tool.href;
    link.title = tool.name;
    link.append(
      iconEl(tool.icon, 'text-base text-indigo-400 flex-shrink-0'),
      el('span', 'truncate', tool.name)
    );

    const isFavorite = favorites.includes(tool.slug);
    const star = el(
      'button',
      'desktop-star flex-shrink-0' + (isFavorite ? ' is-favorite' : '')
    );
    star.type = 'button';
    star.title = ds(isFavorite ? 'removeFavorite' : 'addFavorite');
    star.append(el('i', isFavorite ? 'ph-fill ph-star' : 'ph ph-star'));
    star.addEventListener('click', (e) => {
      e.preventDefault();
      toggleFavorite(tool.slug);
    });

    row.append(link, star);
    return row;
  }

  function section(title: string, tools: ShellTool[]): HTMLElement {
    const wrapper = el('div', 'mb-3');
    wrapper.append(el('p', 'desktop-nav-heading', title));
    tools.forEach((tool) => wrapper.append(toolItem(tool)));
    return wrapper;
  }

  function pick(slugs: string[]): ShellTool[] {
    return slugs
      .map((slug) => toolsBySlug.get(slug))
      .filter((tool): tool is ShellTool => Boolean(tool));
  }

  function render() {
    nav!.textContent = '';
    const term = (searchInput?.value ?? '').toLowerCase().trim();

    if (term) {
      const matches = [...toolsBySlug.values()].filter(
        (tool) =>
          tool.name.toLowerCase().includes(term) || tool.slug.includes(term)
      );
      if (matches.length === 0) {
        nav!.append(
          el('p', 'px-4 py-3 text-sm text-gray-500', ds('noResults'))
        );
      } else {
        matches.forEach((tool) => nav!.append(toolItem(tool)));
      }
      rewriteLinks();
      return;
    }

    const favoriteTools = pick(favorites);
    if (favoriteTools.length > 0) {
      nav!.append(section(ds('favorites'), favoriteTools));
    }

    const recentTools = pick(recent.filter((s) => !favorites.includes(s)));
    if (recentTools.length > 0) {
      nav!.append(section(ds('recent'), recentTools));
    }

    nav!.append(el('p', 'desktop-nav-heading', ds('allTools')));
    shellCategories.forEach((category) => {
      const details = el('details', 'desktop-nav-group');
      details.open = openCategories.has(category.name);
      details.addEventListener('toggle', () => {
        if (details.open) openCategories.add(category.name);
        else openCategories.delete(category.name);
      });

      const summary = el('summary', 'desktop-nav-item');
      summary.append(
        el('span', 'flex-1 truncate', category.name),
        el('span', 'text-xs text-gray-500', String(category.tools.length)),
        el('i', 'ph ph-caret-right desktop-caret text-gray-500')
      );
      details.append(summary);

      const list = el('div', 'ml-2 border-l border-gray-700');
      category.tools.forEach((tool) => list.append(toolItem(tool)));
      details.append(list);
      nav!.append(details);
    });

    rewriteLinks();
  }

  render();
  nav.querySelector('.desktop-nav-item.active')?.scrollIntoView({
    block: 'nearest',
  });

  if (searchInput) {
    searchInput.addEventListener('input', render);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        render();
        searchInput.blur();
      } else if (e.key === 'Enter') {
        nav.querySelector<HTMLAnchorElement>('.desktop-nav-item a')?.click();
      }
    });

    // The home page has its own Ctrl+K search over the full grid.
    if (!document.getElementById('search-bar')) {
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      });
    }
  }

  // Recent tools as of arriving on this page; the home page is not a tool,
  // so nothing was just added.
  renderHomeRecent(pick(recent));
  void initUpdateBanner();

  initThemeToggle();
  void updateModulesStatus();
  initOpenedFiles(
    pick(OPEN_FILE_TOOLS),
    currentTool,
    toolsBySlug.get(VIEWER_SLUG),
    (slug) => toolsBySlug.has(slug)
  );
}

/** Home page only: a row of recently used tools above the full grid. */
function renderHomeRecent(tools: ShellTool[]): void {
  const grid = document.getElementById('tool-grid');
  if (!grid || tools.length === 0) return;

  const section = el('section', 'mb-2');
  section.id = 'desktop-recent';
  const cards = el('div', 'desktop-recent-grid');
  tools.forEach((tool) => {
    const card = el('a', 'tool-card bg-gray-800 no-underline');
    card.href = tool.href;
    card.append(
      iconEl(tool.icon, 'text-indigo-400'),
      el('h3', 'text-white', tool.name)
    );
    if (tool.subtitle) card.append(el('p', 'text-gray-400', tool.subtitle));
    cards.append(card);
  });
  section.append(el('h2', 'desktop-recent-heading', ds('recent')), cards);
  grid.before(section);
  rewriteLinks();

  // The grid swaps to search results while typing; step aside then.
  const searchBar = document.getElementById(
    'search-bar'
  ) as HTMLInputElement | null;
  searchBar?.addEventListener('input', () => {
    section.classList.toggle('hidden', searchBar.value.trim() !== '');
  });
}

/** Status bar button: one click flips between the light and dark themes. */
function initThemeToggle(): void {
  const toggle = document.getElementById('desktop-theme-toggle');
  if (!toggle) return;
  const icon = toggle.querySelector('i');
  const label = toggle.querySelector('span');

  const sync = () => {
    const light = currentTheme() === 'light';
    if (icon) icon.className = `ph ${light ? 'ph-sun' : 'ph-moon'} text-sm`;
    if (label) label.textContent = ds(light ? 'themeLight' : 'themeDark');
  };
  toggle.addEventListener('click', () => {
    setTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });
  document.addEventListener(THEME_EVENT, sync);
  sync();
}

async function updateModulesStatus(): Promise<void> {
  const target = document.getElementById('desktop-modules-status');
  const bridge = getBridge();
  if (!target || !bridge) return;
  try {
    const status = await bridge.getModulesStatus();
    target.textContent = ds('modulesStatus', {
      n: status.filter((m) => m.installed).length,
      m: status.length,
    });
  } catch (e) {
    console.warn('[Desktop] Could not read module status:', e);
  }
}

function getFileInput(): HTMLInputElement | null {
  return document.getElementById('file-input') as HTMLInputElement | null;
}

// True while injectFile is dispatching, to tell its change event apart from
// the user picking a file themselves.
let injecting = false;

// The PDF this page is working on, when the app knows where it is on disk:
// in the viewer, the tab on screen. It follows the user to the next tool.
let pageFile: OpenedFile | null = null;

// Where the File objects of this page live on disk, for those that do.
const fileOrigins = new WeakMap<File, Promise<OpenedFile | null>>();

interface SavedViewerTabs {
  files: OpenedFile[];
  /** Path of the tab that was on screen. */
  active: string | null;
}

// The viewer's tabs survive a trip to another tool and back. The list is
// per window and ends with it.
function readViewerTabs(): SavedViewerTabs {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEWER_TABS_KEY) || '{}');
    if (Array.isArray(saved.files)) return saved as SavedViewerTabs;
  } catch (e) {
    console.warn('[Desktop] Could not read the viewer tabs:', e);
  }
  return { files: [], active: null };
}

function saveViewerTabs(tabs: SavedViewerTabs): void {
  try {
    sessionStorage.setItem(VIEWER_TABS_KEY, JSON.stringify(tabs));
  } catch (e) {
    console.warn('[Desktop] Could not remember the viewer tabs:', e);
  }
}

function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

function acceptsPdf(input: HTMLInputElement): boolean {
  const accept = input.accept.toLowerCase();
  return !accept || accept.includes('pdf');
}

async function injectFile(file: OpenedFile, quiet = false): Promise<boolean> {
  const bridge = getBridge();
  const input = getFileInput();
  if (!bridge || !input || !acceptsPdf(input)) return false;
  try {
    const bytes = await bridge.readOpenedFile(file.path);
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes as BlobPart], file.name, { type: 'application/pdf' })
    );
    input.files = transfer.files;
    // The page reads the file back from the input, so that is the object
    // to remember the path for.
    if (input.files?.[0])
      fileOrigins.set(input.files[0], Promise.resolve(file));
    injecting = true;
    try {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      injecting = false;
    }
    pageFile = file;
    return true;
  } catch (e) {
    console.error('[Desktop] Could not load opened file:', e);
    if (!quiet) window.alert(`${ds('openFileFailed')}: ${file.name}`);
    return false;
  }
}

function rememberPendingFile(file: OpenedFile): void {
  try {
    sessionStorage.setItem(PENDING_FILE_KEY, JSON.stringify(file));
  } catch (e) {
    console.warn('[Desktop] Could not remember opened file:', e);
  }
}

function showOpenFilePicker(
  file: OpenedFile,
  tools: ShellTool[],
  currentTool: ShellTool | undefined
): void {
  document.getElementById('desktop-open-file')?.remove();

  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
  );
  overlay.id = 'desktop-open-file';

  const dialog = el(
    'div',
    'w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-2xl'
  );
  dialog.append(
    el('h2', 'text-xl font-bold text-white', ds('openFileTitle')),
    el('p', 'mt-1 mb-5 truncate text-sm text-gray-400', file.name)
  );

  const close = () => overlay.remove();

  if (currentTool && getFileInput()) {
    const useCurrent = el(
      'button',
      'mb-4 flex w-full items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-left text-sm font-semibold text-white hover:bg-indigo-700'
    );
    useCurrent.type = 'button';
    useCurrent.append(
      iconEl(currentTool.icon, 'text-lg'),
      el('span', '', `${ds('openFileCurrent')}: ${currentTool.name}`)
    );
    useCurrent.addEventListener('click', () => {
      close();
      void injectFile(file);
    });
    dialog.append(useCurrent);
  }

  const grid = el('div', 'grid grid-cols-2 gap-2 sm:grid-cols-4');
  tools.forEach((tool) => {
    const card = el(
      'a',
      'flex flex-col items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 p-3 text-center text-sm text-gray-200 no-underline hover:border-indigo-500 hover:text-white'
    );
    card.href = tool.href;
    card.append(
      iconEl(tool.icon, 'text-2xl text-indigo-400'),
      el('span', '', tool.name)
    );
    card.addEventListener('click', () => rememberPendingFile(file));
    grid.append(card);
  });
  dialog.append(grid);

  const cancel = el(
    'button',
    'mt-5 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600',
    ds('cancel')
  );
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  dialog.append(cancel);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.append(dialog);
  document.body.append(overlay);
  rewriteLinks();
}

function initOpenedFiles(
  tools: ShellTool[],
  currentTool: ShellTool | undefined,
  viewerTool: ShellTool | undefined,
  isTool: (slug: string) => boolean
): void {
  const bridge = getBridge();
  if (!bridge) return;

  const onViewer = currentTool?.slug === VIEWER_SLUG;

  // A PDF the user picks or drops in the page becomes the page's file. The
  // listeners capture, so they see the files before the page clears them.
  const trackPicked = (files: FileList | null | undefined) => {
    const pdfs = Array.from(files ?? []).filter((file) => isPdfName(file.name));
    pdfs.forEach((pdf, index) => {
      const origin = bridge.registerPickedFile(pdf);
      fileOrigins.set(pdf, origin);
      // In the viewer the tab on screen decides, see below.
      if (index === 0 && !onViewer) {
        void origin.then((opened) => {
          if (opened) pageFile = opened;
        });
      }
    });
  };
  document.addEventListener(
    'change',
    (event) => {
      const input = getFileInput();
      if (!injecting && input && event.target === input) {
        trackPicked(input.files);
      }
    },
    true
  );
  document.addEventListener(
    'drop',
    (event) => trackPicked(event.dataTransfer?.files),
    true
  );

  // The viewer keeps one tab per document. Follow them: the tab on screen
  // is the page's file, and the list is saved for the next visit.
  let viewerTabs: Array<OpenedFile | null> = [];
  let tabsSettled: Promise<void> = Promise.resolve();
  let restoringTabs = false;
  document.addEventListener(VIEWER_TABS_EVENT, (event) => {
    const { files, active } = (event as CustomEvent<ViewerTabsDetail>).detail;
    tabsSettled = tabsSettled.then(async () => {
      viewerTabs = await Promise.all(
        files.map((file) => fileOrigins.get(file) ?? null)
      );
      pageFile = viewerTabs[active] ?? null;
      if (restoringTabs) return;
      saveViewerTabs({
        files: viewerTabs.filter((tab): tab is OpenedFile => tab !== null),
        active: pageFile?.path ?? null,
      });
    });
  });

  // Shows a file in the viewer: its tab if it has one, else a new tab.
  const openInViewer = async (file: OpenedFile, quiet = false) => {
    await tabsSettled;
    const index = viewerTabs.findIndex((tab) => tab?.path === file.path);
    if (index >= 0) {
      document.dispatchEvent(
        new CustomEvent<ViewerSelectDetail>(VIEWER_SELECT_EVENT, {
          detail: { index },
        })
      );
    } else {
      await injectFile(file, quiet);
    }
    await tabsSettled;
  };

  // Moving to another tool takes the page's file along.
  document.addEventListener(
    'click',
    (event) => {
      if (!pageFile || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (link && isTool(slugOf(link.pathname))) rememberPendingFile(pageFile);
    },
    true
  );

  // The viewer's own button offers a short list of tools for the open file.
  // A file that came from the OS already has a path; one picked in the page
  // gets its path from the bridge.
  document.addEventListener(VIEWER_TOOLS_EVENT, (event) => {
    const { file } = (event as CustomEvent<ViewerToolsDetail>).detail;
    void (async () => {
      const opened =
        (await fileOrigins.get(file)) ??
        (await bridge.registerPickedFile(file));
      if (opened) showOpenFilePicker(opened, tools, undefined);
      else showAlert(ds('openFileFailed'), ds('viewerNoPath'));
    })();
  });

  // What the previous page left behind: a file handed over to this tool
  // and, for the viewer, the tabs it had open.
  const restore = async () => {
    let pending: OpenedFile | null = null;
    try {
      const stored = sessionStorage.getItem(PENDING_FILE_KEY);
      if (stored) {
        sessionStorage.removeItem(PENDING_FILE_KEY);
        pending = JSON.parse(stored) as OpenedFile;
      }
    } catch (e) {
      console.warn('[Desktop] Could not restore opened file:', e);
    }

    if (!onViewer) {
      if (pending) await injectFile(pending);
      return;
    }
    const saved = readViewerTabs();
    restoringTabs = true;
    // A saved file may be gone by now: skip it without a message.
    for (const file of saved.files) await openInViewer(file, true);
    restoringTabs = false;
    const front =
      pending ?? saved.files.find((file) => file.path === saved.active);
    if (front) await openInViewer(front);
  };
  const restored = restore();

  const check = async () => {
    const file = await bridge.takeOpenedFile();
    if (!file) return;
    await restored;
    // A tool that is working on a document keeps it: the new file opens in
    // a window of its own. The viewer opens it in another tab instead.
    if (!onViewer && pageFile) {
      if (pageFile.path !== file.path) await bridge.openInNewWindow(file.path);
      return;
    }
    switch (openFileAction(currentTool?.slug ?? '', Boolean(viewerTool))) {
      case 'load':
        await openInViewer(file);
        break;
      case 'navigate': {
        rememberPendingFile(file);
        // Go through a link so rewriteLinks applies the language prefix.
        const link = el('a', 'hidden');
        link.href = viewerTool!.href;
        document.body.append(link);
        rewriteLinks();
        link.click();
        break;
      }
      default:
        showOpenFilePicker(file, tools, currentTool);
    }
  };
  bridge.onFileOpened(() => void check());
  void check();
}
