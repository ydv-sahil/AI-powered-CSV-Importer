'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

/**
 * Reads the theme the inline script in `layout.tsx` already applied, rather than
 * deciding again on mount — which would flash the wrong icon for one frame.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private browsing / disabled storage. The toggle still works for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Rendered before hydration reads the DOM, so keep it inert-looking, not absent.
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-9 place-items-center rounded-lg border border-[var(--line)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
    >
      {theme === 'dark' ? (
        <Moon className="size-4" aria-hidden />
      ) : (
        <Sun className="size-4" aria-hidden />
      )}
    </button>
  );
}
