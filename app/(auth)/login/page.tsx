'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/auth/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const next = params.get('next') ?? '/';
    router.push(`/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div className="w-full max-w-sm animate-fade-up relative z-10">
        <div className="mb-14 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-pink-500 font-medium mb-4">
            ❦ &nbsp; Maison &nbsp; ❦
          </div>
          <h1 className="wordmark text-[72px] leading-none text-ink-900 italic">Wardrobe</h1>
          <div className="mt-4 flex items-center gap-3 justify-center">
            <span className="h-px w-16 bg-pink-300" />
            <span className="text-pink-400 text-xs">❦</span>
            <span className="h-px w-16 bg-pink-300" />
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-8">
          <div>
            <label className="label block mb-2">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
            />
          </div>
          <button type="submit" disabled={loading} className="btn w-full disabled:opacity-50">
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
