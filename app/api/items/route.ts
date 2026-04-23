import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { saveBuffer } from '@/lib/storage';
import { processJpeg, processPng } from '@/lib/image';

// ---- GET /api/items -------------------------------------------------
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const category = searchParams.get('category');
  const favorite = searchParams.get('favorite');
  const search = searchParams.get('q');

  const where: string[] = ['user_id = $1'];
  const values: any[] = [session.userId];
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

  const items = await query(
    `SELECT id, category, sub_category, image_nobg_path, image_path, thumb_path, name, brand,
            colors, style_tags, season_tags, warmth_score, formality_score, favorite,
            times_worn, last_worn_at, created_at
     FROM items
     WHERE ${where.join(' AND ')}
     ORDER BY favorite DESC, created_at DESC`,
    values
  );
  return NextResponse.json({ items });
}

// ---- POST /api/items ------------------------------------------------
// Expects multipart form-data:
//   "original": File (the raw photo)
//   "nobg": File (the background-removed PNG, optional but preferred)
//   "meta": JSON string of the metadata below
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

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const original = form.get('original') as File | null;
  const nobg = form.get('nobg') as File | null;
  const metaRaw = form.get('meta');
  if (!original || !metaRaw) {
    return NextResponse.json({ error: 'missing original or meta' }, { status: 400 });
  }

  let meta;
  try {
    meta = metaSchema.parse(JSON.parse(metaRaw.toString()));
  } catch (e: any) {
    return NextResponse.json({ error: 'invalid meta', detail: e.message }, { status: 400 });
  }

  const originalBuf = Buffer.from(await original.arrayBuffer());
  // Normalize original to JPEG, max 2000px on long edge
  const normalized = await processJpeg(originalBuf, { maxW: 2000, maxH: 2000, quality: 88 });
  const originalPath = await saveBuffer('items', session.userId, normalized.buffer, 'jpg');

  // Occupies slots: dresses take both shirt+pants
  const occupiesSlots: string[] =
    meta.category === 'dress' ? ['shirt', 'pants'] : [];

  // Background-removed PNG (preserve transparency)
  let nobgPath: string | null = null;
  let thumbPath: string | null = null;
  const sourceForThumb = nobg ? Buffer.from(await nobg.arrayBuffer()) : normalized.buffer;

  if (nobg) {
    const processedNobg = await processPng(sourceForThumb, { maxW: 1600, maxH: 1600 });
    nobgPath = await saveBuffer('items-nobg', session.userId, processedNobg.buffer, 'png');
  }

  // Square thumbnail for grid view (from nobg if present, else original).
  // Flatten any transparency onto the ivory background.
  const thumb = await processJpeg(sourceForThumb, {
    maxW: 480,
    maxH: 480,
    quality: 84,
    flattenBg: { r: 253, g: 251, b: 247 },
    square: true,
  });
  thumbPath = await saveBuffer('thumbs', session.userId, thumb.buffer, 'jpg');

  const row = await queryOne<{ id: string }>(
    `INSERT INTO items (
       user_id, category, sub_category, occupies_slots,
       image_path, image_nobg_path, thumb_path,
       name, brand, material, pattern, colors,
       style_tags, season_tags, warmth_score, formality_score,
       favorite, notes, acquired_from, purchase_price
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     ) RETURNING id`,
    [
      session.userId,
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

  return NextResponse.json({ id: row!.id });
}
