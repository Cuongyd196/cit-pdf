/**
 * Events between the viewer page and the desktop shell. The shell owns the
 * tool list and the row of quick actions above the document.
 */

/** The viewer page reports its tabs whenever they change. */
export const VIEWER_TABS_EVENT = 'cit:viewer-tabs';

export interface ViewerTabsDetail {
  files: File[];
  /** Index of the tab on screen, or -1 when none is open. */
  active: number;
}

/** The shell asks the viewer page to show one of its tabs. */
export const VIEWER_SELECT_EVENT = 'cit:viewer-select';

export interface ViewerSelectDetail {
  index: number;
}
