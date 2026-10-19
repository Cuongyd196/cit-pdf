import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { splitUnderLimit } from '../js/utils/compress-to-target';

// Text that does not compress, so each page really weighs `bulk` bytes.
let seed = 7;
function noise(length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    text += String.fromCharCode(33 + (seed % 90));
  }
  return text;
}

/** Pages told apart by width (100, 101, …), each carrying some bulk. */
async function makePdf(pages: number, bulk = 4000): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([100 + i, 200]);
    page.drawText(noise(bulk), { x: 0, y: 0, size: 1 });
  }
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

describe('splitUnderLimit', () => {
  it('cuts into parts that each fit, keeping every page in order', async () => {
    const bytes = await makePdf(12);
    const limit = Math.ceil(bytes.length / 3);
    const parts = await splitUnderLimit(bytes, limit);
    expect(parts).not.toBeNull();
    expect(parts!.length).toBeGreaterThan(1);
    for (const part of parts!) expect(part.length).toBeLessThanOrEqual(limit);
    const all = (await Promise.all(parts!.map(widths))).flat();
    expect(all).toEqual(Array.from({ length: 12 }, (_, i) => 100 + i));
  });

  it('uses as few parts as a greedy cut allows', async () => {
    const bytes = await makePdf(10);
    const limit = Math.ceil(bytes.length * 0.6);
    const parts = await splitUnderLimit(bytes, limit);
    expect(parts!.length).toBe(2);
  });

  it('gives up when one page alone is larger than the limit', async () => {
    const bytes = await makePdf(3, 20000);
    expect(await splitUnderLimit(bytes, 5000)).toBeNull();
  });
});
