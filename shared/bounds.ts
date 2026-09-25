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
      const charW = size * 0.55
      if (p.autosize === false && num(p.w) > 0) {
        // a fixed-width text wraps: count the lines it needs at that width
        w = num(p.w)
        const perLine = Math.max(1, Math.floor(w / charW))
        const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
        h = wrapped * size * 1.32 * scale
      } else {
        const longest = lines.reduce((m, l) => Math.max(m, l.length), 0)
        w = longest * charW * scale
        h = lines.length * size * 1.32 * scale
      }
      break
    }
    case 'note': {
      const scale = num(p.scale) || 1
      w = 200 * scale; h = 200 * scale
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

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
