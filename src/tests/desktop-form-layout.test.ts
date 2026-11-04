import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFormLayout } from '../js/desktop/form-layout';

const TOOL_CARD = `
  <div id="uploader">
    <div id="tool-uploader">
      <button id="back-to-tools">Back</button>
      <h1>Compress PDF</h1>
      <p>Make it smaller.</p>
      <div id="drop-zone"><input id="file-input" type="file" /></div>
      <div id="file-display-area"></div>
      <div id="compress-options" class="hidden">
        <select id="level"></select>
        <button id="process-btn">Compress</button>
      </div>
      <div id="results" class="hidden"></div>
    </div>
  </div>`;

// The observer runs in a microtask, then waits a frame (a timer here).
async function flushFrames() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('desktop form layout', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)
    );
    document.body.className = '';
    document.body.innerHTML = TOOL_CARD;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('puts the files on the left and the options on the right', () => {
    initFormLayout();
    const card = document.getElementById('tool-uploader')!;
    const kids = Array.from(card.children).map((c) => c.id || c.className);
    expect(kids).toEqual(['back-to-tools', '', '', 'desktop-form']);
    const main = card.querySelector('.desktop-form-main')!;
    const side = card.querySelector('.desktop-form-side')!;
    expect(main.querySelector('#drop-zone')).not.toBeNull();
    expect(main.querySelector('#file-display-area')).not.toBeNull();
    expect(main.querySelector('#results')).not.toBeNull();
    expect(side.querySelector('#process-btn')).not.toBeNull();
    // Moved, not copied.
    expect(document.querySelectorAll('#process-btn')).toHaveLength(1);
  });

  it('turns on once the tool shows its options, and off again', async () => {
    initFormLayout();
    expect(document.body.classList.contains('desktop-form-on')).toBe(false);

    document.getElementById('compress-options')!.classList.remove('hidden');
    await flushFrames();
    expect(document.body.classList.contains('desktop-form-on')).toBe(true);

    document.getElementById('compress-options')!.classList.add('hidden');
    await flushFrames();
    expect(document.body.classList.contains('desktop-form-on')).toBe(false);
  });

  it('leaves a page alone that does not have the usual card', () => {
    document.getElementById('back-to-tools')!.remove();
    initFormLayout();
    expect(document.querySelector('.desktop-form')).toBeNull();
  });
});
