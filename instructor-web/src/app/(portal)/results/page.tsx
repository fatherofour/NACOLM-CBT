'use client';
import { useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import { api, qs, type Blueprint, type Course, type Paper } from '@/lib/api';
import { useData } from '@/lib/use-data';

interface FrozenPaper { key: string; label: string; version: number; release: 'instant' | 'hold' }

// Submissions reach the portal when exam centres sync after an exam. That
// sync isn't built yet, so real papers show an empty state; "Preview" shows
// the screen with clearly labelled sample data.
const SAMPLE = [
  { name: '2Lt. A. Okafor', svc: 'NA/24/0412', obj: 34, th: 20 },
  { name: '2Lt. H. Ibrahim', svc: 'NA/24/0419', obj: 29, th: 10 },
  { name: 'Lt. C. Eze', svc: 'NA/23/0377', obj: 37, th: 20 },
  { name: '2Lt. B. Yusuf', svc: 'NA/24/0431', obj: 22, th: 0 },
  { name: '2Lt. F. Adeyemi', svc: 'NA/24/0402', obj: 31, th: 14 },
];

export default function ResultsPage() {
  const papers = useData<FrozenPaper[]>(async () => {
    const courses = await api.get<Course[]>('/courses');
    const out: FrozenPaper[] = [];
    for (const c of courses)
      for (const s of c.sessions) {
        const [ps, bps] = await Promise.all([api.get<Paper[]>(`/papers${qs({ sessionId: s.id })}`), api.get<Blueprint[]>(`/blueprints${qs({ sessionId: s.id })}`)]);
        for (const p of ps)
          if (p.versions[0]) out.push({ key: p.id, label: `${c.code} ${c.name}, ${s.label}`, version: p.versions[0].versionNumber, release: bps[0]?.resultsRelease ?? 'hold' });
      }
    return out;
  }, []);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState(false);
  const [released, setReleased] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const paper = papers.data?.find((p) => p.key === selected) ?? papers.data?.[0];

  return (
    <>
      <PageHead title="Results" intro="Objective and theory answers are marked automatically the moment each candidate submits. Results you chose to hold wait here until you release them." />
      {papers.error ? <Alert tone="error" title="Couldn’t load papers">{papers.error}</Alert> : null}
      {papers.loading && !papers.data ? <Spinner label="Loading papers…" /> : null}

      {papers.data && !preview ? (
        <div className="flex flex-col gap-4">
          {papers.data.length ? (
            <label className="label max-w-md">
              Paper
              <select value={paper?.key} onChange={(e) => setSelected(e.target.value)}>
                {papers.data.map((p) => <option key={p.key} value={p.key}>{p.label}, version {p.version}</option>)}
              </select>
            </label>
          ) : null}
          {paper ? (
            <Panel className="flex flex-col gap-1 p-4 md:px-5">
              <div className="flex flex-wrap items-center gap-2"><span className="t-heading">{paper.label}</span><Chip tone={paper.release === 'instant' ? 'approved' : 'caution'}>{paper.release === 'instant' ? 'Published on submission' : 'Sent to instructor first'}</Chip></div>
            </Panel>
          ) : null}
          <EmptyState
            title={papers.data.length ? 'No submissions yet' : 'No frozen papers yet'}
            body={
              papers.data.length
                ? 'Results appear here after an exam centre syncs its submissions. That sync isn’t connected to the portal yet.'
                : 'Results belong to frozen papers. Freeze a paper first; its results will appear here after the exam.'
            }
            action={<Button onClick={() => setPreview(true)}>Preview this screen with sample data</Button>}
          />
        </div>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-4">
          <Alert tone="info" title="Sample data" action={<Button onClick={() => { setPreview(false); setReleased(false); }}>Close preview</Button>}>
            These candidates and scores are made up to show how results will look.
          </Alert>
          <Panel className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:px-5">
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2"><span className="t-heading">LOG301 Movement Control, sample paper</span><Chip tone={released ? 'approved' : 'caution'}>{released ? 'Released' : 'Sent to instructor first'}</Chip></div>
              <span className="text-sm text-ink-muted">{released ? 'Candidates can now see their scores.' : 'Candidates can’t see their scores yet. Check them, then release.'}</span>
            </div>
            {!released && !confirming ? <Button variant="primary" onClick={() => setConfirming(true)}>Release results</Button> : null}
          </Panel>
          {confirming ? (
            <div role="alertdialog" aria-labelledby="rel-t" className="flex flex-col gap-3 rounded-lg border-2 border-field bg-field-soft p-4">
              <p id="rel-t" className="m-0 font-[650]">Release results to {SAMPLE.length} candidates?</p>
              <p className="m-0 text-sm">Each candidate sees their score immediately. Released results can’t be withdrawn.</p>
              <div className="nc-row"><Button variant="primary" onClick={() => { setReleased(true); setConfirming(false); }}>Release results</Button><Button variant="quiet" onClick={() => setConfirming(false)}>Cancel</Button></div>
            </div>
          ) : null}
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead><tr className="bg-surface-sunken text-left text-ink-muted"><th scope="col" className="px-5 py-2.5 font-semibold">Candidate</th><th scope="col" className="px-3 py-2.5 font-semibold">Objective /40</th><th scope="col" className="px-3 py-2.5 font-semibold">Theory /20</th><th scope="col" className="px-3 py-2.5 font-semibold">Total</th><th scope="col" className="px-5 py-2.5 font-semibold">Candidate sees</th></tr></thead>
              <tbody>
                {SAMPLE.map((c) => (
                  <tr key={c.svc} className="border-t border-line">
                    <td className="px-5 py-2.5"><div className="font-[650]">{c.name}</div><div className="text-[13px] text-ink-muted">{c.svc}</div></td>
                    <td className="px-3 py-2.5 tabular-nums">{c.obj}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.th}</td>
                    <td className="px-3 py-2.5 font-[650] tabular-nums">{Math.round(((c.obj + c.th) / 60) * 100)}%</td>
                    <td className="px-5 py-2.5"><Chip tone={released ? 'approved' : 'caution'}>{released ? 'Published' : 'Withheld'}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
