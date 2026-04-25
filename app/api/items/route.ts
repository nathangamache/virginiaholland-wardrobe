import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { saveBuffer } from '@/lib/storage';
import { processJpeg, processPng } from '@/lib/image';
import { removeBackground } from '@/lib/bg-removal-server';
import { bgRemovalPool, imageProcessingPool } from '@/lib/work-queue';
import { ApiError, routeHandler, badInput } from '@/lib/api-error';

// ---- GET /api/items -------------------------------------------------
export const GET = routeHandler(async (req: NextRequest) => {
  try {
    await requireSession();
  } catch {
    throw new ApiError(401, 'Not signed in', 'Authentication required.', 'UNAUTHORIZED');
  }

  const { searchParams } = req.nextUrl;
  const category = searchParams.get('category');
  const favorite = searchParams.get('favorite');
  const search = searchParams.get('q');

  const where: string[] = [];
  const values: any[] = [];
  if (category) {
    values.push(category);
    where.push(`category = $${values.length}`);
  }
  if (favorite === '1') {
    where.push(`favorite = TRUE`);
  }
  if (search) {
    values.push(`%${search}%`);
    where.push(
      `(name ILIKE $${values.length} OR brand ILIKE $${values.length} OR sub_category ILIKE $${values.length})`
    );
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const items = await query(
    `SELECT id, category, sub_category, image_nobg_path, image_path, thumb_path, name, brand,
            colors, style_tags, season_tags, warmth_score, formality_score, favorite,
            times_worn, last_worn_at, created_at
     FROM items
     ${whereClause}
     ORDER BY favorite DESC, created_at DESC`,
    values
  );
  return NextResponse.json({ items });
});

// ---- POST /api/items ------------------------------------------------
//
// Accepts an `original` image file (any format sharp can decode — JPEG, PNG,
// HEIC, WebP, TIFF, GIF) and `meta` JSON. Server does everything:
//   - normalize original to JPEG
//   - run ISNet background removal → save nobg PNG
//   - generate 480px square thumbnail from nobg on cream background
//
// Client no longer ships a nobg blob. No more 80MB model download in Virginia's
// browser. No 30-60s wait on her phone.
//
const metaSchema = z.object({
  category: z.enum(['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory']),
  sub_category: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  pattern: z.string().optional().nullable(),
  colors: z.array(z.string()).default([]),
  style_tags: z.array(z.string()).default([]),
  season_tags: z.array(z.string()).default([]),
  warmth_score: z.number().int().min(1).max(5).optional().nullable(),
  formality_score: z.number().int().min(1).max(5).optional().nullable(),
  favorite: z.boolean().optional().default(false),
  notes: z.string().optional().nullable(),
  acquired_from: z.string().optional().nullable(),
  purchase_price: z.number().optional().nullable(),
});

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
    throw badInput('Could not parse upload form.');
  }

  const original = form.get('original') as File | null;
  const metaRaw = form.get('meta');
  if (!original) throw badInput('Missing photo.');
  if (!metaRaw) throw badInput('Missing metadata.');

  let meta: z.infer<typeof metaSchema>;
  try {
    meta = metaSchema.parse(JSON.parse(metaRaw.toString()));
  } catch (e: any) {
    throw badInput(`Invalid metadata: ${e.message}`);
  }

  const originalBuf = Buffer.from(await original.arrayBuffer());

  // Normalize → JPEG
  let normalized: { buffer: Buffer; width: number; height: number };
  try {
    normalized = await imageProcessingPool.run(() =>
      processJpeg(originalBuf, { maxW: 2000, maxH: 2000, quality: 88 })
    );
  } catch (e: any) {
    throw new ApiError(
      400,
      'Could not process the uploaded photo',
      e.message || 'Unknown image error',
      'IMAGE_PROCESSING_FAILED',
      { fileName: original.name, fileSize: original.size }
    );
  }
  const originalPath = await saveBuffer('items', normalized.buffer, 'jpg');

  const occupiesSlots: string[] = meta.category === 'dress' ? ['shirt', 'pants'] : [];

  // Background removal — non-fatal. If it fails we save without the nobg image.
  let nobgPath: string | null = null;
  let nobgBuf: Buffer | null = null;
  try {
    nobgBuf = await bgRemovalPool.run(() => removeBackground(originalBuf));
    const processedNobg = await imageProcessingPool.run(() =>
      processPng(nobgBuf!, { maxW: 1600, maxH: 1600 })
    );
    nobgPath = await saveBuffer('items-nobg', processedNobg.buffer, 'png');
  } catch (e: any) {
    console.warn('[items] bg removal failed, saving without it:', e.message);
  }

  // Thumbnail — prefer nobg (flattened onto cream) for a clean grid aesthetic
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

  const row = await queryOne<{ id: string }>(
    `INSERT INTO items (
       category, sub_category, occupies_slots,
       image_path, image_nobg_path, thumb_path,
       name, brand, material, pattern, colors,
       style_tags, season_tags, warmth_score, formality_score,
       favorite, notes, acquired_from, purchase_price
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     ) RETURNING id`,
    [
      meta.category,
      meta.sub_category ?? null,
      occupiesSlots,
      originalPath,
      nobgPath,
      thumbPath,
      meta.name ?? null,
      meta.brand ?? null,
      meta.material ?? null,
      meta.pattern ?? null,
      meta.colors,
      meta.style_tags,
      meta.season_tags,
      meta.warmth_score ?? null,
      meta.formality_score ?? null,
      meta.favorite ?? false,
      meta.notes ?? null,
      meta.acquired_from ?? null,
      meta.purchase_price ?? null,
    ]
  );

  return NextResponse.json({
    id: row!.id,
    nobg_succeeded: !!nobgPath,
  });
});

export const runtime = 'nodejs';
// BG removal 3-8s per image; give headroom
export const maxDuration = 90;
