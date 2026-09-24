import type { Person, UserSummary } from '../shared/types'

/** D1 holds what has to be queried across people; boards live in their own Durable Objects. */

export const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,19}$/
export const RESERVED_HANDLES = new Set(['feed', 'login', 'admin', 'api', 'me', 'settings', 'about', 'help', 'new', 'export', 'assets', 'uploads'])

export interface UserRow {
  id: string
  email: string
  handle: string | null
  name: string | null
  avatar: string | null
  created_at: number
  last_login_at: number | null
}

export function toPerson(u: UserRow): Person {
  return { id: u.id, handle: u.handle, name: u.name, avatar: u.avatar }
}

export function toSummary(u: UserRow, isAdmin: boolean): UserSummary {
  return { ...toPerson(u), email: u.email, isAdmin, createdAt: u.created_at, lastLoginAt: u.last_login_at }
}

export function randomId(bytes = 12) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export function base64url(buf: Uint8Array) {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64url(new Uint8Array(digest))
}

export class Db {
  constructor(private d1: D1Database) {}

  // ---- users ----

  userById(id: string) {
    return this.d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
  }

  userByEmail(email: string) {
    return this.d1.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>()
  }

  userByHandle(handle: string) {
    return this.d1.prepare('SELECT * FROM users WHERE handle = ?').bind(handle.toLowerCase()).first<UserRow>()
  }

  async usersByIds(ids: string[]): Promise<UserRow[]> {
    if (!ids.length) return []
    const unique = [...new Set(ids)].slice(0, 200)
    const out: UserRow[] = []
    // D1 caps bound parameters; chunk to stay well under it.
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50)
      const { results } = await this.d1
        .prepare(`SELECT * FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<UserRow>()
      out.push(...results)
    }
    return out
  }

  async ensureUser(email: string): Promise<UserRow> {
    const existing = await this.userByEmail(email)
    if (existing) return existing
    const row: UserRow = { id: randomId(), email, handle: null, name: null, avatar: null, created_at: Date.now(), last_login_at: null }
    await this.d1
      .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind(row.id, row.email, row.created_at)
      .run()
    return row
  }

  /** Returns false when the handle is taken. */
  async updateProfile(id: string, patch: { name?: string; handle?: string }): Promise<boolean> {
    const sets: string[] = []
    const args: unknown[] = []
    if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
    if (patch.handle !== undefined) { sets.push('handle = ?'); args.push(patch.handle) }
    if (!sets.length) return true
    try {
      await this.d1.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run()
      return true
    } catch (e) {
      if (String(e).includes('UNIQUE')) return false
      throw e
    }
  }

  setAvatar(id: string, avatar: string | null) {
    return this.d1.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(avatar, id).run()
  }

  async listUsers(): Promise<UserRow[]> {
    const { results } = await this.d1.prepare('SELECT * FROM users ORDER BY created_at ASC').all<UserRow>()
    return results
  }

  async deleteUser(id: string) {
    await this.d1.batch([
      this.d1.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      this.d1.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').bind(id, id),
      this.d1.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ])
  }

  // ---- login tokens ----

  /** Recent token requests for an email, newest first (for rate limiting). */
  async recentTokenTimes(email: string, since: number): Promise<number[]> {
    const { results } = await this.d1
      .prepare('SELECT created_at FROM login_tokens WHERE email = ? AND created_at > ? ORDER BY created_at DESC')
      .bind(email, since)
      .all<{ created_at: number }>()
    return results.map((r) => r.created_at)
  }

  async createLoginToken(email: string, ttlMs: number): Promise<string> {
    const token = randomId(32)
    const now = Date.now()
    await this.d1.batch([
      this.d1.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 60 * 60 * 1000),
      this.d1
        .prepare('INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(await sha256(token), email, now, now + ttlMs),
    ])
    return token
  }

  /** Consumes the token; returns its email, or null when it is unknown, used or expired. */
  async redeemLoginToken(token: string): Promise<string | null> {
    const hash = await sha256(token)
    const now = Date.now()
    const row = await this.d1
      .prepare('SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?')
      .bind(hash)
      .first<{ email: string; expires_at: number; used_at: number | null }>()
    if (!row || row.used_at !== null || row.expires_at < now) return null
    const res = await this.d1
      .prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
      .bind(now, hash)
      .run()
    if (!res.meta.changes) return null
    return row.email
  }

  // ---- sessions ----

  async createSession(userId: string, ttlMs: number): Promise<string> {
    const id = randomId(32)
    const now = Date.now()
    await this.d1.batch([
      this.d1.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(id), userId, now, now + ttlMs),
      this.d1.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, userId),
    ])
    return id
  }

  async sessionUser(sessionId: string): Promise<UserRow | null> {
    const row = await this.d1
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?')
      .bind(await sha256(sessionId), Date.now())
      .first<UserRow>()
    return row ?? null
  }

  async deleteSession(sessionId: string) {
    await this.d1.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(sessionId)).run()
  }

  // ---- follows ----

  async follow(followerId: string, followeeId: string) {
    await this.d1
      .prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
      .bind(followerId, followeeId, Date.now())
      .run()
  }

  async unfollow(followerId: string, followeeId: string) {
    await this.d1.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(followerId, followeeId).run()
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const row = await this.d1.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?').bind(followerId, followeeId).first()
    return !!row
  }

  async followingIds(userId: string): Promise<string[]> {
    const { results } = await this.d1.prepare('SELECT followee_id FROM follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT 500').bind(userId).all<{ followee_id: string }>()
    return results.map((r) => r.followee_id)
  }

  async followerIds(userId: string): Promise<string[]> {
    const { results } = await this.d1.prepare('SELECT follower_id FROM follows WHERE followee_id = ? ORDER BY created_at DESC LIMIT 500').bind(userId).all<{ follower_id: string }>()
    return results.map((r) => r.follower_id)
  }

  async followCounts(userId: string): Promise<{ followers: number; following: number }> {
    const [a, b] = await this.d1.batch([
      this.d1.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(userId),
      this.d1.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').bind(userId),
    ])
    return { followers: Number((a!.results[0] as { n: number }).n), following: Number((b!.results[0] as { n: number }).n) }
  }
}
