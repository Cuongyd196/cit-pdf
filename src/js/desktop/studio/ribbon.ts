/**
 * The viewer's ribbon: a row of tabs (Đọc, Trang, Sửa, Chuyển đổi, Tối ưu &
 * bảo mật, Tất cả công cụ) with Studio's Undo/Redo/Save at its end, and the
 * chosen tab's toolbar under it. Built from commands.ts; the Trang tab shows
 * the page grid in place of the reader, "All tools" a panel on the left.
 */
import { rewriteLinks } from '../../i18n/i18n.js';
import { getStoredItem, setStoredItem } from '../../utils/safe-storage.js';
import { ds } from '../strings.js';
import {
  RIBBON_COMMANDS,
  RIBBON_TABS,
  commandStandingFor,
  type RibbonCommand,
  type RibbonTab,
} from './commands.js';
import { initPageGrid, type PageGrid } from './page-grid.js';
import type { StudioApi } from './studio.js';

const TAB_KEY = 'cit:ribbon-tab';

/** A tool page as the shell knows it. */
export interface RibbonTool {
  slug: string;
  href: string;
  name: string;
  subtitle: string;
  /** Phosphor class, "ph-…". */
  icon: string;
}

export interface RibbonOptions {
  /** The ribbon's host (#viewer-actions). */
  host: HTMLElement;
  /** Placed first on the tab row (the sidebar toggle). */
  lead: HTMLElement[];
  tool(slug: string): RibbonTool | undefined;
  /** Tool groups for the "All tools" panel, as in the sidebar. */
  groups: Array<{ name: string; tools: RibbonTool[] }>;
  /** Before leaving for a tool's page: the document goes along. */
  beforeLeaving(): void;
  /** Shows a page of the tab on screen in the reader. */
  goToPage(page: number): void;
}

export interface Ribbon {
  /** Where Studio puts Undo, Redo and Save. */
  clusterHost: HTMLElement;
  attach(studio: StudioApi): void;
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

const icon = (name: string) =>
  make('i', `ph ${name.startsWith('ph-') ? name : `ph-${name}`}`);

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim();

type ShownTab = RibbonTab | 'all';

export function createRibbon(options: RibbonOptions): Ribbon {
  const { host } = options;
  host.classList.add('ribbon');
  const top = make('div', 'ribbon-top');
  const tabList = make('div', 'ribbon-tabs');
  tabList.setAttribute('role', 'tablist');
  top.append(...options.lead, tabList);
  const bar = make('div', 'ribbon-bar');
  bar.setAttribute('role', 'toolbar');
  host.replaceChildren(top, bar);

  const stored = getStoredItem(TAB_KEY);
  let tab: ShownTab =
    stored === 'all' || RIBBON_TABS.some((t) => t.id === stored)
      ? (stored as ShownTab)
      : 'read';
  let studio: StudioApi | null = null;
  let grid: PageGrid | null = null;

  // ---- The All tools panel, left of the document
  const panel = make('aside', 'ribbon-all hidden');
  panel.setAttribute('aria-label', ds('ribbonAll'));
  const container = document.getElementById('pdf-viewer-container');
  container?.before(panel);
  const search = make('input', 'studio-search');
  search.type = 'search';
  search.placeholder = ds('ribbonAllSearch');
  const list = make('div', 'ribbon-all-list');
  panel.append(make('h2', 'ribbon-all-title', ds('ribbonAll')), search, list);

  function panelItem(tool: RibbonTool): HTMLElement {
    const command = commandStandingFor(tool.slug);
    const label = make('span', 'min-w-0 flex-1 truncate', tool.name);
    if (command) {
      const item = make('button', 'ribbon-all-item');
      item.type = 'button';
      item.title = `${tool.subtitle}\n${ds('ribbonInPlace')}`;
      item.append(icon(tool.icon), label);
      item.addEventListener('click', () => {
        setTab(command.tab);
        // The grid's commands act on a selection the user makes next.
        if (command.action.kind === 'studio') runCommand(command);
      });
      return item;
    }
    const item = make('a', 'ribbon-all-item');
    item.href = tool.href;
    item.title = `${tool.subtitle}\n${ds('ribbonOpensPage')}`;
    item.append(icon(tool.icon), label, icon('arrow-up-right ribbon-external'));
    item.addEventListener('click', () => options.beforeLeaving());
    return item;
  }

  function renderPanel(): void {
    const q = fold(search.value);
    const sections: HTMLElement[] = [];
    for (const group of options.groups) {
      const tools = group.tools.filter(
        (tool) => !q || fold(`${tool.name} ${tool.subtitle}`).includes(q)
      );
      if (tools.length === 0) continue;
      const section = make('section', 'ribbon-all-group');
      section.append(
        make('h3', 'ribbon-all-heading', group.name),
        ...tools.map(panelItem)
      );
      sections.push(section);
    }
    list.replaceChildren(
      ...(sections.length
        ? sections
        : [make('p', 'studio-empty', ds('studioNoResults'))])
    );
    rewriteLinks();
  }
  search.addEventListener('input', renderPanel);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      renderPanel();
    } else if (e.key === 'Enter') {
      list.querySelector<HTMLElement>('.ribbon-all-item')?.click();
    }
  });

  // ---- Tabs
  const tabButtons = new Map<ShownTab, HTMLButtonElement>();
  const tabs: Array<{ id: ShownTab; label: string; icon?: string }> = [
    ...RIBBON_TABS.map((t) => ({ id: t.id as ShownTab, label: ds(t.label) })),
    { id: 'all', label: ds('ribbonAll'), icon: 'squares-four' },
  ];
  for (const t of tabs) {
    const button = make('button', 'ribbon-tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.tab = t.id;
    if (t.icon) button.append(icon(t.icon));
    button.append(make('span', '', t.label));
    button.addEventListener('click', () => setTab(t.id));
    tabButtons.set(t.id, button);
    tabList.append(button);
  }

  function setTab(next: ShownTab): void {
    if (next === tab && next !== 'all') return;
    // "All tools" again closes the panel, back to reading.
    if (next === 'all' && tab === 'all') next = 'read';
    tab = next;
    setStoredItem(TAB_KEY, tab);
    // A tool's options belong to its tab.
    const shownTool = studio?.shownTool();
    if (
      shownTool &&
      !RIBBON_COMMANDS.some(
        (c) =>
          c.tab === tab &&
          c.action.kind === 'studio' &&
          c.action.tool === shownTool
      ) &&
      !(tab === 'pages' && shownTool === 'insert')
    ) {
      studio?.closeDrawer();
    }
    render();
    if (tab === 'all') {
      renderPanel();
      search.focus();
    }
  }

  // ---- Toolbar
  function commandLabel(command: RibbonCommand): {
    label: string;
    title: string;
    iconName: string;
    href?: string;
  } | null {
    if (command.action.kind === 'page') {
      const tool = options.tool(command.action.slug);
      if (!tool) return null;
      return {
        label: tool.name,
        title: `${tool.subtitle}\n${ds('ribbonOpensPage')}`,
        iconName: tool.icon,
        href: tool.href,
      };
    }
    return {
      label: command.label ? ds(command.label) : command.id,
      title: command.hint ? ds(command.hint) : '',
      iconName: command.icon ?? '',
    };
  }

  function runCommand(command: RibbonCommand): void {
    const action = command.action;
    if (action.kind === 'studio') studio?.openTool(action.tool);
    else if (action.kind === 'grid') void grid?.run(action.op);
  }

  function isActive(command: RibbonCommand): boolean {
    if (command.action.kind !== 'studio' || !studio) return false;
    return (
      studio.shownTool() === command.action.tool ||
      (command.action.tool === 'edit' && studio.isEditing())
    );
  }

  function isEnabled(command: RibbonCommand): boolean {
    if (command.action.kind === 'page') return true;
    if (!studio || studio.isBusy()) return false;
    if (command.action.kind === 'grid') {
      return grid?.canRun(command.action.op) ?? false;
    }
    return true;
  }

  function renderBar(): void {
    const items: HTMLElement[] = [];
    const ends: HTMLElement[] = [];
    for (const command of RIBBON_COMMANDS.filter((c) => c.tab === tab)) {
      const look = commandLabel(command);
      if (!look) continue;
      const button = look.href
        ? Object.assign(make('a', 'pdf-view-action ribbon-command'), {
            href: look.href,
          })
        : Object.assign(make('button', 'pdf-view-action ribbon-command'), {
            type: 'button',
          });
      button.dataset.command = command.id;
      if (look.title) button.title = look.title;
      if (look.iconName) button.append(icon(look.iconName));
      button.append(make('span', '', look.label));
      if (look.href) {
        button.append(icon('arrow-up-right ribbon-external'));
        button.addEventListener('click', () => options.beforeLeaving());
      } else {
        button.addEventListener('click', () => runCommand(command));
        (button as HTMLButtonElement).disabled = !isEnabled(command);
      }
      button.classList.toggle('active', isActive(command));
      const target = command.end ? ends : items;
      if (command.group && target.length > 0) {
        target.push(make('span', 'pdf-view-actions-divider'));
      }
      target.push(button);
    }
    if (ends.length) {
      const spacer = make('span', 'ribbon-spacer');
      items.push(spacer, ...ends);
    }
    bar.replaceChildren(...items);
    bar.classList.toggle('hidden', items.length === 0);
    rewriteLinks();
  }

  function render(): void {
    for (const [id, button] of tabButtons) {
      const on = id === tab;
      button.classList.toggle('active', on);
      button.setAttribute('aria-selected', String(on));
    }
    panel.classList.toggle('hidden', tab !== 'all');
    if (tab === 'pages') grid?.show();
    else grid?.hide();
    renderBar();
  }

  render();

  return {
    clusterHost: top,
    attach(api) {
      studio = api;
      if (container) {
        grid = initPageGrid({
          container,
          studio: api,
          openPage: (page) => {
            setTab('read');
            options.goToPage(page);
          },
        });
        grid.onChange(renderBar);
      }
      api.onChange(renderBar);
      render();
    },
  };
}
