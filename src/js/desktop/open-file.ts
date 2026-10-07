export const VIEWER_SLUG = 'view-pdf';

export type OpenFileAction = 'load' | 'navigate' | 'picker';

/**
 * What to do with a PDF handed to the app by the OS: show it in the viewer,
 * going there first if needed. Without a viewer page (tool disabled), fall
 * back to asking which tool to use.
 */
export function openFileAction(
  currentSlug: string,
  hasViewer: boolean
): OpenFileAction {
  if (!hasViewer) return 'picker';
  return currentSlug === VIEWER_SLUG ? 'load' : 'navigate';
}
