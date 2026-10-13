/**
 * About page (desktop): the "check for updates" button, for checking right
 * now. The daily automatic check lives in update-check.ts.
 */
import { getBridge } from './bridge.js';
import { applyDesktopStrings, ds } from './strings.js';
import { rememberUpdateResult } from './update-check.js';

document.addEventListener('DOMContentLoaded', () => {
  const bridge = getBridge();
  const section = document.getElementById('update-check');
  const button = document.getElementById(
    'update-check-btn'
  ) as HTMLButtonElement | null;
  const status = document.getElementById('update-status');
  const download = document.getElementById(
    'update-download'
  ) as HTMLAnchorElement | null;
  if (!bridge || !section || !button || !status || !download) return;

  applyDesktopStrings(section);
  section.classList.remove('hidden');

  button.addEventListener('click', () => {
    button.disabled = true;
    download.classList.add('hidden');
    status.className = 'mt-3 text-sm text-gray-400';
    status.textContent = ds('updateChecking');

    void bridge
      .checkForUpdate()
      .then((result) => {
        rememberUpdateResult(result);
        if (result.ok === false) {
          status.className = 'mt-3 text-sm text-yellow-500';
          status.textContent = ds(
            result.error === 'no-release' ? 'updateNoRelease' : 'updateFailed'
          );
        } else if (result.newer) {
          status.className = 'mt-3 text-sm font-semibold text-white';
          status.textContent = ds('updateAvailable', {
            latest: result.latest,
            current: result.current,
          });
          download.href = result.url;
          download.classList.remove('hidden');
        } else {
          status.className = 'mt-3 text-sm text-gray-300';
          status.textContent = ds('updateLatest', { current: result.current });
        }
      })
      .catch(() => {
        status.className = 'mt-3 text-sm text-yellow-500';
        status.textContent = ds('updateFailed');
      })
      .finally(() => {
        button.disabled = false;
      });
  });
});
