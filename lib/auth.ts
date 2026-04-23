import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'crypto';
import { query, queryOne } from './db';
import allowlist from './allowlist.json';

const COOKIE_NAME = 'wardrobe_session';
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS ?? '90', 10);

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUTH_SECRET is missing or too short (must be >= 32 chars)');
  }
  return new TextEncoder().encode(s);
}

// ---- Allowlist ---------------------------------------------------------

export function isAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (allowlist.emails as string[]).map((e) => e.toLowerCase()).includes(normalized);
}

// ---- Codes -------------------------------------------------------------

export function generateCode(): string {
  // 6-digit numeric code, leading zeros preserved
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

export function hashCode(code: string): string {
  return createHash('sha256')
    .update(code + (process.env.AUTH_SECRET ?? ''))
    .digest('hex');
}

// ---- Rate limiting -----------------------------------------------------

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX_ATTEMPTS = 5;

export async function checkAndIncrementRateLimit(email: string): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS);
  const row = await queryOne<{ attempts: number }>(
    `INSERT INTO auth_rate_limits (email, window_start, attempts)
     VALUES ($1, $2, 1)
     ON CONFLICT (email, window_start)
     DO UPDATE SET attempts = auth_rate_limits.attempts + 1
     RETURNING attempts`,
    [email.toLowerCase(), windowStart]
  );
  return (row?.attempts ?? 0) <= RATE_MAX_ATTEMPTS;
}

// ---- Session (JWT in cookie) ------------------------------------------

export interface Session {
  userId: string;
  email: string;
}

export async function createSession(userId: string, email: string): Promise<void> {
  const expSeconds = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const token = await new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expSeconds)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.email) return null;
    return { userId: payload.sub as string, email: payload.email as string };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error('Unauthorized');
  return s;
}

// ---- User helpers ------------------------------------------------------

export async function upsertUser(email: string): Promise<{ id: string; email: string }> {
  const normalized = email.trim().toLowerCase();
  const row = await queryOne<{ id: string; email: string }>(
    `INSERT INTO users (email, last_login_at)
     VALUES ($1, now())
     ON CONFLICT (email) DO UPDATE SET last_login_at = now()
     RETURNING id, email`,
    [normalized]
  );
  if (!row) throw new Error('Failed to upsert user');
  return row;
}
