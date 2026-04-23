// Pure-JS image processing. Swapped in from sharp because sharp's native
// libvips binaries require CPU extensions (AVX2/SSE4.2) that older CPUs lack.
// Jimp is slower but runs anywhere Node runs.
//
// If you later move to a modern CPU, you can reintroduce sharp for ~10x faster
// resizing; all callers use only the two exported functions below.

import Jimp from 'jimp';

export interface ProcessedImage {
  buffer: Buffer;
  ext: 'jpg' | 'png';
}

/**
 * Resize to fit within maxW x maxH, preserve aspect ratio, never upscale.
 * EXIF orientation is applied automatically by jimp on read.
 * Always outputs JPEG (for originals, thumbs, wear photos).
 */
export async function processJpeg(
  input: Buffer,
  opts: {
    maxW: number;
    maxH: number;
    quality?: number;
    // If set, image is composited onto this bg color first (flattens transparency).
    flattenBg?: { r: number; g: number; b: number };
    // If true, image is centered onto a canvas of exactly maxW x maxH filled with flattenBg.
    square?: boolean;
  }
): Promise<ProcessedImage> {
  const img = await Jimp.read(input);

  const quality = opts.quality ?? 85;
  const flattenBg = opts.flattenBg;

  // Flatten onto background if requested (needed when source has transparency)
  if (flattenBg) {
    const bgHex = (0xff000000 | (flattenBg.r << 16) | (flattenBg.g << 8) | flattenBg.b) >>> 0;
    img.background(bgHex);
  }

  // Resize preserving aspect ratio, no upscale
  if (img.bitmap.width > opts.maxW || img.bitmap.height > opts.maxH) {
    img.scaleToFit(opts.maxW, opts.maxH);
  }

  if (opts.square) {
    const bgHex = flattenBg
      ? ((0xff000000 | (flattenBg.r << 16) | (flattenBg.g << 8) | flattenBg.b) >>> 0)
      : 0xfdfbf7ff;
    const canvas = new Jimp(opts.maxW, opts.maxH, bgHex);
    canvas.composite(img, (opts.maxW - img.bitmap.width) / 2, (opts.maxH - img.bitmap.height) / 2);
    canvas.quality(quality);
    const buffer = await canvas.getBufferAsync(Jimp.MIME_JPEG);
    return { buffer, ext: 'jpg' };
  }

  img.quality(quality);
  const buffer = await img.getBufferAsync(Jimp.MIME_JPEG);
  return { buffer, ext: 'jpg' };
}

/**
 * Resize a PNG while preserving its transparency. Used for the
 * background-removed version of a wardrobe item.
 */
export async function processPng(
  input: Buffer,
  opts: { maxW: number; maxH: number }
): Promise<ProcessedImage> {
  const img = await Jimp.read(input);
  if (img.bitmap.width > opts.maxW || img.bitmap.height > opts.maxH) {
    img.scaleToFit(opts.maxW, opts.maxH);
  }
  const buffer = await img.getBufferAsync(Jimp.MIME_PNG);
  return { buffer, ext: 'png' };
}
