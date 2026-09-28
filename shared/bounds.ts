import type { BoardRecord, ShapeRecord } from '@quickdrawjs/core'

/**
 * A rough page box for a shape, good enough to judge what sits near what.
 * The worker has no canvas to measure text with, so this is a stand-in for
 * Quickdraw's own pageBounds; sizes are close, not exact.
 */
export function approxBounds(rec: BoardRecord): { x: number; y: number; w: number; h: number } {
  if (rec.typeName !== 'shape') return { x: 0, y: 0, w: 0, h: 0 }
  const s = rec as ShapeRecord
  const p = s.props ?? {}
  let x = 0
  let y = 0
  let w = 0
  let h = 0
  switch (s.type) {
    case 'draw':
    case 'highlight': {
      const pts: number[] = Array.isArray(p.pts) ? p.pts : []
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i + 1 < pts.length; i += 3) {
        const px = pts[i]!, py = pts[i + 1]!
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
      }
      if (minX !== Infinity) { x = minX; y = minY; w = maxX - minX; h = maxY - minY }
      break
    }
    case 'arrow':
    case 'line': {
      const dx = num(p.dx), dy = num(p.dy)
      x = Math.min(0, dx); y = Math.min(0, dy); w = Math.abs(dx); h = Math.abs(dy)
      break
    }
    case 'text': {
      const text = typeof p.text === 'string' ? p.text : ''
      const lines = text.split('\n')
      const size = { s: 18, m: 24, l: 36, xl: 44 }[String(p.size)] ?? 24
      const scale = num(p.scale) || 1
      // the box's scale sets the type size, so it also sets how much fits on a line
      const charW = size * 0.55 * scale
      const lineH = size * 1.32 * scale
      if (p.autosize === false && num(p.w) > 0) {
        // a fixed-width text wraps: count the lines it needs at that width
        w = num(p.w)
        const perLine = Math.max(1, Math.floor(w / charW))
        const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
        h = wrapped * lineH
      } else {
        const longest = lines.reduce((m, l) => Math.max(m, l.length), 0)
        w = longest * charW
        h = lines.length * lineH
      }
      break
    }
    case 'note': {
      // the classic square, or the box it was resized to; never shorter than its words
      const scale = num(p.scale) || 1
      const boxW = num(p.w) || 200
      const text = typeof p.text === 'string' ? p.text : ''
      const perLine = Math.max(1, Math.floor((boxW - 40) / (24 * 0.55)))
      const wrapped = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
      w = boxW * scale
      h = Math.max(num(p.h) || boxW, wrapped * 24 * 1.35 + 40) * scale
      break
    }
    default: {
      w = num(p.w); h = num(p.h)
    }
  }
  return { x: s.x + x, y: s.y + y, w, h }
}

export function centreOf(rec: BoardRecord): { cx: number; cy: number } {
  const b = approxBounds(rec)
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 }
}

/** The empty space between two boxes (0 when they touch or overlap). */
export function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
  return Math.hypot(dx, dy)
}

/**
 * A clump: things that sit together on a desktop. Whatever people put near
 * each other belongs together, the same instinct the decay rules use, so a
 * title, a picture and the sticky beside it are one thing to the feed and the
 * room. Boxes closer than this (page units) belong together; bigger things
 * reach a touch further.
 */
export const CLUSTER_GAP = 110
/** Bigger things reach a touch further: this much of the smaller one's longer side. */
export const CLUSTER_SIZE_REACH = 0.04

/** The room's rule is stricter: things that physically touch (a highlight on its words, a caption on its picture), and nothing further. */
export const TOUCH: Reach = { gap: 6, sizeReach: 0 }

export interface Reach {
  gap: number
  sizeReach: number
}

export function clumped(a: Box, b: Box, { gap, sizeReach }: Reach = { gap: CLUSTER_GAP, sizeReach: CLUSTER_SIZE_REACH }): boolean {
  const reach = gap + sizeReach * Math.min(Math.max(a.w, a.h), Math.max(b.w, b.h))
  return gapBetween(a, b) <= reach
}

/**
 * The boxes a thing touches with. Most things are their box; a line or arrow
 * is only its two ends (and the middle of its curve), since the box around a
 * long diagonal one is a huge empty rectangle that would swallow bystanders.
 */
export function touchBoxes(rec: BoardRecord): Box[] {
  if (rec.typeName === 'shape' && (rec.type === 'arrow' || rec.type === 'line')) {
    const s = rec as ShapeRecord
    const p = s.props ?? {}
    const dx = num(p.dx), dy = num(p.dy), bend = num(p.bend)
    const dot = (x: number, y: number): Box => ({ x: s.x + x - 4, y: s.y + y - 4, w: 8, h: 8 })
    const ends = [dot(0, 0), dot(dx, dy)]
    if (bend) {
      const len = Math.hypot(dx, dy) || 1
      ends.push(dot(dx / 2 + (-dy / len) * bend, dy / 2 + (dx / len) * bend))
    }
    return ends
  }
  return [approxBounds(rec)]
}

/** Which of these things clump with which, transitively: the index of each one's group root. Each thing is one or more boxes. */
export function clumpGroups(things: Box[][], reach?: Reach): number[] {
  const parent = things.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length; j++) {
      if (things[i]!.some((a) => things[j]!.some((b) => clumped(a, b, reach)))) parent[find(i)] = find(j)
    }
  }
  return things.map((_, i) => find(i))
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
