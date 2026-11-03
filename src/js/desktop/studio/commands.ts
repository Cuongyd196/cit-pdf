/**
 * Every command of the viewer's ribbon, in one list: the tabs, their
 * toolbars and the "All tools" panel are all made from it. A command acts
 * on the document on screen, through Studio (a tool with options in the
 * drawer), the page grid, or the tool's own page (the document goes along).
 */
import type { DesktopStringKey } from '../strings.js';

export type RibbonTab = 'read' | 'pages' | 'edit' | 'convert' | 'secure';

/**
 * Ctrl+K / File > Find a tool…: dispatched (cancelable) on the document
 * before the shell's own search; the viewer's ribbon cancels it and opens
 * its All tools panel.
 */
export const FIND_TOOL_EVENT = 'cit:find-tool';

export type GridOp =
  | 'rotate-left'
  | 'rotate-right'
  | 'delete'
  | 'extract'
  | 'insert'
  | 'blank'
  | 'select-all'
  | 'clear';

export type CommandAction =
  /** Opens a Studio tool (tools.ts) by id. */
  | { kind: 'studio'; tool: string }
  | { kind: 'grid'; op: GridOp }
  /** Opens a tool's page by slug, with the document. */
  | { kind: 'page'; slug: string };

export interface RibbonCommand {
  id: string;
  tab: RibbonTab;
  /** Phosphor icon name without "ph-"; a page command takes the tool's. */
  icon?: string;
  /** A page command is named after its tool. */
  label?: DesktopStringKey;
  hint?: DesktopStringKey;
  action: CommandAction;
  /**
   * The tool pages this command does in place: the "All tools" panel opens
   * the command's tab for them instead of leaving (and, for a Studio tool,
   * its options; page-grid commands wait for pages to be selected).
   */
  standsFor?: string[];
  /** Starts a new group on the toolbar (a divider before it). */
  group?: true;
  /** Pushed to the far end of the toolbar. */
  end?: true;
}

export const RIBBON_TABS: Array<{ id: RibbonTab; label: DesktopStringKey }> = [
  { id: 'read', label: 'ribbonRead' },
  { id: 'pages', label: 'ribbonPages' },
  { id: 'edit', label: 'ribbonEdit' },
  { id: 'convert', label: 'ribbonConvert' },
  { id: 'secure', label: 'ribbonSecure' },
];

const page = (slug: string, tab: RibbonTab, group?: true): RibbonCommand => ({
  id: `page:${slug}`,
  tab,
  action: { kind: 'page', slug },
  group,
});

export const RIBBON_COMMANDS: RibbonCommand[] = [
  // Trang: the page grid
  {
    id: 'rotate-left',
    tab: 'pages',
    icon: 'arrow-counter-clockwise',
    label: 'gridRotateLeft',
    action: { kind: 'grid', op: 'rotate-left' },
    standsFor: ['rotate-pdf'],
  },
  {
    id: 'rotate-right',
    tab: 'pages',
    icon: 'arrow-clockwise',
    label: 'gridRotateRight',
    action: { kind: 'grid', op: 'rotate-right' },
  },
  {
    id: 'delete',
    tab: 'pages',
    icon: 'trash',
    label: 'gridDelete',
    action: { kind: 'grid', op: 'delete' },
    standsFor: ['delete-pages', 'organize-pdf'],
  },
  {
    id: 'extract',
    tab: 'pages',
    icon: 'export',
    label: 'gridExtract',
    hint: 'gridExtractHint',
    action: { kind: 'grid', op: 'extract' },
    standsFor: ['extract-pages'],
    group: true,
  },
  {
    id: 'insert',
    tab: 'pages',
    icon: 'file-plus',
    label: 'gridInsert',
    hint: 'studioInsertHint',
    action: { kind: 'grid', op: 'insert' },
    group: true,
  },
  {
    id: 'blank',
    tab: 'pages',
    icon: 'file',
    label: 'gridBlank',
    hint: 'gridBlankHint',
    action: { kind: 'grid', op: 'blank' },
    standsFor: ['add-blank-page'],
  },
  page('split-pdf', 'pages', true),
  page('merge-pdf', 'pages'),
  {
    id: 'select-all',
    tab: 'pages',
    label: 'gridSelectAll',
    action: { kind: 'grid', op: 'select-all' },
    end: true,
  },
  {
    id: 'clear',
    tab: 'pages',
    label: 'gridClear',
    action: { kind: 'grid', op: 'clear' },
    end: true,
  },

  // Sửa
  {
    id: 'edit',
    tab: 'edit',
    icon: 'pencil-simple-line',
    label: 'studioEdit',
    hint: 'studioEditHint',
    action: { kind: 'studio', tool: 'edit' },
    standsFor: ['edit-pdf'],
  },
  {
    id: 'watermark',
    tab: 'edit',
    icon: 'drop-half',
    label: 'studioWatermark',
    hint: 'studioWatermarkHint',
    action: { kind: 'studio', tool: 'watermark' },
    standsFor: ['add-watermark'],
    group: true,
  },
  {
    id: 'page-numbers',
    tab: 'edit',
    icon: 'list-numbers',
    label: 'studioPageNumbers',
    hint: 'studioPageNumbersHint',
    action: { kind: 'studio', tool: 'page-numbers' },
    standsFor: ['page-numbers'],
  },
  {
    id: 'flatten',
    tab: 'edit',
    icon: 'stack-simple',
    label: 'studioFlatten',
    hint: 'studioFlattenHint',
    action: { kind: 'studio', tool: 'flatten' },
    standsFor: ['flatten-pdf'],
  },
  page('edit-pdf-text', 'edit', true),
  page('sign-pdf', 'edit'),
  page('header-footer', 'edit'),

  // Chuyển đổi
  {
    id: 'to-word',
    tab: 'convert',
    icon: 'microsoft-word-logo',
    label: 'studioToWord',
    hint: 'studioToWordHint',
    action: { kind: 'studio', tool: 'to-word' },
    standsFor: ['pdf-to-word'],
  },
  {
    id: 'to-text',
    tab: 'convert',
    icon: 'text-t',
    label: 'studioToText',
    hint: 'studioToTextHint',
    action: { kind: 'studio', tool: 'to-text' },
    standsFor: ['pdf-to-text'],
  },
  page('pdf-to-excel', 'convert', true),
  page('pdf-to-jpg', 'convert'),
  page('ocr-pdf', 'convert'),

  // Tối ưu & bảo mật
  {
    id: 'compress',
    tab: 'secure',
    icon: 'arrows-in',
    label: 'studioCompress',
    hint: 'studioCompressHint',
    action: { kind: 'studio', tool: 'compress' },
    standsFor: ['compress-pdf'],
  },
  page('protect-pdf', 'secure', true),
  page('unlock-pdf', 'secure'),
  page('digital-sign-pdf', 'secure'),
  page('pdf-to-pdfa', 'secure', true),
  page('repair-pdf', 'secure'),
];

/** The command that does a tool page's job in place, if one does. */
export function commandStandingFor(slug: string): RibbonCommand | undefined {
  return RIBBON_COMMANDS.find((command) => command.standsFor?.includes(slug));
}
