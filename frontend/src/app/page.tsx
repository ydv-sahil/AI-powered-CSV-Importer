'use client';

import { Sparkles } from 'lucide-react';
import { Dropzone } from '@/components/Dropzone';
import { ErrorPanel } from '@/components/ErrorPanel';
import { PreviewPanel } from '@/components/PreviewPanel';
import { ProcessingPanel } from '@/components/ProcessingPanel';
import { ResultPanel } from '@/components/ResultPanel';
import { Stepper } from '@/components/Stepper';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useImport } from '@/hooks/useImport';

export default function HomePage() {
  const { state, selectFile, confirm, reset, backToPreview } = useImport();
  const { phase, preview, progress, result, error, file } = state;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg-page)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-500 text-white">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[var(--text-primary)]">AI CSV Importer</p>
              <p className="text-[11px] text-[var(--text-muted)]">GrowEasy CRM</p>
            </div>
          </div>

          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            Import Leads via CSV
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
            Upload a CSV in any shape. The AI reads your columns, maps them onto GrowEasy CRM
            fields, and extracts every lead — no template required.
          </p>
        </div>

        <div className="mb-8">
          <Stepper phase={phase} />
        </div>

        <section aria-live="polite" aria-busy={phase === 'processing'}>
          {phase === 'idle' && <Dropzone onFile={selectFile} />}

          {phase === 'preview' && preview && (
            <PreviewPanel preview={preview} onConfirm={confirm} onCancel={reset} />
          )}

          {phase === 'processing' && <ProcessingPanel progress={progress} />}

          {phase === 'complete' && result && (
            <ResultPanel result={result} fileName={file?.name ?? 'leads.csv'} onReset={reset} />
          )}

          {phase === 'error' && error && (
            <ErrorPanel
              code={error.code}
              message={error.message}
              // Only offer a retry when there's a parsed file to retry with.
              onRetry={preview ? backToPreview : undefined}
              onReset={reset}
            />
          )}
        </section>
      </main>

      <footer className="border-t border-[var(--line)] py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-[var(--text-muted)] sm:px-6">
          Built for the GrowEasy Software Developer assignment · Next.js · Express · Gemini
        </div>
      </footer>
    </div>
  );
}
