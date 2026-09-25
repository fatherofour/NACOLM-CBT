import { api, type Course } from './api';

export async function sessionInfo(sessionId: string) {
  const courses = await api.get<Course[]>('/courses');
  for (const c of courses) {
    const s = c.sessions.find((x) => x.id === sessionId);
    if (s) return { course: c, session: s, title: `${c.code} ${c.name}, ${s.label}` };
  }
  throw new Error('This exam session doesn’t exist, or you can’t see it.');
}
