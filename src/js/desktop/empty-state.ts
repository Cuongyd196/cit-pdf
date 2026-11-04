/**
 * A tool page before a file is in (desktop only): the page is the drop zone
 * alone, shown as a compact row made for sitting above a file list. With
 * nothing under it the window looked empty, so until the tool has a file
 * the body has `desktop-awaiting-file` and the drop zone fills the card.
 *
 * "Has a file" is read from what the tool shows: its run button (hidden
 * until a file is in, on the usual card), or the viewer's document panel.
 */

const shown = (el: Element | null): boolean =>
  !!el && (el as HTMLElement).offsetParent !== null;

export function initEmptyState(): void {
  const uploader = document.getElementById('uploader');
  const dropZone = document.getElementById('drop-zone');
  if (!uploader || !dropZone) return;

  let queued = false;
  const update = () => {
    queued = false;
    const viewerPanel = document.getElementById('viewer-panel');
    const hasFile = viewerPanel
      ? !viewerPanel.classList.contains('hidden')
      : shown(document.getElementById('process-btn'));
    const awaiting = shown(dropZone) && !hasFile;
    document.body.classList.toggle('desktop-awaiting-file', awaiting);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  new MutationObserver(queue).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
  update();
}
