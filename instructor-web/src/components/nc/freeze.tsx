'use client';
import { useState } from 'react';
import { Alert, Button } from './basics';
import { Glyph } from './glyph';

export function FreezeConfirm({
  paperName,
  phrase,
  nextVersion,
  summary,
  blockedReason,
  busy,
  onFreeze,
}: {
  paperName: string;
  phrase: string;
  nextVersion: number;
  summary: [string, string][];
  blockedReason?: string;
  busy?: boolean;
  onFreeze: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toLowerCase() === phrase.trim().toLowerCase();
  return (
    <div className="nc-freeze">
      <p className="t-title">Freeze {paperName}</p>
      <p>Freezing creates version {nextVersion}, signed and read-only. Any later change makes a new version; this one can’t be edited.</p>
      <dl className="nc-freeze-sum">
        {summary.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {blockedReason ? (
        <Alert tone="caution" title="Can’t freeze yet">
          {blockedReason}
        </Alert>
      ) : (
        <label className="label">
          <span>
            Type <code>{phrase}</code> to confirm
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
      <div className="nc-row">
        <Button variant="danger" icon="lock" disabled={!ok || !!blockedReason || busy} onClick={onFreeze}>
          Freeze paper
        </Button>
      </div>
    </div>
  );
}

export function FreezeReceipt({ version, frozenBy, frozenAt, signature }: { version: number; frozenBy: string; frozenAt: string; signature: string }) {
  return (
    <div className="nc-receipt" role="status">
      <p className="nc-receipt-head">
        <Glyph name="lock" />
        Frozen
      </p>
      <p className="figure">Version {version}</p>
      <dl className="nc-freeze-sum">
        <div>
          <dt>Frozen by</dt>
          <dd>{frozenBy}</dd>
        </div>
        <div>
          <dt>At</dt>
          <dd>{frozenAt}</dd>
        </div>
        <div>
          <dt>Signature</dt>
          <dd className="break-all">{signature.slice(0, 16)}…</dd>
        </div>
      </dl>
    </div>
  );
}
