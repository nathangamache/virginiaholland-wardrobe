import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { findProductsForSuggestion } from '@/lib/anthropic';

const bodySchema = z.object({
  description: z.string().min(1),
  category: z.string().min(1),
  reason: z.string().nullable().optional(),
  brand_suggestions: z.array(z.string()).optional().default([]),
  price_range: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input', detail: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await findProductsForSuggestion(parsed.data);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('find-products error', e);
    return NextResponse.json({ error: 'product search failed', detail: e.message }, { status: 500 });
  }
}

export const runtime = 'nodejs';
// Web search can take a while when making multiple tool calls
export const maxDuration = 120;
