import { describe, it, expect } from 'vitest';
import { parsePageRanges } from '@/js/desktop/print-ranges';

describe('parsePageRanges', () => {
  it('reads single pages and ranges', () => {
    expect(parsePageRanges('1-3, 5', 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageRanges('7', 10)).toEqual([7]);
  });

  it('accepts spaces, semicolons and reversed ranges', () => {
    expect(parsePageRanges(' 2 ; 4 - 6 ', 10)).toEqual([2, 4, 5, 6]);
    expect(parsePageRanges('5-3', 10)).toEqual([3, 4, 5]);
  });

  it('sorts and removes duplicates', () => {
    expect(parsePageRanges('5, 1-2, 2, 1', 10)).toEqual([1, 2, 5]);
  });

  it('rejects empty input', () => {
    expect(parsePageRanges('', 10)).toBeNull();
    expect(parsePageRanges(' , ', 10)).toBeNull();
  });

  it('rejects pages outside the document', () => {
    expect(parsePageRanges('0', 10)).toBeNull();
    expect(parsePageRanges('11', 10)).toBeNull();
    expect(parsePageRanges('8-12', 10)).toBeNull();
  });

  it('rejects anything that is not a page list', () => {
    expect(parsePageRanges('abc', 10)).toBeNull();
    expect(parsePageRanges('1-2-3', 10)).toBeNull();
    expect(parsePageRanges('1.5', 10)).toBeNull();
    expect(parsePageRanges('-3', 10)).toBeNull();
  });
});
