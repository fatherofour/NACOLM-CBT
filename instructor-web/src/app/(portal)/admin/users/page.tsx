'use client';
import { useState } from 'react';
import { Alert, Button, Chip, EmptyState, Spinner } from '@/components/nc/basics';
import { PageHead, Panel } from '@/components/shell/page-head';
import { useUser } from '@/components/shell/user-context';
import { api, type ManagedUser, type Role } from '@/lib/api';
import { useData } from '@/lib/use-data';

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', EXAM_OFFICER: 'Exam officer', INSTRUCTOR: 'Instructor' };
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function UsersPage() {
  const me = useUser();
  const { data: users, error, loading, reload } = useData(() => api.get<ManagedUser[]>('/users'), []);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ serviceNumber: string; password: string } | null>(null);

  if (me.role !== 'ADMIN') {
    return (
      <EmptyState title="You don’t have access to this page" body="Managing accounts is limited to Admins." />
    );
  }

  return (
    <>
      <PageHead
        title="Users"
        intro="Create and manage sign-in accounts. Every account signs in with a service number and password — there’s no self-registration."
        action={
          <Button variant="primary" icon="plus" className="!h-11 justify-center md:!h-9" onClick={() => setCreating(true)} disabled={!users}>
            New user
          </Button>
        }
      />

      {revealed ? (
        <Alert tone="info" title={`Password for ${revealed.serviceNumber}`} action={<Button variant="quiet" onClick={() => setRevealed(null)}>Dismiss</Button>}>
          <p className="m-0">
            <code className="rounded bg-surface-sunken px-2 py-1 font-mono text-sm">{revealed.password}</code>
          </p>
          <p className="m-0 mt-1 text-[13px]">Give this to them now — it isn’t stored anywhere and won’t be shown again.</p>
        </Alert>
      ) : null}

      {creating ? (
        <CreatePanel
          onClose={() => setCreating(false)}
          onCreated={async (serviceNumber, password) => {
            setCreating(false);
            await reload();
            if (password) setRevealed({ serviceNumber, password });
          }}
        />
      ) : null}

      {error ? <Alert tone="error" title="Couldn’t load users" action={<Button onClick={reload}>Try again</Button>}>{error}</Alert> : null}
      {loading && !users ? <Spinner label="Loading users…" /> : null}
      {users && !users.length ? <EmptyState title="No users yet" body="Create the first account above." /> : null}

      {users?.length ? (
        <Panel className="overflow-hidden">
          <table className="hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="bg-surface-sunken text-left text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-semibold">Service number</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Rank and name</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Role</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Created</th>
                <th scope="col" className="px-5 py-2.5"><span className="nc-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) =>
                editingId === u.id ? (
                  <EditRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === me.id}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      await reload();
                    }}
                  />
                ) : (
                  <tr key={u.id} className="border-t border-line align-middle">
                    <td className="px-5 py-3 font-mono">{u.serviceNumber}</td>
                    <td className="px-3 py-3">{u.rank} {u.fullName}</td>
                    <td className="px-3 py-3">{ROLE_LABEL[u.role]}</td>
                    <td className="px-3 py-3">
                      <Chip tone={u.active ? 'approved' : 'rejected'}>{u.active ? 'Active' : 'Deactivated'}</Chip>
                    </td>
                    <td className="px-3 py-3 text-ink-muted">{fmt(u.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <RowActions
                        user={u}
                        isSelf={u.id === me.id}
                        onEdit={() => setEditingId(u.id)}
                        onReload={reload}
                        onPasswordReset={(password) => setRevealed({ serviceNumber: u.serviceNumber, password })}
                      />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          <ul className="m-0 flex list-none flex-col p-0 md:hidden">
            {users.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 border-t border-line px-4 py-3.5 first:border-t-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-mono text-xs text-ink-muted">{u.serviceNumber}</div>
                    <div className="font-[650]">{u.rank} {u.fullName}</div>
                    <div className="text-[13px] text-ink-muted">{ROLE_LABEL[u.role]}, since {fmt(u.createdAt)}</div>
                  </div>
                  <Chip tone={u.active ? 'approved' : 'rejected'}>{u.active ? 'Active' : 'Deactivated'}</Chip>
                </div>
                <RowActions
                  user={u}
                  isSelf={u.id === me.id}
                  onEdit={() => setEditingId(u.id)}
                  onReload={reload}
                  onPasswordReset={(password) => setRevealed({ serviceNumber: u.serviceNumber, password })}
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function RowActions({
  user,
  isSelf,
  onEdit,
  onReload,
  onPasswordReset,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onEdit: () => void;
  onReload: () => Promise<void>;
  onPasswordReset: (password: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function resetPassword() {
    if (!confirm(`Reset the password for ${user.serviceNumber}? They’ll be signed out everywhere.`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ generatedPassword?: string }>(`/users/${user.id}/reset-password`, {});
      if (r.generatedPassword) onPasswordReset(r.generatedPassword);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (user.active && !confirm(`Deactivate ${user.serviceNumber}? They’ll be signed out immediately and can’t sign in again until reactivated.`)) return;
    setBusy(true);
    try {
      await api.patch(`/users/${user.id}`, { active: !user.active });
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="quiet" disabled={busy} onClick={onEdit}>Edit</Button>
      <Button variant="quiet" disabled={busy} onClick={resetPassword}>Reset password</Button>
      {!isSelf ? (
        <Button variant={user.active ? 'danger' : 'secondary'} disabled={busy} onClick={toggleActive}>
          {user.active ? 'Deactivate' : 'Reactivate'}
        </Button>
      ) : null}
    </div>
  );
}

function EditRow({ user, isSelf, onCancel, onSaved }: { user: ManagedUser; isSelf: boolean; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [rank, setRank] = useState(user.rank);
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/users/${user.id}`, { rank: rank.trim(), fullName: fullName.trim(), role });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-line bg-surface-sunken align-middle">
      <td className="px-5 py-3 font-mono">{user.serviceNumber}</td>
      <td className="px-3 py-3">
        <div className="flex gap-2">
          <input value={rank} onChange={(e) => setRank(e.target.value)} className="!w-20" placeholder="Rank" />
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
        </div>
      </td>
      <td className="px-3 py-3">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf} title={isSelf ? "You can't change your own role" : undefined}>
          <option value="INSTRUCTOR">Instructor</option>
          <option value="EXAM_OFFICER">Exam officer</option>
          <option value="ADMIN">Admin</option>
        </select>
      </td>
      <td className="px-3 py-3" colSpan={2}>
        {error ? <span className="text-sm font-semibold text-rejected">{error}</span> : null}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          <Button variant="primary" disabled={busy || !rank.trim() || !fullName.trim()} onClick={save}>Save</Button>
          <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
      </td>
    </tr>
  );
}

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (serviceNumber: string, password?: string) => void }) {
  const [serviceNumber, setServiceNumber] = useState('');
  const [rank, setRank] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('INSTRUCTOR');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = serviceNumber.trim() && rank.trim() && fullName.trim() && (!password || password.length >= 10);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: { serviceNumber: string }; generatedPassword?: string }>('/users', {
        serviceNumber: serviceNumber.trim(),
        rank: rank.trim(),
        fullName: fullName.trim(),
        role,
        ...(password ? { password } : {}),
      });
      onCreated(r.user.serviceNumber, r.generatedPassword);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-user-t" className="mb-6 flex flex-col gap-4 rounded-lg border-2 border-field bg-surface-raised p-4 md:p-6">
      <h2 id="new-user-t" className="t-title m-0">New user</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="label">
          Service number
          <input value={serviceNumber} onChange={(e) => setServiceNumber(e.target.value)} placeholder="e.g. NA/19/4411" />
        </label>
        <label className="label">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="INSTRUCTOR">Instructor</option>
            <option value="EXAM_OFFICER">Exam officer</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label className="label">
          Rank
          <input value={rank} onChange={(e) => setRank(e.target.value)} placeholder="e.g. Capt" />
        </label>
        <label className="label">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. O. Nwosu" />
        </label>
        <label className="label md:col-span-2">
          Password (optional)
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to generate one" />
        </label>
      </div>
      {password && password.length < 10 ? <p className="m-0 text-sm font-semibold text-rejected">Password must be at least 10 characters.</p> : null}
      {error ? <Alert tone="error" title="Couldn’t create the account">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || busy} onClick={create}>{busy ? 'Creating…' : 'Create user'}</Button>
      </div>
    </section>
  );
}
