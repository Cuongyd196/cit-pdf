/**
 * The tools' "Processing…" card (desktop only) says only what runs, with a
 * spinner, so a long job looked like a hung one. After a few seconds the
 * card also shows how long it has been running, and later that large files
 * take minutes.
 */
import { ds } from './strings.js';

const SHOW_AFTER_S = 3;
const SLOW_AFTER_S = 20;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function initLoaderStatus(): void {
  const modal = document.getElementById('loader-modal');
  const card = modal?.firstElementChild;
  if (!modal || !card) return;

  const line = document.createElement('p');
  line.className = 'desktop-loader-elapsed hidden';
  line.dataset.noTranslate = '';
  card.append(line);

  let started = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    line.classList.toggle('hidden', seconds < SHOW_AFTER_S);
    const elapsed = ds('loaderElapsed', { time: formatTime(seconds) });
    line.textContent =
      seconds >= SLOW_AFTER_S ? `${elapsed}. ${ds('loaderSlow')}` : elapsed;
  };

  const update = () => {
    const shown = !modal.classList.contains('hidden');
    if (shown && timer === undefined) {
      started = Date.now();
      tick();
      timer = setInterval(tick, 1000);
    } else if (!shown && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
      line.classList.add('hidden');
    }
  };

  new MutationObserver(update).observe(modal, {
    attributes: true,
    attributeFilter: ['class'],
  });
  update();
}
