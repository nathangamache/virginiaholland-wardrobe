/**
 * POST /api/items/process-stashed
 *
 * Phase 2 of the two-phase bulk upload flow. Reads a previously-stashed
 * raw upload (see /api/items/upload) by its stash_id, then runs the same
 * tagging + bg removal + thumbnail pipeline as /api/items/process.
 *
 * Body: JSON { stash_id: string }
 *
 * Returns the same shape as /api/items/process so the client can use a
 * single result-handling code path.
 *
 * Cleans up the stashed file on success OR after a failure where we know
 * the file was readable. (We leave it on disk if the failure happened
 * before we got the bytes, so a retry can find it.)
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireSession } from '@/lib/auth';
import { tagItemImage } from '@/lib/anthropic';
import { processJpeg } from '@/lib/image';
import { removeBackground } from '@/lib/bg-removal-server';
import { saveBuffer } from '@/lib/storage';
import { imageProcessingPool } from '@/lib/work-queue';
import { ApiError, routeHandler } from '@/lib/api-error';

const STASH_DIR = path.join(os.tmpdir(), 'wardrobe-uploads');
const TARGET_BINARY_BYTES_FOR_AI = 3_400_000;

/**
 * Resolve a stash_id to its on-disk path. We listdir to find it because the
 * actual filename includes the original extension after a `__` separator,
 * and we don't have it in the request.
 */
async function resolveStashPath(stashId: string): Promise<string | null> {
  // Validate stash ID shape — must be 32 hex chars (matches randomBytes(16).hex)
  if (!/^[a-f0-9]{32}$/.test(stashId)) return null;
  try {
    const entries = await fs.readdir(STASH_DIR);
    const match = entries.find((e) => e.startsWith(`${stashId}__`));
    if (!match) return null;
    return path.join(STASH_DIR, match);
  } catch {
    return null;
  }
}

export const POST = routeHandler(async (req: NextRequest) => {
  try {
    await requireSession();
  } catch {
    throw new ApiError(401, 'Not signed in', 'Authentication required.', 'UNAUTHORIZED');
  }

  const body = await req.json().catch(() => null);
  const stashId: string | undefined = body?.stash_id;
  if (!stashId) {
    throw new ApiError(400, 'Missing stash_id', 'No stash_id was provided.', 'BAD_INPUT');
  }

  const stashPath = await resolveStashPath(stashId);
  if (!stashPath) {
    throw new ApiError(
      404,
      'Upload not found',
      'The uploaded file is no longer available. Please re-upload.',
      'STASH_NOT_FOUND'
    );
  }

  const tStart = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8);

  let rawBuf: Buffer;
  try {
    rawBuf = await fs.readFile(stashPath);
  } catch (e: any) {
    throw new ApiError(
      500,
      'Could not read upload',
      `Stashed file could not be read: ${e?.message ?? 'unknown'}`,
      'STASH_READ_FAILED'
    );
  }

  console.log(
    `[items/process-stashed ${reqId}] start stash=${stashId} size=${rawBuf.length}`
  );

  // STEP 1 — normalize to JPEG for storage
  let normalized: { buffer: Buffer; width: number; height: number };
  try {
    normalized = await imageProcessingPool.run(() =>
      processJpeg(rawBuf, { maxW: 2000, maxH: 2000, quality: 88 })
    );
  } catch (e: any) {
    // Don't unlink — let the user retry on the same stash
    throw new ApiError(
      400,
      'Could not read photo',
      `The photo could not be decoded: ${e?.message || 'unknown error'}`,
      'IMAGE_DECODE_FAILED'
    );
  }

  // STEP 2 — parallel tagging + bg removal (same as /api/items/process)
  const taggingPromise = (async () => {
    const t = Date.now();
    try {
      const aiBuf = await imageProcessingPool.run(() =>
        shrinkForAnthropic(normalized.buffer)
      );
      const base64 = aiBuf.toString('base64');
      const result = await tagItemImage(base64, 'image/jpeg');
      console.log(`[items/process-stashed ${reqId}] tagging done in ${Date.now() - t}ms`);
      return result;
    } catch (e: any) {
      console.error(`[items/process-stashed ${reqId}] tagging failed after ${Date.now() - t}ms:`, e?.message);
      return null;
    }
  })();

  const bgRemovalPromise = (async () => {
    const t = Date.now();
    try {
      const result = await removeBackground(rawBuf);
      console.log(`[items/process-stashed ${reqId}] bg removal done in ${Date.now() - t}ms`);
      return result;
    } catch (e: any) {
      console.error(`[items/process-stashed ${reqId}] bg removal failed after ${Date.now() - t}ms:`, e?.message);
      return null;
    }
  })();

  const [tagged, nobgBuf] = await Promise.all([taggingPromise, bgRemovalPromise]);

  // STEP 3 — save permanent images
  const originalPath = await saveBuffer('items', normalized.buffer, 'jpg');
  let nobgPath: string | null = null;
  if (nobgBuf) {
    nobgPath = await saveBuffer('items-nobg', nobgBuf, 'png');
  }

  // STEP 4 — thumbnail
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

  // STEP 5 — clean up the stashed file. If this fails it's not fatal; the
  // GC sweeper in /upload will clean it up eventually.
  fs.unlink(stashPath).catch(() => {});

  console.log(
    `[items/process-stashed ${reqId}] complete in ${Date.now() - tStart}ms; bg=${!!nobgBuf} tagged=${!!tagged}`
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
