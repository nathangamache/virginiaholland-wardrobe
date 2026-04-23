'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Check, AlertCircle, Upload } from 'lucide-react';

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';
type Status = 'queued' | 'removing-bg' | 'tagging' | 'ready' | 'saving' | 'saved' | 'error';

const CATEGORIES: Category[] = ['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory'];
const CONCURRENCY = 3;
const SAVE_BATCH = 5;

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

interface BulkItem {
  id: string;
  file: File;
  previewUrl: string;
  originalBlob: Blob | null;
  nobgBlob: Blob | null;
  nobgUrl: string | null;
  status: Status;
  error: string | null;
  name: string;
  category: Category | null;
  sub_category: string;
  brand: string | null;
  colors: string[];
  style_tags: string[];
  season_tags: string[];
  warmth_score: number | null;
  formality_score: number | null;
  material: string | null;
  pattern: string | null;
  notes: string | null;
  favorite: boolean;
  tagged: Tagged | null;
}

export default function BulkUploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [phase, setPhase] = useState<'select' | 'processing' | 'review' | 'saving' | 'done'>('select');
  const [savedCount, setSavedCount] = useState(0);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newItems: BulkItem[] = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      originalBlob: file,
      nobgBlob: null,
      nobgUrl: null,
      status: 'queued',
      error: null,
      name: '',
      category: null,
      sub_category: '',
      brand: null,
      colors: [],
      style_tags: [],
      season_tags: [],
      warmth_score: null,
      formality_score: null,
      material: null,
      pattern: null,
      notes: null,
      favorite: false,
      tagged: null,
    }));
    setItems(newItems);
    setPhase('processing');
    runPipeline(newItems);
  }

  async function runPipeline(list: BulkItem[]) {
    const { removeBackgroundClean } = await import('@/lib/bg-removal');

    let idx = 0;
    const processOne = async () => {
      while (idx < list.length) {
        const myIdx = idx++;
        const current = list[myIdx];
        try {
          updateItem(current.id, { status: 'removing-bg' });
          let nobgBlob: Blob | null = null;
          try {
            nobgBlob = await removeBackgroundClean(current.file);
          } catch (e) {
            console.warn('bg removal failed for', current.id, e);
          }
          const nobgUrl = nobgBlob ? URL.createObjectURL(nobgBlob) : null;
          updateItem(current.id, { nobgBlob, nobgUrl, status: 'tagging' });

          const form = new FormData();
          form.append('image', current.file);
          const res = await fetch('/api/ai/tag-item', { method: 'POST', body: form });
          if (!res.ok) throw new Error('tagging failed');
          const json = await res.json();
          const t: Tagged = json.tagged;

          updateItem(current.id, {
            status: 'ready',
            tagged: t,
            name: t.name ?? '',
            category: t.category,
            sub_category: t.sub_category ?? '',
            brand: t.brand_guess,
            colors: t.colors ?? [],
            style_tags: t.style_tags ?? [],
            season_tags: t.season_tags ?? [],
            warmth_score: t.warmth_score,
            formality_score: t.formality_score,
            material: t.material,
            pattern: t.pattern,
            notes: t.notes,
          });
        } catch (e: any) {
          updateItem(current.id, { status: 'error', error: e.message ?? 'failed' });
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => processOne()));
    setPhase('review');
  }

  function updateItem(id: string, patch: Partial<BulkItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function saveAll() {
    setPhase('saving');
    setSavedCount(0);
    const toSave = items.filter((it) => it.status === 'ready' && it.category);

    for (let i = 0; i < toSave.length; i += SAVE_BATCH) {
      const batch = toSave.slice(i, i + SAVE_BATCH);
      await Promise.all(
        batch.map(async (it) => {
          try {
            updateItem(it.id, { status: 'saving' });
            const form = new FormData();
            form.append('original', it.originalBlob!, 'original.jpg');
            if (it.nobgBlob) form.append('nobg', it.nobgBlob, 'nobg.png');
            form.append(
              'meta',
              JSON.stringify({
                category: it.category,
                sub_category: it.sub_category || null,
                name: it.name || null,
                brand: it.brand || null,
                material: it.material,
                pattern: it.pattern,
                colors: it.colors,
                style_tags: it.style_tags,
                season_tags: it.season_tags,
                warmth_score: it.warmth_score,
                formality_score: it.formality_score,
                favorite: it.favorite,
                notes: it.notes,
              })
            );
            const res = await fetch('/api/items', { method: 'POST', body: form });
            if (!res.ok) throw new Error('save failed');
            updateItem(it.id, { status: 'saved' });
            setSavedCount((c) => c + 1);
          } catch (e: any) {
            updateItem(it.id, { status: 'error', error: e.message ?? 'save failed' });
          }
        })
      );
    }

    setPhase('done');
  }

  const processingCount = items.filter(
    (it) => it.status === 'removing-bg' || it.status === 'tagging' || it.status === 'queued'
  ).length;
  const readyCount = items.filter((it) => it.status === 'ready').length;
  const errorCount = items.filter((it) => it.status === 'error').length;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto pb-32">
      <div className="mb-8">
        <div className="eyebrow mb-1">Bulk add</div>
        <h1 className="font-display text-4xl leading-tight">Dump the closet</h1>
        <p className="mt-2 text-sm text-ink-600">
          Select many photos at once. Backgrounds get removed in your browser, then AI tags everything. Review and save.
        </p>
      </div>

      {phase === 'select' && (
        <div className="card p-12 text-center">
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex flex-col items-center gap-3 text-ink-600 hover:text-ink-900"
          >
            <Upload className="w-10 h-10" strokeWidth={1.3} />
            <span className="font-display text-2xl">Select photos</span>
            <span className="text-xs uppercase tracking-[0.2em] text-ink-400">Any number. Any order.</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onFileChange}
            className="hidden"
          />
        </div>
      )}

      {(phase === 'processing' || phase === 'review' || phase === 'saving' || phase === 'done') && (
        <>
          <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="text-ink-600">
              <strong className="font-display text-lg text-ink-900 mr-1">{items.length}</strong>
              total
            </span>
            {processingCount > 0 && (
              <span className="text-ink-400">
                <strong className="font-display text-lg text-ink-900 mr-1">{processingCount}</strong>
                processing
              </span>
            )}
            <span className="text-sage-700">
              <strong className="font-display text-lg mr-1">{readyCount}</strong>
              ready
            </span>
            {errorCount > 0 && (
              <span className="text-clay-700">
                <strong className="font-display text-lg mr-1">{errorCount}</strong>
                failed
              </span>
            )}
            {phase === 'saving' && (
              <span className="text-ink-600">
                <strong className="font-display text-lg mr-1">{savedCount}</strong>
                saved
              </span>
            )}
          </div>

          <div className="space-y-4">
            {items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                onChange={(p) => updateItem(it.id, p)}
                onRemove={() => removeItem(it.id)}
                phase={phase}
              />
            ))}
          </div>
        </>
      )}

      {phase === 'review' && readyCount > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-30 bg-ivory-50/95 backdrop-blur border-t border-ivory-200 px-6 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-sm text-ink-600">
              Save {readyCount} item{readyCount === 1 ? '' : 's'} to closet
            </div>
            <button onClick={saveAll} className="btn">Save all</button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="card p-10 text-center mt-8">
          <Check className="w-10 h-10 mx-auto text-sage-700 mb-3" strokeWidth={1.5} />
          <div className="font-display text-2xl mb-1">{savedCount} saved</div>
          <p className="text-sm text-ink-600 mb-6">
            {errorCount > 0 && `${errorCount} failed. `}Everything else is in the closet.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => router.push('/closet')} className="btn">Open closet</button>
            <button
              onClick={() => {
                setItems([]);
                setPhase('select');
                setSavedCount(0);
              }}
              className="btn-ghost"
            >
              Add more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onChange,
  onRemove,
  phase,
}: {
  item: BulkItem;
  onChange: (patch: Partial<BulkItem>) => void;
  onRemove: () => void;
  phase: string;
}) {
  const editable = item.status === 'ready' && phase === 'review';
  const previewSrc = item.nobgUrl ?? item.previewUrl;

  return (
    <div
      className={`card p-3 flex gap-4 ${item.status === 'saved' ? 'opacity-50' : ''} ${
        item.status === 'error' ? 'border-clay-300' : ''
      }`}
    >
      <div className="w-24 h-24 flex-shrink-0 bg-ivory-100 relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewSrc} alt="" className="w-full h-full object-contain" />
        {(item.status === 'removing-bg' ||
          item.status === 'tagging' ||
          item.status === 'queued' ||
          item.status === 'saving') && (
          <div className="absolute inset-0 bg-ivory-50/70 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-ink-900 animate-pulse" />
          </div>
        )}
        {item.status === 'saved' && (
          <div className="absolute inset-0 bg-sage-300/80 flex items-center justify-center">
            <Check className="w-5 h-5 text-ink-900" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <StatusLine item={item} />

        {editable ? (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2 items-center">
              <input
                value={item.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Name"
                className="flex-1 bg-transparent border-b border-ivory-300 text-sm py-1 px-0 focus:outline-none focus:border-ink-900"
              />
              <button
                onClick={() => onChange({ favorite: !item.favorite })}
                className={`text-lg leading-none transition-colors ${
                  item.favorite ? 'text-clay-700' : 'text-ink-300 hover:text-ink-600'
                }`}
                aria-label="Favorite"
              >
                ✦
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => onChange({ category: c })}
                  className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] border transition-all ${
                    item.category === c
                      ? 'bg-ink-900 text-ivory-50 border-ink-900'
                      : 'bg-transparent text-ink-600 border-ivory-300 hover:border-ink-400'
                  }`}
                  style={{ borderRadius: '2px' }}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 text-xs text-ink-400">
              <input
                value={item.sub_category}
                onChange={(e) => onChange({ sub_category: e.target.value })}
                placeholder="Sub-category"
                className="flex-1 bg-transparent border-b border-ivory-300 py-1 px-0 focus:outline-none focus:border-ink-600"
              />
              <input
                value={item.brand ?? ''}
                onChange={(e) => onChange({ brand: e.target.value })}
                placeholder="Brand"
                className="flex-1 bg-transparent border-b border-ivory-300 py-1 px-0 focus:outline-none focus:border-ink-600"
              />
            </div>
            {item.colors.length > 0 && (
              <div className="flex gap-1 items-center">
                {item.colors.map((c, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 border border-ivory-300"
                    style={{ background: c, borderRadius: '2px' }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          item.status !== 'queued' &&
          item.name && (
            <div className="mt-1 text-sm text-ink-600">
              {item.name}
              {item.category && <span className="text-ink-400"> · {item.category}</span>}
            </div>
          )
        )}
      </div>

      {(item.status === 'ready' || item.status === 'error') && phase !== 'saving' && phase !== 'done' && (
        <button onClick={onRemove} className="text-ink-400 hover:text-ink-900 self-start" aria-label="Remove">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function StatusLine({ item }: { item: BulkItem }) {
  const label = {
    queued: 'Queued',
    'removing-bg': 'Removing background…',
    tagging: 'Tagging with AI…',
    ready: 'Ready',
    saving: 'Saving…',
    saved: 'Saved',
    error: `Failed${item.error ? `: ${item.error}` : ''}`,
  }[item.status];

  const color = {
    queued: 'text-ink-400',
    'removing-bg': 'text-ink-400',
    tagging: 'text-ink-400',
    ready: 'text-sage-700',
    saving: 'text-ink-400',
    saved: 'text-sage-700',
    error: 'text-clay-700',
  }[item.status];

  return (
    <div className="flex items-center gap-1.5">
      {item.status === 'error' && <AlertCircle className="w-3 h-3 text-clay-700" />}
      <div className={`text-[10px] uppercase tracking-[0.2em] ${color}`}>{label}</div>
    </div>
  );
}
