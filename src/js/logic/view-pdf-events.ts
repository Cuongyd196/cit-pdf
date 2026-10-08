/**
 * The viewer page asks the desktop shell to hand the open file to another
 * tool through this event; the shell owns the tool list and the picker.
 */
export const VIEWER_TOOLS_EVENT = 'cit:viewer-tools';

export interface ViewerToolsDetail {
  file: File;
}
