import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/shell/shell';
import type { User } from '@/lib/api';

const API = process.env.INSTRUCTOR_API_URL ?? 'http://localhost:8020';

// Every portal page is rendered per request for the signed-in user.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get('nacolm_session')?.value;
  if (!token) redirect('/login');

  let user: User | null = null;
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { cookie: `nacolm_session=${encodeURIComponent(token)}` },
      cache: 'no-store',
    });
    if (res.ok) user = ((await res.json()) as { user: User }).user;
  } catch {
    throw new Error('The instructor service is not reachable. Check that instructor-api is running.');
  }
  if (!user) redirect('/login');

  return <Shell user={user}>{children}</Shell>;
}
