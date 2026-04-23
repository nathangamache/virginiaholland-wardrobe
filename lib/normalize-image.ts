/**
 * Normalize any user-uploaded image into a standard JPEG Blob.
 *
 * Modern browsers can decode a much wider range of formats than Node can:
 *   - HEIC / HEIF (iPhone native)
 *   - AVIF (newer Android, modern web)
 *   - TIFF (scanners, some pro cameras)
 *   - Plus all the usual: JPEG, PNG, WebP, GIF, BMP
 *
 * This helper uses createImageBitmap + canvas to decode whatever came in
 * and re-encode as JPEG at high quality. The JPEG is then safe to pass
 * to our server-side Jimp pipeline AND to the Anthropic API (which only
 * accepts jpeg/png/gif/webp).
 *
 * Usage:
 *   const jpg = await normalizeToJpeg(userFile);
 *   // now safe to use anywhere as a File
 *
 * Falls back to passing the file through unchanged if the browser doesn't
 * implement the necessary APIs (rare in 2026, but graceful degradation).
 */

export interface NormalizeOpts {
  /** JPEG quality, 0-1. Default 0.92 */
  quality?: number;
  /** Max dimension on longest edge. Default 2400 (Claude's recommended max) */
  maxDimension?: number;
}

export async function normalizeToJpeg(
  input: File | Blob,
  opts: NormalizeOpts = {}
): Promise<File> {
  const quality = opts.quality ?? 0.92;
  const maxDim = opts.maxDimension ?? 2400;

  // Fast path: already a JPEG under the size limit — skip re-encoding
  if (input.type === 'image/jpeg') {
    const dims = await peekDimensions(input);
    if (dims && dims.width <= maxDim && dims.height <= maxDim) {
      // Return as-is but wrapped in a File for consistent caller interface
      return asFile(input, 'image.jpg');
    }
  }

  // General path: decode to ImageBitmap (browser handles HEIC/AVIF/etc),
  // draw onto a canvas, export as JPEG
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input, {
      imageOrientation: 'from-image', // respect EXIF rotation
    });
  } catch (e) {
    // Browser couldn't decode. Return original and let later steps fail loudly
    // rather than silently producing a broken file.
    console.warn('normalizeToJpeg: createImageBitmap failed, passing through', e);
    return asFile(input, input instanceof File ? input.name : 'image');
  }

  try {
    const { width: srcW, height: srcH } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const outW = Math.round(srcW * scale);
    const outH = Math.round(srcH * scale);

    // OffscreenCanvas is widely supported; fall back to DOM canvas if not
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(outW, outH);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
    }

    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('no 2d context');

    // Flatten any transparency onto a light background (HEIC can have alpha,
    // AVIF definitely can). JPEG doesn't support alpha, so transparent pixels
    // would otherwise come out black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(bitmap, 0, 0, outW, outH);

    let blob: Blob;
    if (canvas instanceof OffscreenCanvas) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
          'image/jpeg',
          quality
        );
      });
    }

    return asFile(blob, originalNameAsJpg(input));
  } finally {
    bitmap.close?.();
  }
}

function asFile(blob: Blob, name: string): File {
  if (blob instanceof File && blob.type === 'image/jpeg') return blob;
  return new File([blob], name, { type: 'image/jpeg' });
}

function originalNameAsJpg(input: File | Blob): string {
  if (input instanceof File) {
    const base = input.name.replace(/\.[^.]+$/, '');
    return `${base || 'image'}.jpg`;
  }
  return 'image.jpg';
}

async function peekDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bm = await createImageBitmap(blob);
    const { width, height } = bm;
    bm.close?.();
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Preferred accept attribute for <input type="file"> — tells the OS file
 * picker to show all image-like files including iPhone HEIC and AVIF.
 */
export const ACCEPT_IMAGES =
  'image/*,.heic,.heif,.avif,.tiff,.tif';
