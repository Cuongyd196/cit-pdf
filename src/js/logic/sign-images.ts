/**
 * Colour signatures and stamps for the Sign tool.
 *
 * PDF.js's own signature editor redraws an uploaded image as a one-colour
 * outline, and its image editor fails to save in this build. So a picture of
 * a signature or a company seal is placed here instead: shown over the PDF.js
 * page (draggable, resizable), then drawn into the PDF with pdf-lib on save,
 * colours and transparency intact.
 */
import { PDFDocument, degrees } from 'pdf-lib';

/** Where an image sits, as fractions of the page as displayed (top left). */
export interface SignImagePlacement {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  png: Uint8Array;
}

// Pixels at least this light count as paper; between SOFT and HARD they
// fade out, which keeps anti-aliased ink edges smooth.
const PAPER_HARD = 242;
const PAPER_SOFT = 200;

/**
 * Makes the near-white paper around a scanned signature or stamp
 * transparent, in place. Coloured ink (a red seal, blue pen) stays: only
 * pixels that are light in every channel fade.
 */
export function clearWhiteBackground(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const lightest = Math.min(data[i], data[i + 1], data[i + 2]);
    if (lightest >= PAPER_HARD) {
      data[i + 3] = 0;
    } else if (lightest > PAPER_SOFT) {
      const keep = (PAPER_HARD - lightest) / (PAPER_HARD - PAPER_SOFT);
      data[i + 3] = Math.round(data[i + 3] * keep);
    }
  }
}

/** The box around the pixels that are not transparent, or null if none. */
export function opaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Large photos are scaled down: a signature does not need more.
const MAX_SIDE = 1600;

export interface PreparedSignImage {
  png: Uint8Array;
  url: string;
  width: number;
  height: number;
}

/** Reads an image file into a PNG, optionally without its paper. */
export async function prepareSignImage(
  file: File,
  removeWhite: boolean
): Promise<PreparedSignImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is not available');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let output = canvas;
  if (removeWhite) {
    const pixels = context.getImageData(0, 0, width, height);
    clearWhiteBackground(pixels.data);
    const box = opaqueBounds(pixels.data, width, height);
    if (box) {
      context.putImageData(pixels, 0, 0);
      output = document.createElement('canvas');
      output.width = box.width;
      output.height = box.height;
      output
        .getContext('2d')
        ?.drawImage(
          canvas,
          box.x,
          box.y,
          box.width,
          box.height,
          0,
          0,
          box.width,
          box.height
        );
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    output.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('Could not encode the image');
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    url: URL.createObjectURL(blob),
    width: output.width,
    height: output.height,
  };
}

/**
 * A point on the displayed page (origin top left, y down, in PDF units of
 * the rotated page) in the page's own coordinates (origin bottom left).
 * `width`/`height` are the unrotated page size.
 */
export function displayToPdf(
  u: number,
  v: number,
  rotation: number,
  width: number,
  height: number
): { x: number; y: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: v, y: u };
    case 180:
      return { x: width - u, y: v };
    case 270:
      return { x: width - v, y: height - u };
    default:
      return { x: u, y: height - v };
  }
}

/** Draws the placed images into the PDF. */
export async function drawSignImages(
  pdfBytes: Uint8Array,
  placements: SignImagePlacement[]
): Promise<Uint8Array> {
  if (placements.length === 0) return pdfBytes;
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const images = new Map<
    Uint8Array,
    Awaited<ReturnType<PDFDocument['embedPng']>>
  >();
  for (const placement of placements) {
    const page = doc.getPage(placement.pageIndex);
    let image = images.get(placement.png);
    if (!image) {
      image = await doc.embedPng(placement.png);
      images.set(placement.png, image);
    }
    const box = page.getCropBox();
    const rotation = page.getRotation().angle;
    const sideways = ((rotation % 180) + 180) % 180 === 90;
    const shownWidth = sideways ? box.height : box.width;
    const shownHeight = sideways ? box.width : box.height;
    const u = placement.x * shownWidth;
    const v = (placement.y + placement.height) * shownHeight;
    // The image's bottom left corner, turned with the page so it reads
    // upright on screen.
    const anchor = displayToPdf(u, v, rotation, box.width, box.height);
    page.drawImage(image, {
      x: box.x + anchor.x,
      y: box.y + anchor.y,
      width: placement.width * shownWidth,
      height: placement.height * shownHeight,
      rotate: degrees(rotation),
    });
  }
  return doc.save();
}
