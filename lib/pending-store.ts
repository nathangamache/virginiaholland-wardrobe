/**
 * Client-side persistence for in-progress closet uploads.
 *
 * Problem solved: previously, when a user uploaded a clothing item,
 * the background removal + AI tagging took 20-60 seconds. If they
 * navigated away before clicking Save, all that work was lost.
 *
 * Now every uploaded piece is immediately written to IndexedDB as
 * "pending" and stays there until it's either saved to the server
 * (which deletes the pending record) or explicitly discarded by
 * the user.
 *
 * A small wrapper around IndexedDB — we use it directly rather than
 * pulling in a library, since the API surface we need is tiny.
 */

const DB_NAME = 'wardrobe-pending';
const DB_VERSION = 1;
const STORE = 'items';

export interface PendingItem {
  id: string;                 // local uuid, not the server's
  createdAt: number;          // epoch ms
  updatedAt: number;
  status: 'processing' | 'ready' | 'partial'; // partial = bg done but tagging failed (or vice versa)
  originalBlob: Blob | null;  // normalized JPEG
  nobgBlob: Blob | null;      // PNG with transparent background
  meta: {
    name?: string;
    brand?: string | null;
    category?: string;
    sub_category?: string | null;
    colors?: string[];
    style_tags?: string[];
    season_tags?: string[];
    material?: string | null;
    pattern?: string | null;
    warmth_score?: number | null;
    formality_score?: number | null;
    notes?: string | null;
    favorite?: boolean;
    acquired_from?: string | null;
  };
  error?: string | null;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return _dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return getDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePending(item: PendingItem): Promise<void> {
  const store = await tx('readwrite');
  await wrap(store.put({ ...item, updatedAt: Date.now() }));
}

export async function getPending(id: string): Promise<PendingItem | null> {
  const store = await tx('readonly');
  const res = await wrap(store.get(id));
  return (res as PendingItem) ?? null;
}

export async function listPending(): Promise<PendingItem[]> {
  const store = await tx('readonly');
  const index = store.index('updatedAt');
  const res = await wrap(index.getAll());
  return (res as PendingItem[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePending(id: string): Promise<void> {
  const store = await tx('readwrite');
  await wrap(store.delete(id));
}

export async function countPending(): Promise<number> {
  const store = await tx('readonly');
  return wrap(store.count());
}

/**
 * Generate a new pending item id. Format: pnd_<timestamp>_<random>.
 */
export function newPendingId(): string {
  return `pnd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
