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
      {/* Decorative cheetah corners at very low opacity */}
      <div
        className="absolute -top-20 -left-20 w-80 h-80 opacity-[0.08] rotate-12 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><g fill='%233a2416'><ellipse cx='14' cy='12' rx='4' ry='3.2' transform='rotate(-15 14 12)'/><ellipse cx='42' cy='8' rx='3' ry='4'/><ellipse cx='64' cy='18' rx='4.5' ry='3' transform='rotate(25 64 18)'/><ellipse cx='10' cy='38' rx='3.5' ry='4.5' transform='rotate(-10 10 38)'/><ellipse cx='34' cy='42' rx='5' ry='3.5' transform='rotate(20 34 42)'/><ellipse cx='58' cy='48' rx='3' ry='4' transform='rotate(-20 58 48)'/><ellipse cx='18' cy='64' rx='4' ry='3' transform='rotate(15 18 64)'/><ellipse cx='48' cy='70' rx='3.5' ry='4' transform='rotate(-25 48 70)'/><ellipse cx='72' cy='60' rx='4' ry='3.5' transform='rotate(10 72 60)'/></g></svg>")`,
          backgroundSize: '80px 80px',
        }}
      />
      <div
        className="absolute -bottom-20 -right-20 w-80 h-80 opacity-[0.08] -rotate-12 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><g fill='%233a2416'><ellipse cx='14' cy='12' rx='4' ry='3.2' transform='rotate(-15 14 12)'/><ellipse cx='42' cy='8' rx='3' ry='4'/><ellipse cx='64' cy='18' rx='4.5' ry='3' transform='rotate(25 64 18)'/><ellipse cx='10' cy='38' rx='3.5' ry='4.5' transform='rotate(-10 10 38)'/><ellipse cx='34' cy='42' rx='5' ry='3.5' transform='rotate(20 34 42)'/><ellipse cx='58' cy='48' rx='3' ry='4' transform='rotate(-20 58 48)'/><ellipse cx='18' cy='64' rx='4' ry='3' transform='rotate(15 18 64)'/><ellipse cx='48' cy='70' rx='3.5' ry='4' transform='rotate(-25 48 70)'/><ellipse cx='72' cy='60' rx='4' ry='3.5' transform='rotate(10 72 60)'/></g></svg>")`,
          backgroundSize: '80px 80px',
        }}
      />

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
