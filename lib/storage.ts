import path from 'path';
import fs from 'fs/promises';
import { createHash, randomBytes } from 'crypto';

/**
 * Storage layout (relative to APP_ROOT):
 *   storage/images/items/<userId>/<id>.png      -- original upload
 *   storage/images/items-nobg/<userId>/<id>.png -- background removed (PNG with transparency)
 *   storage/images/thumbs/<userId>/<id>.jpg     -- small JPEG preview
 *   storage/images/wears/<userId>/<id>.jpg
 *   storage/images/wishlist/<userId>/<id>.jpg
 *
 * We store RELATIVE paths in the database (e.g. "items/<userId>/<id>.png") and
 * serve them through an authenticated /api/images/[...path] route so nothing
 * is publicly accessible even if someone guesses a URL.
 */

function appRoot(): string {
  const root = process.env.APP_ROOT;
  if (!root) throw new Error('APP_ROOT env var is required');
  return root;
}

export function storageRoot(): string {
  return path.join(appRoot(), 'storage', 'images');
}

export function absoluteFromRelative(relativePath: string): string {
  // Prevent path traversal attempts
  const normalized = path.posix.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  if (normalized.includes('..')) {
    throw new Error('Invalid path');
  }
  return path.join(storageRoot(), normalized);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function newId(): string {
  return randomBytes(16).toString('hex');
}

type Kind = 'items' | 'items-nobg' | 'thumbs' | 'wears' | 'wishlist';

export async function saveBuffer(
  kind: Kind,
  userId: string,
  buffer: Buffer,
  ext: 'png' | 'jpg' | 'webp'
): Promise<string> {
  const id = newId();
  const relative = path.posix.join(kind, userId, `${id}.${ext}`);
  const absolute = absoluteFromRelative(relative);
  await ensureDir(path.dirname(absolute));
  await fs.writeFile(absolute, buffer);
  return relative;
}

export async function saveBufferAtPath(relativePath: string, buffer: Buffer): Promise<void> {
  const absolute = absoluteFromRelative(relativePath);
  await ensureDir(path.dirname(absolute));
  await fs.writeFile(absolute, buffer);
}

export async function readBuffer(relativePath: string): Promise<Buffer> {
  return fs.readFile(absoluteFromRelative(relativePath));
}

export async function deleteFile(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  try {
    await fs.unlink(absoluteFromRelative(relativePath));
  } catch {
    // ignore missing files
  }
}

export function contentTypeFor(relativePath: string): string {
  if (relativePath.endsWith('.png')) return 'image/png';
  if (relativePath.endsWith('.jpg') || relativePath.endsWith('.jpeg')) return 'image/jpeg';
  if (relativePath.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export function etagFor(buffer: Buffer): string {
  return `"${createHash('sha1').update(buffer).digest('hex')}"`;
}
