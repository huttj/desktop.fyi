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

export function clumped(a: Box, b: Box): boolean {
  const reach = CLUSTER_GAP + 0.04 * Math.min(Math.max(a.w, a.h), Math.max(b.w, b.h))
  return gapBetween(a, b) <= reach
}

/** Which of these boxes clump with which, transitively: the index of each one's group root. */
export function clumpGroups(boxes: Box[], together: (a: Box, b: Box) => boolean = clumped): number[] {
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (together(boxes[i]!, boxes[j]!)) parent[find(i)] = find(j)
    }
  }
  return boxes.map((_, i) => find(i))
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
