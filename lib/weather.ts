import { query, queryOne } from './db';

export interface WeatherDay {
  date: string;
  temp_max_f: number;
  temp_min_f: number;
  temp_avg_f: number;
  precip_mm: number;
  precip_chance: number;
  wind_mph: number;
  weather_code: number;
  summary: string;
}

const WEATHER_CODE_SUMMARY: Record<number, string> = {
  0: 'clear',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'heavy showers',
  82: 'violent showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'severe thunderstorm',
};

export function summarizeCode(code: number): string {
  return WEATHER_CODE_SUMMARY[code] ?? 'unknown';
}

function cacheKey(lat: number, lon: number, days: number): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${lat.toFixed(3)},${lon.toFixed(3)}:${today}:${days}`;
}

export async function getForecast(
  lat: number,
  lon: number,
  days = 1
): Promise<WeatherDay[]> {
  const key = cacheKey(lat, lon, days);

  // Check cache (6 hour TTL)
  const cached = await queryOne<{ data: WeatherDay[]; fetched_at: Date }>(
    `SELECT data, fetched_at FROM weather_cache WHERE cache_key = $1`,
    [key]
  );
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 6 * 3600 * 1000) {
    return cached.data;
  }

  const tz = process.env.DEFAULT_TIMEZONE ?? 'America/Detroit';
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('timezone', tz);
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('precipitation_unit', 'mm');
  url.searchParams.set('forecast_days', String(Math.min(Math.max(days, 1), 16)));
  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
    ].join(',')
  );

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo error: ${res.status}`);
  }
  const json = await res.json();
  const daily = json.daily;

  const result: WeatherDay[] = daily.time.map((date: string, i: number) => ({
    date,
    temp_max_f: daily.temperature_2m_max[i],
    temp_min_f: daily.temperature_2m_min[i],
    temp_avg_f: daily.temperature_2m_mean[i],
    precip_mm: daily.precipitation_sum[i] ?? 0,
    precip_chance: daily.precipitation_probability_max?.[i] ?? 0,
    wind_mph: daily.wind_speed_10m_max[i],
    weather_code: daily.weather_code[i],
    summary: summarizeCode(daily.weather_code[i]),
  }));

  await query(
    `INSERT INTO weather_cache (cache_key, data, fetched_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (cache_key) DO UPDATE
       SET data = EXCLUDED.data, fetched_at = now()`,
    [key, JSON.stringify(result)]
  );

  return result;
}

// Map avg temp to a 1-5 warmth requirement for clothing
export function warmthNeededFor(tempF: number): number {
  if (tempF >= 80) return 1; // light
  if (tempF >= 65) return 2;
  if (tempF >= 50) return 3;
  if (tempF >= 35) return 4;
  return 5; // very warm
}
