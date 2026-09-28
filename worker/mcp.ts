import type { BoardRecord } from '@quickdrawjs/core'
import type { IRequest } from 'itty-router'
import { HANDLE_RE } from '../shared/handle'
import type { WireDiff } from '../shared/protocol'
import type { FeedItem } from '../shared/types'
import { readBearer, TOKEN_RE, toMe } from './auth'
import { Db, randomId, toPerson, type UserRow } from './db'
import { board, buildEveryone, buildFeed, profileOf } from './views'

/**
 * An MCP server on the worker, over plain HTTP JSON-RPC (the Streamable HTTP
 * transport, answering each request with JSON: nothing here streams). A
 * personal access token in the path, or a bearer header, says who it acts as.
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

const TOOLS = [
  { name: 'whoami', description: 'The person this key acts as: id, handle, name, bio. Their desktop is at /@handle.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'everyone',
    description:
      'The public room, as /everyone shows it: the newest clumps across every desktop (a clump is things that sit together), each with its Quickdraw records, plus counts of desktops, desktops busy this week and things out right now. Records make it large; pass records:false for the shape of it.',
    inputSchema: { type: 'object', properties: { records: { type: 'boolean', description: 'Include each item\'s Quickdraw record (default true)' } } },
  },
  {
    name: 'desktop',
    description: 'One desktop by handle: its profile (follower counts, live items, last activity) and everything visible on it right now, with records.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'The desktop\'s handle, with or without the @' } }, required: ['handle'] },
  },
  { name: 'feed', description: 'This person\'s feed: what the people they follow (and they) made this week, what is about to vanish, and where everything sits.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'put_items',
    description:
      'Put Quickdraw records on this person\'s own desktop (new or theirs to edit), and/or remove some. A record is { id?, typeName: "shape", type, x, y, rot?, z?, props } as Quickdraw stores it; ids are minted when missing. Returns what landed and what was refused.',
    inputSchema: {
      type: 'object',
      properties: {
        records: { type: 'array', items: { type: 'object' }, description: 'Quickdraw records to put' },
        removed: { type: 'array', items: { type: 'string' }, description: 'Ids to remove (theirs, or anything on their own desktop)' },
      },
    },
  },
  {
    name: 'update_profile',
    description: 'Change this person\'s name or bio.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 40 }, bio: { type: 'string', maxLength: 160 } } },
  },
  { name: 'dev_setup', description: 'How to run the desktop.fyi client locally against the real site with this key, to work on the UI with real data.', inputSchema: { type: 'object', properties: {} } },
]

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

  const token = pathToken && TOKEN_RE.test(pathToken) ? pathToken : readBearer(request)
  if (!token) return fail(null, -32000, 'A personal access token is required: /mcp/<key>, or Authorization: Bearer <key>', 401)
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
        instructions: `You act as @${user.handle ?? user.id} on desktop.fyi. Read anything; write only to their desktop. Call dev_setup to work on the client locally with real data.`,
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
        resources: [{ uri: 'desktop-fyi://dev-setup', name: 'Local development with real data', mimeType: 'text/markdown', description: 'How to run the client locally against the site with this key' }],
      })
    case 'resources/read': {
      if (params.uri !== 'desktop-fyi://dev-setup') return fail(rpc.id, -32002, 'No such resource')
      return reply(rpc.id, { contents: [{ uri: 'desktop-fyi://dev-setup', mimeType: 'text/markdown', text: devSetup(origin) }] })
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

async function callTool(env: Env, d: Db, user: UserRow, origin: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'whoami':
      return text(toMe(env, user))
    case 'everyone': {
      const room = await buildEveryone(env)
      if (args.records === false) {
        return text({ ...room, groups: room.groups.map((g) => ({ ...g, items: g.items.map(({ record, asset, ...rest }) => rest) })) })
      }
      return text(room)
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
    case 'feed':
      return text(await buildFeed(env, user.id))
    case 'put_items': {
      const records = Array.isArray(args.records) ? (args.records as Array<Record<string, unknown>>) : []
      const removed = Array.isArray(args.removed) ? (args.removed as unknown[]).filter((x): x is string => typeof x === 'string') : []
      if (!records.length && !removed.length) throw new Error('Nothing to do: pass records and/or removed')
      const put: Record<string, BoardRecord> = {}
      for (const r of records) {
        if (!r || typeof r !== 'object') throw new Error('Each record must be an object')
        const id = typeof r.id === 'string' && r.id ? r.id : `shape:${randomId(9)}`
        put[id] = { typeName: 'shape', ...r, id } as unknown as BoardRecord
      }
      const diff: WireDiff = { put, removed }
      const result = await board(env, user.id).applyAs(diff, user.id, user.id)
      return text({ ...result, desktop: `${origin}/@${user.handle}` })
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
    case 'dev_setup':
      return text(devSetup(origin))
    default:
      throw new Error(`No tool called ${name}`)
  }
}
