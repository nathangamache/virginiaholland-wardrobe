'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

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

export default function NewItemPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [nobgBlob, setNobgBlob] = useState<Blob | null>(null);
  const [nobgUrl, setNobgUrl] = useState<string | null>(null);

  const [processing, setProcessing] = useState<null | 'bg' | 'ai' | 'save'>(null);
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

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setOriginalBlob(file);
    setOriginalUrl(URL.createObjectURL(file));
    setNobgBlob(null);
    setNobgUrl(null);

    // Kick off bg removal and AI tagging in parallel
    runBackgroundRemoval(file);
    runTagging(file);
  }

  async function runBackgroundRemoval(file: Blob) {
    setProcessing('bg');
    try {
      const { removeBackgroundClean } = await import('@/lib/bg-removal');
      const blob = await removeBackgroundClean(file);
      setNobgBlob(blob);
      setNobgUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      console.error('BG removal failed', e);
      setError('Background removal failed. You can still save with just the original photo.');
    } finally {
      setProcessing((p) => (p === 'bg' ? null : p));
    }
  }

  async function runTagging(file: Blob) {
    setProcessing((p) => p ?? 'ai');
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/ai/tag-item', { method: 'POST', body: form });
      if (!res.ok) throw new Error('tagging failed');
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
    } catch (e) {
      console.error(e);
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
    try {
      const form = new FormData();
      form.append('original', originalBlob, 'original.jpg');
      if (nobgBlob) form.append('nobg', nobgBlob, 'nobg.png');
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
      if (!res.ok) throw new Error('save failed');
      router.push('/closet');
    } catch (e) {
      setError('Save failed. Try again.');
      setProcessing(null);
    }
  }

  function toggleTag(field: 'style_tags' | 'season_tags', value: string) {
    const current = (meta[field] ?? []) as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setMeta({ ...meta, [field]: next });
  }

  const preview = nobgUrl ?? originalUrl;

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <div className="eyebrow mb-1">New piece</div>
        <h1 className="font-display text-4xl leading-tight">Add to closet</h1>
      </div>

      {/* Photo area */}
      <div className="card aspect-square mb-6 relative overflow-hidden bg-ivory-100">
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="w-full h-full object-contain" />
            <button
              onClick={() => {
                setOriginalBlob(null);
                setOriginalUrl(null);
                setNobgBlob(null);
                setNobgUrl(null);
                setMeta({ style_tags: [], season_tags: [], colors: [] });
              }}
              className="absolute top-3 right-3 w-8 h-8 bg-ivory-50/90 flex items-center justify-center"
              aria-label="Remove photo"
            >
              <X className="w-4 h-4" />
            </button>
            {processing === 'bg' && (
              <div className="absolute inset-0 bg-ivory-50/80 flex items-center justify-center">
                <div className="text-center">
                  <div className="eyebrow mb-2">Processing</div>
                  <div className="font-display text-lg">Removing background…</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full h-full flex flex-col items-center justify-center gap-3 text-ink-400 hover:text-ink-600 transition-colors"
          >
            <div className="font-display text-3xl">+</div>
            <div className="text-xs uppercase tracking-[0.2em]">Take or upload photo</div>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      {error && <div className="text-sm text-clay-700 mb-4">{error}</div>}

      {/* Metadata form */}
      {(originalUrl || processing === 'ai') && (
        <div className="space-y-6 animate-fade-up">
          {processing === 'ai' && (
            <div className="text-xs text-ink-400 uppercase tracking-[0.2em]">AI is tagging…</div>
          )}

          <Field label="Name">
            <input
              value={meta.name ?? ''}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              className="input"
              placeholder="e.g. cream silk blouse"
            />
          </Field>

          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setMeta({ ...meta, category: c })}
                  className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                    meta.category === c
                      ? 'bg-ink-900 text-ivory-50 border-ink-900'
                      : 'bg-transparent text-ink-600 border-ivory-300 hover:border-ink-400'
                  }`}
                  style={{ borderRadius: '2px' }}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Sub-category">
              <input
                value={meta.sub_category ?? ''}
                onChange={(e) => setMeta({ ...meta, sub_category: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Brand">
              <input
                value={meta.brand ?? ''}
                onChange={(e) => setMeta({ ...meta, brand: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Material">
              <input
                value={meta.material ?? ''}
                onChange={(e) => setMeta({ ...meta, material: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Pattern">
              <input
                value={meta.pattern ?? ''}
                onChange={(e) => setMeta({ ...meta, pattern: e.target.value })}
                className="input"
              />
            </Field>
          </div>

          <Field label="Colors">
            <div className="flex flex-wrap gap-2 items-center">
              {(meta.colors ?? []).map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 border border-ivory-300 px-2 py-1"
                  style={{ borderRadius: '2px' }}
                >
                  <div className="w-4 h-4 border border-ivory-300" style={{ background: c }} />
                  <span className="text-xs font-mono">{c}</span>
                  <button
                    onClick={() =>
                      setMeta({ ...meta, colors: meta.colors!.filter((_, j) => j !== i) })
                    }
                    className="text-ink-400 hover:text-ink-900 ml-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <input
                type="color"
                onChange={(e) => setMeta({ ...meta, colors: [...(meta.colors ?? []), e.target.value] })}
                className="w-8 h-8 border border-ivory-300 cursor-pointer"
                style={{ borderRadius: '2px' }}
              />
            </div>
          </Field>

          <Field label="Seasons">
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleTag('season_tags', s)}
                  className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                    meta.season_tags?.includes(s)
                      ? 'bg-ink-900 text-ivory-50 border-ink-900'
                      : 'bg-transparent text-ink-600 border-ivory-300'
                  }`}
                  style={{ borderRadius: '2px' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Warmth (1–5)">
              <ScoreInput
                value={meta.warmth_score ?? null}
                onChange={(v) => setMeta({ ...meta, warmth_score: v })}
              />
            </Field>
            <Field label="Formality (1–5)">
              <ScoreInput
                value={meta.formality_score ?? null}
                onChange={(v) => setMeta({ ...meta, formality_score: v })}
              />
            </Field>
          </div>

          <Field label="Style tags">
            <input
              value={(meta.style_tags ?? []).join(', ')}
              onChange={(e) =>
                setMeta({
                  ...meta,
                  style_tags: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="input"
              placeholder="casual, minimalist, elevated"
            />
          </Field>

          <Field label="Acquired from">
            <div className="flex gap-2 flex-wrap">
              {['retail', 'thrifted', 'vintage', 'gift', 'secondhand'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setMeta({ ...meta, acquired_from: s })}
                  className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                    meta.acquired_from === s
                      ? 'bg-ink-900 text-ivory-50 border-ink-900'
                      : 'bg-transparent text-ink-600 border-ivory-300'
                  }`}
                  style={{ borderRadius: '2px' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Notes">
            <textarea
              value={meta.notes ?? ''}
              onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
              className="input min-h-[80px] resize-none"
            />
          </Field>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!meta.favorite}
              onChange={(e) => setMeta({ ...meta, favorite: e.target.checked })}
              className="accent-ink-900"
            />
            <span className="text-sm">Favorite</span>
          </label>

          <button
            onClick={save}
            disabled={processing === 'save' || !meta.category}
            className="btn w-full disabled:opacity-50"
          >
            {processing === 'save' ? 'Saving…' : 'Save to closet'}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {children}
    </div>
  );
}

function ScoreInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`flex-1 py-2 text-sm border transition-all ${
            value === n
              ? 'bg-ink-900 text-ivory-50 border-ink-900'
              : 'bg-transparent text-ink-600 border-ivory-300 hover:border-ink-400'
          }`}
          style={{ borderRadius: '2px' }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
