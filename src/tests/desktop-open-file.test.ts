import { describe, it, expect } from 'vitest';
import { VIEWER_SLUG, openFileAction } from '@/js/desktop/open-file';

describe('openFileAction', () => {
  it('loads the file in place when the viewer is already open', () => {
    expect(openFileAction(VIEWER_SLUG, true)).toBe('load');
  });

  it('navigates to the viewer from any other page', () => {
    expect(openFileAction('merge-pdf', true)).toBe('navigate');
    expect(openFileAction('index', true)).toBe('navigate');
    expect(openFileAction('', true)).toBe('navigate');
  });

  it('falls back to the tool picker when the viewer is unavailable', () => {
    expect(openFileAction('merge-pdf', false)).toBe('picker');
    expect(openFileAction(VIEWER_SLUG, false)).toBe('picker');
  });
});
