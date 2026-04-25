import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getForecast } from '@/lib/weather';
import { generateCandidates, filterForContext, currentSeason, type Item } from '@/lib/outfit-engine';
import { rankOutfits } from '@/lib/anthropic';
import { getCached, setCached, clearCache, getTtlMs } from '@/lib/recommend-cache';

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const lat = parseFloat(searchParams.get('lat') ?? process.env.DEFAULT_LATITUDE ?? '42.36669326272332');
  const lon = parseFloat(searchParams.get('lon') ?? process.env.DEFAULT_LONGITUDE ?? '-83.4927024486844');
  const occasion = searchParams.get('occasion');
  const skipCache = searchParams.get('refresh') === '1';

  // We only cache the default no-occasion case. If the user passes an
  // explicit occasion, regenerate fresh — those are typically one-off
  // requests that should reflect the exact context they asked for.
  const canCache = !occasion;

  if (canCache && !skipCache) {
    const cached = getCached();
    if (cached) {
      const ageMs = Date.now() - cached.generatedAt;
      console.log(
        `[recommend] cache HIT (age=${Math.round(ageMs / 1000)}s, ttl=${Math.round(getTtlMs() / 1000)}s)`
      );
      return NextResponse.json({
        ...cached.response,
        cached: true,
        cached_at: cached.generatedAt,
        cache_ttl_ms: getTtlMs(),
      });
    }
  }

  console.log(
    `[recommend] cache MISS (skipCache=${skipCache}, canCache=${canCache}); generating fresh`
  );

  const forecast = await getForecast(lat, lon, 1);
  const today = forecast[0];
  const season = currentSeason();

  const items = await query<Item>(
    `SELECT id, category, sub_category, occupies_slots, colors, style_tags, season_tags,
            warmth_score, formality_score, brand, name
     FROM items`,
    []
  );

  const filtered = filterForContext(items, {
    temp_avg_f: today.temp_avg_f,
    precip_chance: today.precip_chance,
    season,
    occasion,
  });

  const candidates = generateCandidates(filtered, {
    temp_avg_f: today.temp_avg_f,
    precip_chance: today.precip_chance,
    season,
    occasion,
  });

  if (!candidates.length) {
    const empty = {
      weather: today,
      ranked: [],
      candidates: [],
      message: 'Not enough items to build an outfit yet. Add more pieces to your closet.',
    };
    // Don't cache the empty state — user might add items moments later
    return NextResponse.json(empty);
  }

  let ranked: Array<{ id: string; score: number; reasoning: string }> = [];
  try {
    // Claude now returns ALL candidates ranked best-first; we apply the
    // display threshold below.
    ranked = await rankOutfits(candidates, {
      temp_avg_f: today.temp_avg_f,
      summary: today.summary,
      precip_chance: today.precip_chance,
      occasion,
    });
  } catch (e) {
    console.error('rank error', e);
    ranked = candidates.slice(0, 3).map((c) => ({ id: c.id, score: 50, reasoning: '' }));
  }

  // Sort by score descending so we know the order. (Claude is asked to return
  // them sorted but we sort here too as a safety net in case of model drift.)
  ranked.sort((a, b) => b.score - a.score);

  const QUALITY_THRESHOLD = 90;
  const MIN_RESULTS = 3;
  const MAX_RESULTS = 6;

  /**
   * Diversity-aware display selection.
   *
   * Without this, the top 3 would frequently be near-duplicates: same dress
   * with/without a wallet, or smocked-vs-strapless versions of the same
   * silhouette. Sonnet correctly identifies that these all "work" but the
   * user wants 3 distinct visual options, not 3 variations on a theme.
   *
   * Algorithm: walk the ranked list and pick options that share fewer than
   * MAX_OVERLAP items with anything already picked. If we run out of
   * sufficiently-different options to hit MIN_RESULTS, we fall back to
   * filling the remaining slots from the highest-scoring leftovers.
   */
  const candidateMap = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const MAX_OVERLAP = 2; // an outfit may share up to 2 items with one already-picked

  const aboveThreshold = ranked.filter((r) => r.score >= QUALITY_THRESHOLD);
  const pool = aboveThreshold.length >= MIN_RESULTS ? aboveThreshold : ranked;

  const picked: Array<{ id: string; score: number; reasoning: string }> = [];
  const skipped: Array<{ id: string; score: number; reasoning: string }> = [];

  function itemIdSet(outfitId: string): Set<string> {
    const c = candidateMap[outfitId];
    if (!c) return new Set();
    return new Set(c.items.map((i: { id: string }) => i.id));
  }

  function overlapWithPicked(outfitId: string): number {
    const myItems = itemIdSet(outfitId);
    let maxOverlap = 0;
    for (const p of picked) {
      const theirs = itemIdSet(p.id);
      let count = 0;
      for (const id of myItems) if (theirs.has(id)) count++;
      if (count > maxOverlap) maxOverlap = count;
    }
    return maxOverlap;
  }

  for (const r of pool) {
    if (picked.length >= MAX_RESULTS) break;
    if (picked.length === 0 || overlapWithPicked(r.id) <= MAX_OVERLAP) {
      picked.push(r);
    } else {
      skipped.push(r);
    }
  }

  // If diversity filtering left us short of MIN_RESULTS, top up from the
  // skipped pile (higher-scoring duplicates first). This keeps the floor at 3
  // even if the closet has limited variety.
  while (picked.length < MIN_RESULTS && skipped.length > 0) {
    picked.push(skipped.shift()!);
  }

  const results = picked
    .map((r) => ({ ...r, outfit: candidateMap[r.id] }))
    .filter((r) => r.outfit);

  console.log(
    `[recommend] ranked=${ranked.length}, above${QUALITY_THRESHOLD}=${aboveThreshold.length}, displaying=${results.length} (skipped ${skipped.length} for similarity)`
  );

  const response = { weather: today, season, results };

  if (canCache) {
    setCached(response);
    console.log('[recommend] cache SET');
  }

  return NextResponse.json({
    ...response,
    cached: false,
    cached_at: Date.now(),
    cache_ttl_ms: getTtlMs(),
  });
}

/**
 * Manually invalidate the cache. Used by the "Refresh picks" button on
 * the home page so the user can force a fresh generation.
 */
export async function DELETE() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  clearCache();
  return NextResponse.json({ ok: true });
}

export const runtime = 'nodejs';
export const maxDuration = 60;
