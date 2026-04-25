import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { deleteFile } from '@/lib/storage';

async function authOrFail() {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

// ---- GET /api/wears/[id] -------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authOrFail())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const wear = await queryOne(
    `SELECT id, outfit_id, item_ids, worn_on, weather_snapshot, photo_path, notes, created_at
     FROM outfit_wears
     WHERE id = $1`,
    [id]
  );
  if (!wear) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ wear });
}

// ---- PATCH /api/wears/[id] ----------------------------------------------
//
// Accepts partial updates: change which items were worn, the date, or notes.
// Updating item_ids triggers a recount of times_worn for affected items
// (decrement removed, increment added).
const patchSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1).optional(),
  worn_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  // Look up the existing row so we can correctly adjust wear counts when
  // items change.
  const existing = await queryOne<{ item_ids: string[] }>(
    `SELECT item_ids FROM outfit_wears WHERE id = $1`,
    [id]
  );
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return NextResponse.json({ ok: true });

  const sets: string[] = [];
  const values: any[] = [];
  fields.forEach(([k, v], i) => {
    sets.push(`${k} = $${i + 1}`);
    values.push(v);
  });
  values.push(id);

  await queryOne(
    `UPDATE outfit_wears SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
    values
  );

  // Reconcile wear counts on affected items if item_ids changed
  if (parsed.data.item_ids) {
    const oldSet = new Set(existing.item_ids);
    const newSet = new Set(parsed.data.item_ids);
    const added = parsed.data.item_ids.filter((i) => !oldSet.has(i));
    const removed = existing.item_ids.filter((i) => !newSet.has(i));

    if (added.length) {
      await query(
        `UPDATE items SET times_worn = times_worn + 1, last_worn_at = now()
         WHERE id = ANY($1::uuid[])`,
        [added]
      );
    }
    if (removed.length) {
      // Floor at 0 so we don't end up with negative wear counts on edge cases
      await query(
        `UPDATE items SET times_worn = GREATEST(times_worn - 1, 0)
         WHERE id = ANY($1::uuid[])`,
        [removed]
      );
    }
  }

  return NextResponse.json({ ok: true });
}

// ---- DELETE /api/wears/[id] ---------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await authOrFail())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const existing = await queryOne<{ item_ids: string[]; photo_path: string | null }>(
    `SELECT item_ids, photo_path FROM outfit_wears WHERE id = $1`,
    [id]
  );
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  await query(`DELETE FROM outfit_wears WHERE id = $1`, [id]);

  // Decrement wear counts on the items, floored at 0
  if (existing.item_ids.length) {
    await query(
      `UPDATE items SET times_worn = GREATEST(times_worn - 1, 0)
       WHERE id = ANY($1::uuid[])`,
      [existing.item_ids]
    );
  }

  // Best-effort cleanup of the photo file
  if (existing.photo_path) {
    await deleteFile(existing.photo_path).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export const runtime = 'nodejs';
