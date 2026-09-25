'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { Alert, Spinner, WizardSteps } from '@/components/nc/basics';
import { CoverageTable } from '@/components/nc/coverage';
import { FreezeConfirm, FreezeReceipt } from '@/components/nc/freeze';
import { PageHead, Panel } from '@/components/shell/page-head';
import { useUser } from '@/components/shell/user-context';
import { api, qs, type Blueprint, type CoverageRow, type Paper, type Question } from '@/lib/api';
import { sessionInfo } from '@/lib/session-info';
import { useData } from '@/lib/use-data';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function FreezePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const user = useUser();
  const info = useData(() => sessionInfo(sessionId), [sessionId]);
  const data = useData(async () => {
    const [questions, bps, papers] = await Promise.all([
      api.get<Question[]>(`/question-bank${qs({ sessionId })}`),
      api.get<Blueprint[]>(`/blueprints${qs({ sessionId })}`),
      api.get<Paper[]>(`/papers${qs({ sessionId })}`),
    ]);
    const coverage = bps[0] ? await api.get<CoverageRow[]>(`/blueprints/${bps[0].id}/coverage`) : [];
    return { questions, blueprint: bps[0], papers, coverage };
  }, [sessionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [again, setAgain] = useState(false);

  const d = data.data;
  const title = info.data ? `${info.data.course.code} ${info.data.session.label} paper` : '';
  const paper = d?.papers.find((p) => p.title === title) ?? d?.papers[0];
  const latest = paper?.versions[0];
  const approved = d?.questions.filter((q) => q.status === 'APPROVED') ?? [];
  const pending = d?.questions.filter((q) => q.status === 'DRAFT').length ?? 0;
  const theoryNoScheme = approved.filter((q) => q.type === 'THEORY' && !q.markingScheme).length;
  const gaps = d?.coverage.filter((r) => r.gap > 0) ?? [];
  const isOfficer = user.role === 'EXAM_OFFICER';
  const blocked = pending
    ? `${pending} question${pending === 1 ? ' is' : 's are'} still pending review.`
    : theoryNoScheme
      ? `${theoryNoScheme} approved theory question${theoryNoScheme === 1 ? ' has' : 's have'} no marking scheme.`
      : !approved.length
        ? 'There are no approved questions to freeze.'
        : '';

  async function freeze() {
    setBusy(true);
    setError('');
    try {
      await api.post('/papers/freeze', { sessionId, title, confirmationPhrase: title });
      setAgain(false);
      await data.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freezing failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Coverage and freeze"
        intro="Check the paper against its blueprint, then freeze a signed version for the exam centre."
        crumbs={[['Exam sessions', '/sessions'], [info.data?.title ?? '…', `/sessions/${sessionId}/review`], ['Freeze']]}
        action={<div className="w-full md:w-[520px]"><WizardSteps steps={['Generate', 'Review', 'Coverage', 'Freeze']} current={3} /></div>}
      />
      {info.error || data.error ? <Alert tone="error" title="Couldn’t load this paper">{info.error || data.error}</Alert> : null}
      {!d && !data.error ? <Spinner label="Loading…" /> : null}
      {d && info.data ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <Panel className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
            <h2 className="t-title m-0">Blueprint coverage</h2>
            {d.coverage.length ? <CoverageTable rows={d.coverage} /> : <p className="m-0 text-ink-muted">No blueprint for this term, so there’s nothing to check coverage against.</p>}
            {gaps.length && !blocked ? (
              <Alert tone="caution" title="You can freeze with gaps, but they’re part of the record">
                To close them, go back to <Link href={`/sessions/${sessionId}/review`}>review</Link> and approve more questions in those topics.
              </Alert>
            ) : null}
            <dl className="nc-freeze-sum border-t border-line pt-4 !grid-cols-2 md:!grid-cols-4">
              <div><dt>Approved</dt><dd>{approved.length} of {d.questions.length}</dd></div>
              <div><dt>Objective / theory</dt><dd>{approved.filter((q) => q.type === 'OBJECTIVE').length} / {approved.filter((q) => q.type === 'THEORY').length}</dd></div>
              <div><dt>From bank / AI</dt><dd>{approved.filter((q) => q.source === 'PAST_PAPER').length} / {approved.filter((q) => q.source === 'AI_DRAFTED').length}</dd></div>
              <div><dt>Results</dt><dd>{d.blueprint?.resultsRelease === 'instant' ? 'Published on submission' : 'Sent to instructor first'}</dd></div>
            </dl>
          </Panel>

          <div className="flex shrink-0 flex-col gap-4 xl:w-[540px]">
            {latest ? <FreezeReceipt version={latest.versionNumber} frozenBy={latest.frozenBy} frozenAt={fmt(latest.frozenAt)} signature={latest.signatureHash} /> : null}
            {error ? <Alert tone="error" title="Couldn’t freeze">{error}</Alert> : null}
            {isOfficer && latest && !again ? (
              <div className="flex flex-col items-start gap-2">
                <p className="m-0 text-sm text-ink-muted">Changed the paper since version {latest.versionNumber}? Freeze a new version; the old one stays on record.</p>
                <button type="button" className="nc-btn" onClick={() => setAgain(true)}>Freeze a new version…</button>
              </div>
            ) : isOfficer ? (
              <FreezeConfirm
                paperName={title}
                phrase={title}
                nextVersion={(latest?.versionNumber ?? 0) + 1}
                summary={[['Questions', String(approved.length)], ['Coverage gaps', String(gaps.length)], ['Frozen by', `${user.rank} ${user.fullName}`]]}
                blockedReason={blocked || undefined}
                busy={busy}
                onFreeze={freeze}
              />
            ) : (
              <Alert tone="info" title="The exam officer freezes the paper">
                {blocked ? `Before it can be frozen: ${blocked}` : 'This paper is ready. Let the exam officer know it can be frozen.'}
              </Alert>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
