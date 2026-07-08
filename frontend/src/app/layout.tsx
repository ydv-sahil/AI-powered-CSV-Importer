import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI CSV Importer — GrowEasy CRM',
  description:
    'Upload a CSV in any format. AI maps your columns onto GrowEasy CRM fields and extracts every lead.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
};

/**
 * Applies the theme before the first paint.
 *
 * Runs synchronously in `<head>`, so the page never renders light-then-dark.
 * It must not touch React state — hydration hasn't happened yet — and it must
 * not throw when `localStorage` is blocked (Safari private browsing).
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
