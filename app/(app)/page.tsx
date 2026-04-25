'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { ItemCard } from '@/components/ItemCard';
import { useDialog } from '@/components/DialogProvider';

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
  cached?: boolean;
  cached_at?: number;
  cache_ttl_ms?: number;
}

interface ItemLookup {
  [id: string]: {
    thumb_path: string | null;
    image_nobg_path: string | null;
    image_path: string | null;
  };
}

export default function HomePage() {
  const { alert } = useDialog();
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [itemLookup, setItemLookup] = useState<ItemLookup>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingIdx, setLoggingIdx] = useState<number | null>(null);

  // sessionStorage keys — survive across same-tab navigations but reset on
  // tab close. Not localStorage because we don't want stale data lingering
  // across days; sessionStorage gives us a clean wipe when the tab closes.
  const SS_REC_KEY = 'wardrobe:home:rec';
  const SS_ITEMS_KEY = 'wardrobe:home:itemLookup';

  /**
   * Hydrate from sessionStorage if available so navigation back to the home
   * page is instant. We then re-validate against the server in the
   * background; if the server response differs, we silently update.
   *
   * The combination of (a) server-side cache returning instantly when it's
   * warm and (b) client-side sessionStorage means navigations feel
   * instantaneous and Anthropic only gets called once per cache TTL window.
   */
  async function load(forceRefresh = false) {
    // Try to hydrate from session cache first
    let hadCache = false;
    if (!forceRefresh && typeof window !== 'undefined') {
      try {
        const cachedRec = sessionStorage.getItem(SS_REC_KEY);
        const cachedItems = sessionStorage.getItem(SS_ITEMS_KEY);
        if (cachedRec && cachedItems) {
          setData(JSON.parse(cachedRec));
          setItemLookup(JSON.parse(cachedItems));
          setLoading(false);
          hadCache = true;
        }
      } catch (e) {
        // Corrupt session storage — ignore and refetch
      }
    }

    const recUrl = forceRefresh ? '/api/recommend?refresh=1' : '/api/recommend';
    const [recRes, itemsRes] = await Promise.all([
      fetch(recUrl).then((r) => r.json()),
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

    // Persist for the next navigation
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(SS_REC_KEY, JSON.stringify(recRes));
        sessionStorage.setItem(SS_ITEMS_KEY, JSON.stringify(lookup));
      } catch (e) {
        // sessionStorage full or unavailable — non-fatal
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshPicks() {
    setRefreshing(true);
    try {
      // Clear both client and server caches, then regenerate fresh.
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem(SS_REC_KEY);
          sessionStorage.removeItem(SS_ITEMS_KEY);
        } catch {}
      }
      await fetch('/api/recommend', { method: 'DELETE' });
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

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
    await alert({
      title: 'Outfit logged',
      body: "Add a mirror photo on the Outfits tab anytime.",
    });
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
          <div className="flex items-baseline justify-between">
            <div>
              <div className="eyebrow">— Three for you —</div>
              {data.cached && data.cached_at && (
                <div className="text-[10px] uppercase tracking-[0.15em] text-ink-400 mt-1">
                  Generated {timeAgoShort(data.cached_at)} ago
                </div>
              )}
            </div>
            <button
              onClick={refreshPicks}
              disabled={refreshing}
              className="btn-ghost py-1.5 px-3 text-xs disabled:opacity-50"
              title="Force re-generation of today's picks"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh picks'}
            </button>
          </div>
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
              <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-3 mb-3">
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

/**
 * Compact "5m", "2h", "1d" relative time format. We don't import date-fns
 * for this single use because the formatting is trivial and the abbreviations
 * fit better in our minimal eyebrow style than full sentences.
 */
function timeAgoShort(timestamp: number): string {
  const elapsedMs = Date.now() - timestamp;
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
