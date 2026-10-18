/**
 * Contract between the viewer page and Studio (desktop), which applies tools
 * to the document on screen. The viewer provides access to its tabs; Studio
 * may guard closing a tab that has unsaved changes. Tabs are named by the
 * File they were opened from, which never changes for a tab.
 */

export interface ViewerDocuments {
  /** The file of the tab on screen, or null when no tab is open. */
  active(): File | null;
  /** Shows these bytes in the file's tab, keeping the page and zoom. */
  show(file: File, bytes: Uint8Array): Promise<void>;
  /** Marks the file's tab as having unsaved changes, or not. */
  setDirty(file: File, dirty: boolean): void;
}

/** Answers whether a tab may close; may ask the user first. */
export type CloseGuard = (file: File) => Promise<boolean>;

/**
 * A key pressed inside a viewer frame, passed on to the page. Cancel the
 * event to keep the viewer from acting on the key too.
 */
export const VIEWER_KEYDOWN_EVENT = 'cit:viewer-keydown';

let documents: ViewerDocuments | null = null;
const waiting: Array<(docs: ViewerDocuments) => void> = [];
let closeGuard: CloseGuard | null = null;

export function provideViewerDocuments(docs: ViewerDocuments): void {
  documents = docs;
  for (const resolve of waiting.splice(0)) resolve(docs);
}

export function whenViewerDocuments(): Promise<ViewerDocuments> {
  return documents
    ? Promise.resolve(documents)
    : new Promise((resolve) => waiting.push(resolve));
}

export function setCloseGuard(guard: CloseGuard): void {
  closeGuard = guard;
}

export function mayClose(file: File): Promise<boolean> {
  return closeGuard ? closeGuard(file) : Promise.resolve(true);
}
