import type { BoardRecord, ScribbleStroke } from '@quickdrawjs/core'
import type { ItemMeta } from './types'

/**
 * What travels over the room socket. Quickdraw records are whole and
 * last-writer-wins, so an update is just a put and a removal is just an id.
 */
export interface WireDiff {
  put: Record<string, BoardRecord>
  removed: string[]
}

export interface Cursor {
  x: number
  y: number
}

/** A signed-in person in the room. Anonymous viewers are invisible. */
export interface Peer {
  sessionId: string
  userId: string
  cursor: Cursor | null
}

export type ClientMessage =
  /** `layer` is where new records land: the owner's id for the desktop itself, or the sender's own id. */
  | { type: 'diff'; diff: WireDiff; layer: string }
  | { type: 'cursor'; cursor: Cursor | null }
  | { type: 'laser'; strokes: ScribbleStroke[] }
  | { type: 'ping' }

export type ServerMessage =
  /** Handshake: the document follows in `records` and `metas` chunks, then `ready`. */
  | { type: 'init'; sessionId: string; userId: string | null; owner: string; now: number; count: number }
  | { type: 'records'; records: BoardRecord[] }
  | { type: 'metas'; metas: Record<string, ItemMeta> }
  | { type: 'ready'; peers: Peer[] }
  | { type: 'diff'; diff: WireDiff }
  | { type: 'peer'; peer: Peer }
  | { type: 'leave'; sessionId: string }
  | { type: 'laser'; sessionId: string; strokes: ScribbleStroke[] }
  | { type: 'rejected'; reason: string }
  | { type: 'pong' }
