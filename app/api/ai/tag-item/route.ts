import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { tagItemImage } from '@/lib/anthropic';
import { processJpeg } from '@/lib/image';
import { routeHandler, ApiError } from '@/lib/api-error';

/**
 * Anthropic's vision API has a hard 5MB per-image limit (at least on the
 * base64 payload). We aim for 4.5MB after base64 encoding — base64 inflates
 * by ~33%, so the binary JPEG we send must stay under ~3.4MB.
 *
 * Strategy: always pass through sharp to normalize to JPEG AND enforce the
 * size cap, regardless of input format. If the first encode still exceeds
 * the limit, progressively lower quality + dimensions until it fits.
 */
const ANTHROPIC_MAX_BASE64_BYTES = 5 * 1024 * 1024; // 5MB hard limit
const TARGET_BINARY_BYTES = 3_400_000; // ~4.5MB after base64 inflation

export const POST = routeHandler(async (req: NextRequest) => {
  try {
    await requireSession();
  } catch {
    throw new ApiError(401, 'Not signed in', 'Authentication required', 'UNAUTHORIZED');
  }

  const form = await req.formData();
  const image = form.get('image') as File | null;
  if (!image) {
    throw new ApiError(400, 'Missing image', 'No image file was attached', 'MISSING_IMAGE');
  }

  const rawBuf = Buffer.from(await image.arrayBuffer());

  // Always re-encode to JPEG and enforce the size cap. This handles:
  //   - HEIC/AVIF/TIFF/etc that Claude can't read natively
  //   - Huge JPEGs that exceed the 5MB limit
  //   - PNGs that are also huge
  let buf: Buffer;
  try {
    buf = await shrinkForAnthropic(rawBuf);
  } catch (e: any) {
    throw new ApiError(
      400,
      'Could not read image',
      `Photo could not be decoded: ${e?.message || 'unknown error'}`,
      'IMAGE_DECODE_FAILED'
    );
  }

  const base64 = buf.toString('base64');

  // Safety assert — if our shrinking logic somehow let a big payload through,
  // catch it here rather than letting Claude reject it.
  if (base64.length > ANTHROPIC_MAX_BASE64_BYTES) {
    throw new ApiError(
      400,
      'Image too large',
      `The photo is still too large after compression (${Math.round(base64.length / 1024 / 1024)}MB). Try a smaller source photo.`,
      'IMAGE_TOO_LARGE'
    );
  }

  try {
    const tagged = await tagItemImage(base64, 'image/jpeg');
    return NextResponse.json({ tagged });
  } catch (e: any) {
    console.error('[tag-item] AI call failed', e);
    throw new ApiError(
      502,
      'Auto-tagging failed',
      e?.message || 'The AI did not respond correctly. Fill in the details manually below.',
      'AI_CALL_FAILED'
    );
  }
});

/**
 * Re-encode a source image to JPEG under Anthropic's size limit.
 * Starts at reasonable quality/dimensions and progressively lowers them
 * until the output fits. Typically one pass is enough.
 */
async function shrinkForAnthropic(rawBuf: Buffer): Promise<Buffer> {
  // Attempt 1: conservative defaults, should handle most phone photos
  const attempts = [
    { maxW: 1600, maxH: 1600, quality: 85 },
    { maxW: 1280, maxH: 1280, quality: 82 },
    { maxW: 1024, maxH: 1024, quality: 78 },
    { maxW: 768,  maxH: 768,  quality: 72 },
  ];

  let lastBuf: Buffer | null = null;
  for (const opts of attempts) {
    const out = await processJpeg(rawBuf, opts);
    lastBuf = out.buffer;
    if (out.buffer.length <= TARGET_BINARY_BYTES) {
      return out.buffer;
    }
  }

  // Even at smallest size it's oversized — return what we have and let the
  // upstream size-check throw a clearer error than Claude would.
  return lastBuf!;
}

export const runtime = 'nodejs';
export const maxDuration = 60;
