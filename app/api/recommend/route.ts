import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getForecast } from '@/lib/weather';
import { generateCandidates, filterForContext, currentSeason, type Item } from '@/lib/outfit-engine';
import { rankOutfits } from '@/lib/anthropic';

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

  const candidates = generateCandidates(
    filtered,
    { temp_avg_f: today.temp_avg_f, precip_chance: today.precip_chance, season, occasion },
    40
  );

  if (!candidates.length) {
    return NextResponse.json({
      weather: today,
      ranked: [],
      candidates: [],
      message: 'Not enough items to build an outfit yet. Add more pieces to your closet.',
    });
  }

  let ranked: Array<{ id: string; score: number; reasoning: string }> = [];
  try {
    ranked = await rankOutfits(
      candidates,
      {
        temp_avg_f: today.temp_avg_f,
        summary: today.summary,
        precip_chance: today.precip_chance,
        occasion,
      },
      3
    );
  } catch (e) {
    console.error('rank error', e);
    // Fall back to first 3 candidates with no reasoning
    ranked = candidates.slice(0, 3).map((c) => ({ id: c.id, score: 50, reasoning: '' }));
  }

  const candidateMap = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const results = ranked
    .map((r) => ({ ...r, outfit: candidateMap[r.id] }))
    .filter((r) => r.outfit);

  return NextResponse.json({ weather: today, season, results });
}

export const runtime = 'nodejs';
export const maxDuration = 60;
