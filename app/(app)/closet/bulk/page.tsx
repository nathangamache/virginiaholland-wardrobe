'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, Check, X, RefreshCw } from 'lucide-react';

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';

// 'processing' covers both tagging and bg removal (they run in parallel on
// the server). 'ready' means the user can edit and save. 'saving' is the
// DB insert — fast, no heavy work.
type Status = 'queued' | 'processing' | 'ready' | 'saving' | 'saved' | 'error';

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
  // After /api/items/process completes:
  image_path?: string;
  image_nobg_path?: string | null;
  thumb_path?: string;
  nobg_url?: string | null;        // server-served URL for the bg-removed PNG
  // Per-step success flags — lets us show precise row-level status
  nobg_succeeded?: boolean;
  tagging_succeeded?: boolean;
  // Editable metadata
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
// 4 matches the server's BG_REMOVAL_SESSION_POOL default. Running more than
// the pool size wastes nothing (extra requests just queue) but feels snappier
// because the client sees immediate progress. We leave 1 slot of headroom.
const PROCESS_CONCURRENCY = 5;
const SAVE_CONCURRENCY = 8;

export default function BulkUploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [phase, setPhase] = useState<'picking' | 'processing' | 'review' | 'saving' | 'done'>(
    'picking'
  );

  // Revoke all local blob URLs when the component unmounts — otherwise every
  // upload batch keeps its preview Blobs pinned in browser memory.
  useEffect(() => {
    return () => {
      items.forEach((it) => {
        try {
          URL.revokeObjectURL(it.previewUrl);
        } catch {
          // already revoked or invalid — ignore
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    void runProcessing(newItems);
  }

  async function runProcessing(list: BulkItem[]) {
    // Each parallel worker pulls the next un-processed item until the list
    // is exhausted. This matches the server-side concurrency limit so we
    // don't queue dozens of HTTP requests we can't fulfill yet.
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const myIdx = idx++;
        const current = list[myIdx];
        try {
          updateItem(current.id, { status: 'processing' });

          const form = new FormData();
          form.append('photo', current.file);
          const res = await fetch('/api/items/process', { method: 'POST', body: form });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.detail || body?.error || `processing failed (${res.status})`);
          }
          const json = await res.json();
          const t: Tagged | null = json.tagged;

          // Preload the bg-removed image BEFORE flipping the row to 'ready'.
          // Otherwise the row briefly shows status="Ready" while the <img>
          // is still rendering the original-photo blob URL — which looks
          // jarring (the cutout pops in a moment after "Ready" appears).
          const nobgUrl: string | null = json.urls.nobg;
          if (nobgUrl) {
            await preloadImage(nobgUrl).catch(() => {
              // Image preload failure isn't fatal — proceed anyway and let
              // the regular <img> tag handle its own load.
            });
          }

          updateItem(current.id, {
            status: 'ready',
            // server-saved paths
            image_path: json.paths.original,
            image_nobg_path: json.paths.nobg,
            thumb_path: json.paths.thumb,
            nobg_url: nobgUrl,
            nobg_succeeded: !!json.nobg_succeeded,
            tagging_succeeded: !!json.tagging_succeeded,
            // tag fields (may be missing if AI failed; fields are optional)
            tagged: t ?? undefined,
            name: t?.name ?? '',
            category: t?.category,
            sub_category: t?.sub_category ?? '',
            brand: t?.brand_guess ?? null,
            colors: t?.colors ?? [],
            style_tags: t?.style_tags ?? [],
            season_tags: t?.season_tags ?? [],
            warmth_score: t?.warmth_score,
            formality_score: t?.formality_score,
            material: t?.material ?? null,
            pattern: t?.pattern ?? null,
            notes: t?.notes ?? null,
          });
        } catch (e: any) {
          updateItem(current.id, { status: 'error', error: e.message ?? 'failed' });
        }
      }
    };

    await Promise.all(Array.from({ length: PROCESS_CONCURRENCY }, () => worker()));
    setPhase('review');
  }

  /**
   * Preload an image so the browser has it decoded and ready to render
   * by the time we update React state. Resolves when load completes
   * (or fails — caller decides what to do).
   */
  function preloadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to preload ${src}`));
      img.src = src;
    });
  }

  /**
   * Retry processing for a single failed item. Keeps the rest of the list as-is.
   */
  async function retryItem(id: string) {
    const current = items.find((it) => it.id === id);
    if (!current) return;
    updateItem(id, { status: 'processing', error: undefined });

    try {
      const form = new FormData();
      form.append('photo', current.file);
      const res = await fetch('/api/items/process', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `processing failed (${res.status})`);
      }
      const json = await res.json();
      const t: Tagged | null = json.tagged;

      // Preload the bg-removed image before flipping state to 'ready'
      const nobgUrl: string | null = json.urls.nobg;
      if (nobgUrl) {
        await preloadImage(nobgUrl).catch(() => {});
      }

      updateItem(id, {
        status: 'ready',
        image_path: json.paths.original,
        image_nobg_path: json.paths.nobg,
        thumb_path: json.paths.thumb,
        nobg_url: nobgUrl,
        nobg_succeeded: !!json.nobg_succeeded,
        tagging_succeeded: !!json.tagging_succeeded,
        tagged: t ?? undefined,
        name: t?.name ?? current.name ?? '',
        category: t?.category ?? current.category,
        sub_category: t?.sub_category ?? current.sub_category ?? '',
        brand: t?.brand_guess ?? current.brand ?? null,
        colors: t?.colors ?? current.colors ?? [],
        style_tags: t?.style_tags ?? current.style_tags ?? [],
        season_tags: t?.season_tags ?? current.season_tags ?? [],
        warmth_score: t?.warmth_score ?? current.warmth_score,
        formality_score: t?.formality_score ?? current.formality_score,
        material: t?.material ?? current.material ?? null,
        pattern: t?.pattern ?? current.pattern ?? null,
        notes: t?.notes ?? current.notes ?? null,
      });
    } catch (e: any) {
      updateItem(id, { status: 'error', error: e.message ?? 'retry failed' });
    }
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

          if (!current.image_path || !current.thumb_path) {
            throw new Error('processed paths missing');
          }

          const res = await fetch('/api/items', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              image_path: current.image_path,
              image_nobg_path: current.image_nobg_path,
              thumb_path: current.thumb_path,
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
            }),
          });
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
    setItems((prev) => {
      const removed = prev.find((it) => it.id === id);
      if (removed) {
        try {
          URL.revokeObjectURL(removed.previewUrl);
        } catch {
          // ignore
        }
      }
      return prev.filter((it) => it.id !== id);
    });
  }

  function updateCategory(id: string, cat: Category) {
    updateItem(id, { category: cat });
  }

  const processingCount = items.filter((it) => it.status === 'queued' || it.status === 'processing').length;
  const readyCount = items.filter((it) => it.status === 'ready').length;
  const savedCount = items.filter((it) => it.status === 'saved').length;
  const errorCount = items.filter((it) => it.status === 'error').length;
  const bgFailedInReadyCount = items.filter(
    (it) => it.status === 'ready' && it.nobg_succeeded === false
  ).length;
  const totalCount = items.length;
  // Progress percentage for the overall batch — combines processing + saving
  const progressPct =
    totalCount === 0
      ? 0
      : Math.round(
          ((savedCount + errorCount + (phase === 'review' ? readyCount : 0)) / totalCount) * 100
        );

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
          {/* Progress bar — always visible during processing/saving so user
              has a sense of how close to done we are. */}
          {(phase === 'processing' || phase === 'saving') && totalCount > 0 && (
            <div className="mb-4">
              <div className="h-1 bg-pink-100 overflow-hidden" style={{ borderRadius: '2px' }}>
                <div
                  className="h-full bg-pink-500 transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] uppercase tracking-[0.12em] text-ink-400">
                <span>
                  {phase === 'processing'
                    ? 'Tagging + removing backgrounds'
                    : 'Saving to closet'}
                </span>
                <span>{progressPct}%</span>
              </div>
            </div>
          )}

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
                onRetry={() => retryItem(item.id)}
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
                  <strong className="text-ink-900">{readyCount}</strong> piece{readyCount === 1 ? '' : 's'} ready.
                  {bgFailedInReadyCount > 0 && (
                    <span className="text-pink-700 ml-2">
                      {bgFailedInReadyCount} without bg removed
                    </span>
                  )}
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
  onRetry,
  onUpdateCategory,
  onUpdateName,
  onUpdateBrand,
}: {
  item: BulkItem;
  onRemove: () => void;
  onRetry: () => void;
  onUpdateCategory: (c: Category) => void;
  onUpdateName: (v: string) => void;
  onUpdateBrand: (v: string) => void;
}) {
  const editable =
    item.status === 'ready' || item.status === 'saving' || item.status === 'saved';

  const showRetry =
    item.status === 'error' ||
    (item.status === 'ready' && item.nobg_succeeded === false);

  return (
    <div
      className={`card flex gap-3 p-3 ${item.status === 'error' ? 'border-pink-300' : ''}`}
    >
      <div className="w-24 h-24 flex-shrink-0 bg-pink-50 relative overflow-hidden" style={{ borderRadius: '2px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.nobg_url ?? item.previewUrl} alt="" className="w-full h-full object-contain" />
        {(item.status === 'queued' || item.status === 'processing') && (
          <div className="absolute inset-0 bg-pink-50/70 flex items-center justify-center backdrop-blur-[1px]">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" style={{ animationDelay: '200ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}
        {item.status === 'saving' && (
          <div className="absolute inset-0 bg-pink-100/70 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-pink-600 animate-pulse" />
          </div>
        )}
        {item.status === 'saved' && (
          <div className="absolute inset-0 bg-pink-300/70 flex items-center justify-center">
            <Check className="w-5 h-5 text-ink-900" />
          </div>
        )}
        {item.status === 'error' && (
          <div className="absolute inset-0 bg-pink-100/90 flex items-center justify-center">
            <X className="w-5 h-5 text-pink-700" />
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

      <div className="flex flex-col gap-1 items-end self-start">
        {showRetry && (
          <button
            onClick={onRetry}
            className="-m-1 p-1 text-pink-700 hover:text-pink-500 text-[10px] uppercase tracking-[0.12em] flex items-center gap-1"
            aria-label="Retry"
            title="Retry processing"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        )}
        {(item.status === 'ready' || item.status === 'error') && (
          <button onClick={onRemove} className="-m-2 p-2 text-ink-400 hover:text-ink-900" aria-label="Remove">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function StatusLine({ item }: { item: BulkItem }) {
  const statusLabel = {
    queued: 'Waiting…',
    processing: 'Tagging + removing background…',
    ready: 'Ready',
    saving: 'Saving…',
    saved: 'Saved',
    error: `Failed${item.error ? `: ${item.error}` : ''}`,
  }[item.status];

  const statusColor = {
    queued: 'text-ink-400',
    processing: 'text-ink-400',
    ready: 'text-pink-700',
    saving: 'text-ink-400',
    saved: 'text-pink-700',
    error: 'text-pink-700',
  }[item.status];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={`text-[10px] uppercase tracking-[0.15em] ${statusColor}`}>
        {statusLabel}
      </div>
      {/* When ready (or saved), show whether bg removal succeeded. Nothing
          annoying — just a subtle badge so the user knows at a glance. */}
      {(item.status === 'ready' || item.status === 'saved') && (
        <>
          {item.nobg_succeeded === false && (
            <span
              className="text-[9px] uppercase tracking-[0.15em] text-pink-700 px-1.5 py-0.5 border border-pink-300"
              style={{ borderRadius: '2px' }}
              title="Background removal didn't work — original photo will be used"
            >
              no bg removed
            </span>
          )}
          {item.tagging_succeeded === false && (
            <span
              className="text-[9px] uppercase tracking-[0.15em] text-pink-700 px-1.5 py-0.5 border border-pink-300"
              style={{ borderRadius: '2px' }}
              title="Auto-tagging failed — fill in details manually"
            >
              not tagged
            </span>
          )}
        </>
      )}
    </div>
  );
}
