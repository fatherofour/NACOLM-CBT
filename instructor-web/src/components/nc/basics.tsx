'use client';
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Glyph, type GlyphName } from './glyph';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'secondary',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; icon?: GlyphName }) {
  return (
    <button type="button" {...rest} className={cx('nc-btn', `nc-btn-${variant}`, className)}>
      {icon ? <Glyph name={icon} /> : null}
      {children}
    </button>
  );
}

export function SourceBadge({ source, reused }: { source: 'PAST_PAPER' | 'AI_DRAFTED'; reused?: boolean }) {
  const ai = source === 'AI_DRAFTED';
  return <span className={cx('nc-badge', ai ? 'nc-badge-drafted' : 'nc-badge-bank')}>{ai ? 'AI-drafted' : reused ? 'Reused from bank' : 'From bank'}</span>;
}

const STATUS = { pending: ['Pending', 'dot'], approved: ['Approved', 'check'], rejected: ['Rejected', 'cross'] } as const;
export type UiStatus = keyof typeof STATUS;
export const toUiStatus = (s: string): UiStatus => (s === 'APPROVED' ? 'approved' : s === 'REJECTED' ? 'rejected' : 'pending');

export function StatusBadge({ status }: { status: UiStatus }) {
  const [label, glyph] = STATUS[status];
  return (
    <span className={`nc-status nc-status-${status}`}>
      <Glyph name={glyph} />
      {label}
    </span>
  );
}

export function Tag({ kind, children }: { kind?: 'type' | 'difficulty'; children: ReactNode }) {
  return <span className={cx('nc-tag', kind && `nc-tag-${kind}`)}>{children}</span>;
}

export function Chip({ tone, children }: { tone: 'approved' | 'caution' | 'rejected' | 'bank' | 'field' | 'drafted'; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-sm px-2 py-[3px] text-[13px] font-semibold leading-4"
      style={{ color: `var(--${tone})`, background: `var(--${tone}-soft)` }}
    >
      {children}
    </span>
  );
}

export function CitationChip({ label, excerpt, defaultOpen }: { label: string; excerpt?: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const id = useId();
  if (!excerpt) {
    return (
      <span className="nc-cite">
        <span className="nc-cite-chip" style={{ cursor: 'default' }}>
          <Glyph name="page" />
          {label}
        </span>
      </span>
    );
  }
  return (
    <span className="nc-cite">
      <button type="button" className="nc-cite-chip" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Glyph name="page" />
        {label}
        <Glyph name="chevron" className={open ? 'nc-rot' : ''} />
      </button>
      {open ? (
        <blockquote id={id} className="nc-cite-excerpt">
          {excerpt}
        </blockquote>
      ) : null}
    </span>
  );
}

export function WizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <>
    <div className="flex flex-col gap-2 md:hidden">
      <p className="m-0 text-[13px] font-semibold text-field">
        Step {current + 1} of {steps.length}: {steps[current]}
      </p>
      <div className="flex gap-1" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-sm ${i <= current ? 'bg-field' : 'bg-line'}`} />
        ))}
      </div>
    </div>
    <ol className="nc-steps !hidden md:!flex" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className={`nc-step nc-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="nc-step-n">{state === 'done' ? <Glyph name="check" /> : i + 1}</span>
            <span className="nc-step-label">{s}</span>
          </li>
        );
      })}
    </ol>
    </>
  );
}

export interface PickOption { value: string; title: string; description: string }
export function RadioCards({ options, value, onChange, label }: { options: PickOption[]; value?: string; onChange: (v: string) => void; label: string }) {
  function onKey(e: React.KeyboardEvent<HTMLDivElement>, i: number) {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} className="nc-sources">
      {options.map((o, i) => {
        const sel = o.value === value;
        return (
          <div
            key={o.value}
            role="radio"
            aria-checked={sel}
            tabIndex={sel || (!value && i === 0) ? 0 : -1}
            className={cx('nc-source', sel && 'is-selected')}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                onChange(o.value);
              } else onKey(e, i);
            }}
          >
            <span className="nc-radio" aria-hidden="true" />
            <span className="nc-source-text">
              <span className="nc-source-title">{o.title}</span>
              <span className="nc-source-desc">{o.description}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "a + b + c = total" check with a verdict. */
export function SumCheck({ parts, total }: { parts: [string, number][]; total: number }) {
  const sum = parts.reduce((n, [, v]) => n + (Number.isFinite(v) ? v : 0), 0);
  const ok = sum === total && total > 0;
  return (
    <div className={cx('nc-mix', ok ? 'is-ok' : 'is-off')} role="status">
      <span>
        {parts.map(([l, v], i) => (
          <span key={l}>
            {i ? ' + ' : ''}
            <b>{v || 0}</b> {l}
          </span>
        ))}{' '}
        = <b>{sum}</b>
      </span>
      <span className="nc-mix-verdict">
        <Glyph name={ok ? 'check' : 'warn'} />
        {ok ? `Matches total of ${total}` : `${sum < total ? `${total - sum} short of` : `${sum - total} over`} total of ${total}`}
      </span>
    </div>
  );
}

export function Alert({ tone = 'info', title, action, children }: { tone?: 'info' | 'caution' | 'error'; title?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`nc-alert nc-alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Glyph name={tone === 'info' ? 'info' : 'warn'} />
      <div className="nc-alert-body">
        {title ? <p className="nc-alert-title">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="nc-alert-action">{action}</div> : null}
    </div>
  );
}

export function ReviewProgress({ total, approved, rejected }: { total: number; approved: number; rejected: number }) {
  const done = approved + rejected;
  const t = total || 1;
  return (
    <div className="nc-rprog">
      <p className="nc-rprog-figure">
        <span className="figure">
          {done} of {total}
        </span>
        <span className="nc-muted"> reviewed</span>
      </p>
      <div className="nc-rprog-bar" aria-hidden="true">
        <span className="is-approved" style={{ width: `${(approved / t) * 100}%` }} />
        <span className="is-rejected" style={{ width: `${(rejected / t) * 100}%` }} />
      </div>
      <p className="nc-rprog-legend">
        <span><StatusBadge status="approved" /> {approved}</span>
        <span><StatusBadge status="rejected" /> {rejected}</span>
        <span><StatusBadge status="pending" /> {total - done}</span>
      </p>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="nc-empty">
      <p className="t-title">{title}</p>
      {body ? <p className="nc-muted">{body}</p> : null}
      {action ?? null}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="nc-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="nc-switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function TagInput({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('');
  const add = (t: string) => {
    t = t.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="nc-taginput">
      {value.map((v) => (
        <span key={v} className="nc-chip">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            <Glyph name="cross" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        aria-label={label}
        placeholder={value.length ? '' : 'Type, then comma'}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            const parts = v.split(',');
            const rest = parts.pop() ?? '';
            const next = [...value];
            for (const p of parts.map((x) => x.trim()).filter(Boolean)) if (!next.includes(p)) next.push(p);
            onChange(next);
            setDraft(rest);
          } else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

export function MarksBar({ allocated, total }: { allocated: number; total: number }) {
  const ok = allocated === total;
  return (
    <div className={cx('nc-marks', ok ? 'is-ok' : 'is-off')} role="status" aria-live="polite">
      <span>
        Marks allocated:{' '}
        <b className="nc-num">
          {allocated} / {total}
        </b>
      </span>
      <span className="nc-marks-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, total ? (allocated / total) * 100 : 0)}%` }} />
      </span>
      <span className="nc-marks-verdict">
        <Glyph name={ok ? 'check' : 'warn'} />
        {ok ? 'Balanced' : allocated < total ? `${total - allocated} unallocated` : `${allocated - total} over`}
      </span>
    </div>
  );
}

export function AuditLine({ actor, action, target, at, detail }: { actor: string; action: string; target?: string; at: string; detail?: string | null }) {
  const verb = ({ approve: 'approved', reject: 'rejected', edit: 'edited', freeze: 'froze' } as Record<string, string>)[action] ?? action;
  return (
    <li className="nc-audit">
      <span className="nc-audit-who">
        <b>{actor}</b> {verb} {target}
      </span>
      <time className="nc-muted">{at}</time>
      {detail ? <span className="nc-audit-diff">{detail}</span> : null}
    </li>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-muted">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-field motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </span>
  );
}
