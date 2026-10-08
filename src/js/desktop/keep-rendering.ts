/**
 * Keeps canvas work going while the window is minimised or covered.
 *
 * PDF.js paints pages in requestAnimationFrame callbacks. Chromium stops
 * delivering frames to a window nobody can see, so a conversion such as
 * PDF to JPG stalls the moment the user minimises the app and only resumes
 * when they come back. Each callback therefore also gets a timer: whichever
 * fires first runs it. With the window visible the frame always wins, so
 * nothing changes there. (Timers stay on time when hidden because the
 * window is created with backgroundThrottling off.)
 */
const HIDDEN_FRAME_MS = 100;

export function keepRenderingWhenHidden(): void {
  const requestFrame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  const pending = new Map<number, { frame: number; timer: number }>();
  let nextId = 1;

  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = nextId++;
    const run = (time: number) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      cancelFrame(entry.frame);
      window.clearTimeout(entry.timer);
      callback(time);
    };
    pending.set(id, {
      frame: requestFrame(run),
      timer: window.setTimeout(() => run(performance.now()), HIDDEN_FRAME_MS),
    });
    return id;
  };

  window.cancelAnimationFrame = (id: number): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    cancelFrame(entry.frame);
    window.clearTimeout(entry.timer);
  };
}
