'use client';

import { useEffect, useState } from 'react';
import { Plus, Sparkles, X, ExternalLink } from 'lucide-react';

interface Wish {
  id: string;
  description: string;
  category: string | null;
  reason: string | null;
  suggested_by_ai: boolean;
  link: string | null;
  brand_suggestions: string[];
  price_range: string | null;
  priority: number;
  notes: string | null;
}

export default function WishlistPage() {
  const [items, setItems] = useState<Wish[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    const res = await fetch('/api/wishlist').then((r) => r.json());
    setItems(res.wishlist ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function askAI() {
    setSuggesting(true);
    try {
      const res = await fetch('/api/ai/wishlist-suggest', { method: 'POST' });
      const json = await res.json();
      setPendingSuggestions(json.suggestions ?? []);
    } finally {
      setSuggesting(false);
    }
  }

  async function acceptSuggestion(s: any) {
    await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...s, suggested_by_ai: true }),
    });
    setPendingSuggestions((p) => p.filter((x) => x !== s));
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/wishlist?id=${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="eyebrow mb-1">Wishlist</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">Thoughtful adds</h1>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-ghost">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="mb-8 card p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 flex items-center justify-center bg-ivory-200">
            <Sparkles className="w-5 h-5 text-clay-700" strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <div className="font-display text-lg mb-1">Gaps to consider</div>
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              Let AI look at your closet and suggest high-quality pieces that fill real gaps.
              Thrift-first where it makes sense.
            </p>
            <button onClick={askAI} disabled={suggesting} className="btn disabled:opacity-50">
              {suggesting ? 'Thinking…' : 'Suggest pieces'}
            </button>
          </div>
        </div>
      </div>

      {pendingSuggestions.length > 0 && (
        <div className="mb-10 space-y-4 animate-fade-up">
          <div className="eyebrow">— Proposed —</div>
          {pendingSuggestions.map((s, i) => (
            <div key={i} className="card p-5">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="font-display text-lg">{s.description}</div>
                <button
                  onClick={() => setPendingSuggestions((p) => p.filter((_, j) => j !== i))}
                  className="text-ink-400 hover:text-ink-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {s.reason && (
                <p className="text-sm text-ink-600 leading-relaxed mb-3">{s.reason}</p>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-ink-400 mb-4">
                {s.category && <span>Category: <span className="text-ink-600">{s.category}</span></span>}
                {s.price_range && <span>Price: <span className="text-ink-600">{s.price_range}</span></span>}
                {s.brand_suggestions?.length > 0 && (
                  <span>Brands: <span className="text-ink-600">{s.brand_suggestions.join(', ')}</span></span>
                )}
              </div>
              <button onClick={() => acceptSuggestion(s)} className="btn-ghost">Save to wishlist</button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-600">Nothing on the wishlist yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <div key={w.id} className="card p-5 group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {w.suggested_by_ai && <span className="eyebrow text-clay-700">AI</span>}
                    {w.category && <span className="eyebrow">{w.category}</span>}
                  </div>
                  <div className="font-display text-lg">{w.description}</div>
                  {w.reason && <p className="text-sm text-ink-600 mt-1">{w.reason}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400 mt-2">
                    {w.price_range && <span>{w.price_range}</span>}
                    {w.brand_suggestions?.length > 0 && <span>{w.brand_suggestions.join(', ')}</span>}
                  </div>
                  {w.link && (
                    <a href={w.link} target="_blank" rel="noreferrer" className="btn-link mt-2 inline-flex">
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <button
                  onClick={() => remove(w.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-ink-900 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddDialog onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!description) return;
    setSaving(true);
    await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description, link: link || undefined, price_range: priceRange || undefined, notes: notes || undefined }),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/30 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full md:max-w-md md:mx-4 p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow mb-1">Add to wishlist</div>
        <h2 className="font-display text-2xl mb-6">What are you looking for?</h2>
        <div className="space-y-4">
          <input
            autoFocus
            placeholder="silk slip skirt in bone"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
          />
          <input placeholder="Link (optional)" value={link} onChange={(e) => setLink(e.target.value)} className="input" />
          <input placeholder="Price range (optional)" value={priceRange} onChange={(e) => setPriceRange(e.target.value)} className="input" />
          <textarea
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input min-h-[60px] resize-none"
          />
          <div className="flex gap-3">
            <button onClick={save} disabled={!description || saving} className="btn flex-1 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
