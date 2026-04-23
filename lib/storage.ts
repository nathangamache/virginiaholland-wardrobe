import path from 'path';
import fs from 'fs/promises';
import { createHash, randomBytes } from 'crypto';

/**
 * Storage layout (relative to $APP_ROOT/storage/images/):
 *
 *   items/<id>.jpg         -- original upload (normalized)
 *   items-nobg/<id>.png    -- background-removed PNG
 *   thumbs/<id>.jpg        -- square JPEG preview
 *   wears/<id>.jpg         -- outfit wear photos
 *   wishlist/<id>.jpg      -- wishlist images (optional)
 *
 * Files are served through /api/images/[...path] which gates on session only
 * (no per-user scoping — it's a single closet).
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
  buffer: Buffer,
  ext: 'png' | 'jpg' | 'webp'
): Promise<string> {
  const id = newId();
  const relative = path.posix.join(kind, `${id}.${ext}`);
  const absolute = absoluteFromRelative(relative);
  await ensureDir(path.dirname(absolute));
  await fs.writeFile(absolute, buffer);
  return relative;
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
