import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { hashCode, createSession, upsertUser, isAllowed } from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const code = parsed.data.code;

  if (!isAllowed(email)) {
    return NextResponse.json({ error: 'invalid code' }, { status: 401 });
  }

  const codeHash = hashCode(code);
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM auth_codes
     WHERE email = $1
       AND code_hash = $2
       AND expires_at > now()
       AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, codeHash]
  );

  if (!row) {
    return NextResponse.json({ error: 'invalid code' }, { status: 401 });
  }

  await query(`UPDATE auth_codes SET used_at = now() WHERE id = $1`, [row.id]);

  const user = await upsertUser(email);
  await createSession(user.id, user.email);

  return NextResponse.json({ ok: true });
}
