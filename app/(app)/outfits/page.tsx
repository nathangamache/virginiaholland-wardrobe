'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ItemCard } from '@/components/ItemCard';

export default function OutfitsPage() {
  const [wears, setWears] = useState<any[]>([]);
  const [itemLookup, setItemLookup] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  async function load() {
    const [wearsRes, itemsRes] = await Promise.all([
      fetch('/api/wears').then((r) => r.json()),
      fetch('/api/items').then((r) => r.json()),
    ]);
    setWears(wearsRes.wears ?? []);
    const lookup: Record<string, any> = {};
    for (const i of itemsRes.items ?? []) lookup[i.id] = i;
    setItemLookup(lookup);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addPhoto(wearId: string, file: File) {
    setUploadingFor(wearId);
    try {
      const { normalizeToJpeg } = await import('@/lib/normalize-image');
      const normalized = await normalizeToJpeg(file);
      const form = new FormData();
      form.append('photo', normalized);
      await fetch(`/api/wears/${wearId}/photo`, { method: 'POST', body: form });
    } catch (e) {
      console.error('photo upload failed', e);
    } finally {
      setUploadingFor(null);
      load();
    }
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <div className="eyebrow mb-1">Outfits worn</div>
        <h1 className="wordmark italic text-5xl leading-none text-ink-900">History</h1>
      </div>

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : wears.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-600 mb-4">
            No outfits logged yet. Pick one on the Today tab.
          </p>
          <Link href="/" className="btn">Today's picks</Link>
        </div>
      ) : (
        <div className="space-y-10">
          {wears.map((w) => (
            <div key={w.id} className="animate-fade-up">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-display text-xl">
                  {format(new Date(w.worn_on), 'MMMM d, yyyy')}
                </div>
                {w.weather_snapshot && (
                  <div className="text-xs text-ink-400">
                    {Math.round(w.weather_snapshot.temp_avg_f)}° · {w.weather_snapshot.summary}
                  </div>
                )}
              </div>

              {w.photo_path ? (
                <div className="mb-3 aspect-[3/4] max-w-xs bg-ivory-100 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/images/${w.photo_path}`} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <label className="mb-3 inline-flex items-center gap-2 btn-ghost cursor-pointer">
                  <input
                    type="file"
                    accept="image/*,.heic,.heif,.avif,.tiff,.tif"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) addPhoto(w.id, f);
                    }}
                  />
                  {uploadingFor === w.id ? 'Uploading…' : 'Add mirror photo'}
                </label>
              )}

              <div className="grid grid-cols-4 gap-2 md:gap-3">
                {(w.item_ids ?? []).map((iid: string) => {
                  const it = itemLookup[iid];
                  if (!it) {
                    return (
                      <div
                        key={iid}
                        className="aspect-square bg-ivory-200 flex items-center justify-center text-ink-400 text-xs"
                      >
                        (removed)
                      </div>
                    );
                  }
                  return <ItemCard key={iid} {...it} />;
                })}
              </div>

              {w.notes && (
                <p className="mt-3 text-sm text-ink-600 italic border-l border-ivory-300 pl-4">
                  {w.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
