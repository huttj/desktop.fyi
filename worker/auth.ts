import type { Me } from '../shared/types'
import { Db, type UserRow } from './db'

export const SESSION_COOKIE = 'dfyi_session'
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000
export const TOKEN_TTL_MS = 15 * 60 * 1000

export function isAdminEmail(env: Env, email: string) {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase())
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function sessionCookie(value: string, request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export const TOKEN_RE = /^dfyi_[A-Za-z0-9_-]{20,}$/

export function readBearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return m && TOKEN_RE.test(m[1]!) ? m[1]! : null
}

/**
 * Who is asking, and how. A personal access token acts as its person for
 * reading, and for writing to their own desktop and account only: the routes
 * that reach further (admin, other desktops' boards) check `viaToken`.
 */
export async function getAuth(request: Request, env: Env): Promise<{ user: UserRow; viaToken: boolean } | null> {
  const bearer = readBearer(request)
  if (bearer) {
    const user = await new Db(env.DB).userByApiToken(bearer)
    return user ? { user, viaToken: true } : null
  }
  const sessionId = readCookie(request, SESSION_COOKIE)
  if (!sessionId) return null
  const user = await new Db(env.DB).sessionUser(sessionId)
  return user ? { user, viaToken: false } : null
}

export async function getSessionUser(request: Request, env: Env): Promise<UserRow | null> {
  return (await getAuth(request, env))?.user ?? null
}

export function isLocal(request: Request) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(request.url).origin)
}

/** The public origin used in emailed links. Local dev uses the request origin. */
export function publicOrigin(request: Request, env: Env) {
  const origin = new URL(request.url).origin
  return isLocal(request) ? origin : env.SITE_URL
}

export function toMe(env: Env, u: UserRow): Me {
  return { id: u.id, email: u.email, handle: u.handle, name: u.name, avatar: u.avatar, bio: u.bio, isAdmin: isAdminEmail(env, u.email) }
}
