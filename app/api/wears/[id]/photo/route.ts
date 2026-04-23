import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { saveBuffer, deleteFile } from '@/lib/storage';
import { processJpeg } from '@/lib/image';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const existing = await queryOne<{ photo_path: string | null }>(
    `SELECT photo_path FROM outfit_wears WHERE id = $1 AND user_id = $2`,
    [id, session.userId]
  );
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const form = await req.formData();
  const photo = form.get('photo') as File | null;
  if (!photo) return NextResponse.json({ error: 'missing photo' }, { status: 400 });

  const buf = Buffer.from(await photo.arrayBuffer());
  const processed = await processJpeg(buf, { maxW: 1600, maxH: 1600, quality: 85 });
  const photoPath = await saveBuffer('wears', session.userId, processed.buffer, 'jpg');

  await query(
    `UPDATE outfit_wears SET photo_path = $1 WHERE id = $2 AND user_id = $3`,
    [photoPath, id, session.userId]
  );

  // Clean up the old one
  if (existing.photo_path) await deleteFile(existing.photo_path);

  return NextResponse.json({ photo_path: photoPath });
}

export const runtime = 'nodejs';
export const maxDuration = 30;
