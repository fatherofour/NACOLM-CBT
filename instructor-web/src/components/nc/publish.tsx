'use client';
import { useState } from 'react';
import { Alert, Button } from './basics';
import { Glyph } from './glyph';

export function PublishConfirm({
  paperName,
  phrase,
  nextVersion,
  summary,
  blockedReason,
  busy,
  onPublish,
}: {
  paperName: string;
  phrase: string;
  nextVersion: number;
  summary: [string, string][];
  blockedReason?: string;
  busy?: boolean;
  onPublish: (examDate: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [examDate, setExamDate] = useState('');
  const ok = typed.trim().toLowerCase() === phrase.trim().toLowerCase() && !!examDate;
  return (
    <div className="nc-freeze">
      <p className="t-title">Publish {paperName}</p>
      <p>Publishing creates version {nextVersion}, signed and read-only. Any later change makes a new version; this one can’t be edited.</p>
      <dl className="nc-freeze-sum">
        {summary.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {blockedReason ? (
        <Alert tone="caution" title="Can’t publish yet">
          {blockedReason}
        </Alert>
      ) : (
        <>
          <label className="label">
            <span>Planned exam date</span>
            <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </label>
          <p className="m-0 -mt-2 text-[13px] text-ink-muted">
            For your own record — the invigilator still opens the exam at the venue when ready; this doesn’t control candidate access.
          </p>
          <label className="label">
            <span>
              Type <code>{phrase}</code> to confirm
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        </>
      )}
      <div className="nc-row">
        <Button variant="danger" icon="lock" disabled={!ok || !!blockedReason || busy} onClick={() => onPublish(examDate)}>
          Publish paper
        </Button>
      </div>
    </div>
  );
}

export function PublishReceipt({
  version,
  examDate,
  publishedBy,
  publishedAt,
  signature,
}: {
  version: number;
  examDate: string;
  publishedBy: string;
  publishedAt: string;
  signature: string;
}) {
  return (
    <div className="nc-receipt" role="status">
      <p className="nc-receipt-head">
        <Glyph name="lock" />
        Published
      </p>
      <p className="figure">Version {version}</p>
      <dl className="nc-freeze-sum">
        <div>
          <dt>Exam date</dt>
          <dd>{examDate}</dd>
        </div>
        <div>
          <dt>Published by</dt>
          <dd>{publishedBy}</dd>
        </div>
        <div>
          <dt>At</dt>
          <dd>{publishedAt}</dd>
        </div>
        <div>
          <dt>Signature</dt>
          <dd className="break-all">{signature.slice(0, 16)}…</dd>
        </div>
      </dl>
    </div>
  );
}
