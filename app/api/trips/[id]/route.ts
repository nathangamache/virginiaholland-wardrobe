import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

async function authOrFail() {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

// ---- GET /api/trips/[id] ------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authOrFail())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const trip = await queryOne(
    `SELECT id, name, destination, destination_lat, destination_lon,
            start_date, end_date, occasions, selected_item_ids,
            generated_outfits, weather_forecast, notes, created_at, updated_at
     FROM trips WHERE id = $1`,
    [id]
  );
  if (!trip) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ trip });
}

// ---- PATCH /api/trips/[id] ----------------------------------------------
//
// Update any subset of trip metadata or trip data. We accept individual
// fields so the client can do partial updates (e.g. just rename, just
// change packing list, just edit a day outfit).
const dayOutfitSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outfit_item_ids: z.array(z.string().uuid()),
  reasoning: z.string().optional(),
});

const generatedOutfitsSchema = z.object({
  selected_item_ids: z.array(z.string().uuid()).optional(),
  day_outfits: z.array(dayOutfitSchema).optional(),
  packing_notes: z.string().optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  destination_lat: z.number().optional(),
  destination_lon: z.number().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  occasions: z.array(z.string()).optional(),
  selected_item_ids: z.array(z.string().uuid()).optional(),
  generated_outfits: generatedOutfitsSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authOrFail())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid input', details: parsed.error.errors },
      { status: 400 }
    );
  }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return NextResponse.json({ ok: true });

  const sets: string[] = [];
  const values: any[] = [];
  fields.forEach(([k, v], i) => {
    sets.push(`${k} = $${i + 1}`);
    // generated_outfits is JSONB — must be serialized
    if (k === 'generated_outfits') {
      values.push(v === null ? null : JSON.stringify(v));
    } else {
      values.push(v);
    }
  });
  // Always bump updated_at
  sets.push(`updated_at = now()`);
  values.push(id);

  await queryOne(
    `UPDATE trips SET ${sets.join(', ')}
     WHERE id = $${values.length} RETURNING id`,
    values
  );

  return NextResponse.json({ ok: true });
}

// ---- DELETE /api/trips/[id] ---------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authOrFail())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  await query(`DELETE FROM trips WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}

export const runtime = 'nodejs';
