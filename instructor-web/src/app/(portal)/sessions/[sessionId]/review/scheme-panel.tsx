'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, MarksBar, SourceBadge, Spinner } from '@/components/nc/basics';
import { ConceptGroupEditor } from '@/components/nc/scheme';
import { Glyph } from '@/components/nc/glyph';
import { api, type ConceptGroup, type MarkResult, type MarkingScheme, type Question, type SchemeTestResult } from '@/lib/api';
import { answerBlocks, awardRule, splitScheme } from '@/lib/scheme-format';
import { CancelAiButton } from '@/components/shell/ai-status';

interface Suggest { reusedFromBank: boolean; scheme: MarkingScheme | null; suggestion?: MarkingScheme }

const LABELS = ['full', 'partial', 'weak', 'off-topic'];
// What a sensible scheme should give each kind of sample answer, as a share of the total.
const BAND: Record<string, [number, number, string]> = {
  full: [0.8, 1, 'close to full marks'],
  partial: [0.3, 0.7, 'about half'],
  weak: [0, 0.35, 'a quarter or less'],
  'off-topic': [0, 0.1, 'nothing'],
};
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const editable = (s: MarkingScheme) => ({
  totalMarks: s.totalMarks,
  ceilingPercent: s.ceilingPercent,
  minWordCount: s.minWordCount,
  conceptGroups: s.conceptGroups.map((g) => ({ canonicalTerm: g.canonicalTerm, synonyms: g.synonyms ?? [], marks: g.marks, required: g.required, notes: g.notes ?? '' })),
  modelAnswer: s.modelAnswer ?? '',
  partialCreditNotes: s.partialCreditNotes ?? '',
  zeroCreditNotes: s.zeroCreditNotes ?? '',
  sampleAnswers: (s.sampleAnswers ?? []).map((a) => ({ label: a.label, text: a.text })),
});
type Editable = ReturnType<typeof editable>;

/** Moving between the theory questions under review without closing the panel. */
export interface SchemeNav {
  index: number;
  total: number;
  go: (delta: number) => void;
}

export function SchemePanel({ question, number, nav, onClose, onSaved }: { question: Question; number: number; nav?: SchemeNav; onClose: () => void; onSaved: () => void }) {
  // Opens as the scheme laid out to read, like the printed marking scheme; editing is one click away.
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [server, setServer] = useState<MarkingScheme | null>(null);
  const [draft, setDraft] = useState<Editable | null>(null);
  const [reused, setReused] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<MarkResult | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && nav && e.key === 'ArrowRight' && nav.index < nav.total - 1) nav.go(1);
      if (!typing && nav && e.key === 'ArrowLeft' && nav.index > 0) nav.go(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, nav]);

  function adopt(s: MarkingScheme) {
    setServer(s);
    setDraft(editable(s));
  }

  useEffect(() => {
    api
      .get<Suggest>(`/question-bank/${question.id}/marking-scheme/suggest`)
      .then((r) => {
        setReused(r.reusedFromBank);
        if (r.scheme) adopt(r.scheme);
        else setDraft(editable(r.suggestion!));
        if (!(r.scheme ?? r.suggestion)?.conceptGroups.length) setMode('edit');
      })
      .catch((e) => setLoadError(e.message));
  }, [question.id]);

  // The AI drafts and tests in the background on the server; follow it until it finishes.
  const aiTask = server?.aiTask;
  useEffect(() => {
    if (!aiTask) return;
    const t = setInterval(async () => {
      try {
        const s = await api.get<MarkingScheme>(`/question-bank/${question.id}/marking-scheme`);
        if (!s.aiTask) {
          adopt(s);
          onSaved();
        }
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [aiTask, question.id, onSaved]);

  // Quick keyword check: the simple automatic marker, not the AI.
  useEffect(() => {
    if (!draft || !answer.trim()) return;
    const t = setTimeout(() => {
      api
        .post<MarkResult>(`/question-bank/${question.id}/marking-scheme/test`, {
          answer,
          scheme: { totalMarks: draft.totalMarks, ceilingPercent: draft.ceilingPercent, minWordCount: draft.minWordCount, conceptGroups: draft.conceptGroups.filter((g) => g.canonicalTerm.trim()).map((g) => ({ canonicalTerm: g.canonicalTerm, synonyms: g.synonyms, marks: g.marks, required: g.required })) },
        })
        .then(setResult, () => setResult(null));
    }, 350);
    return () => clearTimeout(t);
  }, [answer, draft, question.id]);

  const allocated = draft?.conceptGroups.reduce((n, g) => n + (g.marks || 0), 0) ?? 0;
  const balanced = !!draft && Math.abs(allocated - draft.totalMarks) < 0.001;
  const dirty = !!draft && (!server || JSON.stringify(editable(server)) !== JSON.stringify(draft));
  const approved = server?.status === 'APPROVED' && !dirty;
  const working = !!aiTask || !!busy;
  const set = (patch: Partial<Editable>) => draft && setDraft({ ...draft, ...patch });
  const setGroups = (groups: ConceptGroup[]) => set({ conceptGroups: groups.map((g) => ({ ...g, notes: g.notes ?? '' })) });

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }

  async function approve(thenNext: boolean) {
    await run('approve', async () => {
      if (dirty || !server) await save();
      adopt(await api.post<MarkingScheme>(`/question-bank/${question.id}/marking-scheme/approve`, {}));
      if (question.status === 'DRAFT') await api.post(`/question-bank/${question.id}/approve`);
      onSaved();
      if (thenNext && nav && nav.index < nav.total - 1) nav.go(1);
    });
  }

  async function save(acknowledge = false) {
    if (!draft) return;
    const s = await api.put<MarkingScheme>(`/question-bank/${question.id}/marking-scheme`, {
      ...draft,
      conceptGroups: draft.conceptGroups.filter((g) => g.canonicalTerm.trim()).map((g) => ({ ...g, notes: g.notes || undefined })),
      sampleAnswers: draft.sampleAnswers.filter((a) => a.text.trim()),
      acknowledgeUnallocated: acknowledge || undefined,
    });
    adopt(s);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(15,24,15,0.45)]" aria-hidden="true" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="scheme-title" className="absolute inset-0 flex flex-col bg-surface-raised shadow-[var(--shadow-overlay)] md:inset-y-0 md:left-auto md:right-0 md:w-[min(960px,94vw)]">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 md:px-6">
          <div className="flex items-center gap-2">
            <h2 id="scheme-title" className="t-title m-0 flex-1">
              Marking scheme for Q{number}
              {draft ? <span className="ml-2 text-base font-normal text-ink-muted">{draft.totalMarks} marks</span> : null}
            </h2>
            {nav && nav.total > 1 ? (
              <div className="flex items-center gap-1 text-sm text-ink-muted" aria-label="Theory questions">
                <Button variant="quiet" disabled={nav.index === 0} onClick={() => nav.go(-1)} aria-label="Previous question">‹</Button>
                <span className="tabular-nums">{nav.index + 1} of {nav.total}</span>
                <Button variant="quiet" disabled={nav.index >= nav.total - 1} onClick={() => nav.go(1)} aria-label="Next question">›</Button>
              </div>
            ) : null}
            {reused ? <SourceBadge source="PAST_PAPER" reused /> : null}
            {server ? <Chip tone={approved ? 'approved' : 'caution'}>{approved ? 'Approved' : dirty && server.status === 'APPROVED' ? 'Changed since approval' : 'Draft'}</Chip> : null}
            <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-md text-ink-muted hover:bg-surface-sunken">
              <Glyph name="cross" />
            </button>
          </div>
          {mode === 'edit' ? <p className="m-0 whitespace-pre-line">{question.body}</p> : null}
          {draft ? <MarksBar allocated={allocated} total={draft.totalMarks} /> : null}
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-auto px-4 py-5 md:px-6">
          {loadError ? <Alert tone="error" title="Couldn’t load the scheme">{loadError}</Alert> : null}
          {!draft && !loadError ? <Spinner label="Loading scheme…" /> : null}
          {aiTask && server ? (
            <div className="flex flex-wrap items-center gap-3">
              <Spinner label={aiTask === 'drafting' ? 'The AI is drafting key points, variations and sample answers. This can take a few minutes…' : 'The AI marker is marking the sample answers…'} />
              <CancelAiButton
                jobId={`scheme:${server.id}`}
                onCancelled={() => void api.get<MarkingScheme>(`/question-bank/${question.id}/marking-scheme`).then((s) => { adopt(s); onSaved(); }, () => undefined)}
              />
            </div>
          ) : null}
          {server?.aiTaskError ? <Alert tone="error" title="The AI couldn’t finish">{server.aiTaskError}</Alert> : null}

          {draft && mode === 'read' ? <SchemeReadView question={question} draft={draft} balanced={balanced} /> : null}

          {draft && mode === 'edit' ? (
            <>
              {server ?? draft.conceptGroups.length ? (
                <div>
                  <Button variant="quiet" onClick={() => setMode('read')}>‹ Back to reading view</Button>
                </div>
              ) : null}
              <section className="flex flex-col gap-3">
                <h3 className="t-heading m-0">1. Model answer</h3>
                <label className="label">
                  Write the answer as you would brief a co-marker
                  <textarea rows={5} value={draft.modelAnswer} disabled={working} onChange={(e) => set({ modelAnswer: e.target.value })} placeholder="e.g. The 4Ds: Destination (where the force operates)…" />
                </label>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="label w-32">Total marks<input type="number" min={0.5} step={0.5} value={draft.totalMarks} disabled={working} onChange={(e) => set({ totalMarks: Math.max(0.5, Number(e.target.value || '1')) })} /></label>
                  <Button
                    variant="secondary"
                    disabled={working || draft.modelAnswer.trim().length < 10}
                    onClick={() => run('draft', async () => adopt(await api.post<MarkingScheme>(`/question-bank/${question.id}/marking-scheme/ai-draft`, { modelAnswer: draft.modelAnswer, totalMarks: draft.totalMarks })))}
                  >
                    Draft key points with AI
                  </Button>
                  <span className="text-[13px] text-ink-muted">Replaces the key points below. Runs on the college server; nothing leaves it.</span>
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <h3 className="t-heading m-0">2. Key points and accepted variations</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="label" title="Score cap when a required point is missing">Cap if a required point is missing (%)<input type="number" min={0} max={100} value={draft.ceilingPercent} onChange={(e) => set({ ceilingPercent: Math.max(0, parseInt(e.target.value || '0', 10)) })} /></label>
                  <label className="label" title="Answers clearly shorter than this score low">Minimum words<input type="number" min={0} value={draft.minWordCount} onChange={(e) => set({ minWordCount: Math.max(0, parseInt(e.target.value || '0', 10)) })} /></label>
                </div>
                {draft.conceptGroups.map((g, i) => (
                  <ConceptGroupEditor
                    key={i}
                    index={i}
                    group={g}
                    onChange={(ng) => setGroups(draft.conceptGroups.map((x, j) => (j === i ? ng : x)))}
                    onRemove={() => setGroups(draft.conceptGroups.filter((_, j) => j !== i))}
                  />
                ))}
                <div>
                  <Button variant="quiet" icon="plus" onClick={() => setGroups([...draft.conceptGroups, { canonicalTerm: '', synonyms: [], marks: 1, required: false, notes: '' }])}>Add key point</Button>
                </div>
                <label className="label">How part marks work overall<input value={draft.partialCreditNotes} onChange={(e) => set({ partialCreditNotes: e.target.value })} placeholder="e.g. a point named but not explained earns half its marks" /></label>
                <label className="label">Earns nothing<input value={draft.zeroCreditNotes} onChange={(e) => set({ zeroCreditNotes: e.target.value })} placeholder="e.g. listing the principles of war instead of the 4Ds" /></label>
              </section>

              <section className="flex flex-col gap-3">
                <h3 className="t-heading m-0">3. Test before approving</h3>
                <p className="m-0 text-sm text-ink-muted">Sample answers are marked by the same AI marker that marks the scripts. A good scheme gives the full answer close to full marks and the off-topic one nothing.</p>
                {draft.sampleAnswers.map((a, i) => (
                  <div key={i} className="flex flex-col gap-1 rounded-md border border-line p-3">
                    <div className="flex items-center gap-2">
                      <select aria-label="Kind of sample answer" value={a.label} onChange={(e) => set({ sampleAnswers: draft.sampleAnswers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}>
                        {LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <span className="flex-1" />
                      <Button variant="quiet" onClick={() => set({ sampleAnswers: draft.sampleAnswers.filter((_, j) => j !== i) })}>Remove</Button>
                    </div>
                    <textarea aria-label={`Sample answer ${i + 1}`} rows={3} value={a.text} onChange={(e) => set({ sampleAnswers: draft.sampleAnswers.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="quiet" icon="plus" onClick={() => set({ sampleAnswers: [...draft.sampleAnswers, { label: LABELS[draft.sampleAnswers.length % 4], text: '' }] })}>Add sample answer</Button>
                  <Button
                    variant="secondary"
                    disabled={working || !draft.conceptGroups.length || !draft.sampleAnswers.some((a) => a.text.trim())}
                    onClick={() =>
                      run('test', async () => {
                        if (dirty) await save(true);
                        adopt(await api.post<MarkingScheme>(`/question-bank/${question.id}/marking-scheme/ai-test`, {}));
                      })
                    }
                  >
                    Test with the AI marker
                  </Button>
                </div>
                {server?.testResults?.length && !dirty ? <TestResults results={server.testResults} testedAt={server.testedAt} /> : null}
                {server?.testResults?.length && dirty ? <p className="m-0 text-sm text-ink-muted">You’ve changed the scheme since the last test. Test again to see how it marks now.</p> : null}

                <details className="nc-tester">
                  <summary className="cursor-pointer text-sm font-[600]">Quick keyword check (instant, no AI)</summary>
                  <textarea aria-label="Sample answer for keyword check" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Paste a sample answer to see which key points are found by keyword" />
                  {answer.trim() && result ? (
                    <ul className="nc-tester-groups">
                      {draft.conceptGroups.filter((g) => g.canonicalTerm.trim()).map((g) => {
                        const hit = result.matchedGroups.includes(g.canonicalTerm);
                        return (
                          <li key={g.canonicalTerm} className={hit ? 'is-hit' : 'is-miss'}>
                            <Glyph name={hit ? 'check' : 'cross'} />
                            <span className="nc-tester-term">{g.canonicalTerm}</span>
                            <span className="nc-muted">{hit ? 'found' : 'not found'}</span>
                            <span className="nc-num">{hit ? `+${g.marks}` : '0'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </details>
              </section>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 md:px-6">
          {error ? <Alert tone="error" title="Couldn’t do that">{error}</Alert> : null}
          {approved && server?.approvedBy ? (
            <p className="m-0 text-[13px] text-ink-muted">Approved by {server.approvedBy}{server.approvedAt ? `, ${fmtDate(server.approvedAt)}` : ''}. Publishing freezes this version with the paper; any edit needs approving again.</p>
          ) : (
            <p className="m-0 text-[13px] text-ink-muted">
              Approving accepts this scheme{question.status === 'DRAFT' ? ' and the question' : ''}. Scripts are marked against the approved scheme, and you confirm every mark.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="quiet" onClick={onClose}>Close</Button>
            {mode === 'read' ? (
              <Button variant="secondary" disabled={!draft || working} onClick={() => setMode('edit')}>Edit scheme</Button>
            ) : (
              <Button variant="secondary" disabled={!draft || working || !dirty} onClick={() => run('save', () => save(!balanced))}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
            )}
            {approved && nav && nav.index < nav.total - 1 ? (
              <Button variant="primary" onClick={() => nav.go(1)}>Next question ›</Button>
            ) : (
              <Button
                variant="primary"
                disabled={!draft || working || approved || !balanced || !draft.conceptGroups.length}
                title={!balanced ? 'The key points must add up to the total marks' : undefined}
                onClick={() => approve(!!nav && nav.index < nav.total - 1)}
              >
                {busy === 'approve' ? 'Approving…' : approved ? 'Approved' : nav && nav.index < nav.total - 1 ? 'Approve and next ›' : 'Approve'}
              </Button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function TestResults({ results, testedAt }: { results: SchemeTestResult[]; testedAt?: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      {results.map((r, i) => {
        const band = BAND[r.label];
        const share = r.max ? r.score / r.max : 0;
        const inBand = !band || (share >= band[0] - 0.001 && share <= band[1] + 0.001);
        return (
          <details key={i} className="rounded-md border border-line p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="font-[650] capitalize">{r.label}</span>
              <span className="figure">{r.score} / {r.max}</span>
              {band ? <Chip tone={inBand ? 'approved' : 'caution'}>{inBand ? 'as expected' : `expected ${band[2]}`}</Chip> : null}
            </summary>
            <p className="m-0 mt-2 text-sm">{r.justification}</p>
            {r.points.length ? (
              <ul className="nc-tester-groups mt-2">
                {r.points.map((p) => (
                  <li key={p.point} className={p.awarded > 0 ? 'is-hit' : 'is-miss'}>
                    <Glyph name={p.awarded > 0 ? 'check' : 'cross'} />
                    <span className="nc-tester-term">{p.point}</span>
                    <span className="nc-muted">{p.evidence}</span>
                    <span className="nc-num">{p.awarded}/{p.max}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        );
      })}
      {testedAt ? <p className="m-0 text-[13px] text-ink-muted">Tested {fmtDate(testedAt)}.</p> : null}
    </div>
  );
}

/**
 * The scheme laid out to read: each part with its question and marks, the
 * model answer as the department wrote it, and what earns the marks.
 */
function SchemeReadView({ question, draft, balanced }: { question: Question; draft: Editable; balanced: boolean }) {
  const { stem, parts } = splitScheme({
    body: question.body,
    modelAnswer: draft.modelAnswer || null,
    markingNotes: draft.partialCreditNotes || null,
    totalMarks: draft.totalMarks,
    points: draft.conceptGroups.map((g) => ({ term: g.canonicalTerm, marks: g.marks, notes: g.notes || null, synonyms: g.synonyms })),
  });
  const required = draft.conceptGroups.some((g) => g.required);
  return (
    <div className="flex flex-col gap-4">
      {!balanced ? (
        <Alert tone="caution" title="The marks don’t add up yet">
          The key points come to {draft.conceptGroups.reduce((n, g) => n + (g.marks || 0), 0)} but the question is worth {draft.totalMarks}. Use Edit scheme to fix them before approving.
        </Alert>
      ) : null}
      {stem ? <p className="m-0 font-[600]">{stem}</p> : null}
      {parts.map((part, i) => (
        <SchemePartCard key={part.label ?? i} part={part} />
      ))}
      <p className="m-0 text-[13px] text-ink-muted">
        Answers under {draft.minWordCount} word{draft.minWordCount === 1 ? '' : 's'} score low.
        {required ? ` If a point marked “must have” is missing, the score is capped at ${draft.ceilingPercent}%.` : ''}
      </p>
    </div>
  );
}

function SchemePartCard({ part }: { part: ReturnType<typeof splitScheme>['parts'][number] }) {
  const blocks = answerBlocks(part.answer);
  // Long explained answers start folded to their first lines; the key points below carry the marks.
  const long = part.answer.length > 700;
  const [open, setOpen] = useState(!long);
  const marks = part.marks ?? part.points.reduce((n, p) => n + p.marks, 0);
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line bg-surface-sunken px-4 py-3">
        {part.label ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-field-soft text-sm font-[700] text-field">{part.label}</span> : null}
        <p className="m-0 flex-1 font-[600] leading-snug">{part.question}</p>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-line px-2.5 py-0.5 text-sm font-[650] tabular-nums">
          {marks} mark{marks === 1 ? '' : 's'}
        </span>
      </header>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 text-[12px] font-[650] uppercase tracking-[0.06em] text-ink-muted">Model answer</p>
          {blocks.length ? (
            <div className="flex flex-col gap-1.5">
              {blocks.map((b, i) =>
                b.label ? (
                  <div key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-1 leading-relaxed">
                    <span className="text-right font-[600] text-ink-muted tabular-nums">{b.label}</span>
                    <span className={open ? '' : 'line-clamp-2'}>
                      {b.heading ? <b>{b.heading} </b> : null}
                      {b.text}
                    </span>
                  </div>
                ) : (
                  <p key={i} className={`m-0 leading-relaxed ${open ? '' : 'line-clamp-3'}`}>
                    {b.heading ? <b>{b.heading} </b> : null}
                    {b.text}
                  </p>
                ),
              )}
            </div>
          ) : (
            <p className="m-0 text-ink-muted">No model answer written. Use Edit scheme to add one.</p>
          )}
          {long ? (
            <div>
              <Button variant="quiet" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show the full answer'}</Button>
            </div>
          ) : null}
          {part.note ? <p className="m-0 text-sm italic text-ink-muted">({part.note})</p> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 text-[12px] font-[650] uppercase tracking-[0.06em] text-ink-muted">Marks are given for</p>
          {part.points.length ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line p-0">
              {part.points.map((pt, i) => (
                <li key={i} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-[600] leading-snug">{pt.term}</div>
                    {awardRule(pt.notes) ? <div className="text-[13px] text-ink-muted">{awardRule(pt.notes)}</div> : null}
                    {pt.synonyms.length ? <div className="text-[13px] text-ink-muted">Accept: {pt.synonyms.join(', ')}</div> : null}
                  </div>
                  <span className="shrink-0 font-[700] tabular-nums">{pt.marks}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-ink-muted">No key points yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
