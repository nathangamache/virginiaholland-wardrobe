import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';

/**
 * PATCH /api/wishlist/[id]
 *
 * Partial update of a saved wishlist entry. All fields optional — only the
 * fields the user actually edits get sent.
 *
 * Returns { ok: true } on success or 404 if the entry doesn't exist.
 */
const patchSchema = z.object({
  description: z.string().min(1).optional(),
  category: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  link: z
    .union([z.string().url(), z.literal('')])
    .nullable()
    .optional(),
  brand_suggestions: z.array(z.string()).optional(),
  price_range: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
  } catch {
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
  if (fields.length === 0) return NextResponse.json({ ok: true });

  // Build dynamic UPDATE — same pattern used in /api/items/[id] and
  // /api/trips/[id], so behavior is consistent across the app.
  const sets: string[] = [];
  const values: any[] = [];
  fields.forEach(([k, v], i) => {
    sets.push(`${k} = $${i + 1}`);
    // Empty-string link should land as NULL so we don't render an "Open link"
    // button pointing at nothing.
    if (k === 'link' && v === '') values.push(null);
    else values.push(v);
  });
  values.push(id);

  const row = await queryOne<{ id: string }>(
    `UPDATE wishlist SET ${sets.join(', ')}
     WHERE id = $${values.length} RETURNING id`,
    values
  );
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export const runtime = 'nodejs';
