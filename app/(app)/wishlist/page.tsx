'use client';

import { useEffect, useState } from 'react';
import { Plus, Sparkles, X, ExternalLink, Search, Globe, ChevronRight } from 'lucide-react';

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
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [stillThinking, setStillThinking] = useState(false);

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
    setSuggestError(null);
    setStillThinking(false);

    // After 8 seconds, nudge the label to signal the retry path is likely running.
    const slowTimer = setTimeout(() => setStillThinking(true), 8000);

    try {
      const res = await fetch('/api/ai/wishlist-suggest', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setSuggestError(
          json?.detail || json?.error || 'Suggestion service is having trouble — try again in a moment.'
        );
        setPendingSuggestions([]);
        return;
      }
      if (!json.suggestions || json.suggestions.length === 0) {
        setSuggestError('No suggestions came back this time — try again, or add a few pieces to your closet first.');
        return;
      }
      setPendingSuggestions(json.suggestions);
    } catch (e: any) {
      setSuggestError('Network error — check your connection and try again.');
    } finally {
      clearTimeout(slowTimer);
      setSuggesting(false);
      setStillThinking(false);
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

  // Save a specific web-search-found product as a wishlist item. The focus is
  // the link: Virginia clicks through to the source to shop. No image storage.
  async function acceptProductAsWish(
    suggestion: any,
    product: { title: string; brand: string | null; price: string | null; url: string }
  ) {
    await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: product.title,
        category: suggestion.category,
        reason: suggestion.reason,
        suggested_by_ai: true,
        link: product.url,
        brand_suggestions: product.brand ? [product.brand] : suggestion.brand_suggestions ?? [],
        price_range: product.price ?? suggestion.price_range,
        priority: suggestion.priority ?? 3,
      }),
    });
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
          <div
            className="w-10 h-10 flex items-center justify-center bg-pink-100"
            style={{ borderRadius: '3px' }}
          >
            <Sparkles className="w-5 h-5 text-pink-500" strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <div className="wordmark italic text-lg mb-1 text-ink-900">Gaps to consider</div>
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              Let AI look at your closet and suggest high-quality pieces that fill real gaps.
              Thrift-first where it makes sense.
            </p>
            <button onClick={askAI} disabled={suggesting} className="btn disabled:opacity-50">
              {suggesting
                ? stillThinking
                  ? 'Still thinking…'
                  : 'Thinking…'
                : 'Suggest pieces'}
            </button>
            {suggestError && !suggesting && (
              <p className="mt-3 text-sm text-pink-700">{suggestError}</p>
            )}
          </div>
        </div>
      </div>

      {pendingSuggestions.length > 0 && (
        <div className="mb-10 space-y-4 animate-fade-up">
          <div className="eyebrow">— Proposed —</div>
          {pendingSuggestions.map((s, i) => (
            <PendingSuggestionCard
              key={i}
              suggestion={s}
              onDismiss={() => setPendingSuggestions((p) => p.filter((_, j) => j !== i))}
              onAccept={() => acceptSuggestion(s)}
              onAcceptProduct={(product) => acceptProductAsWish(s, product)}
            />
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
            <WishCard key={w.id} wish={w} onRemove={() => remove(w.id)} />
          ))}
        </div>
      )}

      {showAdd && <AddDialog onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved wishlist card — text-only, link is the focus
// ---------------------------------------------------------------------------
function WishCard({ wish, onRemove }: { wish: Wish; onRemove: () => void }) {
  return (
    <div className="card p-5 group">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          {wish.suggested_by_ai && (
            <span className="text-[10px] uppercase tracking-[0.2em] text-pink-700 font-medium">
              AI pick
            </span>
          )}
          {wish.category && (
            <span className="text-[10px] uppercase tracking-[0.2em] text-pink-700 font-medium">
              {wish.category}
            </span>
          )}
        </div>
        <button
          onClick={onRemove}
          className="-m-2 p-2 text-ink-400 hover:text-pink-700 transition-colors flex-shrink-0"
          aria-label="Remove"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="wordmark italic text-lg text-ink-900 leading-tight mb-1">
        {wish.description}
      </div>

      {wish.reason && (
        <p className="text-sm text-ink-600 leading-relaxed mb-2">{wish.reason}</p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400 mt-2">
        {wish.price_range && <span>{wish.price_range}</span>}
        {wish.brand_suggestions?.length > 0 && (
          <span>{wish.brand_suggestions.join(', ')}</span>
        )}
      </div>

      {wish.link && (
        <a
          href={wish.link}
          target="_blank"
          rel="noreferrer"
          className="btn-link mt-3 inline-flex items-center gap-1 text-sm"
        >
          Open link <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending suggestion card — shows AI gap-analysis idea, with an inline
// "Find specific products" action that runs a web-search-powered query and
// lets the user save any of the found products directly as a wishlist item.
// ---------------------------------------------------------------------------
interface FoundProduct {
  title: string;
  brand: string | null;
  price: string | null;
  url: string;
  source: string;
  notes: string | null;
}

function PendingSuggestionCard({
  suggestion,
  onDismiss,
  onAccept,
  onAcceptProduct,
}: {
  suggestion: any;
  onDismiss: () => void;
  onAccept: () => void;
  onAcceptProduct: (p: FoundProduct) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [products, setProducts] = useState<FoundProduct[] | null>(null);
  const [searchSummary, setSearchSummary] = useState<string>('');
  const [searchedQueries, setSearchedQueries] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());

  async function findProducts() {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch('/api/ai/wishlist-find-products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: suggestion.description,
          category: suggestion.category,
          reason: suggestion.reason,
          brand_suggestions: suggestion.brand_suggestions ?? [],
          price_range: suggestion.price_range,
        }),
      });
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      const json = await res.json();
      setProducts(json.products ?? []);
      setSearchSummary(json.summary ?? '');
      setSearchedQueries(json.searched_queries ?? []);
    } catch (e: any) {
      setSearchError(e.message ?? 'search failed');
    } finally {
      setSearching(false);
    }
  }

  function handleAcceptProduct(p: FoundProduct) {
    onAcceptProduct(p);
    setAddedUrls((prev) => new Set(prev).add(p.url));
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="wordmark italic text-lg text-ink-900">{suggestion.description}</div>
        <button
          onClick={onDismiss}
          className="-m-2 p-2 text-ink-400 hover:text-pink-700 transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {suggestion.reason && (
        <p className="text-sm text-ink-600 leading-relaxed mb-3">{suggestion.reason}</p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-ink-400 mb-4">
        {suggestion.category && (
          <span>Category: <span className="text-ink-600">{suggestion.category}</span></span>
        )}
        {suggestion.price_range && (
          <span>Price: <span className="text-ink-600">{suggestion.price_range}</span></span>
        )}
        {suggestion.brand_suggestions?.length > 0 && (
          <span>Brands: <span className="text-ink-600">{suggestion.brand_suggestions.join(', ')}</span></span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={onAccept} className="btn-ghost">Save idea to wishlist</button>
        {!products && !searching && (
          <button onClick={findProducts} className="btn inline-flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" />
            Find specific products
          </button>
        )}
        {searching && (
          <div className="inline-flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-[0.15em] text-pink-700">
            <Globe className="w-3.5 h-3.5 animate-pulse" />
            Searching the web…
          </div>
        )}
      </div>

      {searchError && (
        <p className="text-sm text-pink-700 mt-3">{searchError}</p>
      )}

      {products && (
        <div className="mt-5 pt-5 border-t border-pink-100">
          <div className="flex items-center justify-between mb-3">
            <div className="eyebrow">— Found on the web —</div>
            <button
              onClick={findProducts}
              className="text-[10px] uppercase tracking-[0.15em] text-pink-700 hover:text-pink-500"
            >
              Search again
            </button>
          </div>

          {searchSummary && (
            <p className="text-sm text-ink-600 italic mb-3">{searchSummary}</p>
          )}

          {products.length === 0 ? (
            <p className="text-sm text-ink-400">
              No good matches found. Try adjusting the idea or searching again.
            </p>
          ) : (
            <div className="space-y-2">
              {products.map((p, idx) => (
                <ProductRow
                  key={`${p.url}-${idx}`}
                  product={p}
                  added={addedUrls.has(p.url)}
                  onAdd={() => handleAcceptProduct(p)}
                />
              ))}
            </div>
          )}

          {searchedQueries.length > 0 && (
            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-ink-400 mb-2">
                Searches run
              </div>
              <ul className="space-y-1">
                {searchedQueries.map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-ink-600">
                    <span className="text-pink-400 mt-1.5 leading-none">·</span>
                    <span className="italic">{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  added,
  onAdd,
}: {
  product: FoundProduct;
  added: boolean;
  onAdd: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 bg-pink-50 border border-pink-100"
      style={{ borderRadius: '3px' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ink-900 hover:text-pink-700 transition-colors font-medium truncate"
          >
            {product.title}
          </a>
          <ExternalLink className="w-3 h-3 text-ink-400 flex-shrink-0" />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-ink-600">
          {product.brand && <span className="font-medium">{product.brand}</span>}
          {product.price && <span className="text-pink-700">{product.price}</span>}
          <span className="text-ink-400">{product.source}</span>
        </div>
        {product.notes && (
          <p className="text-xs text-ink-600 italic mt-1">{product.notes}</p>
        )}
      </div>

      <button
        onClick={onAdd}
        disabled={added}
        className={`flex-shrink-0 self-center text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 transition-all ${
          added
            ? 'text-pink-700 cursor-default'
            : 'text-pink-700 border border-pink-300 hover:bg-pink-100 hover:border-pink-500'
        }`}
        style={{ borderRadius: '2px' }}
      >
        {added ? '✓ Added' : (
          <span className="inline-flex items-center gap-1">
            Save <ChevronRight className="w-3 h-3" />
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add dialog — description, link, price, notes. No image.
// ---------------------------------------------------------------------------
function AddDialog({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!description) return;
    setSaving(true);
    try {
      await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description,
          link: link || undefined,
          price_range: priceRange || undefined,
          notes: notes || undefined,
        }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-md p-6 animate-fade-up"
        style={{ borderRadius: '4px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow mb-1">Add to wishlist</div>
        <h2 className="wordmark italic text-2xl mb-6 text-ink-900">What are you looking for?</h2>
        <div className="space-y-4">
          <input
            autoFocus
            placeholder="silk slip skirt in bone"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
          />
          <input
            placeholder="Link (optional)"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            className="input"
          />
          <input
            placeholder="Price range (optional)"
            value={priceRange}
            onChange={(e) => setPriceRange(e.target.value)}
            className="input"
          />
          <textarea
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input min-h-[60px] resize-none"
          />
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={!description || saving}
              className="btn flex-1 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
