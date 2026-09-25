'use client';
import { useEffect, useState } from 'react';
import { Glyph } from '@/components/nc/glyph';
import { THEME_KEY } from './theme-script';

type Theme = 'light' | 'dark';

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeToggle({ className }: { className?: string }) {
  // Mirrors whatever theme-script.tsx already applied before hydration, so
  // this never causes a flash or a mismatch — see globals.css for the
  // light/dark/"follow the OS" cascade this reads and writes.
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    setTheme(stored === 'dark' || stored === 'light' ? stored : systemPrefersDark() ? 'dark' : 'light');
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // private browsing / storage blocked — the toggle still works for this page load
    }
  }

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={() => apply(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className ?? 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-on-command-muted text-on-command'}
    >
      <Glyph name={isDark ? 'sun' : 'moon'} size={16} />
    </button>
  );
}
