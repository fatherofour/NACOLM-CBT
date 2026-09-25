'use client';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { Alert, Button, EmptyState, ReviewProgress, Spinner, WizardSteps } from '@/components/nc/basics';
import { QuestionRow, type EditPayload } from '@/components/nc/question-row';
import { CoverageTable } from '@/components/nc/coverage';
import { PageHead, Panel } from '@/components/shell/page-head';
import { SchemePanel } from './scheme-panel';
import { api, qs, type Blueprint, type CoverageRow, type Question } from '@/lib/api';
import { sessionInfo } from '@/lib/session-info';
import { useData } from '@/lib/use-data';

export const PAPER_STEPS = ['Generate', 'Review', 'Coverage', 'Freeze'];

export default function ReviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const info = useData(() => sessionInfo(sessionId), [sessionId]);
  const qsData = useData(() => api.get<Question[]>(`/question-bank${qs({ sessionId })}`), [sessionId]);
  const cov = useData(async () => {
    const bps = await api.get<Blueprint[]>(`/blueprints${qs({ sessionId })}`);
    return bps[0] ? api.get<CoverageRow[]>(`/blueprints/${bps[0].id}/coverage`) : null;
  }, [sessionId]);

  const [filter, setFilter] = useState({ status: 'all', type: 'all', topic: 'all' });
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [bucketWarning, setBucketWarning] = useState('');
  const [schemeFor, setSchemeFor] = useState<Question | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Oldest first, so question numbers stay stable while reviewing.
  const all = useMemo(() => [...(qsData.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [qsData.data]);
  const numbers = new Map(all.map((q, i) => [q.id, i + 1]));
  const topics = [...new Set(all.map((q) => q.topic))].sort();
  const shown = all.filter(
    (q) =>
      (filter.status === 'all' || q.status === filter.status) &&
      (filter.type === 'all' || q.type === filter.type) &&
      (filter.topic === 'all' || q.topic === filter.topic),
  );
  const approved = all.filter((q) => q.status === 'APPROVED').length;
  const rejected = all.filter((q) => q.status === 'REJECTED').length;
  const pending = all.length - approved - rejected;
  // Bulk approve only what can be approved without a further decision.
  const bulkable = shown.filter((q) => q.status === 'DRAFT' && (q.type === 'THEORY' ? !!q.markingScheme : q.correctIndex != null));

  function replace(updated: Question) {
    qsData.setData((list) => list?.map((q) => (q.id === updated.id ? { ...q, ...updated, markingScheme: updated.markingScheme ?? q.markingScheme } : q)));
  }

  async function act(q: Question, fn: () => Promise<Question>) {
    setBusyId(q.id);
    setActionError('');
    try {
      replace(await fn());
      void cov.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'That didn’t save.');
    } finally {
      setBusyId('');
    }
  }

  async function reject(q: Question, reason: string) {
    await act(q, () => api.post<Question>(`/question-bank/${q.id}/reject`, { reason }));
    const left = all.filter((x) => x.id !== q.id && x.topic === q.topic && x.difficulty === q.difficulty && x.status !== 'REJECTED').length;
    setBucketWarning(left === 0 ? `No ${q.difficulty === 'medium' ? 'moderate' : q.difficulty} ${q.topic} questions are left. The blueprint can’t be met for that topic without more past papers or study material.` : '');
  }

  async function edit(q: Question, p: EditPayload) {
    setBusyId(q.id);
    try {
      replace(await api.patch<Question>(`/question-bank/${q.id}`, p));
    } finally {
      setBusyId('');
    }
  }

  async function bulkApprove() {
    setBulkBusy(true);
    setActionError('');
    try {
      for (const q of bulkable) replace(await api.post<Question>(`/question-bank/${q.id}/approve`));
      void cov.reload();
      setConfirmBulk(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Bulk approval stopped part-way. Check the list and try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  const loadError = info.error || qsData.error;
  return (
    <>
      <PageHead
        title="Review draft"
        intro={info.data ? `${info.data.title}. Approve, edit or reject every question; nothing reaches the paper without your approval.` : undefined}
        crumbs={[['Exam sessions', '/sessions'], [info.data?.title ?? '…']]}
        action={<div className="w-full md:w-[520px]"><WizardSteps steps={PAPER_STEPS} current={1} /></div>}
      />
      {loadError ? <Alert tone="error" title="Couldn’t load this paper">{loadError}</Alert> : null}
      {qsData.loading && !qsData.data ? <Spinner label="Loading questions…" /> : null}

      {qsData.data ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Panel className="flex flex-col gap-4 p-4 md:px-5">
              <div className="max-w-[360px]"><ReviewProgress total={all.length} approved={approved} rejected={rejected} /></div>
              <div className="grid grid-cols-2 gap-3 border-t border-line pt-4 md:flex md:flex-wrap md:items-end">
                <label className="label">Status
                  <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                    <option value="all">All</option><option value="DRAFT">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
                  </select>
                </label>
                <label className="label">Type
                  <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
                    <option value="all">All</option><option value="OBJECTIVE">Objective</option><option value="THEORY">Theory</option>
                  </select>
                </label>
                <label className="label col-span-2">Topic
                  <select value={filter.topic} onChange={(e) => setFilter({ ...filter, topic: e.target.value })}>
                    <option value="all">All topics</option>
                    {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <Button className="col-span-2 md:ml-auto" disabled={!bulkable.length} onClick={() => setConfirmBulk(true)}>Approve filtered…</Button>
              </div>
            </Panel>

            {confirmBulk ? (
              <div role="alertdialog" aria-labelledby="bulk-t" className="flex flex-col gap-3 rounded-lg border-2 border-field bg-field-soft p-4">
                <p id="bulk-t" className="m-0 font-[650]">Approve {bulkable.length} question{bulkable.length === 1 ? '' : 's'} at once?</p>
                <p className="m-0 text-sm">Only pending questions in the current filter that already have an answer or a saved marking scheme are included. Each approval is logged under your name.</p>
                <div className="nc-row">
                  <Button variant="primary" disabled={bulkBusy} onClick={bulkApprove}>{bulkBusy ? 'Approving…' : `Approve ${bulkable.length}`}</Button>
                  <Button variant="quiet" onClick={() => setConfirmBulk(false)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            {actionError ? <Alert tone="error" title="That didn’t save">{actionError}</Alert> : null}
            {bucketWarning ? <Alert tone="caution" title="Blueprint can’t be met">{bucketWarning}</Alert> : null}

            {all.length && pending === 0 ? (
              <EmptyState
                title={`All ${all.length} reviewed`}
                body={`${approved} approved, ${rejected} rejected. Check coverage before the paper is frozen.`}
                action={<Link className="btnlink primary" href={`/sessions/${sessionId}/freeze`}>Continue to freeze</Link>}
              />
            ) : null}
            {!all.length ? (
              <EmptyState title="No questions yet" body="Generate a draft to fill this paper." action={<Link className="btnlink primary" href={`/sessions/new?session=${sessionId}`}>New exam session</Link>} />
            ) : null}
            {all.length && !shown.length ? <p className="m-0 text-ink-muted">No questions match these filters.</p> : null}

            <div className="flex flex-col gap-3">
              {shown.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  number={numbers.get(q.id)!}
                  busy={busyId === q.id}
                  onApprove={() => act(q, () => api.post<Question>(`/question-bank/${q.id}/approve`))}
                  onReject={(r) => reject(q, r)}
                  onEdit={(p) => edit(q, p)}
                  onScheme={() => setSchemeFor(q)}
                />
              ))}
            </div>
          </div>

          <aside className="flex shrink-0 flex-col gap-4 xl:sticky xl:top-24 xl:w-[400px]">
            <Panel className="flex flex-col gap-2 p-4 md:px-5">
              <h2 className="t-heading m-0">Blueprint coverage</h2>
              {cov.data ? <CoverageTable rows={cov.data} /> : cov.loading ? <Spinner label="Loading…" /> : <p className="m-0 text-sm text-ink-muted">No blueprint yet for this term.</p>}
            </Panel>
            {pending === 0 && all.length ? null : (
              <p className="m-0 text-sm text-ink-muted">{pending} pending. The paper can’t be frozen until every question is approved or rejected.</p>
            )}
          </aside>
        </div>
      ) : null}

      {schemeFor ? (
        <SchemePanel
          question={schemeFor}
          number={numbers.get(schemeFor.id)!}
          onClose={() => setSchemeFor(null)}
          onSaved={() => {
            setSchemeFor(null);
            void qsData.reload();
          }}
        />
      ) : null}
    </>
  );
}
