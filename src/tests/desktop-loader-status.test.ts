import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLoaderStatus } from '../js/desktop/loader-status';

const LOADER = `
  <div id="loader-modal" class="hidden">
    <div><p id="loader-text">Processing...</p></div>
  </div>`;

const line = () =>
  document.querySelector<HTMLElement>('.desktop-loader-elapsed')!;

// The observer runs in a microtask.
const flush = () => Promise.resolve();

describe('desktop loader status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = LOADER;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('says how long a job has run once it takes a while', async () => {
    initLoaderStatus();
    document.getElementById('loader-modal')!.classList.remove('hidden');
    await flush();
    expect(line().classList.contains('hidden')).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(line().classList.contains('hidden')).toBe(false);
    expect(line().textContent).toMatch(/0:05/);

    vi.advanceTimersByTime(20_000);
    expect(line().textContent).toMatch(/0:25\. .+/);
  });

  it('starts again from zero for the next job', async () => {
    initLoaderStatus();
    const modal = document.getElementById('loader-modal')!;
    modal.classList.remove('hidden');
    await flush();
    vi.advanceTimersByTime(30_000);

    modal.classList.add('hidden');
    await flush();
    expect(line().classList.contains('hidden')).toBe(true);

    modal.classList.remove('hidden');
    await flush();
    vi.advanceTimersByTime(4000);
    expect(line().textContent).toMatch(/0:04/);
  });
});
