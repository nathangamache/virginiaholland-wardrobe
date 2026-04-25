'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import {
  savePending,
  getPending,
  deletePending,
  newPendingId,
  type PendingItem,
} from '@/lib/pending-store';

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';

interface Tagged {
  category: Category;
  sub_category: string;
  colors: string[];
  brand_guess: string | null;
  material: string | null;
  pattern: string | null;
  style_tags: string[];
  season_tags: string[];
  warmth_score: number;
  formality_score: number;
  name: string;
  notes: string | null;
}

const CATEGORIES: Category[] = ['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory'];
const SEASONS = ['spring', 'summer', 'fall', 'winter'];

function NewItemInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  const [processing, setProcessing] = useState<null | 'ai' | 'save'>(null);
  const [aiDone, setAiDone] = useState(false);

  const [meta, setMeta] = useState<
    Partial<Tagged> & {
      brand?: string | null;
      favorite?: boolean;
      acquired_from?: string;
    }
  >({
    style_tags: [],
    season_tags: [],
    colors: [],
  });
  const [error, setError] = useState<string | null>(null);

  // ---- On mount, check for a resume query param ----
  useEffect(() => {
    const resumeId = searchParams.get('pending');
    if (!resumeId) return;

    (async () => {
      setResuming(true);
      try {
        const existing = await getPending(resumeId);
        if (!existing) {
          setResuming(false);
          return;
        }

        setPendingId(existing.id);
        if (existing.originalBlob) {
          setOriginalBlob(existing.originalBlob);
          setOriginalUrl(URL.createObjectURL(existing.originalBlob));
        }
        setMeta({
          name: existing.meta.name ?? undefined,
          category: existing.meta.category as Category | undefined,
          sub_category: existing.meta.sub_category ?? undefined,
          brand: existing.meta.brand ?? undefined,
          material: existing.meta.material ?? undefined,
          pattern: existing.meta.pattern ?? undefined,
          colors: existing.meta.colors ?? [],
          style_tags: existing.meta.style_tags ?? [],
          season_tags: existing.meta.season_tags ?? [],
          warmth_score: existing.meta.warmth_score ?? undefined,
          formality_score: existing.meta.formality_score ?? undefined,
          notes: existing.meta.notes ?? undefined,
          favorite: existing.meta.favorite ?? false,
          acquired_from: existing.meta.acquired_from ?? undefined,
        });
        if (existing.meta.category) setAiDone(true);
      } catch (e) {
        console.error('resume failed', e);
      } finally {
        setResuming(false);
      }
    })();
  }, [searchParams]);

  // Persist to pending store whenever meta changes (debounced 400ms)
  useEffect(() => {
    if (!pendingId || !originalBlob) return;
    const handle = setTimeout(() => {
      persistPending();
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  async function persistPending(overrides?: Partial<PendingItem>) {
    if (!pendingId || !originalBlob) return;
    try {
      await savePending({
        id: pendingId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: aiDone ? 'ready' : 'partial',
        originalBlob,
        nobgBlob: null,
        meta: {
          name: meta.name ?? undefined,
          brand: meta.brand ?? null,
          category: meta.category,
          sub_category: meta.sub_category ?? null,
          colors: meta.colors ?? [],
          style_tags: meta.style_tags ?? [],
          season_tags: meta.season_tags ?? [],
          material: meta.material ?? null,
          pattern: meta.pattern ?? null,
          warmth_score: meta.warmth_score ?? null,
          formality_score: meta.formality_score ?? null,
          notes: meta.notes ?? null,
          favorite: !!meta.favorite,
          acquired_from: meta.acquired_from ?? null,
        },
        ...overrides,
      });
    } catch (e) {
      console.warn('failed to persist pending', e);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const newId = newPendingId();
    setPendingId(newId);
    setOriginalBlob(file);
    setOriginalUrl(URL.createObjectURL(file));
    setAiDone(false);

    try {
      await savePending({
        id: newId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'processing',
        originalBlob: file,
        nobgBlob: null,
        meta: {},
      });
    } catch (e) {
      console.warn('could not save pending', e);
    }

    runTagging(file);
  }

  async function runTagging(file: Blob) {
    setProcessing('ai');
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/ai/tag-item', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `AI tagging failed (${res.status})`);
      }
      const json = await res.json();
      const t: Tagged = json.tagged;
      setMeta((m) => ({
        ...m,
        category: t.category,
        sub_category: t.sub_category,
        colors: t.colors ?? [],
        brand: t.brand_guess ?? m.brand,
        material: t.material ?? m.material,
        pattern: t.pattern ?? m.pattern,
        style_tags: t.style_tags ?? [],
        season_tags: t.season_tags ?? [],
        warmth_score: t.warmth_score,
        formality_score: t.formality_score,
        name: t.name,
        notes: t.notes,
      }));
      setAiDone(true);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Auto-tagging failed. You can fill in details manually.');
      setAiDone(true); // unblock the UI so user can save
    } finally {
      setProcessing((p) => (p === 'ai' ? null : p));
    }
  }

  async function save() {
    if (!originalBlob || !meta.category) {
      setError('Need a photo and a category.');
      return;
    }
    setProcessing('save');
    setError(null);
    try {
      const form = new FormData();
      form.append('original', originalBlob, 'original.jpg');
      form.append(
        'meta',
        JSON.stringify({
          category: meta.category,
          sub_category: meta.sub_category ?? null,
          name: meta.name ?? null,
          brand: meta.brand ?? null,
          material: meta.material ?? null,
          pattern: meta.pattern ?? null,
          colors: meta.colors ?? [],
          style_tags: meta.style_tags ?? [],
          season_tags: meta.season_tags ?? [],
          warmth_score: meta.warmth_score ?? null,
          formality_score: meta.formality_score ?? null,
          favorite: !!meta.favorite,
          notes: meta.notes ?? null,
          acquired_from: meta.acquired_from ?? null,
        })
      );
      const res = await fetch('/api/items', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `Save failed (${res.status})`);
      }

      if (pendingId) {
        try {
          await deletePending(pendingId);
        } catch (e) {
          console.warn('could not clear pending', e);
        }
      }
      router.push('/closet');
    } catch (e: any) {
      setError(e.message || 'Save failed. Try again.');
      setProcessing(null);
    }
  }

  async function discard() {
    if (!confirm('Discard this upload? It will be gone for good.')) return;
    if (pendingId) {
      try {
        await deletePending(pendingId);
      } catch (e) {
        console.warn(e);
      }
    }
    router.push('/closet');
  }

  function toggleTag(field: 'style_tags' | 'season_tags', value: string) {
    const current = (meta[field] ?? []) as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setMeta({ ...meta, [field]: next });
  }

  const aiSpinning = processing === 'ai' || (originalBlob && !aiDone);

  return (
    <div className="px-6 py-8 pb-24 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="eyebrow mb-1">Add a piece</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">Add to closet</h1>
        </div>
        <button
          onClick={() => (originalBlob ? discard() : router.push('/closet'))}
          className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </div>

      {resuming && (
        <div className="card-pink p-4 mb-6 text-sm text-ink-800">
          Restoring your in-progress upload…
        </div>
      )}

      {!originalBlob ? (
        <div>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-pink-300 p-12 text-center hover:border-pink-500 hover:bg-pink-50 transition-colors"
            style={{ borderRadius: '4px' }}
          >
            <div className="wordmark italic text-2xl text-pink-500 mb-1">Choose a photo</div>
            <div className="text-xs text-ink-400 tracking-wide">JPG, PNG, HEIC, AVIF…</div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif,.avif,.tiff,.tif"
            className="hidden"
            onChange={onFileChange}
          />
          {error && <p className="mt-4 text-sm text-pink-700">{error}</p>}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="card aspect-square bg-pink-50 overflow-hidden">
              {originalUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={originalUrl} alt="" className="w-full h-full object-contain" />
              )}
            </div>
            <div className="flex gap-2 text-[10px] uppercase tracking-[0.15em] text-ink-400">
              <div className={aiDone ? 'text-pink-700' : 'text-ink-400'}>
                {aiDone ? '✓' : '•'} Auto-tagged
              </div>
              <span>·</span>
              <div className="text-ink-400">
                • Background removed on save
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {aiSpinning ? (
              <div className="text-sm text-ink-400">Reading your piece…</div>
            ) : (
              <>
                <div>
                  <label className="label block mb-2">Name</label>
                  <input
                    value={meta.name ?? ''}
                    onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                    className="input"
                    placeholder="Give it a short name"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setMeta({ ...meta, category: c })}
                        className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                          meta.category === c
                            ? 'bg-pink-500 text-white border-pink-500'
                            : 'border-pink-200 text-ink-600 hover:border-pink-400'
                        }`}
                        style={{ borderRadius: '2px' }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label block mb-2">Brand</label>
                    <input
                      value={meta.brand ?? ''}
                      onChange={(e) => setMeta({ ...meta, brand: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label block mb-2">Acquired from</label>
                    <input
                      value={meta.acquired_from ?? ''}
                      onChange={(e) => setMeta({ ...meta, acquired_from: e.target.value })}
                      className="input"
                      placeholder="retail, thrift, gift…"
                    />
                  </div>
                </div>

                <div>
                  <label className="label block mb-2">Seasons</label>
                  <div className="flex flex-wrap gap-2">
                    {SEASONS.map((s) => {
                      const on = meta.season_tags?.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleTag('season_tags', s)}
                          className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                            on
                              ? 'bg-pink-500 text-white border-pink-500'
                              : 'border-pink-200 text-ink-600 hover:border-pink-400'
                          }`}
                          style={{ borderRadius: '2px' }}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!meta.favorite}
                      onChange={(e) => setMeta({ ...meta, favorite: e.target.checked })}
                      className="accent-pink-500"
                    />
                    <span className="text-sm">Favorite</span>
                  </label>
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    onClick={save}
                    disabled={processing === 'save' || !meta.category}
                    className="btn flex-1 disabled:opacity-50"
                  >
                    {processing === 'save' ? 'Saving…' : 'Save to closet'}
                  </button>
                  <button
                    onClick={discard}
                    className="btn-ghost"
                    style={{ color: '#9a1040', borderColor: '#f7a8be' }}
                  >
                    Discard
                  </button>
                </div>

                {error && <p className="text-sm text-pink-700">{error}</p>}

                <p className="text-[10px] uppercase tracking-[0.2em] text-ink-400 pt-2">
                  Auto-saves as you work — safe to leave and come back
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewItemPage() {
  return (
    <Suspense fallback={null}>
      <NewItemInner />
    </Suspense>
  );
}
