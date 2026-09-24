import { DurableObject } from 'cloudflare:workers'
import type { BoardRecord, ScribbleStroke, ShapeRecord } from '@quickdrawjs/core'
import { approxBounds, centreOf } from '../shared/bounds'
import { runDecay, type DecayEvent, type DecayItem, type EventKind } from '../shared/decay'
import { BUMP, DAY_MS, DIRECT_CAP, FADE_START, HIDE_AT, PURGE_AFTER_DAYS, canSee, provisionalAge } from '../shared/freshness'
import type { ClientMessage, Cursor, Peer, ServerMessage, Viewport, WireDiff } from '../shared/protocol'
import type { DesktopStats, FeedItem, ItemMeta, PlacedItem } from '../shared/types'

/** Set by the worker (never trusted from the client). */
export const USER_HEADER = 'x-dfyi-user'
export const OWNER_HEADER = 'x-dfyi-owner'

interface Attachment {
  sessionId: string
  userId: string | null
  readonly: boolean
}

type Row = {
  id: string
  data: string
  is_asset: number
  layer: string
  author: string
  created_at: number
  edited_by: string
  edited_at: number
  score: number
  scored_at: number
  pending: number
  state: 'live' | 'archived'
  archived_at: number | null
  cx: number
  cy: number
  pinned: number
  [key: string]: SqlStorageValue
}

const MAX_RECORD_CHARS = 256 * 1024
const MAX_RECORDS_PER_MESSAGE = 2000
const INIT_CHUNK_CHARS = 400 * 1024
const MAX_ID_CHARS = 96
/** Repeated events of one kind by one person inside this window count once (a drag is one move). */
const COALESCE_MS = 10_000
/** Records bigger than this are not shipped to the feed (a thumbnail is not worth the bytes). */
const FEED_RECORD_CHARS = 48 * 1024

/**
 * One desktop per Durable Object (the object is named by its owner's user id).
 * The document is a flat map of Quickdraw records in SQLite, each with the
 * board's own bookkeeping beside it: which layer it is on, who made it, and
 * how fresh it is. A daily alarm runs the decay pass.
 */
export class BoardDurableObject extends DurableObject<Env> {
  private cursors = new Map<string, Cursor | null>()
  private viewports = new Map<string, Viewport | null>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => this.migrate())
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        is_asset INTEGER NOT NULL DEFAULT 0,
        layer TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        edited_by TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        scored_at INTEGER NOT NULL,
        pending REAL NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'live',
        archived_at INTEGER,
        cx REAL NOT NULL DEFAULT 0,
        cy REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS records_state ON records(state, edited_at);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        by TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_item ON events(item_id, seq);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visits (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        user_id TEXT
      );
      CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
    `)
    const columns = this.sql.exec<{ name: string }>('PRAGMA table_info(records)').toArray().map((c) => c.name)
    if (!columns.includes('pinned')) this.sql.exec('ALTER TABLE records ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  }

  private get sql() {
    return this.ctx.storage.sql
  }

  private kvGet(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', key).toArray()[0]?.value ?? null
  }

  private kvSet(key: string, value: string) {
    this.sql.exec('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value)
  }

  private get owner(): string {
    return this.kvGet('owner') ?? ''
  }

  // ---- sockets ----

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a websocket', { status: 426 })
    }
    const owner = request.headers.get(OWNER_HEADER)
    if (!owner) return new Response('Missing owner', { status: 400 })
    if (!this.owner) this.kvSet('owner', owner)
    const userId = request.headers.get(USER_HEADER)
    const readonly = !userId

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const attachment: Attachment = { sessionId: crypto.randomUUID(), userId, readonly }
    server.serializeAttachment(attachment)
    this.ctx.acceptWebSocket(server)

    this.recordVisit(userId)
    this.sendDocument(server, attachment)
    this.broadcast({ type: 'peer', peer: this.peerOf(attachment) }, server)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** One visit per window, but the same person coming back within ten minutes (a reconnect) is not a new one. */
  private recordVisit(userId: string | null) {
    const now = Date.now()
    if (userId) {
      const recent = this.sql.exec<{ at: number }>('SELECT at FROM visits WHERE user_id = ? ORDER BY seq DESC LIMIT 1', userId).toArray()[0]
      if (recent && now - recent.at < 10 * 60_000) return
    }
    this.sql.exec('INSERT INTO visits (at, user_id) VALUES (?, ?)', now, userId)
  }

  private sendDocument(ws: WebSocket, attachment: Attachment) {
    const now = Date.now()
    const rows = this.sql.exec<Row>("SELECT * FROM records WHERE state = 'live'").toArray()
    const visible = rows.filter((r) => this.visibleTo(r, attachment.userId, now))
    this.send(ws, { type: 'init', sessionId: attachment.sessionId, userId: attachment.userId, owner: this.owner, now, count: visible.length })

    let chunk: string[] = []
    let chars = 0
    const flush = () => {
      if (!chunk.length) return
      ws.send(`{"type":"records","records":[${chunk.join(',')}]}`)
      chunk = []
      chars = 0
    }
    for (const row of visible) {
      chunk.push(row.data)
      chars += row.data.length
      if (chars >= INIT_CHUNK_CHARS) flush()
    }
    flush()

    const metas: Record<string, ItemMeta> = {}
    let n = 0
    for (const row of visible) {
      metas[row.id] = metaOf(row)
      if (++n >= 1000) {
        this.send(ws, { type: 'metas', metas: { ...metas } })
        for (const k of Object.keys(metas)) delete metas[k]
        n = 0
      }
    }
    if (n) this.send(ws, { type: 'metas', metas })
    this.send(ws, { type: 'ready', peers: this.peers(ws) })
  }

  private visibleTo(row: Row, viewerId: string | null, now: number) {
    if (row.state !== 'live') return false
    if (row.is_asset) return true
    return canSee(metaOf(row), provisionalAge(metaOf(row), now), viewerId)
  }

  private peerOf(attachment: Attachment): Peer {
    return {
      sessionId: attachment.sessionId,
      userId: attachment.userId,
      cursor: this.cursors.get(attachment.sessionId) ?? null,
      viewport: this.viewports.get(attachment.sessionId) ?? null,
    }
  }

  /** Every open window but this one, viewers included. */
  private peers(except: WebSocket): Peer[] {
    const out: Peer[] = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      const attachment = getAttachment(ws)
      if (!attachment) continue
      out.push(this.peerOf(attachment))
    }
    return out
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    const attachment = getAttachment(ws)
    if (!attachment) return

    let msg: ClientMessage
    try {
      msg = JSON.parse(message) as ClientMessage
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong' })
        return

      case 'diff': {
        if (attachment.readonly || !attachment.userId) {
          this.send(ws, { type: 'rejected', reason: 'Sign in to add to a desktop' })
          return
        }
        const diff = sanitizeDiff(msg.diff)
        if (!diff) {
          this.send(ws, { type: 'rejected', reason: 'Malformed change' })
          return
        }
        const layer = this.resolveLayer(attachment.userId, msg.layer)
        if (!layer) {
          this.send(ws, { type: 'rejected', reason: 'You can only add to your own layer here' })
          return
        }
        const result = this.applyDiff(diff, attachment.userId, layer)
        this.relay(result, ws)
        void this.ensureAlarm()
        return
      }

      case 'pin':
      case 'freshen': {
        if (attachment.readonly || !attachment.userId) {
          this.send(ws, { type: 'rejected', reason: 'Sign in first' })
          return
        }
        const ids = Array.isArray(msg.ids) ? msg.ids.filter(isId).slice(0, 200) : []
        const metas = this.mark(ids, attachment.userId, msg.type === 'pin' ? { pinned: !!msg.pinned } : { freshen: true })
        if (!Object.keys(metas).length) {
          this.send(ws, { type: 'rejected', reason: 'Only the author or the desktop owner can do that' })
          return
        }
        this.relayMetas(metas)
        void this.ensureAlarm()
        return
      }

      case 'cursor': {
        this.cursors.set(attachment.sessionId, sanitizeCursor(msg.cursor))
        this.broadcast({ type: 'peer', peer: this.peerOf(attachment) }, ws)
        return
      }

      case 'view': {
        this.viewports.set(attachment.sessionId, sanitizeViewport(msg.viewport))
        this.broadcast({ type: 'peer', peer: this.peerOf(attachment) }, ws)
        return
      }

      case 'laser': {
        if (attachment.readonly) return
        const strokes = sanitizeStrokes(msg.strokes)
        if (!strokes) return
        this.broadcast({ type: 'laser', sessionId: attachment.sessionId, strokes }, ws)
        return
      }
    }
  }

  override async webSocketClose(ws: WebSocket) {
    this.handleLeave(ws)
  }

  override async webSocketError(ws: WebSocket) {
    this.handleLeave(ws)
  }

  private handleLeave(ws: WebSocket) {
    const attachment = getAttachment(ws)
    if (!attachment) return
    this.cursors.delete(attachment.sessionId)
    this.viewports.delete(attachment.sessionId)
    this.broadcast({ type: 'leave', sessionId: attachment.sessionId }, ws)
  }

  // ---- layers ----

  /**
   * Where a change lands. The owner may write on the desktop itself or on any
   * visitor's layer; a visitor only ever writes on their own.
   */
  private resolveLayer(userId: string, requested: unknown): string | null {
    const owner = this.owner
    const layer = typeof requested === 'string' && requested.length <= MAX_ID_CHARS ? requested : userId
    if (userId !== owner) return layer === userId ? layer : null
    if (layer === owner || layer === userId) return layer
    const exists = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM records WHERE layer = ?', layer).toArray()[0]?.n ?? 0
    return exists > 0 ? layer : null
  }

  // ---- document ----

  private applyDiff(diff: WireDiff, userId: string, layer: string): RelayResult {
    const now = Date.now()
    const owner = this.owner
    const accepted: WireDiff = { put: {}, removed: [] }
    const restore: BoardRecord[] = []
    const metas: Record<string, ItemMeta> = {}

    this.ctx.storage.transactionSync(() => {
      for (const rec of Object.values(diff.put)) {
        const existing = this.sql.exec<Row>('SELECT * FROM records WHERE id = ?', rec.id).toArray()[0]
        const isAsset = rec.typeName === 'asset'
        const { cx, cy } = isAsset ? { cx: 0, cy: 0 } : centreOf(rec)
        if (!existing) {
          this.sql.exec(
            `INSERT INTO records (id, data, is_asset, layer, author, created_at, edited_by, edited_at, score, scored_at, pending, state, cx, cy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'live', ?, ?)`,
            rec.id, JSON.stringify(rec), isAsset ? 1 : 0, layer, userId, now, userId, now, now, cx, cy
          )
          if (!isAsset) this.logEvent(rec.id, 'create', userId, now)
          accepted.put[rec.id] = rec
          metas[rec.id] = metaOf(this.row(rec.id)!)
          continue
        }
        if (existing.state !== 'live') continue // an id that already went to the archive stays there
        if (!existing.is_asset && !this.visibleTo(existing, userId, now)) continue
        if (existing.author !== userId) {
          // Not theirs to move or edit: hand the sender the record as it stands.
          restore.push(JSON.parse(existing.data) as BoardRecord)
          continue
        }
        const prev = JSON.parse(existing.data) as BoardRecord
        const kind = classify(prev, rec)
        if (!kind) {
          accepted.put[rec.id] = rec
          continue
        }
        this.sql.exec('UPDATE records SET data = ?, edited_by = ?, edited_at = ?, cx = ?, cy = ? WHERE id = ?', JSON.stringify(rec), userId, now, cx, cy, rec.id)
        if (!existing.is_asset && this.logEvent(rec.id, kind, userId, now)) {
          this.sql.exec('UPDATE records SET pending = MIN(?, pending + ?) WHERE id = ?', DIRECT_CAP, kind === 'edit' ? BUMP.edit : BUMP.move, rec.id)
        }
        accepted.put[rec.id] = rec
        metas[rec.id] = metaOf(this.row(rec.id)!)
      }
      for (const id of diff.removed) {
        const existing = this.sql.exec<Row>('SELECT * FROM records WHERE id = ?', id).toArray()[0]
        if (!existing || existing.state !== 'live') continue
        if (userId !== owner && userId !== existing.author) {
          // Not theirs to remove: give it back to the sender's board.
          restore.push(JSON.parse(existing.data) as BoardRecord)
          continue
        }
        this.sql.exec("UPDATE records SET state = 'archived', archived_at = ? WHERE id = ?", now, id)
        this.sql.exec('DELETE FROM events WHERE item_id = ?', id)
        accepted.removed.push(id)
      }
    })
    return { accepted, restore, metas, now }
  }

  /** Pins/unpins or freshens the items this person may touch (their own, or anything on their desktop). */
  private mark(ids: string[], userId: string, what: { pinned?: boolean; freshen?: boolean }): Record<string, ItemMeta> {
    const now = Date.now()
    const owner = this.owner
    const metas: Record<string, ItemMeta> = {}
    this.ctx.storage.transactionSync(() => {
      for (const id of ids) {
        const row = this.row(id)
        if (!row || row.state !== 'live' || row.is_asset) continue
        if (userId !== owner && userId !== row.author) continue
        if (what.freshen) this.sql.exec('UPDATE records SET score = 0, scored_at = ?, pending = 0, edited_by = ?, edited_at = ? WHERE id = ?', now, userId, now, id)
        if (what.pinned !== undefined) this.sql.exec('UPDATE records SET pinned = ? WHERE id = ?', what.pinned ? 1 : 0, id)
        metas[id] = metaOf(this.row(id)!)
      }
    })
    return metas
  }

  /** Bookkeeping changes go to everyone who may see the items concerned. */
  private relayMetas(metas: Record<string, ItemMeta>) {
    const now = Date.now()
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws)
      if (!attachment) continue
      const visible: Record<string, ItemMeta> = {}
      for (const [id, meta] of Object.entries(metas)) {
        if (canSee(meta, provisionalAge(meta, now), attachment.userId)) visible[id] = meta
      }
      if (Object.keys(visible).length) this.send(ws, { type: 'metas', metas: visible })
    }
  }

  private row(id: string): Row | undefined {
    return this.sql.exec<Row>('SELECT * FROM records WHERE id = ?', id).toArray()[0]
  }

  /** Records an event, folding it into the previous one when it is the same person doing the same thing moments ago. Returns true when a new row was written. */
  private logEvent(itemId: string, kind: EventKind, by: string, at: number): boolean {
    const last = this.sql
      .exec<{ seq: number; kind: string; by: string; at: number }>('SELECT seq, kind, by, at FROM events WHERE item_id = ? ORDER BY seq DESC LIMIT 1', itemId)
      .toArray()[0]
    if (last && last.kind === kind && last.by === by && at - last.at < COALESCE_MS) {
      this.sql.exec('UPDATE events SET at = ? WHERE seq = ?', at, last.seq)
      return false
    }
    this.sql.exec('INSERT INTO events (item_id, kind, by, at) VALUES (?, ?, ?, ?)', itemId, kind, by, at)
    return true
  }

  /** Sends the accepted change to everyone who may see each record, and the bookkeeping to all. */
  private relay(result: RelayResult, sender: WebSocket) {
    const { accepted, restore, metas, now } = result
    if (restore.length) {
      const put: Record<string, BoardRecord> = {}
      for (const rec of restore) put[rec.id] = rec
      this.send(sender, { type: 'diff', diff: { put, removed: [] } })
      this.send(sender, { type: 'rejected', reason: "That is someone else's: only they can change it" })
    }
    const rows = new Map<string, Row>()
    for (const id of Object.keys(accepted.put)) {
      const r = this.row(id)
      if (r) rows.set(id, r)
    }
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws)
      if (!attachment) continue
      const put: Record<string, BoardRecord> = {}
      const visibleMetas: Record<string, ItemMeta> = {}
      for (const [id, rec] of Object.entries(accepted.put)) {
        const r = rows.get(id)
        if (!r || !this.visibleTo(r, attachment.userId, now)) continue
        put[id] = rec
        if (metas[id]) visibleMetas[id] = metas[id]!
      }
      if (ws !== sender && (Object.keys(put).length || accepted.removed.length)) {
        this.send(ws, { type: 'diff', diff: { put, removed: accepted.removed } })
      }
      if (Object.keys(visibleMetas).length) this.send(ws, { type: 'metas', metas: visibleMetas })
    }
  }

  // ---- the daily pass ----

  private async ensureAlarm() {
    const current = await this.ctx.storage.getAlarm()
    if (current !== null) return
    const last = Number(this.kvGet('lastRunAt') ?? 0)
    const next = Math.max(Date.now() + 60_000, last + DAY_MS)
    await this.ctx.storage.setAlarm(next)
  }

  override async alarm() {
    this.runDailyPass()
  }

  /** Ages everything, pays out the day's bumps, archives what is past saving, purges the long-archived. */
  runDailyPass(now = Date.now()) {
    const rows = this.sql.exec<Row>("SELECT * FROM records WHERE state = 'live' AND is_asset = 0").toArray()
    const items: DecayItem[] = rows.map((r) => ({ id: r.id, cx: r.cx, cy: r.cy, createdAt: r.created_at, score: r.score, scoredAt: r.scored_at, pinned: !!r.pinned }))
    const events: DecayEvent[] = this.sql
      .exec<{ item_id: string; kind: EventKind }>('SELECT item_id, kind FROM events ORDER BY seq')
      .toArray()
      .map((e) => ({ itemId: e.item_id, kind: e.kind }))
    const result = runDecay(items, events, now)

    const metas: Record<string, ItemMeta> = {}
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        const score = result.scores.get(row.id) ?? row.score
        this.sql.exec('UPDATE records SET score = ?, scored_at = ?, pending = 0 WHERE id = ?', score, now, row.id)
      }
      for (const id of result.archived) {
        this.sql.exec("UPDATE records SET state = 'archived', archived_at = ? WHERE id = ?", now, id)
      }
      this.sql.exec('DELETE FROM events')
      this.sql.exec("DELETE FROM records WHERE state = 'archived' AND archived_at < ?", now - PURGE_AFTER_DAYS * DAY_MS)
      this.sql.exec('DELETE FROM visits WHERE at < ?', now - 90 * DAY_MS)
      const total = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM visits WHERE at < ?', now - 60 * DAY_MS).toArray()[0]?.n ?? 0
      if (total) this.kvSet('visitsBefore', String(Number(this.kvGet('visitsBefore') ?? 0) + total))
      this.sql.exec('DELETE FROM visits WHERE at < ?', now - 60 * DAY_MS)
      this.kvSet('lastRunAt', String(now))
    })
    const archived = new Set(result.archived)
    for (const row of rows) {
      if (archived.has(row.id)) continue
      const fresh = this.row(row.id)
      if (fresh) metas[row.id] = metaOf(fresh)
    }

    // Everyone connected learns the new ages; archived things leave their boards.
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws)
      if (!attachment) continue
      const visible: Record<string, ItemMeta> = {}
      for (const [id, meta] of Object.entries(metas)) {
        if (canSee(meta, provisionalAge(meta, now), attachment.userId)) visible[id] = meta
      }
      if (Object.keys(visible).length) this.send(ws, { type: 'metas', metas: visible })
      if (result.archived.length) this.send(ws, { type: 'diff', diff: { put: {}, removed: result.archived } })
    }

    const remaining = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE state != 'live' OR is_asset = 0").toArray()[0]?.n ?? 0
    if (remaining > 0) void this.ctx.storage.setAlarm(now + DAY_MS)
    return { items: rows.length, archived: result.archived.length, events: events.length }
  }

  // ---- RPC (the worker calls these directly) ----

  /** Things visible to anyone that were made or touched since `since`, newest first. */
  async activity(since: number, limit = 40): Promise<FeedItem[]> {
    const now = Date.now()
    const rows = this.sql
      .exec<Row>("SELECT * FROM records WHERE state = 'live' AND is_asset = 0 AND edited_at >= ? ORDER BY edited_at DESC LIMIT ?", since, limit * 2)
      .toArray()
    const out: FeedItem[] = []
    for (const row of rows) {
      const meta = metaOf(row)
      const age = provisionalAge(meta, now)
      if (age >= HIDE_AT) continue
      out.push(this.feedItem(row, meta, age))
      if (out.length >= limit) break
    }
    return out
  }

  /** Every visible thing, placed: the feed clusters with these so a long column stays one entry. */
  async placed(limit = 2000): Promise<PlacedItem[]> {
    const now = Date.now()
    const rows = this.sql.exec<Row>("SELECT * FROM records WHERE state = 'live' AND is_asset = 0 ORDER BY edited_at DESC LIMIT ?", limit).toArray()
    const out: PlacedItem[] = []
    for (const row of rows) {
      const meta = metaOf(row)
      if (provisionalAge(meta, now) >= HIDE_AT) continue
      const rec = JSON.parse(row.data) as ShapeRecord
      const b = approxBounds(rec)
      const item: PlacedItem = { id: row.id, x: b.x, y: b.y, w: b.w, h: b.h }
      const raw = rec.type === 'text' ? rec.props?.text : rec.type === 'geo' ? rec.props?.label : null
      if (typeof raw === 'string') {
        const text = raw.replace(/\s+/g, ' ').trim()
        if (text && text.length <= 60 && !/^https?:\/\//i.test(text)) {
          item.text = text
          item.weight = ({ s: 1, m: 2, l: 3, xl: 4 }[String(rec.props?.size)] ?? 2) * (Number(rec.props?.scale) || 1) * (rec.type === 'text' ? 1 : 0.5)
        }
      }
      out.push(item)
    }
    return out
  }

  /** What is fading (and, for the viewer's own things, what is already hidden), oldest first. */
  async vanishing(viewerId: string | null, limit = 40): Promise<FeedItem[]> {
    const now = Date.now()
    const rows = this.sql.exec<Row>("SELECT * FROM records WHERE state = 'live' AND is_asset = 0").toArray()
    const out: FeedItem[] = []
    for (const row of rows) {
      const meta = metaOf(row)
      const age = provisionalAge(meta, now)
      if (age < FADE_START) continue
      if (!canSee(meta, age, viewerId)) continue
      out.push(this.feedItem(row, meta, age))
    }
    out.sort((a, b) => b.age - a.age)
    return out.slice(0, limit)
  }

  private feedItem(row: Row, meta: ItemMeta, age: number): FeedItem {
    const item: FeedItem = { id: row.id, boardId: this.owner, meta, age }
    if (row.data.length <= FEED_RECORD_CHARS) {
      const record = JSON.parse(row.data) as ShapeRecord
      item.record = record
      const assetId = record.props?.assetId
      if (record.type === 'image' && typeof assetId === 'string') {
        const asset = this.row(assetId)
        if (asset) item.asset = JSON.parse(asset.data)
      }
    }
    return item
  }

  async summary(): Promise<{ liveItems: number; lastActivityAt: number | null; layers: string[] }> {
    const now = Date.now()
    const rows = this.sql.exec<Row>("SELECT * FROM records WHERE state = 'live' AND is_asset = 0").toArray()
    let liveItems = 0
    let lastActivityAt: number | null = null
    const layers = new Set<string>()
    for (const row of rows) {
      const meta = metaOf(row)
      if (provisionalAge(meta, now) >= HIDE_AT) continue
      liveItems++
      layers.add(row.layer)
      if (lastActivityAt === null || row.edited_at > lastActivityAt) lastActivityAt = row.edited_at
    }
    return { liveItems, lastActivityAt, layers: [...layers] }
  }

  /** Who has been looking. The worker only hands this to the owner. */
  async stats(): Promise<DesktopStats> {
    const now = Date.now()
    const count = (since: number) => {
      const r = this.sql
        .exec<{ views: number; people: number; anon: number }>(
          'SELECT COUNT(*) AS views, COUNT(DISTINCT user_id) AS people, SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS anon FROM visits WHERE at >= ?',
          since
        )
        .toArray()[0]
      return { views: Number(r?.views ?? 0), people: Number(r?.people ?? 0) + Number(r?.anon ?? 0) }
    }
    const all = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM visits').toArray()[0]?.n ?? 0
    return {
      liveNow: this.ctx.getWebSockets().length,
      today: count(now - DAY_MS),
      week: count(now - 7 * DAY_MS),
      allTime: Number(all) + Number(this.kvGet('visitsBefore') ?? 0),
    }
  }

  /** Everything, archive included: the data request. */
  async exportAll(): Promise<{ owner: string; exportedAt: number; records: Array<{ record: unknown; meta: ItemMeta; state: string; archivedAt: number | null }> }> {
    const rows = this.sql.exec<Row>('SELECT * FROM records ORDER BY created_at').toArray()
    return {
      owner: this.owner,
      exportedAt: Date.now(),
      records: rows.map((r) => ({ record: JSON.parse(r.data), meta: metaOf(r), state: r.state, archivedAt: r.archived_at })),
    }
  }

  /** Admin: run the daily pass right now. */
  async runNow() {
    return this.runDailyPass()
  }

  /** Admin: delete the whole desktop. */
  async wipe() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, 'This desktop was removed')
      } catch {
        /* going anyway */
      }
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  // ---- plumbing ----

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* the socket is on its way out */
    }
  }

  private broadcast(msg: ServerMessage, except: WebSocket | null) {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(data)
      } catch {
        /* the socket is on its way out */
      }
    }
  }
}

interface RelayResult {
  accepted: WireDiff
  restore: BoardRecord[]
  metas: Record<string, ItemMeta>
  now: number
}

function metaOf(row: Row): ItemMeta {
  return {
    layer: row.layer,
    by: row.author,
    at: row.created_at,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
    score: row.score,
    scoredAt: row.scored_at,
    pending: row.pending,
    pinned: !!row.pinned,
  }
}

/** What kind of change this is, or null when nothing that matters changed. */
function classify(prev: BoardRecord, next: BoardRecord): EventKind | null {
  if (prev.typeName === 'asset' || next.typeName === 'asset') return JSON.stringify(prev) === JSON.stringify(next) ? null : 'edit'
  const a = prev as ShapeRecord
  const b = next as ShapeRecord
  const propsChanged = JSON.stringify(a.props) !== JSON.stringify(b.props) || a.type !== b.type
  if (propsChanged) return 'edit'
  if (a.x !== b.x || a.y !== b.y || a.rot !== b.rot || a.z !== b.z || a.groupId !== b.groupId) return 'move'
  return null
}

function getAttachment(ws: WebSocket): Attachment | null {
  const attachment = ws.deserializeAttachment() as Attachment | null
  return attachment?.sessionId ? attachment : null
}

// ---- validation: never trust a record from the network ----

function isFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS
}

function sanitizeRecord(value: unknown): BoardRecord | null {
  if (!value || typeof value !== 'object') return null
  const rec = { ...(value as Record<string, unknown>) }
  if (!isId(rec.id)) return null
  // Bookkeeping never rides inside a record; the room keeps its own.
  delete rec.meta
  if (rec.typeName === 'asset') {
    if (typeof rec.src !== 'string' || !rec.src.startsWith('/api/uploads/') || rec.src.length > 512) return null
  } else if (rec.typeName === 'shape') {
    if (!isFinite(rec.x) || !isFinite(rec.y) || typeof rec.type !== 'string') return null
  } else {
    return null
  }
  if (JSON.stringify(rec).length > MAX_RECORD_CHARS) return null
  return rec as unknown as BoardRecord
}

function sanitizeDiff(value: unknown): WireDiff | null {
  if (!value || typeof value !== 'object') return null
  const { put, removed } = value as { put?: unknown; removed?: unknown }
  if (!put || typeof put !== 'object' || !Array.isArray(removed)) return null
  const entries = Object.entries(put as Record<string, unknown>)
  if (entries.length + removed.length > MAX_RECORDS_PER_MESSAGE) return null
  const out: WireDiff = { put: {}, removed: [] }
  for (const [id, raw] of entries) {
    const rec = sanitizeRecord(raw)
    if (!rec || rec.id !== id) return null
    out.put[id] = rec
  }
  for (const id of removed) {
    if (!isId(id)) return null
    out.removed.push(id)
  }
  return out
}

function sanitizeCursor(value: unknown): Cursor | null {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as { x?: unknown; y?: unknown }
  return isFinite(x) && isFinite(y) ? { x, y } : null
}

function sanitizeViewport(value: unknown): Viewport | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, w, h } = value as Record<string, unknown>
  return isFinite(x) && isFinite(y) && isFinite(w) && isFinite(h) && w > 0 && h > 0 ? { x, y, w, h } : null
}

function sanitizeStrokes(value: unknown): ScribbleStroke[] | null {
  if (!Array.isArray(value) || value.length > 12) return null
  const out: ScribbleStroke[] = []
  for (const stroke of value) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length > 240) return null
    const points: Array<{ x: number; y: number }> = []
    for (const p of stroke.points) {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return null
      points.push({ x: p.x, y: p.y })
    }
    const opacity = isFinite(stroke.opacity) ? Math.max(0, Math.min(1, stroke.opacity)) : 1
    out.push({ points, opacity })
  }
  return out
}
