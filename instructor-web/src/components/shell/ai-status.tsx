'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type AiQueueStatus } from '@/lib/api';

/** What a running AI job is doing, in words an instructor recognises. */
export function describeAiJob(running: NonNullable<AiQueueStatus['running']>): string {
  if (running.id.startsWith('scheme:')) return 'Working on a marking scheme';
  if (running.id.startsWith('paper:')) return 'Reading a handwritten paper';
  if (running.id.startsWith('script:')) return 'Reading a candidate’s script';
  if (running.id.startsWith('generate:')) return 'Writing new questions';
  return running.stage === 'ocr' ? 'Reading a script' : 'Marking a script';
}

/**
 * Shows in the top bar whenever the college server's AI is busy, with a Stop
 * button for all of it. Stopped work is marked "cancelled" where it was
 * started, and can be run again from there.
 */
export function AiStatus() {
  const [status, setStatus] = useState<AiQueueStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api.get<AiQueueStatus>('/ai-queue').then((s) => alive && setStatus(s), () => undefined);
    };
    load();
    const t = setInterval(load, 6000);
    const onChange = () => load();
    window.addEventListener('ai-queue-changed', onChange);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('ai-queue-changed', onChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const waiting = status ? status.waiting.ocr + status.waiting.mark : 0;
  const running = status?.running ?? null;
  if (!running && !waiting) return null;

  async function stopAll() {
    setStopping(true);
    setError('');
    try {
      await api.post('/ai-queue/cancel-all', {});
      setStatus(await api.get<AiQueueStatus>('/ai-queue'));
      window.dispatchEvent(new Event('ai-queue-changed'));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t stop the AI.');
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex h-11 items-center gap-2 rounded-md border border-on-command-muted bg-transparent px-3 text-[13px] font-semibold text-on-command md:h-8"
      >
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-300" />
        </span>
        <span>AI working{waiting ? ` · ${waiting} waiting` : ''}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="AI work" className="absolute right-0 top-[calc(100%+8px)] z-40 flex w-[300px] flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4 text-ink shadow-[var(--shadow-overlay)]">
          <div>
            <p className="m-0 font-[650]">{running ? describeAiJob(running) : 'Waiting to start'}</p>
            <p className="m-0 text-sm text-ink-muted">
              {waiting ? `${waiting} more job${waiting === 1 ? '' : 's'} waiting. ` : ''}It runs on the college server and carries on if you leave this page.
            </p>
          </div>
          {error ? <p className="m-0 text-sm font-semibold text-rejected">{error}</p> : null}
          <div className="flex gap-2">
            <button type="button" className="nc-btn nc-btn-danger" disabled={stopping} onClick={stopAll}>
              {stopping ? 'Stopping…' : waiting ? 'Stop all AI work' : 'Stop it'}
            </button>
            <button type="button" className="nc-btn nc-btn-quiet" onClick={() => setOpen(false)}>Keep going</button>
          </div>
          <p className="m-0 text-[12px] text-ink-muted">Stopped work is marked “cancelled” where it was started, and you can run it again from there.</p>
        </div>
      ) : null}
    </div>
  );
}

/** Stops one AI job, e.g. "scheme:<id>"; the item it was working on is marked cancelled. */
export function CancelAiButton({ jobId, onCancelled, label = 'Cancel' }: { jobId: string; onCancelled?: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="nc-btn nc-btn-quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/ai-queue/cancel', { id: jobId });
          window.dispatchEvent(new Event('ai-queue-changed'));
          onCancelled?.();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Cancelling…' : label}
    </button>
  );
}
