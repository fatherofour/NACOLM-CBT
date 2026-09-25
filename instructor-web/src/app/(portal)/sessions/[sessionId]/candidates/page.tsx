'use client';
import { use, useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import { api, downloadCsv, qs, rosterCsv, type Candidate, type NewCandidatePin } from '@/lib/api';
import { sessionInfo } from '@/lib/session-info';
import { useData } from '@/lib/use-data';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CandidatesPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const info = useData(() => sessionInfo(sessionId), [sessionId]);
  const { data: candidates, error, loading, reload } = useData(() => api.get<Candidate[]>(`/candidates${qs({ sessionId })}`), [sessionId]);

  const [mode, setMode] = useState<'none' | 'single' | 'bulk'>('none');
  const [justCreated, setJustCreated] = useState<NewCandidatePin[] | null>(null);

  return (
    <>
      <PageHead
        title="Candidates"
        intro="Who's registered to sit this exam. Their service number and PIN — printed here once — are what the local exam server checks at the venue; there's no separate roster system."
        crumbs={[['Exam sessions', '/sessions'], [info.data?.title ?? '…', `/sessions/${sessionId}/review`], ['Candidates']]}
        action={
          mode === 'none' ? (
            <div className="flex gap-2">
              <Button onClick={() => setMode('bulk')}>Bulk import</Button>
              <Button variant="primary" icon="plus" onClick={() => setMode('single')}>
                Add candidate
              </Button>
            </div>
          ) : undefined
        }
      />

      {justCreated?.length ? (
        <Alert
          tone="info"
          title={`${justCreated.length} PIN${justCreated.length === 1 ? '' : 's'} generated — save this now`}
          action={
            <Button onClick={() => downloadCsv(`roster-${sessionId}.csv`, rosterCsv(justCreated))}>
              Download roster.csv
            </Button>
          }
        >
          <p className="m-0">
            A PIN is only ever shown once. This file is exactly what the invigilator loads onto the local exam server
            (<code>CBT_ROSTER_PATH</code>) — merge it into the venue&apos;s master roster if candidates were added
            separately.
          </p>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pr-4">Service number</th>
                <th className="pr-4">Name</th>
                <th>PIN</th>
              </tr>
            </thead>
            <tbody>
              {justCreated.map((c) => (
                <tr key={c.armyNumber}>
                  <td className="pr-4 font-mono">{c.armyNumber}</td>
                  <td className="pr-4">
                    {c.rank} {c.fullName}
                  </td>
                  <td className="font-mono font-semibold">{c.pin}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="quiet" onClick={() => setJustCreated(null)}>
            Dismiss
          </Button>
        </Alert>
      ) : null}

      {mode === 'single' ? (
        <SingleForm
          sessionId={sessionId}
          onClose={() => setMode('none')}
          onCreated={async (row) => {
            setMode('none');
            setJustCreated([row]);
            await reload();
          }}
        />
      ) : null}

      {mode === 'bulk' ? (
        <BulkForm
          sessionId={sessionId}
          onClose={() => setMode('none')}
          onImported={async (rows) => {
            setMode('none');
            setJustCreated(rows);
            await reload();
          }}
        />
      ) : null}

      {error ? (
        <Alert tone="error" title="Couldn’t load candidates" action={<Button onClick={reload}>Try again</Button>}>
          {error}
        </Alert>
      ) : null}
      {loading && !candidates ? <Spinner label="Loading candidates…" /> : null}
      {candidates && !candidates.length ? (
        <EmptyState title="No candidates registered yet" body="Add one, or bulk-import a whole class above." />
      ) : null}

      {candidates?.length ? (
        <Panel className="overflow-hidden">
          <table className="hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="bg-surface-sunken text-left text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-semibold">Service number</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Rank and name</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Registered</th>
                <th scope="col" className="px-5 py-2.5"><span className="nc-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <CandidateRow key={c.id} candidate={c} onReload={reload} onPinReset={(row) => setJustCreated([row])} />
              ))}
            </tbody>
          </table>
          <ul className="m-0 flex list-none flex-col p-0 md:hidden">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 border-t border-line px-4 py-3.5 first:border-t-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-mono text-xs text-ink-muted">{c.armyNumber}</div>
                    <div className="font-[650]">{c.rank} {c.fullName}</div>
                    <div className="text-[13px] text-ink-muted">since {fmt(c.createdAt)}</div>
                  </div>
                  <Chip tone={c.active ? 'approved' : 'rejected'}>{c.active ? 'Active' : 'Withdrawn'}</Chip>
                </div>
                <CandidateRow candidate={c} onReload={reload} onPinReset={(row) => setJustCreated([row])} mobile />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function CandidateRow({
  candidate: c,
  onReload,
  onPinReset,
  mobile,
}: {
  candidate: Candidate;
  onReload: () => Promise<void>;
  onPinReset: (row: NewCandidatePin) => void;
  mobile?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function resetPin() {
    if (!confirm(`Reset the PIN for ${c.armyNumber}? Their old admission slip stops working.`)) return;
    setBusy(true);
    try {
      const r = await api.post<NewCandidatePin>(`/candidates/${c.id}/reset-pin`, {});
      onPinReset(r);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await api.patch(`/candidates/${c.id}`, { active: !c.active });
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="quiet" disabled={busy} onClick={resetPin}>Reset PIN</Button>
      <Button variant={c.active ? 'danger' : 'secondary'} disabled={busy} onClick={toggleActive}>
        {c.active ? 'Withdraw' : 'Reinstate'}
      </Button>
    </div>
  );

  if (mobile) return actions;

  return (
    <tr className="border-t border-line align-middle">
      <td className="px-5 py-3 font-mono">{c.armyNumber}</td>
      <td className="px-3 py-3">{c.rank} {c.fullName}</td>
      <td className="px-3 py-3"><Chip tone={c.active ? 'approved' : 'rejected'}>{c.active ? 'Active' : 'Withdrawn'}</Chip></td>
      <td className="px-3 py-3 text-ink-muted">{fmt(c.createdAt)}</td>
      <td className="px-5 py-3 text-right">{actions}</td>
    </tr>
  );
}

function SingleForm({ sessionId, onClose, onCreated }: { sessionId: string; onClose: () => void; onCreated: (row: NewCandidatePin) => void }) {
  const [armyNumber, setArmyNumber] = useState('');
  const [rank, setRank] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = armyNumber.trim() && rank.trim() && fullName.trim();

  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ candidate: Candidate; generatedPin?: string }>('/candidates', {
        sessionId,
        armyNumber: armyNumber.trim(),
        rank: rank.trim(),
        fullName: fullName.trim(),
      });
      if (r.generatedPin) onCreated({ armyNumber: r.candidate.armyNumber, rank: r.candidate.rank, fullName: r.candidate.fullName, pin: r.generatedPin });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the candidate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 flex flex-col gap-4 rounded-lg border-2 border-field bg-surface-raised p-4 md:p-6">
      <h2 className="t-title m-0">Add candidate</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="label">Service number<input value={armyNumber} onChange={(e) => setArmyNumber(e.target.value)} placeholder="e.g. NA/26/0412" /></label>
        <label className="label">Rank<input value={rank} onChange={(e) => setRank(e.target.value)} placeholder="e.g. Cdt" /></label>
        <label className="label">Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. A. Okafor" /></label>
      </div>
      {error ? <Alert tone="error" title="Couldn’t add the candidate">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || busy} onClick={create}>{busy ? 'Adding…' : 'Add candidate'}</Button>
      </div>
    </section>
  );
}

function BulkForm({ sessionId, onClose, onImported }: { sessionId: string; onClose: () => void; onImported: (rows: NewCandidatePin[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // One candidate per line: service number, rank, full name (comma-separated).
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(',').map((p) => p.trim()))
    .filter((p) => p.length >= 3 && p[0] && p[1] && p[2]);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ created: NewCandidatePin[]; skipped: string[] }>('/candidates/bulk-import', {
        sessionId,
        candidates: rows.map(([armyNumber, rank, fullName]) => ({ armyNumber, rank, fullName })),
      });
      if (r.skipped.length) {
        setError(`${r.skipped.length} already registered, skipped: ${r.skipped.join(', ')}`);
      }
      if (r.created.length) onImported(r.created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 flex flex-col gap-4 rounded-lg border-2 border-field bg-surface-raised p-4 md:p-6">
      <h2 className="t-title m-0">Bulk import</h2>
      <p className="m-0 -mt-2 text-sm text-ink-muted">
        One candidate per line: <code>service number, rank, full name</code>. PINs are generated for all of them.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'NA/26/0412, Cdt, A. Okafor\nNA/26/0419, Cdt, H. Ibrahim'}
        className="w-full rounded-md border border-line-strong p-3 font-mono text-sm"
      />
      <p className="m-0 text-sm text-ink-muted">{rows.length} valid row{rows.length === 1 ? '' : 's'} detected.</p>
      {error ? <Alert tone="error" title="Import problem">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!rows.length || busy} onClick={submit}>{busy ? 'Importing…' : `Import ${rows.length || ''}`}</Button>
      </div>
    </section>
  );
}
