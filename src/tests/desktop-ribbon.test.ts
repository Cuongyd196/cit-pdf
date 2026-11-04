import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRibbon } from '../js/desktop/studio/ribbon';

const tool = (slug: string, name: string) => ({
  slug,
  href: `/${slug}.html`,
  name,
  subtitle: '',
  icon: 'ph-file',
});

function makeRibbon() {
  const host = document.getElementById('viewer-actions')!;
  return createRibbon({
    host,
    tool: () => undefined,
    groups: [
      {
        name: 'Group',
        tools: [tool('merge-pdf', 'Merge PDF'), tool('ocr-pdf', 'OCR PDF')],
      },
    ],
    beforeLeaving: () => {},
    goToPage: () => {},
    showViewerToolbar: () => {},
  });
}

const items = () => document.querySelectorAll('.ribbon-all-item');

describe('viewer ribbon: All tools', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div id="viewer-actions"></div>
      <div id="pdf-viewer-container"></div>`;
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('lists the tools when it is the remembered tab', () => {
    localStorage.setItem('cit:ribbon-tab', 'all');
    makeRibbon();
    expect(document.querySelector('.ribbon-all')!.classList).not.toContain(
      'hidden'
    );
    expect(items()).toHaveLength(2);
  });

  it('lists the tools when the tab is chosen', () => {
    makeRibbon();
    expect(items()).toHaveLength(0);
    document.querySelector<HTMLElement>('[data-tab="all"]')!.click();
    expect(items()).toHaveLength(2);
  });
});
