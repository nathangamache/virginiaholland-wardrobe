'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';

export default function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [item, setItem] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/items/${id}`)
      .then((r) => r.json())
      .then((j) => setItem(j.item));
  }, [id]);

  async function save() {
    setSaving(true);
    await fetch(`/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: item.name,
        brand: item.brand,
        sub_category: item.sub_category,
        material: item.material,
        pattern: item.pattern,
        favorite: item.favorite,
        notes: item.notes,
        style_tags: item.style_tags,
        season_tags: item.season_tags,
        warmth_score: item.warmth_score,
        formality_score: item.formality_score,
        colors: item.colors,
      }),
    });
    setSaving(false);
  }

  async function remove() {
    if (!confirm('Remove this piece from your closet?')) return;
    await fetch(`/api/items/${id}`, { method: 'DELETE' });
    router.push('/closet');
  }

  if (!item) return <div className="px-6 py-8 text-ink-400">Loading…</div>;

  const imgSrc = item.image_nobg_path ?? item.image_path;

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="card aspect-square mb-6 bg-ivory-100 overflow-hidden">
        {imgSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/images/${imgSrc}`} alt={item.name ?? ''} className="w-full h-full object-contain" />
        )}
      </div>

      <div className="space-y-5">
        <div>
          <div className="eyebrow mb-1">{item.category} · {item.sub_category ?? ''}</div>
          <input
            value={item.name ?? ''}
            onChange={(e) => setItem({ ...item, name: e.target.value })}
            className="font-display text-3xl bg-transparent border-b border-transparent hover:border-ivory-300 focus:border-ink-900 focus:outline-none w-full"
            placeholder="Name…"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand">
            <input
              value={item.brand ?? ''}
              onChange={(e) => setItem({ ...item, brand: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Material">
            <input
              value={item.material ?? ''}
              onChange={(e) => setItem({ ...item, material: e.target.value })}
              className="input"
            />
          </Field>
        </div>

        <Field label="Colors">
          <div className="flex gap-1.5">
            {(item.colors ?? []).map((c: string, i: number) => (
              <div key={i} className="w-7 h-7 border border-ivory-300" style={{ background: c, borderRadius: '2px' }} />
            ))}
          </div>
        </Field>

        <Field label="Seasons">
          <div className="flex flex-wrap gap-2">
            {['spring', 'summer', 'fall', 'winter'].map((s) => {
              const on = item.season_tags?.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? item.season_tags.filter((x: string) => x !== s)
                      : [...(item.season_tags ?? []), s];
                    setItem({ ...item, season_tags: next });
                  }}
                  className={`px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] border transition-all ${
                    on ? 'bg-ink-900 text-ivory-50 border-ink-900' : 'border-ivory-300 text-ink-600'
                  }`}
                  style={{ borderRadius: '2px' }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Notes">
          <textarea
            value={item.notes ?? ''}
            onChange={(e) => setItem({ ...item, notes: e.target.value })}
            className="input min-h-[80px] resize-none"
          />
        </Field>

        <div className="flex items-center justify-between pt-4 border-t border-ivory-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!item.favorite}
              onChange={(e) => setItem({ ...item, favorite: e.target.checked })}
              className="accent-ink-900"
            />
            <span className="text-sm">Favorite</span>
          </label>
          <div className="text-xs text-ink-400">
            Worn {item.times_worn ?? 0} time{(item.times_worn ?? 0) === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button onClick={save} disabled={saving} className="btn flex-1 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={remove} className="btn-ghost flex-1 text-clay-700 border-clay-300 hover:bg-clay-300/10">
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {children}
    </div>
  );
}
