'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, MarksBar, SourceBadge, Spinner } from '@/components/nc/basics';
import { ConceptGroupEditor } from '@/components/nc/scheme';
import { Glyph } from '@/components/nc/glyph';
import { api, type ConceptGroup, type MarkResult, type MarkingScheme, type Question } from '@/lib/api';

interface Suggest { reusedFromBank: boolean; scheme: MarkingScheme | null; suggestion?: MarkingScheme }

export function SchemePanel({ question, number, onClose, onSaved }: { question: Question; number: number; onClose: () => void; onSaved: () => void }) {
  const [scheme, setScheme] = useState<MarkingScheme | null>(null);
  const [reused, setReused] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<MarkResult | null>(null);
  const [testError, setTestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmUnallocated, setConfirmUnallocated] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  useEffect(() => {
    api
      .get<Suggest>(`/question-bank/${question.id}/marking-scheme/suggest`)
      .then((r) => {
        setReused(r.reusedFromBank);
        const s = r.scheme ?? r.suggestion!;
        setScheme({ totalMarks: s.totalMarks, ceilingPercent: s.ceilingPercent, minWordCount: s.minWordCount, conceptGroups: s.conceptGroups.map(pickGroup) });
      })
      .catch((e) => setLoadError(e.message));
  }, [question.id]);

  // Score the sample answer with the server's marker — the same rules the exam centre runs.
  useEffect(() => {
    if (!scheme || !answer.trim()) return;
    const t = setTimeout(() => {
      api
        .post<MarkResult>(`/question-bank/${question.id}/marking-scheme/test`, {
          answer,
          scheme: { ...scheme, conceptGroups: scheme.conceptGroups.filter((g) => g.canonicalTerm.trim()) },
        })
        .then((r) => {
          setResult(r);
          setTestError('');
        })
        .catch((e) => setTestError(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [answer, scheme, question.id]);

  const shownResult = answer.trim() ? result : null;
  const allocated = scheme?.conceptGroups.reduce((n, g) => n + (g.marks || 0), 0) ?? 0;
  const setGroups = (groups: ConceptGroup[]) => scheme && setScheme({ ...scheme, conceptGroups: groups });

  async function save(acknowledge = false) {
    if (!scheme) return;
    if (allocated !== scheme.totalMarks && !acknowledge) {
      setConfirmUnallocated(true);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await api.put(`/question-bank/${question.id}/marking-scheme`, {
        ...scheme,
        conceptGroups: scheme.conceptGroups.filter((g) => g.canonicalTerm.trim()),
        acknowledgeUnallocated: acknowledge || undefined,
      });
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the scheme.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(15,24,15,0.45)]" aria-hidden="true" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheme-title"
        className="absolute inset-0 flex flex-col bg-surface-raised shadow-[var(--shadow-overlay)] md:inset-y-0 md:left-auto md:right-0 md:w-[640px]"
      >
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 md:px-6">
          <div className="flex items-center gap-2">
            <h2 id="scheme-title" className="t-title m-0 flex-1">Marking scheme for Q{number}</h2>
            {reused ? <SourceBadge source="PAST_PAPER" reused /> : null}
            <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-md text-ink-muted hover:bg-surface-sunken">
              <Glyph name="cross" />
            </button>
          </div>
          <p className="m-0 whitespace-pre-line">{question.body}</p>
          {scheme ? <MarksBar allocated={allocated} total={scheme.totalMarks} /> : null}
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-5 md:px-6">
          {loadError ? <Alert tone="error" title="Couldn’t load the scheme">{loadError}</Alert> : null}
          {!scheme && !loadError ? <Spinner label="Loading scheme…" /> : null}
          {scheme ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <label className="label">Total marks<input type="number" min={1} value={scheme.totalMarks} onChange={(e) => setScheme({ ...scheme, totalMarks: Math.max(1, parseInt(e.target.value || '1', 10)) })} /></label>
                <label className="label" title="Score cap when a required group is missing">Cap if required missing (%)<input type="number" min={0} max={100} value={scheme.ceilingPercent} onChange={(e) => setScheme({ ...scheme, ceilingPercent: Math.max(0, parseInt(e.target.value || '0', 10)) })} /></label>
                <label className="label" title="Shorter answers score zero">Minimum words<input type="number" min={0} value={scheme.minWordCount} onChange={(e) => setScheme({ ...scheme, minWordCount: Math.max(0, parseInt(e.target.value || '0', 10)) })} /></label>
              </div>
              {!reused && !question.markingScheme ? (
                <p className="m-0 text-sm text-ink-muted">Suggested groups come from the key terms in the question. Edit them into the concepts a good answer must mention.</p>
              ) : null}
              <h3 className="t-heading m-0">Concept groups</h3>
              {scheme.conceptGroups.map((g, i) => (
                <ConceptGroupEditor
                  key={i}
                  index={i}
                  group={g}
                  onChange={(ng) => setGroups(scheme.conceptGroups.map((x, j) => (j === i ? ng : x)))}
                  onRemove={() => setGroups(scheme.conceptGroups.filter((_, j) => j !== i))}
                />
              ))}
              <div>
                <Button variant="quiet" icon="plus" onClick={() => setGroups([...scheme.conceptGroups, { canonicalTerm: '', synonyms: [], marks: 1, required: false }])}>
                  Add group
                </Button>
              </div>

              <div className="nc-tester">
                <label className="label">
                  Test your scheme
                  <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Paste a sample candidate answer" />
                </label>
                {testError ? <p className="m-0 text-sm text-rejected">{testError}</p> : null}
                {shownResult && result ? (
                  <div aria-live="polite" className="flex flex-col gap-2">
                    <p className="m-0 flex flex-wrap items-baseline gap-3">
                      <span className="figure">{result.score} / {result.maxScore}</span>
                      {result.flaggedTooShort ? (
                        <span className="nc-tester-cap"><Glyph name="warn" />Too short: {result.wordCount} words, minimum {scheme.minWordCount}. Scores zero.</span>
                      ) : result.requiredGroupMissing ? (
                        <span className="nc-tester-cap"><Glyph name="warn" />Capped at {scheme.ceilingPercent}%: a required group is missing</span>
                      ) : null}
                    </p>
                    <ul className="nc-tester-groups">
                      {scheme.conceptGroups.filter((g) => g.canonicalTerm.trim()).map((g) => {
                        const hit = result.matchedGroups.includes(g.canonicalTerm);
                        return (
                          <li key={g.canonicalTerm} className={hit ? 'is-hit' : 'is-miss'}>
                            <Glyph name={hit ? 'check' : 'cross'} />
                            <span className="nc-tester-term">{g.canonicalTerm}{g.required ? <span className="nc-req">required</span> : null}</span>
                            <span className="nc-muted">{hit ? 'found' : 'not found'}</span>
                            <span className="nc-num">{hit ? `+${g.marks}` : '0'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="t-small m-0 text-ink-muted">Scored by the same marker the exam centre runs: words match exactly or on their first four letters, multi-word terms need every word, and answers under the minimum word count score zero.</p>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 md:px-6">
          {confirmUnallocated && scheme ? (
            <Alert tone="caution" title={`${Math.abs(scheme.totalMarks - allocated)} marks ${allocated < scheme.totalMarks ? 'unallocated' : 'over the total'}`}>
              {allocated < scheme.totalMarks ? 'No answer can reach full marks with this scheme.' : 'Scores are capped at the total.'} Save anyway?
              <div className="nc-row mt-2">
                <Button variant="primary" disabled={saving} onClick={() => save(true)}>Save anyway</Button>
                <Button variant="quiet" onClick={() => setConfirmUnallocated(false)}>Keep editing</Button>
              </div>
            </Alert>
          ) : null}
          {saveError ? <Alert tone="error" title="Couldn’t save">{saveError}</Alert> : null}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] text-ink-muted">This scheme marks the question automatically when candidates submit.</span>
            <Button variant="quiet" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!scheme || saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save scheme'}</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

const pickGroup = (g: ConceptGroup): ConceptGroup => ({ canonicalTerm: g.canonicalTerm, synonyms: g.synonyms ?? [], marks: g.marks, required: g.required });
