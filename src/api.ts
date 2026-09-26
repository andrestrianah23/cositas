import type { AdminStats, AdminUser, Task, TimedTaskInput, User } from '../shared/types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
/** Called when the server says the session is gone (signed out elsewhere, suspended, expired). */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined && method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const api = {
  config: () => request<{ demo: boolean }>('GET', '/config'),
  me: () => request<{ user: User | null }>('GET', '/me'),
  signIn: (email: string, password: string) => request<{ user: User }>('POST', '/auth/signin', { email, password }),
  signUp: (name: string, email: string, password: string) => request<{ user: User }>('POST', '/auth/signup', { name, email, password }),
  signOut: () => request<{ ok: true }>('POST', '/auth/signout'),
  rename: (name: string) => request<{ user: User }>('PATCH', '/me', { name }),

  tasks: () => request<{ tasks: Task[] }>('GET', '/tasks'),
  createTask: (t: TimedTaskInput) => request<{ task: Task }>('POST', '/tasks', { ...t, kind: 'timed' }),
  createGoal: (kind: 'week' | 'month', title: string, date: string) => request<{ task: Task }>('POST', '/tasks', { kind, title, date }),
  updateTask: (id: string, t: Partial<TimedTaskInput>) => request<{ task: Task }>('PATCH', `/tasks/${id}`, t),
  toggle: (id: string, key: string) => request<{ task: Task }>('POST', `/tasks/${id}/toggle`, { key }),
  deleteTask: (id: string) => request<{ ok: true }>('DELETE', `/tasks/${id}`),

  adminOverview: () => request<{ users: AdminUser[]; stats: AdminStats }>('GET', '/admin/overview'),
  adminUpdate: (id: string, patch: { role?: User['role']; status?: User['status'] }) => request<{ user: User }>('PATCH', `/admin/users/${id}`, patch),
  adminDelete: (id: string) => request<{ ok: true }>('DELETE', `/admin/users/${id}`),
};
