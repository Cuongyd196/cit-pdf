import { describe, it, expect } from 'vitest';
import {
  RASTER_START,
  condenseLadder,
  nextRasterSettings,
} from '../js/utils/compress-target';

describe('condenseLadder', () => {
  it('starts at the chosen level and goes up', () => {
    expect(condenseLadder('balanced')).toEqual([
      'balanced',
      'aggressive',
      'extreme',
    ]);
    expect(condenseLadder('extreme')).toEqual(['extreme']);
  });

  it('falls back to balanced for an unknown level', () => {
    expect(condenseLadder('nope')[0]).toBe('balanced');
  });
});

describe('nextRasterSettings', () => {
  it('shrinks the scale by the square root of the reduction needed', () => {
    const next = nextRasterSettings({ scale: 2, quality: 0.6 }, 4000, 1000);
    // 1000 * 0.9 / 4000 = 0.225, sqrt = 0.474
    expect(next?.scale).toBeCloseTo(2 * Math.sqrt(0.225), 5);
    expect(next?.quality).toBeCloseTo(0.55, 5);
  });

  it('always moves to smaller settings, even when barely over the limit', () => {
    const next = nextRasterSettings(RASTER_START, 1001, 1000);
    expect(next!.scale).toBeLessThan(RASTER_START.scale);
  });

  it('lowers quality once the scale is at its floor', () => {
    const next = nextRasterSettings({ scale: 1, quality: 0.5 }, 4000, 1000);
    expect(next?.scale).toBe(0.9);
    expect(next!.quality).toBeLessThan(0.5);
    expect(next!.quality).toBeGreaterThanOrEqual(0.25);
  });

  it('gives up when nothing smaller is left', () => {
    expect(
      nextRasterSettings({ scale: 0.9, quality: 0.25 }, 4000, 1000)
    ).toBeNull();
  });

  it('reaches the floor in a bounded number of steps', () => {
    let settings: typeof RASTER_START | null = RASTER_START;
    let steps = 0;
    while (settings && steps < 50) {
      settings = nextRasterSettings(settings, 10_000_000, 1);
      steps++;
    }
    expect(settings).toBeNull();
    expect(steps).toBeLessThan(10);
  });
});
