'use client';
import { useRef, useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import { useUser } from '@/components/shell/user-context';
import { api, downloadCsv, qs, type Course, type ImportSummary, type Paper, type ResultsSummary } from '@/lib/api';
import { useData } from '@/lib/use-data';

interface PublishedPaper { versionId: string; label: string; version: number }

const pct = (n: number) => `${Math.round(n * 100)}%`;
const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export default function ResultsPage() {
  const user = useUser();
  const canImport = user.role === 'EXAM_OFFICER' || user.role === 'ADMIN';
  const papers = useData<PublishedPaper[]>(async () => {
    const courses = await api.get<Course[]>('/courses');
    const out: PublishedPaper[] = [];
    for (const c of courses)
      for (const s of c.sessions) {
        const ps = await api.get<Paper[]>(`/papers${qs({ sessionId: s.id })}`);
        for (const p of ps) if (p.versions[0]) out.push({ versionId: p.versions[0].id, label: `${c.code} ${c.name}, ${s.label}`, version: p.versions[0].versionNumber });
      }
    return out;
  }, []);
  const [selected, setSelected] = useState('');
  const paper = papers.data?.find((p) => p.versionId === selected) ?? papers.data?.[0];
  const results = useData(() => (paper ? api.get<ResultsSummary>(`/results${qs({ paperVersionId: paper.versionId })}`) : Promise.resolve(null)), [paper?.versionId]);
  const r = results.data;

  function exportCsv() {
    if (!r || !paper) return;
    const header = ['Service number', 'Rank', 'Name', 'Objective', 'Objective out of', 'Theory', 'Theory out of', 'Total', 'Out of', 'Percent', 'Result'];
    const lines = r.rows.map((row) =>
      [row.armyNumber, row.rank, row.fullName, row.objective?.correct ?? '', row.objective?.total ?? '', row.theory.score, row.theory.max, row.total, row.max, row.percent ?? '', row.passed == null ? 'Incomplete' : row.passed ? 'Pass' : 'Fail']
        .map(csvCell)
        .join(','),
    );
    downloadCsv(`results-${paper.label.replace(/[^A-Za-z0-9]+/g, '-')}-v${paper.version}.csv`, [header.join(','), ...lines].join('\n'));
  }

  return (
    <>
      <PageHead
        title="Results"
        intro="Objective scores come from the exam centre’s signed results file; theory scores are the marks instructors confirmed. A candidate’s result is complete when both are in."
        action={r?.rows.length ? <Button onClick={exportCsv}>Download results (CSV)</Button> : null}
      />
      {papers.error ? <Alert tone="error" title="Couldn’t load papers">{papers.error}</Alert> : null}
      {papers.loading && !papers.data ? <Spinner label="Loading papers…" /> : null}
      {papers.data && !papers.data.length ? <EmptyState title="No published papers yet" body="Results belong to published papers. Publish a paper first; its results appear here after the exam." /> : null}

      {paper ? (
        <div className="flex flex-col gap-5">
          <label className="label max-w-xl">
            Paper
            <select value={paper.versionId} onChange={(e) => setSelected(e.target.value)}>
              {papers.data!.map((p) => <option key={p.versionId} value={p.versionId}>{p.label}, version {p.version}</option>)}
            </select>
          </label>

          {canImport ? <ImportPanel onImported={results.reload} /> : null}
          {results.error ? <Alert tone="error" title="Couldn’t load results">{results.error}</Alert> : null}
          {results.loading && !r ? <Spinner label="Loading results…" /> : null}

          {r ? (
            <>
              <Panel className="flex flex-wrap gap-x-8 gap-y-2 p-4 text-sm md:px-5">
                <span><b>{r.objectiveCount}</b> objective, 1 mark each</span>
                <span><b>{r.theoryCount}</b> theory, {r.theoryMax} marks{r.theoryOnPaper ? ', on paper' : ''}</span>
                <span>Pass mark <b>{r.passMark}%</b></span>
                <span><b>{r.imported}</b> candidate result{r.imported === 1 ? '' : 's'} imported from the exam centre</span>
              </Panel>
              {r.unmatched.length ? (
                <Alert tone="caution" title={`${r.unmatched.length} result${r.unmatched.length === 1 ? '' : 's'} didn’t match a candidate in this session`}>{r.unmatched.join(', ')}. Check the roster used at the venue.</Alert>
              ) : null}

              {r.rows.length ? (
                <Panel className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-sunken text-left text-ink-muted">
                        <th scope="col" className="px-5 py-2.5 font-semibold">Candidate</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Objective</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Theory</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Total</th>
                        <th scope="col" className="px-5 py-2.5 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row) => (
                        <tr key={row.candidateId} className="border-t border-line align-top">
                          <td className="px-5 py-2.5"><div className="font-[650]">{row.rank} {row.fullName}</div><div className="text-[13px] text-ink-muted">{row.armyNumber}</div></td>
                          <td className="px-3 py-2.5 tabular-nums">{row.objective ? `${row.objective.correct} / ${row.objective.total}` : <span className="text-ink-muted">not imported</span>}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {row.theory.expected ? (
                              <>
                                {row.theory.score} / {row.theory.max}
                                {row.theory.marked < row.theory.expected ? <div className="text-[13px] text-ink-muted">{row.theory.marked} of {row.theory.expected} confirmed</div> : null}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-[650] tabular-nums">{row.total} / {row.max}{row.percent != null ? <div className="text-[13px] font-normal text-ink-muted">{row.percent}%</div> : null}</td>
                          <td className="px-5 py-2.5">
                            <Chip tone={row.passed == null ? 'bank' : row.passed ? 'approved' : 'rejected'}>{row.passed == null ? 'Incomplete' : row.passed ? 'Pass' : 'Fail'}</Chip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              ) : (
                <EmptyState title="No candidates in this session" body="Add candidates on the session’s Candidates page." />
              )}

              {r.itemAnalysis.length ? (
                <Panel className="flex flex-col gap-3 p-4 md:px-5">
                  <div>
                    <h2 className="t-title m-0">How each objective question performed</h2>
                    <p className="m-0 text-sm text-ink-muted">
                      Difficulty is the share of candidates who got it right. Discrimination compares the top and bottom 27% of candidates: a good question is answered correctly more often by stronger candidates (0.3 or more is good). Look again at flagged questions before reusing them.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                      <thead>
                        <tr className="text-left text-ink-muted">
                          <th className="py-1.5 pr-3 font-semibold">Question</th>
                          <th className="py-1.5 pr-3 font-semibold">Difficulty</th>
                          <th className="py-1.5 pr-3 font-semibold">Discrimination</th>
                          <th className="py-1.5 font-semibold">Look at</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.itemAnalysis.map((it) => (
                          <tr key={it.questionId} className="border-t border-line align-top">
                            <td className="py-1.5 pr-3"><b>Q{it.question?.position ?? '?'}</b> <span className="line-clamp-1 text-ink-muted">{it.question?.body ?? it.questionId}</span></td>
                            <td className="py-1.5 pr-3 tabular-nums">{pct(it.difficulty)} correct</td>
                            <td className="py-1.5 pr-3 tabular-nums">{it.discrimination == null ? <span className="text-ink-muted">needs 10+ candidates</span> : it.discrimination.toFixed(2)}</td>
                            <td className="py-1.5">{it.flags.length ? it.flags.join('; ') : <span className="text-ink-muted">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ImportPanel({ onImported }: { onImported: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    setSummary(null);
    try {
      const form = new FormData();
      form.set('file', file);
      setSummary(await api.upload<ImportSummary>('/results/import', form));
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Panel className="flex flex-col gap-3 p-4 md:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="t-heading m-0">Import results from an exam centre</h2>
          <p className="m-0 text-sm text-ink-muted">The invigilator downloads the results file from the exam server’s console after the sitting. Its signature is checked against the package before anything is recorded; each candidate’s result is recorded once.</p>
        </div>
        <label className="btnlink cursor-pointer">
          {busy ? 'Checking…' : 'Choose results file'}
          <input ref={input} type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {error ? <Alert tone="error" title="Not imported">{error}</Alert> : null}
      {summary ? (
        <Alert tone={summary.conflicts.length || summary.unmatched.length ? 'caution' : 'info'} title={`Signature checked. ${summary.imported} new result${summary.imported === 1 ? '' : 's'} from ${summary.centre}`}>
          {[
            summary.unchanged ? `${summary.unchanged} already imported (unchanged)` : '',
            summary.conflicts.length ? `${summary.conflicts.length} conflict with a result already recorded and were not changed: ${summary.conflicts.join(', ')}` : '',
            summary.unmatched.length ? `${summary.unmatched.length} not on this session’s candidate list: ${summary.unmatched.join(', ')}` : '',
            summary.notSubmitted.length ? `${summary.notSubmitted.length} on the venue roster didn’t submit` : '',
          ]
            .filter(Boolean)
            .join('. ') || 'Every result was new.'}
        </Alert>
      ) : null}
    </Panel>
  );
}
