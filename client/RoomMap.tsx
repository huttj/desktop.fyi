import { themeOf } from '@quickdrawjs/core'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Box } from '../shared/bounds'

/**
 * The room's minimap, drawn the way Quickdraw draws the board's: things as
 * soft blocks, the view as a frame, in the top-right corner. Click or drag
 * to put the view there. Narrow screens (phones) go without, as on the board.
 */
export interface Camera {
  x: number
  y: number
  z: number
}

const MM_W = 180
const MM_H = 120
const MM_PAD = 8

export function RoomMap({ boxes, camera, viewport, theme, onCamera }: { boxes: Box[]; camera: Camera; viewport: { w: number; h: number }; theme: 'light' | 'dark'; onCamera: (c: Camera) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const map = useRef<{ k: number; ox: number; oy: number } | null>(null)
  const dragging = useRef<number | null>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (el.width !== MM_W * dpr) {
      el.width = MM_W * dpr
      el.height = MM_H * dpr
    }
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, MM_W, MM_H)
    // the world the map shows: everything placed, and the view, with a margin
    const vp = { x: -camera.x / camera.z, y: -camera.y / camera.z, w: viewport.w / camera.z, h: viewport.h / camera.z }
    let b: Box = vp
    for (const box of boxes) {
      const x = Math.min(b.x, box.x)
      const y = Math.min(b.y, box.y)
      b = { x, y, w: Math.max(b.x + b.w, box.x + box.w) - x, h: Math.max(b.y + b.h, box.y + box.h) - y }
    }
    const k = Math.min((MM_W - MM_PAD * 2) / (b.w || 1), (MM_H - MM_PAD * 2) / (b.h || 1))
    const m = { k, ox: MM_W / 2 - (b.x + b.w / 2) * k, oy: MM_H / 2 - (b.y + b.h / 2) * k }
    map.current = m
    ctx.fillStyle = theme === 'dark' ? 'rgba(255, 246, 224, 0.45)' : 'rgba(28, 27, 24, 0.32)'
    for (const box of boxes) {
      const w = Math.max(2, box.w * k), h = Math.max(2, box.h * k)
      ctx.beginPath()
      ctx.roundRect(box.x * k + m.ox, box.y * k + m.oy, w, h, Math.min(2, w / 2, h / 2))
      ctx.fill()
    }
    const t = themeOf(theme)
    ctx.fillStyle = t.selectionFill
    ctx.strokeStyle = t.selection
    ctx.lineWidth = 1.5
    const vx = vp.x * k + m.ox, vy = vp.y * k + m.oy
    ctx.fillRect(vx, vy, vp.w * k, vp.h * k)
    ctx.strokeRect(vx + 0.75, vy + 0.75, vp.w * k - 1.5, vp.h * k - 1.5)
  }, [boxes, camera, viewport, theme])

  /** Puts the middle of the view on the page point under the pointer. */
  const lookAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const m = map.current
    if (!m) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left - m.ox) / m.k
    const py = (e.clientY - r.top - m.oy) / m.k
    onCamera({ x: viewport.w / 2 - px * camera.z, y: viewport.h / 2 - py * camera.z, z: camera.z })
  }

  return (
    <div className="World-map" onPointerDown={(e) => e.stopPropagation()}>
      <canvas
        ref={canvas}
        className={`World-map-canvas${dragging.current !== null ? ' is-dragging' : ''}`}
        style={{ width: MM_W, height: MM_H }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          dragging.current = e.pointerId
          e.currentTarget.setPointerCapture(e.pointerId)
          lookAt(e)
        }}
        onPointerMove={(e) => dragging.current === e.pointerId && lookAt(e)}
        onPointerUp={(e) => dragging.current === e.pointerId && (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        aria-label="Map of the room"
      />
    </div>
  )
}
