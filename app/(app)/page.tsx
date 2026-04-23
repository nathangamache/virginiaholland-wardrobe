'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ItemCard } from '@/components/ItemCard';

interface WeatherDay {
  temp_avg_f: number;
  temp_min_f: number;
  temp_max_f: number;
  summary: string;
  precip_chance: number;
}

interface Recommendation {
  id: string;
  score: number;
  reasoning: string;
  outfit: {
    id: string;
    items: Array<{
      id: string;
      category: string;
      sub_category: string | null;
      name: string | null;
      brand: string | null;
    }>;
  };
}

interface RecommendResponse {
  weather: WeatherDay;
  season?: string;
  results?: Recommendation[];
  message?: string;
}

interface ItemLookup {
  [id: string]: {
    thumb_path: string | null;
    image_nobg_path: string | null;
    image_path: string | null;
  };
}

export default function HomePage() {
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [itemLookup, setItemLookup] = useState<ItemLookup>({});
  const [loading, setLoading] = useState(true);
  const [loggingIdx, setLoggingIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [recRes, itemsRes] = await Promise.all([
        fetch('/api/recommend').then((r) => r.json()),
        fetch('/api/items').then((r) => r.json()),
      ]);
      setData(recRes);
      const lookup: ItemLookup = {};
      for (const it of itemsRes.items ?? []) {
        lookup[it.id] = {
          thumb_path: it.thumb_path,
          image_nobg_path: it.image_nobg_path,
          image_path: it.image_path,
        };
      }
      setItemLookup(lookup);
      setLoading(false);
    })();
  }, []);

  async function logWear(rec: Recommendation, idx: number) {
    setLoggingIdx(idx);
    const today = new Date().toISOString().slice(0, 10);
    await fetch('/api/wears', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item_ids: rec.outfit.items.map((i) => i.id),
        worn_on: today,
        weather_snapshot: data?.weather,
      }),
    });
    setLoggingIdx(null);
    alert('Logged. Add a mirror photo on the Outfits tab anytime.');
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <section className="mb-10 animate-fade-up">
        <div className="eyebrow mb-2">— Today —</div>
        {loading ? (
          <div className="wordmark text-3xl italic text-pink-300">Reading the forecast…</div>
        ) : data?.weather ? (
          <div>
            <h1 className="wordmark italic text-5xl md:text-6xl leading-[1.05] text-ink-900">
              {Math.round(data.weather.temp_avg_f)}°,{' '}
              <span className="text-pink-500">{data.weather.summary}</span>.
            </h1>
            <p className="mt-3 text-sm text-ink-600">
              Range {Math.round(data.weather.temp_min_f)}–{Math.round(data.weather.temp_max_f)}°F
              {data.weather.precip_chance > 20 && <> · {data.weather.precip_chance}% precip</>}
            </p>
          </div>
        ) : null}
      </section>

      {!loading && data?.message && (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-600 mb-4">{data.message}</p>
          <Link href="/closet/new" className="btn">Add an item</Link>
        </div>
      )}

      {!loading && data?.results && data.results.length > 0 && (
        <div className="space-y-10">
          <div className="eyebrow">— Three for you —</div>
          {data.results.map((rec, idx) => (
            <div key={rec.id} className="animate-fade-up" style={{ animationDelay: `${idx * 120}ms` }}>
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-display text-xl">Option {idx + 1}</div>
                <button
                  onClick={() => logWear(rec, idx)}
                  disabled={loggingIdx === idx}
                  className="btn-ghost py-1.5 px-3 text-xs"
                >
                  {loggingIdx === idx ? 'Logging…' : 'Wear this'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 md:gap-3 mb-3">
                {rec.outfit.items.map((it) => {
                  const meta = itemLookup[it.id];
                  return (
                    <ItemCard
                      key={it.id}
                      id={it.id}
                      category={it.category}
                      sub_category={it.sub_category}
                      name={it.name}
                      brand={it.brand}
                      thumb_path={meta?.thumb_path}
                      image_nobg_path={meta?.image_nobg_path}
                      image_path={meta?.image_path}
                    />
                  );
                })}
              </div>
              {rec.reasoning && (
                <p className="text-sm text-ink-600 leading-relaxed italic border-l border-ivory-300 pl-4 py-1">
                  {rec.reasoning}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
