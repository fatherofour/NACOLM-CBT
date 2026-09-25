'use client';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { Glyph } from '@/components/nc/glyph';
import { PageHead, Panel } from '@/components/shell/page-head';
import { api, qs, type Course, type Question, type Session, type SourceDocument } from '@/lib/api';
import { useData } from '@/lib/use-data';

type Kind = 'PAST_PAPER' | 'STUDY_MATERIAL';
const NEW = '__new__';
const COPY = {
  PAST_PAPER: {
    title: 'Question bank',
    intro: 'Past papers uploaded for each course and year, and the approved questions in the bank. New exam sessions draw from the years you pick.',
    upload: 'Upload past paper',
    term: 'Year',
    empty: 'No past papers uploaded for this course yet.',
  },
  STUDY_MATERIAL: {
    title: 'Study material',
    intro: 'Study guides and notes for each course and term. AI drafts questions only from material uploaded here, and cites the page it used.',
    upload: 'Upload study material',
    term: 'Term',
    empty: 'No study material uploaded for this course yet.',
  },
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function LibraryPage({ kind }: { kind: Kind }) {
  const t = COPY[kind];
  const courses = useData(() => api.get<Course[]>('/courses'), []);
  const [picked, setCourseId] = useState('');
  const courseId = picked || ([...(courses.data ?? [])].sort((a, b) => b.sessions.length - a.sessions.length)[0]?.id ?? '');
  const course = courses.data?.find((c) => c.id === courseId);
  const sessions = useMemo(() => [...(course?.sessions ?? [])].sort((a, b) => b.label.localeCompare(a.label)), [course]);

  const docs = useData<SourceDocument[]>(() => (courseId ? api.get(`/documents${qs({ courseId, docType: kind })}`) : Promise.resolve([])), [courseId, kind]);
  const bankCounts = useData<Record<string, number>>(async () => {
    if (kind !== 'PAST_PAPER' || !course) return {};
    const entries = await Promise.all(
      course.sessions.map(async (s) => {
        const items = await api.get<Question[]>(`/question-bank${qs({ sessionId: s.id, status: 'APPROVED' })}`);
        return [s.id, items.filter((q) => q.source === 'PAST_PAPER').length] as const;
      }),
    );
    return Object.fromEntries(entries);
  }, [course?.id, kind]);

  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<SourceDocument | null>(null);
  const [delError, setDelError] = useState('');

  async function remove(d: SourceDocument) {
    setDelError('');
    try {
      await api.del(`/documents/${d.id}`);
      setDeleting(null);
      await docs.reload();
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Could not delete.');
    }
  }

  return (
    <>
      <PageHead
        title={t.title}
        intro={t.intro}
        action={
          <Button variant="primary" icon="upload" className="!h-11 justify-center md:!h-9" onClick={() => setOpen(true)} disabled={!courses.data}>
            {t.upload}
          </Button>
        }
      />
      {courses.error ? <Alert tone="error" title="Couldn’t load courses">{courses.error}</Alert> : null}

      {open && courses.data ? (
        <UploadPanel
          kind={kind}
          courses={courses.data}
          initialCourseId={courseId}
          onClose={() => setOpen(false)}
          onUploaded={async (cid) => {
            setOpen(false);
            await courses.reload();
            setCourseId(cid);
            await docs.reload();
          }}
        />
      ) : null}

      <div className="mb-4 mt-2 flex flex-wrap items-end gap-3">
        <label className="label">
          Course
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.data?.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
          </select>
        </label>
        <span className="pb-2 text-sm text-ink-muted">{docs.data ? `${docs.data.length} document${docs.data.length === 1 ? '' : 's'}` : ''}</span>
      </div>

      {kind === 'PAST_PAPER' && sessions.length ? (
        <Panel className="mb-4 flex flex-col gap-3 p-4 md:px-5">
          <h2 className="t-heading m-0">Approved past questions by year</h2>
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <span key={s.id} className="flex flex-col rounded-md border border-line px-3 py-2">
                <span className="font-[650]">{s.label}</span>
                <span className="text-[13px] tabular-nums text-ink-muted">{bankCounts.data ? `${bankCounts.data[s.id] ?? 0} questions` : '…'}</span>
              </span>
            ))}
          </div>
          <p className="m-0 text-[13px] text-ink-muted">Questions from an uploaded paper join the bank once they’ve been entered and approved; uploading stores the paper itself.</p>
        </Panel>
      ) : null}

      {deleting ? (
        <div role="alertdialog" aria-labelledby="del-t" className="mb-4 flex flex-col gap-3 rounded-lg border-2 border-rejected bg-rejected-soft p-4">
          <p id="del-t" className="m-0 font-[650]">Delete “{deleting.title}”?</p>
          <p className="m-0 text-sm">The file is removed from the server. Questions already drafted from it stay in the bank.</p>
          {delError ? <p className="m-0 text-sm font-semibold text-rejected">{delError}</p> : null}
          <div className="nc-row">
            <Button variant="danger" onClick={() => remove(deleting)}>Delete file</Button>
            <Button variant="quiet" onClick={() => setDeleting(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {docs.error ? <Alert tone="error" title="Couldn’t load documents">{docs.error}</Alert> : null}
      {docs.loading && !docs.data ? <Spinner label="Loading documents…" /> : null}
      {docs.data && !docs.data.length ? (
        <EmptyState title={t.empty} body="Upload a PDF or Word file to get started." action={<Button variant="primary" icon="upload" onClick={() => setOpen(true)}>{t.upload}</Button>} />
      ) : null}
      {docs.data?.length ? (
        <Panel className="overflow-hidden">
          <table className="hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="bg-surface-sunken text-left text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-semibold">Document</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{t.term}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Uploaded</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-5 py-2.5"><span className="nc-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id} className="border-t border-line align-top">
                  <td className="px-5 py-3">
                    <div className="font-[650]">{d.title}</div>
                    <div className="break-all text-xs text-ink-muted">{d.storagePath}</div>
                  </td>
                  <td className="px-3 py-3">{d.session?.label}</td>
                  <td className="px-3 py-3">{fmt(d.uploadedAt)}</td>
                  <td className="px-3 py-3"><DocStatus d={d} /></td>
                  <td className="px-5 py-3 text-right"><Button variant="quiet" onClick={() => setDeleting(d)}>Delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="m-0 flex list-none flex-col p-0 md:hidden">
            {docs.data.map((d) => (
              <li key={d.id} className="flex flex-col gap-1.5 border-t border-line px-4 py-3.5 first:border-t-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-[650]">{d.title}</div>
                    <div className="text-[13px] text-ink-muted">{d.session?.label}, uploaded {fmt(d.uploadedAt)}</div>
                  </div>
                  <DocStatus d={d} />
                </div>
                <div className="break-all text-xs text-ink-muted">{d.storagePath}</div>
                <div><Button variant="quiet" className="!px-0" onClick={() => setDeleting(d)}>Delete</Button></div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function DocStatus({ d }: { d: SourceDocument }) {
  if (d.docType === 'PAST_PAPER') return <Chip tone="approved">Stored</Chip>;
  return d.centralApiDocumentId ? <Chip tone="approved">Ready for drafting</Chip> : <Chip tone="caution">Not indexed yet</Chip>;
}

function UploadPanel({ kind, courses, initialCourseId, onClose, onUploaded }: { kind: Kind; courses: Course[]; initialCourseId: string; onClose: () => void; onUploaded: (courseId: string) => void }) {
  const t = COPY[kind];
  const [courseId, setCourseId] = useState(initialCourseId || courses[0]?.id || '');
  const course = courses.find((c) => c.id === courseId);
  const sessions = [...(course?.sessions ?? [])].sort((a, b) => b.label.localeCompare(a.label));
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? NEW);
  const [newLabel, setNewLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [destFor, setDestFor] = useState({ sessionId: '', path: '' });
  const dest = destFor.sessionId === sessionId ? destFor.path : '';

  useEffect(() => {
    if (sessionId === NEW || !sessionId) return;
    let cancelled = false;
    api
      .get<{ path: string }>(`/documents/destination${qs({ sessionId, docType: kind })}`)
      .then((r) => !cancelled && setDestFor({ sessionId, path: r.path }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, kind]);

  const tooBig = !!file && file.size > 50 * 1024 * 1024;
  const badType = !!file && !/\.(pdf|docx)$/i.test(file.name);
  const ready = !!file && !tooBig && !badType && !!title.trim() && (sessionId !== NEW || !!newLabel.trim());

  async function upload() {
    if (!file || !course) return;
    setBusy(true);
    setError('');
    try {
      let sid = sessionId;
      if (sid === NEW) sid = (await api.post<Session>('/courses/ensure-session', { courseCode: course.code, courseName: course.name, sessionLabel: newLabel.trim() })).id;
      const form = new FormData();
      form.set('file', file);
      form.set('sessionId', sid);
      form.set('docType', kind);
      form.set('title', title.trim());
      await api.upload('/documents', form);
      onUploaded(course.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="up-t" className="mb-6 flex flex-col gap-4 rounded-lg border-2 border-field bg-surface-raised p-4 md:p-6">
      <h2 id="up-t" className="t-title m-0">{t.upload}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="label">
          Course
          <select value={courseId} onChange={(e) => { setCourseId(e.target.value); const c = courses.find((x) => x.id === e.target.value); setSessionId([...(c?.sessions ?? [])].sort((a, b) => b.label.localeCompare(a.label))[0]?.id ?? NEW); }}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
          </select>
        </label>
        <label className="label">
          {t.term}
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value={NEW}>New {t.term.toLowerCase()}…</option>
          </select>
        </label>
        {sessionId === NEW ? (
          <label className="label">
            New {t.term.toLowerCase()}
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. 2023/2024" />
          </label>
        ) : null}
      </div>
      {!courses.length ? <Alert tone="caution" title="No courses yet">Create a course from New exam session first.</Alert> : null}

      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-line-strong bg-surface px-4 py-6 text-center">
        <Glyph name="upload" size={20} />
        <span className="font-[650]">{file ? file.name : 'Choose a PDF or Word file'}</span>
        <span className="text-[13px] text-ink-muted">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PDF or DOCX, up to 50 MB'}</span>
        <input
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="nc-sr"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.(pdf|docx)$/i, ''));
          }}
        />
      </label>
      {tooBig ? <p className="m-0 text-sm font-semibold text-rejected">That file is over 50 MB.</p> : null}
      {badType ? <p className="m-0 text-sm font-semibold text-rejected">Only PDF and DOCX files can be uploaded.</p> : null}

      <label className="label">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'PAST_PAPER' ? 'e.g. LOG301 first term paper 2023' : 'e.g. Movement Control Study Guide'} />
      </label>

      <div className="flex flex-col gap-0.5 rounded-md bg-surface-sunken px-3 py-2.5">
        <span className="text-[13px] text-ink-muted">Saved on the server to</span>
        <span className="break-all text-sm font-semibold">
          {sessionId === NEW ? `a new folder for ${course?.code ?? 'this course'} ${newLabel || '…'} (${kind === 'PAST_PAPER' ? 'past-papers' : 'study-material'})` : dest || '…'}
        </span>
      </div>

      {error ? <Alert tone="error" title="Upload failed">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</Button>
      </div>
    </section>
  );
}
