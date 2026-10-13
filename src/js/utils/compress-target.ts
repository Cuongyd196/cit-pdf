/**
 * Helpers for compressing a PDF down to a size limit: which settings to try
 * next when the previous attempt came out too large.
 */

export interface RasterSettings {
  /** Render scale relative to PDF points (1 = 72 DPI). */
  scale: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
}

export const CONDENSE_LEVELS = [
  'light',
  'balanced',
  'aggressive',
  'extreme',
] as const;

/** First attempt when pages have to be turned into images: about 150 DPI. */
export const RASTER_START: RasterSettings = { scale: 2.0, quality: 0.6 };

// Below roughly 65 DPI body text stops being readable.
const MIN_SCALE = 0.9;
const MIN_QUALITY = 0.25;
// Aim a little under the limit so the next attempt does not land just above.
const SAFETY = 0.9;

/** The chosen level and every stronger one, weakest first. */
export function condenseLadder(level: string): string[] {
  const start = CONDENSE_LEVELS.indexOf(
    level as (typeof CONDENSE_LEVELS)[number]
  );
  return CONDENSE_LEVELS.slice(start < 0 ? 1 : start);
}

/**
 * Settings for the next image attempt, given that `current` produced `size`
 * bytes and the result must fit in `target`. Returns null when there is
 * nothing smaller left to try.
 */
export function nextRasterSettings(
  current: RasterSettings,
  size: number,
  target: number
): RasterSettings | null {
  if (current.scale <= MIN_SCALE && current.quality <= MIN_QUALITY) return null;

  // File size follows the pixel count, so the scale shrinks by the square
  // root of the reduction still needed.
  const ratio = Math.min((target * SAFETY) / size, 0.95);
  const scale = current.scale * Math.sqrt(ratio);
  if (scale >= MIN_SCALE) {
    return { scale, quality: Math.max(MIN_QUALITY, current.quality - 0.05) };
  }
  // Resolution is at its floor: the rest has to come from JPEG quality.
  const reachedByScale = (MIN_SCALE / current.scale) ** 2;
  const quality = current.quality * Math.min(ratio / reachedByScale, 0.8);
  return { scale: MIN_SCALE, quality: Math.max(MIN_QUALITY, quality) };
}
