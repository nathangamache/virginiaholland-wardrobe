import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ---- Totals and category breakdown ------------------------------
  const totals = await queryOne<{ total: string; favorites: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE favorite = TRUE)::text AS favorites
     FROM items`,
    []
  );

  const categoryCounts = await query<{ category: string; count: string }>(
    `SELECT category, count(*)::text
     FROM items
     GROUP BY category
     ORDER BY count(*) DESC`,
    []
  );

  // ---- Wear stats -------------------------------------------------
  const wearStats = await queryOne<{
    total_wears: string;
    worn_items: string;
    unworn_items: string;
    avg_wears: string | null;
  }>(
    `SELECT
       coalesce(sum(times_worn), 0)::text AS total_wears,
       count(*) FILTER (WHERE times_worn > 0)::text AS worn_items,
       count(*) FILTER (WHERE times_worn = 0)::text AS unworn_items,
       avg(times_worn)::text AS avg_wears
     FROM items`,
    []
  );

  const mostWorn = await query(
    `SELECT id, name, brand, sub_category, category, thumb_path, image_nobg_path,
            times_worn, last_worn_at
     FROM items WHERE times_worn > 0
     ORDER BY times_worn DESC
     LIMIT 6`,
    []
  );

  const neverWorn = await query(
    `SELECT id, name, brand, sub_category, category, thumb_path, image_nobg_path,
            created_at
     FROM items WHERE times_worn = 0
     ORDER BY created_at ASC
     LIMIT 12`,
    []
  );

  const dormant = await query(
    `SELECT id, name, brand, sub_category, category, thumb_path, image_nobg_path,
            last_worn_at
     FROM items
     WHERE last_worn_at IS NOT NULL
       AND last_worn_at < now() - interval '90 days'
     ORDER BY last_worn_at ASC
     LIMIT 12`,
    []
  );

  // ---- Color distribution -----------------------------------------
  const colorRows = await query<{ colors: string[] }>(
    `SELECT colors FROM items WHERE array_length(colors, 1) > 0`,
    []
  );
  const colorBuckets = bucketColors(colorRows.map((r) => r.colors[0]).filter(Boolean));

  // ---- Brand breakdown --------------------------------------------
  const brands = await query<{ brand: string; count: string }>(
    `SELECT brand, count(*)::text
     FROM items
     WHERE brand IS NOT NULL AND brand <> ''
     GROUP BY brand
     ORDER BY count(*) DESC
     LIMIT 10`,
    []
  );

  // ---- Acquisition mix --------------------------------------------
  const acquired = await query<{ acquired_from: string; count: string }>(
    `SELECT coalesce(acquired_from, 'unknown') AS acquired_from, count(*)::text
     FROM items
     GROUP BY coalesce(acquired_from, 'unknown')
     ORDER BY count(*) DESC`,
    []
  );

  // ---- Formality / warmth histograms ------------------------------
  const formality = await query<{ score: number; count: string }>(
    `SELECT formality_score AS score, count(*)::text
     FROM items
     WHERE formality_score IS NOT NULL
     GROUP BY formality_score
     ORDER BY formality_score`,
    []
  );
  const warmth = await query<{ score: number; count: string }>(
    `SELECT warmth_score AS score, count(*)::text
     FROM items
     WHERE warmth_score IS NOT NULL
     GROUP BY warmth_score
     ORDER BY warmth_score`,
    []
  );

  // ---- Wear streak -----------------------------------------------
  const recentWornDays = await query<{ worn_on: string }>(
    `SELECT DISTINCT worn_on::text
     FROM outfit_wears
     ORDER BY worn_on DESC
     LIMIT 60`,
    []
  );
  const streak = calcStreak(recentWornDays.map((r) => r.worn_on));

  return NextResponse.json({
    totals: {
      total: parseInt(totals?.total ?? '0', 10),
      favorites: parseInt(totals?.favorites ?? '0', 10),
    },
    category_counts: categoryCounts.map((c) => ({
      category: c.category,
      count: parseInt(c.count, 10),
    })),
    wear_stats: {
      total_wears: parseInt(wearStats?.total_wears ?? '0', 10),
      worn_items: parseInt(wearStats?.worn_items ?? '0', 10),
      unworn_items: parseInt(wearStats?.unworn_items ?? '0', 10),
      avg_wears: wearStats?.avg_wears ? parseFloat(wearStats.avg_wears) : 0,
    },
    most_worn: mostWorn,
    never_worn: neverWorn,
    dormant,
    color_buckets: colorBuckets,
    brands: brands.map((b) => ({ brand: b.brand, count: parseInt(b.count, 10) })),
    acquired: acquired.map((a) => ({
      acquired_from: a.acquired_from,
      count: parseInt(a.count, 10),
    })),
    formality: formality.map((f) => ({ score: f.score, count: parseInt(f.count, 10) })),
    warmth: warmth.map((w) => ({ score: w.score, count: parseInt(w.count, 10) })),
    streak_days: streak,
  });
}

// ---- helpers ---- (unchanged from v1)

interface ColorBucket { label: string; hex: string; count: number; }

function bucketColors(hexes: string[]): ColorBucket[] {
  const buckets: Record<string, ColorBucket> = {
    black:   { label: 'black',   hex: '#1a1a1a', count: 0 },
    white:   { label: 'white',   hex: '#f5f3f0', count: 0 },
    gray:    { label: 'gray',    hex: '#8a8275', count: 0 },
    cream:   { label: 'cream',   hex: '#e8dcc2', count: 0 },
    brown:   { label: 'brown',   hex: '#7a4f3a', count: 0 },
    tan:     { label: 'tan',     hex: '#c9a88a', count: 0 },
    red:     { label: 'red',     hex: '#a03838', count: 0 },
    pink:    { label: 'pink',    hex: '#d4a0a8', count: 0 },
    orange:  { label: 'orange',  hex: '#c8794a', count: 0 },
    yellow:  { label: 'yellow',  hex: '#d4b560', count: 0 },
    green:   { label: 'green',   hex: '#7d8a6a', count: 0 },
    teal:    { label: 'teal',    hex: '#5a8588', count: 0 },
    blue:    { label: 'blue',    hex: '#4a6a8a', count: 0 },
    purple:  { label: 'purple',  hex: '#7a5a8a', count: 0 },
  };
  for (const hex of hexes) {
    const k = classifyColor(hex);
    if (buckets[k]) buckets[k].count++;
  }
  return Object.values(buckets).filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
}

function classifyColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'gray';
  const { r, g, b } = rgb;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (l < 0.12) return 'black';
  if (l > 0.88 && s < 0.15) return 'white';
  if (s < 0.12) return 'gray';
  if (s < 0.25 && l > 0.75) return 'cream';
  if (h >= 15 && h < 45 && s < 0.45 && l < 0.55) return 'brown';
  if (h >= 20 && h < 50 && s < 0.5 && l >= 0.55) return 'tan';
  if (h < 15 || h >= 345) return s > 0.4 && l < 0.65 ? 'red' : 'pink';
  if (h < 40) return 'orange';
  if (h < 65) return 'yellow';
  if (h < 170) return 'green';
  if (h < 200) return 'teal';
  if (h < 260) return 'blue';
  if (h < 340) return 'purple';
  return 'pink';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function calcStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const set = new Set(dates);
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (!set.has(d.toISOString().slice(0, 10))) {
    d.setDate(d.getDate() - 1);
  }
  while (set.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
