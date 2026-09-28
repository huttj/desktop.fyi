import { COLOR_IDS, DASH_IDS, FILL_IDS, GEO_IDS, rebindArrow, type BoardRecord, type ShapeRecord } from '@quickdrawjs/core'
import type { IRequest } from 'itty-router'
import { approxBounds, gapBetween, type Box } from '../shared/bounds'
import { layoutGraph, type GraphSpec } from '../shared/graph'
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
      'Everything on this person\'s own desktop that they can see, their hidden things included: each item\'s Quickdraw record, its bounds { x, y, w, h } on the desktop, and its bookkeeping (who, when, age in days, pinned), plus the extent of it all. Start here before adding, moving or organizing anything.',
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
      'Add whole records to this person\'s own desktop, or replace ones they made (a record is whole and last-writer-wins). Ids are minted when missing. For moving or tweaking existing things prefer update_items. Returns what landed with its bounds and anything it now overlaps, and what was refused (someone else\'s, or a picture with no image). Use find_space first so nothing lands on top of something.',
    inputSchema: { type: 'object', properties: { records: { type: 'array', items: RECORD } }, required: ['records'] },
  },
  {
    name: 'update_items',
    description:
      'Change parts of things this person made, on their own desktop: move (x, y), turn (rot), restack (z), or merge new props (text, color, size, w, h, ...). Anything not given is kept, as it is now, not as you last saw it. Pass expect: { x, y } when a move depends on where the thing was, and it is refused if someone moved it since. Moving barely counts as activity; editing text or props keeps a thing fresh. Returns what changed and what was refused.',
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
              expect: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Where you believe it is; refused (with where it is now) if it has moved since' },
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
  {
    name: 'changes_since',
    description:
      'What changed on this person\'s own desktop since a time (ms since the epoch: the `now` from your last result): things made, edited or moved, as they stand now with bounds, and ids of things removed. People rearrange while you work: call this before adding near or changing anything you read earlier.',
    inputSchema: { type: 'object', properties: { since: { type: 'number' } }, required: ['since'] },
  },
  {
    name: 'measure_items',
    description:
      'The space records would take on the desktop, without placing them: each one\'s bounds { x, y, w, h } in page units. Notes and text grow with their words (a note is 200 wide and gets tall), so measure before you lay things out.',
    inputSchema: { type: 'object', properties: { records: { type: 'array', items: RECORD } }, required: ['records'] },
  },
  {
    name: 'find_space',
    description:
      'An empty spot on this person\'s own desktop for something w by h, as near as possible to `near` (default: the middle of what is there, or the origin). Returns { x, y } for its top-left, clear of everything visible by `gap` (default 40). Ask for one spot per thing, placing as you go, or pass `avoid` with the bounds you have already claimed.',
    inputSchema: {
      type: 'object',
      properties: {
        w: { type: 'number' },
        h: { type: 'number' },
        near: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        gap: { type: 'number' },
        avoid: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } }, description: 'Extra boxes to keep clear of, e.g. spots you were just given but have not placed yet' },
      },
      required: ['w', 'h'],
    },
  },
  {
    name: 'layout_graph',
    description:
      'Lay out a zoned diagram properly and put it on this person\'s desktop: zones side by side (wrapping to rows), each a dashed titled box with its nodes in a grid, every node a box sized to fit its label; edges become arrows tied to both ends (they follow their nodes) and settled on the boxes\' edges, with captions beside the line where it is clear, else in a legend under the diagram. Placed in empty space near what is there unless `at` is given. Returns the node name → id map and the bounds, or the records without placing when place:false.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        zones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              color: { type: 'string' },
              columns: { type: 'number' },
              nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, geo: { type: 'string' }, color: { type: 'string' } }, required: ['id', 'label'] } },
            },
            required: ['nodes'],
          },
        },
        edges: {
          type: 'array',
          items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' }, dashed: { type: 'boolean' }, head: { type: 'string', enum: ['arrow', 'none', 'both'] } }, required: ['from', 'to'] },
        },
        caption: { type: 'string' },
        maxWidth: { type: 'number', description: 'How wide a row of zones may run before wrapping (default 1600)' },
        at: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Top-left; default: an empty spot near the existing things' },
        place: { type: 'boolean', description: 'Put it on the desktop (default true); false returns the records instead' },
      },
      required: ['zones'],
    },
  },
  {
    name: 'connect_items',
    description:
      'Draw an arrow from one thing to another on this person\'s desktop, tied to both so it follows them when they move, with an optional caption carried on the arrow itself. This is how to connect boxes: an arrow merely drawn near them is not connected.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Record id' },
        to: { type: 'string', description: 'Record id' },
        label: { type: 'string' },
        color: { type: 'string' },
        dashed: { type: 'boolean' },
        head: { type: 'string', enum: ['arrow', 'none', 'both'] },
      },
      required: ['from', 'to'],
    },
  },
  { name: 'record_reference', description: 'What Quickdraw records look like, by type, with the colour, size, font and geometry names, and how big things come out: read before put_items.', inputSchema: { type: 'object', properties: {} } },
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
  geo    props: { geo, w, h, color, size, dash, fill, font, label?, labelSize? }   geo: ${GEO_IDS.join(' | ')}
  any shape may carry groupId (a shared string): grouped things are one piece
  arrow  props: { dx, dy, bend: 0, headStart: "none", headEnd: "arrow", color, size, dash, label?, labelSize? }
  line   props: { dx, dy, bend: 0, headStart: "none", headEnd: "none", color, size, dash, label?, labelSize? }
         (a label rides the middle of the line on a little plate of background, and moves with it)
  draw   props: { pts: [x0, y0, pressure0, x1, y1, pressure1, ...], color, size, dash }   points relative to x, y
  image  props: { w, h, assetId }  with a second record { id: assetId, typeName: "asset", src, w, h }
         (use put_image, which uploads the bytes and writes both)

Names:
  color  ${COLOR_IDS.join(' | ')}
  size   s | m | l | xl
  font   draw | sans | serif | mono
  dash   ${DASH_IDS.join(' | ')}
  fill   ${FILL_IDS.join(' | ')}

What each kind is for (a desktop reads like a desk, not a slide):
  text   the workhorse: headings (size l or xl), captions, and paragraphs. For a paragraph or a column of prose use
         autosize: false with w around 320 to 420 so it wraps; a heading is one short line with autosize: true.
  note   a sticky: a remark of a sentence or three stuck beside something (a comment, a to-do, an aside). Its colour
         is part of the message (yellow default; light-red for a warning, light-green for done, blue for a question).
         Not for essays, tables or columns of content: that is what text is for.
  geo    a box or zone (rectangle, ellipse, ...) to frame or group things; fill: semi tints it. A short label (a word
         or a line: props.label, optional labelSize s | m | l) wraps and centres inside it, right for a title or a node.
         For a paragraph, a list or anything with its own alignment, do not stuff the label: put a text block on top
         of the box and group them. Same groupId on both, box at a lower z, text inside the box's bounds with about
         16 of padding, box sized from measure_items of the text plus that padding. Grouped, they select, move,
         feed and show as one thing.
  arrow  a connection between two things, from one to another (headEnd: "arrow"); tie its ends with startBind /
         endBind: { id, nx: 0.5, ny: 0.5 } so it follows them when they move, and caption it with props.label
         rather than a text floated beside it. line is the same without a head.
  image  a picture, through put_image.
  A layout is a heading, then things laid out under and beside it with a little air between them; stickies go
  next to what they comment on. Read my_desktop first: place new work near the person's existing things, in
  empty space (find_space), never on top of them.

How big things come out (page units, pixels at zoom 1):
  text   one line is about 0.55 × font size per character (size s 18, m 24, l 36, xl 44), lines 1.32 × font size tall;
         with autosize: true a line runs as long as its text, so break long text with newlines or set autosize: false and a w
  note   200 wide (props.w to change) and as tall as its words need at about 14 characters a line: a paragraph makes a
         tall note. Keep a note under ~40 words; for more, use a text record with autosize: false and w: 320 or so.
  geo, image  exactly props.w × props.h
Plan a layout with measure_items, claim spots with find_space, and read the bounds and overlaps that put_items returns.
Things you place near each other are one clump to the feed and the room; leave a little air (40 or more) between
things that should read apart.

Diagrams: use layout_graph for anything with zones, nodes and edges; it sizes boxes to their labels, spaces them,
ties the arrows and keeps captions off the lines. To join two things already on the desktop use connect_items.
An arrow drawn between two boxes without startBind / endBind is not connected: it stays put when they move.
Keep node labels short (a name, up to about five words); explanations go in a text block beside the diagram.

The desktop is live. The person (and their visitors) move, edit and remove things while you work, and every
result you get is a snapshot with a \`now\`. Before you add next to something or change it, look again:
changes_since(now) is cheap and tells you what moved, changed or vanished; my_desktop is the whole picture.
update_items merges into a thing as it is now, so a move you computed from an old position can land in the
wrong place: pass expect: { x, y } and it will refuse, telling you where the thing is, if it has moved.

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

/** A tool result. Objects carry `now`, the server's clock, to hand back to changes_since later. */
function text(value: unknown, isError = false) {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>), now: Date.now() } : value
  return { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body, null, 2) }], isError }
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
        instructions: `You act as @${user.handle ?? user.id} on desktop.fyi and have their desktop in hand: read anything, and add, move, edit, remove, keep and freshen things on their own desktop only. Read my_desktop and record_reference before changing anything. The desktop is live and shared: people move things while you work, so before adding near or changing something you read earlier, look again (changes_since with the \`now\` from your last result, or my_desktop), and pass expect on moves that depend on where a thing was. dev_setup explains working on the client locally with real data.`,
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
  const apply = (diff: WireDiff, userId: string, layer: string) => mine().applyAs(diff, userId, layer) as unknown as Promise<{ accepted: WireDiff; rejected: string[] }>
  /** Items with their bounds on the desktop, and the extent of them all. */
  const placed = (items: FeedItem[]) => {
    const withBounds = items.map((i) => ({ ...i, bounds: i.record ? approxBounds(i.record as BoardRecord) : null }))
    let extent: Box | null = null
    for (const i of withBounds) {
      const b = i.bounds
      if (!b) continue
      extent = extent ? union(extent, b) : { ...b }
    }
    return { items: withBounds, extent }
  }
  /** After a write: what each landed record covers, and what else it now sits on. */
  const landed = async (put: Record<string, BoardRecord>) => {
    const ids = Object.keys(put).filter((id) => put[id]!.typeName === 'shape')
    if (!ids.length) return []
    const all = ((await mine().itemsFor(user.id)) as FeedItem[]).filter((i) => i.record)
    return ids.map((id) => {
      const b = approxBounds(put[id]!)
      const overlaps = all.filter((i) => i.id !== id && !ids.includes(i.id) && gapBetween(b, approxBounds(i.record as BoardRecord)) === 0).map((i) => i.id)
      return { id, bounds: b, overlaps }
    })
  }
  switch (name) {
    case 'whoami':
      return text(toMe(env, user))
    case 'my_desktop': {
      const raw = (await mine().itemsFor(user.id)) as FeedItem[]
      const people = (await d.usersByIds([...new Set(raw.flatMap((i) => [i.meta.by, i.meta.layer]))])).map(toPerson)
      const { items, extent } = placed(raw)
      return text({ desktop: here, extent, items: args.records === false ? strip(items) : items, people })
    }
    case 'desktop': {
      const handle = String(args.handle ?? '').replace(/^@/, '').toLowerCase()
      if (!HANDLE_RE.test(handle)) throw new Error('That is not a handle')
      const target = await d.userByHandle(handle)
      if (!target) throw new Error(`No desktop at @${handle}`)
      const profile = await profileOf(env, target, user)
      const raw = (await board(env, target.id).allVisible()) as FeedItem[]
      const people = (await d.usersByIds([...new Set(raw.flatMap((i) => [i.meta.by, i.meta.layer]))])).map(toPerson)
      const { items, extent } = placed(raw)
      return text({ profile, extent, items, people })
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
      const result = await apply({ put, removed: [] } satisfies WireDiff, user.id, user.id)
      return text({ ...result, placed: await landed(result.accepted.put), desktop: here })
    }
    case 'changes_since': {
      const since = Number(args.since)
      if (!Number.isFinite(since) || since <= 0) throw new Error('since is the `now` (ms since the epoch) from an earlier result')
      const { items, removed } = (await mine().changedSince(since, user.id)) as { items: FeedItem[]; removed: string[] }
      return text({ since, ...placed(items), removed })
    }
    case 'measure_items': {
      const records = Array.isArray(args.records) ? (args.records as Array<Record<string, unknown>>) : []
      if (!records.length) throw new Error('Pass records')
      return text(records.map((r) => ({ id: r.id ?? null, type: r.type, bounds: approxBounds({ typeName: 'shape', rot: 0, z: 1, x: 0, y: 0, ...r } as unknown as BoardRecord) })))
    }
    case 'find_space': {
      const w = Number(args.w), h = Number(args.h), gap = Number.isFinite(Number(args.gap)) ? Number(args.gap) : 40
      if (!(w > 0 && h > 0)) throw new Error('w and h are required numbers')
      const all = ((await mine().itemsFor(user.id)) as FeedItem[]).filter((i) => i.record).map((i) => approxBounds(i.record as BoardRecord))
      const avoid = Array.isArray(args.avoid) ? (args.avoid as Box[]).filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite)) : []
      const taken = [...all, ...avoid]
      let extent: Box | null = null
      for (const b of all) extent = extent ? union(extent, b) : { ...b }
      const near = args.near && typeof args.near === 'object' ? (args.near as { x?: number; y?: number }) : {}
      const cx = Number.isFinite(Number(near.x)) ? Number(near.x) : extent ? extent.x + extent.w / 2 : 0
      const cy = Number.isFinite(Number(near.y)) ? Number(near.y) : extent ? extent.y + extent.h / 2 : 0
      const spot = findSpace(taken, w, h, gap, { x: cx, y: cy })
      return text({ ...spot, w, h, gap })
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
        const expect = u.expect && typeof u.expect === 'object' ? (u.expect as { x?: number; y?: number }) : null
        if (expect && ((typeof expect.x === 'number' && Math.abs(expect.x - rec.x) > 2) || (typeof expect.y === 'number' && Math.abs(expect.y - rec.y) > 2))) {
          refused.push({ id, why: `moved since you looked: it is now at ${Math.round(rec.x)}, ${Math.round(rec.y)}` })
          continue
        }
        const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
        const props = u.props && typeof u.props === 'object' ? { ...rec.props, ...(u.props as Record<string, unknown>) } : rec.props
        put[id] = { ...rec, x: num(u.x, rec.x), y: num(u.y, rec.y), rot: num(u.rot, rec.rot), z: num(u.z, rec.z), props } as unknown as BoardRecord
      }
      const result = Object.keys(put).length ? await apply({ put, removed: [] } satisfies WireDiff, user.id, user.id) : { accepted: { put: {}, removed: [] }, rejected: [] }
      return text({ changed: await landed(result.accepted.put), refused: [...refused, ...result.rejected.map((id) => ({ id, why: 'not accepted' }))], desktop: here })
    }
    case 'remove_items': {
      const removed = ids(args.ids)
      if (!removed.length) throw new Error('Nothing to remove: pass ids')
      const result = await apply({ put: {}, removed } satisfies WireDiff, user.id, user.id)
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
      const result = await apply({ put, removed: [] } satisfies WireDiff, user.id, user.id)
      return text({ ...result, placed: await landed(result.accepted.put), image: `${origin}/api/uploads/${uploadId}`, desktop: here })
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
    case 'layout_graph': {
      const spec = args as unknown as GraphSpec & { at?: { x: number; y: number }; place?: boolean }
      if (!Array.isArray(spec.zones) || !spec.zones.length) throw new Error('Pass zones, each with nodes')
      const mintId = (kind: string) => `${kind === 'group' ? 'group' : 'shape'}:${randomId(9)}`
      // size it at the origin, find room for that size, then lay it out there for real
      const probe = layoutGraph(spec, { x: 0, y: 0 }, () => 'probe')
      let at = spec.at && Number.isFinite(spec.at.x) && Number.isFinite(spec.at.y) ? spec.at : null
      if (!at) {
        const all = ((await mine().itemsFor(user.id)) as FeedItem[]).filter((i) => i.record).map((i) => approxBounds(i.record as BoardRecord))
        at = findSpace(all, probe.bounds.w, probe.bounds.h, 40, null)
      }
      // stack above whatever is there
      const topZ = ((await mine().itemsFor(user.id)) as FeedItem[]).reduce((m, i) => Math.max(m, Number((i.record as { z?: number } | undefined)?.z ?? 0)), 0)
      const laid = layoutGraph(spec, at, mintId, topZ + 1)
      const byId = new Map(laid.records.map((r) => [r.id, r]))
      const records = settleArrows(laid.records, (id) => byId.get(id))
      if (spec.place === false) return text({ records, nodeIds: laid.nodeIds, bounds: laid.bounds })
      const put: Record<string, BoardRecord> = {}
      for (const r of records) put[r.id] = r
      const result = await apply({ put, removed: [] }, user.id, user.id)
      return text({ placed: Object.keys(result.accepted.put).length, rejected: result.rejected, nodeIds: laid.nodeIds, bounds: laid.bounds, desktop: here })
    }
    case 'connect_items': {
      const from = String(args.from ?? ''), to = String(args.to ?? '')
      const a = from ? ((await mine().recordOf(from)) as { record: BoardRecord } | null) : null
      const b = to ? ((await mine().recordOf(to)) as { record: BoardRecord } | null) : null
      if (!a || !b) throw new Error('Both from and to must be things on your desktop')
      const ab = approxBounds(a.record), bb = approxBounds(b.record)
      const ax = ab.x + ab.w / 2, ay = ab.y + ab.h / 2, bx = bb.x + bb.w / 2, by = bb.y + bb.h / 2
      const head = (args.head as string) ?? 'arrow'
      const color = typeof args.color === 'string' ? args.color : 'black'
      const arrowId = `shape:${randomId(9)}`
      const put: Record<string, BoardRecord> = {
        [arrowId]: {
          id: arrowId, typeName: 'shape', type: head === 'none' ? 'line' : 'arrow', x: ax, y: ay, rot: 0, z: Math.max(Number((a.record as { z?: number }).z ?? 0), Number((b.record as { z?: number }).z ?? 0)) + 1,
          props: { dx: bx - ax, dy: by - ay, bend: 0, headStart: head === 'both' ? 'arrow' : 'none', headEnd: head === 'none' ? 'none' : 'arrow', color, size: 's', dash: args.dashed ? 'dashed' : 'solid', font: 'sans', startBind: { id: from, nx: 0.5, ny: 0.5 }, endBind: { id: to, nx: 0.5, ny: 0.5 } },
        } as unknown as BoardRecord,
      }
      if (typeof args.label === 'string' && args.label.trim()) {
        // the caption is the arrow's own label: drawn at the middle of the line, it moves with it
        ;(put[arrowId] as unknown as { props: Record<string, unknown> }).props.label = args.label.trim()
        ;(put[arrowId] as unknown as { props: Record<string, unknown> }).props.labelSize = 's'
      }
      const targets = new Map<string, BoardRecord>([[from, a.record], [to, b.record]])
      for (const r of settleArrows(Object.values(put), (id) => targets.get(id))) put[r.id] = r
      const result = await apply({ put, removed: [] }, user.id, user.id)
      return text({ ...result, arrow: arrowId, desktop: here })
    }
    case 'record_reference':
      return text(RECORD_REFERENCE)
    case 'dev_setup':
      return text(devSetup(origin))
    default:
      throw new Error(`No tool called ${name}`)
  }
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * Bound arrows, settled: their ends moved onto the outlines of the shapes they
 * are tied to, the way the board does when a shape moves, so they look right
 * the moment they land. `lookup` finds a target by id (the new records, then
 * the desktop). A target the engine cannot measure here (text) is left as drawn.
 */
function settleArrows(records: BoardRecord[], lookup: (id: string) => BoardRecord | undefined): BoardRecord[] {
  const store = { get: lookup }
  return records.map((r) => {
    if (r.typeName !== 'shape' || (r.type !== 'arrow' && r.type !== 'line')) return r
    try {
      return rebindArrow(r as ShapeRecord, store as never) as unknown as BoardRecord
    } catch {
      return r
    }
  })
}

/** The nearest top-left to `near` (default: the middle of what is taken) where a w by h box clears everything by `gap`. */
function findSpace(taken: Box[], w: number, h: number, gap: number, near: { x: number; y: number } | null): { x: number; y: number } {
  let extent: Box | null = null
  for (const b of taken) extent = extent ? union(extent, b) : { ...b }
  const cx = near ? near.x : extent ? extent.x + extent.w / 2 : 0
  const cy = near ? near.y : extent ? extent.y + extent.h / 2 : 0
  const clear = (x: number, y: number) => taken.every((b) => gapBetween({ x, y, w, h }, b) >= gap)
  const step = 24
  let r = 0, t = 0
  for (let n = 0; n < 200000; n++) {
    const x = cx + r * Math.cos(t) - w / 2, y = cy + r * Math.sin(t) - h / 2
    if (clear(x, y)) return { x: Math.round(x), y: Math.round(y) }
    const dt = step / Math.max(r, step)
    t += dt
    r += (step * dt) / (Math.PI * 2)
  }
  throw new Error('No room found near there')
}
