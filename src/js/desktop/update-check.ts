/**
 * Automatic update check (desktop): at most once a day, asks GitHub for the
 * latest release. When it is newer, a dialog says so (at most once a day,
 * on whichever page is open) and the status bar keeps a link to it. The
 * dialog's main button downloads the installer, checks its hash, runs it and
 * restarts the app; the portable app gets the download page instead. Can be
 * turned off in Settings.
 */
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import { getBridge, type UpdateCheckResult } from './bridge.js';
import { ds } from './strings.js';

const AUTO_KEY = 'cit:auto-update-check';
const RESULT_KEY = 'cit:update-check';
/** When the dialog may show again after "Later" or closing it. */
const SNOOZE_KEY = 'cit:update-snoozed-until';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const DIALOG_ID = 'desktop-update-dialog';

type ShownResult = Omit<StoredResult, 'time'>;

interface StoredResult {
  time: number;
  /** Version that was running when the check was made. */
  current: string;
  latest: string;
  newer: boolean;
  url: string;
  canInstall?: boolean;
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
    canInstall: result.canInstall,
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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function closeDialog(): void {
  setStoredItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  document.getElementById(DIALOG_ID)?.remove();
}

/** Download, check and run the installer; the app quits when it starts. */
async function install(
  result: ShownResult,
  actions: HTMLElement,
  status: HTMLElement,
  bar: HTMLElement
): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.installUpdate) return;
  for (const button of actions.querySelectorAll('button')) {
    button.disabled = true;
  }
  status.classList.remove('hidden', 'is-error');
  status.textContent = ds('updateInstalling', { pct: 0 });
  bar.parentElement?.classList.remove('hidden');

  const off = bridge.onUpdateProgress?.(({ received, total }) => {
    const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
    bar.style.width = `${pct.toFixed(1)}%`;
    status.textContent = ds('updateInstalling', { pct: pct.toFixed(0) });
  });
  try {
    // The main process keeps the installer of its last check only: ask
    // again when the dialog came from an earlier session's result.
    await bridge.checkForUpdate();
    const outcome = await bridge.installUpdate();
    // Narrowed on false: the project is not strict.
    if (outcome.ok !== false) {
      status.textContent = ds('updateRestarting');
      return;
    }
    if (outcome.error === 'manual') {
      window.open(result.url, '_blank', 'noopener');
      closeDialog();
      return;
    }
    status.classList.add('is-error');
    status.textContent = ds(
      outcome.error === 'verify' ? 'updateVerifyFailed' : 'updateInstallFailed'
    );
  } catch (e) {
    console.warn('[Desktop] Update failed:', e);
    status.classList.add('is-error');
    status.textContent = ds('updateInstallFailed');
  } finally {
    off?.();
  }
  bar.parentElement?.classList.add('hidden');
  for (const button of actions.querySelectorAll('button')) {
    button.disabled = false;
  }
}

/** PdfCraft-style notice: app, versions, What's new, Later, Update. */
export function showUpdateDialog(result: ShownResult): void {
  if (document.getElementById(DIALOG_ID)) return;
  const overlay = el('div', 'desktop-update-dialog');
  overlay.id = DIALOG_ID;
  overlay.dataset.noTranslate = '';
  const box = el('div', 'desktop-update-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'desktop-update-title');

  const head = el('div', 'desktop-update-head');
  const logo = el('img', 'desktop-update-logo');
  logo.src = `${import.meta.env.BASE_URL}images/cit-pdf-logo.svg`;
  logo.alt = '';
  const titles = el('div', 'min-w-0 flex-1');
  const titleRow = el('div', 'flex flex-wrap items-center gap-2');
  const title = el('h2', 'desktop-update-title', 'CIT-PDF');
  title.id = 'desktop-update-title';
  titleRow.append(
    title,
    el('span', 'desktop-update-badge', ds('updateBadge'))
  );
  titles.append(
    titleRow,
    el(
      'p',
      'desktop-update-versions',
      ds('updateVersions', { current: result.current, latest: result.latest })
    )
  );
  const close = el('button', 'desktop-update-close');
  close.type = 'button';
  close.title = ds('updateClose');
  close.setAttribute('aria-label', ds('updateClose'));
  close.append(el('i', 'ph ph-x'));
  close.addEventListener('click', closeDialog);
  head.append(logo, titles, close);

  const text = el(
    'p',
    'desktop-update-text',
    ds('updateText', { latest: result.latest })
  );
  const track = el('div', 'desktop-update-track hidden');
  const bar = el('div', 'desktop-update-bar');
  track.append(bar);
  const status = el('p', 'desktop-update-status hidden');

  const foot = el('div', 'desktop-update-foot');
  const whatsNew = el('a', 'desktop-update-link', ds('updateWhatsNew'));
  whatsNew.href = result.url;
  whatsNew.target = '_blank';
  whatsNew.rel = 'noopener noreferrer';
  const actions = el('div', 'flex flex-wrap gap-2');
  const later = el('button', 'desktop-update-later', ds('updateLater'));
  later.type = 'button';
  later.addEventListener('click', closeDialog);
  const canInstall = !!result.canInstall && !!getBridge()?.installUpdate;
  const update = el(
    'button',
    'desktop-update-primary',
    ds(canInstall ? 'updateInstall' : 'updateDownload')
  );
  update.type = 'button';
  update.addEventListener('click', () => {
    if (canInstall) void install(result, actions, status, bar);
    else {
      window.open(result.url, '_blank', 'noopener');
      closeDialog();
    }
  });
  actions.append(later, update);
  foot.append(whatsNew, actions);

  box.append(head, text, track, status, foot);
  overlay.append(box);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !update.disabled) closeDialog();
  });
  document.body.append(overlay);
  update.focus();
}

/** Status bar, every page: "Version 1.0.6 available" beside the version. */
function showStatusLink(result: StoredResult): void {
  const version = document.getElementById('app-version');
  if (!version || document.getElementById('desktop-update-status')) return;
  const link = document.createElement('a');
  link.id = 'desktop-update-status';
  link.className = 'desktop-update-status';
  link.href = result.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = ds('updateStatusHint', { current: result.current });
  link.dataset.noTranslate = '';
  // Opens the dialog, which can install; the page is one click further.
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showUpdateDialog(result);
  });
  const icon = document.createElement('i');
  icon.className = 'ph ph-arrow-circle-up';
  const text = document.createElement('span');
  text.textContent = ds('updateStatus', { latest: result.latest });
  link.append(icon, text);
  (version.parentElement ?? version).after(link);
}

/**
 * When a newer release is out: the link in the status bar on every page and
 * the dialog, unless the user put it off in the last day.
 */
export async function initUpdateBanner(): Promise<void> {
  if (!autoUpdateEnabled()) return;
  const result = await latestResult();
  if (!result?.newer) return;
  showStatusLink(result);
  const snoozedUntil = Number(getStoredItem(SNOOZE_KEY)) || 0;
  if (Date.now() >= snoozedUntil) showUpdateDialog(result);
}
