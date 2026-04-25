/**
 * Server-side background removal using ISNet General Use via onnxruntime-node.
 *
 * Model: ISNet General Use (rembg's standard distribution).
 * Cached at: ~/.cache/wardrobe/models/isnet-general-use.onnx
 *
 * Pipeline:
 *   1. Decode source, apply EXIF rotation, downscale to working size
 *   2. Build ImageNet-normalized 1024x1024 RGB tensor for ISNet
 *   3. Acquire a session from the pool, run inference, return session
 *   4. Pick output[0] (rembg's convention — final refined mask)
 *   5. Hand-rolled bilinear resize back to source dimensions
 *   6. Stitch the alpha onto the original RGB
 *   7. Optional: clean up halo pixels, tight-crop to subject
 *
 * IMPORTANT: ONNX Runtime sessions are NOT thread-safe to call concurrently.
 * We maintain a session pool (one per concurrency slot) and gate with a mutex.
 */

import 'server-only';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import fs from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_URL =
  'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const MODEL_FILENAME = 'isnet-general-use.onnx';

const MODEL_CACHE_DIR =
  process.env.MODEL_CACHE_DIR ?? path.join(os.homedir(), '.cache', 'wardrobe', 'models');
const MODEL_PATH = path.join(MODEL_CACHE_DIR, MODEL_FILENAME);

const MODEL_INPUT_SIZE = 1024;

// ImageNet mean/std normalization. ISNet was trained with this transform.
// ISNet General Use preprocessing — copied EXACTLY from rembg's DisSession
// (rembg/sessions/dis.py). The model expects:
//   1. Resize to 1024x1024 (Lanczos)
//   2. Divide all pixels by the IMAGE'S MAX VALUE (not 255 — see note below)
//   3. Subtract per-channel mean, divide by per-channel std
//
// For ISNet General Use specifically:
//   mean = (0.5, 0.5, 0.5)
//   std  = (1.0, 1.0, 1.0)
//
// So the effective transform is: (pixel / image_max) - 0.5
//
// Note: rembg divides by `np.max(im_ary)` rather than 255. For most photos
// this is essentially the same (any near-white pixel makes max≈255), but
// for all-dark photos this matters. We replicate it precisely to avoid
// subtle output differences vs rembg's reference implementation.
const ISNET_MEAN = [0.5, 0.5, 0.5];
const ISNET_STD = [1.0, 1.0, 1.0];

// Working size for the source image. We don't actually need huge resolutions
// for closet photos — 1600px on the long edge is plenty for a clean cutout
// at thumb/grid sizes. This matches the final stored size from processPng,
// so the downstream resize in items/process is a no-op.
const WORKING_DIMENSION = 1600;

// How many parallel ONNX sessions to maintain. Each session uses ~200MB RAM
// after warmup. With 4 sessions × 4 intra-op threads = 16 threads, matches
// our 8 cores / 16 hardware threads. Tunable via env.
const SESSION_POOL_SIZE = parseInt(
  process.env.BG_REMOVAL_SESSION_POOL ?? '4',
  10
);

// Test-Time Augmentation: run the model 4 times across symmetry transforms
// (original, horizontal flip, vertical flip, both flips) then combine the
// resulting masks with element-wise MAX. Catches asymmetric and edge-bias
// failures common with ISNet on dark colors near image edges. Combining
// with MAX (rather than average) means we keep confident pixels from
// whichever pass got them right — ideal when the failure mode is "pass A
// missed a real foreground region that pass B caught."
//
// Cost: 4× inference time per image. Earlier benchmarks were ~3-8s for
// inference, so each upload now takes ~12-32s. With 4-session pool and
// non-blocking client UX, this is fine — batch throughput unchanged.
//
// Set BG_REMOVAL_TTA=0 to disable (single-pass mode, ~4x faster).
const USE_TTA = (process.env.BG_REMOVAL_TTA ?? '1') !== '0';

// ---------------------------------------------------------------------------
// Session pool
// ---------------------------------------------------------------------------

interface PooledSession {
  session: ort.InferenceSession;
  busy: boolean;
}

let _sessionPool: PooledSession[] | null = null;
let _sessionPoolPromise: Promise<PooledSession[]> | null = null;

// Waiters when all sessions are busy
const _waiters: Array<(session: PooledSession) => void> = [];

async function getPool(): Promise<PooledSession[]> {
  if (_sessionPool) return _sessionPool;
  if (_sessionPoolPromise) return _sessionPoolPromise;

  _sessionPoolPromise = (async () => {
    await ensureModelDownloaded();
    console.log('[bg-removal] loading session pool, size:', SESSION_POOL_SIZE);
    const t0 = Date.now();

    // Load all sessions in parallel — model is on disk, parallel load is faster
    const sessions = await Promise.all(
      Array.from({ length: SESSION_POOL_SIZE }, () => loadSingleSession())
    );

    console.log(
      '[bg-removal] pool loaded',
      sessions.length,
      'sessions in',
      Date.now() - t0,
      'ms; inputs:',
      sessions[0].inputNames,
      'outputs:',
      sessions[0].outputNames
    );

    _sessionPool = sessions.map((s) => ({ session: s, busy: false }));
    return _sessionPool;
  })().catch((err) => {
    _sessionPoolPromise = null;
    throw err;
  });

  return _sessionPoolPromise;
}

async function loadSingleSession(): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: parseInt(process.env.ORT_INTRA_OP_THREADS ?? '4', 10),
    interOpNumThreads: parseInt(process.env.ORT_INTER_OP_THREADS ?? '1', 10),
  });
}

/**
 * Acquire a session from the pool. Marks it busy until released.
 * If all sessions are busy, queues until one frees.
 *
 * If acquisition takes longer than ACQUIRE_WARN_MS we log a warning — this
 * usually indicates the pool has been deadlocked (a session was leaked
 * because release wasn't called) or that load is genuinely high.
 */
const ACQUIRE_WARN_MS = 30_000;

async function acquireSession(): Promise<PooledSession> {
  const pool = await getPool();

  // Single-threaded JS guarantees no other code runs between this find()
  // and the busy=true assignment, so this is atomic.
  const free = pool.find((s) => !s.busy);
  if (free) {
    free.busy = true;
    return free;
  }

  // No free session — wait. The slot we receive is ALREADY marked busy by
  // releaseSession (see below) so there's no race window between freeing
  // and re-acquiring.
  const waitStart = Date.now();
  console.log(
    '[bg-removal] all',
    pool.length,
    'sessions busy; waiter queued (queue depth now',
    _waiters.length + 1,
    ')'
  );

  const slot = await new Promise<PooledSession>((resolve) => {
    _waiters.push(resolve);
  });

  const waitMs = Date.now() - waitStart;
  if (waitMs > ACQUIRE_WARN_MS) {
    console.warn(
      '[bg-removal] session acquire took',
      waitMs,
      'ms — possible pool starvation'
    );
  }
  return slot;
}

function releaseSession(slot: PooledSession): void {
  // If anyone is waiting, hand the slot off to them DIRECTLY without
  // ever flipping busy=false. This closes the race where a third caller
  // could grab the slot in the brief window between busy=false and the
  // waiter callback running.
  const next = _waiters.shift();
  if (next) {
    // Slot stays busy=true; ownership transfers to the waiter
    next(slot);
    return;
  }
  // No waiters — actually free the slot
  slot.busy = false;
}

// ---------------------------------------------------------------------------
// Model download
// ---------------------------------------------------------------------------

async function ensureModelDownloaded(): Promise<void> {
  if (existsSync(MODEL_PATH)) {
    const stat = await fs.stat(MODEL_PATH);
    if (stat.size > 1_000_000) return;
    console.warn('[bg-removal] cached model file is truncated, re-downloading');
    await fs.unlink(MODEL_PATH);
  }

  console.log('[bg-removal] downloading model from', MODEL_URL);
  const t0 = Date.now();
  await fs.mkdir(MODEL_CACHE_DIR, { recursive: true });

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`model download failed: ${res.status} ${res.statusText}`);
  }

  const tmpPath = MODEL_PATH + '.downloading';
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmpPath));
  await fs.rename(tmpPath, MODEL_PATH);
  const stat = await fs.stat(MODEL_PATH);
  console.log(
    '[bg-removal] model downloaded:',
    stat.size,
    'bytes in',
    Date.now() - t0,
    'ms'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RemoveBackgroundOpts {
  cleanupEdges?: boolean;
  cropToContent?: boolean;
}

/**
 * Remove the background. Accepts any sharp-decodable input; returns a clean
 * PNG with transparency, sized to WORKING_DIMENSION on the long edge.
 *
 * The output is already final-sized for storage — callers should NOT pass
 * it through another resize pass.
 */
export async function removeBackground(
  input: Buffer,
  opts: RemoveBackgroundOpts = {}
): Promise<Buffer> {
  const cleanupEdges = opts.cleanupEdges ?? true;
  const cropToContent = opts.cropToContent ?? true;

  // STEP 1 — Decode + apply EXIF rotation + downscale to working size.
  // Important: do this in ONE sharp pipeline so dimensions stay consistent.
  const { data: srcRgba, info: srcInfo } = await sharp(input)
    .rotate()
    .resize(WORKING_DIMENSION, WORKING_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const srcW = srcInfo.width;
  const srcH = srcInfo.height;
  if (!srcW || !srcH) throw new Error('could not read image dimensions');

  // STEP 2 — Build the model input (1024x1024 ImageNet-normalized RGB)
  const rgbFloat = await preprocessForModel(srcRgba, srcW, srcH);

  // STEP 3 — Run inference. With TTA on (default), we run the model up to
  // 4 times across symmetry transformations and combine the masks with
  // element-wise MAX (not average — see comment below). This catches
  // asymmetric failures the model has at image edges, and the directional
  // bias toward better confidence in the upper half of an image.
  //
  // Why MAX instead of AVERAGE: the failure mode we see is the model
  // MISSING legitimate foreground pixels (e.g. dark stripe at bottom edge).
  // With average, a confident "yes" (0.9) and a missed "no" (0.1) become
  // a borderline 0.5 which our threshold then wipes. With max, we keep the
  // 0.9 — we trust the pass that got it right. The risk of max would be
  // amplifying hallucinated foreground, but ISNet rarely hallucinates on
  // clothing-on-floor photos; the systematic error is in the other direction.
  const slot = await acquireSession();
  let combinedMask: Float32Array;
  try {
    const inputName = slot.session.inputNames[0];
    const outputName = slot.session.outputNames[0]; // rembg uses index 0
    const numPixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

    // Helper: run inference on a given input tensor, return a copy of the
    // mask data (we must copy because the next run() invalidates the buffer).
    const runOne = async (input: Float32Array): Promise<Float32Array> => {
      const tensor = new ort.Tensor('float32', input, [
        1,
        3,
        MODEL_INPUT_SIZE,
        MODEL_INPUT_SIZE,
      ]);
      const results = await slot.session.run({ [inputName]: tensor });
      const mask = results[outputName] as ort.Tensor;
      if (!mask) {
        throw new Error(
          `expected output "${outputName}" but got: ${Object.keys(results).join(', ')}`
        );
      }
      return (mask.data as Float32Array).slice(0, numPixels);
    };

    // FORWARD PASS — always run
    const forwardData = await runOne(rgbFloat);

    if (!USE_TTA) {
      combinedMask = forwardData;
    } else {
      // 4-way TTA: original, horizontal flip, vertical flip, both flips.
      // After running, undo each flip on the mask so they're all in the same
      // orientation, then take the element-wise MAX across all four.
      const hFlipInput = flipModelInputHorizontal(rgbFloat, MODEL_INPUT_SIZE);
      const vFlipInput = flipModelInputVertical(rgbFloat, MODEL_INPUT_SIZE);
      const hvFlipInput = flipModelInputVertical(hFlipInput, MODEL_INPUT_SIZE);

      const hFlipMask = await runOne(hFlipInput);
      const vFlipMask = await runOne(vFlipInput);
      const hvFlipMask = await runOne(hvFlipInput);

      // Undo the flips on each output mask
      const hFlipMaskBack = flipMaskHorizontal(hFlipMask, MODEL_INPUT_SIZE);
      const vFlipMaskBack = flipMaskVertical(vFlipMask, MODEL_INPUT_SIZE);
      const hvFlipMaskBack = flipMaskVertical(
        flipMaskHorizontal(hvFlipMask, MODEL_INPUT_SIZE),
        MODEL_INPUT_SIZE
      );

      // Element-wise MAX across all four masks
      combinedMask = new Float32Array(numPixels);
      for (let i = 0; i < numPixels; i++) {
        let m = forwardData[i];
        if (hFlipMaskBack[i] > m) m = hFlipMaskBack[i];
        if (vFlipMaskBack[i] > m) m = vFlipMaskBack[i];
        if (hvFlipMaskBack[i] > m) m = hvFlipMaskBack[i];
        combinedMask[i] = m;
      }
    }
  } finally {
    releaseSession(slot);
  }

  const resultMaskRaw = floatMaskToRawAlpha(
    combinedMask,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE
  );

  // STEP 4 — Bilinear resize the alpha mask to source dimensions
  const alphaBuf = bilinearResize1Channel(
    resultMaskRaw,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
    srcW,
    srcH
  );

  if (alphaBuf.length !== srcW * srcH) {
    throw new Error(
      `alpha buffer size mismatch: got ${alphaBuf.length}, expected ${srcW * srcH} (${srcW}x${srcH})`
    );
  }

  // STEP 5 — Replace the alpha channel of the source with our predicted mask.
  // In-place modification of srcRgba.
  for (let i = 0; i < srcW * srcH; i++) {
    srcRgba[i * 4 + 3] = alphaBuf[i];
  }

  // STEP 6 — Apply alpha cleanup IN-PLACE on the raw RGBA buffer
  if (cleanupEdges) {
    cleanupAlphaInPlace(srcRgba, srcW, srcH);
  }

  // STEP 7 — Center the subject on a square canvas with equal padding.
  //
  // Without this step, an off-center photo (subject in left half of frame)
  // would produce an off-center cutout. With it, every closet item ends up
  // with consistent catalog-style framing: subject centered, equal margin
  // on all four sides, square aspect ratio.
  //
  // We do this by:
  //   a. Finding the subject's bounding box in the cleaned-up alpha
  //   b. Extracting just that region
  //   c. Placing it in the middle of a transparent square canvas
  //
  // Skip if cropToContent is false, OR if no foreground was detected.
  let pipe: sharp.Sharp;
  if (cropToContent) {
    const bounds = computeTightCropBounds(srcRgba, srcW, srcH);
    if (bounds) {
      pipe = await centerOnSquareCanvas(srcRgba, srcW, srcH, bounds);
    } else {
      pipe = sharp(srcRgba, { raw: { width: srcW, height: srcH, channels: 4 } });
    }
  } else {
    pipe = sharp(srcRgba, { raw: { width: srcW, height: srcH, channels: 4 } });
  }

  const out = await pipe
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return out;
}

/**
 * Build a square canvas with the subject centered and equal padding.
 *
 * Takes the raw RGBA buffer and the bounding box of the subject. Extracts
 * just the subject region, then composites it into the middle of a
 * transparent square canvas sized at (longest_subject_edge × 1.10) so
 * there's a small breathing-room margin.
 *
 * Returns a sharp pipeline ready to encode.
 */
async function centerOnSquareCanvas(
  rgba: Buffer,
  srcW: number,
  srcH: number,
  bounds: { left: number; top: number; width: number; height: number }
): Promise<sharp.Sharp> {
  // Extract the subject as a standalone PNG buffer
  const subjectBuf = await sharp(rgba, {
    raw: { width: srcW, height: srcH, channels: 4 },
  })
    .extract(bounds)
    .png()
    .toBuffer();

  // Square canvas size: longest subject edge plus 5% padding on each side
  // (so 10% total breathing room). The subject is then placed in the middle.
  const longest = Math.max(bounds.width, bounds.height);
  const canvasSize = Math.round(longest * 1.10);
  const offsetX = Math.round((canvasSize - bounds.width) / 2);
  const offsetY = Math.round((canvasSize - bounds.height) / 2);

  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // fully transparent
    },
  }).composite([
    {
      input: subjectBuf,
      left: offsetX,
      top: offsetY,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Preprocessing — ImageNet normalization for ISNet
// ---------------------------------------------------------------------------

async function preprocessForModel(
  srcRgba: Buffer,
  srcW: number,
  srcH: number
): Promise<Float32Array> {
  // Resize to 1024x1024 with Lanczos (matches rembg's PIL.Image.LANCZOS).
  // sharp's `lanczos3` is the correct equivalent.
  const { data, info } = await sharp(srcRgba, {
    raw: { width: srcW, height: srcH, channels: 4 },
  })
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`expected 3 channels after removeAlpha, got ${info.channels}`);
  }

  // STEP A — find the max pixel value across all RGB bytes (this is what
  // rembg uses as the divisor — np.max(im_ary)).
  let imageMax = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > imageMax) imageMax = data[i];
  }
  // Guard against pure-black input
  const divisor = imageMax > 0 ? imageMax : 1;

  // STEP B — apply per-channel normalization in NCHW layout.
  // out = (pixel / image_max - mean) / std
  const HW = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const out = new Float32Array(3 * HW);
  const meanR = ISNET_MEAN[0];
  const meanG = ISNET_MEAN[1];
  const meanB = ISNET_MEAN[2];
  const stdR = ISNET_STD[0];
  const stdG = ISNET_STD[1];
  const stdB = ISNET_STD[2];

  for (let i = 0; i < HW; i++) {
    out[i] = (data[i * 3] / divisor - meanR) / stdR;
    out[HW + i] = (data[i * 3 + 1] / divisor - meanG) / stdG;
    out[2 * HW + i] = (data[i * 3 + 2] / divisor - meanB) / stdB;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Postprocessing helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Float32Array mask (model output, possibly TTA-averaged) to a
 * raw single-channel grayscale buffer. Normalizes the range to [0, 255]
 * using actual min/max — works whether the model outputs sigmoid
 * probabilities or unbounded logits.
 */
function floatMaskToRawAlpha(
  mask: Float32Array,
  width: number,
  height: number
): Buffer {
  const numPixels = width * height;
  if (mask.length < numPixels) {
    throw new Error(
      `mask too small: got ${mask.length} elements, expected at least ${numPixels} (${width}x${height})`
    );
  }
  const slice = mask.length === numPixels ? mask : mask.subarray(0, numPixels);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < numPixels; i++) {
    const v = slice[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(max - min, 1e-6);

  const alpha = Buffer.alloc(numPixels);
  let foregroundCount = 0;
  for (let i = 0; i < numPixels; i++) {
    const v = (slice[i] - min) / range;
    const a = Math.round(Math.min(1, Math.max(0, v)) * 255);
    alpha[i] = a;
    if (a > 128) foregroundCount++;
  }

  const coverage = ((foregroundCount / numPixels) * 100).toFixed(1);
  console.log(
    `[bg-removal] mask range=[${min.toFixed(3)}, ${max.toFixed(3)}] coverage=${coverage}% tta=${USE_TTA}`
  );

  return alpha;
}

/**
 * Flip a CHW-layout RGB tensor horizontally. Used to build the TTA pass
 * input. Walks each channel × row and reverses the column order.
 */
function flipModelInputHorizontal(tensor: Float32Array, size: number): Float32Array {
  const out = new Float32Array(tensor.length);
  const HW = size * size;
  for (let c = 0; c < 3; c++) {
    const channelOffset = c * HW;
    for (let y = 0; y < size; y++) {
      const rowOffset = channelOffset + y * size;
      for (let x = 0; x < size; x++) {
        out[rowOffset + x] = tensor[rowOffset + (size - 1 - x)];
      }
    }
  }
  return out;
}

/**
 * Flip a CHW-layout RGB tensor vertically. Walks each channel and reverses
 * the row order.
 */
function flipModelInputVertical(tensor: Float32Array, size: number): Float32Array {
  const out = new Float32Array(tensor.length);
  const HW = size * size;
  for (let c = 0; c < 3; c++) {
    const channelOffset = c * HW;
    for (let y = 0; y < size; y++) {
      const dstRow = channelOffset + y * size;
      const srcRow = channelOffset + (size - 1 - y) * size;
      for (let x = 0; x < size; x++) {
        out[dstRow + x] = tensor[srcRow + x];
      }
    }
  }
  return out;
}

/**
 * Flip a 2D mask horizontally. Used to undo the input flip on the TTA pass
 * output so we can combine it with the forward pass mask.
 */
function flipMaskHorizontal(mask: Float32Array, size: number): Float32Array {
  const out = new Float32Array(mask.length);
  for (let y = 0; y < size; y++) {
    const rowBase = y * size;
    for (let x = 0; x < size; x++) {
      out[rowBase + x] = mask[rowBase + (size - 1 - x)];
    }
  }
  return out;
}

/**
 * Flip a 2D mask vertically. Used to undo the input flip on the TTA v-pass
 * outputs.
 */
function flipMaskVertical(mask: Float32Array, size: number): Float32Array {
  const out = new Float32Array(mask.length);
  for (let y = 0; y < size; y++) {
    const dstRow = y * size;
    const srcRow = (size - 1 - y) * size;
    for (let x = 0; x < size; x++) {
      out[dstRow + x] = mask[srcRow + x];
    }
  }
  return out;
}

/**
 * Bilinear interpolation to scale a single-channel raw byte buffer.
 * Hand-rolled because sharp widens single-channel inputs to RGB during resize.
 */
function bilinearResize1Channel(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Buffer {
  const out = Buffer.alloc(dstW * dstH);
  const xRatio = (srcW - 1) / Math.max(dstW - 1, 1);
  const yRatio = (srcH - 1) / Math.max(dstH - 1, 1);

  for (let y = 0; y < dstH; y++) {
    const srcY = y * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const yFrac = srcY - y0;
    const yFracInv = 1 - yFrac;

    const rowOut = y * dstW;
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;

    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const xFrac = srcX - x0;
      const xFracInv = 1 - xFrac;

      const a = src[row0 + x0];
      const b = src[row0 + x1];
      const c = src[row1 + x0];
      const d = src[row1 + x1];

      const top = a * xFracInv + b * xFrac;
      const bottom = c * xFracInv + d * xFrac;
      out[rowOut + x] = Math.round(top * yFracInv + bottom * yFrac);
    }
  }

  return out;
}

/**
 * In-place alpha cleanup. Conservative — operates directly on the raw RGBA
 * buffer, only zeros out pixels we're highly confident are background and
 * boosts pixels we're highly confident are foreground.
 *
 * The previous version had an "edge erosion" pass that knocked down the
 * alpha of any pixel adjacent to a fully-transparent one. That pass made
 * silhouettes very slightly cleaner BUT it specifically punished subjects
 * with dark colors at their edges — a black stripe at alpha 100 next to
 * legitimate transparent background got knocked to alpha 20 and then killed
 * by the halo cutoff, while the same medium-confidence alpha on a bright
 * color stayed visible. We removed it; the model's natural soft edges are
 * already producing clean results.
 *
 * Tunable via env vars BG_HALO_CUTOFF and BG_SOLID_THRESHOLD if needed.
 */
function cleanupAlphaInPlace(rgba: Buffer, w: number, h: number): void {
  // Anything below this is definitely background — it's the model's faintest
  // halo noise. Conservative default of 8 (was 28) preserves more of the
  // medium-confidence pixels at edges, which matters when those pixels are
  // dark colors (where low alpha looks like "missing" rather than "soft").
  const HALO_CUTOFF = parseInt(process.env.BG_HALO_CUTOFF ?? '8', 10);
  // Anything above this is definitely foreground — push it to fully opaque
  // for a slightly cleaner result without affecting the mid-range soft edges.
  const SOLID_THRESHOLD = parseInt(process.env.BG_SOLID_THRESHOLD ?? '240', 10);

  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a < HALO_CUTOFF) {
      rgba[i] = 0;
    } else if (a > SOLID_THRESHOLD) {
      rgba[i] = 255;
    }
    // Mid-range values stay as-is — preserve natural soft edges.
  }
}

/**
 * Find the bounding box of non-transparent pixels. Returns the exact bounds
 * with no margin — callers can add their own padding (e.g. via the square
 * canvas compositor).
 */
function computeTightCropBounds(
  rgba: Buffer,
  w: number,
  h: number
): { left: number; top: number; width: number; height: number } | null {
  const ALPHA_THRESHOLD = 20;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const step = 2;
  const stride = w * 4;

  for (let y = 0; y < h; y += step) {
    const rowBase = y * stride;
    for (let x = 0; x < w; x += step) {
      const a = rgba[rowBase + x * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  // Subsampling step=2 means the actual bounds could be off by 1 pixel
  // each way; expand by 1 pixel to be safe.
  const left = Math.max(0, minX - 1);
  const top = Math.max(0, minY - 1);
  const width = Math.min(w - left, maxX - minX + 2);
  const height = Math.min(h - top, maxY - minY + 2);

  return { left, top, width, height };
}

// ---------------------------------------------------------------------------
// Warmup
// ---------------------------------------------------------------------------

export function warmup(): void {
  getPool().catch((err) => console.error('[bg-removal] warmup failed', err));
}

// Auto-warm on first import
warmup();
