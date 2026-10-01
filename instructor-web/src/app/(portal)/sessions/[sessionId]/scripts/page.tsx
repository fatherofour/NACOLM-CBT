'use client';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import {
  api,
  qs,
  type BulkUploadResult,
  type Candidate,
  type MarkerAgreement,
  type Paper,
  type Question,
  type ScriptAnswer,
  type ScriptQueue,
  type ScriptStatus,
  type UnassignedScan,
} from '@/lib/api';
import { sessionInfo } from '@/lib/session-info';
import { useData } from '@/lib/use-data';

const STATUS: Record<ScriptStatus, { label: string; tone: 'approved' | 'caution' | 'rejected' | 'bank' | 'field' }> = {
  UPLOADED: { label: 'Reading and marking…', tone: 'bank' },
  OCR_FAILED: { label: 'Couldn’t read scan', tone: 'rejected' },
  AI_MARKING_FAILED: { label: 'AI marking failed', tone: 'rejected' },
  PENDING_REVIEW: { label: 'Needs your review', tone: 'caution' },
  REVIEWED: { label: 'Reviewed', tone: 'field' },
  PUBLISHED: { label: 'Published', tone: 'approved' },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const minutes = (s: number) => (s < 90 ? 'about a minute' : `about ${Math.round(s / 60)} minutes`);

// Pages are sent a few at a time: a class set of phone photos is hundreds of
// megabytes, and the server holds each request in memory while it files it.
const CHUNK = 12;

/** Downscales a photo to at most 2000px before upload; the answer-sheet code and the handwriting both read fine at that size. */
async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('resize failed'))), 'image/jpeg', 0.88));
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export default function ScriptsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const info = useData(() => sessionInfo(sessionId), [sessionId]);
  const setup = useData(async () => {
    const [papers, questions, candidates] = await Promise.all([
      api.get<Paper[]>(`/papers${qs({ sessionId })}`),
      api.get<Question[]>(`/question-bank${qs({ sessionId })}`),
      api.get<Candidate[]>(`/candidates${qs({ sessionId })}`),
    ]);
    const version = papers.flatMap((p) => p.versions).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
    const onPaper = new Set((version?.items as { questionId: string }[] | undefined)?.map((i) => i.questionId));
    return {
      version,
      theory: questions.filter((q) => q.type === 'THEORY' && onPaper.has(q.id)),
      candidates: candidates.filter((c) => c.active),
    };
  }, [sessionId]);

  const versionId = setup.data?.version?.id;
  const scripts = useData(
    () => (versionId ? api.get<ScriptAnswer[]>(`/theory-scripts${qs({ paperVersionId: versionId })}`) : Promise.resolve([] as ScriptAnswer[])),
    [versionId],
  );
  const unassigned = useData(
    () => (versionId ? api.get<UnassignedScan[]>(`/theory-scripts/unassigned${qs({ paperVersionId: versionId })}`) : Promise.resolve([] as UnassignedScan[])),
    [versionId],
  );
  const agreement = useData(
    () => (versionId ? api.get<MarkerAgreement[]>(`/theory-scripts/agreement${qs({ paperVersionId: versionId })}`) : Promise.resolve([] as MarkerAgreement[])),
    [versionId],
  );

  // OCR + marking run in the background on the server; keep refreshing while any are in flight.
  const processing = scripts.data?.some((s) => s.status === 'UPLOADED') ?? false;
  const [queue, setQueue] = useState<ScriptQueue>();
  const reloadRef = useRef(scripts.reload);
  useEffect(() => {
    reloadRef.current = scripts.reload;
  });
  useEffect(() => {
    if (!processing) return;
    const tick = () => {
      void reloadRef.current();
      api.get<ScriptQueue>('/theory-scripts/queue').then(setQueue, () => undefined);
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [processing]);

  const [selectedId, setSelectedId] = useState<string>();
  const list = scripts.data ?? [];
  const selected = list.find((s) => s.id === selectedId) ?? list.find((s) => s.status === 'PENDING_REVIEW') ?? list[0];

  const notReady = list.filter((s) => s.status !== 'REVIEWED' && s.status !== 'PUBLISHED').length;
  const toPublish = list.filter((s) => s.status === 'REVIEWED').length;
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  async function publish() {
    if (!versionId || !confirm(`Publish ${toPublish} reviewed result${toPublish === 1 ? '' : 's'}? Published marks can no longer be changed.`)) return;
    setPublishing(true);
    setPublishError('');
    try {
      await api.post(`/theory-scripts/publish${qs({ paperVersionId: versionId })}`, {});
      await scripts.reload();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publishing failed.');
    } finally {
      setPublishing(false);
    }
  }

  const err = info.error || setup.error || scripts.error;
  return (
    <>
      <PageHead
        title="Theory scripts"
        intro="Print QR-coded answer sheets, then scan the written pages in bulk. The system files each page to its candidate, reads the handwriting and proposes a mark with its reasoning; nothing counts until you have checked it against the scan and confirmed the mark."
        crumbs={[['Exam sessions', '/sessions'], [info.data?.title ?? '…', `/sessions/${sessionId}/review`], ['Theory scripts']]}
        action={
          setup.data?.version ? (
            <Link className="btnlink" href={`/print/answer-sheets/${sessionId}`} target="_blank">
              Print answer sheets
            </Link>
          ) : null
        }
      />
      {err ? <Alert tone="error" title="Couldn’t load theory scripts">{err}</Alert> : null}
      {!setup.data && !err ? <Spinner label="Loading…" /> : null}
      {setup.data && !setup.data.version ? (
        <EmptyState title="This session has no published paper yet" body="Scripts are marked against a published paper version. Publish the paper first." />
      ) : null}

      {setup.data?.version ? (
        <div className="flex flex-col gap-6">
          <UploadPanel
            versionId={setup.data.version.id}
            candidates={setup.data.candidates}
            questions={setup.data.theory}
            onUploaded={async (id) => {
              if (id) setSelectedId(id);
              await Promise.all([scripts.reload(), unassigned.reload()]);
            }}
          />

          {processing && queue ? <QueueBar queue={queue} /> : null}

          {unassigned.data?.length ? (
            <UnassignedPanel
              scans={unassigned.data}
              candidates={setup.data.candidates}
              questions={setup.data.theory}
              existing={list}
              onChanged={async () => {
                await Promise.all([scripts.reload(), unassigned.reload()]);
              }}
            />
          ) : null}

          {scripts.data && !list.length ? (
            <EmptyState title="No scripts uploaded yet" body="Upload the scanned answer sheets above, or a single scan for one candidate and question." />
          ) : null}

          {list.length ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <p className="m-0 flex-1 text-ink-muted">
                  {list.length} script{list.length === 1 ? '' : 's'}
                  {notReady ? `, ${notReady} still need${notReady === 1 ? 's' : ''} review` : ', all reviewed'}
                </p>
                <Button variant="primary" disabled={publishing || notReady > 0 || toPublish === 0} onClick={publish}>
                  {publishing ? 'Publishing…' : `Publish ${toPublish} reviewed result${toPublish === 1 ? '' : 's'}`}
                </Button>
              </div>
              {publishError ? <Alert tone="error" title="Couldn’t publish">{publishError}</Alert> : null}

              <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                <Panel className="shrink-0 overflow-hidden xl:w-[360px]">
                  <ul className="m-0 flex max-h-[78vh] list-none flex-col overflow-auto p-0">
                    {list.map((s) => (
                      <li key={s.id} className="border-t border-line first:border-t-0">
                        <button
                          type="button"
                          onClick={() => setSelectedId(s.id)}
                          aria-current={selected?.id === s.id}
                          className={`flex w-full flex-col gap-1 px-4 py-3 text-left ${selected?.id === s.id ? 'bg-field-soft' : 'hover:bg-surface-sunken'}`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex-1 font-[650]">{s.candidate.rank} {s.candidate.fullName}</span>
                            <Chip tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Chip>
                          </span>
                          <span className="line-clamp-1 text-[13px] text-ink-muted">{s.question.topic}: {s.question.body}</span>
                          <span className="text-[13px] text-ink-muted">
                            {s.aiScore != null ? `AI ${s.aiScore}/${s.aiMaxScore}` : 'No AI mark yet'}
                            {s.instructorScore != null ? ` · confirmed ${s.instructorScore}/${s.aiMaxScore ?? '?'}` : ''}
                            {s.extraImagePaths?.length ? ` · ${s.extraImagePaths.length + 1} pages` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
                {selected ? <ScriptDetail key={selected.id + selected.updatedAt} script={selected} onChanged={scripts.reload} /> : null}
              </div>
              {agreement.data?.length ? <AgreementNote rows={agreement.data} /> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function QueueBar({ queue }: { queue: ScriptQueue }) {
  const { running, waiting } = queue;
  const doing = running ? (running.stage === 'ocr' ? 'Reading a scan' : `Marking with ${running.model}`) : 'Starting';
  return (
    <Panel className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" aria-live="polite">
      <Spinner label={doing} />
      <span className="text-sm">
        <b className="figure">{waiting.ocr}</b> waiting to be read · <b className="figure">{waiting.mark}</b> waiting to be marked
      </span>
      <span className="text-sm text-ink-muted">Finishes in {minutes(queue.etaSeconds)}. You can leave this page; it carries on.</span>
    </Panel>
  );
}

function AgreementNote({ rows }: { rows: MarkerAgreement[] }) {
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <h3 className="m-0 text-[15px] font-[650]">How close the AI has been to your marks on this paper</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {rows.map((r) => (
          <li key={r.model}>
            <b>{r.model}</b>: {r.scripts} confirmed script{r.scripts === 1 ? '' : 's'}, average difference {r.averageDifference} mark{r.averageDifference === 1 ? '' : 's'}, {r.withinOneMarkPercent}% within one mark of yours
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function UploadPanel({
  versionId,
  candidates,
  questions,
  onUploaded,
}: {
  versionId: string;
  candidates: Candidate[];
  questions: Question[];
  onUploaded: (id?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'bulk' | 'single'>('bulk');
  return (
    <Panel className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="t-title m-0 flex-1">Upload scans</h2>
        <div role="tablist" aria-label="Upload type" className="flex gap-1 rounded-md bg-surface-sunken p-1">
          {(['bulk', 'single'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 text-sm font-[600] ${mode === m ? 'bg-surface-raised shadow-sm' : 'text-ink-muted'}`}
            >
              {m === 'bulk' ? 'Answer sheets (bulk)' : 'Single scan'}
            </button>
          ))}
        </div>
      </div>
      {!questions.length ? <Alert tone="caution" title="No theory questions on this paper">Only theory questions take a handwritten answer.</Alert> : null}
      {!candidates.length ? <Alert tone="caution" title="No active candidates">Add candidates first.</Alert> : null}
      {mode === 'bulk' ? (
        <BulkUpload versionId={versionId} onUploaded={onUploaded} />
      ) : (
        <SingleUpload versionId={versionId} candidates={candidates} questions={questions} onUploaded={onUploaded} />
      )}
    </Panel>
  );
}

function BulkUpload({ versionId, onUploaded }: { versionId: string; onUploaded: (id?: string) => Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function submit() {
    setError('');
    setResult(null);
    const batchId = crypto.randomUUID();
    const total: BulkUploadResult = { queued: [], unassigned: [] };
    setProgress({ done: 0, total: files.length });
    try {
      for (let i = 0; i < files.length; i += CHUNK) {
        const form = new FormData();
        form.set('paperVersionId', versionId);
        form.set('batchId', batchId);
        for (const f of await Promise.all(files.slice(i, i + CHUNK).map(shrink))) form.append('files', f);
        const r = await api.upload<BulkUploadResult>('/theory-scripts/bulk', form);
        // A later chunk can add pages to an answer an earlier chunk queued; show it once.
        for (const q of r.queued) {
          const prev = total.queued.findIndex((x) => x.candidate === q.candidate && x.question === q.question);
          if (prev >= 0) total.queued[prev] = { ...q, pages: total.queued[prev].pages + q.pages };
          else total.queued.push(q);
        }
        total.unassigned.push(...r.unassigned);
        setProgress({ done: Math.min(files.length, i + CHUNK), total: files.length });
        setResult({ ...total });
        await onUploaded();
      }
      setFiles([]);
      if (input.current) input.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="label">
        Scanned answer-sheet pages (JPEG or PNG, any order, as many as you like)
        <input ref={input} type="file" multiple accept="image/jpeg,image/png" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      </label>
      <p className="m-0 text-sm text-ink-muted">
        Each page is filed by the code in its top-right corner, and pages of the same answer are kept together. Pages without a readable code wait below for you to file. Re-uploading an answer replaces the earlier scan and clears its marks.
      </p>
      {error ? <Alert tone="error" title="Upload stopped">{error}</Alert> : null}
      {result ? (
        <Alert tone={result.unassigned.length ? 'caution' : 'info'} title={`${result.queued.length} answer${result.queued.length === 1 ? '' : 's'} filed and queued for reading`}>
          {result.unassigned.length
            ? `${result.unassigned.length} page${result.unassigned.length === 1 ? '' : 's'} couldn’t be filed automatically and ${result.unassigned.length === 1 ? 'is' : 'are'} waiting below.`
            : 'Every page was filed automatically.'}
        </Alert>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {progress ? <Spinner label={`Uploading ${progress.done} of ${progress.total} pages…`} /> : null}
        <Button variant="primary" disabled={!files.length || !!progress} onClick={submit}>
          {files.length ? `Upload ${files.length} page${files.length === 1 ? '' : 's'}` : 'Upload pages'}
        </Button>
      </div>
    </div>
  );
}

function SingleUpload({
  versionId,
  candidates,
  questions,
  onUploaded,
}: {
  versionId: string;
  candidates: Candidate[];
  questions: Question[];
  onUploaded: (id?: string) => Promise<void>;
}) {
  const [candidateId, setCandidateId] = useState('');
  const [questionId, setQuestionId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('paperVersionId', versionId);
      form.set('candidateId', candidateId);
      form.set('questionId', questionId);
      form.set('file', await shrink(file));
      const a = await api.upload<ScriptAnswer>('/theory-scripts', form);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await onUploaded(a.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <CandidateSelect candidates={candidates} value={candidateId} onChange={setCandidateId} />
        <QuestionSelect questions={questions} value={questionId} onChange={setQuestionId} />
        <label className="label">
          Scan (JPEG or PNG, one question per file)
          <input ref={fileInput} type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <p className="m-0 text-sm text-ink-muted">For a scan without an answer-sheet code. Re-uploading for the same candidate and question replaces the earlier scan and clears its marks.</p>
      {error ? <Alert tone="error" title="Couldn’t upload">{error}</Alert> : null}
      <div className="flex justify-end">
        <Button variant="primary" disabled={!candidateId || !questionId || !file || busy} onClick={submit}>
          {busy ? 'Uploading…' : 'Upload and mark'}
        </Button>
      </div>
    </div>
  );
}

function CandidateSelect({ candidates, value, onChange }: { candidates: Candidate[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="label">
      Candidate
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.armyNumber} — {c.rank} {c.fullName}</option>
        ))}
      </select>
    </label>
  );
}

function QuestionSelect({ questions, value, onChange }: { questions: Question[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="label">
      Question
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {questions.map((q) => (
          <option key={q.id} value={q.id}>{q.body.length > 70 ? q.body.slice(0, 70) + '…' : q.body}</option>
        ))}
      </select>
    </label>
  );
}

function UnassignedPanel({
  scans,
  candidates,
  questions,
  existing,
  onChanged,
}: {
  scans: UnassignedScan[];
  candidates: Candidate[];
  questions: Question[];
  existing: ScriptAnswer[];
  onChanged: () => Promise<void>;
}) {
  return (
    <Panel className="flex flex-col gap-4 p-4 md:p-6">
      <div>
        <h2 className="t-title m-0">Pages waiting to be filed ({scans.length})</h2>
        <p className="m-0 text-sm text-ink-muted">These pages had no readable answer-sheet code, or the code didn’t match this paper. Say whose answer each one is.</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {scans.map((s) => (
          <UnassignedRow key={s.id} scan={s} candidates={candidates} questions={questions} existing={existing} onChanged={onChanged} />
        ))}
      </ul>
    </Panel>
  );
}

function UnassignedRow({
  scan,
  candidates,
  questions,
  existing,
  onChanged,
}: {
  scan: UnassignedScan;
  candidates: Candidate[];
  questions: Question[];
  existing: ScriptAnswer[];
  onChanged: () => Promise<void>;
}) {
  const [candidateId, setCandidateId] = useState('');
  const [questionId, setQuestionId] = useState('');
  const [append, setAppend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = `/api/theory-scripts/unassigned/${scan.id}/image`;
  const hasAnswer = existing.some((a) => a.candidateId === candidateId && a.questionId === questionId);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-line p-3 md:flex-row">
      <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Unfiled scan ${scan.originalName}`} className="h-40 w-32 rounded border border-line object-cover" />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="m-0 text-sm">
          <b>{scan.originalName}</b> <span className="text-ink-muted">· {scan.reason}</span>
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <CandidateSelect candidates={candidates} value={candidateId} onChange={setCandidateId} />
          <QuestionSelect questions={questions} value={questionId} onChange={setQuestionId} />
        </div>
        {hasAnswer ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />
            This candidate already has a scan for this question. Add this page after it (untick to replace it).
          </label>
        ) : null}
        {error ? <Alert tone="error" title="Couldn’t file this page">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" disabled={busy} onClick={() => confirm('Discard this page? The scan is deleted.') && run(() => api.del(`/theory-scripts/unassigned/${scan.id}`))}>
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!candidateId || !questionId || busy}
            onClick={() => run(() => api.post(`/theory-scripts/unassigned/${scan.id}/assign`, { candidateId, questionId, append: hasAnswer && append }))}
          >
            {busy ? 'Filing…' : 'File and mark'}
          </Button>
        </div>
      </div>
    </li>
  );
}

function ScriptDetail({ script: s, onChanged }: { script: ScriptAnswer; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [score, setScore] = useState(String(s.instructorScore ?? s.aiScore ?? ''));
  const [notes, setNotes] = useState(s.instructorNotes ?? '');
  const [page, setPage] = useState(1);
  const pageCount = 1 + (s.extraImagePaths?.length ?? 0);
  const max = s.aiMaxScore ?? undefined;
  const scanUrl = `/api/theory-scripts/${s.id}/image?page=${page}&v=${encodeURIComponent(s.uploadedAt)}`;
  const locked = s.status === 'PUBLISHED';
  const processing = s.status === 'UPLOADED';
  const n = Number(score);
  const scoreOk = score.trim() !== '' && Number.isFinite(n) && n >= 0 && (max == null || n <= max);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div>
        <h2 className="t-title m-0">{s.candidate.rank} {s.candidate.fullName}</h2>
        <p className="m-0 text-ink-muted">{s.question.body}</p>
        <p className="m-0 mt-1 text-[13px] text-ink-muted">Uploaded {fmt(s.uploadedAt)} by {s.uploadedBy}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <h3 className="m-0 flex-1 text-[15px] font-[650]">Scan</h3>
            {pageCount > 1
              ? Array.from({ length: pageCount }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={page === i + 1}
                    onClick={() => setPage(i + 1)}
                    className={`rounded px-2 py-1 text-sm font-[600] ${page === i + 1 ? 'bg-field text-white' : 'bg-surface-sunken'}`}
                  >
                    Page {i + 1}
                  </button>
                ))
              : null}
          </div>
          <a href={scanUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scanUrl} alt={`Handwritten answer by ${s.candidate.fullName}, page ${page}`} className="max-h-[520px] w-full rounded-md border border-line object-contain" />
          </a>
          <p className="m-0 text-[13px] text-ink-muted">Click the scan to open it full size.</p>
        </Panel>

        <Panel className="flex flex-col gap-2 p-4">
          <h3 className="m-0 text-[15px] font-[650]">What the system read{s.ocrModel ? <span className="font-normal text-ink-muted"> ({s.ocrModel})</span> : null}</h3>
          {processing ? <Spinner label="Waiting its turn to be read and marked…" /> : null}
          {s.ocrError ? <Alert tone="error" title="Couldn’t read this scan">{s.ocrError}</Alert> : null}
          {s.transcribedText ? (
            <p className="m-0 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-[15px]">{s.transcribedText}</p>
          ) : !processing && !s.ocrError ? (
            <p className="m-0 text-ink-muted">Nothing read yet.</p>
          ) : null}
          <p className="m-0 text-[13px] text-ink-muted">Check this against the scan. Handwriting reading can be wrong, so mark what the candidate actually wrote.</p>
        </Panel>
      </div>

      <Panel className="flex flex-col gap-3 p-4">
        <h3 className="m-0 text-[15px] font-[650]">AI proposal{s.aiModel ? <span className="font-normal text-ink-muted"> ({s.aiModel})</span> : null}</h3>
        {s.aiError ? <Alert tone="error" title="AI marking failed">{s.aiError}</Alert> : null}
        {s.aiScore != null ? (
          <>
            <p className="m-0"><span className="figure text-2xl font-bold">{s.aiScore}</span> <span className="text-ink-muted">out of {s.aiMaxScore}, proposed only, not final</span></p>
            <p className="m-0 whitespace-pre-wrap">{s.aiJustification}</p>
          </>
        ) : !processing && !s.aiError ? (
          <p className="m-0 text-ink-muted">No AI proposal. You can still mark this from the scan.</p>
        ) : null}
        {!locked && !processing ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="quiet" disabled={busy} onClick={() => run(() => api.post(`/theory-scripts/${s.id}/ocr`, {}))}>Read the scan again</Button>
            {s.transcribedText ? <Button variant="quiet" disabled={busy} onClick={() => run(() => api.post(`/theory-scripts/${s.id}/mark`, {}))}>Mark again</Button> : null}
            {s.transcribedText ? (
              <Button variant="quiet" disabled={busy} onClick={() => run(() => api.post(`/theory-scripts/${s.id}/mark`, { deep: true }))}>
                Second opinion (slower, reasons step by step)
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel className="flex flex-col gap-3 border-2 border-field p-4">
        <h3 className="m-0 text-[15px] font-[650]">Your mark</h3>
        {locked ? (
          <p className="m-0">Published: <b>{s.instructorScore}</b> out of {s.aiMaxScore}. Reviewed by {s.reviewedBy}{s.reviewedAt ? `, ${fmt(s.reviewedAt)}` : ''}.{s.instructorNotes ? ` Note: ${s.instructorNotes}` : ''}</p>
        ) : processing ? (
          <p className="m-0 text-ink-muted">Available once reading and marking finish.</p>
        ) : (
          <>
            {s.status === 'REVIEWED' ? (
              <Alert tone="info" title="You confirmed this mark">Reviewed by {s.reviewedBy}{s.reviewedAt ? `, ${fmt(s.reviewedAt)}` : ''}. You can still change it until results are published.</Alert>
            ) : null}
            <div className="grid gap-3 md:grid-cols-[160px_1fr]">
              <label className="label">
                Mark{max != null ? ` (0 to ${max})` : ''}
                <input type="number" min={0} max={max} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} />
              </label>
              <label className="label">
                Note (optional, e.g. why you changed the AI mark)
                <input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
            {error ? <Alert tone="error" title="Couldn’t save">{error}</Alert> : null}
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={!scoreOk || busy}
                onClick={() => run(() => api.patch(`/theory-scripts/${s.id}/review`, { score: n, notes: notes.trim() || undefined }))}
              >
                {busy ? 'Saving…' : s.status === 'REVIEWED' ? 'Update confirmed mark' : 'Confirm mark'}
              </Button>
            </div>
          </>
        )}
        {locked && error ? <Alert tone="error" title="Something went wrong">{error}</Alert> : null}
      </Panel>
    </div>
  );
}
