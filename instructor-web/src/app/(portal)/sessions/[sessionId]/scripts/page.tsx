'use client';
import { use, useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import { api, qs, type Candidate, type Paper, type Question, type ScriptAnswer, type ScriptStatus } from '@/lib/api';
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

  // OCR + marking run in the background on the server; keep refreshing while any are in flight.
  const processing = scripts.data?.some((s) => s.status === 'UPLOADED') ?? false;
  const reloadRef = useRef(scripts.reload);
  useEffect(() => {
    reloadRef.current = scripts.reload;
  });
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void reloadRef.current(), 4000);
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
        intro="Upload a scan of a handwritten answer. The system reads the handwriting and proposes a mark with its reasoning; nothing counts until you have checked it against the scan and confirmed the mark."
        crumbs={[['Exam sessions', '/sessions'], [info.data?.title ?? '…', `/sessions/${sessionId}/review`], ['Theory scripts']]}
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
            onUploaded={async (a) => {
              setSelectedId(a.id);
              await scripts.reload();
            }}
          />

          {scripts.data && !list.length ? (
            <EmptyState title="No scripts uploaded yet" body="Choose a candidate and question above and attach the scan." />
          ) : null}

          {list.length ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <p className="m-0 flex-1 text-ink-muted">
                  {list.length} script{list.length === 1 ? '' : 's'}
                  {notReady ? ` — ${notReady} still need${notReady === 1 ? 's' : ''} review` : ' — all reviewed'}
                </p>
                <Button variant="primary" disabled={publishing || notReady > 0 || toPublish === 0} onClick={publish}>
                  {publishing ? 'Publishing…' : `Publish ${toPublish} reviewed result${toPublish === 1 ? '' : 's'}`}
                </Button>
              </div>
              {publishError ? <Alert tone="error" title="Couldn’t publish">{publishError}</Alert> : null}

              <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                <Panel className="shrink-0 overflow-hidden xl:w-[360px]">
                  <ul className="m-0 flex list-none flex-col p-0">
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
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
                {selected ? <ScriptDetail key={selected.id + selected.updatedAt} script={selected} onChanged={scripts.reload} /> : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
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
  onUploaded: (a: ScriptAnswer) => Promise<void>;
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
      form.set('file', file);
      const a = await api.upload<ScriptAnswer>('/theory-scripts', form);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await onUploaded(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-col gap-4 p-4 md:p-6">
      <h2 className="t-title m-0">Upload a scan</h2>
      {!questions.length ? <Alert tone="caution" title="No theory questions on this paper">Only theory questions take a handwritten answer.</Alert> : null}
      {!candidates.length ? <Alert tone="caution" title="No active candidates">Add candidates first.</Alert> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="label">
          Candidate
          <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
            <option value="">Choose…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.armyNumber} — {c.rank} {c.fullName}</option>
            ))}
          </select>
        </label>
        <label className="label">
          Question
          <select value={questionId} onChange={(e) => setQuestionId(e.target.value)}>
            <option value="">Choose…</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>{q.body.length > 70 ? q.body.slice(0, 70) + '…' : q.body}</option>
            ))}
          </select>
        </label>
        <label className="label">
          Scan (JPEG or PNG, one question per file)
          <input ref={fileInput} type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <p className="m-0 text-sm text-ink-muted">
        Re-uploading for the same candidate and question replaces the earlier scan and clears its marks. Reading a page takes a few minutes; you can leave this page and come back.
      </p>
      {error ? <Alert tone="error" title="Couldn’t upload">{error}</Alert> : null}
      <div className="flex justify-end">
        <Button variant="primary" disabled={!candidateId || !questionId || !file || busy} onClick={submit}>
          {busy ? 'Uploading…' : 'Upload and mark'}
        </Button>
      </div>
    </Panel>
  );
}

function ScriptDetail({ script: s, onChanged }: { script: ScriptAnswer; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [score, setScore] = useState(String(s.instructorScore ?? s.aiScore ?? ''));
  const [notes, setNotes] = useState(s.instructorNotes ?? '');
  const max = s.aiMaxScore ?? undefined;
  const scanUrl = `/api/theory-scripts/${s.id}/image?v=${encodeURIComponent(s.uploadedAt)}`;
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
          <h3 className="m-0 text-[15px] font-[650]">Scan</h3>
          <a href={scanUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scanUrl} alt={`Handwritten answer by ${s.candidate.fullName}`} className="max-h-[520px] w-full rounded-md border border-line object-contain" />
          </a>
          <p className="m-0 text-[13px] text-ink-muted">Click the scan to open it full size.</p>
        </Panel>

        <Panel className="flex flex-col gap-2 p-4">
          <h3 className="m-0 text-[15px] font-[650]">What the system read{s.ocrModel ? <span className="font-normal text-ink-muted"> ({s.ocrModel})</span> : null}</h3>
          {processing ? <Spinner label="Reading the handwriting and marking…" /> : null}
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
