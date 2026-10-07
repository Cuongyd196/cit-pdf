import { describe, it, expect, vi } from 'vitest';

vi.mock('heic2any', () => ({
  default: vi.fn(),
}));

import { partitionIncomingFiles } from '../js/utils/multi-tool-file-input';

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('partitionIncomingFiles', () => {
  it('routes PDFs by MIME type', () => {
    const result = partitionIncomingFiles([
      makeFile('a.pdf', 'application/pdf'),
      makeFile('b.pdf', 'application/pdf'),
    ]);
    expect(result.pdfFiles).toHaveLength(2);
    expect(result.imageFiles).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('routes PDFs by extension when MIME is missing', () => {
    const result = partitionIncomingFiles([makeFile('doc.pdf', '')]);
    expect(result.pdfFiles).toHaveLength(1);
    expect(result.imageFiles).toHaveLength(0);
  });

  it('routes PDFs with uppercase extension', () => {
    const result = partitionIncomingFiles([makeFile('SCAN.PDF', '')]);
    expect(result.pdfFiles).toHaveLength(1);
  });

  it('routes images by MIME type', () => {
    const result = partitionIncomingFiles([
      makeFile('a.png', 'image/png'),
      makeFile('b.jpg', 'image/jpeg'),
      makeFile('c.webp', 'image/webp'),
    ]);
    expect(result.imageFiles).toHaveLength(3);
    expect(result.pdfFiles).toHaveLength(0);
  });

  it('routes images by extension when MIME is missing (HEIC, BMP, TIFF)', () => {
    const result = partitionIncomingFiles([
      makeFile('photo.heic', ''),
      makeFile('scan.bmp', ''),
      makeFile('page.tiff', ''),
    ]);
    expect(result.imageFiles).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  it('splits a mixed batch into PDFs, images, and skipped', () => {
    const result = partitionIncomingFiles([
      makeFile('doc.pdf', 'application/pdf'),
      makeFile('photo.png', 'image/png'),
      makeFile('readme.txt', 'text/plain'),
      makeFile('archive.zip', 'application/zip'),
    ]);
    expect(result.pdfFiles).toHaveLength(1);
    expect(result.imageFiles).toHaveLength(1);
    expect(result.skipped).toEqual(['readme.txt', 'archive.zip']);
  });

  it('preserves original File order within each bucket', () => {
    const a = makeFile('a.pdf', 'application/pdf');
    const b = makeFile('b.png', 'image/png');
    const c = makeFile('c.pdf', 'application/pdf');
    const d = makeFile('d.jpg', 'image/jpeg');

    const result = partitionIncomingFiles([a, b, c, d]);
    expect(result.pdfFiles).toEqual([a, c]);
    expect(result.imageFiles).toEqual([b, d]);
  });

  it('returns empty buckets for empty input', () => {
    const result = partitionIncomingFiles([]);
    expect(result.pdfFiles).toHaveLength(0);
    expect(result.imageFiles).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips files with neither matching MIME nor extension', () => {
    const result = partitionIncomingFiles([
      makeFile('script.js', 'application/javascript'),
      makeFile('data.csv', 'text/csv'),
    ]);
    expect(result.skipped).toHaveLength(2);
    expect(result.pdfFiles).toHaveLength(0);
    expect(result.imageFiles).toHaveLength(0);
  });
});
