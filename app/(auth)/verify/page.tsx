'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const next = params.get('next') ?? '/';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    if (res.ok) {
      router.push(next);
    } else {
      setError('Invalid or expired code.');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-12 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-pink-500 font-medium mb-4">
            ❦ &nbsp; Verify &nbsp; ❦
          </div>
          <h1 className="wordmark text-[48px] leading-none text-ink-900 italic">
            Check your email
          </h1>
          <p className="mt-5 text-sm text-ink-600 leading-relaxed">
            A six-digit code was sent to{' '}
            <span className="text-pink-700 font-medium">{email}</span>.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-8">
          <div>
            <label className="label block mb-2 text-center">Code</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input font-mono text-3xl tracking-[0.4em] text-center text-pink-700"
              placeholder="000000"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-pink-700 text-center">{error}</p>}
          <button type="submit" disabled={loading || code.length !== 6} className="btn w-full disabled:opacity-50">
            {loading ? 'Verifying…' : 'Enter'}
          </button>
        </form>
        <div className="mt-8 text-center">
          <a href="/login" className="btn-link">← Use a different email</a>
        </div>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
