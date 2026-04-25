'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Plus, MapPin, ArrowRight } from 'lucide-react';

interface Trip {
  id: string;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  selected_item_ids: string[] | null;
  generated_outfits: { packing_notes?: string } | null;
  notes: string | null;
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/trips').then((r) => r.json());
    setTrips(res.trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="eyebrow mb-1">Packing</div>
          <h1 className="wordmark italic text-5xl leading-none text-ink-900">Trips</h1>
        </div>
        <button onClick={() => setShowNew(true)} className="btn">
          <Plus className="w-4 h-4" /> New trip
        </button>
      </div>

      {loading ? (
        <div className="text-ink-400 text-sm">Loading…</div>
      ) : trips.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-600 mb-4">No trips yet. Plan one and I'll pack for you.</p>
          <button onClick={() => setShowNew(true)} className="btn">Plan a trip</button>
        </div>
      ) : (
        <div className="space-y-4">
          {trips.map((t) => (
            <Link
              key={t.id}
              href={`/trips/${t.id}`}
              className="card p-5 block hover:shadow-md transition-shadow group animate-fade-up"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="eyebrow mb-1 flex items-center gap-1.5 text-pink-700">
                    <MapPin className="w-3 h-3" /> {t.destination}
                  </div>
                  <h2 className="font-display text-2xl mb-1 truncate">{t.name}</h2>
                  <p className="text-sm text-ink-600">
                    {format(new Date(t.start_date), 'MMM d')} – {format(new Date(t.end_date), 'MMM d, yyyy')}
                    {t.selected_item_ids && t.selected_item_ids.length > 0 && (
                      <span className="ml-3 text-ink-400">· {t.selected_item_ids.length} pieces</span>
                    )}
                  </p>
                  {t.generated_outfits?.packing_notes && (
                    <p className="text-xs text-ink-400 italic mt-2 line-clamp-2">
                      {t.generated_outfits.packing_notes}
                    </p>
                  )}
                </div>
                <ArrowRight className="w-5 h-5 text-pink-300 group-hover:text-pink-500 transition-colors flex-shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && <NewTripDialog onClose={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

// =============================================================
// New trip creation dialog (unchanged from previous)
// =============================================================

function NewTripDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    name: '',
    destination: '',
    destination_lat: '',
    destination_lon: '',
    start_date: '',
    end_date: '',
    occasions: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [destinationQuery, setDestinationQuery] = useState('');

  useEffect(() => {
    if (!destinationQuery || destinationQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(destinationQuery)}`);
        const json = await res.json();
        setSearchResults(json.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [destinationQuery]);

  function pickDestination(r: any) {
    setForm({
      ...form,
      destination: r.label,
      destination_lat: String(r.lat),
      destination_lon: String(r.lon),
    });
    setDestinationQuery(r.label);
    setSearchResults([]);
  }

  async function save() {
    if (!form.name || !form.destination || !form.start_date || !form.end_date || !form.destination_lat) {
      setError('Pick a destination from the list and fill in the dates.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        destination: form.destination,
        destination_lat: parseFloat(form.destination_lat),
        destination_lon: parseFloat(form.destination_lon),
        start_date: form.start_date,
        end_date: form.end_date,
        occasions: form.occasions.split(',').map((s) => s.trim()).filter(Boolean),
        notes: form.notes || null,
      }),
    });
    if (!res.ok) {
      setError('Could not create trip.');
      setSaving(false);
      return;
    }
    const json = await res.json().catch(() => null);
    onClose();
    if (json?.id) {
      // Land them on the detail page so they can see the plan (or the
      // generation_error message) and start editing right away.
      window.location.href = `/trips/${json.id}`;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/30 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-lg md:mx-4 p-6 max-h-[90vh] overflow-y-auto animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow mb-1">Plan trip</div>
        <h2 className="font-display text-2xl mb-6">Where to?</h2>
        <div className="space-y-4">
          <input placeholder="Trip name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          <div className="relative">
            <input
              placeholder="Destination (start typing…)"
              value={destinationQuery}
              onChange={(e) => {
                setDestinationQuery(e.target.value);
                if (e.target.value !== form.destination) {
                  setForm({ ...form, destination: '', destination_lat: '', destination_lon: '' });
                }
              }}
              className="input"
            />
            {searchResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-ivory-200 shadow-sm max-h-64 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDestination(r)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-ivory-100 border-b border-ivory-200 last:border-b-0"
                  >
                    <div className="text-ink-800">{r.label}</div>
                    <div className="text-xs text-ink-400 font-mono">
                      {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searching && <div className="text-xs text-ink-400 mt-1">Searching…</div>}
            {form.destination_lat && (
              <div className="text-xs text-ink-400 mt-1 font-mono">
                ✓ {parseFloat(form.destination_lat).toFixed(3)}, {parseFloat(form.destination_lon).toFixed(3)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label mb-1">Start</div>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="input" />
            </div>
            <div>
              <div className="label mb-1">End</div>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="input" />
            </div>
          </div>
          <input placeholder="Occasions (dinner, hiking, museum)" value={form.occasions} onChange={(e) => setForm({ ...form, occasions: e.target.value })} className="input" />
          <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input min-h-[60px] resize-none" />
          {error && <div className="text-sm text-clay-700">{error}</div>}
          <div className="flex gap-3">
            <button onClick={save} disabled={saving} className="btn flex-1 disabled:opacity-50">
              {saving ? 'Planning…' : 'Plan with AI'}
            </button>
            <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
