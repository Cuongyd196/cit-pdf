import { describe, it, expect } from 'vitest';
import {
  buildSpaceReference,
  restoreDroppedSpaces,
} from '../js/utils/restore-spaces';

const para = (texts: string[], offs: number[] = [0]) => ({
  runs: texts.map((text) => ({ text })),
  lines: offs.map((off) => ({ off })),
});

describe('restoreDroppedSpaces', () => {
  it('puts back a space the engine dropped between runs', () => {
    const ref = buildSpaceReference(
      '- Xây dựng được cơ sở dữ liệu website tin tức\n'
    );
    const p = para([
      '- Xây dựng được cơ sở d',
      'ữ',
      'li',
      'ệ',
      'u website tin tức',
    ]);
    restoreDroppedSpaces([p], ref);
    expect(p.runs.map((r) => r.text)).toEqual([
      '- Xây dựng được cơ sở d',
      'ữ',
      ' li',
      'ệ',
      'u website tin tức',
    ]);
  });

  it('shifts the offsets of later lines', () => {
    const ref = buildSpaceReference('dữ liệu một\nhai ba\n');
    const p = para(['dữliệu một\n', 'hai ba'], [0, 11]);
    restoreDroppedSpaces([p], ref);
    expect(p.runs[0].text).toBe('dữ liệu một\n');
    expect(p.lines.map((l) => l.off)).toEqual([0, 12]);
  });

  it('adds nothing at a wrapped line start', () => {
    const ref = buildSpaceReference('một hai ba bốn năm sáu bảy tám');
    const p = para(['một hai ba bốn nămsáu bảy tám'], [0, 18]);
    restoreDroppedSpaces([p], ref);
    expect(p.runs[0].text).toBe('một hai ba bốn nămsáu bảy tám');
  });

  it('stops at the first letter that reads differently', () => {
    const ref = buildSpaceReference('alpha beta gamma delta epsilon zeta');
    const p = para(['alpha beta gamma deltaXepsilonzeta']);
    restoreDroppedSpaces([p], ref);
    expect(p.runs[0].text).toBe('alpha beta gamma deltaXepsilonzeta');
  });

  it('leaves the model alone without a reference', () => {
    const p = para(['dữliệu']);
    restoreDroppedSpaces([p], null);
    expect(p.runs[0].text).toBe('dữliệu');
  });

  it('does not treat a line break in the reference as a space', () => {
    const ref = buildSpaceReference('website tin tức gồm\nngười dùng ở đây');
    const p = para(['website tin tức gồmngười dùng ở đây']);
    restoreDroppedSpaces([p], ref);
    expect(p.runs[0].text).toBe('website tin tức gồmngười dùng ở đây');
  });
});
