'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X, RefreshCw, AlertCircle } from 'lucide-react';
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

interface ProcessedPaths {
  image_path: string;
  image_nobg_path: string | null;
  thumb_path: string;
  nobg_url: string | null;
  original_url: string;
}

// Per-step status for fine-grained UI feedback. These are independent —
// tagging and bg removal run in parallel on the server.
type StepStatus = 'idle' | 'running' | 'success' | 'failed';

const CATEGORIES: Category[] = ['shirt', 'pants', 'shoes', 'purse', 'dress', 'outerwear', 'accessory'];
const SEASONS = ['spring', 'summer', 'fall', 'winter'];

function NewItemInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);
  const [paths, setPaths] = useState<ProcessedPaths | null>(null);

  // Independent status for each processing step so we can tell the user
  // precisely what succeeded and what failed.
  const [bgStatus, setBgStatus] = useState<StepStatus>('idle');
  const [tagStatus, setTagStatus] = useState<StepStatus>('idle');

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const processing = bgStatus === 'running' || tagStatus === 'running';

  // ---- Resume support ----
  useEffect(() => {
    const resumeId = searchParams.get('pending');
    if (!resumeId) return;

    (async () => {
      setResuming(true);
      try {
        const existing = await getPending(resumeId);
        if (!existing) return;

        setPendingId(existing.id);
        if (existing.originalBlob) setOriginalBlob(existing.originalBlob);
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
        // Don't try to re-run processing — the photo already succeeded/failed
        // on the previous session. The user can re-upload if they want.
        if (existing.meta.category) {
          setTagStatus('success');
          setBgStatus(existing.nobgBlob ? 'success' : 'failed');
        }
      } catch (e) {
        console.error('resume failed', e);
      } finally {
        setResuming(false);
      }
    })();
  }, [searchParams]);

  // Persist metadata edits to IndexedDB (debounced)
  useEffect(() => {
    if (!pendingId || !originalBlob) return;
    const handle = setTimeout(() => persistPending(), 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  async function persistPending(overrides?: Partial<PendingItem>) {
    if (!pendingId || !originalBlob) return;
    try {
      const overallStatus: PendingItem['status'] =
        bgStatus === 'success' && tagStatus === 'success'
          ? 'ready'
          : bgStatus === 'running' || tagStatus === 'running'
          ? 'processing'
          : 'partial';
      await savePending({
        id: pendingId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: overallStatus,
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
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const newId = newPendingId();
    setPendingId(newId);
    setOriginalBlob(file);
    setTagStatus('idle');
    setBgStatus('idle');
    setPaths(null);

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

    runProcessing(file);
  }

  async function runProcessing(file: Blob) {
    setTagStatus('running');
    setBgStatus('running');
    setErrorMsg(null);

    try {
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch('/api/items/process', { method: 'POST', body: form });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `Processing failed (${res.status})`);
      }

      const json = await res.json();

      // Preload the bg-removed image so it's already cached and decoded
      // when we update state. Without this, the UI flips status pills to
      // ✓ Background while the <img> still shows the original photo for
      // a moment, until the new src loads.
      const nobgUrl: string | null = json.urls.nobg;
      if (nobgUrl) {
        await preloadImage(nobgUrl).catch(() => {});
      }

      setPaths({
        image_path: json.paths.original,
        image_nobg_path: json.paths.nobg,
        thumb_path: json.paths.thumb,
        nobg_url: nobgUrl,
        original_url: json.urls.original,
      });

      // Tagging result
      const t: Tagged | null = json.tagged;
      if (t) {
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
        setTagStatus('success');
      } else {
        setTagStatus('failed');
      }

      // Bg removal result
      setBgStatus(json.nobg_succeeded ? 'success' : 'failed');
    } catch (e: any) {
      console.error(e);
      // Total failure — both steps couldn't even start
      setErrorMsg(e.message || 'Processing failed. You can fill in details manually or try another photo.');
      setTagStatus('failed');
      setBgStatus('failed');
    }
  }

  // Retry just the bg-removal step — re-uploads the original blob and asks
  // the server to process again. If tagging already succeeded we keep those
  // results; if not, the retry will try both steps again.
  async function retryBgRemoval() {
    if (!originalBlob) return;
    // We also re-run tagging since the endpoint does both — cheap enough
    runProcessing(originalBlob);
  }

  /**
   * Preload an image so it's decoded and ready to render before we update
   * state — eliminates the flicker where status flips to ✓ but the <img>
   * still shows the old photo for a moment.
   */
  function preloadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to preload ${src}`));
      img.src = src;
    });
  }

  async function save() {
    if (!paths || !meta.category) {
      setErrorMsg('You need a category selected before saving.');
      return;
    }
    setErrorMsg(null);
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image_path: paths.image_path,
          image_nobg_path: paths.image_nobg_path,
          thumb_path: paths.thumb_path,
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
        }),
      });
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
      setErrorMsg(e.message || 'Save failed. Try again.');
    }
  }

  async function discard() {
    if (!confirm('Discard this upload?')) return;
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

  // Manage the blob URL for the local preview (shown before the server's
  // bg-removed image is ready). useMemo+useEffect-cleanup ensures we revoke
  // the previous URL before creating a new one — otherwise re-renders would
  // leak blob URLs (each one pins its Blob in memory).
  const localBlobUrl = useMemo(() => {
    if (!originalBlob) return null;
    return URL.createObjectURL(originalBlob);
  }, [originalBlob]);

  useEffect(() => {
    if (!localBlobUrl) return;
    return () => {
      URL.revokeObjectURL(localBlobUrl);
    };
  }, [localBlobUrl]);

  // The image to show: prefer the bg-removed version; fall back to original
  // server URL, and finally the local blob URL while processing is in flight.
  const previewSrc = paths?.nobg_url ?? paths?.original_url ?? localBlobUrl;

  // Processing can "complete" with mixed results — at least one step succeeded
  // enough that the user can proceed to edit/save, even if bg removal failed
  const canEdit =
    tagStatus !== 'running' &&
    bgStatus !== 'running' &&
    !!paths &&
    tagStatus !== 'idle';

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
            <div className="text-xs text-ink-400 tracking-wide">JPG, PNG, HEIC, AVIF — drop or tap</div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif,.avif,.tiff,.tif"
            className="hidden"
            onChange={onFileChange}
          />
          {errorMsg && (
            <div className="mt-4 card-pink p-3 flex items-start gap-2 text-sm text-ink-800">
              <AlertCircle className="w-4 h-4 text-pink-700 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="card aspect-square bg-pink-50 overflow-hidden relative">
              {previewSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt="" className="w-full h-full object-contain" />
              )}
              {processing && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
                  <div className="text-center">
                    <div className="text-pink-700 wordmark italic text-lg animate-pulse mb-1">
                      Processing…
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500">
                      Usually takes 5–10 seconds
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Step status pills — shows precisely what succeeded and what failed */}
            <div className="flex gap-2 flex-wrap text-[10px] uppercase tracking-[0.15em]">
              <StepPill label="Background" status={bgStatus} />
              <StepPill label="Auto-tag" status={tagStatus} />
            </div>

            {/* If bg removal failed, offer a retry — tagging too since they
                share the endpoint */}
            {bgStatus === 'failed' && tagStatus !== 'running' && (
              <button
                onClick={retryBgRemoval}
                className="w-full text-xs uppercase tracking-[0.12em] py-2 px-3 border border-pink-300 text-pink-700 hover:bg-pink-50 flex items-center justify-center gap-1.5 transition-colors"
                style={{ borderRadius: '2px' }}
              >
                <RefreshCw className="w-3 h-3" />
                Retry background removal
              </button>
            )}
          </div>

          <div className="space-y-5">
            {processing ? (
              <div className="space-y-3">
                <div className="text-sm text-ink-600">
                  Running AI analysis and removing the background at the same time.
                </div>
                <ProcessingProgress bg={bgStatus} tag={tagStatus} />
              </div>
            ) : canEdit ? (
              <>
                {(tagStatus === 'failed' || bgStatus === 'failed') && (
                  <div className="card-pink p-3 text-xs text-ink-800">
                    {tagStatus === 'failed' && bgStatus === 'failed' && (
                      <>Both auto-tagging and background removal failed. You can fill in details manually or retry.</>
                    )}
                    {tagStatus === 'failed' && bgStatus === 'success' && (
                      <>Background removed, but auto-tagging failed. Fill in the details below manually.</>
                    )}
                    {tagStatus === 'success' && bgStatus === 'failed' && (
                      <>Tagged successfully, but background removal didn't work — the original photo will be used instead. You can retry.</>
                    )}
                  </div>
                )}

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
                    disabled={!paths || !meta.category}
                    className="btn flex-1 disabled:opacity-50"
                  >
                    Save to closet
                  </button>
                  <button
                    onClick={discard}
                    className="btn-ghost"
                    style={{ color: '#9a1040', borderColor: '#f7a8be' }}
                  >
                    Discard
                  </button>
                </div>

                {errorMsg && (
                  <div className="card-pink p-3 flex items-start gap-2 text-sm text-ink-800">
                    <AlertCircle className="w-4 h-4 text-pink-700 flex-shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <p className="text-[10px] uppercase tracking-[0.2em] text-ink-400 pt-2">
                  Auto-saves as you work — safe to leave and come back
                </p>
              </>
            ) : (
              <div className="text-sm text-ink-400">Getting ready…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Pill that shows the state of one processing step.
 * Designed to be at-a-glance scannable: a dot + label + status glyph.
 */
function StepPill({ label, status }: { label: string; status: StepStatus }) {
  const styles = {
    idle: 'bg-pink-50 text-ink-400 border-pink-100',
    running: 'bg-pink-100 text-pink-700 border-pink-200',
    success: 'bg-pink-500 text-white border-pink-500',
    failed: 'bg-transparent text-pink-700 border-pink-300',
  }[status];

  const glyph = {
    idle: '·',
    running: '…',
    success: '✓',
    failed: '⚠',
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border ${styles}`}
      style={{ borderRadius: '2px' }}
    >
      <span className={status === 'running' ? 'animate-pulse' : ''}>{glyph}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * Animated progress indicator — shows which steps are running, finished, or
 * failed. Gives the user a sense of concrete progress while they wait.
 */
function ProcessingProgress({ bg, tag }: { bg: StepStatus; tag: StepStatus }) {
  return (
    <div className="space-y-2 text-xs text-ink-600">
      <ProgressLine label="Analyzing with AI" status={tag} />
      <ProgressLine label="Removing background" status={bg} />
    </div>
  );
}

function ProgressLine({ label, status }: { label: string; status: StepStatus }) {
  const icon =
    status === 'running' ? (
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
    ) : status === 'success' ? (
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-pink-500" />
    ) : status === 'failed' ? (
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-pink-300" />
    ) : (
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-pink-100" />
    );
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className={status === 'idle' ? 'text-ink-400' : ''}>{label}</span>
      <span className="text-[10px] uppercase tracking-[0.15em] text-ink-400 ml-auto">
        {status === 'running' && 'in progress…'}
        {status === 'success' && 'done'}
        {status === 'failed' && 'failed'}
      </span>
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
