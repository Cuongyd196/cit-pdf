import { describe, it, expect } from 'vitest';
import { editorLocale, editorVietnamese } from '../js/config/editor-locale';

describe('editorLocale', () => {
  it('supplies Vietnamese, which the viewer does not ship', () => {
    const option = editorLocale('vi');
    expect(option?.defaultLocale).toBe('vi');
    expect(option && 'locales' in option && option.locales[0].code).toBe('vi');
  });

  it('points the languages the viewer ships at its own locales', () => {
    expect(editorLocale('de')).toEqual({ defaultLocale: 'de' });
    expect(editorLocale('zh')).toEqual({ defaultLocale: 'zh-CN' });
  });

  it('leaves the viewer alone for a language it does not know', () => {
    expect(editorLocale('ko')).toBeUndefined();
  });

  it('keeps every placeholder of the mode and count strings', () => {
    const t = editorVietnamese.translations;
    expect(t.mode.view).toBe('Xem');
    expect(t.search.resultsFound).toContain('{count}');
    expect(t.zoom.level).toContain('{level}');
    expect(t.print.total).toContain('{totalPages}');
  });
});
