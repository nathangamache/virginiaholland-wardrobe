'use client';

import { useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Check, Trash2 } from 'lucide-react';
import { useDialog } from '@/components/DialogProvider';

/**
 * Edit an existing outfit wear.
 *
 * Same visual layout as /outfits/new — body-position grid with category-
 * filtered slot pickers — but pre-populated from the existing wear and
 * saving via PATCH instead of POST. Also offers a Delete action.
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

type Slot = 'outerwear' | 'top' | 'purse' | 'pants' | 'accessory' | 'shoes';

const SLOT_LABELS: Record<Slot, string> = {
  outerwear: 'Outerwear',
  top: 'Shirt or dress',
  purse: 'Purse',
  pants: 'Pants',
  accessory: 'Accessory',
  shoes: 'Shoes',
};

const SLOT_CATEGORIES: Record<Slot, Category[]> = {
  outerwear: ['outerwear'],
  top: ['shirt', 'dress'],
  purse: ['purse'],
  pants: ['pants'],
  accessory: ['accessory'],
  shoes: ['shoes'],
};

/**
 * Map a list of item IDs onto the body-position slots. We classify each item
 * by its category and place it into its natural slot. If two items would
 * map to the same slot (e.g. two shirts), the later one wins — but in
 * practice each slot holds at most one item per outfit so this is rare.
 */
function mapItemsToSlots(items: Item[]): Record<Slot, Item | null> {
  const slots: Record<Slot, Item | null> = {
    outerwear: null,
    top: null,
    purse: null,
    pants: null,
    accessory: null,
    shoes: null,
  };
  for (const item of items) {
    switch (item.category) {
      case 'outerwear':
        slots.outerwear = item;
        break;
      case 'shirt':
      case 'dress':
        slots.top = item;
        break;
      case 'purse':
        slots.purse = item;
        break;
      case 'pants':
        slots.pants = item;
        break;
      case 'accessory':
        slots.accessory = item;
        break;
      case 'shoes':
        slots.shoes = item;
        break;
    }
  }
  return slots;
}

export default function EditWearPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { confirm } = useDialog();

  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [picks, setPicks] = useState<Record<Slot, Item | null>>({
    outerwear: null,
    top: null,
    purse: null,
    pants: null,
    accessory: null,
    shoes: null,
  });
  const [pickerSlot, setPickerSlot] = useState<Slot | null>(null);
  const [wornOn, setWornOn] = useState<string>('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load both the wear and the full item catalog (needed for the picker)
  useEffect(() => {
    (async () => {
      try {
        const [wearRes, itemsRes] = await Promise.all([
          fetch(`/api/wears/${id}`).then((r) => r.json()),
          fetch('/api/items').then((r) => r.json()),
        ]);
        if (wearRes.error) {
          setNotFound(true);
          return;
        }
        const items: Item[] = itemsRes.items ?? [];
        setAllItems(items);

        // Place existing items into their slots
        const wear = wearRes.wear;
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const wornItems: Item[] = (wear.item_ids ?? [])
          .map((wid: string) => itemMap.get(wid))
          .filter((i: Item | undefined): i is Item => Boolean(i));

        setPicks(mapItemsToSlots(wornItems));
        setWornOn(wear.worn_on);
        setNotes(wear.notes ?? '');
      } catch (e) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const dressInTop = picks.top?.category === 'dress';

  const pickerItems = useMemo<Item[]>(() => {
    if (!pickerSlot) return [];
    const allowed = SLOT_CATEGORIES[pickerSlot];
    return allItems
      .filter((it) => allowed.includes(it.category))
      .sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
  }, [pickerSlot, allItems]);

  function pick(slot: Slot, item: Item | null) {
    setPicks((p) => {
      const next = { ...p, [slot]: item };
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
      const res = await fetch(`/api/wears/${id}`, {
        method: 'PATCH',
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

  async function remove() {
    const ok = await confirm({
      title: 'Delete this outfit?',
      body: 'It will be removed from your history. Wear counts on the included items will be decremented.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/wears/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      router.push('/outfits');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Delete failed');
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-600 mb-4">Outfit not found.</p>
          <button onClick={() => router.push('/outfits')} className="btn">
            Back to outfits
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 pb-32 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="eyebrow mb-1">Edit outfit</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">
            Adjust pieces
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
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : (
        <>
          {/* Body-layout grid */}
          <div className="card p-4 md:p-8 bg-pink-50/30 mb-6">
            <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-md mx-auto">
              <SlotCard slot="outerwear" item={picks.outerwear} onPick={() => setPickerSlot('outerwear')} onClear={() => clearSlot('outerwear')} />
              <SlotCard slot="top" item={picks.top} onPick={() => setPickerSlot('top')} onClear={() => clearSlot('top')} />
              <div />

              <SlotCard slot="purse" item={picks.purse} onPick={() => setPickerSlot('purse')} onClear={() => clearSlot('purse')} />
              {dressInTop ? (
                <div className="aspect-square flex items-center justify-center text-[10px] uppercase tracking-[0.15em] text-ink-300 text-center px-2">
                  (Dress covers this)
                </div>
              ) : (
                <SlotCard slot="pants" item={picks.pants} onPick={() => setPickerSlot('pants')} onClear={() => clearSlot('pants')} />
              )}
              <SlotCard slot="accessory" item={picks.accessory} onPick={() => setPickerSlot('accessory')} onClear={() => clearSlot('accessory')} />

              <div />
              <SlotCard slot="shoes" item={picks.shoes} onPick={() => setPickerSlot('shoes')} onClear={() => clearSlot('shoes')} />
              <div />
            </div>
          </div>

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
              <label className="label block mb-2">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Brunch with mom, felt great, wore the new boots…"
                className="input"
                rows={3}
              />
            </div>
          </div>

          <div className="mb-6">
            <button
              onClick={remove}
              disabled={deleting}
              className="text-xs uppercase tracking-[0.15em] inline-flex items-center gap-1.5 text-pink-700 hover:text-pink-500 disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              {deleting ? 'Deleting…' : 'Delete this outfit'}
            </button>
          </div>

          {errorMsg && (
            <div className="card-pink p-3 text-sm text-ink-800 mb-4">{errorMsg}</div>
          )}

          {/* Sticky save bar */}
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
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </>
      )}

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
      <button
        onClick={onClose}
        className="fixed inset-0 bg-black/30 z-40 animate-fade-up"
        aria-label="Close picker"
      />
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
