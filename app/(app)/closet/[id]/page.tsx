'use client';

import { useEffect, useRef, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Check, Camera } from 'lucide-react';
import { useDialog } from '@/components/DialogProvider';

const STYLE_TAG_SUGGESTIONS = [
  'casual', 'minimalist', 'classic', 'elevated', 'edgy',
  'romantic', 'sporty', 'preppy', 'bohemian', 'parisian',
  'loungewear', 'formal', 'workwear',
];

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';
const CATEGORIES: Category[] = [
  'shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory',
];

export default function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { confirm } = useDialog();
  const photoFileRef = useRef<HTMLInputElement>(null);
  const [item, setItem] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Photo replacement state — separate from metadata save state because the
  // user might want to replace the photo independently of editing tags.
  const [replacingPhoto, setReplacingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Cache-bust query param that flips after a photo replace, so the new image
  // shows immediately instead of being served from the browser's old cache
  // for the same /api/images URL.
  const [photoVersion, setPhotoVersion] = useState(0);

  useEffect(() => {
    fetch(`/api/items/${id}`)
      .then((r) => r.json())
      .then((j) => setItem(j.item));
  }, [id]);

  async function save() {
    setSaving(true);
    setSaveState('idle');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: item.category,
          name: item.name,
          brand: item.brand,
          sub_category: item.sub_category,
          material: item.material,
          pattern: item.pattern,
          favorite: item.favorite,
          notes: item.notes,
          style_tags: item.style_tags,
          season_tags: item.season_tags,
          warmth_score: item.warmth_score,
          formality_score: item.formality_score,
          colors: item.colors,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setSaveState('saved');
      // Clear the "Saved ✓" indicator after a moment
      setTimeout(() => setSaveState('idle'), 2400);
    } catch (e: any) {
      setSaveState('error');
      setErrorMsg(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Remove this piece?',
      body: 'It will be deleted from your closet permanently. This cannot be undone.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/items/${id}`, { method: 'DELETE' });
    router.push('/closet');
  }

  /**
   * Replace the photo. Uploads the file, server re-runs bg removal, swaps
   * stored images, and we update local state so the new image shows.
   */
  async function replacePhoto(file: File) {
    setReplacingPhoto(true);
    setPhotoError(null);
    try {
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`/api/items/${id}/photo`, {
        method: 'PATCH',
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `Upload failed (${res.status})`);
      }
      const json = await res.json();

      // Preload the new image before we swap it in. Without this, the
      // "Replacing photo…" overlay disappears but the <img> still briefly
      // shows the old photo while the new one is loading from the server.
      const newImageUrl: string | null =
        json.urls.nobg ?? json.urls.original ?? null;
      if (newImageUrl) {
        await preloadImage(newImageUrl).catch(() => {});
      }

      setItem({
        ...item,
        image_path: json.paths.original,
        image_nobg_path: json.paths.nobg,
        thumb_path: json.paths.thumb,
      });
      // Cache-bust so the browser fetches the new image even though we may
      // technically have a different URL anyway (paths regenerate per upload).
      setPhotoVersion((v) => v + 1);
      if (!json.nobg_succeeded) {
        setPhotoError(
          'Photo replaced, but background removal failed. The original photo is being used.'
        );
      }
    } catch (e: any) {
      setPhotoError(e?.message ?? 'Could not replace photo. Try again.');
    } finally {
      setReplacingPhoto(false);
    }
  }

  function onPhotoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void replacePhoto(file);
    // Reset the input so picking the same file twice in a row still triggers change
    e.target.value = '';
  }

  /**
   * Preload an image so it's decoded and cached before we update state,
   * so the UI doesn't briefly show the old photo while the new one loads.
   */
  function preloadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to preload ${src}`));
      img.src = src;
    });
  }

  if (!item) return <div className="px-6 py-8 text-ink-400">Loading…</div>;

  const imgSrc = item.image_nobg_path ?? item.image_path;

  return (
    <div className="px-6 py-8 pb-24 max-w-2xl mx-auto">
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => router.push('/closet')}
          className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="card aspect-square mb-3 bg-pink-50 overflow-hidden relative group">
        {imgSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${imgSrc}${photoVersion ? `?v=${photoVersion}` : ''}`}
            alt={item.name ?? ''}
            className="w-full h-full object-contain"
          />
        )}

        {/* Replace photo button — overlays the image; tap-friendly on mobile,
            shows on hover on desktop */}
        {!replacingPhoto && (
          <button
            onClick={() => photoFileRef.current?.click()}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-2 bg-white/90 backdrop-blur-sm text-ink-800 hover:bg-white text-[10px] uppercase tracking-[0.15em] shadow-sm transition-all [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
            style={{ borderRadius: '2px' }}
          >
            <Camera className="w-3 h-3" />
            Replace
          </button>
        )}

        {/* Processing overlay */}
        {replacingPhoto && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
            <div className="text-center">
              <div className="text-pink-700 wordmark italic text-lg animate-pulse mb-1">
                Replacing photo…
              </div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500">
                Removing background
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input for photo replacement */}
      <input
        ref={photoFileRef}
        type="file"
        accept="image/*,.heic,.heif,.avif,.tiff,.tif"
        className="hidden"
        onChange={onPhotoFileChange}
      />

      {/* Photo replacement error/warning */}
      {photoError && (
        <div className="card-pink p-3 mb-3 text-xs text-ink-800">
          {photoError}
        </div>
      )}

      <div className="space-y-5 mt-3">
        {/* Name */}
        <div>
          <input
            value={item.name ?? ''}
            onChange={(e) => setItem({ ...item, name: e.target.value })}
            className="wordmark italic text-3xl bg-transparent border-b border-transparent hover:border-pink-200 focus:border-pink-500 focus:outline-none w-full text-ink-900"
            placeholder="Name…"
          />
        </div>

        {/* Category — editable so a mistagged item can be reassigned */}
        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setItem({ ...item, category: c })}
                className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                  item.category === c
                    ? 'bg-pink-500 text-white border-pink-500'
                    : 'border-pink-200 text-ink-600 hover:border-pink-400'
                }`}
                style={{ borderRadius: '2px' }}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand">
            <input
              value={item.brand ?? ''}
              onChange={(e) => setItem({ ...item, brand: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Sub-category">
            <input
              value={item.sub_category ?? ''}
              onChange={(e) => setItem({ ...item, sub_category: e.target.value })}
              className="input"
              placeholder="e.g. crew tee, ankle boots"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Material">
            <input
              value={item.material ?? ''}
              onChange={(e) => setItem({ ...item, material: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Pattern">
            <input
              value={item.pattern ?? ''}
              onChange={(e) => setItem({ ...item, pattern: e.target.value })}
              className="input"
              placeholder="solid, striped, floral…"
            />
          </Field>
        </div>

        {/* Colors — editable */}
        <Field label="Colors">
          <ColorEditor
            colors={item.colors ?? []}
            onChange={(colors) => setItem({ ...item, colors })}
          />
        </Field>

        {/* Seasons */}
        <Field label="Seasons">
          <div className="flex flex-wrap gap-2">
            {['spring', 'summer', 'fall', 'winter'].map((s) => {
              const on = item.season_tags?.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? item.season_tags.filter((x: string) => x !== s)
                      : [...(item.season_tags ?? []), s];
                    setItem({ ...item, season_tags: next });
                  }}
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
        </Field>

        {/* Style tags */}
        <Field label="Style tags">
          <TagEditor
            tags={item.style_tags ?? []}
            suggestions={STYLE_TAG_SUGGESTIONS}
            onChange={(style_tags) => setItem({ ...item, style_tags })}
          />
        </Field>

        {/* Formality + warmth */}
        <div className="grid grid-cols-2 gap-6">
          <Field label={`Formality — ${formalityLabel(item.formality_score)}`}>
            <ScoreSlider
              value={item.formality_score}
              onChange={(v) => setItem({ ...item, formality_score: v })}
            />
          </Field>
          <Field label={`Warmth — ${warmthLabel(item.warmth_score)}`}>
            <ScoreSlider
              value={item.warmth_score}
              onChange={(v) => setItem({ ...item, warmth_score: v })}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={item.notes ?? ''}
            onChange={(e) => setItem({ ...item, notes: e.target.value })}
            className="input min-h-[80px] resize-none"
          />
        </Field>

        <div className="flex items-center justify-between pt-4 border-t border-pink-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!item.favorite}
              onChange={(e) => setItem({ ...item, favorite: e.target.checked })}
              className="accent-pink-500"
            />
            <span className="text-sm">Favorite</span>
          </label>
          <div className="text-xs text-ink-400">
            Worn {item.times_worn ?? 0} time{(item.times_worn ?? 0) === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button onClick={save} disabled={saving} className="btn flex-1 disabled:opacity-50">
            {saving ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
          </button>
          <button
            onClick={remove}
            className="btn-ghost flex-1"
            style={{ color: '#9a1040', borderColor: '#f7a8be' }}
          >
            Remove
          </button>
        </div>

        {saveState === 'error' && (
          <div className="text-sm text-pink-700 text-center">
            {errorMsg ?? 'Save failed.'}
          </div>
        )}
      </div>

      {/* Toast — fades in and out on save */}
      {saveState === 'saved' && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 px-5 py-3 bg-pink-500 text-white shadow-lg animate-fade-up flex items-center gap-2"
          style={{ borderRadius: '999px' }}
        >
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium tracking-wide">Changes saved</span>
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

// ---------------------------------------------------------------------------
// Color editor — chips for each hex color, tap-to-remove, plus-button to add
// ---------------------------------------------------------------------------
function ColorEditor({
  colors,
  onChange,
}: {
  colors: string[];
  onChange: (next: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('#888888');

  function commit() {
    const hex = normalizeHex(draft);
    if (!hex) return;
    if (!colors.includes(hex)) onChange([...colors, hex]);
    setPicking(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c, i) => (
        <button
          key={`${c}-${i}`}
          type="button"
          onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
          className="relative w-9 h-9 border border-pink-200 hover:border-pink-500 transition-colors"
          style={{ background: c, borderRadius: '3px' }}
          aria-label={`Remove color ${c}`}
        >
          {/* Small always-visible remove badge in the corner */}
          <span
            className="absolute -top-1 -right-1 w-4 h-4 bg-white border border-pink-300 flex items-center justify-center shadow-sm"
            style={{ borderRadius: '999px' }}
            aria-hidden="true"
          >
            <X className="w-2.5 h-2.5 text-pink-700" strokeWidth={3} />
          </span>
        </button>
      ))}

      {picking ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-9 h-9 border border-pink-300 cursor-pointer"
            style={{ borderRadius: '3px' }}
          />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setPicking(false);
            }}
            className="input w-24 font-mono text-xs"
            placeholder="#hex"
            autoFocus
          />
          <button
            type="button"
            onClick={commit}
            className="text-xs uppercase tracking-[0.15em] text-pink-700 hover:text-pink-500"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="text-xs uppercase tracking-[0.15em] text-ink-400 hover:text-ink-600"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="w-9 h-9 border border-dashed border-pink-300 hover:border-pink-500 hover:bg-pink-50 transition-colors flex items-center justify-center"
          style={{ borderRadius: '3px' }}
          aria-label="Add color"
        >
          <Plus className="w-4 h-4 text-pink-500" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  if (m) return `#${m[1].toLowerCase()}`;
  const short = /^#?([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [a, b, c] = short[1];
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tag editor — chip list with typeahead-style add
// ---------------------------------------------------------------------------
function TagEditor({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const clean = raw.trim().toLowerCase();
    if (!clean) return;
    if (!tags.includes(clean)) onChange([...tags, clean]);
    setDraft('');
    setAdding(false);
  }

  const unused = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs uppercase tracking-[0.12em] bg-pink-500 text-white hover:bg-pink-700 transition-colors"
            style={{ borderRadius: '2px' }}
          >
            {t}
            <X className="w-3 h-3" />
          </button>
        ))}
        {adding ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft);
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (draft) commit(draft);
              else setAdding(false);
            }}
            className="input w-28 text-xs py-1 !border-b"
            placeholder="custom…"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-3 py-1 text-xs uppercase tracking-[0.12em] border border-dashed border-pink-300 text-pink-700 hover:border-pink-500"
            style={{ borderRadius: '2px' }}
          >
            + custom
          </button>
        )}
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="text-[10px] uppercase tracking-[0.15em] text-ink-400 hover:text-pink-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score slider — 1-5 with descriptive labels
// ---------------------------------------------------------------------------
function ScoreSlider({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const v = value ?? 3;
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`flex-1 h-8 border transition-all ${
            n <= v
              ? 'bg-pink-500 border-pink-500'
              : 'bg-transparent border-pink-200 hover:border-pink-400'
          }`}
          style={{ borderRadius: '2px' }}
          aria-label={`${n}`}
        />
      ))}
    </div>
  );
}

function formalityLabel(score: number | null): string {
  if (!score) return '—';
  return ['loungewear', 'casual', 'smart casual', 'business', 'formal'][score - 1] ?? '—';
}

function warmthLabel(score: number | null): string {
  if (!score) return '—';
  return ['hot', 'warm', 'mild', 'cold', 'freezing'][score - 1] ?? '—';
}
