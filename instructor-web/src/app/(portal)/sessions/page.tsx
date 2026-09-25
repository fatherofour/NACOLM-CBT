'use client';
import Link from 'next/link';
import { Alert, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { Glyph } from '@/components/nc/glyph';
import { PageHead, Panel } from '@/components/shell/page-head';
import { api, qs, type Blueprint, type Course, type Paper } from '@/lib/api';
import { useData } from '@/lib/use-data';

interface Row {
  course: Course;
  sessionId: string;
  label: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  blueprint?: Blueprint;
  latest?: { title: string; version: number; frozenAt: string };
}

type Tone = 'field' | 'caution' | 'approved' | 'bank';
function stage(r: Row): { label: string; tone: Tone; href: string; action: string } {
  const base = `/sessions/${r.sessionId}`;
  if (r.latest && r.pending === 0) return { label: `Frozen, version ${r.latest.version}`, tone: 'approved', href: `${base}/freeze`, action: 'View paper' };
  if (!r.blueprint && r.total === 0) return { label: 'Not started', tone: 'bank', href: `/sessions/new?session=${r.sessionId}`, action: 'Set up paper' };
  if (r.pending > 0) return { label: 'In review', tone: 'field', href: `${base}/review`, action: 'Continue review' };
  return { label: 'Ready to freeze', tone: 'field', href: `${base}/freeze`, action: 'Check coverage' };
}

async function loadRows(): Promise<Row[]> {
  const courses = await api.get<Course[]>('/courses');
  const sessions = courses.flatMap((c) => c.sessions.map((s) => ({ c, s })));
  return Promise.all(
    sessions.map(async ({ c, s }) => {
      const [progress, blueprints, papers] = await Promise.all([
        api.get<{ status: string; _count: number }[]>(`/question-bank/review-progress${qs({ sessionId: s.id })}`),
        api.get<Blueprint[]>(`/blueprints${qs({ sessionId: s.id })}`),
        api.get<Paper[]>(`/papers${qs({ sessionId: s.id })}`),
      ]);
      const count = (st: string) => progress.find((p) => p.status === st)?._count ?? 0;
      const versions = papers.flatMap((p) => p.versions.map((v) => ({ title: p.title, version: v.versionNumber, frozenAt: v.frozenAt })));
      versions.sort((a, b) => b.frozenAt.localeCompare(a.frozenAt));
      const approved = count('APPROVED'), rejected = count('REJECTED'), pending = count('DRAFT');
      return { course: c, sessionId: s.id, label: s.label, total: approved + rejected + pending, approved, rejected, pending, blueprint: blueprints[0], latest: versions[0] };
    }),
  );
}

export default function SessionsPage() {
  const { data: rows, error, loading, reload } = useData(loadRows, []);
  // Papers being set: a session with a blueprint, drafts or a frozen paper.
  // Past years that only hold approved bank questions live under Question bank.
  const visible = (rows ?? []).filter((r) => r.blueprint || r.pending > 0 || r.latest).sort((a, b) => b.label.localeCompare(a.label) || a.course.code.localeCompare(b.course.code));
  const attention = visible.filter((r) => r.pending > 0);

  return (
    <>
      <PageHead
        title="Exam sessions"
        intro="Each course and term you’re setting a paper for. Papers stay here from the first draft until they’re frozen."
        action={
          <Link className="btnlink primary !h-11 md:!h-9" href="/sessions/new">
            <Glyph name="plus" />
            New exam session
          </Link>
        }
      />
      {error ? <Alert tone="error" title="Couldn’t load your sessions" action={<button className="nc-btn" onClick={reload}>Try again</button>}>{error}</Alert> : null}
      {loading && !rows ? <Spinner label="Loading sessions…" /> : null}
      {rows && !visible.length ? (
        <EmptyState
          title="No exam sessions yet"
          body="Start one to draw questions from the bank or draft them from study material."
          action={<Link className="btnlink primary" href="/sessions/new">New exam session</Link>}
        />
      ) : null}
      {visible.length ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <Panel className="min-w-0 flex-1 overflow-hidden" aria-labelledby="terms">
            <h2 id="terms" className="t-title m-0 border-b border-line px-5 py-4">
              Your papers
            </h2>
            <table className="hidden w-full border-collapse text-sm md:table">
              <thead>
                <tr className="bg-surface-sunken text-left text-ink-muted">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Course and term</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Source</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Review</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Stage</th>
                  <th scope="col" className="px-5 py-2.5"><span className="nc-sr">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const st = stage(r);
                  const pct = r.total ? Math.round(((r.approved + r.rejected) / r.total) * 100) : 0;
                  return (
                    <tr key={r.sessionId} className="border-t border-line align-middle">
                      <td className="px-5 py-3.5">
                        <div className="font-[650]">{r.course.code} {r.course.name}</div>
                        <div className="text-[13px] text-ink-muted">{r.label}</div>
                      </td>
                      <td className="px-3 py-3.5">{sourceLabel(r.blueprint)}</td>
                      <td className="w-[190px] px-3 py-3.5">
                        <div className="font-semibold tabular-nums">{r.approved + r.rejected} of {r.total} reviewed</div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-surface-sunken"><div className="h-full bg-field" style={{ width: `${pct}%` }} /></div>
                      </td>
                      <td className="px-3 py-3.5"><Chip tone={st.tone}>{st.label}</Chip></td>
                      <td className="px-5 py-3.5 text-right"><Link className="btnlink" href={st.href}>{st.action}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="m-0 flex list-none flex-col p-0 md:hidden">
              {visible.map((r) => {
                const st = stage(r);
                return (
                  <li key={r.sessionId} className="border-t border-line first:border-t-0">
                    <Link href={st.href} className="flex flex-col gap-2 px-4 py-3.5 text-ink no-underline">
                      <span className="flex items-start gap-2">
                        <span className="flex-1">
                          <span className="block font-[650]">{r.course.code} {r.course.name}</span>
                          <span className="block text-[13px] text-ink-muted">{r.label}, {sourceLabel(r.blueprint).toLowerCase()}</span>
                        </span>
                        <Chip tone={st.tone}>{st.label}</Chip>
                      </span>
                      <span className="text-sm tabular-nums">{r.approved + r.rejected} of {r.total} reviewed</span>
                      <span className="text-sm font-[650] text-field">{st.action}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <aside aria-labelledby="att" className="flex shrink-0 flex-col gap-3 xl:w-[360px]">
            <h2 id="att" className="t-title m-0">Needs your attention</h2>
            {attention.length ? (
              attention.map((r) => (
                <Alert key={r.sessionId} tone="caution" title={`${r.pending} question${r.pending === 1 ? '' : 's'} waiting for review`}>
                  {r.course.code}, {r.label}. <Link href={`/sessions/${r.sessionId}/review`}>Review now</Link>
                </Alert>
              ))
            ) : (
              <p className="m-0 text-ink-muted">Nothing is waiting on you.</p>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}

function sourceLabel(b?: Blueprint) {
  if (!b) return 'Question bank';
  if (b.sourceMode === 'past_only') return 'Past questions';
  if (b.sourceMode === 'study_material_only') return 'Study material';
  return `Bank and AI (${Math.round(b.pastQuestionRatio * 100)}% bank)`;
}
