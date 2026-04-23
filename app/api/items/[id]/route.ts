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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await authOrFail();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const item = await queryOne(
    `SELECT * FROM items WHERE id = $1 AND user_id = $2`,
    [id, session.userId]
  );
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ item });
}

const patchSchema = z.object({
  category: z.enum(['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory']).optional(),
  sub_category: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  pattern: z.string().nullable().optional(),
  colors: z.array(z.string()).optional(),
  style_tags: z.array(z.string()).optional(),
  season_tags: z.array(z.string()).optional(),
  warmth_score: z.number().int().min(1).max(5).nullable().optional(),
  formality_score: z.number().int().min(1).max(5).nullable().optional(),
  favorite: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  acquired_from: z.string().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await authOrFail();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return NextResponse.json({ ok: true });

  const sets: string[] = [];
  const values: any[] = [];
  fields.forEach(([k, v], i) => {
    sets.push(`${k} = $${i + 1}`);
    values.push(v);
  });

  // If category changed to/from 'dress', keep occupies_slots in sync
  if (parsed.data.category) {
    sets.push(`occupies_slots = $${values.length + 1}`);
    values.push(parsed.data.category === 'dress' ? ['shirt', 'pants'] : []);
  }

  values.push(id, session.userId);
  const result = await queryOne(
    `UPDATE items SET ${sets.join(', ')}
     WHERE id = $${values.length - 1} AND user_id = $${values.length}
     RETURNING id`,
    values
  );
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await authOrFail();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const item = await queryOne<{ image_path: string; image_nobg_path: string | null; thumb_path: string | null }>(
    `SELECT image_path, image_nobg_path, thumb_path FROM items
     WHERE id = $1 AND user_id = $2`,
    [id, session.userId]
  );
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await query(`DELETE FROM items WHERE id = $1 AND user_id = $2`, [id, session.userId]);
  await Promise.all([
    deleteFile(item.image_path),
    deleteFile(item.image_nobg_path),
    deleteFile(item.thumb_path),
  ]);
  return NextResponse.json({ ok: true });
}
