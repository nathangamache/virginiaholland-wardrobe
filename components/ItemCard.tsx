'use client';

import Link from 'next/link';

interface ItemCardProps {
  id: string;
  name?: string | null;
  brand?: string | null;
  sub_category?: string | null;
  category: string;
  thumb_path?: string | null;
  image_nobg_path?: string | null;
  image_path?: string | null;
  favorite?: boolean;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
}

export function ItemCard({
  id,
  name,
  brand,
  sub_category,
  category,
  thumb_path,
  image_nobg_path,
  image_path,
  favorite,
  href,
  onClick,
  selected,
}: ItemCardProps) {
  const imgSrc = thumb_path
    ? `/api/images/${thumb_path}`
    : image_nobg_path
    ? `/api/images/${image_nobg_path}`
    : image_path
    ? `/api/images/${image_path}`
    : null;

  const inner = (
    <div
      className={`group relative aspect-square bg-ivory-100 overflow-hidden transition-all ${
        selected ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-ivory-50' : ''
      }`}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc} alt={name ?? sub_category ?? category} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ink-400 font-display">
          {category}
        </div>
      )}
      {favorite && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-ivory-50 flex items-center justify-center text-xs">
          ✦
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-ivory-50/95 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="text-[11px] uppercase tracking-[0.12em] text-ink-400">{sub_category ?? category}</div>
        {(name || brand) && (
          <div className="text-xs text-ink-800 truncate">
            {name ?? brand}
          </div>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block text-left w-full">
        {inner}
      </button>
    );
  }
  return <Link href={href ?? `/closet/${id}`}>{inner}</Link>;
}
