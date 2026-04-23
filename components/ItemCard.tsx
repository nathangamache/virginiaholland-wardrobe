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
      className={`group relative aspect-square bg-pink-50 overflow-hidden transition-all ${
        selected ? 'ring-2 ring-pink-500 ring-offset-2 ring-offset-pink-50' : ''
      }`}
      style={{ borderRadius: '3px' }}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={name ?? sub_category ?? category}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-pink-400 font-display italic">
          {category}
        </div>
      )}
      {favorite && (
        <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/95 backdrop-blur-sm flex items-center justify-center text-xs text-pink-500 shadow-sm">
          ✦
        </div>
      )}
      {/* Hover info panel — solid white with blur so text reads over any image */}
      <div
        className="absolute inset-x-0 bottom-0 px-3 py-2.5 bg-white/90 backdrop-blur-md border-t border-white/60 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] text-pink-700 font-medium truncate">
          {sub_category ?? category}
        </div>
        {(name || brand) && (
          <div className="text-[13px] text-ink-900 truncate leading-tight mt-0.5">
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
