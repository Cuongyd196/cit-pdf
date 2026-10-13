import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../desktop/src/version';

describe('isNewerVersion', () => {
  it('detects a higher version', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('compares numbers, not text', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('is false for the same or an older version', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
  });

  it('accepts a release tag and uneven lengths', () => {
    expect(isNewerVersion('v1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('v1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.1', '1.0.5')).toBe(true);
    expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
  });

  it('ignores pre-release and build suffixes', () => {
    expect(isNewerVersion('1.1.0-beta.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0+build5', '1.0.0')).toBe(false);
  });
});
