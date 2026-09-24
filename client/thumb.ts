import { Store, drawShape, pageBounds, themeOf, type AssetRecord, type Bounds, type ShapeRecord } from '@quickdrawjs/core'

/**
 * Draws one or more Quickdraw records into a canvas, fitted with a margin,
 * using the same renderer the board uses. Images load on demand and redraw
 * when ready. Several records draw as they sit on the desktop, so a cluster
 * reads as the little scene it is.
 */
export function renderThumb(canvas: HTMLCanvasElement, records: ShapeRecord[], assets: AssetRecord[], theme: 'light' | 'dark') {
  const store = new Store()
  store.transact(() => {
    for (const a of assets) store.put(a, 'remote')
    for (const r of records) store.put(r, 'remote')
  }, 'remote')
  const t = themeOf(theme)
  const sorted = [...records].sort((a, b) => a.z - b.z)
  const draw = () => {
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth || 160
    const h = canvas.clientHeight || 120
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const b = unionBounds(sorted)
    if (!b) return
    const margin = 12
    const z = Math.min((w - margin * 2) / Math.max(b.w, 1), (h - margin * 2) / Math.max(b.h, 1), 1.5)
    const ox = (w - b.w * z) / 2 - b.x * z
    const oy = (h - b.h * z) / 2 - b.y * z
    ctx.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr)
    for (const r of sorted) drawShape(ctx, r, { theme: t, store, zoom: z, onAssetLoad: draw })
  }
  draw()
}

export function unionBounds(records: ShapeRecord[]): Bounds | null {
  let b: Bounds | null = null
  for (const r of records) {
    const pb = pageBounds(r)
    if (!b) b = { ...pb }
    else {
      const x = Math.min(b.x, pb.x)
      const y = Math.min(b.y, pb.y)
      b = { x, y, w: Math.max(b.x + b.w, pb.x + pb.w) - x, h: Math.max(b.y + b.h, pb.y + pb.h) - y }
    }
  }
  return b
}

/** The empty space between two boxes (0 when they touch or overlap). */
export function gapBetween(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
  return Math.hypot(dx, dy)
}
