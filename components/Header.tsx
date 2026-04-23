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
    <header
      className="sticky top-0 z-40 bg-pink-50/85 backdrop-blur-md border-b border-pink-200/60"
      style={{ boxShadow: '0 4px 20px -8px rgba(176, 20, 86, 0.12), 0 2px 4px -1px rgba(176, 20, 86, 0.04)' }}
    >
      <div className="px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <Link href="/" className="group">
          <div className="wordmark text-[32px] leading-none text-ink-900 italic group-hover:text-pink-700 transition-colors">
            Wardrobe
          </div>
        </Link>
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-10 h-10 rounded-full border border-pink-300 bg-white flex items-center justify-center wordmark text-lg text-pink-700 hover:bg-pink-100 hover:border-pink-500 transition-all"
            aria-label="Account menu"
          >
            {email.slice(0, 1).toUpperCase()}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div
                className="absolute right-0 top-12 w-64 bg-white border border-pink-200 shadow-lg shadow-pink-900/5 z-50 animate-fade-in"
                style={{ borderRadius: '4px' }}
              >
                <div className="px-4 py-3 border-b border-pink-100">
                  <div className="eyebrow mb-1">Signed in</div>
                  <div className="text-sm text-ink-800 truncate">{email}</div>
                </div>
                <Link
                  href="/insights"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 text-sm text-ink-800 hover:bg-pink-50 transition-colors border-b border-pink-100"
                >
                  Insights
                </Link>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-3 text-sm text-ink-800 hover:bg-pink-50 transition-colors"
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
