'use client';
import { useState } from 'react';
import { Glyph } from './glyph';
import { Button, CitationChip, SourceBadge, StatusBadge, Tag, toUiStatus } from './basics';
import { difficultyLabel, type Question } from '@/lib/api';

export interface EditPayload { body: string; options?: string[]; correctIndex?: number; topic: string; difficulty: string }

export function QuestionRow({
  q,
  number,
  canAct = true,
  busy,
  onApprove,
  onReject,
  onEdit,
  onScheme,
}: {
  q: Question;
  number: number;
  canAct?: boolean;
  busy?: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onEdit: (p: EditPayload) => Promise<void>;
  onScheme: () => void;
}) {
  const status = toUiStatus(q.status);
  const [mode, setMode] = useState<'view' | 'reject' | 'edit'>('view');
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<EditPayload>(() => fromQuestion(q));
  const [saveError, setSaveError] = useState('');
  const objective = q.type === 'OBJECTIVE' && Array.isArray(q.options);
  const schemeReady = !!q.markingScheme;

  return (
    <article className={`nc-qrow is-${status}`} aria-label={`Question ${number}`}>
      <div className="nc-qrow-meta">
        <span className="nc-qrow-n">Q{number}</span>
        <SourceBadge source={q.source} reused={q.markingScheme?.reusedFromBank} />
        <Tag kind="type">{q.type === 'THEORY' ? 'Theory' : 'Objective'}</Tag>
        <Tag>{q.topic}</Tag>
        <Tag kind="difficulty">{difficultyLabel(q.difficulty)}</Tag>
        <span className="nc-grow" />
        <StatusBadge status={status} />
      </div>

      {mode === 'edit' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaveError('');
            try {
              await onEdit(draft);
              setMode('view');
            } catch (err) {
              setSaveError(err instanceof Error ? err.message : 'Could not save.');
            }
          }}
        >
          <label className="label">
            Question
            <textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required />
          </label>
          {objective && draft.options ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="label mb-2">Options (select the correct answer)</legend>
              {draft.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${q.id}`}
                    aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                    checked={draft.correctIndex === i}
                    onChange={() => setDraft({ ...draft, correctIndex: i })}
                    className="h-[18px] w-[18px] accent-[var(--field)]"
                  />
                  <span className="w-5 font-semibold">{String.fromCharCode(65 + i)}.</span>
                  <input
                    className="flex-1"
                    value={o}
                    aria-label={`Option ${String.fromCharCode(65 + i)}`}
                    onChange={(e) => setDraft({ ...draft, options: draft.options!.map((x, j) => (j === i ? e.target.value : x)) })}
                    required
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <label className="label min-w-[180px] flex-1">
              Topic
              <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} required />
            </label>
            <label className="label">
              Difficulty
              <select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value })}>
                <option value="easy">Easy</option>
                <option value="medium">Moderate</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>
          {saveError ? <p className="m-0 text-sm font-semibold text-rejected">{saveError}</p> : null}
          <div className="nc-row">
            <Button type="submit" variant="primary" disabled={busy}>
              Save changes
            </Button>
            <Button variant="quiet" onClick={() => { setDraft(fromQuestion(q)); setMode('view'); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="nc-qrow-body whitespace-pre-line">{q.body}</p>
          {objective ? (
            <ol className="nc-options" type="A">
              {q.options!.map((o, i) => (
                <li key={i} className={i === q.correctIndex ? 'is-answer' : ''}>
                  {o}
                  {i === q.correctIndex ? (
                    <span className="nc-answer-tag">
                      <Glyph name="check" />
                      Correct answer
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {objective && q.correctIndex == null ? (
            <p className="nc-qrow-check" style={{ color: 'var(--caution)', background: 'var(--caution-soft)' }}>
              <Glyph name="warn" />
              No correct answer is set. Use Edit to mark one before approving.
            </p>
          ) : objective && status === 'pending' ? (
            <p className="nc-qrow-check">
              <Glyph name="info" />
              Check the marked answer. Every candidate is marked against it; use Edit to change it.
            </p>
          ) : null}
          {q.source === 'AI_DRAFTED' && q.citation ? <CitationChip label={q.citation} excerpt={q.citationExcerpt} /> : null}
          {status === 'rejected' && q.rejectReason ? <p className="nc-qrow-reason">Rejected: {q.rejectReason}</p> : null}
        </>
      )}

      {mode === 'reject' ? (
        <div className="nc-reject-form">
          <label className="label">
            Reason for rejecting
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Answer not supported by the cited page" />
          </label>
          <div className="nc-row">
            <Button variant="danger" disabled={reason.trim().length < 3 || busy} onClick={() => { onReject(reason.trim()); setMode('view'); setReason(''); }}>
              Reject question
            </Button>
            <Button variant="quiet" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </div>
        </div>
      ) : mode === 'view' && canAct ? (
        <div className="nc-qrow-actions">
          {q.type === 'THEORY' ? (
            <Button variant="quiet" onClick={onScheme}>
              {schemeReady ? 'Marking scheme' : 'Set marking scheme'}
            </Button>
          ) : null}
          <span className="nc-grow" />
          <Button variant="quiet" onClick={() => { setDraft(fromQuestion(q)); setMode('edit'); }} disabled={busy}>
            Edit
          </Button>
          {status !== 'rejected' ? (
            <Button variant="quiet" onClick={() => setMode('reject')} disabled={busy}>
              Reject
            </Button>
          ) : null}
          <Button
            variant="primary"
            icon="check"
            disabled={busy || status === 'approved' || (q.type === 'THEORY' && !schemeReady) || (objective && q.correctIndex == null)}
            onClick={onApprove}
            title={q.type === 'THEORY' && !schemeReady ? 'Save a marking scheme first' : undefined}
          >
            {status === 'approved' ? 'Approved' : objective ? 'Approve question and answer' : 'Approve'}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function fromQuestion(q: Question): EditPayload {
  return {
    body: q.body,
    topic: q.topic,
    difficulty: q.difficulty,
    options: q.options ? [...q.options] : undefined,
    correctIndex: q.correctIndex ?? undefined,
  };
}
