import { AutoRouter, error, IRequest, json, RequestHandler } from 'itty-router'
import { getAssetObjectName, handleAssetDownload, handleAssetUpload, handleMediaFetch } from './assetUploads'
import { clearSessionCookie, getAuth, getSessionUser, isAdminEmail, isLocal, publicOrigin, readCookie, SESSION_COOKIE, SESSION_TTL_MS, sessionCookie, toMe, TOKEN_TTL_MS } from './auth'
import { OWNER_HEADER, USER_HEADER } from './BoardDurableObject'
import { Db, HANDLE_RE, RESERVED_HANDLES, toPerson, toSummary, type UserRow } from './db'
import { sendMagicLink } from './email'
import { handleMcp } from './mcp'
import { board, buildEveryone, buildFeed, profileOf } from './views'
import type { DesktopStats, Person, Revision } from '../shared/types'

export { BoardDurableObject } from './BoardDurableObject'

type Args = [env: Env, ctx: ExecutionContext]
type AuthedRequest = IRequest & { user: UserRow; viaToken: boolean }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AVATAR_MAX_BYTES = 512 * 1024
const TOKEN_MIN_INTERVAL_MS = 30 * 1000
const TOKENS_PER_HOUR = 6
const EVERYONE_TTL_S = 60

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

/** Middleware: attach the signed-in user (by session, or by a personal access token) or bail with 401. */
const requireAuth: RequestHandler<IRequest, Args> = async (request, env) => {
  const auth = await getAuth(request, env)
  if (!auth) return error(401, 'Sign in required')
  ;(request as AuthedRequest).user = auth.user
  ;(request as AuthedRequest).viaToken = auth.viaToken
}

/** Middleware: a person at the site itself, not a token acting for them (keys manage keys, admins administer). */
const requireSession: RequestHandler<IRequest, Args> = async (request, env, ctx) => {
  const denied = await requireAuth(request, env, ctx)
  if (denied) return denied
  if ((request as AuthedRequest).viaToken) return error(403, 'Not with an API key: do this signed in at the site')
}

const requireAdmin: RequestHandler<IRequest, Args> = async (request, env, ctx) => {
  const denied = await requireSession(request, env, ctx)
  if (denied) return denied
  if (!isAdminEmail(env, (request as AuthedRequest).user.email)) return error(403, 'Admins only')
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
      // The handle is the desktop's address. It can change, but the old address simply
      // stops resolving (and is free for anyone to take): the client says so before saving.
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

  // ---- personal access tokens ----
  // A token acts as its person: reads everything they can, writes to their own desktop and
  // account only. Minted and revoked here, signed in at the site; the secret shows once.
  .get('/api/me/tokens', requireSession, async (request, env) => json(await db(env).listApiTokens((request as AuthedRequest).user.id)))

  .post('/api/me/tokens', requireSession, async (request, env) => {
    const user = (request as AuthedRequest).user
    const body = await readJson<{ label: string }>(request)
    const label = (body.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'API key'
    const d = db(env)
    if ((await d.listApiTokens(user.id)).length >= 10) return error(400, 'Ten keys is plenty: revoke one first')
    return json(await d.createApiToken(user.id, label))
  })

  .delete('/api/me/tokens/:id', requireSession, async (request, env) => {
    const ok = await db(env).revokeApiToken((request as AuthedRequest).user.id, request.params.id)
    if (!ok) return error(404, 'No such key')
    return json({ ok: true })
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
    return json(await profileOf(env, target, await getSessionUser(request, env)))
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

  /** Earlier states of one item: its author or the desktop's owner may page through them. */
  .get('/api/users/:handle/items/:id/history', requireAuth, async (request, env) => {
    const me = (request as AuthedRequest).user
    const target = await resolveHandle(env, request.params.handle)
    if (!target) return error(404, 'No such desktop')
    const id = decodeURIComponent(request.params.id)
    const stub = board(env, target.id)
    const author = await stub.authorOf(id)
    if (!author) return error(404, 'No such item')
    if (author !== me.id && target.id !== me.id && !isAdminEmail(env, me.email)) return error(403, 'Only its author or the desktop owner can see this')
    const history: Revision[] = await stub.history(id)
    return json(history)
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
  .get('/api/feed', requireAuth, async (request, env) => json(await buildFeed(env, (request as AuthedRequest).user.id)))

  // ---- everyone ----
  // The newest clumps across every desktop, for the public room at /everyone. It fans
  // out to every board, so the answer is cached for a minute per edge location.
  .get('/api/everyone', async (request, env, ctx) => {
    const cache = caches.default
    const key = new Request(new URL('/api/everyone', request.url).toString())
    const hit = await cache.match(key)
    if (hit) return hit
    const res = new Response(JSON.stringify(await buildEveryone(env)), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${EVERYONE_TTL_S}`, 'access-control-allow-origin': '*' },
    })
    ctx.waitUntil(cache.put(key, res.clone()))
    return res
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
    const auth = await getAuth(request, env)
    // a token writes to its own desktop only: anywhere else it is a visitor looking on
    const user = auth && (!auth.viaToken || auth.user.id === owner.id) ? auth.user : null
    const headers = new Headers(request.headers)
    headers.set(OWNER_HEADER, owner.id)
    if (user) headers.set(USER_HEADER, user.id)
    else headers.delete(USER_HEADER)
    return board(env, owner.id).fetch(request.url, { headers, body: request.body })
  })

  // ---- assets ----
  .post('/api/uploads/:uploadId', requireAuth, handleAssetUpload)
  .get('/api/uploads/:uploadId', handleAssetDownload)
  .get('/api/fetch-media', requireAuth, handleMediaFetch)

  .all('/api/*', () => error(404, 'Not found'))

  // ---- MCP ----
  // The same token, as a pasteable link: an MCP server for Claude (and friends) that reads
  // everything and writes to the token's own desktop. `/mcp` with a bearer header works too.
  .all('/mcp/:token', (request, env, ctx) => handleMcp(request, env, ctx, request.params.token))
  .all('/mcp', (request, env, ctx) => handleMcp(request, env, ctx, null))

  // ---- app shell for desktop addresses ----
  // "/@handle" never reaches the asset router (it would 307 to "/%40handle"):
  // hand back the SPA entry and let the client route it.
  .get('/@:handle', async (request, env) => {
    if (!HANDLE_RE.test(request.params.handle.toLowerCase())) return undefined // not a desktop: fall through
    const res = await env.ASSETS.fetch(new URL('/', request.url).toString(), { headers: request.headers })
    // The shell must never go stale: its script and style names change with every deploy.
    const headers = new Headers(res.headers)
    headers.set('cache-control', 'no-cache')
    return new Response(res.body, { status: res.status, headers })
  })
  // Anything else that reached the worker (in dev, Vite's own "/@vite/..." module URLs) goes back to the assets.
  .all('*', (request, env) => env.ASSETS.fetch(request.url, { headers: request.headers }))

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>
