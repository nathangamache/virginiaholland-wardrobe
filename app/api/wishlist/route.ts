import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const rows = await query(
    `SELECT * FROM wishlist WHERE user_id = $1 ORDER BY priority DESC, created_at DESC`,
    [session.userId]
  );
  return NextResponse.json({ wishlist: rows });
}

const createSchema = z.object({
  description: z.string().min(1),
  category: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  suggested_by_ai: z.boolean().optional().default(false),
  link: z.string().url().nullable().optional().or(z.literal('')),
  brand_suggestions: z.array(z.string()).optional().default([]),
  price_range: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(5).optional().default(3),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const d = parsed.data;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO wishlist (user_id, description, category, reason, suggested_by_ai,
       link, brand_suggestions, price_range, priority, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      session.userId,
      d.description,
      d.category ?? null,
      d.reason ?? null,
      d.suggested_by_ai ?? false,
      d.link || null,
      d.brand_suggestions ?? [],
      d.price_range ?? null,
      d.priority ?? 3,
      d.notes ?? null,
    ]
  );
  return NextResponse.json({ id: row!.id });
}

export async function DELETE(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  await query(`DELETE FROM wishlist WHERE id = $1 AND user_id = $2`, [id, session.userId]);
  return NextResponse.json({ ok: true });
}
