/**
 * In-process cache for "Today's picks" recommendations.
 *
 * The recommendation flow calls Anthropic Sonnet to rank candidate outfits,
 * which takes 5-15s and costs real tokens per request. Recommendations
 * don't meaningfully change minute-to-minute, so we cache the response
 * and serve it for several hours.
 *
 * Single-user app: one global cache entry. For multi-user this would need
 * to be per-user-keyed.
 *
 * Cache lives in-process — survives across HTTP requests but resets on a
 * pm2 restart, which is fine; the next call just regenerates.
 */

interface CachedRec {
  generatedAt: number;
  response: Record<string, unknown>;
}

let _cache: CachedRec | null = null;

const TTL_MS = parseInt(
  process.env.RECOMMEND_CACHE_TTL_MS ?? `${6 * 60 * 60 * 1000}`,
  10
);

export function getCached(): { response: Record<string, unknown>; generatedAt: number } | null {
  if (!_cache) return null;
  if (Date.now() - _cache.generatedAt > TTL_MS) {
    _cache = null;
    return null;
  }
  return { response: _cache.response, generatedAt: _cache.generatedAt };
}

export function setCached(response: Record<string, unknown>): void {
  _cache = { generatedAt: Date.now(), response };
}

export function clearCache(): void {
  _cache = null;
}

export function getTtlMs(): number {
  return TTL_MS;
}
