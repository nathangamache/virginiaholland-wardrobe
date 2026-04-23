import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { saveBuffer } from '@/lib/storage';
import { processJpeg } from '@/lib/image';

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const wears = await query(
    `SELECT id, outfit_id, item_ids, worn_on, weather_snapshot, photo_path, notes, created_at
     FROM outfit_wears
     ORDER BY worn_on DESC, created_at DESC
     LIMIT 200`,
    []
  );
  return NextResponse.json({ wears });
}

const logSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1),
  worn_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outfit_id: z.string().uuid().nullable().optional(),
  weather_snapshot: z.any().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  let itemIds: string[] = [];
  let wornOn = '';
  let outfitId: string | null = null;
  let weatherSnapshot: any = null;
  let notes: string | null = null;
  let photoPath: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const metaRaw = form.get('meta');
    if (!metaRaw) return NextResponse.json({ error: 'missing meta' }, { status: 400 });
    const parsed = logSchema.safeParse(JSON.parse(metaRaw.toString()));
    if (!parsed.success) return NextResponse.json({ error: 'invalid meta' }, { status: 400 });
    ({ item_ids: itemIds, worn_on: wornOn, notes = null } = parsed.data as any);
    outfitId = parsed.data.outfit_id ?? null;
    weatherSnapshot = parsed.data.weather_snapshot ?? null;

    const photo = form.get('photo') as File | null;
    if (photo) {
      const buf = Buffer.from(await photo.arrayBuffer());
      const processed = await processJpeg(buf, { maxW: 1600, maxH: 1600, quality: 85 });
      photoPath = await saveBuffer('wears', processed.buffer, 'jpg');
    }
  } else {
    const body = await req.json().catch(() => null);
    const parsed = logSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    ({ item_ids: itemIds, worn_on: wornOn, notes = null } = parsed.data as any);
    outfitId = parsed.data.outfit_id ?? null;
    weatherSnapshot = parsed.data.weather_snapshot ?? null;
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO outfit_wears (outfit_id, item_ids, worn_on, weather_snapshot, photo_path, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [outfitId, itemIds, wornOn, weatherSnapshot ? JSON.stringify(weatherSnapshot) : null, photoPath, notes]
  );

  // Bump wear counters
  await query(
    `UPDATE items SET times_worn = times_worn + 1, last_worn_at = now()
     WHERE id = ANY($1::uuid[])`,
    [itemIds]
  );

  return NextResponse.json({ id: row!.id, photo_path: photoPath });
}

export const runtime = 'nodejs';
export const maxDuration = 30;
