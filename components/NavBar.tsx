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
      className="fixed bottom-0 inset-x-0 z-40 bg-pink-50/95 backdrop-blur border-t border-pink-200"
      // Always pad at least 14px at the bottom, and more if the device reports
      // a safe-area inset (iPhone home indicator, etc). This keeps the nav
      // visually lifted off the screen edge on every device.
      style={{
        paddingBottom: 'max(14px, calc(env(safe-area-inset-bottom, 0px) + 10px))',
      }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-5 relative">
        {tabs.map((t) => {
          const active = t.match(pathname);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
                active ? 'text-pink-700' : 'text-ink-400 hover:text-pink-500'
              }`}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-pink-500" />
              )}
              <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.5} />
              <span className={`text-[10px] uppercase tracking-[0.15em] font-medium ${active ? 'font-semibold' : ''}`}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
