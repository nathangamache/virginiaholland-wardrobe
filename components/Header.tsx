'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function Header({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-40 bg-ivory-50/80 backdrop-blur-md border-b border-ivory-200">
      <div className="px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <Link href="/" className="group">
          <div className="eyebrow text-ink-400 group-hover:text-ink-600 transition-colors">
            — Curated —
          </div>
          <div className="font-display text-2xl leading-none mt-0.5">Wardrobe</div>
        </Link>
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-9 h-9 rounded-full border border-ink-200 flex items-center justify-center font-display text-sm hover:bg-ivory-100 transition-colors"
            aria-label="Account menu"
          >
            {email.slice(0, 1).toUpperCase()}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-12 w-56 bg-white border border-ivory-200 shadow-sm z-50 animate-fade-in">
                <div className="px-4 py-3 border-b border-ivory-200">
                  <div className="eyebrow mb-1">Signed in</div>
                  <div className="text-sm text-ink-800 truncate">{email}</div>
                </div>
                <Link
                  href="/insights"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 text-sm hover:bg-ivory-100 transition-colors border-b border-ivory-200"
                >
                  Insights
                </Link>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-ivory-100 transition-colors"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
