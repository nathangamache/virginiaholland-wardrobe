import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readBuffer, contentTypeFor, etagFor } from '@/lib/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new NextResponse('unauthorized', { status: 401 });
  }

  const { path: parts } = await params;
  if (!parts || parts.length < 3) {
    return new NextResponse('not found', { status: 404 });
  }

  // Path shape: <kind>/<userId>/<file>
  // The session's userId must match the path's userId.
  const [, userIdInPath] = parts;
  if (userIdInPath !== session.userId) {
    return new NextResponse('forbidden', { status: 403 });
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

  // Node Buffer is typed as Buffer<ArrayBufferLike> which includes
  // SharedArrayBuffer and so fails strict BodyInit/BlobPart checks.
  // Copy into a fresh Uint8Array (backed by a plain ArrayBuffer) to satisfy.
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
