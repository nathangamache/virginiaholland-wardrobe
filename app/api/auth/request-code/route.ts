import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import {
  isAllowed,
  generateCode,
  hashCode,
  checkAndIncrementRateLimit,
} from '@/lib/auth';
import { sendCodeEmail } from '@/lib/email';

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  const underLimit = await checkAndIncrementRateLimit(email);
  if (!underLimit) {
    return NextResponse.json({ ok: true }); // silent success
  }

  // Only actually send if allowlisted; respond identically either way.
  if (isAllowed(email)) {
    const code = generateCode();
    const hash = hashCode(code);
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    await query(
      `INSERT INTO auth_codes (email, code_hash, expires_at, ip)
       VALUES ($1, $2, $3, $4)`,
      [email, hash, expires, req.headers.get('x-forwarded-for') ?? null]
    );

    try {
      await sendCodeEmail(email, code);
    } catch (e) {
      console.error('Email send failed', e);
    }
  }

  return NextResponse.json({ ok: true });
}
