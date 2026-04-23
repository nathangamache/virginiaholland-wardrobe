import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getForecast } from '@/lib/weather';
import { planPacking } from '@/lib/anthropic';

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const trips = await query(
    `SELECT id, name, destination, start_date, end_date, occasions,
            selected_item_ids, generated_outfits, weather_forecast, notes, created_at
     FROM trips ORDER BY start_date DESC`,
    []
  );
  return NextResponse.json({ trips });
}

const createSchema = z.object({
  name: z.string().min(1),
  destination: z.string().min(1),
  destination_lat: z.number(),
  destination_lon: z.number(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  occasions: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
  generate: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const t = parsed.data;

  const daysBetween = Math.ceil(
    (new Date(t.end_date).getTime() - new Date(t.start_date).getTime()) / 86400000
  ) + 1;

  let forecast: any = null;
  let generated: any = null;
  try {
    const full = await getForecast(t.destination_lat, t.destination_lon, Math.min(daysBetween + 2, 16));
    forecast = full.filter((d) => d.date >= t.start_date && d.date <= t.end_date);
  } catch (e) {
    console.error('forecast fetch failed', e);
  }

  if (t.generate && forecast?.length) {
    const items = await query(
      `SELECT id, category, sub_category, colors, style_tags, season_tags,
              warmth_score, formality_score, brand, name, occupies_slots
       FROM items`,
      []
    );
    try {
      generated = await planPacking(JSON.stringify(items), {
        destination: t.destination,
        days: forecast.map((d: any) => ({
          date: d.date,
          temp_min_f: d.temp_min_f,
          temp_max_f: d.temp_max_f,
          summary: d.summary,
          precip_chance: d.precip_chance,
        })),
        occasions: t.occasions,
      });
    } catch (e) {
      console.error('packing plan failed', e);
    }
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO trips (
       name, destination, destination_lat, destination_lon,
       start_date, end_date, occasions, selected_item_ids,
       generated_outfits, weather_forecast, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      t.name,
      t.destination,
      t.destination_lat,
      t.destination_lon,
      t.start_date,
      t.end_date,
      t.occasions,
      generated?.selected_item_ids ?? [],
      generated ? JSON.stringify(generated) : null,
      forecast ? JSON.stringify(forecast) : null,
      t.notes ?? null,
    ]
  );

  return NextResponse.json({ id: row!.id, generated });
}

export const runtime = 'nodejs';
export const maxDuration = 120;
