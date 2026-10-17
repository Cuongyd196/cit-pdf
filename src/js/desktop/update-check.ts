/**
 * Automatic update check (desktop): at most once a day, asks GitHub for the
 * latest release and, when it is newer, shows a notice on the home page.
 * It only tells the user; nothing is downloaded or installed. Can be turned
 * off in Settings.
 */
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import { getBridge, type UpdateCheckResult } from './bridge.js';
import { ds } from './strings.js';

const AUTO_KEY = 'cit:auto-update-check';
const RESULT_KEY = 'cit:update-check';
const DISMISSED_KEY = 'cit:update-dismissed';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface StoredResult {
  time: number;
  /** Version that was running when the check was made. */
  current: string;
  latest: string;
  newer: boolean;
  url: string;
}

export function autoUpdateEnabled(): boolean {
  return getStoredItem(AUTO_KEY) !== 'false';
}

export function setAutoUpdate(enabled: boolean): void {
  setStoredItem(AUTO_KEY, String(enabled));
}

/** Keeps a successful check, so the home page need not ask again today. */
export function rememberUpdateResult(result: UpdateCheckResult): void {
  if (result.ok === false) return;
  const stored: StoredResult = {
    time: Date.now(),
    current: result.current,
    latest: result.latest,
    newer: result.newer,
    url: result.url,
  };
  setStoredItem(RESULT_KEY, JSON.stringify(stored));
}

function readStoredResult(): StoredResult | null {
  try {
    const stored = JSON.parse(getStoredItem(RESULT_KEY) || 'null');
    return stored && typeof stored.latest === 'string' ? stored : null;
  } catch {
    return null;
  }
}

function runningVersion(): string {
  return document.getElementById('app-version')?.textContent?.trim() ?? '';
}

/** The last result if it is still good, else a fresh one from GitHub. */
async function latestResult(): Promise<StoredResult | null> {
  const stored = readStoredResult();
  // A result from before an upgrade says nothing about this version.
  const fresh =
    stored &&
    stored.current === runningVersion() &&
    Date.now() - stored.time < CHECK_INTERVAL_MS;
  if (fresh) return stored;

  const bridge = getBridge();
  if (!bridge) return null;
  try {
    rememberUpdateResult(await bridge.checkForUpdate());
  } catch (e) {
    console.warn('[Desktop] Update check failed:', e);
    return null;
  }
  const updated = readStoredResult();
  return updated && updated.current === runningVersion() ? updated : null;
}

function showBanner(result: StoredResult, before: Element): void {
  document.getElementById('desktop-update-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'desktop-update-banner';
  banner.className = 'desktop-update-banner';
  banner.setAttribute('role', 'status');
  banner.dataset.noTranslate = '';

  const icon = document.createElement('i');
  icon.className = 'ph ph-arrow-circle-up text-xl flex-shrink-0';

  const text = document.createElement('span');
  text.className = 'flex-1';
  text.textContent = ds('updateAvailable', {
    latest: result.latest,
    current: result.current,
  });

  const download = document.createElement('a');
  download.className = 'desktop-update-banner-action';
  download.href = result.url;
  download.target = '_blank';
  download.rel = 'noopener noreferrer';
  download.textContent = ds('updateDownload');

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'desktop-update-banner-dismiss';
  dismiss.textContent = ds('updateDismiss');
  dismiss.title = ds('updateDismissHint');
  // Hidden for this release only; the next one shows again.
  dismiss.addEventListener('click', () => {
    setStoredItem(DISMISSED_KEY, result.latest);
    banner.remove();
  });

  banner.append(icon, text, download, dismiss);
  before.before(banner);
}

/** Home page only: shows the notice when a newer release is out. */
export async function initUpdateBanner(): Promise<void> {
  const grid = document.getElementById('tool-grid');
  if (!grid || !autoUpdateEnabled()) return;

  const result = await latestResult();
  if (!result?.newer || getStoredItem(DISMISSED_KEY) === result.latest) return;
  // Above the recent tools when that row exists, else above the grid.
  showBanner(
    result,
    document.getElementById('home-drop') ??
      document.getElementById('desktop-recent') ??
      grid
  );
}
