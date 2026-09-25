'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Glyph, type GlyphName } from '@/components/nc/glyph';
import { UserProvider } from './user-context';
import { displayName, type User } from '@/lib/api';

const NAV: { href: string; label: string; short: string; icon: GlyphName }[] = [
  { href: '/sessions', label: 'Exam sessions', short: 'Sessions', icon: 'sessions' },
  { href: '/bank', label: 'Question bank', short: 'Bank', icon: 'bank' },
  { href: '/material', label: 'Study material', short: 'Material', icon: 'material' },
  { href: '/results', label: 'Results', short: 'Results', icon: 'results' },
];
const ADMIN_NAV = { href: '/admin/users', label: 'Users', short: 'Users', icon: 'users' as GlyphName };

const initials = (u: User) =>
  u.fullName
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function Shell({ user, children }: { user: User; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const active = (href: string) => path === href || path.startsWith(href + '/');
  const roleLabel = user.role === 'ADMIN' ? 'Admin' : user.role === 'EXAM_OFFICER' ? 'Exam officer' : 'Instructor';
  const nav = user.role === 'ADMIN' ? [...NAV, ADMIN_NAV] : NAV;

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <UserProvider user={user}>
      <div className="flex min-h-dvh flex-col bg-surface">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b-[3px] border-army-red bg-command px-4 text-on-command lg:h-[60px] lg:gap-4 lg:border-b-4 lg:px-6">
          <Link href="/sessions" className="flex items-center gap-3 text-on-command no-underline" aria-label="NACOLM CBT home">
            <Image src="/brand/nacolm-crest.png" alt="" width={38} height={40} priority className="h-9 w-auto lg:h-10" />
            <span className="flex flex-col">
              <span className="text-[18px] font-[750] leading-5 tracking-[-0.01em]" style={{ fontStretch: '88%' }}>
                NACOLM CBT
              </span>
              <span className="hidden text-xs leading-4 text-on-command-muted sm:block">Question setter, Nigerian Army College of Logistics and Management</span>
            </span>
          </Link>
          <span className="flex-1" />
          <span className="rounded-sm border border-on-command-muted px-2 py-[3px] text-xs font-[650]">{roleLabel}</span>
          <span className="hidden items-center gap-2.5 md:flex">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-field text-[13px] font-bold text-on-field" aria-hidden="true">
              {initials(user)}
            </span>
            <span className="text-sm font-semibold">{displayName(user)}</span>
          </span>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-on-command-muted bg-transparent px-3 text-[13px] font-semibold text-on-command md:h-8"
          >
            <Glyph name="signout" />
            <span className="hidden sm:inline">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            <span className="nc-sr sm:hidden">Sign out</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Main" className="hidden w-[232px] shrink-0 flex-col gap-1 border-r border-line bg-surface-raised px-3 py-5 lg:flex">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? 'page' : undefined}
                className={[
                  'flex h-10 items-center gap-2.5 rounded-md px-3 text-sm no-underline',
                  active(n.href) ? 'bg-field-soft font-[650] text-field shadow-[inset_3px_0_0_var(--field)]' : 'font-medium text-ink hover:bg-surface-sunken',
                ].join(' ')}
              >
                <Glyph name={n.icon} />
                {n.label}
              </Link>
            ))}
            <span className="flex-1" />
            <p className="m-0 p-3 text-xs leading-[17px] text-ink-muted">Every approve, edit, reject and freeze is recorded with your name and the time.</p>
          </nav>

          <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 lg:px-8 lg:pb-10 lg:pt-7">{children}</main>
        </div>

        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-line bg-surface-raised lg:hidden">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? 'page' : undefined}
              className={[
                'flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold no-underline',
                active(n.href) ? 'text-field shadow-[inset_0_3px_0_var(--field)]' : 'text-ink-muted',
              ].join(' ')}
            >
              <Glyph name={n.icon} size={20} />
              {n.short}
            </Link>
          ))}
        </nav>
      </div>
    </UserProvider>
  );
}
