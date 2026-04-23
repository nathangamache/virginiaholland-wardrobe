'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Layers } from 'lucide-react';
import { ItemCard } from '@/components/ItemCard';

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
  const [items, setItems] = useState<any[]>([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between mb-6 gap-2">
        <div>
          <div className="eyebrow mb-1">Closet</div>
          <h1 className="font-display text-4xl leading-tight">
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

      <div className="mb-6 -mx-6 px-6 overflow-x-auto">
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
