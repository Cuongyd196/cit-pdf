/**
 * Desktop (Electron) app shell: the persistent left sidebar (search,
 * favorites, recent tools, tool groups), the status bar, and handling of
 * files handed to the app by the OS. Only loaded when __DESKTOP__ is set.
 */
import { categories } from '../config/tools.js';
import { t, rewriteLinks } from '../i18n/i18n.js';
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import { getBridge, type OpenedFile, type SavedDownload } from './bridge.js';
import { VIEWER_SLUG, openFileAction } from './open-file.js';
import {
  applyDesktopStrings,
  desktopLang,
  ds,
  type DesktopStringKey,
} from './strings.js';
import { homeBlurb } from './tool-blurbs.js';
import {
  THEME_EVENT,
  initTheme,
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme.js';
import { initUpdateBanner } from './update-check.js';
import { initIconFamily } from './icons.js';
import { initToolWorkspace } from './workspace.js';
import { menuButton, type MenuChoice, type MenuEntry } from './menu.js';
import {
  VIEWER_SELECT_EVENT,
  VIEWER_TABS_EVENT,
  type ViewerSelectDetail,
  type ViewerTabsDetail,
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
  /** For the home page's group buttons, where the full names wrap. */
  short?: string;
  tools: ShellTool[];
}

// The app's order of the groups (after Popular Tools), most used first.
const GROUP_ORDER = [
  'Organize & Manage',
  'Convert from PDF',
  'Convert to PDF',
  'Edit & Annotate',
  'Optimize & Repair',
  'Secure PDF',
];

// Tools that lead their group, in this order; the rest follow as listed.
const TOOL_ORDER = [
  // Organize
  'merge-pdf',
  'split-pdf',
  'extract-pages',
  'delete-pages',
  'organize-pdf',
  'rotate-pdf',
  'pdf-multi-tool',
  'add-blank-page',
  'reverse-pages',
  // From PDF
  'pdf-to-word',
  'pdf-to-jpg',
  'pdf-to-excel',
  'ocr-pdf',
  'pdf-to-png',
  'pdf-to-text',
  'extract-images',
  // To PDF
  'jpg-to-pdf',
  'image-to-pdf',
  'word-to-pdf',
  'excel-to-pdf',
  'powerpoint-to-pdf',
  'png-to-pdf',
  'heic-to-pdf',
  'txt-to-pdf',
  // Edit
  'edit-pdf-text',
  'edit-pdf',
  'sign-pdf',
  'add-watermark',
  'page-numbers',
  'header-footer',
  'crop-pdf',
  'form-filler',
  'add-stamps',
  // Optimize
  'compress-pdf',
  'repair-pdf',
  'pdf-to-pdfa',
  'fix-page-size',
  // Secure
  'protect-pdf',
  'unlock-pdf',
  'digital-sign-pdf',
  'flatten-pdf',
  'remove-metadata',
];

// Tools the app shows in another group than the registry: OCR turns a scan
// into text, which users look for next to the other conversions.
const MOVED_TOOLS: Record<string, string> = {
  'ocr-pdf': 'Convert from PDF',
};

/** The registry's groups in the app's order, with common tools first. */
function arrangeCategories<
  C extends { name: string; tools: Array<{ href?: string }> },
>(list: C[]): C[] {
  const slug = (tool: { href?: string }) => slugOf(tool.href ?? '');
  const moved = new Map<string, C['tools']>();
  const kept = list.map((category) => ({
    ...category,
    tools: category.tools.filter((tool) => {
      const to = MOVED_TOOLS[slug(tool)];
      if (!to || to === category.name || category === list[0]) return true;
      moved.set(to, [...(moved.get(to) ?? []), tool]);
      return false;
    }),
  }));
  const rank = (tool: { href?: string }) => {
    const i = TOOL_ORDER.indexOf(slug(tool));
    return i < 0 ? TOOL_ORDER.length : i;
  };
  const groupRank = (name: string) => {
    const i = GROUP_ORDER.indexOf(name);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  // Popular Tools stays first and as it is.
  const [popular, ...groups] = kept;
  const arranged = groups
    .map((category) => ({
      ...category,
      tools: [...category.tools, ...(moved.get(category.name) ?? [])]
        .map((tool, i) => ({ tool, i }))
        .sort((a, b) => rank(a.tool) - rank(b.tool) || a.i - b.i)
        .map(({ tool }) => tool),
    }))
    .sort((a, b) => groupRank(a.name) - groupRank(b.name));
  return popular ? [popular, ...arranged] : arranged;
}

const SHORT_GROUP_NAMES: Record<string, DesktopStringKey> = {
  'Edit & Annotate': 'groupEdit',
  'Convert to PDF': 'groupToPdf',
  'Convert from PDF': 'groupFromPdf',
  'Organize & Manage': 'groupOrganize',
  'Optimize & Repair': 'groupOptimize',
  'Secure PDF': 'groupSecure',
};

const FAVORITES_KEY = 'cit:favorites';
const RECENT_KEY = 'cit:recent';
const PENDING_FILE_KEY = 'cit:pending-file';
const VIEWER_TABS_KEY = 'cit:viewer-tabs';
// Buttons that leave a tool's editor for its upload screen.
const BACK_TO_DOCUMENT = '#exitEditor';
const READING_SIDEBAR_KEY = 'cit:reading-sidebar';
const SAVED_TOAST_MS = 15000;

// Viewer: the picker of tools that open the document on their own page,
// by purpose. What Studio does to the document in place is not offered.
const VIEWER_PICKER_GROUPS: Array<[DesktopStringKey, string[]]> = [
  ['pickConvert', ['pdf-to-word', 'pdf-to-jpg', 'pdf-to-excel', 'ocr-pdf']],
  ['pickPages', ['merge-pdf', 'split-pdf', 'organize-pdf', 'edit-pdf-text']],
  ['pickSecure', ['sign-pdf', 'protect-pdf', 'unlock-pdf']],
];
const MAX_RECENT = 5;

// Home page: tools offered beside the recent files, after the user's
// favorites and recently used ones.
const HOME_TOOLS = [
  'compress-pdf',
  'merge-pdf',
  'split-pdf',
  'pdf-to-word',
  'ocr-pdf',
  'edit-pdf-text',
  'sign-pdf',
  'jpg-to-pdf',
];
const HOME_TOOL_COUNT = 8;
// The home page shows all tools instead of its start view at this hash.
const ALL_TOOLS_HASH = '#tools';

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
  initIconFamily();

  const shellCategories: ShellCategory[] = arrangeCategories(categories).map(
    (category) => {
      const categoryKey = options.categoryTranslationKeys[category.name];
      const shortKey = SHORT_GROUP_NAMES[category.name];
      return {
        name: categoryKey ? t(categoryKey) : category.name,
        short: shortKey ? ds(shortKey) : undefined,
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
    }
  );

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
    // Only the regular icon weight is bundled; a favorite is told apart by
    // its colour and by staying visible (.is-favorite).
    star.append(el('i', 'ph ph-star'));
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

    // Fixed ways out, first: the viewer and the list of every tool.
    const fixed = el('div', 'desktop-nav-fixed');
    const viewer = toolsBySlug.get(VIEWER_SLUG);
    if (viewer) {
      const item = el(
        'a',
        'desktop-nav-item' + (currentSlug === VIEWER_SLUG ? ' active' : '')
      );
      item.href = viewer.href;
      item.append(
        iconEl(viewer.icon, 'text-base text-indigo-400'),
        el('span', 'truncate', viewer.name)
      );
      fixed.append(item);
    }
    const onHome = Boolean(document.getElementById('desktop-home'));
    const all = el('a', 'desktop-nav-item' + (onHome ? ' active' : ''));
    all.href = allToolsHref();
    all.append(
      // Not squares-four: Extract pages has that one.
      el('i', 'ph ph-toolbox text-base text-indigo-400'),
      el('span', 'truncate', ds('homeAllTools'))
    );
    all.addEventListener('click', (event) => {
      if (!onHome) return;
      event.preventDefault();
      scrollToAllTools();
    });
    fixed.append(all);
    nav!.append(fixed);

    // The viewer has its fixed place above, pinned or not.
    const favoriteTools = pick(favorites.filter((s) => s !== VIEWER_SLUG));
    if (favoriteTools.length > 0) {
      const pinned = section(ds('favorites'), favoriteTools);
      pinned.classList.add('desktop-nav-favorites');
      nav!.append(pinned);
    }

    // Not on the rail: the home page has them in "Frequently used".
    const recentTools = pick(
      recent.filter((s) => !favorites.includes(s) && s !== VIEWER_SLUG)
    );
    if (recentTools.length > 0) {
      const lately = section(ds('recent'), recentTools);
      lately.classList.add('desktop-nav-recent');
      nav!.append(lately);
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
  }

  // Ctrl+K, and File > Find a tool… in the menu bar.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k')
        return;
      event.preventDefault();
      // The web grid's own Ctrl+K handler is not for the app's home page.
      if (document.getElementById('desktop-home')) {
        event.stopImmediatePropagation();
      }
      findTool();
    },
    true
  );
  getBridge()?.onFindTool?.(findTool);
  initRailLabels();

  // Recent tools as of arriving on this page; the home page is not a tool,
  // so nothing was just added.
  renderHomeRecent(pick(recent));
  void initUpdateBanner();

  initTheme();
  initThemeToggle();
  const opened = initOpenedFiles(
    pick(OPEN_FILE_TOOLS),
    currentTool,
    toolsBySlug.get(VIEWER_SLUG),
    (slug) => toolsBySlug.has(slug)
  );
  initViewerActions(toolsBySlug);
  initToolWorkspace({
    back:
      opened?.backFromTool ??
      (() => document.getElementById('back-to-tools')?.click()),
    setReading,
    currentFile: () => pageFile,
  });
  // The first group, Popular Tools, repeats tools of the others; the few it
  // alone has (the workflow builder) end the next group. The viewer is
  // what opening a file does, so it is not a tool card.
  const homeSeen = new Set<string>([VIEWER_SLUG]);
  const [popular, ...groups] = shellCategories;
  const elsewhere = new Set(groups.flatMap((c) => c.tools.map((x) => x.slug)));
  const onlyPopular = (popular?.tools ?? []).filter(
    (tool) => !elsewhere.has(tool.slug)
  );
  initHomeStart({
    categories: groups
      .map((category, i) => ({
        name: category.name,
        short: category.short,
        tools: [...category.tools, ...(i === 0 ? onlyPopular : [])].filter(
          (tool) => !homeSeen.has(tool.slug) && homeSeen.add(tool.slug)
        ),
      }))
      .filter((category) => category.tools.length > 0),
    frequent: () =>
      pick(
        [...new Set([...favorites, ...recent, ...HOME_TOOLS])].filter(
          (slug) => slug !== VIEWER_SLUG
        )
      ).slice(0, HOME_TOOL_COUNT),
    isFavorite: (slug) => favorites.includes(slug),
    toggleFavorite,
    goToViewer: opened?.goToViewer,
  });
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

  // Light, dark, then whatever Windows uses.
  const next: Record<ThemePreference, ThemePreference> = {
    light: 'dark',
    dark: 'system',
    system: 'light',
  };
  const look: Record<ThemePreference, [string, DesktopStringKey]> = {
    light: ['ph-sun', 'themeLight'],
    dark: ['ph-moon', 'themeDark'],
    system: ['ph-desktop', 'themeSystem'],
  };
  const sync = () => {
    const [iconName, labelKey] = look[themePreference()];
    if (icon) icon.className = `ph ${iconName} text-sm`;
    if (label) label.textContent = ds(labelKey);
    toggle.title = ds('themeToggleHint');
  };
  toggle.addEventListener('click', () => {
    setThemePreference(next[themePreference()]);
  });
  document.addEventListener(THEME_EVENT, sync);
  sync();
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

function rememberPendingFile(file: OpenedFile | OpenedFile[]): void {
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

/** Viewer: open the document on screen in another tool's page. */
function showViewerToolPicker(
  file: OpenedFile,
  toolsBySlug: Map<string, ShellTool>
): void {
  document.getElementById('desktop-open-file')?.remove();
  const all = [...toolsBySlug.values()].filter((t) => t.slug !== VIEWER_SLUG);

  const overlay = el('div', 'desktop-picker-overlay');
  overlay.id = 'desktop-open-file';
  const dialog = el('div', 'desktop-picker');
  dialog.setAttribute('role', 'dialog');
  const search = el('input', 'desktop-picker-search');
  search.type = 'search';
  search.placeholder = ds('pickSearch');
  const body = el('div', 'desktop-picker-body');
  const closeButton = el('button', 'desktop-picker-close');
  closeButton.type = 'button';
  closeButton.title = ds('cancel');
  closeButton.setAttribute('aria-label', ds('cancel'));
  closeButton.append(el('i', 'ph ph-x'));
  const head = el('div', 'desktop-picker-head');
  head.append(
    el('h2', 'desktop-picker-title', ds('openFileTitle')),
    closeButton
  );
  dialog.append(head, el('p', 'desktop-picker-file', file.name), search, body);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (search.value) {
      search.value = '';
      render(false);
    } else close();
  };

  const card = (tool: ShellTool) => {
    const link = el('a', 'desktop-picker-tool');
    link.href = tool.href;
    link.title = tool.subtitle;
    link.dataset.slug = tool.slug;
    link.append(iconEl(tool.icon), el('span', '', tool.name));
    link.addEventListener('click', () => rememberPendingFile(file));
    return link;
  };
  const group = (title: string | null, tools: ShellTool[]) => {
    const wrap = el('div', 'desktop-picker-group');
    if (title) wrap.append(el('p', 'desktop-picker-heading', title));
    const grid = el('div', 'desktop-picker-grid');
    grid.append(...tools.map(card));
    wrap.append(grid);
    return wrap;
  };

  function render(showAll: boolean): void {
    body.textContent = '';
    const term = search.value.toLowerCase().trim();
    if (term) {
      const found = all.filter((t) =>
        `${t.name} ${t.subtitle}`.toLowerCase().includes(term)
      );
      body.append(
        found.length
          ? group(null, found)
          : el('p', 'desktop-picker-empty', ds('pickNone'))
      );
    } else if (showAll) {
      body.append(group(null, all));
    } else {
      for (const [title, slugs] of VIEWER_PICKER_GROUPS) {
        const tools = slugs
          .map((slug) => toolsBySlug.get(slug))
          .filter((tool): tool is ShellTool => Boolean(tool));
        if (tools.length) body.append(group(ds(title), tools));
      }
      const more = el('button', 'desktop-picker-all', ds('pickAll'));
      more.type = 'button';
      more.addEventListener('click', () => render(true));
      body.append(more);
    }
    rewriteLinks();
  }

  search.addEventListener('input', () => render(false));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      body.querySelector<HTMLAnchorElement>('.desktop-picker-tool')?.click();
    }
  });
  closeButton.addEventListener('click', () => close());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  overlay.append(dialog);
  document.body.append(overlay);
  render(false);
  search.focus();
}

function initOpenedFiles(
  tools: ShellTool[],
  currentTool: ShellTool | undefined,
  viewerTool: ShellTool | undefined,
  isTool: (slug: string) => boolean
):
  | {
      goToViewer: (file: OpenedFile | OpenedFile[]) => void;
      backFromTool: () => void;
    }
  | undefined {
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
        // A file with no path on disk (dropped from a browser) clears the
        // previous one, so nothing is ever saved over the wrong file.
        void origin.then((opened) => {
          pageFile = opened;
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
      setReading(files.length > 0);
      if (restoringTabs) return;
      saveViewerTabs({
        files: viewerTabs.filter((tab): tab is OpenedFile => tab !== null),
        active: pageFile?.path ?? null,
      });
      if (pageFile) await bridge.noteRecentFile(pageFile.path);
      // The list shows again once the last tab is closed.
      if (files.length === 0) void renderRecentFiles();
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

  // Goes to the viewer with one or more files, through a link so
  // rewriteLinks applies the language prefix.
  const goToViewer = (file: OpenedFile | OpenedFile[]) => {
    if (!viewerTool) return;
    // The link click below hands on the page's file, which would replace
    // what is set here: let it hand on nothing.
    pageFile = null;
    rememberPendingFile(file);
    const link = el('a', 'hidden');
    link.href = viewerTool.href;
    document.body.append(link);
    rewriteLinks();
    link.click();
  };

  // Documents read lately, to pick up where the user left off: on the home
  // page and on the viewer's empty screen.
  const renderRecentFiles = async () => {
    const home = document.getElementById('home-recent-files');
    if (home) {
      renderHomeRecentFiles(home, await bridge.listRecentFiles(), (file) =>
        goToViewer(file)
      );
      return;
    }
    const anchor =
      (onViewer && document.getElementById('drop-zone')) ||
      document.getElementById('desktop-recent') ||
      document.getElementById('tool-grid');
    if (!anchor) return;
    const files = await bridge.listRecentFiles();
    document.getElementById('desktop-recent-files')?.remove();
    if (files.length === 0) return;

    const section = el('section', 'desktop-recent-files');
    section.id = 'desktop-recent-files';
    const clear = el('button', 'desktop-recent-files-clear', ds('recentClear'));
    clear.type = 'button';
    clear.addEventListener('click', () => {
      section.remove();
      void bridge.clearRecentFiles();
    });
    const heading = el('div', 'flex items-center justify-between gap-3');
    heading.append(
      el('h2', 'desktop-recent-heading', ds('recentFiles')),
      clear
    );

    const list = el('div', 'desktop-recent-files-list');
    // The home page is about the tools: keep the list short there.
    const shown = onViewer ? files : files.slice(0, MAX_RECENT);
    shown.forEach((file) => {
      const item = el('button', 'desktop-recent-file');
      item.type = 'button';
      item.title = file.path;
      item.dataset.noTranslate = '';
      const folder = file.path
        .slice(0, -file.name.length)
        .replace(/[\\/]$/, '');
      item.append(
        el('i', 'ph ph-file-pdf'),
        el('span', 'desktop-recent-file-name', file.name),
        el('span', 'desktop-recent-file-folder', folder)
      );
      item.addEventListener('click', () => {
        if (onViewer) void openInViewer(file);
        else goToViewer(file);
      });
      list.append(item);
    });
    section.append(heading, list);
    if (onViewer) anchor.after(section);
    else anchor.before(section);
  };

  // A document that came from the viewer goes back there: the editor's
  // "back" button returns to its tab instead of the tool's upload screen.
  const viewerHas = (file: OpenedFile) =>
    readViewerTabs().files.some((tab) => tab.path === file.path);
  const markBackButton = () => {
    const back = document.querySelector<HTMLElement>(BACK_TO_DOCUMENT);
    if (!back || onViewer || !pageFile || !viewerHas(pageFile)) return;
    back.removeAttribute('data-i18n-title');
    back.title = ds('backToDocument');
  };
  document.addEventListener(
    'click',
    (event) => {
      if (onViewer || !pageFile || !(event.target instanceof Element)) return;
      if (!event.target.closest(BACK_TO_DOCUMENT) || !viewerHas(pageFile)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      goToViewer(pageFile);
    },
    true
  );

  // A tool saved its result: say where, and offer to look at it.
  dropSuccessBoxForSavedNotice();
  bridge.onDownloadSaved((saved) => {
    lastSavedAt = Date.now();
    dismissSuccessBox();
    showSavedToast(saved, {
      canView: saved.isPdf && Boolean(viewerTool),
      view: () => {
        const file = { path: saved.path, name: saved.name };
        if (onViewer) void openInViewer(file);
        else goToViewer(file);
      },
    });
  });

  // What the previous page left behind: a file handed over to this tool
  // and, for the viewer, the tabs it had open.
  const restore = async () => {
    let pending: OpenedFile[] = [];
    try {
      const stored = sessionStorage.getItem(PENDING_FILE_KEY);
      if (stored) {
        sessionStorage.removeItem(PENDING_FILE_KEY);
        const parsed = JSON.parse(stored) as OpenedFile | OpenedFile[];
        pending = Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch (e) {
      console.warn('[Desktop] Could not restore opened file:', e);
    }

    if (!onViewer) {
      if (pending[0] && (await injectFile(pending[0]))) markBackButton();
      return;
    }
    const saved = readViewerTabs();
    restoringTabs = true;
    // A saved file may be gone by now: skip it without a message.
    for (const file of saved.files) await openInViewer(file, true);
    restoringTabs = false;
    if (pending.length > 0) {
      for (const file of pending) await openInViewer(file);
      return;
    }
    const front = saved.files.find((file) => file.path === saved.active);
    if (front) await openInViewer(front);
  };
  const restored = restore();
  void restored.then(renderRecentFiles);

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
      case 'navigate':
        goToViewer(file);
        break;
      default:
        showOpenFilePicker(file, tools, currentTool);
    }
  };
  bridge.onFileOpened(() => void check());
  void check();

  // The tool workspace's back button: to the document when it came from
  // the viewer, else to the tools.
  const backFromTool = (): void => {
    if (!onViewer && pageFile && viewerHas(pageFile)) goToViewer(pageFile);
    else document.getElementById('back-to-tools')?.click();
  };
  return { goToViewer, backFromTool };
}

/** "10 min ago", "Today 14:05", "Yesterday 09:30", else the date. */
function formatOpenedAt(at: number | undefined, now = Date.now()): string {
  if (!at) return '';
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return ds('timeJustNow');
  if (minutes < 60) return ds('timeMinutes', { n: String(minutes) });
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) return ds('timeToday', { time });
  if (at >= startOfToday - 86400000) return ds('timeYesterday', { time });
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Recent files listed beside the drop box on the home page.
const HOME_RECENT_FILES = 4;

/**
 * A file name in two parts for a middle cut: the end stays whole, so
 * "Bao cao (edited) … (trang 1-3).pdf" still shows which part it is.
 */
function splitFileName(name: string): [string, string] {
  const suffix = /\s*\([^()]*\)\.pdf$/i.exec(name)?.[0] ?? '';
  const tail =
    suffix.length > 0 && suffix.length <= 28 ? suffix : name.slice(-14);
  return [name.slice(0, name.length - tail.length), tail];
}

/** Home page: the latest files, or a hint while there are none. */
function renderHomeRecentFiles(
  container: HTMLElement,
  files: OpenedFile[],
  open: (file: OpenedFile) => void
): void {
  const bridge = getBridge();
  const heading = el('div', 'flex items-baseline justify-between gap-3');
  heading.append(el('h2', 'desktop-recent-heading', ds('recentFiles')));
  if (files.length === 0) {
    container.replaceChildren(
      heading,
      el('p', 'desktop-home-empty', ds('recentEmpty'))
    );
    return;
  }

  const clear = el('button', 'desktop-recent-files-clear', ds('recentClear'));
  clear.type = 'button';
  clear.addEventListener('click', () => {
    void bridge?.clearRecentFiles();
    renderHomeRecentFiles(container, [], open);
  });
  heading.append(clear);

  const list = el('div', 'desktop-home-files');
  for (const file of files.slice(0, HOME_RECENT_FILES)) {
    const row = el('button', 'desktop-home-file');
    row.type = 'button';
    // The folder is in the tooltip, with the whole path.
    row.title = file.path;
    row.dataset.noTranslate = '';
    const [head, tail] = splitFileName(file.name);
    const name = el('span', 'desktop-home-file-name');
    name.append(
      el('span', 'desktop-home-file-head', head),
      el('span', '', tail)
    );
    row.append(
      el('i', 'ph ph-file-pdf'),
      name,
      el('span', 'desktop-home-file-meta', formatOpenedAt(file.openedAt))
    );
    row.addEventListener('click', () => open(file));
    list.append(row);
  }
  container.replaceChildren(heading, list);
}

/** Lower case without Vietnamese marks: "Gộp" and "gop" match. */
function searchKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function allToolsHref(): string {
  return `${import.meta.env.BASE_URL}index.html${ALL_TOOLS_HASH}`;
}

/** Home page: down to the list of every tool. */
function scrollToAllTools(): void {
  document.getElementById('home-all')?.scrollIntoView({ block: 'start' });
}

/**
 * Ctrl+K and File > Find a tool…: the home page's search box, else the
 * sidebar's; from the rail, where neither is on screen, the home page's
 * list of tools.
 */
function findTool(): void {
  const boxes = ['home-tool-search', 'desktop-search'].map(
    (id) => document.getElementById(id) as HTMLInputElement | null
  );
  const box = boxes.find((input) => input && input.offsetParent !== null);
  if (box) {
    box.focus();
    box.select();
    return;
  }
  const link = el('a', 'hidden');
  link.href = allToolsHref();
  document.body.append(link);
  rewriteLinks();
  link.click();
}

/**
 * The rail shows icons alone: a tool's name appears beside it at once on
 * hover or keyboard focus, instead of the slow native tooltip.
 */
function initRailLabels(): void {
  const sidebar = document.getElementById('desktop-sidebar');
  if (!sidebar) return;
  const tip = el('div', 'desktop-rail-tip hidden');
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);

  const itemOf = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>('.desktop-nav-item, #desktop-sidebar > a')
      : null;
  const show = (target: EventTarget | null) => {
    const item = itemOf(target);
    const label = item?.matches('#desktop-sidebar > a')
      ? ds('railHome')
      : item?.querySelector('span')?.textContent?.trim() ||
        item?.querySelector('a')?.title;
    if (
      !item ||
      !label ||
      !document.body.classList.contains('desktop-reading')
    ) {
      tip.classList.add('hidden');
      return;
    }
    const box = item.getBoundingClientRect();
    tip.textContent = label;
    tip.style.top = `${box.top + box.height / 2}px`;
    tip.style.left = `${box.right + 8}px`;
    tip.classList.remove('hidden');
  };
  const hide = () => tip.classList.add('hidden');
  sidebar.addEventListener('mouseover', (event) => show(event.target));
  sidebar.addEventListener('focusin', (event) => show(event.target));
  sidebar.addEventListener('mouseleave', hide);
  sidebar.addEventListener('focusout', hide);
  sidebar.addEventListener('click', hide);
}

interface HomeOptions {
  /** Every tool once, by group. */
  categories: ShellCategory[];
  /** The "Frequently used" row: favorites, then recent, then defaults. */
  frequent: () => ShellTool[];
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (slug: string) => void;
  goToViewer: ((files: OpenedFile[]) => void) | undefined;
}

/**
 * Home page: open a file or a recent one, a row of frequently used tools,
 * then every tool by group, filtered in place by the search box and the
 * group buttons. Index.html#tools scrolls to the tools.
 */
function initHomeStart(options: HomeOptions): void {
  const start = document.getElementById('desktop-home');
  const bridge = getBridge();
  if (!start || !bridge) return;

  document.body.classList.add('desktop-home-start');
  // The home page lists the tools itself: a rail is enough on the side.
  document.body.classList.add('desktop-reading');

  const scrollToTools = () => {
    if (window.location.hash === ALL_TOOLS_HASH) scrollToAllTools();
  };
  window.addEventListener('hashchange', scrollToTools);
  requestAnimationFrame(scrollToTools);

  const search = document.getElementById(
    'home-tool-search'
  ) as HTMLInputElement | null;
  const chips = document.getElementById('home-tools');
  const filters = document.getElementById('home-filters');
  const groups = document.getElementById('home-groups');
  const count = document.getElementById('home-all-count');
  const noTools = document.getElementById('home-no-tools');

  // Groups show this many tools until opened, unless searching or filtered.
  const GROUP_PREVIEW = 8;
  const opened = new Set<string>();
  let filter: string | null = null;
  const total = options.categories.reduce((n, c) => n + c.tools.length, 0);

  const renderChips = () => {
    chips?.replaceChildren(
      ...options.frequent().map((tool) => {
        const chip = el('a', 'desktop-home-chip');
        chip.href = tool.href;
        chip.title = tool.subtitle || tool.name;
        chip.append(iconEl(tool.icon), el('span', '', tool.name));
        return chip;
      })
    );
  };

  const card = (tool: ShellTool): HTMLElement => {
    const item = el('div', 'desktop-home-card');
    const link = el('a', 'desktop-home-card-link');
    link.href = tool.href;
    link.title = tool.subtitle || tool.name;
    const text = el('span', 'desktop-home-card-text');
    text.append(el('span', 'desktop-home-card-name', tool.name));
    const blurb = homeBlurb(tool.slug, tool.subtitle, desktopLang());
    if (blurb) text.append(el('span', 'desktop-home-card-sub', blurb));
    const icon = el('span', 'desktop-home-card-icon');
    icon.append(iconEl(tool.icon));
    link.append(icon, text);

    const favorite = options.isFavorite(tool.slug);
    const star = el(
      'button',
      'desktop-home-card-star' + (favorite ? ' is-favorite' : '')
    );
    star.type = 'button';
    star.title = ds(favorite ? 'removeFavorite' : 'addFavorite');
    star.setAttribute('aria-label', star.title);
    star.setAttribute('aria-pressed', String(favorite));
    star.append(el('i', 'ph ph-star'));
    star.addEventListener('click', () => {
      options.toggleFavorite(tool.slug);
      renderChips();
      renderTools();
    });
    item.append(link, star);
    return item;
  };

  const renderFilters = () => {
    if (!filters) return;
    filters.setAttribute('aria-label', ds('homeFilters'));
    const button = (label: string, n: number, value: string | null) => {
      const b = el('button', 'desktop-home-filter');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filter === value));
      if (value && value !== label) b.title = value;
      b.append(
        el('span', '', label),
        el('span', 'desktop-home-filter-count', String(n))
      );
      b.addEventListener('click', () => {
        filter = value;
        renderFilters();
        renderTools();
      });
      return b;
    };
    filters.replaceChildren(
      button(ds('homeFilterAll'), total, null),
      ...options.categories.map((c) =>
        button(c.short ?? c.name, c.tools.length, c.name)
      )
    );
  };

  const renderTools = () => {
    if (!groups) return;
    const query = searchKey(search?.value.trim() ?? '');
    const matches = (tool: ShellTool) =>
      searchKey(`${tool.name} ${tool.subtitle} ${tool.slug}`).includes(query);
    let shown = 0;
    const sections: HTMLElement[] = [];
    for (const category of options.categories) {
      if (filter && category.name !== filter) continue;
      const tools = query ? category.tools.filter(matches) : category.tools;
      if (tools.length === 0) continue;
      shown += tools.length;

      const whole =
        Boolean(query || filter) ||
        opened.has(category.name) ||
        tools.length <= GROUP_PREVIEW;
      const section = el('section', 'desktop-home-group');
      const head = el('h3', 'desktop-home-group-title');
      head.append(
        el('span', '', category.name),
        el('span', 'desktop-home-count', String(tools.length))
      );
      const grid = el('div', 'desktop-home-card-grid');
      grid.append(...(whole ? tools : tools.slice(0, GROUP_PREVIEW)).map(card));
      section.append(head, grid);

      if (!query && !filter && tools.length > GROUP_PREVIEW) {
        const more = el(
          'button',
          'desktop-home-more',
          opened.has(category.name)
            ? ds('homeShowLess')
            : ds('homeShowMore', { n: tools.length - GROUP_PREVIEW })
        );
        more.type = 'button';
        more.addEventListener('click', () => {
          if (opened.has(category.name)) opened.delete(category.name);
          else opened.add(category.name);
          renderTools();
        });
        section.append(more);
      }
      sections.push(section);
    }
    groups.replaceChildren(...sections);
    if (count) count.textContent = String(shown);
    if (noTools) {
      noTools.classList.toggle('hidden', shown > 0);
      noTools.textContent = ds('homeNoTools', {
        q: search?.value.trim() ?? '',
      });
    }
    rewriteLinks();
  };

  renderChips();
  renderFilters();
  renderTools();

  search?.addEventListener('input', renderTools);
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      search.value = '';
      renderTools();
    } else if (event.key === 'Enter') {
      groups
        ?.querySelector<HTMLAnchorElement>('.desktop-home-card-link')
        ?.click();
    }
  });
  const goToViewer = options.goToViewer;

  // Opening files: the button, or a drop anywhere on the start view.
  const input = document.getElementById(
    'home-file-input'
  ) as HTMLInputElement | null;
  const open = async (files: FileList | null | undefined) => {
    const pdfs = Array.from(files ?? []).filter((file) => isPdfName(file.name));
    const opened = (
      await Promise.all(pdfs.map((pdf) => bridge.registerPickedFile(pdf)))
    ).filter((file): file is OpenedFile => file !== null);
    if (opened.length > 0) goToViewer?.(opened);
  };
  document.getElementById('home-open')?.addEventListener('click', () => {
    input?.click();
  });
  input?.addEventListener('change', () => {
    void open(input.files);
    input.value = '';
  });
  const drop = document.getElementById('home-drop');
  start.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop?.classList.add('is-dragging');
  });
  start.addEventListener('dragleave', (event) => {
    if (!start.contains(event.relatedTarget as Node | null)) {
      drop?.classList.remove('is-dragging');
    }
  });
  start.addEventListener('drop', (event) => {
    event.preventDefault();
    drop?.classList.remove('is-dragging');
    void open(event.dataTransfer?.files);
  });
}

// While a document is open in the viewer the sidebar shrinks to a rail of
// icons, leaving the width to the page. The user can bring it back, and
// that choice is remembered.
let reading = false;

function applyReading(): void {
  const keepOpen = getStoredItem(READING_SIDEBAR_KEY) === 'open';
  document.body.classList.toggle('desktop-reading', reading && !keepOpen);
}

function setReading(value: boolean): void {
  reading = value;
  applyReading();
}

/**
 * Viewer page: the row above the document. Studio puts what changes the
 * document in place there; the menu at its end opens the document in
 * another tool's page (a link, so the page's file follows the click).
 */
function initViewerActions(toolsBySlug: Map<string, ShellTool>): void {
  const row = document.getElementById('viewer-actions');
  if (!row || !getBridge()) return;

  const toggle = el('button', 'pdf-view-action pdf-view-action-icon');
  toggle.type = 'button';
  toggle.title = ds('sidebarToggle');
  toggle.setAttribute('aria-label', toggle.title);
  toggle.append(el('i', 'ph ph-sidebar-simple'));
  toggle.addEventListener('click', () => {
    const collapsed = document.body.classList.contains('desktop-reading');
    setStoredItem(READING_SIDEBAR_KEY, collapsed ? 'open' : 'rail');
    applyReading();
  });
  row.append(toggle, el('span', 'pdf-view-actions-divider'));

  // One menu for every tool not on the row: first those Studio applies to
  // this document in place, then those that open on their own page.
  let inPlace: () => MenuChoice[] = () => [];
  const openWith = menuButton({
    icon: 'ph-squares-four',
    label: ds('quickOtherTools'),
    title: ds('quickOtherToolsHint'),
    className: 'pdf-view-action pdf-view-open-with studio-more',
    choices: () => {
      const here = inPlace();
      const choices: MenuEntry[] = here.length
        ? [{ heading: ds('quickInPlace') }, ...here]
        : [];
      if (choices.length) choices.push({ separator: true });
      choices.push({
        icon: 'ph-magnifying-glass',
        label: ds('quickOpenWith'),
        title: ds('quickOpenWithHint'),
        id: 'all',
        external: true,
        run: () => {
          if (pageFile) showViewerToolPicker(pageFile, toolsBySlug);
        },
      });
      return choices;
    },
  });
  // Links in the menu get the language prefix like every other link.
  openWith.addEventListener('click', () => rewriteLinks());
  row.append(el('span', 'pdf-view-actions-divider'), openWith);

  row.classList.remove('hidden');
  rewriteLinks();

  void import('./studio/studio.js').then(({ initStudio }) =>
    initStudio({
      row,
      currentFile: () => pageFile,
      inPlaceChoices: (list) => {
        inPlace = list;
      },
    })
  );
}

// A tool's "Success" box and the "Saved" notice say the same thing; the
// notice stays, since it also opens the file or its folder. A box shown
// this long before or after a save is that save's.
const SUCCESS_BOX_WINDOW_MS = 5000;
let lastSavedAt = 0;

/** Closes an open "Success" box as its OK button would. */
function dismissSuccessBox(): void {
  const modal = document.getElementById('alert-modal');
  if (
    !modal ||
    modal.classList.contains('hidden') ||
    modal.dataset.alertType !== 'success'
  ) {
    return;
  }
  // Hidden, not OK'd: OK also runs what the tool does next, which is often
  // going back to its start and dropping the file and settings. On the
  // desktop the work stays on screen, ready for the next run.
  modal.classList.add('hidden');
}

function dropSuccessBoxForSavedNotice(): void {
  const modal = document.getElementById('alert-modal');
  if (!modal) return;
  new MutationObserver(() => {
    if (Date.now() - lastSavedAt < SUCCESS_BOX_WINDOW_MS) dismissSuccessBox();
  }).observe(modal, {
    attributes: true,
    attributeFilter: ['class', 'data-alert-type'],
  });
}

/** A short notice that a result was saved, with ways to get to it. */
function showSavedToast(
  saved: SavedDownload,
  options: { canView: boolean; view: () => void }
): void {
  const bridge = getBridge();
  if (!bridge) return;
  document.getElementById('desktop-saved-toast')?.remove();

  const toast = el('div', 'desktop-saved-toast');
  toast.id = 'desktop-saved-toast';
  toast.setAttribute('role', 'status');
  toast.dataset.noTranslate = '';
  const close = () => toast.remove();

  const text = el('div', 'min-w-0 flex-1');
  text.append(
    el(
      'p',
      'text-sm font-semibold text-white',
      ds(saved.overwritten ? 'savedOverwritten' : 'savedTitle')
    ),
    el('p', 'truncate text-xs text-gray-400', saved.name)
  );
  if (saved.overwriteFailed) {
    text.append(el('p', 'mt-1 text-xs text-amber-300', ds('overwriteFailed')));
  }
  text.title = saved.path;

  const actions = el('div', 'flex flex-shrink-0 items-center gap-2');
  const action = (label: string, primary: boolean, run: () => void) => {
    const button = el(
      'button',
      'desktop-saved-toast-action' + (primary ? ' primary' : ''),
      label
    );
    button.type = 'button';
    button.addEventListener('click', () => {
      close();
      run();
    });
    actions.append(button);
  };
  if (options.canView) action(ds('savedView'), true, options.view);
  else if (saved.canOpen) {
    action(ds('savedOpen'), true, () => void bridge.openSavedFile(saved.path));
  }
  action(
    ds('savedFolder'),
    false,
    () => void bridge.showSavedInFolder(saved.path)
  );

  const dismiss = el('button', 'desktop-saved-toast-close');
  dismiss.type = 'button';
  dismiss.title = ds('cancel');
  dismiss.setAttribute('aria-label', dismiss.title);
  dismiss.append(el('i', 'ph ph-x'));
  dismiss.addEventListener('click', close);

  toast.append(
    el('i', 'ph ph-check-circle flex-shrink-0 text-2xl text-indigo-400'),
    text,
    actions,
    dismiss
  );
  document.body.append(toast);
  window.setTimeout(() => {
    if (toast.isConnected && !toast.matches(':hover')) close();
  }, SAVED_TOAST_MS);
}
