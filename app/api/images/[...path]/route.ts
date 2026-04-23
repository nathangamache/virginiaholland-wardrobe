import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readBuffer, contentTypeFor, etagFor } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    await requireSession();
  } catch {
    return new NextResponse('unauthorized', { status: 401 });
  }

  const { path: parts } = await params;
  if (!parts || parts.length < 2) {
    return new NextResponse('not found', { status: 404 });
  }

  const rel = parts.join('/');
  let buf: Buffer;
  try {
    buf = await readBuffer(rel);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }

  const etag = etagFor(buf);
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304 });
  }

  // Copy into a fresh Uint8Array to satisfy BodyInit typing
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'content-type': contentTypeFor(rel),
      'cache-control': 'private, max-age=31536000, immutable',
      etag,
    },
  });
}
