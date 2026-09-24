import type { DesktopStats, Feed, Me, Person, Profile, UserSummary } from '../shared/types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

const h = (handle: string) => encodeURIComponent(handle.replace(/^@/, ''))

export const api = {
  me: () => call<Me>('/api/me'),
  updateMe: (patch: { name?: string; handle?: string; bio?: string | null }) => call<Me>('/api/me', { method: 'POST', body: JSON.stringify(patch) }),
  search: (q: string) => call<Person[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
  requestLink: (email: string) => call<{ ok: true }>('/api/auth/request', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  setAvatar: (image: Blob) => call<Me>('/api/me/avatar', { method: 'POST', body: image, headers: { 'content-type': image.type } }),
  clearAvatar: () => call<Me>('/api/me/avatar', { method: 'DELETE' }),
  people: (ids: string[]) => (ids.length ? call<Person[]>(`/api/users?ids=${encodeURIComponent(ids.join(','))}`) : Promise.resolve([] as Person[])),
  profile: (handle: string) => call<Profile>(`/api/users/${h(handle)}`),
  following: (handle: string) => call<Person[]>(`/api/users/${h(handle)}/following`),
  followers: (handle: string) => call<Person[]>(`/api/users/${h(handle)}/followers`),
  follow: (handle: string) => call<{ ok: true }>(`/api/users/${h(handle)}/follow`, { method: 'POST' }),
  unfollow: (handle: string) => call<{ ok: true }>(`/api/users/${h(handle)}/follow`, { method: 'DELETE' }),
  feed: () => call<Feed>('/api/feed'),
  stats: (handle: string) => call<DesktopStats>(`/api/users/${h(handle)}/stats`),
  admin: {
    list: () => call<UserSummary[]>('/api/admin/users'),
    remove: (id: string) => call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    runDecay: (handle: string) => call<{ items: number; archived: number; events: number }>(`/api/admin/boards/${h(handle)}/run`, { method: 'POST' }),
  },
}
