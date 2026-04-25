/**
 * Server-side background removal using ISNet General Use via onnxruntime-node.
 *
 * This replaces the client-side @imgly/background-removal library. On our new
 * server (Xeon E5-2687W v2, 8 cores, AVX+SSE4.1) ONNX Runtime works great;
 * we can process images ~3-5x faster than the browser could and we can run
 * several in parallel.
 *
 * Model: ISNet (General Use), ~170MB float32 ONNX.
 * On first run we download the file and cache it to ~/.cache/wardrobe/models/.
 */

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import fs from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

const MODEL_URL =
  // Hosted by imgly — stable release artifact URLs with integrity check via redirects.
  // Model: isnet (general use), float32, 1024x1024 input.
  'https://staticimgly.com/@imgly/background-removal-data/1.7.0/isnet_fp16/isnet_fp16.onnx';

const MODEL_CACHE_DIR =
  process.env.MODEL_CACHE_DIR ?? path.join(os.homedir(), '.cache', 'wardrobe', 'models');
const MODEL_PATH = path.join(MODEL_CACHE_DIR, 'isnet_fp16.onnx');

// ISNet's expected input resolution. The model is scale-invariant enough that
// 1024 works for any incoming image — we letterbox-fit into 1024x1024,
// run inference, and scale the mask back to the source.
const MODEL_INPUT_SIZE = 1024;

// ---------------------------------------------------------------------------
// Session singleton — loading the model takes 1-2 seconds; keep it warm.
// ---------------------------------------------------------------------------

let _sessionPromise: Promise<ort.InferenceSession> | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (_sessionPromise) return _sessionPromise;
  _sessionPromise = loadSession().catch((err) => {
    // If load fails, clear the cached promise so the next call retries
    _sessionPromise = null;
    throw err;
  });
  return _sessionPromise;
}

async function loadSession(): Promise<ort.InferenceSession> {
  await ensureModelDownloaded();
  console.log('[bg-removal] loading model from', MODEL_PATH);
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    // Let ORT auto-pick thread counts. On our 8-core server this defaults
    // to ~4 intra-op threads which is about right for inference.
  });
  console.log('[bg-removal] model loaded in', Date.now() - t0, 'ms');
  return session;
}

async function ensureModelDownloaded(): Promise<void> {
  if (existsSync(MODEL_PATH)) {
    // Extra sanity check: non-trivial file size
    const stat = await fs.stat(MODEL_PATH);
    if (stat.size > 1_000_000) return; // already have it
    // Truncated file from a failed earlier download — delete and re-fetch
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

  // Write to a temp file first, then rename — so a crash mid-download doesn't
  // leave a corrupted file that we'd later mistake for valid.
  const tmpPath = MODEL_PATH + '.downloading';
  await pipeline(
    Readable.fromWeb(res.body as any),
    createWriteStream(tmpPath)
  );
  await fs.rename(tmpPath, MODEL_PATH);
  const stat = await fs.stat(MODEL_PATH);
  console.log('[bg-removal] model downloaded:', stat.size, 'bytes in', Date.now() - t0, 'ms');
}

// ---------------------------------------------------------------------------
// The main function
// ---------------------------------------------------------------------------

export interface RemoveBackgroundOpts {
  /**
   * Post-process the alpha channel to trim semi-transparent halo pixels.
   * Default true. Gives cleaner edges on typical clothing photos.
   */
  cleanupEdges?: boolean;
  /**
   * Crop the output tight to the subject's bounding box (with a small margin).
   * Default true. Produces nicely-framed results instead of lots of padding.
   */
  cropToContent?: boolean;
}

/**
 * Remove the background from an input image. Accepts any format sharp can
 * decode (JPEG, PNG, HEIC, WebP, TIFF, GIF, etc); returns a clean PNG with
 * transparent background.
 */
export async function removeBackground(
  input: Buffer,
  opts: RemoveBackgroundOpts = {}
): Promise<Buffer> {
  const cleanupEdges = opts.cleanupEdges ?? true;
  const cropToContent = opts.cropToContent ?? true;

  // 1. Load the source, get native size
  const srcMeta = await sharp(input).metadata();
  const srcW = srcMeta.width;
  const srcH = srcMeta.height;
  if (!srcW || !srcH) throw new Error('could not read image dimensions');

  // 2. Preprocess for the model: resize to 1024x1024 (letterbox), extract RGB floats
  const rgbFloat = await preprocessForModel(input);

  // 3. Run inference
  const session = await getSession();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', rgbFloat, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const results = await session.run({ [inputName]: tensor });
  const mask = results[outputName];

  // 4. Postprocess: convert mask to alpha channel image, scale back to source size
  let alphaBuf = await maskTensorToAlphaPng(mask, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  alphaBuf = await sharp(alphaBuf)
    .resize(srcW, srcH, { fit: 'fill' })
    .png()
    .toBuffer();

  // 5. Join source RGB with the predicted alpha mask
  let out = await sharp(input)
    .ensureAlpha()
    .joinChannel(await sharp(alphaBuf).extractChannel(0).toBuffer({ resolveWithObject: false }), {
      raw: { width: srcW, height: srcH, channels: 1 },
    })
    .png()
    .toBuffer();

  // 6. Optional cleanup: erode the alpha slightly and clamp low-alpha halo pixels
  if (cleanupEdges) {
    out = await cleanupAlpha(out);
  }

  // 7. Optional crop: trim to subject's bounding box + small margin
  if (cropToContent) {
    out = await tightCrop(out);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Preprocessing: resize + normalize to what ISNet expects
// ---------------------------------------------------------------------------

async function preprocessForModel(input: Buffer): Promise<Float32Array> {
  // Resize (fit: 'fill' — stretch to exactly 1024x1024). ISNet's training
  // pipeline does the same, so this matches expectations.
  const { data, info } = await sharp(input)
    .rotate()
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`expected 3 channels after removeAlpha, got ${info.channels}`);
  }

  // Convert HWC uint8 → CHW float32, normalized to [0, 1] then ImageNet mean/std
  // ISNet was trained with:
  //   mean = [0.5, 0.5, 0.5]
  //   std  = [1.0, 1.0, 1.0]
  // (per the official preprocessing — simpler than ImageNet normalization)
  const HW = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const out = new Float32Array(3 * HW);
  for (let i = 0; i < HW; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    // CHW layout, mean=0.5 subtraction
    out[i] = r - 0.5;
    out[HW + i] = g - 0.5;
    out[2 * HW + i] = b - 0.5;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Postprocessing: mask tensor → grayscale PNG
// ---------------------------------------------------------------------------

async function maskTensorToAlphaPng(
  mask: ort.Tensor,
  width: number,
  height: number
): Promise<Buffer> {
  const maskData = mask.data as Float32Array;
  // The mask may be [1,1,H,W] (size HW) — take the first channel if bigger
  const numPixels = width * height;
  const slice =
    maskData.length === numPixels
      ? maskData
      : maskData.subarray(0, numPixels);

  // Map float values to uint8 alpha (0-255). ISNet outputs are already in a
  // mostly [0, 1] range — clamp and scale.
  const alpha = Buffer.alloc(numPixels);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < numPixels; i++) {
    if (slice[i] < min) min = slice[i];
    if (slice[i] > max) max = slice[i];
  }
  // Normalize to [0, 1] based on actual range (defensive — handles models
  // that output logits instead of sigmoid probabilities).
  const range = Math.max(max - min, 1e-6);
  for (let i = 0; i < numPixels; i++) {
    const v = (slice[i] - min) / range;
    alpha[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }

  return sharp(alpha, {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Alpha cleanup — kill halo pixels and lightly erode the edge
// ---------------------------------------------------------------------------

async function cleanupAlpha(pngBuf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;

  // Pass 1: clamp very low alpha values to zero (kills faint halos)
  const HALO_CUTOFF = 28;
  for (let i = 3; i < data.length; i += channels) {
    if (data[i] < HALO_CUTOFF) data[i] = 0;
  }

  // Pass 2: single-step erosion — pixels bordering a fully-transparent pixel
  // get their alpha reduced by 80. Creates a cleaner silhouette by ~1px.
  const snapshot = Buffer.from(data); // copy before we modify
  const stride = w * channels;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * stride + x * channels + 3;
      if (snapshot[i] === 0 || snapshot[i] === 255) continue;
      const up = snapshot[i - stride];
      const down = snapshot[i + stride];
      const left = snapshot[i - channels];
      const right = snapshot[i + channels];
      if (up === 0 || down === 0 || left === 0 || right === 0) {
        data[i] = Math.max(0, snapshot[i] - 80);
      }
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels } })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Tight crop to the subject's bounding box (with small margin)
// ---------------------------------------------------------------------------

async function tightCrop(pngBuf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const ALPHA_THRESHOLD = 20;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  // Sample every 2nd pixel for bounding box — enough precision, faster
  const step = 2;
  const stride = w * channels;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = data[y * stride + x * channels + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Empty mask — no subject detected
  if (maxX < minX || maxY < minY) return pngBuf;

  const subjW = maxX - minX;
  const subjH = maxY - minY;
  const margin = Math.round(Math.max(subjW, subjH) * 0.03);
  const cropX = Math.max(0, minX - margin);
  const cropY = Math.max(0, minY - margin);
  const cropW = Math.min(w - cropX, subjW + margin * 2);
  const cropH = Math.min(h - cropY, subjH + margin * 2);

  // Skip if the crop doesn't meaningfully reduce the image
  if (cropW >= w * 0.98 && cropH >= h * 0.98) return pngBuf;

  return sharp(pngBuf)
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Warm-up: pre-load the model so the first user request doesn't pay for it
// ---------------------------------------------------------------------------

/**
 * Kick off model loading in the background. Call this at server startup if
 * you want the first bg-removal request to be fast rather than paying the
 * ~1-2s model load cost on the user's request.
 */
export function warmup(): void {
  getSession().catch((err) => console.error('[bg-removal] warmup failed', err));
}
