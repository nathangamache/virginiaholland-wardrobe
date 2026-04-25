'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Layers, ArrowRight } from 'lucide-react';
import { ItemCard } from '@/components/ItemCard';
import { listPending, deletePending, type PendingItem } from '@/lib/pending-store';
import { useDialog } from '@/components/DialogProvider';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'shirt', label: 'Shirts' },
  { key: 'pants', label: 'Pants' },
  { key: 'dress', label: 'Dresses' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'purse', label: 'Purses' },
  { key: 'outerwear', label: 'Outerwear' },
  { key: 'accessory', label: 'Accessories' },
];

export default function ClosetPage() {
  const { confirm } = useDialog();
  const [items, setItems] = useState<any[]>([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingItem[]>([]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (cat !== 'all') params.set('category', cat);
    if (q) params.set('q', q);
    const res = await fetch(`/api/items?${params.toString()}`);
    const json = await res.json();
    setItems(json.items ?? []);
    setLoading(false);
  }

  async function loadPending() {
    try {
      const rows = await listPending();
      setPending(rows);
    } catch (e) {
      console.warn('pending load failed', e);
    }
  }

  async function discardPending(id: string) {
    const ok = await confirm({
      title: 'Discard this upload?',
      body: 'The in-progress photo and tags will be lost.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePending(id);
      await loadPending();
    } catch (e) {
      console.warn(e);
    }
  }

  useEffect(() => {
    load();
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between mb-6 gap-2">
        <div>
          <div className="eyebrow mb-1">Closet</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">
            {items.length} piece{items.length === 1 ? '' : 's'}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link href="/closet/bulk" className="btn-ghost">
            <Layers className="w-4 h-4" />
            Bulk
          </Link>
          <Link href="/closet/new" className="btn">
            <Plus className="w-4 h-4" />
            Add
          </Link>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mb-6 card-pink p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="eyebrow mb-0.5">In progress</div>
              <div className="text-sm text-ink-800">
                {pending.length} unsaved upload{pending.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
            {pending.map((p) => (
              <PendingCard key={p.id} item={p} onDiscard={() => discardPending(p.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 -mx-6 px-6 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 whitespace-nowrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                cat === c.key
                  ? 'bg-ink-900 text-ivory-50 border-ink-900'
                  : 'bg-transparent text-ink-600 border-ivory-300 hover:border-ink-400'
              }`}
              style={{ borderRadius: '2px' }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search name, brand, or type"
          className="input"
        />
      </div>

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-600 mb-4">Nothing here yet.</p>
          <Link href="/closet/new" className="btn">Add your first piece</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {items.map((it) => (
            <ItemCard key={it.id} {...it} />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingCard({ item, onDiscard }: { item: PendingItem; onDiscard: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = item.nobgBlob ?? item.originalBlob;
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [item.nobgBlob, item.originalBlob]);

  const statusLabel =
    item.status === 'ready'
      ? 'Ready to save'
      : item.status === 'partial'
      ? 'Finish setup'
      : 'Processing…';

  return (
    <div className="flex-shrink-0 w-40 card bg-white overflow-hidden">
      <Link href={`/closet/new?pending=${item.id}`} className="block">
        <div className="aspect-square bg-pink-50 relative">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="w-full h-full object-contain" />
          )}
          {item.status === 'processing' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" style={{ animationDelay: '200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" style={{ animationDelay: '400ms' }} />
              </div>
            </div>
          )}
          {item.status === 'ready' && (
            <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center">
              <span className="text-[10px] text-white">✓</span>
            </div>
          )}
        </div>
        <div className="p-3">
          <div className="text-xs font-medium text-ink-800 truncate">
            {item.meta.name || 'Untitled piece'}
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-pink-700 mt-0.5">
            {statusLabel}
          </div>
        </div>
      </Link>
      <div className="px-3 pb-3 flex items-center justify-between gap-2">
        <Link
          href={`/closet/new?pending=${item.id}`}
          className="text-[10px] uppercase tracking-[0.15em] text-pink-700 hover:text-pink-500 inline-flex items-center gap-1"
        >
          Finish <ArrowRight className="w-3 h-3" />
        </Link>
        <button
          onClick={onDiscard}
          className="text-[10px] uppercase tracking-[0.15em] text-ink-400 hover:text-pink-700"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
