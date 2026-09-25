'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, RadioCards, Spinner, SumCheck, TagInput, WizardSteps } from '@/components/nc/basics';
import { Glyph } from '@/components/nc/glyph';
import { PageHead, Panel } from '@/components/shell/page-head';
import { api, qs, type Blueprint, type Course, type Question, type Session, type SourceDocument } from '@/lib/api';
import { useData } from '@/lib/use-data';

type Source = 'past_only' | 'study_material_only' | 'both';
const STEPS = ['Source', 'Count and difficulty', 'Results', 'Generate'];
const NEW = '__new__';

interface YearInfo { session: Session; count: number; topics: string[] }
interface GenResult { created: number; skippedDuplicates: number; shortfalls: { topic: string; type: string; needed: number; found: number }[] }

export default function NewSessionPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <Wizard />
    </Suspense>
  );
}

function Wizard() {
  const params = useSearchParams();
  const { data: courses, error: loadError, reload } = useData(() => api.get<Course[]>('/courses'), []);

  const [step, setStep] = useState(0);
  const [pickedCourse, setCourseId] = useState('');
  const [newCourse, setNewCourse] = useState({ code: '', name: '' });
  const [pickedSession, setSessionId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [source, setSource] = useState<Source>('past_only');
  const [pickedYears, setYears] = useState<string[] | null>(null);
  const [pickedSplit, setSplit] = useState<{ bank: number; ai: number } | null>(null);
  const [total, setTotal] = useState(40);
  const [mix, setMix] = useState({ objective: 30, theory: 10 });
  const [diff, setDiff] = useState({ easy: 12, medium: 20, hard: 8 });
  const [topics, setTopics] = useState<string[]>([]);
  const [release, setRelease] = useState<'instant' | 'hold'>('hold');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [runError, setRunError] = useState('');
  const [createdSessionId, setCreatedSessionId] = useState('');

  // Defaults: ?session= if given, else the newest term of the busiest course.
  const wanted = params.get('session');
  const hit = courses?.find((c) => c.sessions.some((s) => s.id === wanted));
  const defaultCourse = hit ?? [...(courses ?? [])].sort((a, b) => b.sessions.length - a.sessions.length)[0];
  const courseId = pickedCourse || (courses ? defaultCourse?.id ?? NEW : '');
  const newestOf = (c?: Course) => [...(c?.sessions ?? [])].sort((a, b) => b.label.localeCompare(a.label))[0]?.id ?? NEW;
  const sessionId = pickedSession || (courses ? (hit && courseId === hit.id ? wanted! : newestOf(courses.find((c) => c.id === courseId))) : '');

  const course = courses?.find((c) => c.id === courseId);
  const isNewTerm = sessionId === NEW || courseId === NEW;
  const usesBank = source !== 'study_material_only';
  const needsMaterial = source !== 'past_only';

  // Past-paper questions per term of this course (the "years").
  const { data: yearInfo, loading: yearsLoading } = useData<YearInfo[]>(async () => {
    if (!course) return [];
    return Promise.all(
      course.sessions.map(async (s) => {
        const items = await api.get<Question[]>(`/question-bank${qs({ sessionId: s.id, status: 'APPROVED' })}`);
        const past = items.filter((q) => q.source === 'PAST_PAPER');
        return { session: s, count: past.length, topics: [...new Set(past.map((q) => q.topic))] };
      }),
    );
  }, [course?.id]);
  const bankYears = (yearInfo ?? []).filter((y) => y.count > 0 && y.session.id !== sessionId).sort((a, b) => b.session.label.localeCompare(a.session.label));
  const ownBank = (yearInfo ?? []).find((y) => y.session.id === sessionId)?.count ?? 0;
  // Default: the three most recent years with questions.
  const years = pickedYears ?? bankYears.slice(0, 3).map((y) => y.session.id);
  const pool = ownBank + bankYears.filter((y) => years.includes(y.session.id)).reduce((n, y) => n + y.count, 0);
  const topicSuggestions = [...new Set((yearInfo ?? []).flatMap((y) => y.topics))].filter((t) => !topics.includes(t));


  const { data: materials } = useData<SourceDocument[]>(
    () => (sessionId && sessionId !== NEW ? api.get(`/documents${qs({ sessionId, docType: 'STUDY_MATERIAL' })}`) : Promise.resolve([])),
    [sessionId],
  );

  const split = pickedSplit ?? { bank: Math.round(total * 0.6), ai: total - Math.round(total * 0.6) };

  const bankNeed = source === 'past_only' ? total : source === 'both' ? split.bank : 0;
  const blocker = ((): string => {
    if (step === 0) {
      if (courseId === NEW && (!newCourse.code.trim() || !newCourse.name.trim())) return 'Enter the new course code and name';
      if (isNewTerm && !newLabel.trim()) return 'Enter the term, e.g. 2026/2027';
      if (!isNewTerm && !sessionId) return 'Choose a term';
      if (usesBank && bankYears.length && !years.length && ownBank === 0) return 'Pick at least one past-paper year';
      if (needsMaterial && !isNewTerm && materials && !materials.length) return 'Upload study material for this term first';
      if (needsMaterial && isNewTerm) return 'Upload study material for the new term first';
      if (source === 'both' && split.bank + split.ai !== total) return `Bank + AI must equal ${total}`;
    }
    if (step === 1) {
      if (total < 1) return 'Enter how many questions';
      if (mix.objective + mix.theory !== total) return 'Objective + theory must equal the total';
      if (diff.easy + diff.medium + diff.hard !== total) return 'Easy + moderate + hard must equal the total';
      if (!topics.length) return 'Add at least one topic';
      if (usesBank && pool < bankNeed) return `The selected years hold ${pool} approved questions; ${bankNeed} are needed from the bank. Lower the count or pick more years.`;
    }
    return '';
  })();

  async function generate() {
    setRunning(true);
    setRunError('');
    setResult(null);
    try {
      let sid = sessionId;
      if (isNewTerm) {
        const c = courseId === NEW ? { code: newCourse.code.trim().toUpperCase(), name: newCourse.name.trim() } : { code: course!.code, name: course!.name };
        const s = await api.post<Session>('/courses/ensure-session', { courseCode: c.code, courseName: c.name, sessionLabel: newLabel.trim() });
        sid = s.id;
      }
      setCreatedSessionId(sid);
      const bp = await api.post<Blueprint>('/blueprints', {
        sessionId: sid,
        sourceMode: source,
        pastQuestionRatio: source === 'both' ? split.bank / total : source === 'past_only' ? 1 : 0,
        totalCount: total,
        objectiveCount: mix.objective,
        theoryCount: mix.theory,
        topics,
        pastSessionIds: usesBank ? years : [],
        difficultyTargets: diff,
        resultsRelease: release,
      });
      setResult(await api.post<GenResult>(`/blueprints/${bp.id}/generate`));
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setRunning(false);
    }
  }

  const num = (v: string) => Math.max(0, parseInt(v || '0', 10));
  const termLabel = isNewTerm ? newLabel || 'new term' : course?.sessions.find((s) => s.id === sessionId)?.label;
  const courseLabel = courseId === NEW ? `${newCourse.code} ${newCourse.name}` : `${course?.code ?? ''} ${course?.name ?? ''}`;

  return (
    <>
      <PageHead title="New exam session" intro={courses ? `${courseLabel.trim() || 'Choose a course'}, ${termLabel ?? ''}` : undefined} crumbs={[['Exam sessions', '/sessions'], ['New exam session']]} />
      {loadError ? <Alert tone="error" title="Couldn’t load courses" action={<Button onClick={reload}>Try again</Button>}>{loadError}</Alert> : null}
      <div className="flex max-w-[960px] flex-col gap-6">
        <WizardSteps steps={STEPS} current={step} />
        <Panel className="flex flex-col gap-5 p-4 md:p-6">
          {step === 0 ? (
            <>
              <h2 className="t-title m-0">Course, term and source</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="label">
                  Course
                  <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setYears(null); setSessionId(newestOf(courses?.find((x) => x.id === e.target.value))); }}>
                    {courses?.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                    <option value={NEW}>New course…</option>
                  </select>
                </label>
                <label className="label">
                  Term
                  <select value={courseId === NEW ? NEW : sessionId} disabled={courseId === NEW} onChange={(e) => setSessionId(e.target.value)}>
                    {[...(course?.sessions ?? [])].sort((a, b) => b.label.localeCompare(a.label)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    <option value={NEW}>New term…</option>
                  </select>
                </label>
                {courseId === NEW ? (
                  <>
                    <label className="label">Course code<input value={newCourse.code} onChange={(e) => setNewCourse({ ...newCourse, code: e.target.value })} placeholder="e.g. LOG301" /></label>
                    <label className="label">Course name<input value={newCourse.name} onChange={(e) => setNewCourse({ ...newCourse, name: e.target.value })} placeholder="e.g. Movement Control" /></label>
                  </>
                ) : null}
                {isNewTerm ? <label className="label">New term<input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. 2026/2027" /></label> : null}
              </div>

              <RadioCards
                label="Question source"
                value={source}
                onChange={(v) => setSource(v as Source)}
                options={[
                  { value: 'past_only', title: 'Past questions only', description: 'No AI, assembled instantly from the bank for the years you pick.' },
                  { value: 'study_material_only', title: 'Study material only', description: 'AI drafts new questions from your material, grounded and cited.' },
                  { value: 'both', title: 'Both', description: 'Blend the bank with AI-drafted questions.' },
                ]}
              />

              {usesBank && courseId !== NEW ? (
                <fieldset className="m-0 flex flex-col gap-3 rounded-md border border-line p-4">
                  <legend className="t-heading px-1.5">Past-paper years to draw from</legend>
                  {yearsLoading ? <Spinner label="Counting past questions…" /> : null}
                  {!yearsLoading && !bankYears.length ? (
                    <p className="m-0 text-ink-muted">No other terms of this course have approved past-paper questions yet. <Link href="/bank">Add past papers in the Question bank</Link>.</p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                    {bankYears.map((y) => {
                      const on = years.includes(y.session.id);
                      return (
                        <label key={y.session.id} className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2.5 ${on ? 'border-2 border-field bg-field-soft' : 'border border-line-strong bg-surface-raised'}`}>
                          <input type="checkbox" checked={on} onChange={() => setYears(on ? years.filter((x) => x !== y.session.id) : [...years, y.session.id])} className="h-[18px] w-[18px] accent-[var(--field)]" />
                          <span className="flex flex-col">
                            <span className="font-[650]">{y.session.label}</span>
                            <span className="text-[13px] text-ink-muted">{y.count} questions</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span><b className="tabular-nums">{pool}</b> approved questions available{ownBank ? ` (${ownBank} already in this term)` : ''}</span>
                    {bankYears.length > 1 ? (
                      <>
                        <Button variant="quiet" onClick={() => setYears(bankYears.map((y) => y.session.id))}>Select all</Button>
                        <Button variant="quiet" onClick={() => setYears(bankYears.slice(0, 3).map((y) => y.session.id))}>Last 3 years</Button>
                      </>
                    ) : null}
                  </div>
                </fieldset>
              ) : null}

              {needsMaterial ? (
                isNewTerm || (materials && !materials.length) ? (
                  <Alert tone="caution" title="Upload study material to continue">
                    AI drafts only from material uploaded for this course and term. <Link href="/material">Upload it in Study material</Link>, then come back.
                  </Alert>
                ) : materials ? (
                  <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3">
                    <Glyph name="material" size={20} className="text-drafted" />
                    <div className="flex-1">
                      <div className="font-semibold">{materials.length} study document{materials.length === 1 ? '' : 's'} for this term</div>
                      <div className="text-[13px] text-ink-muted">{materials.map((m) => m.title).join(', ')}</div>
                    </div>
                    <Link href="/material" className="text-sm font-semibold">Manage</Link>
                  </div>
                ) : null
              ) : null}

              {source === 'both' ? (
                <div className="grid grid-cols-2 gap-3 md:flex md:items-end">
                  <label className="label">From bank<input type="number" min={0} value={split.bank} onChange={(e) => setSplit({ ...split, bank: num(e.target.value) })} className="md:!w-32" /></label>
                  <label className="label">From AI<input type="number" min={0} value={split.ai} onChange={(e) => setSplit({ ...split, ai: num(e.target.value) })} className="md:!w-32" /></label>
                  <p className="col-span-2 m-0 text-sm text-ink-muted md:mb-2">Split of the {total} questions set in the next step.</p>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 className="t-title m-0">How many questions, and how hard?</h2>
              <div className="grid grid-cols-3 gap-3 md:flex">
                <label className="label">Total<input type="number" min={1} value={total} onChange={(e) => setTotal(num(e.target.value))} className="md:!w-36" /></label>
                <label className="label">Objective<input type="number" min={0} value={mix.objective} onChange={(e) => setMix({ ...mix, objective: num(e.target.value) })} className="md:!w-36" /></label>
                <label className="label">Theory<input type="number" min={0} value={mix.theory} onChange={(e) => setMix({ ...mix, theory: num(e.target.value) })} className="md:!w-36" /></label>
              </div>
              <SumCheck parts={[['objective', mix.objective], ['theory', mix.theory]]} total={total} />
              <h3 className="t-heading m-0 mt-2">Difficulty</h3>
              <div className="grid grid-cols-3 gap-3 md:flex">
                <label className="label">Easy<input type="number" min={0} value={diff.easy} onChange={(e) => setDiff({ ...diff, easy: num(e.target.value) })} className="md:!w-36" /></label>
                <label className="label">Moderate<input type="number" min={0} value={diff.medium} onChange={(e) => setDiff({ ...diff, medium: num(e.target.value) })} className="md:!w-36" /></label>
                <label className="label">Hard<input type="number" min={0} value={diff.hard} onChange={(e) => setDiff({ ...diff, hard: num(e.target.value) })} className="md:!w-36" /></label>
              </div>
              <SumCheck parts={[['easy', diff.easy], ['moderate', diff.medium], ['hard', diff.hard]]} total={total} />
              <h3 className="t-heading m-0 mt-2">Topics</h3>
              <p className="m-0 -mt-3 text-sm text-ink-muted">Questions are spread evenly across these topics.</p>
              <TagInput value={topics} onChange={setTopics} label="Topics" />
              {topicSuggestions.length ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink-muted">From the bank:</span>
                  {topicSuggestions.map((t) => (
                    <button key={t} type="button" className="nc-btn nc-btn-quiet !h-8 !px-2" onClick={() => setTopics([...topics, t])}>
                      <Glyph name="plus" />
                      {t}
                    </button>
                  ))}
                </div>
              ) : null}
              {mix.theory > 0 ? (
                <Alert tone="info" title="Theory questions are marked automatically">
                  During review you’ll confirm a keyword marking scheme for each theory question. Candidates’ answers are marked against it as soon as they submit.
                </Alert>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 className="t-title m-0">When should candidates see their results?</h2>
              <p className="-mt-2 m-0 text-ink-muted">Objective and theory answers are marked automatically as soon as each candidate submits.</p>
              <RadioCards
                label="Results release"
                value={release}
                onChange={(v) => setRelease(v as 'instant' | 'hold')}
                options={[
                  { value: 'instant', title: 'Publish on submission', description: 'Each candidate sees their score as soon as they submit.' },
                  { value: 'hold', title: 'Send to me first', description: 'Scores come to you in Results. Candidates see nothing until you release them.' },
                ]}
              />
              <Alert tone="info" title={release === 'hold' ? 'You release results from the Results page' : 'Candidates see their score on the submit screen'}>
                {release === 'hold'
                  ? 'You can release them for everyone at once, whenever you’re ready. Once released, results can’t be withdrawn.'
                  : 'You also get every result in Results. Published results can’t be withdrawn, so check each answer carefully during review.'}
              </Alert>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h2 className="t-title m-0">Check and generate</h2>
              <dl className="nc-freeze-sum !grid-cols-2 md:!grid-cols-4">
                <div><dt>Course and term</dt><dd>{courseLabel.trim()}, {termLabel}</dd></div>
                <div><dt>Source</dt><dd>{{ past_only: 'Past questions only', study_material_only: 'Study material only', both: 'Both' }[source]}</dd></div>
                <div><dt>Past-paper years</dt><dd>{usesBank ? bankYears.filter((y) => years.includes(y.session.id)).map((y) => y.session.label).join(', ') || 'This term only' : 'Not used'}</dd></div>
                <div><dt>Split</dt><dd>{source === 'both' ? `${split.bank} bank / ${split.ai} AI` : source === 'past_only' ? 'All from bank' : 'All AI-drafted'}</dd></div>
                <div><dt>Total</dt><dd>{total} questions</dd></div>
                <div><dt>Objective / theory</dt><dd>{mix.objective} / {mix.theory}</dd></div>
                <div><dt>Easy / moderate / hard</dt><dd>{diff.easy} / {diff.medium} / {diff.hard}</dd></div>
                <div><dt>Results</dt><dd>{release === 'hold' ? 'Sent to instructor first' : 'Published on submission'}</dd></div>
                <div className="col-span-2 md:col-span-4"><dt>Topics</dt><dd>{topics.join(', ')}</dd></div>
              </dl>
              {running ? (
                <div className="flex flex-col gap-2">
                  <Spinner label={needsMaterial ? 'Pulling past questions and drafting from study material. Drafting can take a few minutes.' : 'Pulling past questions from the bank…'} />
                </div>
              ) : null}
              {runError ? (
                <Alert tone="error" title="Generation stopped" action={<Button icon="retry" onClick={generate}>Retry</Button>}>
                  {runError}
                </Alert>
              ) : null}
              {result ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-3 rounded-md bg-approved-soft p-4 md:flex-row md:items-center">
                    <div className="flex-1">
                      <div className="font-[650] text-approved">Draft ready</div>
                      <div className="text-sm">
                        {result.created} question{result.created === 1 ? '' : 's'} added for review
                        {result.skippedDuplicates ? `, ${result.skippedDuplicates} near-duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped` : ''}. Nothing reaches the paper until you approve it.
                      </div>
                    </div>
                    <Link className="btnlink primary" href={`/sessions/${createdSessionId}/review`}>Start review</Link>
                  </div>
                  {result.shortfalls.length ? (
                    <Alert tone="caution" title="Some topics came up short">
                      <ul className="m-0 pl-4">
                        {result.shortfalls.map((s) => (
                          <li key={s.topic + s.type}>{s.topic}, {s.type.toLowerCase()}: found {s.found} of {s.needed}</li>
                        ))}
                      </ul>
                      Add past papers or study material for these topics, or lower the counts.
                    </Alert>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </Panel>

        <div className="sticky bottom-16 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-surface-raised px-4 py-3 md:static md:mx-0 md:flex-row md:items-center md:border-0 md:bg-transparent md:p-0 lg:bottom-0">
          {blocker ? <span className="text-[13px] font-semibold text-caution md:order-2 md:ml-auto">{blocker}</span> : <span className="hidden md:order-2 md:ml-auto md:block" />}
          <div className="flex gap-2 md:contents">
            {step > 0 && !running ? <Button className="md:order-1" onClick={() => setStep(step - 1)}>Back</Button> : null}
            {step < 3 ? (
              <Button variant="primary" className="flex-1 justify-center md:order-3 md:flex-none" disabled={!!blocker} onClick={() => setStep(step + 1)}>Next</Button>
            ) : !result ? (
              <Button variant="primary" className="flex-1 justify-center md:order-3 md:flex-none" disabled={running} onClick={generate}>Generate draft</Button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
