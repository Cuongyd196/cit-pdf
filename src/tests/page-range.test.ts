import { describe, it, expect } from 'vitest';
import {
  formatPageRanges,
  normalizeRange,
  parseRangePages,
  parseRangeParts,
} from '../js/utils/page-range';

describe('page ranges', () => {
  it('reads pages, ranges and lists', () => {
    expect(parseRangePages('5', 10)).toEqual([5]);
    expect(parseRangePages('1-3, 5, 8-9', 10)).toEqual([1, 2, 3, 5, 8, 9]);
    expect(parseRangePages('3,1,3', 10)).toEqual([1, 3]);
    expect(parseRangePages('', 10)).toEqual([]);
  });

  it('understands end, odd and even, in English and Vietnamese', () => {
    expect(parseRangePages('8-end', 10)).toEqual([8, 9, 10]);
    expect(parseRangePages('8-cuối', 10)).toEqual([8, 9, 10]);
    expect(parseRangePages('cuối', 10)).toEqual([10]);
    expect(parseRangePages('lẻ', 5)).toEqual([1, 3, 5]);
    expect(parseRangePages('even', 5)).toEqual([2, 4]);
  });

  it('takes long dashes, semicolons and spaces', () => {
    expect(normalizeRange(' 1 – 2 ; 4 ')).toBe('1-2,4');
    expect(parseRangePages('1–2; 4', 5)).toEqual([1, 2, 4]);
  });

  it('refuses what is not a range of this document', () => {
    expect(parseRangePages('11', 10)).toBeNull();
    expect(parseRangePages('3-1', 10)).toBeNull();
    expect(parseRangePages('0', 10)).toBeNull();
    expect(parseRangePages('abc', 10)).toBeNull();
  });

  it('keeps each part apart for splitting', () => {
    expect(parseRangeParts('1-3, 4-end', 6)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(parseRangeParts('1-3, 9', 6)).toBeNull();
  });

  it('writes pages back as short ranges', () => {
    expect(formatPageRanges([2, 4, 5, 6])).toBe('2, 4-6');
    expect(formatPageRanges([6, 5, 4, 2, 2])).toBe('2, 4-6');
    expect(formatPageRanges([])).toBe('');
  });
});
