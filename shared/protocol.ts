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

/** The part of the desktop a window is looking at, in page units. */
export interface Viewport {
  x: number
  y: number
  w: number
  h: number
}

/** One open window on the desktop. `userId` is null for someone not signed in. */
export interface Peer {
  sessionId: string
  userId: string | null
  cursor: Cursor | null
  viewport: Viewport | null
}

export type ClientMessage =
  /** `layer` is where new records land: the owner's id for the desktop itself, or the sender's own id. */
  | { type: 'diff'; diff: WireDiff; layer: string }
  /** Pin (or unpin) things so they stop aging; the owner or the author may. */
  | { type: 'pin'; ids: string[]; pinned: boolean }
  /** Make things fresh again right now. */
  | { type: 'freshen'; ids: string[] }
  | { type: 'cursor'; cursor: Cursor | null }
  | { type: 'view'; viewport: Viewport | null }
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
