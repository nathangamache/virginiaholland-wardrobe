import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getForecast } from '@/lib/weather';

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const lat = parseFloat(searchParams.get('lat') ?? process.env.DEFAULT_LATITUDE ?? '42.36669326272332');
  const lon = parseFloat(searchParams.get('lon') ?? process.env.DEFAULT_LONGITUDE ?? '-83.4927024486844');
  const days = parseInt(searchParams.get('days') ?? '1', 10);

  const forecast = await getForecast(lat, lon, days);
  return NextResponse.json({ forecast });
}
