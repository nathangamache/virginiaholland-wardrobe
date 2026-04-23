/**
 * Background removal utilities (browser-only).
 *
 * Strategy to minimize edge halos / artifacts:
 *
 *   1. Pre-crop tight to the subject using content-aware bounds. The ML model
 *      performs measurably better when the subject fills more of the frame;
 *      wide shots with lots of background give it less pixel signal.
 *
 *   2. Use the "isnet" (large) model for best edge quality. Trade-off is a
 *      one-time ~80MB download per browser (cached permanently after).
 *
 *   3. Post-process the alpha channel to clean up the semi-transparent
 *      halo that causes dark fringing. We erode the alpha mask by ~1.5px
 *      (any pixel with alpha below a threshold becomes fully transparent,
 *      any pixel bordering a transparent one has its alpha reduced).
 *      This trims the fringe without eating into the subject.
 */

type ProgressCb = (phase: string, current: number, total: number) => void;

export interface BgRemovalOpts {
  onProgress?: ProgressCb;
  /** Skip the pre-crop step if the caller already has a tight photo */
  skipCrop?: boolean;
  /** Disable alpha edge cleanup (for testing) */
  skipEdgeCleanup?: boolean;
}

/**
 * Remove background from a source image, returning a clean PNG Blob.
 */
export async function removeBackgroundClean(
  input: Blob,
  opts: BgRemovalOpts = {}
): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal');

  // Step 1: pre-crop to reduce background noise
  const cropped = opts.skipCrop
    ? input
    : await autoCropSubject(input, opts.onProgress);

  opts.onProgress?.('removing background', 0, 100);

  // Step 2: run the large model with high output quality
  const raw = await removeBackground(cropped, {
    model: 'isnet', // Large model, best edges. Options: isnet | isnet_fp16 | isnet_quint8
    output: {
      format: 'image/png',
      quality: 1,
    },
    progress: (key: string, current: number, total: number) => {
      opts.onProgress?.(key, current, total);
    },
  });

  opts.onProgress?.('removing background', 100, 100);

  // Step 3: post-process alpha to trim halo pixels
  if (opts.skipEdgeCleanup) return raw;
  return cleanupAlphaEdges(raw);
}

// ---------------------------------------------------------------------------
// Pre-crop: find the smallest bounding box that contains the "interesting"
// pixels. For photos of clothing against a near-uniform background, we detect
// bounds by looking for edges and variance from the border color.
// ---------------------------------------------------------------------------

async function autoCropSubject(blob: Blob, onProgress?: ProgressCb): Promise<Blob> {
  onProgress?.('cropping to subject', 0, 100);

  const bitmap = await blobToBitmap(blob);
  const { width: w, height: h } = bitmap;

  // Draw to canvas for pixel access
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  // Sample the border to estimate background color. Median of border pixels.
  const bgColor = sampleBorderMedian(data, w, h);

  // A pixel is "subject" if it differs from the estimated bg by more than the
  // threshold. Using a Euclidean distance in RGB, threshold of ~35 balances
  // signal vs noise on typical phone photos.
  const threshold = 35;
  const thresholdSq = threshold * threshold;

  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0,
    anyHit = false;

  // Walk every 2nd pixel to save time; full accuracy isn't needed for bounds
  const step = 2;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const dr = data[i] - bgColor.r;
      const dg = data[i + 1] - bgColor.g;
      const db = data[i + 2] - bgColor.b;
      const distSq = dr * dr + dg * dg + db * db;
      if (distSq > thresholdSq) {
        anyHit = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If we didn't find a subject, bail and return original
  if (!anyHit) {
    return blob;
  }

  // Add a small margin so we don't crop into the subject's own anti-aliasing
  const margin = Math.round(Math.min(w, h) * 0.04);
  const cropX = Math.max(0, minX - margin);
  const cropY = Math.max(0, minY - margin);
  const cropW = Math.min(w - cropX, maxX - minX + margin * 2);
  const cropH = Math.min(h - cropY, maxY - minY + margin * 2);

  // If the crop isn't meaningfully smaller (under 10% reduction on both axes),
  // skip it — this photo already has a tight subject.
  const reductionX = 1 - cropW / w;
  const reductionY = 1 - cropH / h;
  if (reductionX < 0.1 && reductionY < 0.1) {
    return blob;
  }

  // Produce the cropped JPEG
  const outCanvas = new OffscreenCanvas(cropW, cropH);
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return outCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}

function sampleBorderMedian(
  data: Uint8ClampedArray,
  w: number,
  h: number
): { r: number; g: number; b: number } {
  // Sample ~200 pixels around the four edges
  const samples: number[][] = [];
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  const pushEdge = (nn: number, horizontal: boolean, pos: number) => {
    const stepInner = Math.max(1, Math.floor((horizontal ? w : h) / nn));
    for (let i = 0; i < (horizontal ? w : h); i += stepInner) {
      horizontal ? sample(i, pos) : sample(pos, i);
    }
  };
  pushEdge(50, true, 0);
  pushEdge(50, true, h - 1);
  pushEdge(50, false, 0);
  pushEdge(50, false, w - 1);

  const rs = samples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = samples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = samples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = samples.length >> 1;
  return { r: rs[mid], g: gs[mid], b: bs[mid] };
}

// ---------------------------------------------------------------------------
// Post-process: the model outputs semi-transparent halo pixels around the
// subject that look like dark fringing when composited. We trim them by:
//   a) clamping low alpha values to zero (anything under 25 → fully transparent)
//   b) eroding edges once (pixels bordering transparent pixels get their alpha
//      reduced, creating a cleaner silhouette)
// ---------------------------------------------------------------------------

async function cleanupAlphaEdges(bgRemovedBlob: Blob): Promise<Blob> {
  const bitmap = await blobToBitmap(bgRemovedBlob);
  const { width: w, height: h } = bitmap;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  // Pass 1: clamp low-alpha halo pixels to fully transparent
  const HALO_CUTOFF = 28;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < HALO_CUTOFF) data[i] = 0;
  }

  // Pass 2: single-step erosion of the alpha mask. For each pixel bordering
  // a fully-transparent pixel, reduce its alpha. This trims the fringe ~1px.
  const original = new Uint8Array(data.length);
  original.set(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4 + 3;
      if (original[i] === 0 || original[i] === 255) continue;
      // Check 4-neighbors
      const up = original[i - w * 4];
      const down = original[i + w * 4];
      const left = original[i - 4];
      const right = original[i + 4];
      if (up === 0 || down === 0 || left === 0 || right === 0) {
        // This pixel touches transparency; fade it
        data[i] = Math.max(0, original[i] - 80);
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

// ---------------------------------------------------------------------------

async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  // createImageBitmap handles EXIF orientation automatically in modern browsers
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}
