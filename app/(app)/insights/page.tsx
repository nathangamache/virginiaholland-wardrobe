'use client';

import { useEffect, useState } from 'react';
import { ItemCard } from '@/components/ItemCard';

interface InsightsData {
  totals: { total: number; favorites: number };
  category_counts: Array<{ category: string; count: number }>;
  wear_stats: { total_wears: number; worn_items: number; unworn_items: number; avg_wears: number };
  most_worn: any[];
  never_worn: any[];
  dormant: any[];
  color_buckets: Array<{ label: string; hex: string; count: number }>;
  brands: Array<{ brand: string; count: number }>;
  acquired: Array<{ acquired_from: string; count: number }>;
  formality: Array<{ score: number; count: number }>;
  warmth: Array<{ score: number; count: number }>;
  streak_days: number;
}

export default function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/insights')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading || !data) {
    return <div className="px-6 py-8 text-ink-400">Reading the closet…</div>;
  }

  if (data.totals.total === 0) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <h1 className="font-display text-4xl mb-4">Insights</h1>
        <p className="text-sm text-ink-600">Add some pieces first and the numbers will appear.</p>
      </div>
    );
  }

  const totalCategorized = data.category_counts.reduce((s, c) => s + c.count, 0) || 1;
  const totalColors = data.color_buckets.reduce((s, c) => s + c.count, 0) || 1;
  const mostWornMax = Math.max(1, ...data.most_worn.map((m: any) => m.times_worn));

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-12">
      {/* Hero stats */}
      <section>
        <div className="eyebrow mb-1">Insights</div>
        <h1 className="wordmark italic text-5xl leading-none text-ink-900 mb-6">The closet, in numbers</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ivory-200 border border-ivory-200">
          <Stat label="Pieces" value={data.totals.total} />
          <Stat label="Favorites" value={data.totals.favorites} />
          <Stat label="Total wears" value={data.wear_stats.total_wears} />
          <Stat label="Streak" value={`${data.streak_days}d`} />
        </div>
      </section>

      {/* Category breakdown as a bar chart */}
      <section>
        <div className="eyebrow mb-3">Composition</div>
        <div className="card p-6 space-y-3">
          {data.category_counts.map((c) => (
            <div key={c.category} className="flex items-center gap-3">
              <div className="w-24 text-sm capitalize text-ink-600">{c.category}</div>
              <div className="flex-1 h-6 bg-ivory-100 relative overflow-hidden" style={{ borderRadius: '2px' }}>
                <div
                  className="h-full bg-ink-900 transition-all"
                  style={{ width: `${(c.count / totalCategorized) * 100}%` }}
                />
              </div>
              <div className="w-10 text-right font-mono text-xs text-ink-600">{c.count}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Color distribution */}
      <section>
        <div className="eyebrow mb-3">Color palette</div>
        <div className="card p-6">
          <div className="flex h-10 overflow-hidden" style={{ borderRadius: '2px' }}>
            {data.color_buckets.map((b) => (
              <div
                key={b.label}
                title={`${b.label} · ${b.count}`}
                style={{
                  background: b.hex,
                  width: `${(b.count / totalColors) * 100}%`,
                  minWidth: 4,
                }}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {data.color_buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-2 text-xs">
                <div className="w-4 h-4 border border-ivory-300" style={{ background: b.hex }} />
                <span className="capitalize text-ink-600">{b.label}</span>
                <span className="text-ink-400 ml-auto font-mono">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Most worn */}
      {data.most_worn.length > 0 && (
        <section>
          <div className="eyebrow mb-3">Worn most</div>
          <div className="space-y-3">
            {data.most_worn.map((m: any) => (
              <div key={m.id} className="flex items-center gap-4 card p-3">
                <div className="w-16 h-16 bg-ivory-100 flex-shrink-0">
                  {m.thumb_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/images/${m.thumb_path}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-base truncate">
                    {m.name ?? m.sub_category ?? m.category}
                  </div>
                  <div className="text-xs text-ink-400">
                    {m.brand ?? '—'} · worn {m.times_worn} time{m.times_worn === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="w-32 h-2 bg-ivory-100 relative overflow-hidden" style={{ borderRadius: '2px' }}>
                  <div
                    className="h-full bg-ink-900"
                    style={{ width: `${(m.times_worn / mostWornMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unworn pieces */}
      {data.never_worn.length > 0 && (
        <section>
          <div className="eyebrow mb-3">
            Never worn · {data.wear_stats.unworn_items} of {data.totals.total}
          </div>
          <p className="text-sm text-ink-600 mb-4">
            Pieces still waiting for their first wear. Worth rediscovering.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {data.never_worn.map((i: any) => (
              <ItemCard key={i.id} {...i} />
            ))}
          </div>
        </section>
      )}

      {/* Dormant */}
      {data.dormant.length > 0 && (
        <section>
          <div className="eyebrow mb-3">Not worn in 90+ days</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {data.dormant.map((i: any) => (
              <ItemCard key={i.id} {...i} />
            ))}
          </div>
        </section>
      )}

      {/* Brand + acquisition side by side */}
      <section className="grid md:grid-cols-2 gap-6">
        {data.brands.length > 0 && (
          <div>
            <div className="eyebrow mb-3">Top brands</div>
            <div className="card p-5 space-y-2.5">
              {data.brands.map((b) => (
                <div key={b.brand} className="flex justify-between items-center text-sm">
                  <span className="text-ink-800 truncate">{b.brand}</span>
                  <span className="text-ink-400 font-mono text-xs">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.acquired.length > 0 && (
          <div>
            <div className="eyebrow mb-3">How it was acquired</div>
            <div className="card p-5 space-y-3">
              {data.acquired.map((a) => (
                <div key={a.acquired_from}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-ink-800 capitalize">{a.acquired_from}</span>
                    <span className="text-ink-400 font-mono text-xs">{a.count}</span>
                  </div>
                  <div className="h-1.5 bg-ivory-100 overflow-hidden" style={{ borderRadius: '2px' }}>
                    <div
                      className="h-full bg-clay-500"
                      style={{ width: `${(a.count / data.totals.total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Formality + warmth histograms */}
      <section className="grid md:grid-cols-2 gap-6">
        <Histogram title="Formality" data={data.formality} />
        <Histogram title="Warmth" data={data.warmth} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-ivory-50 p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-display text-3xl leading-none">{value}</div>
    </div>
  );
}

function Histogram({ title, data }: { title: string; data: Array<{ score: number; count: number }> }) {
  const byScore: Record<number, number> = Object.fromEntries(data.map((d) => [d.score, d.count]));
  const counts = [1, 2, 3, 4, 5].map((s) => byScore[s] ?? 0);
  const max = Math.max(...counts, 1);
  const total = counts.reduce((a, b) => a + b, 0);

  const scales: Record<string, string[]> = {
    warmth: ['hot', 'warm', 'mild', 'cool', 'cold'],
    formality: ['lounge', 'casual', 'refined', 'formal', 'black tie'],
  };
  const labels = scales[title.toLowerCase()] ?? ['1', '2', '3', '4', '5'];

  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      <div className="card p-5">
        {total === 0 ? (
          <div className="h-32 flex items-center justify-center text-xs text-ink-400">
            No data yet
          </div>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {[1, 2, 3, 4, 5].map((s, i) => {
              const count = byScore[s] ?? 0;
              // Minimum visible height so 0-count bars still appear as faint placeholders
              const pct = count === 0 ? 0 : Math.max(8, (count / max) * 100);
              const isMax = count === max && count > 0;
              return (
                <div key={s} className="flex-1 flex flex-col items-center gap-1.5 h-full">
                  <div className={`text-[10px] font-mono ${count > 0 ? 'text-pink-700' : 'text-ink-400'}`}>
                    {count}
                  </div>
                  <div className="w-full flex-1 flex items-end relative">
                    {/* Faint background track so empty bars show the slot exists */}
                    <div
                      className="absolute inset-x-0 bottom-0 bg-pink-100"
                      style={{ height: '4px', borderRadius: '2px 2px 0 0' }}
                    />
                    {count > 0 && (
                      <div
                        className={`w-full transition-all relative ${isMax ? 'bg-pink-500' : 'bg-pink-300'}`}
                        style={{ height: `${pct}%`, borderRadius: '2px 2px 0 0' }}
                      />
                    )}
                  </div>
                  <div className={`text-[10px] uppercase tracking-[0.1em] ${count === max && count > 0 ? 'text-pink-700 font-medium' : 'text-ink-400'}`}>
                    {labels[i]}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
