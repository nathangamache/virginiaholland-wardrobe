/**
 * Server-side image processing powered by sharp (libvips).
 *
 * Sharp is ~10x faster than jimp for typical operations and supports every
 * consumer format sharp was compiled with — on our install that includes
 * JPEG, PNG, WebP, HEIC/HEIF, GIF, TIFF, SVG.
 *
 * The API shape intentionally matches the previous jimp-based module so
 * existing callers work unchanged: processJpeg(buffer, opts) returns
 * { buffer, width, height }.
 */

import sharp from 'sharp';

// Tune libvips for throughput. Each sharp operation already pipelines natively;
// we just ensure we don't over-commit threads when running many in parallel.
sharp.concurrency(1);
sharp.cache({ memory: 100, items: 50 }); // MB, items

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ProcessJpegOpts {
  /** Max width in pixels. The image is resized if larger. */
  maxW?: number;
  /** Max height in pixels. */
  maxH?: number;
  /** JPEG quality 1-100. Default 85. */
  quality?: number;
  /** Crop to a perfect square. */
  square?: boolean;
  /** Background color to flatten transparent pixels onto (RGB). */
  flattenBg?: { r: number; g: number; b: number };
}

/**
 * Decode any supported format → processed JPEG.
 *
 * Handles EXIF orientation (auto-rotates), strips all other metadata, and
 * flattens transparency onto a neutral background (JPEG doesn't support alpha).
 */
export async function processJpeg(
  input: Buffer,
  opts: ProcessJpegOpts = {}
): Promise<ProcessedImage> {
  const maxW = opts.maxW ?? 2000;
  const maxH = opts.maxH ?? 2000;
  const quality = opts.quality ?? 85;
  const bg = opts.flattenBg ?? { r: 253, g: 251, b: 247 }; // app's warm cream

  let pipe = sharp(input, { failOn: 'error' })
    .rotate(); // respect EXIF orientation

  if (opts.square) {
    // Crop to center square, then resize. Using extract-then-resize avoids
    // sharp's default "cover" fit mangling aspect ratios unexpectedly.
    pipe = pipe.resize({
      width: maxW,
      height: maxH,
      fit: 'cover',
      position: 'center',
    });
  } else {
    pipe = pipe.resize({
      width: maxW,
      height: maxH,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  pipe = pipe
    .flatten({ background: bg })
    .jpeg({ quality, progressive: true, mozjpeg: true });

  const { data, info } = await pipe.toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

export interface ProcessPngOpts {
  maxW?: number;
  maxH?: number;
  /** PNG compression 0-9. Default 9 (max compression, reasonable CPU). */
  compressionLevel?: number;
}

/**
 * Decode → PNG. Preserves alpha channel (used for bg-removed images).
 */
export async function processPng(
  input: Buffer,
  opts: ProcessPngOpts = {}
): Promise<ProcessedImage> {
  const maxW = opts.maxW ?? 1600;
  const maxH = opts.maxH ?? 1600;
  const compressionLevel = opts.compressionLevel ?? 9;

  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({
      width: maxW,
      height: maxH,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height };
}

/**
 * Probe an input buffer without decoding fully — returns dimensions and
 * detected format. Useful for quick checks before the expensive operations.
 */
export async function probeImage(input: Buffer): Promise<{
  width: number;
  height: number;
  format: string | undefined;
  hasAlpha: boolean;
}> {
  const meta = await sharp(input).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format,
    hasAlpha: meta.hasAlpha ?? false,
  };
}
