'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Shirt, Sparkles, Heart, Luggage } from 'lucide-react';

const tabs = [
  { href: '/', label: 'Today', icon: Home, match: (p: string) => p === '/' },
  { href: '/closet', label: 'Closet', icon: Shirt, match: (p: string) => p.startsWith('/closet') },
  { href: '/outfits', label: 'Outfits', icon: Sparkles, match: (p: string) => p.startsWith('/outfits') || p.startsWith('/wears') },
  { href: '/wishlist', label: 'Wishlist', icon: Heart, match: (p: string) => p.startsWith('/wishlist') },
  { href: '/trips', label: 'Pack', icon: Luggage, match: (p: string) => p.startsWith('/trips') },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-ivory-50/95 backdrop-blur border-t border-ivory-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-5">
        {tabs.map((t) => {
          const active = t.match(pathname);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
                active ? 'text-ink-900' : 'text-ink-400'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={1.5} />
              <span className="text-[10px] uppercase tracking-[0.15em] font-medium">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
