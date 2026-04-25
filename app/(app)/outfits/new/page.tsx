'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Check } from 'lucide-react';

/**
 * Visual outfit builder.
 *
 * Layout (3-column × 4-row grid):
 *
 *   [        ] [outerwear] [        ]
 *   [        ] [   top   ] [        ]
 *   [ purse  ] [  pants  ] [accessory]
 *   [        ] [  shoes  ] [        ]
 *
 * Outerwear sits above the top because it layers over it. Purse and
 * accessory hold the side positions per the user's requested layout.
 * The pants slot is automatically hidden when a dress is selected for
 * the top slot, since dresses occupy both shirt and pants positions.
 *
 * Each slot is a square card. Tap an empty slot to open a category-
 * filtered picker; tap a filled slot to swap or clear it.
 */

type Category = 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';

interface Item {
  id: string;
  category: Category;
  sub_category: string | null;
  name: string | null;
  brand: string | null;
  thumb_path: string | null;
  image_nobg_path: string | null;
  image_path: string | null;
}

// Logical slots in the outfit, distinct from item categories. The "top"
// slot accepts both shirts AND dresses; the "pants" slot accepts pants only
// and is auto-hidden if a dress is selected.
type Slot = 'outerwear' | 'top' | 'purse' | 'pants' | 'accessory' | 'shoes';

const SLOT_LABELS: Record<Slot, string> = {
  outerwear: 'Outerwear',
  top: 'Shirt or dress',
  purse: 'Purse',
  pants: 'Pants',
  accessory: 'Accessory',
  shoes: 'Shoes',
};

// Which item categories are valid for each slot
const SLOT_CATEGORIES: Record<Slot, Category[]> = {
  outerwear: ['outerwear'],
  top: ['shirt', 'dress'],
  purse: ['purse'],
  pants: ['pants'],
  accessory: ['accessory'],
  shoes: ['shoes'],
};

export default function NewOutfitPage() {
  const router = useRouter();
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // The current outfit composition — each slot maps to an item or null.
  const [picks, setPicks] = useState<Record<Slot, Item | null>>({
    outerwear: null,
    top: null,
    purse: null,
    pants: null,
    accessory: null,
    shoes: null,
  });

  // Picker state: which slot the user is currently filling
  const [pickerSlot, setPickerSlot] = useState<Slot | null>(null);

  // Date this outfit is being worn (defaults to today)
  const [wornOn, setWornOn] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/items')
      .then((r) => r.json())
      .then((j) => {
        setAllItems(j.items ?? []);
        setLoading(false);
      });
  }, []);

  // Hide the pants slot when a dress occupies the top slot
  const dressInTop = picks.top?.category === 'dress';

  // Items available for the currently-open picker, filtered by slot category
  const pickerItems = useMemo<Item[]>(() => {
    if (!pickerSlot) return [];
    const allowed = SLOT_CATEGORIES[pickerSlot];
    return allItems
      .filter((it) => allowed.includes(it.category))
      // Sort favorites first, then by category then name for stable ordering
      .sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
  }, [pickerSlot, allItems]);

  function pick(slot: Slot, item: Item | null) {
    setPicks((p) => {
      const next = { ...p, [slot]: item };
      // If we just placed a dress in the top slot, automatically clear pants —
      // a dress occupies both positions
      if (slot === 'top' && item?.category === 'dress') {
        next.pants = null;
      }
      return next;
    });
    setPickerSlot(null);
  }

  function clearSlot(slot: Slot) {
    setPicks((p) => ({ ...p, [slot]: null }));
  }

  const allPicked = Object.values(picks).filter(Boolean) as Item[];
  const canSave = allPicked.length > 0 && !!wornOn;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/wears', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item_ids: allPicked.map((i) => i.id),
          worn_on: wornOn,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      router.push('/outfits');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-6 py-8 pb-32 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="eyebrow mb-1">Build an outfit</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">
            Pick the pieces
          </h1>
        </div>
        <button
          onClick={() => router.push('/outfits')}
          className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </div>

      {loading ? (
        <div className="text-ink-400 text-sm">Loading your closet…</div>
      ) : (
        <>
          {/* Body-layout grid */}
          <div className="card p-4 md:p-8 bg-pink-50/30 mb-6">
            <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-md mx-auto">
              {/* Row 1: outerwear floats above the top, in column 1 */}
              <SlotCard
                slot="outerwear"
                item={picks.outerwear}
                onPick={() => setPickerSlot('outerwear')}
                onClear={() => clearSlot('outerwear')}
              />
              <SlotCard
                slot="top"
                item={picks.top}
                onPick={() => setPickerSlot('top')}
                onClear={() => clearSlot('top')}
              />
              <div /> {/* empty col 3 */}

              {/* Row 2: purse, pants (or empty if dress), accessory */}
              <SlotCard
                slot="purse"
                item={picks.purse}
                onPick={() => setPickerSlot('purse')}
                onClear={() => clearSlot('purse')}
              />
              {dressInTop ? (
                <div className="aspect-square flex items-center justify-center text-[10px] uppercase tracking-[0.15em] text-ink-300 text-center px-2">
                  (Dress covers this)
                </div>
              ) : (
                <SlotCard
                  slot="pants"
                  item={picks.pants}
                  onPick={() => setPickerSlot('pants')}
                  onClear={() => clearSlot('pants')}
                />
              )}
              <SlotCard
                slot="accessory"
                item={picks.accessory}
                onPick={() => setPickerSlot('accessory')}
                onClear={() => clearSlot('accessory')}
              />

              {/* Row 3: shoes centered */}
              <div /> {/* empty col 1 */}
              <SlotCard
                slot="shoes"
                item={picks.shoes}
                onPick={() => setPickerSlot('shoes')}
                onClear={() => clearSlot('shoes')}
              />
              <div /> {/* empty col 3 */}
            </div>
          </div>

          {/* Date + notes */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="label block mb-2">Worn on</label>
              <input
                type="date"
                value={wornOn}
                onChange={(e) => setWornOn(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label block mb-2">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Brunch with mom, felt great, wore the new boots…"
                className="input"
                rows={3}
              />
            </div>
          </div>

          {errorMsg && (
            <div className="card-pink p-3 text-sm text-ink-800 mb-4">{errorMsg}</div>
          )}

          {/* Sticky save bar at the bottom */}
          <div
            className="fixed bottom-20 left-0 right-0 bg-white border-t border-pink-200 p-4 z-30"
            style={{ boxShadow: '0 -4px 20px -8px rgba(176, 20, 86, 0.15)' }}
          >
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 px-2">
              <div className="text-sm text-ink-600">
                <strong className="text-ink-900">{allPicked.length}</strong>{' '}
                piece{allPicked.length === 1 ? '' : 's'}
              </div>
              <button onClick={save} disabled={!canSave || saving} className="btn disabled:opacity-50">
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save outfit'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Picker bottom sheet */}
      {pickerSlot && (
        <PickerSheet
          slot={pickerSlot}
          items={pickerItems}
          onPick={(item) => pick(pickerSlot, item)}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  item,
  onPick,
  onClear,
}: {
  slot: Slot;
  item: Item | null;
  onPick: () => void;
  onClear: () => void;
}) {
  if (!item) {
    return (
      <button
        onClick={onPick}
        className="aspect-square border-2 border-dashed border-pink-200 hover:border-pink-400 hover:bg-pink-50 flex flex-col items-center justify-center transition-colors group"
        style={{ borderRadius: '4px' }}
      >
        <Plus className="w-5 h-5 text-pink-300 group-hover:text-pink-500 mb-1" strokeWidth={1.5} />
        <span className="text-[10px] uppercase tracking-[0.15em] text-ink-400 px-1 text-center">
          {SLOT_LABELS[slot]}
        </span>
      </button>
    );
  }

  // Prefer the bg-removed PNG; fall back to thumb or original
  const imgPath = item.image_nobg_path ?? item.thumb_path ?? item.image_path;

  return (
    <div className="relative aspect-square card overflow-hidden bg-pink-50">
      {imgPath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/images/${imgPath}`}
          alt={item.name ?? ''}
          className="w-full h-full object-contain"
        />
      )}
      {/* Tap whole card to swap; clear button stops propagation */}
      <button
        onClick={onPick}
        className="absolute inset-0"
        aria-label={`Change ${SLOT_LABELS[slot]}`}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="absolute top-1 right-1 w-6 h-6 bg-white/90 hover:bg-pink-500 hover:text-white text-ink-600 flex items-center justify-center shadow-sm transition-colors"
        style={{ borderRadius: '999px' }}
        aria-label={`Remove ${SLOT_LABELS[slot]}`}
      >
        <X className="w-3 h-3" strokeWidth={2} />
      </button>
      {item.name && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 pointer-events-none">
          <div className="text-[10px] text-white truncate font-medium">{item.name}</div>
        </div>
      )}
    </div>
  );
}

function PickerSheet({
  slot,
  items,
  onPick,
  onClose,
}: {
  slot: Slot;
  items: Item[];
  onPick: (item: Item) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="fixed inset-0 bg-black/30 z-40 animate-fade-up"
        aria-label="Close picker"
      />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white z-50 border-t-2 border-pink-200 max-h-[80vh] flex flex-col animate-fade-up">
        <div className="flex items-center justify-between p-4 border-b border-ivory-200">
          <div>
            <div className="eyebrow mb-0.5">Pick a piece</div>
            <div className="wordmark italic text-2xl text-ink-900">{SLOT_LABELS[slot]}</div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="text-sm text-ink-400 text-center py-12">
              No {SLOT_LABELS[slot].toLowerCase()} pieces in your closet yet.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {items.map((it) => (
                <PickerItemCard key={it.id} item={it} onPick={() => onPick(it)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PickerItemCard({ item, onPick }: { item: Item; onPick: () => void }) {
  const imgPath = item.image_nobg_path ?? item.thumb_path ?? item.image_path;
  return (
    <button
      onClick={onPick}
      className="text-left card overflow-hidden hover:ring-2 hover:ring-pink-400 transition-all bg-pink-50"
    >
      <div className="aspect-square">
        {imgPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${imgPath}`}
            alt={item.name ?? ''}
            className="w-full h-full object-contain"
          />
        )}
      </div>
      <div className="p-2">
        <div className="text-xs text-ink-800 truncate font-medium">
          {item.name ?? item.sub_category ?? item.category}
        </div>
        {item.brand && (
          <div className="text-[10px] text-ink-400 truncate">{item.brand}</div>
        )}
      </div>
    </button>
  );
}
