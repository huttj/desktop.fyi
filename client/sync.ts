import type { BoardRecord, Diff, ScribbleStroke, Store } from '@quickdrawjs/core'
import type { ClientMessage, Cursor, Peer, ServerMessage, Viewport, WireDiff } from '../shared/protocol'
import type { ItemMeta } from '../shared/types'
import { uploadDataUrl } from './uploads'

export type SyncStatus = 'connecting' | 'online' | 'offline'

export interface SyncOptions {
  /** Viewers never send anything; the server would refuse it anyway. */
  canEdit: boolean
  /** Which layer new records land on: read at send time so a change of view applies at once. */
  layer(): string
  /** The current viewport, announced on every (re)connect. */
  viewport?(): Viewport | null
  onStatus(status: SyncStatus): void
  onPeers(peers: Peer[]): void
  onLaser(strokes: ScribbleStroke[]): void
  /** The room's bookkeeping for some items changed (freshness, layer, authorship). */
  onMetas(metas: Record<string, ItemMeta>, reset: boolean): void
  onInit(info: { owner: string; now: number; userId: string | null }): void
  /** The document has been loaded from the server (again, after a reconnect). */
  onReady(firstTime: boolean): void
  onRejected(reason: string): void
}

const MAX_MESSAGE_CHARS = 800_000
const PING_MS = 20_000
const DEAD_AFTER_MS = 50_000
const THROTTLE_MS = 70

/**
 * Keeps a Quickdraw store in step with a desktop. Local changes go out as they
 * happen (after any pasted images are uploaded); remote ones are applied with
 * source 'remote' so they never touch the local undo stack. A reconnect
 * reloads the whole document and replays whatever was made in the meantime.
 */
export class BoardSync {
  private ws: WebSocket | null = null
  private ready = false
  private closed = false
  private generation = 0
  private hadReady = false
  private attempt = 0
  private reconnectTimer = 0
  private pingTimer = 0
  private lastHeard = 0
  private incoming: BoardRecord[] = []
  private incomingMetas: Record<string, ItemMeta> = {}
  private unsent: WireDiff | null = null
  private chain: Promise<void> = Promise.resolve()
  private peers = new Map<string, Peer>()
  private lasers = new Map<string, ScribbleStroke[]>()
  private unlisten: (() => void) | null = null
  private cursorTimer = 0
  private pendingCursor: Cursor | null | undefined
  private laserTimer = 0
  private pendingLaser: ScribbleStroke[] | undefined
  private viewTimer = 0
  private pendingView: Viewport | null | undefined
  private lastView: Viewport | null = null

  sessionId: string | null = null

  constructor(
    private store: Store,
    private url: string,
    private opts: SyncOptions
  ) {}

  get isReady() {
    return this.ready
  }

  connect() {
    if (this.opts.canEdit && !this.unlisten) {
      this.unlisten = this.store.listen((diff) => this.enqueue(diff), { source: 'user' })
    }
    window.addEventListener('online', this.wake)
    document.addEventListener('visibilitychange', this.wake)
    this.open()
  }

  close() {
    this.closed = true
    this.unlisten?.()
    this.unlisten = null
    window.removeEventListener('online', this.wake)
    document.removeEventListener('visibilitychange', this.wake)
    clearTimeout(this.reconnectTimer)
    clearInterval(this.pingTimer)
    clearTimeout(this.cursorTimer)
    clearTimeout(this.laserTimer)
    clearTimeout(this.viewTimer)
    const ws = this.ws
    this.ws = null
    if (!ws) return
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.onmessage = null
      ws.onopen = () => ws.close()
    } else {
      ws.close()
    }
  }

  // ---- freshness ----

  pin(ids: string[], pinned: boolean) {
    if (this.opts.canEdit && ids.length) this.send({ type: 'pin', ids, pinned })
  }

  freshen(ids: string[]) {
    if (this.opts.canEdit && ids.length) this.send({ type: 'freshen', ids })
  }

  // ---- presence ----

  /** Everyone, viewers included, shows where they are looking; the room refuses only edits. */
  sendViewport(viewport: Viewport | null) {
    this.pendingView = viewport
    if (this.viewTimer) return
    this.viewTimer = window.setTimeout(() => {
      this.viewTimer = 0
      const v = this.pendingView
      this.pendingView = undefined
      if (v === undefined) return
      if (v && this.lastView && Math.abs(v.x - this.lastView.x) < 1 && Math.abs(v.y - this.lastView.y) < 1 && Math.abs(v.w - this.lastView.w) < 1 && Math.abs(v.h - this.lastView.h) < 1) return
      this.lastView = v
      this.send({ type: 'view', viewport: v })
    }, 90)
  }

  sendCursor(cursor: Cursor | null) {
    this.pendingCursor = cursor
    if (this.cursorTimer) return
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = 0
      if (this.pendingCursor !== undefined) this.send({ type: 'cursor', cursor: this.pendingCursor })
      this.pendingCursor = undefined
    }, THROTTLE_MS)
  }

  sendLaser(strokes: ScribbleStroke[]) {
    if (!this.opts.canEdit) return
    this.pendingLaser = strokes
    if (this.laserTimer) return
    this.laserTimer = window.setTimeout(() => {
      this.laserTimer = 0
      if (this.pendingLaser) this.send({ type: 'laser', strokes: this.pendingLaser })
      this.pendingLaser = undefined
    }, THROTTLE_MS)
  }

  // ---- connection ----

  private wake = () => {
    if (this.closed || this.ws || document.visibilityState === 'hidden') return
    clearTimeout(this.reconnectTimer)
    this.attempt = 0
    this.open()
  }

  private open() {
    if (this.closed || this.ws) return
    this.opts.onStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    this.ready = false
    ws.onopen = () => {
      this.attempt = 0
      this.lastHeard = Date.now()
      clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(() => {
        if (Date.now() - this.lastHeard > DEAD_AFTER_MS) ws.close()
        else this.send({ type: 'ping' })
      }, PING_MS)
    }
    ws.onmessage = (e) => {
      this.lastHeard = Date.now()
      let msg: ServerMessage
      try {
        msg = JSON.parse(e.data as string) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onerror = () => ws.close()
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.ready = false
      clearInterval(this.pingTimer)
      this.peers.clear()
      this.lasers.clear()
      this.opts.onPeers([])
      this.opts.onLaser([])
      this.opts.onStatus('offline')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.closed) return
    const delay = Math.min(15_000, 1000 * 2 ** this.attempt) + Math.random() * 500
    this.attempt++
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = window.setTimeout(() => this.open(), delay)
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  // ---- inbound ----

  private handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'init':
        this.sessionId = msg.sessionId
        this.incoming = []
        this.incomingMetas = {}
        this.opts.onInit({ owner: msg.owner, now: msg.now, userId: msg.userId })
        return
      case 'records':
        this.incoming.push(...msg.records)
        return
      case 'metas':
        if (this.ready) this.opts.onMetas(msg.metas, false)
        else Object.assign(this.incomingMetas, msg.metas)
        return
      case 'ready': {
        const records: Record<string, BoardRecord> = {}
        for (const rec of this.incoming) records[rec.id] = rec
        this.incoming = []
        this.store.loadSnapshot({ document: { store: records } }, 'remote')
        this.opts.onMetas(this.incomingMetas, true)
        this.incomingMetas = {}
        this.generation++
        this.ready = true
        if (this.unsent) {
          this.store.applyDiff(toDiff(this.unsent), 'remote')
          this.sendWire(this.unsent)
          this.unsent = null
        }
        this.peers = new Map(msg.peers.map((p) => [p.sessionId, p]))
        this.opts.onPeers([...this.peers.values()])
        this.opts.onStatus('online')
        this.lastView = null
        if (this.pendingView === undefined && this.opts.viewport) this.sendViewport(this.opts.viewport())
        this.opts.onReady(!this.hadReady)
        this.hadReady = true
        return
      }
      case 'diff':
        this.store.applyDiff(toDiff(msg.diff), 'remote')
        return
      case 'peer':
        this.peers.set(msg.peer.sessionId, msg.peer)
        this.opts.onPeers([...this.peers.values()])
        return
      case 'leave':
        this.peers.delete(msg.sessionId)
        this.opts.onPeers([...this.peers.values()])
        if (this.lasers.delete(msg.sessionId)) this.emitLasers()
        return
      case 'laser':
        if (msg.strokes.length) this.lasers.set(msg.sessionId, msg.strokes)
        else this.lasers.delete(msg.sessionId)
        this.emitLasers()
        return
      case 'rejected':
        this.opts.onRejected(msg.reason)
        return
      case 'pong':
        return
    }
  }

  private emitLasers() {
    const all: ScribbleStroke[] = []
    for (const strokes of this.lasers.values()) all.push(...strokes)
    this.opts.onLaser(all)
  }

  // ---- outbound ----

  private enqueue(diff: Diff) {
    const generation = this.generation
    this.chain = this.chain
      .then(() => this.process(diff, generation))
      .catch((e) => console.warn('A change could not be synced', e))
  }

  private async process(diff: Diff, generation: number) {
    const wire = await this.toWire(diff)
    if (!wire) return
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      if (generation !== this.generation) this.store.applyDiff(toDiff(wire), 'remote')
      this.sendWire(wire)
    } else {
      this.unsent = this.unsent ? mergeWire(this.unsent, wire) : wire
    }
  }

  private async toWire(diff: Diff): Promise<WireDiff | null> {
    const put: Record<string, BoardRecord> = {}
    for (const rec of Object.values(diff.added)) put[rec.id] = rec
    for (const [id, [, to]] of Object.entries(diff.updated)) put[id] = to
    const removed = Object.keys(diff.removed)

    for (const rec of Object.values(put)) {
      if (rec.typeName !== 'asset' || !rec.src.startsWith('data:')) continue
      try {
        const uploaded = { ...rec, src: await uploadDataUrl(rec.src) }
        put[rec.id] = uploaded
        if (this.store.has(rec.id)) this.store.put(uploaded, 'remote')
      } catch (e) {
        console.warn('Image upload failed; removing it from the board', e)
        const orphans = this.store
          .shapes()
          .filter((s) => s.props.assetId === rec.id)
          .map((s) => s.id)
        delete put[rec.id]
        for (const id of orphans) delete put[id]
        this.store.remove([rec.id, ...orphans], 'remote')
      }
    }

    if (!Object.keys(put).length && !removed.length) return null
    return { put, removed }
  }

  private sendWire(wire: WireDiff) {
    const layer = this.opts.layer()
    const whole = JSON.stringify({ type: 'diff', diff: wire, layer } satisfies ClientMessage)
    if (whole.length <= MAX_MESSAGE_CHARS) {
      this.send({ type: 'diff', diff: wire, layer })
      return
    }
    let batch: WireDiff = { put: {}, removed: [] }
    let chars = 0
    const flush = () => {
      if (!chars && !batch.removed.length) return
      this.send({ type: 'diff', diff: batch, layer })
      batch = { put: {}, removed: [] }
      chars = 0
    }
    for (const rec of Object.values(wire.put)) {
      const size = JSON.stringify(rec).length
      if (size > MAX_MESSAGE_CHARS) {
        console.warn('A shape is too large to sync and was skipped', rec.id)
        continue
      }
      if (chars + size > MAX_MESSAGE_CHARS) flush()
      batch.put[rec.id] = rec
      chars += size
    }
    batch.removed = wire.removed
    flush()
  }
}

function toDiff(wire: WireDiff): Diff {
  const removed: Record<string, BoardRecord> = {}
  for (const id of wire.removed) removed[id] = { id } as BoardRecord
  return { added: wire.put, updated: {}, removed }
}

function mergeWire(a: WireDiff, b: WireDiff): WireDiff {
  const put = { ...a.put }
  for (const id of b.removed) delete put[id]
  Object.assign(put, b.put)
  const removed = new Set(a.removed)
  for (const id of Object.keys(b.put)) removed.delete(id)
  for (const id of b.removed) removed.add(id)
  return { put, removed: [...removed] }
}
