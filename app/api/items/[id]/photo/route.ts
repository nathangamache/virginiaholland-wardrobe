/**
 * PATCH /api/items/[id]/photo
 *
 * Replace an existing item's photo. Re-runs background removal and thumbnail
 * generation, swaps the stored image files, and points the DB row at the
 * new paths. The old image files are deleted afterward.
 *
 * Tagging is intentionally NOT re-run here — the user has already curated
 * metadata on this item, so we leave existing tags alone. If they want
 * re-tagging too, they can add a separate UI for it later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { processJpeg } from '@/lib/image';
import { removeBackground } from '@/lib/bg-removal-server';
import { saveBuffer, deleteFile } from '@/lib/storage';
import { queryOne } from '@/lib/db';
import { imageProcessingPool } from '@/lib/work-queue';
import { ApiError, routeHandler } from '@/lib/api-error';

export const PATCH = routeHandler(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      await requireSession();
    } catch {
      throw new ApiError(401, 'Not signed in', 'Authentication required.', 'UNAUTHORIZED');
    }

    const { id } = await ctx.params;

    const existing = await queryOne<{
      image_path: string;
      image_nobg_path: string | null;
      thumb_path: string;
    }>(
      `SELECT image_path, image_nobg_path, thumb_path FROM items WHERE id = $1`,
      [id]
    );
    if (!existing) {
      throw new ApiError(404, 'Not found', 'Item does not exist.', 'NOT_FOUND');
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, 'Invalid upload', 'Could not parse upload form.', 'BAD_INPUT');
    }

    const file = form.get('photo') as File | null;
    if (!file) {
      throw new ApiError(400, 'Missing photo', 'No photo was attached.', 'BAD_INPUT');
    }

    const rawBuf = Buffer.from(await file.arrayBuffer());

    // STEP 1 — normalize to JPEG for storage
    let normalized: { buffer: Buffer };
    try {
      normalized = await imageProcessingPool.run(() =>
        processJpeg(rawBuf, { maxW: 2000, maxH: 2000, quality: 88 })
      );
    } catch (e: any) {
      throw new ApiError(
        400,
        'Could not read photo',
        `The photo could not be decoded: ${e?.message || 'unknown error'}`,
        'IMAGE_DECODE_FAILED'
      );
    }

    // STEP 2 — bg removal (non-fatal if it fails)
    let nobgBuf: Buffer | null = null;
    try {
      nobgBuf = await removeBackground(rawBuf);
    } catch (e: any) {
      console.error('[items/photo] bg removal failed:', e?.message);
    }

    // STEP 3 — save new image files
    const newOriginalPath = await saveBuffer('items', normalized.buffer, 'jpg');

    let newNobgPath: string | null = null;
    if (nobgBuf) {
      newNobgPath = await saveBuffer('items-nobg', nobgBuf, 'png');
    }

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
    const newThumbPath = await saveBuffer('thumbs', thumb.buffer, 'jpg');

    // STEP 4 — update the DB row
    await queryOne(
      `UPDATE items
         SET image_path = $1,
             image_nobg_path = $2,
             thumb_path = $3
       WHERE id = $4
       RETURNING id`,
      [newOriginalPath, newNobgPath, newThumbPath, id]
    );

    // STEP 5 — clean up old files. Do this AFTER the DB update so we don't
    // orphan the row pointing at deleted files if the update fails.
    await Promise.all([
      deleteFile(existing.image_path),
      deleteFile(existing.image_nobg_path),
      deleteFile(existing.thumb_path),
    ]);

    return NextResponse.json({
      paths: {
        original: newOriginalPath,
        nobg: newNobgPath,
        thumb: newThumbPath,
      },
      urls: {
        original: `/api/images/${newOriginalPath}`,
        nobg: newNobgPath ? `/api/images/${newNobgPath}` : null,
        thumb: `/api/images/${newThumbPath}`,
      },
      nobg_succeeded: !!newNobgPath,
    });
  }
);

export const runtime = 'nodejs';
export const maxDuration = 120;
