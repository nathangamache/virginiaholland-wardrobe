/**
 * POST /api/items/upload
 *
 * Phase 1 of the two-phase upload flow used by the bulk uploader.
 *
 * This endpoint ONLY stashes the raw photo on the server and returns a
 * handle. No tagging, no bg removal — those happen in phase 2 via
 * /api/items/process-stashed.
 *
 * Why two phases: when a user uploads 100 photos, the network upload alone
 * can take 30+ seconds for the first batch. Doing all the AI/CV work in the
 * same HTTP request means the user sees no progress until the first 5
 * photos are entirely done. Splitting lets us show "uploading…" feedback
 * during the network phase and "tagging + removing background…" during
 * the processing phase, with each phase moving items along independently.
 *
 * The "stash" is just a temp directory under /tmp; we save the raw bytes
 * with a generated UUID, return the UUID to the client, and the process
 * endpoint reads the file back from /tmp using the same UUID.
 *
 * Stashed files are cleaned up by the process endpoint after it reads
 * them. They have a max lifetime of 24 hours — older ones get garbage-
 * collected on each upload to prevent /tmp from filling up.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireSession } from '@/lib/auth';
import { ApiError, routeHandler } from '@/lib/api-error';

const STASH_DIR = path.join(os.tmpdir(), 'wardrobe-uploads');
const STASH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function ensureStashDir(): Promise<void> {
  await fs.mkdir(STASH_DIR, { recursive: true });
}

/**
 * Garbage-collect stashed files older than STASH_TTL_MS. Best-effort —
 * ignores errors. Runs once per upload as a side effect; doesn't add
 * meaningful latency.
 */
async function gcOldStashes(): Promise<void> {
  try {
    const now = Date.now();
    const entries = await fs.readdir(STASH_DIR);
    await Promise.all(
      entries.map(async (name) => {
        const full = path.join(STASH_DIR, name);
        try {
          const stat = await fs.stat(full);
          if (now - stat.mtimeMs > STASH_TTL_MS) {
            await fs.unlink(full);
          }
        } catch {}
      })
    );
  } catch {}
}

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
    throw new ApiError(400, 'Missing photo', 'No photo was attached.', 'BAD_INPUT');
  }

  await ensureStashDir();
  // Fire-and-forget GC so it doesn't block the response
  void gcOldStashes();

  const stashId = randomBytes(16).toString('hex');
  const filename = file.name || 'upload.bin';
  // Sanitize the filename — strip path separators and weird characters so
  // we never get directory traversal via crafted form data
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const stashPath = path.join(STASH_DIR, `${stashId}__${safeFilename}`);

  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(stashPath, buf);

  return NextResponse.json({
    stash_id: stashId,
    filename: safeFilename,
    size: buf.length,
  });
});

export const runtime = 'nodejs';
export const maxDuration = 60;
