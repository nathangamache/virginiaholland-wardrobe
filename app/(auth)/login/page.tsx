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
    router.push(
      `/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-12">
          <div className="eyebrow mb-3">Private</div>
          <h1 className="font-display text-4xl leading-tight">Wardrobe</h1>
          <p className="mt-3 text-sm text-ink-600 leading-relaxed">
            Enter your email to receive a sign-in code.
          </p>
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
