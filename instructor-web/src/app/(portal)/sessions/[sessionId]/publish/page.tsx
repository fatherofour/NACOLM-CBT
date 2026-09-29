'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { Alert, Button, Spinner, WizardSteps } from '@/components/nc/basics';
import { CoverageTable } from '@/components/nc/coverage';
import { PublishConfirm, PublishReceipt } from '@/components/nc/publish';
import { PageHead, Panel } from '@/components/shell/page-head';
import { useUser } from '@/components/shell/user-context';
import { api, qs, type Blueprint, type CoverageRow, type ExamPackage, type Paper, type Question } from '@/lib/api';
import { sessionInfo } from '@/lib/session-info';
import { useData } from '@/lib/use-data';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Informational only — see the note on PublishConfirm. This never gates
// anything; it just tells the reader how far away the planned date is.
function countdown(examDate: string): string {
  const days = Math.ceil((new Date(examDate + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'Exam day';
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} away`;
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
}

export default function PublishPage({ params }: { params: Promise<{ sessionId: string }> }) {
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
        ? 'There are no approved questions to publish.'
        : '';

  async function publish(examDate: string) {
    setBusy(true);
    setError('');
    try {
      await api.post('/papers/publish', { sessionId, title, confirmationPhrase: title, examDate });
      setAgain(false);
      await data.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publishing failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Coverage and publish"
        intro="Check the paper against its blueprint, then publish a signed version for the exam centre."
        crumbs={[['Exam sessions', '/sessions'], [info.data?.title ?? '…', `/sessions/${sessionId}/review`], ['Publish']]}
        action={
          <div className="flex flex-col items-end gap-3 md:w-[520px]">
            <WizardSteps steps={['Generate', 'Review', 'Coverage', 'Publish']} current={3} />
            <div className="flex gap-4">
              <Link className="btnlink" href={`/sessions/${sessionId}/scripts`}>
                Theory scripts
              </Link>
              <Link className="btnlink" href={`/sessions/${sessionId}/candidates`}>
                Manage candidates
              </Link>
            </div>
          </div>
        }
      />
      {info.error || data.error ? <Alert tone="error" title="Couldn’t load this paper">{info.error || data.error}</Alert> : null}
      {!d && !data.error ? <Spinner label="Loading…" /> : null}
      {d && info.data ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <Panel className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
            <h2 className="t-title m-0">Blueprint coverage</h2>
            {d.coverage.length ? <CoverageTable rows={d.coverage} /> : <p className="m-0 text-ink-muted">No blueprint for this term, so there’s nothing to check coverage against.</p>}
            {gaps.length && !blocked ? (
              <Alert tone="caution" title="You can publish with gaps, but they’re part of the record">
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
            {latest ? (
              <>
                <Alert tone="info" title={`Exam date: ${fmtDate(latest.examDate)}`}>{countdown(latest.examDate)}</Alert>
                <PublishReceipt version={latest.versionNumber} examDate={fmtDate(latest.examDate)} publishedBy={latest.publishedBy} publishedAt={fmt(latest.publishedAt)} signature={latest.signatureHash} />
              </>
            ) : null}
            {latest ? <PackagePanel paperVersionId={latest.id} isOfficer={isOfficer} /> : null}
            {error ? <Alert tone="error" title="Couldn’t publish">{error}</Alert> : null}
            {isOfficer && latest && !again ? (
              <div className="flex flex-col items-start gap-2">
                <p className="m-0 text-sm text-ink-muted">Changed the paper since version {latest.versionNumber}? Publish a new version; the old one stays on record.</p>
                <button type="button" className="nc-btn" onClick={() => setAgain(true)}>Publish a new version…</button>
              </div>
            ) : isOfficer ? (
              <PublishConfirm
                paperName={title}
                phrase={title}
                nextVersion={(latest?.versionNumber ?? 0) + 1}
                summary={[['Questions', String(approved.length)], ['Coverage gaps', String(gaps.length)], ['Published by', `${user.rank} ${user.fullName}`]]}
                blockedReason={blocked || undefined}
                busy={busy}
                onPublish={publish}
              />
            ) : (
              <Alert tone="info" title="The exam officer publishes the paper">
                {blocked ? `Before it can be published: ${blocked}` : 'This paper is ready. Let the exam officer know it can be published.'}
              </Alert>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PackagePanel({ paperVersionId, isOfficer }: { paperVersionId: string; isOfficer: boolean }) {
  const existing = useData(() => api.get<ExamPackage | null>(`/packages/${paperVersionId}`).catch(() => null), [paperVersionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [built, setBuilt] = useState<{ checksumSha256: string; releaseKeyHex: string; poolSize: number } | null>(null);

  async function build() {
    setBusy(true);
    setError('');
    try {
      setBuilt(await api.post(`/packages/${paperVersionId}/build`, {}));
      await existing.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Packaging failed.');
    } finally {
      setBusy(false);
    }
  }

  const pkg = built ?? existing.data;

  return (
    <div className="nc-freeze">
      <p className="t-title">Package for exam centre</p>
      <p>Encrypts this version&apos;s questions for the venue. The candidate roster travels separately as a CSV — see Manage candidates.</p>
      {error ? <Alert tone="error" title="Couldn’t package">{error}</Alert> : null}
      {pkg ? (
        <dl className="nc-freeze-sum">
          <div><dt>Questions</dt><dd>{pkg.poolSize}</dd></div>
          <div><dt>Checksum</dt><dd className="break-all">{pkg.checksumSha256.slice(0, 16)}…</dd></div>
          {built ? (
            <div className="col-span-2">
              <dt>Release key — shown once, never stored</dt>
              <dd className="break-all font-mono">{built.releaseKeyHex}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {built ? (
        <Alert tone="info" title="How this opens the exam for candidates">
          Copy this key to the invigilator at the venue (do not send it over the same channel as the
          package file). At the scheduled start time, they open <code>http://&lt;exam-server&gt;:8080/invigilator/</code> on
          the venue machine, paste the key and press &quot;Open exam&quot; — candidates can&apos;t check in
          before that, and that same screen then shows who has checked in, started and submitted.
        </Alert>
      ) : null}
      {isOfficer ? (
        <div className="nc-row">
          <Button variant="primary" disabled={busy} onClick={build}>
            {busy ? 'Packaging…' : pkg ? 'Rebuild package' : 'Build package'}
          </Button>
        </div>
      ) : (
        <Alert tone="info" title="The exam officer packages the paper">Ask them to build it once this version is ready.</Alert>
      )}
    </div>
  );
}
