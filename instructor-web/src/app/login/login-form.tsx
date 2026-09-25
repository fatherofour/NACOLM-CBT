'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/nc/basics';
import { Glyph } from '@/components/nc/glyph';

// Only same-site paths are accepted as a post-login destination.
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/sessions');

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [serviceNumber, setServiceNumber] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!serviceNumber.trim() || !password) {
      setError('Enter your service number and password.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceNumber: serviceNumber.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(res.status >= 500 ? 'The portal can’t reach its service right now. Try again in a minute.' : data.message || 'Sign-in failed.');
        setPassword('');
        return;
      }
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch {
      setError('The portal can’t reach its service right now. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="t-display m-0">Sign in</h2>
        <p className="m-0 text-ink-muted">Use your service number and portal password.</p>
      </div>

      {error ? (
        <Alert tone="error" title="Couldn’t sign you in">
          {error}
        </Alert>
      ) : null}

      <label className="label">
        Service number
        <input
          name="serviceNumber"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          placeholder="e.g. NA/19/4411"
          value={serviceNumber}
          onChange={(e) => setServiceNumber(e.target.value)}
          required
          className="h-12 !text-base"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="label">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-12 w-full pr-12 !text-base"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-md text-ink-muted hover:bg-surface-sunken"
          >
            <Glyph name={show ? 'cross' : 'eye'} size={18} />
          </button>
        </div>
      </div>

      <button type="submit" className="nc-btn nc-btn-primary !h-12 justify-center !text-base" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <div className="flex flex-col gap-2 border-t border-line pt-4 text-[13px] leading-[19px] text-ink-muted">
        <p className="m-0">Forgot your password? Ask the exam officer or the College ICT unit to reset it.</p>
        <p className="m-0">For authorised College staff only. Sign-ins and every change to a paper are recorded.</p>
      </div>
    </form>
  );
}
