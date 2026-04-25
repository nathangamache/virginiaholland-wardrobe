import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { ApiError, routeHandler } from '@/lib/api-error';

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
// Accepts already-processed image paths from /api/items/process plus the
// item metadata. No image processing happens here — just the DB insert.
//
// This split means:
//   - Upload step does the heavy work (tagging + bg removal in parallel)
//   - User reviews the result with the bg-removed image already shown
//   - Save is just a DB insert (~10ms)
//
const saveSchema = z.object({
  // Paths returned by /api/items/process
  image_path: z.string().min(1),
  image_nobg_path: z.string().nullable().optional(),
  thumb_path: z.string().min(1),
  // Item metadata
  category: z.enum(['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory']),
  sub_category: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  pattern: z.string().nullable().optional(),
  colors: z.array(z.string()).default([]),
  style_tags: z.array(z.string()).default([]),
  season_tags: z.array(z.string()).default([]),
  warmth_score: z.number().int().min(1).max(5).nullable().optional(),
  formality_score: z.number().int().min(1).max(5).nullable().optional(),
  favorite: z.boolean().optional().default(false),
  notes: z.string().nullable().optional(),
  acquired_from: z.string().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
});

export const POST = routeHandler(async (req: NextRequest) => {
  try {
    await requireSession();
  } catch {
    throw new ApiError(401, 'Not signed in', 'Authentication required.', 'UNAUTHORIZED');
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    throw new ApiError(400, 'Invalid JSON', 'Request body could not be parsed as JSON.', 'BAD_INPUT');
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid input', parsed.error.message, 'BAD_INPUT');
  }
  const d = parsed.data;

  const occupiesSlots: string[] = d.category === 'dress' ? ['shirt', 'pants'] : [];

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
      d.category,
      d.sub_category ?? null,
      occupiesSlots,
      d.image_path,
      d.image_nobg_path ?? null,
      d.thumb_path,
      d.name ?? null,
      d.brand ?? null,
      d.material ?? null,
      d.pattern ?? null,
      d.colors,
      d.style_tags,
      d.season_tags,
      d.warmth_score ?? null,
      d.formality_score ?? null,
      d.favorite ?? false,
      d.notes ?? null,
      d.acquired_from ?? null,
      d.purchase_price ?? null,
    ]
  );

  return NextResponse.json({ id: row!.id });
});

export const runtime = 'nodejs';
export const maxDuration = 30;
