import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

// Open-Meteo geocoding, no API key required.
// https://open-meteo.com/en/docs/geocoding-api

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', q);
  url.searchParams.set('count', '6');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) return NextResponse.json({ results: [] });
  const json = await res.json();

  const results = (json.results ?? []).map((r: any) => ({
    name: r.name,
    admin1: r.admin1,
    country: r.country,
    country_code: r.country_code,
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    population: r.population ?? 0,
  }));

  return NextResponse.json({ results });
}
