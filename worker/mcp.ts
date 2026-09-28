import { COLOR_IDS, DASH_IDS, FILL_IDS, GEO_IDS, type BoardRecord, type ShapeRecord } from '@quickdrawjs/core'
import type { IRequest } from 'itty-router'
import { HANDLE_RE } from '../shared/handle'
import type { WireDiff } from '../shared/protocol'
import type { FeedItem } from '../shared/types'
import { readBearer, TOKEN_RE, toMe } from './auth'
import { getAssetObjectName } from './assetUploads'
import { Db, randomId, toPerson, type UserRow } from './db'
import { board, buildEveryone, buildFeed, profileOf } from './views'

/**
 * An MCP server on the worker, over plain HTTP JSON-RPC (the Streamable HTTP
 * transport, answering each request with JSON: nothing here streams). A
 * personal access token (?token=, in the path, or a bearer header) says who it acts as.
 * The tools read what that person can read and write only to their own
 * desktop and account. Stateless: every call carries the token.
 */

const PROTOCOL = '2025-06-18'
const SERVER = { name: 'desktop.fyi', version: '1' }

interface Rpc {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

const RECORD = { type: 'object', description: 'A Quickdraw record: { id?, typeName: "shape", type, x, y, rot?, z?, props }. See record_reference.' }

const TOOLS = [
  { name: 'whoami', description: 'The person this key acts as: id, handle, name, bio. Their desktop is at /@handle.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'my_desktop',
    description:
      'Everything on this person\'s own desktop that they can see, their hidden things included: each item\'s Quickdraw record and its bookkeeping (who, when, age in days, pinned). Start here before moving or organizing anything.',
    inputSchema: { type: 'object', properties: { records: { type: 'boolean', description: 'Include each item\'s record (default true)' } } },
  },
  {
    name: 'desktop',
    description: 'Any desktop by handle: its profile (follower counts, live items, last activity) and everything visible on it right now, with records.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'The desktop\'s handle, with or without the @' } }, required: ['handle'] },
  },
  {
    name: 'everyone',
    description:
      'The public room, as /everyone shows it: the newest things across every desktop, each with what it touches, plus counts of desktops, desktops busy this week and things out right now. Records make it large; pass records:false for the shape of it.',
    inputSchema: { type: 'object', properties: { records: { type: 'boolean', description: 'Include each item\'s Quickdraw record (default true)' } } },
  },
  { name: 'feed', description: 'This person\'s feed: what the people they follow (and they) made this week, what is about to vanish, and where everything sits.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'put_items',
    description:
      'Add whole records to this person\'s own desktop, or replace ones they made (a record is whole and last-writer-wins). Ids are minted when missing. For moving or tweaking existing things prefer update_items. Returns what landed and what was refused (someone else\'s, or a picture with no image).',
    inputSchema: { type: 'object', properties: { records: { type: 'array', items: RECORD } }, required: ['records'] },
  },
  {
    name: 'update_items',
    description:
      'Change parts of things this person made, on their own desktop: move (x, y), turn (rot), restack (z), or merge new props (text, color, size, w, h, ...). Anything not given is kept. Moving barely counts as activity; editing text or props keeps a thing fresh. Returns what changed and what was refused.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              rot: { type: 'number' },
              z: { type: 'number' },
              props: { type: 'object', description: 'Merged over the record\'s props' },
            },
            required: ['id'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'remove_items',
    description: 'Take things off this person\'s own desktop: anything they made, and, since it is their desktop, anything a visitor left there.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'keep_items',
    description: 'Keep things so they stop aging (pinned: true), or let them age again (pinned: false). The owner may keep anything on their desktop.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, pinned: { type: 'boolean' } }, required: ['ids', 'pinned'] },
  },
  {
    name: 'freshen_items',
    description: 'Make things fresh again right now (age back to 0) without changing them: for tidying that should not count as new activity, use update_items instead.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'put_image',
    description:
      'Put a picture on this person\'s own desktop from base64 image data (png, jpeg, gif, webp; up to about 4 MB). Give its pixel size (w, h): the worker cannot read it from the bytes. Uploads are named by content, so the same image twice is one upload.',
    inputSchema: {
      type: 'object',
      properties: {
        data_base64: { type: 'string' },
        mime: { type: 'string', description: 'image/png, image/jpeg, image/gif or image/webp' },
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number', description: 'Width on the desktop, page units (pixels at zoom 1)' },
        h: { type: 'number' },
      },
      required: ['data_base64', 'mime', 'x', 'y', 'w', 'h'],
    },
  },
  {
    name: 'update_profile',
    description: 'Change this person\'s name or bio.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 40 }, bio: { type: 'string', maxLength: 160 } } },
  },
  { name: 'record_reference', description: 'What Quickdraw records look like, by type, with the colour, size, font and geometry names: read before put_items.', inputSchema: { type: 'object', properties: {} } },
  { name: 'dev_setup', description: 'How to run the desktop.fyi client locally against the real site with this key, to work on the UI with real data.', inputSchema: { type: 'object', properties: {} } },
]

const RECORD_REFERENCE = `# Quickdraw records, as desktop.fyi stores them

Every thing on a desktop is one record, whole and last-writer-wins. Page units are pixels at zoom 1;
(0, 0) is wherever the person started, so read my_desktop first and place new things near what is there.

Common to every shape: { id, typeName: "shape", type, x, y, rot: 0, z, props }. x, y is the top-left
(for arrows and lines, the start). z orders stacking: higher draws on top; use a larger number than
anything nearby for something new.

  text   props: { text, color, size, font, align: "start" | "middle" | "end", autosize: true, scale: 1 }
         (autosize: false with a numeric w wraps at that width)
  note   props: { text, color: "yellow", size: "m", font, scale: 1 }          a sticky note, 200 square by default
  geo    props: { geo, w, h, color, size, dash, fill, font, label? }          geo: ${GEO_IDS.join(' | ')}
  arrow  props: { dx, dy, bend: 0, headStart: "none", headEnd: "arrow", color, size, dash }
  line   props: { dx, dy, bend: 0, headStart: "none", headEnd: "none", color, size, dash }
  draw   props: { pts: [x0, y0, pressure0, x1, y1, pressure1, ...], color, size, dash }   points relative to x, y
  image  props: { w, h, assetId }  with a second record { id: assetId, typeName: "asset", src, w, h }
         (use put_image, which uploads the bytes and writes both)

Names:
  color  ${COLOR_IDS.join(' | ')}
  size   s | m | l | xl
  font   draw | sans | serif | mono
  dash   ${DASH_IDS.join(' | ')}
  fill   ${FILL_IDS.join(' | ')}

Freshness: a thing ages a day per day; it fades from day 1, hides at day 3 (only its author sees it),
and is archived at day 7. Editing it, or adding something next to it, keeps it (and its neighbours) fresh;
moving barely counts. keep_items pins a thing so it stops aging.`

function devSetup(origin: string) {
  return `# Working on desktop.fyi locally, with real data

The client is a Vite + React app; the server is a Cloudflare Worker. You do not need the server
locally to work on the client: point the dev server at the real site with your key and it acts
as you. Your key reads everything and writes only to your own desktop, so nothing else can be
touched by mistake.

    git clone https://github.com/huttj/desktop.fyi
    cd desktop.fyi && npm install
    DFYI_UPSTREAM=${origin} DFYI_TOKEN=<your key> npm run dev

Then open the printed local URL. /everyone is client/Everyone.tsx (it lays the room out and
draws it on a Quickdraw board); the API it reads is GET /api/everyone (shape: shared/types.ts,
"Everyone"). Every /api call and the board socket go upstream with the key attached.

The REST API, with the key as "Authorization: Bearer <key>":
  GET  /api/me                    who you are
  GET  /api/everyone              the room (public, no key needed; CORS open)
  GET  /api/users/:handle         a profile;  /following, /followers
  GET  /api/feed                  your feed
  POST /api/me                    { name?, bio? }
  WS   /api/connect/:handle       the live board (edits accepted on your own desktop only)

Records are Quickdraw's; the vendored engine is in vendor/quickdraw (read its README there).
Ship a change as a pull request against main.`
}

function reply(id: Rpc['id'], result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }), { headers: { 'content-type': 'application/json' } })
}

function fail(id: Rpc['id'], code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }), { status, headers: { 'content-type': 'application/json' } })
}

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError }
}

export async function handleMcp(request: IRequest, env: Env, _ctx: ExecutionContext, pathToken: string | null): Promise<Response> {
  if (request.method === 'GET') return new Response('This MCP server answers POSTed JSON-RPC; it does not stream.', { status: 405, headers: { allow: 'POST, DELETE' } })
  if (request.method === 'DELETE') return new Response(null, { status: 200 })
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } })

  // The key comes as ?token=, in the path, or as a bearer header: whichever the client can send.
  const query = new URL(request.url).searchParams.get('token')
  const token = [pathToken, query].find((t): t is string => !!t && TOKEN_RE.test(t)) ?? readBearer(request)
  if (!token) return fail(null, -32000, 'A personal access token is required: /mcp?token=<key>, or Authorization: Bearer <key>', 401)
  const d = new Db(env.DB)
  const user = await d.userByApiToken(token)
  if (!user) return fail(null, -32000, 'That key is unknown or revoked', 401)

  let rpc: Rpc
  try {
    rpc = (await request.json()) as Rpc
  } catch {
    return fail(null, -32700, 'Parse error', 400)
  }
  if (Array.isArray(rpc)) return fail(null, -32600, 'One request at a time, please', 400)
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return fail(null, -32600, 'Invalid request', 400)
  const origin = new URL(request.url).origin
  const params = rpc.params ?? {}

  switch (rpc.method) {
    case 'initialize':
      return reply(rpc.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER,
        instructions: `You act as @${user.handle ?? user.id} on desktop.fyi and have their desktop in hand: read anything, and add, move, edit, remove, keep and freshen things on their own desktop only. Read my_desktop and record_reference before changing anything. dev_setup explains working on the client locally with real data.`,
      })
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 })
    case 'ping':
      return reply(rpc.id, {})
    case 'tools/list':
      return reply(rpc.id, { tools: TOOLS })
    case 'resources/list':
      return reply(rpc.id, {
        resources: [
          { uri: 'desktop-fyi://records', name: 'Quickdraw records', mimeType: 'text/markdown', description: 'What each kind of thing on a desktop looks like as a record' },
          { uri: 'desktop-fyi://dev-setup', name: 'Local development with real data', mimeType: 'text/markdown', description: 'How to run the client locally against the site with this key' },
        ],
      })
    case 'resources/read': {
      if (params.uri === 'desktop-fyi://records') return reply(rpc.id, { contents: [{ uri: 'desktop-fyi://records', mimeType: 'text/markdown', text: RECORD_REFERENCE }] })
      if (params.uri === 'desktop-fyi://dev-setup') return reply(rpc.id, { contents: [{ uri: 'desktop-fyi://dev-setup', mimeType: 'text/markdown', text: devSetup(origin) }] })
      return fail(rpc.id, -32002, 'No such resource')
    }
    case 'prompts/list':
      return reply(rpc.id, { prompts: [] })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      try {
        return reply(rpc.id, await callTool(env, d, user, origin, name, args))
      } catch (e) {
        return reply(rpc.id, text(e instanceof Error ? e.message : String(e), true))
      }
    }
    default:
      return fail(rpc.id, -32601, `Unknown method ${rpc.method}`)
  }
}

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : [])
const IMAGE_MAX = 4 * 1024 * 1024
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

async function callTool(env: Env, d: Db, user: UserRow, origin: string, name: string, args: Record<string, unknown>) {
  const mine = () => board(env, user.id)
  const here = `${origin}/@${user.handle}`
  const strip = (items: FeedItem[]) => items.map(({ record, asset, ...rest }) => rest)
  switch (name) {
    case 'whoami':
      return text(toMe(env, user))
    case 'my_desktop': {
      const items = (await mine().itemsFor(user.id)) as FeedItem[]
      const people = (await d.usersByIds([...new Set(items.flatMap((i) => [i.meta.by, i.meta.layer]))])).map(toPerson)
      return text({ desktop: here, items: args.records === false ? strip(items) : items, people })
    }
    case 'desktop': {
      const handle = String(args.handle ?? '').replace(/^@/, '').toLowerCase()
      if (!HANDLE_RE.test(handle)) throw new Error('That is not a handle')
      const target = await d.userByHandle(handle)
      if (!target) throw new Error(`No desktop at @${handle}`)
      const profile = await profileOf(env, target, user)
      const items = (await board(env, target.id).allVisible()) as FeedItem[]
      const people = (await d.usersByIds([...new Set(items.flatMap((i) => [i.meta.by, i.meta.layer]))])).map(toPerson)
      return text({ profile, items, people })
    }
    case 'everyone': {
      const room = await buildEveryone(env)
      if (args.records === false) return text({ ...room, groups: room.groups.map((g) => ({ ...g, items: strip(g.items) })) })
      return text(room)
    }
    case 'feed':
      return text(await buildFeed(env, user.id))
    case 'put_items': {
      const records = Array.isArray(args.records) ? (args.records as Array<Record<string, unknown>>) : []
      if (!records.length) throw new Error('Nothing to put: pass records')
      const put: Record<string, BoardRecord> = {}
      for (const r of records) {
        if (!r || typeof r !== 'object') throw new Error('Each record must be an object')
        const id = typeof r.id === 'string' && r.id ? r.id : `shape:${randomId(9)}`
        put[id] = { typeName: 'shape', rot: 0, z: 1, ...r, id } as unknown as BoardRecord
      }
      const result = await mine().applyAs({ put, removed: [] } satisfies WireDiff, user.id, user.id)
      return text({ ...result, desktop: here })
    }
    case 'update_items': {
      const updates = Array.isArray(args.updates) ? (args.updates as Array<Record<string, unknown>>) : []
      if (!updates.length) throw new Error('Nothing to update: pass updates')
      const put: Record<string, BoardRecord> = {}
      const refused: Array<{ id: string; why: string }> = []
      for (const u of updates) {
        const id = typeof u.id === 'string' ? u.id : ''
        const found = id ? ((await mine().recordOf(id)) as { record: BoardRecord; author: string } | null) : null
        if (!found) {
          refused.push({ id, why: 'no such thing on your desktop' })
          continue
        }
        if (found.author !== user.id) {
          refused.push({ id, why: 'someone else made it: you may remove it, not change it' })
          continue
        }
        const rec = found.record as ShapeRecord
        const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
        const props = u.props && typeof u.props === 'object' ? { ...rec.props, ...(u.props as Record<string, unknown>) } : rec.props
        put[id] = { ...rec, x: num(u.x, rec.x), y: num(u.y, rec.y), rot: num(u.rot, rec.rot), z: num(u.z, rec.z), props } as unknown as BoardRecord
      }
      const result = Object.keys(put).length ? await mine().applyAs({ put, removed: [] } satisfies WireDiff, user.id, user.id) : { accepted: { put: {}, removed: [] }, rejected: [] }
      return text({ changed: Object.keys(result.accepted.put), refused: [...refused, ...result.rejected.map((id) => ({ id, why: 'not accepted' }))], desktop: here })
    }
    case 'remove_items': {
      const removed = ids(args.ids)
      if (!removed.length) throw new Error('Nothing to remove: pass ids')
      const result = await mine().applyAs({ put: {}, removed } satisfies WireDiff, user.id, user.id)
      return text({ removed: result.accepted.removed, refused: result.rejected, desktop: here })
    }
    case 'keep_items':
    case 'freshen_items': {
      const list = ids(args.ids)
      if (!list.length) throw new Error('Pass ids')
      const what = name === 'keep_items' ? { pinned: args.pinned !== false } : { freshen: true }
      const metas = await mine().markAs(list, user.id, what)
      const done = Object.keys(metas)
      const verb = name === 'keep_items' ? (what.pinned ? 'kept' : 'released') : 'freshened'
      return text({ verb, done, refused: list.filter((id) => !done.includes(id)) })
    }
    case 'put_image': {
      const mime = String(args.mime ?? '')
      const ext = IMAGE_EXT[mime]
      if (!ext) throw new Error('mime must be image/png, image/jpeg, image/gif or image/webp')
      const b64 = String(args.data_base64 ?? '').replace(/^data:[^,]*,/, '')
      let bytes: Uint8Array<ArrayBuffer>
      try {
        const raw = atob(b64)
        bytes = new Uint8Array(new ArrayBuffer(raw.length))
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      } catch {
        throw new Error('data_base64 is not valid base64')
      }
      if (!bytes.length) throw new Error('The image is empty')
      if (bytes.length > IMAGE_MAX) throw new Error('That image is too large (4 MB at most)')
      const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((k) => Number(args[k]))
      if (![x, y, w, h].every(Number.isFinite) || w! <= 0 || h! <= 0) throw new Error('x, y, w and h are required numbers')
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      const hash = Array.from(digest.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('')
      const uploadId = `${hash}.${ext}`
      const objectName = getAssetObjectName(uploadId)
      if (!(await env.UPLOADS.head(objectName))) await env.UPLOADS.put(objectName, bytes, { httpMetadata: { contentType: mime } })
      const assetId = `asset:${randomId(9)}`
      const shapeId = `shape:${randomId(9)}`
      const put: Record<string, BoardRecord> = {
        [assetId]: { id: assetId, typeName: 'asset', src: `/api/uploads/${uploadId}`, w, h } as unknown as BoardRecord,
        [shapeId]: { id: shapeId, typeName: 'shape', type: 'image', x, y, rot: 0, z: 1, props: { w, h, assetId } } as unknown as BoardRecord,
      }
      const result = await mine().applyAs({ put, removed: [] } satisfies WireDiff, user.id, user.id)
      return text({ ...result, image: `${origin}/api/uploads/${uploadId}`, desktop: here })
    }
    case 'update_profile': {
      const patch: { name?: string; bio?: string | null } = {}
      if (typeof args.name === 'string') {
        const n = args.name.trim().replace(/\s+/g, ' ').slice(0, 40)
        if (!n) throw new Error('Name is required')
        patch.name = n
      }
      if (typeof args.bio === 'string') patch.bio = args.bio.trim().replace(/\s+/g, ' ').slice(0, 160) || null
      if (!Object.keys(patch).length) throw new Error('Nothing to change: pass name and/or bio')
      await d.updateProfile(user.id, patch)
      return text(toMe(env, { ...user, ...patch }))
    }
    case 'record_reference':
      return text(RECORD_REFERENCE)
    case 'dev_setup':
      return text(devSetup(origin))
    default:
      throw new Error(`No tool called ${name}`)
  }
}
