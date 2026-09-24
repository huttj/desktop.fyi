import { AutoRouter, error, IRequest, json, RequestHandler } from 'itty-router'
import { getAssetObjectName, handleAssetDownload, handleAssetUpload } from './assetUploads'
import { clearSessionCookie, getSessionUser, isAdminEmail, isLocal, publicOrigin, readCookie, SESSION_COOKIE, SESSION_TTL_MS, sessionCookie, TOKEN_TTL_MS } from './auth'
import { BoardDurableObject, OWNER_HEADER, USER_HEADER } from './BoardDurableObject'
import { Db, HANDLE_RE, RESERVED_HANDLES, toPerson, toSummary, type UserRow } from './db'
import { sendMagicLink } from './email'
import { DAY_MS } from '../shared/freshness'
import type { DesktopStats, Feed, FeedItem, Me, Person, Profile } from '../shared/types'

export { BoardDurableObject } from './BoardDurableObject'

type Args = [env: Env, ctx: ExecutionContext]
type AuthedRequest = IRequest & { user: UserRow }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AVATAR_MAX_BYTES = 512 * 1024
const TOKEN_MIN_INTERVAL_MS = 30 * 1000
const TOKENS_PER_HOUR = 6
const FEED_WINDOW_MS = 7 * DAY_MS

async function readJson<T>(request: IRequest): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>
  } catch {
    return {}
  }
}

function db(env: Env) {
  return new Db(env.DB)
}

function board(env: Env, ownerId: string) {
  const ns = env.BOARD as DurableObjectNamespace<BoardDurableObject>
  return ns.get(ns.idFromName(ownerId))
}

/** Middleware: attach the signed-in user or bail with 401. */
const requireAuth: RequestHandler<IRequest, Args> = async (request, env) => {
  const user = await getSessionUser(request, env)
  if (!user) return error(401, 'Sign in required')
  ;(request as AuthedRequest).user = user
}

const requireAdmin: RequestHandler<IRequest, Args> = async (request, env, ctx) => {
  const denied = await requireAuth(request, env, ctx)
  if (denied) return denied
  if (!isAdminEmail(env, (request as AuthedRequest).user.email)) return error(403, 'Admins only')
}

function toMe(env: Env, u: UserRow): Me {
  return { id: u.id, email: u.email, handle: u.handle, name: u.name, avatar: u.avatar, bio: u.bio, isAdmin: isAdminEmail(env, u.email) }
}

async function resolveHandle(env: Env, raw: string): Promise<UserRow | null> {
  const handle = decodeURIComponent(raw).replace(/^@/, '').toLowerCase()
  if (!HANDLE_RE.test(handle)) return null
  return db(env).userByHandle(handle)
}

const router = AutoRouter<IRequest, Args>({
  catch: (e) => {
    console.error(e)
    return error(e)
  },
})
  // ---- auth ----
  // Anyone may sign in; a first sign-in creates the account.
  .post('/api/auth/request', async (request, env) => {
    const body = await readJson<{ email: string }>(request)
    const email = (body.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email) || email.length > 254) return error(400, 'That does not look like an email address')

    const d = db(env)
    const now = Date.now()
    const recent = await d.recentTokenTimes(email, now - 60 * 60 * 1000)
    if (recent[0] !== undefined && now - recent[0] < TOKEN_MIN_INTERVAL_MS) {
      return error(429, `A link was just sent. Try again in ${Math.ceil((TOKEN_MIN_INTERVAL_MS - (now - recent[0])) / 1000)}s.`)
    }
    if (recent.length >= TOKENS_PER_HOUR) return error(429, 'Too many links requested. Try again in an hour.')

    const token = await d.createLoginToken(email, TOKEN_TTL_MS)
    const link = `${publicOrigin(request, env)}/api/auth/verify?token=${encodeURIComponent(token)}`
    if (isLocal(request)) {
      // Local dev never sends mail: the link is in the wrangler console.
      console.log(`[dev] magic link for ${email}: ${link}`)
      return json({ ok: true })
    }
    try {
      await sendMagicLink(env, email, link)
    } catch (e) {
      console.error('email send failed', e)
      return error(502, 'Could not send the email. Try again in a minute.')
    }
    return json({ ok: true })
  })

  .get('/api/auth/verify', async (request, env) => {
    const token = typeof request.query.token === 'string' ? request.query.token : ''
    const origin = publicOrigin(request, env)
    if (!token) return Response.redirect(`${origin}/login?login=invalid`, 302)
    const d = db(env)
    const email = await d.redeemLoginToken(token)
    if (!email) return Response.redirect(`${origin}/login?login=invalid`, 302)
    const user = await d.ensureUser(email)
    const sessionId = await d.createSession(user.id, SESSION_TTL_MS)
    return new Response(null, {
      status: 302,
      headers: { location: `${origin}/`, 'set-cookie': sessionCookie(sessionId, request) },
    })
  })

  .post('/api/auth/logout', async (request, env) => {
    const sessionId = readCookie(request, SESSION_COOKIE)
    if (sessionId) await db(env).deleteSession(sessionId)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json', 'set-cookie': clearSessionCookie(request) },
    })
  })

  // ---- me ----
  .get('/api/me', requireAuth, (request, env) => json(toMe(env, (request as AuthedRequest).user)))

  .post('/api/me', requireAuth, async (request, env) => {
    const user = (request as AuthedRequest).user
    const body = await readJson<{ name: string; handle: string; bio: string | null }>(request)
    const patch: { name?: string; handle?: string; bio?: string | null } = {}
    if (body.name !== undefined) {
      const name = body.name.trim().replace(/\s+/g, ' ').slice(0, 40)
      if (name.length < 1) return error(400, 'Name is required')
      patch.name = name
    }
    if (body.bio !== undefined) {
      const bio = (body.bio ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)
      patch.bio = bio || null
    }
    if (body.handle !== undefined) {
      // A handle is chosen once: it is the desktop's address.
      if (user.handle && body.handle.trim().toLowerCase() !== user.handle) return error(400, 'Handles cannot be changed')
      const handle = body.handle.trim().toLowerCase()
      if (!HANDLE_RE.test(handle)) return error(400, 'Handles are 2 to 20 letters, digits or underscores')
      if (RESERVED_HANDLES.has(handle)) return error(400, 'That handle is reserved')
      patch.handle = handle
    }
    const ok = await db(env).updateProfile(user.id, patch)
    if (!ok) return error(409, 'That handle is taken')
    return json(toMe(env, { ...user, ...patch }))
  })

  .post('/api/me/avatar', requireAuth, async (request, env) => {
    const user = (request as AuthedRequest).user
    const contentType = request.headers.get('content-type') ?? ''
    if (!/^image\/(png|jpeg|webp)$/.test(contentType)) return error(400, 'Send a PNG, JPEG or WebP image')
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength === 0) return error(400, 'Empty image')
    if (bytes.byteLength > AVATAR_MAX_BYTES) return error(413, 'That photo is too large')
    const uploadId = `avatar-${user.id}-${Date.now().toString(36)}`
    await env.UPLOADS.put(getAssetObjectName(uploadId), bytes, { httpMetadata: { contentType } })
    const avatar = `/api/uploads/${uploadId}`
    await db(env).setAvatar(user.id, avatar)
    return json(toMe(env, { ...user, avatar }))
  })

  .delete('/api/me/avatar', requireAuth, async (request, env) => {
    const user = (request as AuthedRequest).user
    await db(env).setAvatar(user.id, null)
    return json(toMe(env, { ...user, avatar: null }))
  })

  /** The data request: everything on your desktop, archive included, plus your profile and graph. */
  .get('/api/me/export', requireAuth, async (request, env) => {
    const user = (request as AuthedRequest).user
    const d = db(env)
    const [desktop, following, followers] = await Promise.all([board(env, user.id).exportAll(), d.followingIds(user.id), d.followerIds(user.id)])
    const people = await d.usersByIds([...following, ...followers])
    const body = JSON.stringify({ profile: toMe(env, user), following, followers, people: people.map(toPerson), desktop }, null, 2)
    return new Response(body, {
      headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="desktop-fyi-${user.handle ?? user.id}.json"` },
    })
  })

  // ---- people ----
  .get('/api/users', async (request, env) => {
    const raw = typeof request.query.ids === 'string' ? request.query.ids : ''
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
    const people: Person[] = (await db(env).usersByIds(ids)).map(toPerson)
    return json(people)
  })

  .get('/api/users/search', requireAuth, async (request, env) => {
    const q = typeof request.query.q === 'string' ? request.query.q.slice(0, 40) : ''
    const people: Person[] = (await db(env).searchUsers(q)).map(toPerson)
    return json(people)
  })

  .get('/api/users/:handle', async (request, env) => {
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    const d = db(env)
    const viewer = await getSessionUser(request, env)
    const [counts, summary, isFollowing, followsYou] = await Promise.all([
      d.followCounts(target.id),
      board(env, target.id).summary(),
      viewer ? d.isFollowing(viewer.id, target.id) : Promise.resolve(undefined),
      viewer ? d.isFollowing(target.id, viewer.id) : Promise.resolve(undefined),
    ])
    const profile: Profile = { ...toPerson(target), ...counts, liveItems: summary.liveItems, lastActivityAt: summary.lastActivityAt }
    if (viewer) {
      profile.isFollowing = isFollowing
      profile.followsYou = followsYou
    }
    return json(profile)
  })

  /** Viewer stats: the desktop's owner (or an admin) only. */
  .get('/api/users/:handle/stats', requireAuth, async (request, env) => {
    const me = (request as AuthedRequest).user
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    if (target.id !== me.id && !isAdminEmail(env, me.email)) return error(403, 'Only the owner can see this')
    const stats: DesktopStats = await board(env, target.id).stats()
    return json(stats)
  })

  .get('/api/users/:handle/following', async (request, env) => {
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    const d = db(env)
    return json((await d.usersByIds(await d.followingIds(target.id))).map(toPerson))
  })

  .get('/api/users/:handle/followers', async (request, env) => {
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    const d = db(env)
    return json((await d.usersByIds(await d.followerIds(target.id))).map(toPerson))
  })

  .post('/api/users/:handle/follow', requireAuth, async (request, env) => {
    const me = (request as AuthedRequest).user
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    if (target.id === me.id) return error(400, 'You already have your own desktop')
    await db(env).follow(me.id, target.id)
    return json({ ok: true })
  })

  .delete('/api/users/:handle/follow', requireAuth, async (request, env) => {
    const me = (request as AuthedRequest).user
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    await db(env).unfollow(me.id, target.id)
    return json({ ok: true })
  })

  // ---- feed ----
  // Fan out to the desktops you follow (and your own). Boards are the source of
  // truth for freshness, so nothing here is cached or indexed elsewhere.
  .get('/api/feed', requireAuth, async (request, env) => {
    const me = (request as AuthedRequest).user
    const d = db(env)
    const following = await d.followingIds(me.id)
    const since = Date.now() - FEED_WINDOW_MS
    const boards = [me.id, ...following]
    const results = await Promise.all(
      boards.map(async (id) => {
        const stub = board(env, id)
        try {
          const [recent, vanishing] = await Promise.all([stub.activity(since, 30), stub.vanishing(id === me.id ? me.id : null, 30)])
          return { recent, vanishing }
        } catch (e) {
          console.warn('feed: board unavailable', id, e)
          return { recent: [] as FeedItem[], vanishing: [] as FeedItem[] }
        }
      })
    )
    const recent = results.flatMap((r) => r.recent).sort((a, b) => b.meta.editedAt - a.meta.editedAt).slice(0, 120)
    const vanishing = results.flatMap((r) => r.vanishing).sort((a, b) => b.age - a.age).slice(0, 80)
    const ids = new Set<string>()
    for (const item of [...recent, ...vanishing]) {
      ids.add(item.boardId)
      ids.add(item.meta.by)
      ids.add(item.meta.layer)
      ids.add(item.meta.editedBy)
    }
    for (const id of following) ids.add(id)
    const people: Person[] = (await d.usersByIds([...ids])).map(toPerson)
    const feed: Feed = { recent, vanishing, people }
    return json(feed)
  })

  // ---- admin ----
  .get('/api/admin/users', requireAdmin, async (_request, env) => json((await db(env).listUsers()).map((u) => toSummary(u, isAdminEmail(env, u.email)))))

  .delete('/api/admin/users/:id', requireAdmin, async (request, env) => {
    const d = db(env)
    const target = await d.userById(request.params.id)
    if (!target) return error(404, 'Not found')
    if (isAdminEmail(env, target.email)) return error(400, 'Admins cannot be removed here')
    await board(env, target.id).wipe()
    await d.deleteUser(target.id)
    return json({ ok: true })
  })

  .post('/api/admin/boards/:handle/run', requireAdmin, async (request, env) => {
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    return json(await board(env, target.id).runNow())
  })

  // ---- desktop sync (websocket) ----
  // Anyone can connect and watch. Only signed-in people get a writable session;
  // the room enforces that server-side, so a modified client cannot edit either.
  .get('/api/connect/:handle', async (request, env) => {
    const owner = await resolveHandle(env, request.params.handle)
    if (!owner) return error(404, 'No such desktop')
    const user = await getSessionUser(request, env)
    const headers = new Headers(request.headers)
    headers.set(OWNER_HEADER, owner.id)
    if (user) headers.set(USER_HEADER, user.id)
    else headers.delete(USER_HEADER)
    return board(env, owner.id).fetch(request.url, { headers, body: request.body })
  })

  // ---- assets ----
  .post('/api/uploads/:uploadId', requireAuth, handleAssetUpload)
  .get('/api/uploads/:uploadId', handleAssetDownload)

  .all('/api/*', () => error(404, 'Not found'))

  // ---- app shell for desktop addresses ----
  // "/@handle" never reaches the asset router (it would 307 to "/%40handle"):
  // hand back the SPA entry and let the client route it.
  .get('/@:handle', (request, env) => {
    if (!HANDLE_RE.test(request.params.handle.toLowerCase())) return undefined // not a desktop: fall through
    return env.ASSETS.fetch(new URL('/', request.url).toString(), { headers: request.headers })
  })
  // Anything else that reached the worker (in dev, Vite's own "/@vite/..." module URLs) goes back to the assets.
  .all('*', (request, env) => env.ASSETS.fetch(request.url, { headers: request.headers }))

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>
