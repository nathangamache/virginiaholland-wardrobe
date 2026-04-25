'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, Check, X } from 'lucide-react';

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';

type Status = 'queued' | 'tagging' | 'ready' | 'saving' | 'saved' | 'error';

interface Tagged {
  category: Category;
  sub_category: string;
  colors: string[];
  brand_guess: string | null;
  style_tags: string[];
  season_tags: string[];
  warmth_score: number;
  formality_score: number;
  material: string | null;
  pattern: string | null;
  name: string;
  notes: string | null;
}

interface BulkItem {
  id: string;
  file: File;
  previewUrl: string;
  status: Status;
  tagged?: Tagged;
  name?: string;
  category?: Category;
  sub_category?: string;
  brand?: string | null;
  colors?: string[];
  style_tags?: string[];
  season_tags?: string[];
  warmth_score?: number;
  formality_score?: number;
  material?: string | null;
  pattern?: string | null;
  notes?: string | null;
  error?: string;
}

const CATEGORIES: Category[] = ['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory'];
const TAG_CONCURRENCY = 4;
const SAVE_CONCURRENCY = 3;

export default function BulkUploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [phase, setPhase] = useState<'picking' | 'processing' | 'review' | 'saving' | 'done'>(
    'picking'
  );

  function updateItem(id: string, patch: Partial<BulkItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const newItems: BulkItem[] = files.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: 'queued',
    }));
    setItems(newItems);
    setPhase('processing');
    void runTagging(newItems);
  }

  async function runTagging(list: BulkItem[]) {
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const myIdx = idx++;
        const current = list[myIdx];
        try {
          updateItem(current.id, { status: 'tagging' });

          const form = new FormData();
          form.append('image', current.file);
          const res = await fetch('/api/ai/tag-item', { method: 'POST', body: form });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.detail || body?.error || `tagging failed (${res.status})`);
          }
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

    await Promise.all(Array.from({ length: TAG_CONCURRENCY }, () => worker()));
    setPhase('review');
  }

  async function saveAll() {
    setPhase('saving');
    const toSave = items.filter((it) => it.status === 'ready');

    let idx = 0;
    const worker = async () => {
      while (idx < toSave.length) {
        const myIdx = idx++;
        const current = toSave[myIdx];
        try {
          updateItem(current.id, { status: 'saving' });

          const form = new FormData();
          form.append('original', current.file);
          form.append(
            'meta',
            JSON.stringify({
              category: current.category,
              sub_category: current.sub_category || null,
              name: current.name || null,
              brand: current.brand || null,
              material: current.material ?? null,
              pattern: current.pattern ?? null,
              colors: current.colors ?? [],
              style_tags: current.style_tags ?? [],
              season_tags: current.season_tags ?? [],
              warmth_score: current.warmth_score ?? null,
              formality_score: current.formality_score ?? null,
              favorite: false,
              notes: current.notes ?? null,
            })
          );

          const res = await fetch('/api/items', { method: 'POST', body: form });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.detail || body?.error || `save failed (${res.status})`);
          }
          updateItem(current.id, { status: 'saved' });
        } catch (e: any) {
          updateItem(current.id, { status: 'error', error: e.message ?? 'save failed' });
        }
      }
    };

    await Promise.all(Array.from({ length: SAVE_CONCURRENCY }, () => worker()));
    setPhase('done');
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function updateCategory(id: string, cat: Category) {
    updateItem(id, { category: cat });
  }

  const processingCount = items.filter((it) => it.status === 'queued' || it.status === 'tagging').length;
  const readyCount = items.filter((it) => it.status === 'ready').length;
  const savedCount = items.filter((it) => it.status === 'saved').length;
  const errorCount = items.filter((it) => it.status === 'error').length;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto pb-32">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="eyebrow mb-1">Bulk upload</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">Dump the closet</h1>
        </div>
        <button onClick={() => router.push('/closet')} className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {phase === 'picking' && (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-pink-300 p-12 text-center hover:border-pink-500 hover:bg-pink-50 transition-colors"
            style={{ borderRadius: '4px' }}
          >
            <Upload className="w-8 h-8 text-pink-500 mx-auto mb-3" strokeWidth={1.5} />
            <div className="wordmark italic text-2xl text-pink-500 mb-1">Choose multiple photos</div>
            <div className="text-xs text-ink-400 tracking-wide">
              We'll auto-tag each one with AI. You review, then save.
            </div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif,.avif,.tiff,.tif"
            multiple
            onChange={onFileChange}
            className="hidden"
          />
        </>
      )}

      {phase !== 'picking' && (
        <>
          <div className="mb-4 text-sm text-ink-600">
            {processingCount > 0 && (
              <span className="mr-4">
                <strong className="font-display text-lg text-ink-900 mr-1">{processingCount}</strong>
                processing…
              </span>
            )}
            {readyCount > 0 && (
              <span className="mr-4">
                <strong className="font-display text-lg text-ink-900 mr-1">{readyCount}</strong>
                ready
              </span>
            )}
            {savedCount > 0 && (
              <span className="mr-4 text-pink-700">
                <strong className="font-display text-lg mr-1">{savedCount}</strong>
                saved
              </span>
            )}
            {errorCount > 0 && (
              <span className="mr-4 text-pink-700">
                <strong className="font-display text-lg mr-1">{errorCount}</strong>
                failed
              </span>
            )}
          </div>

          <div className="space-y-3">
            {items.map((item) => (
              <BulkRow
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
                onUpdateCategory={(c) => updateCategory(item.id, c)}
                onUpdateName={(v) => updateItem(item.id, { name: v })}
                onUpdateBrand={(v) => updateItem(item.id, { brand: v })}
              />
            ))}
          </div>

          {phase === 'review' && readyCount > 0 && (
            <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-pink-200 p-4 z-30" style={{ boxShadow: '0 -4px 20px -8px rgba(176, 20, 86, 0.15)' }}>
              <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
                <div className="text-sm text-ink-600">
                  {readyCount} piece{readyCount === 1 ? '' : 's'} ready to save. Background removal
                  happens on save.
                </div>
                <button onClick={saveAll} className="btn">
                  <Check className="w-4 h-4" />
                  Save all
                </button>
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="card p-6 text-center mt-6">
              <div className="wordmark italic text-2xl text-ink-900 mb-2">Done!</div>
              <div className="text-sm text-ink-600 mb-4">
                Saved {savedCount} piece{savedCount === 1 ? '' : 's'}
                {errorCount > 0 && <>, {errorCount} failed</>}
              </div>
              <button onClick={() => router.push('/closet')} className="btn">
                Back to closet
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BulkRow({
  item,
  onRemove,
  onUpdateCategory,
  onUpdateName,
  onUpdateBrand,
}: {
  item: BulkItem;
  onRemove: () => void;
  onUpdateCategory: (c: Category) => void;
  onUpdateName: (v: string) => void;
  onUpdateBrand: (v: string) => void;
}) {
  const editable =
    item.status === 'ready' || item.status === 'saving' || item.status === 'saved';

  return (
    <div
      className={`card flex gap-3 p-3 ${item.status === 'error' ? 'border-pink-300' : ''}`}
    >
      <div className="w-24 h-24 flex-shrink-0 bg-pink-50 relative overflow-hidden" style={{ borderRadius: '2px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.previewUrl} alt="" className="w-full h-full object-contain" />
        {(item.status === 'queued' || item.status === 'tagging' || item.status === 'saving') && (
          <div className="absolute inset-0 bg-pink-50/70 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-pink-500 animate-pulse" />
          </div>
        )}
        {item.status === 'saved' && (
          <div className="absolute inset-0 bg-pink-300/70 flex items-center justify-center">
            <Check className="w-5 h-5 text-ink-900" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <StatusLine item={item} />
        {editable && (
          <div className="mt-1 space-y-1">
            <input
              value={item.name ?? ''}
              onChange={(e) => onUpdateName(e.target.value)}
              placeholder="Name"
              className="input !py-1 !text-sm"
            />
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateCategory(c)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] border ${
                    item.category === c
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'border-pink-200 text-ink-600'
                  }`}
                  style={{ borderRadius: '2px' }}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              value={item.brand ?? ''}
              onChange={(e) => onUpdateBrand(e.target.value)}
              placeholder="Brand"
              className="input !py-1 !text-sm"
            />
          </div>
        )}
      </div>

      {(item.status === 'ready' || item.status === 'error') && (
        <button onClick={onRemove} className="-m-2 p-2 text-ink-400 hover:text-ink-900 self-start" aria-label="Remove">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function StatusLine({ item }: { item: BulkItem }) {
  const label = {
    queued: 'Queued',
    tagging: 'Tagging with AI…',
    ready: 'Ready',
    saving: 'Saving (removing background)…',
    saved: 'Saved',
    error: `Failed${item.error ? `: ${item.error}` : ''}`,
  }[item.status];

  const color = {
    queued: 'text-ink-400',
    tagging: 'text-ink-400',
    ready: 'text-pink-700',
    saving: 'text-ink-400',
    saved: 'text-pink-700',
    error: 'text-pink-700',
  }[item.status];

  return <div className={`text-[10px] uppercase tracking-[0.15em] ${color}`}>{label}</div>;
}
