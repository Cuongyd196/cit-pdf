import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';
import {
  clearWhiteBackground,
  displayToPdf,
  drawSignImages,
  opaqueBounds,
} from '@/js/logic/sign-images';

const pixel = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

// A 2x1 PNG: one red pixel, one transparent, built here so the test needs
// no image file.
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array([...Buffer.from(type, 'ascii'), ...data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  out.set(body, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(2, 0);
header.writeUInt32BE(1, 4);
header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
const RED_PNG = new Uint8Array([
  ...Buffer.from('89504e470d0a1a0a', 'hex'),
  ...chunk('IHDR', header),
  ...chunk(
    'IDAT',
    deflateSync(Buffer.from([0, 208, 2, 27, 255, 255, 255, 255, 0]))
  ),
  ...chunk('IEND', new Uint8Array()),
]);

describe('clearWhiteBackground', () => {
  it('makes paper transparent and keeps coloured ink', () => {
    const data = new Uint8ClampedArray([
      ...pixel(255, 255, 255), // paper
      ...pixel(208, 2, 27), // red seal
      ...pixel(30, 60, 200), // blue pen
      ...pixel(250, 248, 245), // off-white paper
    ]);
    clearWhiteBackground(data);
    expect([data[3], data[7], data[11], data[15]]).toEqual([0, 255, 255, 0]);
  });

  it('fades light grey edges instead of cutting them', () => {
    const data = new Uint8ClampedArray(pixel(221, 221, 221));
    clearWhiteBackground(data);
    expect(data[3]).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(255);
  });
});

describe('opaqueBounds', () => {
  it('finds the box around what is left', () => {
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    data[(1 * width + 2) * 4 + 3] = 255;
    data[(2 * width + 1) * 4 + 3] = 255;
    expect(opaqueBounds(data, width, height)).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    });
  });

  it('is null for an empty image', () => {
    expect(opaqueBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe('displayToPdf', () => {
  // A 600 x 800 page; corners of the displayed page map onto its corners.
  it.each([
    [0, 0, 0, { x: 0, y: 800 }],
    [90, 0, 600, { x: 600, y: 0 }],
    [180, 0, 0, { x: 600, y: 0 }],
    [270, 0, 0, { x: 600, y: 800 }],
  ])('rotation %i', (rotation, u, v, expected) => {
    expect(displayToPdf(u, v, rotation, 600, 800)).toEqual(expected);
  });
});

async function placedImage(rotation: number) {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]).setRotation(degrees(rotation));
  const out = await drawSignImages(await doc.save(), [
    { pageIndex: 0, x: 0.1, y: 0.2, width: 0.25, height: 0.1, png: RED_PNG },
  ]);
  const saved = await PDFDocument.load(out);
  const images = [...saved.context.enumerateIndirectObjects()]
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream &&
        String(obj.dict.get(PDFName.of('Subtype'))) === '/Image'
    );
  return { images, saved };
}

describe('drawSignImages', () => {
  it('embeds the picture in colour, with its transparency', async () => {
    const { images } = await placedImage(0);
    const picture = images.find((image) => image.dict.get(PDFName.of('SMask')));
    expect(picture).toBeDefined();
    expect(String(picture!.dict.get(PDFName.of('ColorSpace')))).toBe(
      '/DeviceRGB'
    );
  });

  it.each([0, 90, 180, 270])(
    'draws on a page turned %i degrees',
    async (rotation) => {
      const { saved } = await placedImage(rotation);
      expect(saved.getPage(0).getRotation().angle).toBe(rotation);
    }
  );

  it('returns the file untouched when nothing was placed', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await drawSignImages(bytes, [])).toBe(bytes);
  });
});
