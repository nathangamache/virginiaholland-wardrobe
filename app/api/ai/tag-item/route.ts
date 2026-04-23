import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { tagItemImage } from '@/lib/anthropic';

export async function POST(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const image = form.get('image') as File | null;
  if (!image) {
    return NextResponse.json({ error: 'missing image' }, { status: 400 });
  }

  const buf = Buffer.from(await image.arrayBuffer());
  const base64 = buf.toString('base64');

  // Anthropic accepts only these four image MIME types. If the browser
  // reports anything else (HEIC/AVIF/TIFF/unknown), we default to JPEG —
  // client-side normalization should have already re-encoded to JPEG.
  const ANTHROPIC_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const mediaType = ANTHROPIC_TYPES.has(image.type) ? image.type : 'image/jpeg';

  try {
    const tagged = await tagItemImage(base64, mediaType);
    return NextResponse.json({ tagged });
  } catch (e: any) {
    console.error('tag-item error', e);
    return NextResponse.json({ error: 'tagging failed', detail: e.message }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const maxDuration = 60;
