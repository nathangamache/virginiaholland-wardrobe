/**
 * POST /api/items/process
 *
 * Single endpoint that handles the full upload-time processing flow:
 *
 *   1. Accept a photo (any format sharp can decode)
 *   2. Normalize to JPEG for storage
 *   3. In parallel:
 *      a. Run Claude vision tagging (rate-limited by an HTTP semaphore)
 *      b. Run server-side background removal via ISNet (rate-limited by
 *         the bg-removal session pool internally)
 *   4. Save original (JPEG), bg-removed (PNG), thumbnail (JPEG)
 *   5. Return paths + URLs + tagging result to the client
 *
 * The final save (POST /api/items) just persists the DB row referencing
 * these already-saved paths — no reprocessing on save.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { tagItemImage } from '@/lib/anthropic';
import { processJpeg } from '@/lib/image';
import { removeBackground } from '@/lib/bg-removal-server';
import { saveBuffer } from '@/lib/storage';
import { imageProcessingPool } from '@/lib/work-queue';
import { ApiError, routeHandler } from '@/lib/api-error';

// Anthropic limit is 5MB base64; aim for 3.4MB binary to leave headroom.
const TARGET_BINARY_BYTES_FOR_AI = 3_400_000;

export const POST = routeHandler(async (req: NextRequest) => {
  try {
    await requireSession();
  } catch {
    throw new ApiError(401, 'Not signed in', 'Authentication required.', 'UNAUTHORIZED');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, 'Invalid upload', 'Could not parse upload form.', 'BAD_INPUT');
  }

  const file = form.get('photo') as File | null;
  if (!file) {
    throw new ApiError(400, 'Missing photo', 'No photo was attached to the upload.', 'BAD_INPUT');
  }

  const rawBuf = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;
  const fileSize = file.size;
  const tStart = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8);

  console.log(`[items/process ${reqId}] start file=${fileName} size=${fileSize}`);

  // STEP 1 — normalize to JPEG for storage. Cheap (~50ms).
  let normalized: { buffer: Buffer; width: number; height: number };
  try {
    normalized = await imageProcessingPool.run(() =>
      processJpeg(rawBuf, { maxW: 2000, maxH: 2000, quality: 88 })
    );
  } catch (e: any) {
    throw new ApiError(
      400,
      'Could not read photo',
      `The photo could not be decoded: ${e?.message || 'unknown error'}`,
      'IMAGE_DECODE_FAILED',
      { fileName, fileSize }
    );
  }

  // STEP 2 — kick off TAGGING and BG REMOVAL in parallel.
  // Background removal is rate-limited internally by the session pool.
  // Tagging just hits Anthropic's API so concurrency is fine.

  const taggingPromise = (async () => {
    const t = Date.now();
    try {
      const aiBuf = await imageProcessingPool.run(() =>
        shrinkForAnthropic(normalized.buffer)
      );
      const base64 = aiBuf.toString('base64');
      const result = await tagItemImage(base64, 'image/jpeg');
      console.log(`[items/process ${reqId}] tagging done in ${Date.now() - t}ms`);
      return result;
    } catch (e: any) {
      console.error(`[items/process ${reqId}] tagging failed after ${Date.now() - t}ms:`, e?.message);
      return null;
    }
  })();

  const bgRemovalPromise = (async () => {
    const t = Date.now();
    try {
      const result = await removeBackground(rawBuf);
      console.log(`[items/process ${reqId}] bg removal done in ${Date.now() - t}ms`);
      return result;
    } catch (e: any) {
      console.error(`[items/process ${reqId}] bg removal failed after ${Date.now() - t}ms:`, e?.message, e?.stack);
      return null;
    }
  })();

  const [tagged, nobgBuf] = await Promise.all([taggingPromise, bgRemovalPromise]);

  // STEP 3 — save both images
  const originalPath = await saveBuffer('items', normalized.buffer, 'jpg');

  let nobgPath: string | null = null;
  if (nobgBuf) {
    nobgPath = await saveBuffer('items-nobg', nobgBuf, 'png');
  }

  // STEP 4 — thumbnail (cream background, square crop) from whichever source we have
  const sourceForThumb = nobgBuf ?? normalized.buffer;
  const thumb = await imageProcessingPool.run(() =>
    processJpeg(sourceForThumb, {
      maxW: 480,
      maxH: 480,
      quality: 84,
      flattenBg: { r: 253, g: 251, b: 247 },
      square: true,
    })
  );
  const thumbPath = await saveBuffer('thumbs', thumb.buffer, 'jpg');

  console.log(
    `[items/process ${reqId}] complete in ${Date.now() - tStart}ms; bg=${!!nobgBuf} tagged=${!!tagged}`
  );

  return NextResponse.json({
    paths: {
      original: originalPath,
      nobg: nobgPath,
      thumb: thumbPath,
    },
    urls: {
      original: `/api/images/${originalPath}`,
      nobg: nobgPath ? `/api/images/${nobgPath}` : null,
      thumb: `/api/images/${thumbPath}`,
    },
    tagged,
    nobg_succeeded: !!nobgPath,
    tagging_succeeded: !!tagged,
  });
});

/**
 * Shrink to fit under Anthropic's 5MB base64 limit.
 */
async function shrinkForAnthropic(input: Buffer): Promise<Buffer> {
  const ladder = [
    { maxW: 1600, maxH: 1600, quality: 85 },
    { maxW: 1280, maxH: 1280, quality: 82 },
    { maxW: 1024, maxH: 1024, quality: 78 },
    { maxW: 768, maxH: 768, quality: 72 },
  ];
  let last: Buffer | null = null;
  for (const opts of ladder) {
    const out = await processJpeg(input, opts);
    last = out.buffer;
    if (out.buffer.length <= TARGET_BINARY_BYTES_FOR_AI) return out.buffer;
  }
  return last!;
}

export const runtime = 'nodejs';
export const maxDuration = 120;
