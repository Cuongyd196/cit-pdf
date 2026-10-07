import { describe, it, expect, beforeEach } from 'vitest';
import { setPhrases, translatePhrase, translateTree } from '@/js/i18n/phrases';

describe('phrase translation', () => {
  beforeEach(() => {
    setPhrases({
      'File Mode': 'Chế độ tệp',
      'Leave blank for all pages': 'Để trống để lấy tất cả các trang',
      'Loading page {0}...': 'Đang tải trang {0}...',
      'Page {0} of {1}': 'Trang {0} / {1}',
      'Total: {0}': 'Tổng: {0}',
      'Added {0} blank page{1} successfully!':
        'Đã thêm {0} trang trống thành công!',
      'Deskewed {0} file(s). {1}': 'Đã chỉnh nghiêng {0} tệp. {1}',
      'Downloads started for all files.':
        'Đã bắt đầu tải xuống tất cả các tệp.',
    });
  });

  it('translates an exact phrase', () => {
    expect(translatePhrase('File Mode')).toBe('Chế độ tệp');
  });

  it('ignores differences in surrounding and inner whitespace', () => {
    expect(translatePhrase('\n   File   Mode \n')).toBe('\n   Chế độ tệp \n');
  });

  it('fills placeholders from the source text', () => {
    expect(translatePhrase('Loading page 12...')).toBe('Đang tải trang 12...');
    expect(translatePhrase('Page 3 of 10')).toBe('Trang 3 / 10');
  });

  it('accepts an empty value, such as a missing plural ending', () => {
    expect(translatePhrase('Added 1 blank page successfully!')).toBe(
      'Đã thêm 1 trang trống thành công!'
    );
    expect(translatePhrase('Added 2 blank pages successfully!')).toBe(
      'Đã thêm 2 trang trống thành công!'
    );
  });

  it('translates a value that is itself a known phrase', () => {
    expect(
      translatePhrase('Deskewed 2 file(s). Downloads started for all files.')
    ).toBe('Đã chỉnh nghiêng 2 tệp. Đã bắt đầu tải xuống tất cả các tệp.');
  });

  it('returns null for text it does not know', () => {
    expect(translatePhrase('report-final.pdf')).toBeNull();
    expect(translatePhrase('Chế độ tệp')).toBeNull();
    expect(translatePhrase('   ')).toBeNull();
  });

  it('does not let a placeholder swallow unrelated text', () => {
    expect(translatePhrase('Total: 4 and then something else')).toBe(
      'Tổng: 4 and then something else'
    );
    expect(translatePhrase('Subtotal: 4')).toBeNull();
  });

  it('translates text nodes and attributes in a tree', () => {
    document.body.innerHTML = `
      <div id="root">
        <button title="File Mode">File Mode</button>
        <input placeholder="Leave blank for all pages" />
        <p>Pages - <span>Total: 7</span></p>
      </div>`;
    translateTree(document.getElementById('root')!);
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('Chế độ tệp');
    expect(button.title).toBe('Chế độ tệp');
    expect(document.querySelector('input')!.placeholder).toBe(
      'Để trống để lấy tất cả các trang'
    );
    expect(document.querySelector('span')!.textContent).toBe('Tổng: 7');
  });

  it('leaves user-editable and code content alone', () => {
    document.body.innerHTML = `
      <div id="root">
        <textarea>File Mode</textarea>
        <div contenteditable="true">File Mode</div>
        <code>File Mode</code>
        <p data-no-translate>File Mode</p>
      </div>`;
    translateTree(document.getElementById('root')!);
    expect(document.querySelector('textarea')!.textContent).toBe('File Mode');
    expect(document.querySelector('[contenteditable]')!.textContent).toBe(
      'File Mode'
    );
    expect(document.querySelector('code')!.textContent).toBe('File Mode');
    expect(document.querySelector('p')!.textContent).toBe('File Mode');
  });
});
