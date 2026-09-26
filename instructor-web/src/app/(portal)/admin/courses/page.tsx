'use client';
import { useState } from 'react';
import { Alert, Button, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import { useUser } from '@/components/shell/user-context';
import { api, type Course } from '@/lib/api';
import { useData } from '@/lib/use-data';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CoursesPage() {
  const me = useUser();
  const { data: courses, error, loading, reload } = useData(() => api.get<Course[]>('/courses'), []);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (me.role !== 'ADMIN') {
    return <EmptyState title="You don’t have access to this page" body="Managing the course catalog is limited to Admins." />;
  }

  return (
    <>
      <PageHead
        title="Courses"
        intro="The courses instructors can pick from when starting a session, adding to the question bank or uploading study material. Terms (years) are added freely under a course; the course itself is added here."
        action={
          <Button variant="primary" icon="plus" className="!h-11 justify-center md:!h-9" onClick={() => setCreating(true)} disabled={!courses}>
            New course
          </Button>
        }
      />

      {creating ? (
        <CreatePanel
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await reload();
          }}
        />
      ) : null}

      {error ? <Alert tone="error" title="Couldn’t load courses" action={<Button onClick={reload}>Try again</Button>}>{error}</Alert> : null}
      {loading && !courses ? <Spinner label="Loading courses…" /> : null}
      {courses && !courses.length ? <EmptyState title="No courses yet" body="Add the first course above." /> : null}

      {courses?.length ? (
        <Panel className="overflow-hidden">
          <table className="hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="bg-surface-sunken text-left text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-semibold">Code</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Terms</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Added</th>
                <th scope="col" className="px-5 py-2.5"><span className="nc-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) =>
                editingId === c.id ? (
                  <EditRow key={c.id} course={c} onCancel={() => setEditingId(null)} onSaved={async () => { setEditingId(null); await reload(); }} />
                ) : (
                  <tr key={c.id} className="border-t border-line align-middle">
                    <td className="px-5 py-3 font-mono">{c.code}</td>
                    <td className="px-3 py-3">{c.name}</td>
                    <td className="px-3 py-3 text-ink-muted">{c.sessions.length}</td>
                    <td className="px-3 py-3 text-ink-muted">{fmt(c.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <RowActions course={c} onEdit={() => setEditingId(c.id)} onReload={reload} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          <ul className="m-0 flex list-none flex-col p-0 md:hidden">
            {courses.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 border-t border-line px-4 py-3.5 first:border-t-0">
                <div className="flex-1">
                  <div className="font-mono text-xs text-ink-muted">{c.code}</div>
                  <div className="font-[650]">{c.name}</div>
                  <div className="text-[13px] text-ink-muted">{c.sessions.length} term{c.sessions.length === 1 ? '' : 's'}, added {fmt(c.createdAt)}</div>
                </div>
                <RowActions course={c} onEdit={() => setEditingId(c.id)} onReload={reload} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function RowActions({ course, onEdit, onReload }: { course: Course; onEdit: () => void; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasSessions = course.sessions.length > 0;

  async function remove() {
    if (!confirm(`Delete ${course.code} — ${course.name}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/courses/${course.id}`);
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="quiet" disabled={busy} onClick={onEdit}>Rename</Button>
        <Button
          variant="danger"
          disabled={busy || hasSessions}
          title={hasSessions ? `Can't delete — has ${course.sessions.length} exam session${course.sessions.length === 1 ? '' : 's'}` : undefined}
          onClick={remove}
        >
          Delete
        </Button>
      </div>
      {error ? <span className="text-[13px] font-semibold text-rejected">{error}</span> : null}
    </div>
  );
}

function EditRow({ course, onCancel, onSaved }: { course: Course; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(course.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/courses/${course.id}`, { name: name.trim() });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-line bg-surface-sunken align-middle">
      <td className="px-5 py-3 font-mono">{course.code}</td>
      <td className="px-3 py-3"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name" /></td>
      <td className="px-3 py-3 text-ink-muted" colSpan={2}>
        {error ? <span className="text-sm font-semibold text-rejected">{error}</span> : null}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>Save</Button>
          <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
      </td>
    </tr>
  );
}

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = code.trim() && name.trim();

  async function create() {
    setBusy(true);
    setError('');
    try {
      await api.post('/courses', { code: code.trim(), name: name.trim() });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the course.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-course-t" className="mb-6 flex flex-col gap-4 rounded-lg border-2 border-field bg-surface-raised p-4 md:p-6">
      <h2 id="new-course-t" className="t-title m-0">New course</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="label">
          Course code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. LOG301" />
        </label>
        <label className="label">
          Course name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Movement Control" />
        </label>
      </div>
      {error ? <Alert tone="error" title="Couldn’t create the course">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || busy} onClick={create}>{busy ? 'Creating…' : 'Create course'}</Button>
      </div>
    </section>
  );
}
