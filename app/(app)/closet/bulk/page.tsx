'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, Check, X, RefreshCw } from 'lucide-react';

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';

// Status flow for a bulk row, in order:
//   queued      → waiting in line for upload
//   uploading   → actively being uploaded (network transfer in progress)
//   queued_proc → uploaded, waiting in line for tagging + bg removal
//   processing  → actively running tagging + bg removal on the server
//   ready       → done, user can edit and save
//   saving      → DB insert in flight
//   saved       → committed
//   error       → something failed; row shows retry
//
// We keep upload and process as separate phases so the user sees fast
// "uploading" feedback during the network phase (many parallel uploads)
// even before the slower processing phase has caught up.
type Status =
  | 'queued'
  | 'uploading'
  | 'queued_proc'
  | 'processing'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'error';

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
  // After phase 1 (upload) completes — server holds the raw bytes here:
  stash_id?: string;
  // After phase 2 (process) completes:
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

// Two separate concurrency limits for the two phases:
// - UPLOAD_CONCURRENCY: how many photos to upload in parallel. This is
//   network-bound (multipart POSTs), so we can run more without straining
//   the server.
// - PROCESS_CONCURRENCY: how many to run tagging + bg removal on. Matches
//   the server's BG_REMOVAL_SESSION_POOL (4) with 1 slot of headroom.
const UPLOAD_CONCURRENCY = 8;
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

  /**
   * Two-phase pipeline:
   *
   *   Phase 1 (upload): UPLOAD_CONCURRENCY workers POST raw photos to
   *   /api/items/upload and get back stash IDs. While each photo is being
   *   uploaded its row shows "Uploading…"; once uploaded it goes to
   *   "Ready to tag" until phase 2 picks it up.
   *
   *   Phase 2 (process): runs CONCURRENTLY with phase 1, but at lower
   *   concurrency. Each worker pulls items that have a stash_id but are
   *   still "queued_proc", tells the server to process them, and gets back
   *   the same { paths, urls, tagged, ... } shape the old single-step
   *   endpoint used to return.
   *
   * The two phases run in parallel: phase 2 starts processing the first
   * uploaded items while phase 1 is still uploading later ones. This is
   * what gives the user the rapid "rows-going-from-uploading-to-tagging"
   * feedback you'd expect from a polished bulk uploader.
   */
  async function runProcessing(list: BulkItem[]) {
    // Shared state between the two phases. We use ref-like idx counters
    // (let-vars closed over by both worker pools) since this is a pure
    // sequential dispatch problem.
    let uploadIdx = 0;
    // Queue of items ready to be processed. We enqueue here from upload
    // workers and dequeue from process workers. JavaScript is single-
    // threaded so a plain array is safe — no synchronization needed.
    const processQueue: BulkItem[] = [];
    let uploadDone = false;

    const uploadWorker = async () => {
      while (uploadIdx < list.length) {
        const myIdx = uploadIdx++;
        const current = list[myIdx];
        try {
          updateItem(current.id, { status: 'uploading' });

          const form = new FormData();
          form.append('photo', current.file);
          const res = await fetch('/api/items/upload', {
            method: 'POST',
            body: form,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.detail || body?.error || `upload failed (${res.status})`);
          }
          const json = await res.json();

          // Update local state — and keep a reference for phase 2 with
          // the new stash_id attached.
          const withStash: BulkItem = { ...current, stash_id: json.stash_id, status: 'queued_proc' };
          updateItem(current.id, { stash_id: json.stash_id, status: 'queued_proc' });
          processQueue.push(withStash);
        } catch (e: any) {
          updateItem(current.id, { status: 'error', error: e.message ?? 'upload failed' });
        }
      }
    };

    const processWorker = async () => {
      while (true) {
        const current = processQueue.shift();
        if (!current) {
          // No work right now — but more might arrive from upload workers.
          // If uploads are still going, sleep briefly and retry.
          if (uploadDone) return;
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }

        try {
          updateItem(current.id, { status: 'processing' });

          const res = await fetch('/api/items/process-stashed', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stash_id: current.stash_id }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.detail || body?.error || `processing failed (${res.status})`);
          }
          const json = await res.json();
          const t: Tagged | null = json.tagged;

          // Preload the bg-removed image so the row's <img> already has it
          // by the time we flip status to 'ready'. Otherwise the row briefly
          // shows "Ready" while the cutout is still loading, which looks bad.
          const nobgUrl: string | null = json.urls.nobg;
          if (nobgUrl) {
            await preloadImage(nobgUrl).catch(() => {});
          }

          updateItem(current.id, {
            status: 'ready',
            image_path: json.paths.original,
            image_nobg_path: json.paths.nobg,
            thumb_path: json.paths.thumb,
            nobg_url: nobgUrl,
            nobg_succeeded: !!json.nobg_succeeded,
            tagging_succeeded: !!json.tagging_succeeded,
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

    // Launch both pools concurrently. Upload workers finish first because
    // each individual upload is much shorter than processing.
    const uploadPool = Promise.all(
      Array.from({ length: UPLOAD_CONCURRENCY }, () => uploadWorker())
    ).then(() => {
      uploadDone = true;
    });

    const processPool = Promise.all(
      Array.from({ length: PROCESS_CONCURRENCY }, () => processWorker())
    );

    await Promise.all([uploadPool, processPool]);
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

  const processingCount = items.filter(
    (it) =>
      it.status === 'queued' ||
      it.status === 'uploading' ||
      it.status === 'queued_proc' ||
      it.status === 'processing'
  ).length;
  const readyCount = items.filter((it) => it.status === 'ready').length;
  const savedCount = items.filter((it) => it.status === 'saved').length;
  const errorCount = items.filter((it) => it.status === 'error').length;
  const bgFailedInReadyCount = items.filter(
    (it) => it.status === 'ready' && it.nobg_succeeded === false
  ).length;
  const totalCount = items.length;

  /**
   * Progress percentage for the overall batch.
   *
   * Each item contributes a fraction based on how far along it is:
   *   queued                     → 0
   *   uploading                  → 0.1   (started but not done)
   *   queued_proc                → 0.4   (uploaded, waiting for processing)
   *   processing                 → 0.5   (processing in progress)
   *   ready / saving             → 1.0   (processing done — that's the bulk of the work)
   *   saved / error              → 1.0
   *
   * The previous version only counted ready items toward progress when phase
   * was 'review', so the bar showed 0% throughout the entire processing phase
   * even when many items were already done. This version always reflects
   * actual progress regardless of phase.
   */
  const progressPct = (() => {
    if (totalCount === 0) return 0;
    let weighted = 0;
    for (const it of items) {
      switch (it.status) {
        case 'uploading':
          weighted += 0.1;
          break;
        case 'queued_proc':
          weighted += 0.4;
          break;
        case 'processing':
          weighted += 0.5;
          break;
        case 'ready':
        case 'saving':
        case 'saved':
        case 'error':
          weighted += 1;
          break;
        // 'queued' contributes 0
      }
    }
    return Math.round((weighted / totalCount) * 100);
  })();

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
        {(item.status === 'queued' ||
          item.status === 'uploading' ||
          item.status === 'queued_proc' ||
          item.status === 'processing') && (
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
    uploading: 'Uploading…',
    queued_proc: 'Waiting to process…',
    processing: 'Tagging + removing background…',
    ready: 'Ready',
    saving: 'Saving…',
    saved: 'Saved',
    error: `Failed${item.error ? `: ${item.error}` : ''}`,
  }[item.status];

  const statusColor = {
    queued: 'text-ink-400',
    uploading: 'text-ink-400',
    queued_proc: 'text-ink-400',
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