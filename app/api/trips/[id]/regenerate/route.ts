import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getForecast } from '@/lib/weather';
import { planPacking } from '@/lib/anthropic';

/**
 * POST /api/trips/[id]/regenerate
 *
 * Re-runs the AI packing plan for an existing trip. Pulls the latest forecast
 * (in case the original failed or has been refreshed) and re-runs Sonnet over
 * the user's current closet. Saves the new generated_outfits and bumps
 * updated_at. Returns the new generated payload so the client can
 * immediately display it.
 *
 * Used both for retry-on-failure and for "the closet has changed, give me
 * fresh suggestions."
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const trip = await queryOne<{
    destination: string;
    destination_lat: number;
    destination_lon: number;
    start_date: string;
    end_date: string;
    occasions: string[];
  }>(
    `SELECT destination, destination_lat, destination_lon,
            start_date, end_date, occasions
     FROM trips WHERE id = $1`,
    [id]
  );
  if (!trip) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const startMs = new Date(trip.start_date).getTime();
  const endMs = new Date(trip.end_date).getTime();
  const daysBetween = Math.ceil((endMs - startMs) / 86400000) + 1;

  let forecast: any = null;
  try {
    const full = await getForecast(
      trip.destination_lat,
      trip.destination_lon,
      Math.min(daysBetween + 2, 16)
    );
    forecast = full.filter(
      (d: any) => d.date >= trip.start_date && d.date <= trip.end_date
    );
  } catch (e) {
    console.error('[trips/regenerate] forecast failed', e);
    return NextResponse.json(
      { error: 'Could not fetch weather forecast for the destination.' },
      { status: 502 }
    );
  }

  if (!forecast?.length) {
    return NextResponse.json(
      { error: 'No forecast available for the trip dates. Try a closer-in trip.' },
      { status: 400 }
    );
  }

  const items = await query(
    `SELECT id, category, sub_category, colors, style_tags, season_tags,
            warmth_score, formality_score, brand, name, occupies_slots
     FROM items`,
    []
  );

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'No items in your closet yet. Add some pieces first.' },
      { status: 400 }
    );
  }

  let generated: any;
  try {
    generated = await planPacking(JSON.stringify(items), {
      destination: trip.destination,
      days: forecast.map((d: any) => ({
        date: d.date,
        temp_min_f: d.temp_min_f,
        temp_max_f: d.temp_max_f,
        summary: d.summary,
        precip_chance: d.precip_chance,
      })),
      occasions: trip.occasions,
    });
  } catch (e: any) {
    console.error('[trips/regenerate] planPacking failed', e);
    return NextResponse.json(
      { error: e?.message ?? 'Packing plan generation failed.' },
      { status: 502 }
    );
  }

  await queryOne(
    `UPDATE trips
       SET generated_outfits = $1,
           weather_forecast = $2,
           selected_item_ids = $3,
           updated_at = now()
     WHERE id = $4
     RETURNING id`,
    [
      JSON.stringify(generated),
      JSON.stringify(forecast),
      generated?.selected_item_ids ?? [],
      id,
    ]
  );

  return NextResponse.json({ generated, forecast });
}

export const runtime = 'nodejs';
export const maxDuration = 120;
