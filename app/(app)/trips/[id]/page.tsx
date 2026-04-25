'use client';

import { useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  X, MapPin, Calendar, Cloud, Plus, Trash2, RefreshCw, Edit3, Check,
  AlertCircle, Pencil,
} from 'lucide-react';
import { format } from 'date-fns';
import { useDialog } from '@/components/DialogProvider';
import { ItemCard } from '@/components/ItemCard';

/**
 * Per-trip detail + edit page.
 *
 * Sections:
 *   1. Header — trip name + destination, with inline edit modal for the
 *      basic metadata (name, dates, occasions, notes)
 *   2. Weather forecast strip — daily highs/lows and conditions
 *   3. Packing list — "What to pack" grid; the user can add or remove
 *      items here. Items in the packing list aren't tied to specific days.
 *   4. Day outfits — per-day cards showing the AI-suggested outfit using
 *      the visual body-layout grid. Tapping any slot opens a picker so the
 *      user can swap that piece.
 *   5. Footer actions — regenerate plan with AI, delete trip
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

interface DayOutfit {
  date: string;
  outfit_item_ids: string[];
  reasoning?: string;
}

interface GeneratedOutfits {
  selected_item_ids?: string[];
  day_outfits?: DayOutfit[];
  packing_notes?: string;
}

interface WeatherDay {
  date: string;
  temp_min_f: number;
  temp_max_f: number;
  summary: string;
  precip_chance: number;
}

interface Trip {
  id: string;
  name: string;
  destination: string;
  destination_lat: number;
  destination_lon: number;
  start_date: string;
  end_date: string;
  occasions: string[];
  selected_item_ids: string[];
  generated_outfits: GeneratedOutfits | null;
  weather_forecast: WeatherDay[] | null;
  notes: string | null;
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

function categoryToSlot(cat: Category): Slot {
  if (cat === 'shirt' || cat === 'dress') return 'top';
  if (cat === 'outerwear') return 'outerwear';
  if (cat === 'purse') return 'purse';
  if (cat === 'pants') return 'pants';
  if (cat === 'accessory') return 'accessory';
  if (cat === 'shoes') return 'shoes';
  return 'top';
}

export default function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { confirm, alert } = useDialog();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editingMeta, setEditingMeta] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [packingPickerOpen, setPackingPickerOpen] = useState(false);
  const [dayPicker, setDayPicker] = useState<{ date: string; slot: Slot } | null>(null);

  async function load() {
    try {
      const [tripRes, itemsRes] = await Promise.all([
        fetch(`/api/trips/${id}`).then((r) => r.json()),
        fetch('/api/items').then((r) => r.json()),
      ]);
      if (tripRes.error) {
        setNotFound(true);
        return;
      }
      setTrip(tripRes.trip);
      const items: Item[] = itemsRes.items ?? [];
      setAllItems(items);
      setItemMap(new Map(items.map((i) => [i.id, i])));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  /**
   * Persist a partial trip update to the server, then update local state.
   * Helper to avoid repeating fetch+state plumbing for every edit action.
   */
  async function persist(patch: Partial<Trip>) {
    if (!trip) return;
    const optimistic: Trip = { ...trip, ...patch };
    setTrip(optimistic);
    try {
      const res = await fetch(`/api/trips/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Update failed (${res.status})`);
      }
    } catch (e: any) {
      // Roll back on failure and surface the error
      setTrip(trip);
      await alert({
        title: 'Could not save',
        body: e?.message ?? 'Something went wrong saving the trip.',
      });
    }
  }

  // ----- Packing list management -----

  function addToPackingList(item: Item) {
    if (!trip) return;
    if (trip.selected_item_ids.includes(item.id)) return;
    persist({ selected_item_ids: [...trip.selected_item_ids, item.id] });
    setPackingPickerOpen(false);
  }

  function removeFromPackingList(itemId: string) {
    if (!trip) return;
    persist({
      selected_item_ids: trip.selected_item_ids.filter((i) => i !== itemId),
    });
  }

  // ----- Day outfit editing -----

  /**
   * Replace one item in a specific day's outfit. We figure out which existing
   * item to remove based on category overlap (so picking a new shirt replaces
   * the old shirt, picking a new dress replaces the shirt+pants, etc.)
   */
  function setDayOutfitItem(date: string, slot: Slot, newItem: Item) {
    if (!trip) return;
    const existing = trip.generated_outfits?.day_outfits ?? [];
    const updated = existing.map((d) => {
      if (d.date !== date) return d;

      // Existing items in this day's outfit
      const existingItems = d.outfit_item_ids
        .map((iid) => itemMap.get(iid))
        .filter((i): i is Item => Boolean(i));

      // Remove any existing item whose category maps to this slot.
      // Special case: if the new item is a dress, also remove pants from the outfit
      // since the dress occupies both slots. If the new item is a shirt, remove
      // any existing dress (since it was occupying the top slot).
      const filtered = existingItems.filter((it) => {
        const itSlot = categoryToSlot(it.category);
        if (itSlot === slot) return false;
        if (newItem.category === 'dress' && it.category === 'pants') return false;
        if (newItem.category !== 'dress' && it.category === 'dress' && slot === 'top') return false;
        return true;
      });

      const newIds = [...filtered.map((i) => i.id), newItem.id];
      return { ...d, outfit_item_ids: newIds };
    });
    persist({
      generated_outfits: { ...(trip.generated_outfits ?? {}), day_outfits: updated },
    });
    setDayPicker(null);
  }

  function clearDayOutfitSlot(date: string, slot: Slot) {
    if (!trip) return;
    const existing = trip.generated_outfits?.day_outfits ?? [];
    const updated = existing.map((d) => {
      if (d.date !== date) return d;
      const filtered = d.outfit_item_ids.filter((iid) => {
        const item = itemMap.get(iid);
        if (!item) return true;
        return categoryToSlot(item.category) !== slot;
      });
      return { ...d, outfit_item_ids: filtered };
    });
    persist({
      generated_outfits: { ...(trip.generated_outfits ?? {}), day_outfits: updated },
    });
  }

  // ----- Trip-level actions -----

  async function regenerate() {
    const ok = await confirm({
      title: 'Regenerate packing plan?',
      body: 'This will use AI to build a fresh plan based on your current closet and trip details. Any manual edits to days or the packing list will be replaced.',
      confirmLabel: 'Regenerate',
    });
    if (!ok) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/trips/${id}/regenerate`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Regeneration failed (${res.status})`);
      }
      await load();
    } catch (e: any) {
      await alert({
        title: 'Could not regenerate',
        body: e?.message ?? 'Try again in a moment.',
      });
    } finally {
      setRegenerating(false);
    }
  }

  async function deleteTrip() {
    const ok = await confirm({
      title: 'Delete this trip?',
      body: 'The trip and all its packing data will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/trips/${id}`, { method: 'DELETE' });
    router.push('/trips');
  }

  // ----- Render -----

  if (notFound) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-600 mb-4">Trip not found.</p>
          <button onClick={() => router.push('/trips')} className="btn">Back to trips</button>
        </div>
      </div>
    );
  }

  if (loading || !trip) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="text-ink-400 text-sm">Loading…</div>
      </div>
    );
  }

  const hasGenerated =
    !!trip.generated_outfits &&
    (trip.generated_outfits.day_outfits?.length || 0) > 0;
  const packingItems = trip.selected_item_ids
    .map((iid) => itemMap.get(iid))
    .filter((i): i is Item => Boolean(i));

  return (
    <div className="px-6 py-8 pb-24 max-w-4xl mx-auto">
      {/* ===== Header ===== */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0">
          <div className="eyebrow mb-1 flex items-center gap-1.5 text-pink-700">
            <MapPin className="w-3 h-3" /> {trip.destination}
          </div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900 mb-2">
            {trip.name}
          </h1>
          <p className="text-sm text-ink-600 flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            {format(new Date(trip.start_date), 'MMM d')} – {format(new Date(trip.end_date), 'MMM d, yyyy')}
            {trip.occasions.length > 0 && (
              <span className="text-ink-400 ml-2">· {trip.occasions.join(', ')}</span>
            )}
          </p>
          {trip.notes && (
            <p className="text-sm text-ink-600 italic mt-2 leading-relaxed">{trip.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditingMeta(true)}
            className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
            aria-label="Edit trip details"
            title="Edit trip details"
          >
            <Pencil className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button
            onClick={() => router.push('/trips')}
            className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ===== Weather forecast ===== */}
      {trip.weather_forecast && trip.weather_forecast.length > 0 && (
        <div className="card p-4 mb-6">
          <div className="label flex items-center gap-1.5 mb-3">
            <Cloud className="w-3 h-3" /> Forecast
          </div>
          <div className="overflow-x-auto -mx-2 px-2">
            <div className="flex gap-3 min-w-min">
              {trip.weather_forecast.map((d) => (
                <div key={d.date} className="text-center flex-shrink-0 w-20">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-ink-400 mb-1">
                    {format(new Date(d.date), 'EEE M/d')}
                  </div>
                  <div className="text-lg font-display text-ink-800">
                    {Math.round(d.temp_max_f)}°
                  </div>
                  <div className="text-[10px] text-ink-500">
                    {Math.round(d.temp_min_f)}°
                  </div>
                  <div className="text-[10px] text-ink-600 mt-1 truncate" title={d.summary}>
                    {d.summary}
                  </div>
                  {d.precip_chance > 30 && (
                    <div className="text-[10px] text-pink-700 mt-0.5">
                      {d.precip_chance}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== AI generation status / packing notes ===== */}
      {!hasGenerated && (
        <div className="card-pink p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-pink-700 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm text-ink-800 mb-2">
              No AI packing plan yet. Generate one or build the plan manually.
            </div>
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="btn py-1.5 px-3 text-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Generating…' : 'Generate with AI'}
            </button>
          </div>
        </div>
      )}

      {trip.generated_outfits?.packing_notes && (
        <p className="text-sm text-ink-600 italic border-l border-ivory-300 pl-4 mb-6 leading-relaxed">
          {trip.generated_outfits.packing_notes}
        </p>
      )}

      {/* ===== Packing list ===== */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <div className="label">What to pack ({packingItems.length})</div>
          <button
            onClick={() => setPackingPickerOpen(true)}
            className="btn-ghost py-1 px-2.5 text-[10px]"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {packingItems.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-400">
            Nothing on the packing list yet. Tap “Add” to pick pieces.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {packingItems.map((it) => (
              <PackingTile
                key={it.id}
                item={it}
                onRemove={() => removeFromPackingList(it.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ===== Day-by-day outfits ===== */}
      {hasGenerated && (
        <section className="mb-10">
          <div className="label mb-4">Day by day</div>
          <div className="space-y-6">
            {(trip.generated_outfits!.day_outfits ?? []).map((d) => (
              <DayCard
                key={d.date}
                day={d}
                itemMap={itemMap}
                onPickSlot={(slot) => setDayPicker({ date: d.date, slot })}
                onClearSlot={(slot) => clearDayOutfitSlot(d.date, slot)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ===== Footer actions ===== */}
      <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-ivory-200">
        {hasGenerated && (
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="btn-ghost py-2 px-3 text-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
            {regenerating ? 'Regenerating…' : 'Regenerate plan'}
          </button>
        )}
        <button
          onClick={deleteTrip}
          className="text-xs uppercase tracking-[0.15em] inline-flex items-center gap-1.5 text-pink-700 hover:text-pink-500 ml-auto"
        >
          <Trash2 className="w-3 h-3" />
          Delete trip
        </button>
      </div>

      {/* ===== Modals ===== */}
      {editingMeta && (
        <EditMetaDialog
          trip={trip}
          onClose={() => setEditingMeta(false)}
          onSave={(patch) => {
            persist(patch);
            setEditingMeta(false);
          }}
        />
      )}
      {packingPickerOpen && (
        <ItemPicker
          title="Add to packing list"
          items={allItems.filter((it) => !trip.selected_item_ids.includes(it.id))}
          onPick={addToPackingList}
          onClose={() => setPackingPickerOpen(false)}
        />
      )}
      {dayPicker && (
        <ItemPicker
          title={`${SLOT_LABELS[dayPicker.slot]} for ${format(new Date(dayPicker.date), 'EEE, MMM d')}`}
          items={allItems.filter((it) =>
            SLOT_CATEGORIES[dayPicker.slot].includes(it.category)
          )}
          onPick={(item) => setDayOutfitItem(dayPicker.date, dayPicker.slot, item)}
          onClose={() => setDayPicker(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PackingTile({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const imgPath = item.image_nobg_path ?? item.thumb_path ?? item.image_path;
  return (
    <div className="relative group">
      <div className="aspect-square card overflow-hidden bg-pink-50">
        {imgPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${imgPath}`}
            alt={item.name ?? ''}
            className="w-full h-full object-contain"
          />
        )}
      </div>
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 w-6 h-6 bg-white/90 hover:bg-pink-500 hover:text-white text-ink-600 flex items-center justify-center shadow-sm transition-colors [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        style={{ borderRadius: '999px' }}
        aria-label="Remove from packing list"
      >
        <X className="w-3 h-3" strokeWidth={2} />
      </button>
      {item.name && (
        <div className="text-[10px] text-ink-600 truncate mt-1 px-1">{item.name}</div>
      )}
    </div>
  );
}

function DayCard({
  day,
  itemMap,
  onPickSlot,
  onClearSlot,
}: {
  day: DayOutfit;
  itemMap: Map<string, Item>;
  onPickSlot: (slot: Slot) => void;
  onClearSlot: (slot: Slot) => void;
}) {
  // Map this day's items into the body-layout slots
  const slots: Record<Slot, Item | null> = {
    outerwear: null,
    top: null,
    purse: null,
    pants: null,
    accessory: null,
    shoes: null,
  };
  for (const iid of day.outfit_item_ids) {
    const item = itemMap.get(iid);
    if (!item) continue;
    const slot = categoryToSlot(item.category);
    slots[slot] = item;
  }
  const dressInTop = slots.top?.category === 'dress';

  return (
    <div className="card p-4 md:p-6">
      <div className="font-display text-lg mb-3">
        {format(new Date(day.date), 'EEE, MMM d')}
      </div>
      <div className="grid grid-cols-3 gap-2 md:gap-3 max-w-sm mx-auto mb-3">
        <SlotCard slot="outerwear" item={slots.outerwear} onPick={() => onPickSlot('outerwear')} onClear={() => onClearSlot('outerwear')} />
        <SlotCard slot="top" item={slots.top} onPick={() => onPickSlot('top')} onClear={() => onClearSlot('top')} />
        <div />

        <SlotCard slot="purse" item={slots.purse} onPick={() => onPickSlot('purse')} onClear={() => onClearSlot('purse')} />
        {dressInTop ? (
          <div className="aspect-square flex items-center justify-center text-[10px] uppercase tracking-[0.15em] text-ink-300 text-center px-2">
            (Dress covers this)
          </div>
        ) : (
          <SlotCard slot="pants" item={slots.pants} onPick={() => onPickSlot('pants')} onClear={() => onClearSlot('pants')} />
        )}
        <SlotCard slot="accessory" item={slots.accessory} onPick={() => onPickSlot('accessory')} onClear={() => onClearSlot('accessory')} />

        <div />
        <SlotCard slot="shoes" item={slots.shoes} onPick={() => onPickSlot('shoes')} onClear={() => onClearSlot('shoes')} />
        <div />
      </div>
      {day.reasoning && (
        <p className="text-sm text-ink-600 italic leading-relaxed">{day.reasoning}</p>
      )}
    </div>
  );
}

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
        <Plus className="w-4 h-4 text-pink-300 group-hover:text-pink-500 mb-0.5" strokeWidth={1.5} />
        <span className="text-[9px] uppercase tracking-[0.12em] text-ink-400 px-1 text-center">
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
      <button onClick={onPick} className="absolute inset-0" aria-label="Change" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="absolute top-1 right-1 w-6 h-6 bg-white/90 hover:bg-pink-500 hover:text-white text-ink-600 flex items-center justify-center shadow-sm transition-colors"
        style={{ borderRadius: '999px' }}
        aria-label="Clear slot"
      >
        <X className="w-3 h-3" strokeWidth={2} />
      </button>
    </div>
  );
}

function ItemPicker({
  title,
  items,
  onPick,
  onClose,
}: {
  title: string;
  items: Item[];
  onPick: (item: Item) => void;
  onClose: () => void;
}) {
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return (a.name ?? '').localeCompare(b.name ?? '');
      }),
    [items]
  );

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
            <div className="wordmark italic text-2xl text-ink-900">{title}</div>
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
          {sorted.length === 0 ? (
            <div className="text-sm text-ink-400 text-center py-12">
              No matching pieces in your closet.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {sorted.map((it) => {
                const imgPath = it.image_nobg_path ?? it.thumb_path ?? it.image_path;
                return (
                  <button
                    key={it.id}
                    onClick={() => onPick(it)}
                    className="text-left card overflow-hidden hover:ring-2 hover:ring-pink-400 transition-all bg-pink-50"
                  >
                    <div className="aspect-square">
                      {imgPath && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/images/${imgPath}`}
                          alt={it.name ?? ''}
                          className="w-full h-full object-contain"
                        />
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs text-ink-800 truncate font-medium">
                        {it.name ?? it.sub_category ?? it.category}
                      </div>
                      {it.brand && (
                        <div className="text-[10px] text-ink-400 truncate">{it.brand}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function EditMetaDialog({
  trip,
  onClose,
  onSave,
}: {
  trip: Trip;
  onClose: () => void;
  onSave: (patch: Partial<Trip>) => void;
}) {
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.start_date);
  const [endDate, setEndDate] = useState(trip.end_date);
  const [occasions, setOccasions] = useState(trip.occasions.join(', '));
  const [notes, setNotes] = useState(trip.notes ?? '');

  function submit() {
    if (!name || !startDate || !endDate) return;
    onSave({
      name,
      start_date: startDate,
      end_date: endDate,
      occasions: occasions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      notes: notes.trim() || null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fade-up"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-md w-full p-6 shadow-xl relative max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '4px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>

        <div className="eyebrow mb-2">Edit trip</div>
        <div className="wordmark italic text-2xl text-ink-900 mb-6 pr-8">Trip details</div>

        <div className="space-y-4">
          <div>
            <label className="label block mb-1">Trip name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label block mb-1">End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="label block mb-1">Occasions (comma-separated)</label>
            <input
              value={occasions}
              onChange={(e) => setOccasions(e.target.value)}
              placeholder="dinner, hiking, museum"
              className="input"
            />
          </div>
          <div>
            <label className="label block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input min-h-[60px] resize-none"
            />
          </div>
          <p className="text-[10px] uppercase tracking-[0.15em] text-ink-400">
            Tip: changing dates or occasions doesn't auto-regenerate. Tap “Regenerate plan” when you're ready.
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost py-2 px-4 text-sm">Cancel</button>
            <button onClick={submit} className="btn py-2 px-4 text-sm">
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
