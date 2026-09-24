import { Store, drawShape, pageBounds, themeOf, type AssetRecord, type ShapeRecord } from '@quickdrawjs/core'

/**
 * Draws one Quickdraw record into a canvas, fitted with a margin, using the
 * same renderer the board uses. Images load on demand and redraw when ready.
 */
export function renderThumb(canvas: HTMLCanvasElement, record: ShapeRecord, asset: AssetRecord | undefined, theme: 'light' | 'dark') {
  const store = new Store()
  store.transact(() => {
    if (asset) store.put(asset, 'remote')
    store.put(record, 'remote')
  }, 'remote')
  const t = themeOf(theme)
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
    const b = pageBounds(record)
    const margin = 12
    const z = Math.min((w - margin * 2) / Math.max(b.w, 1), (h - margin * 2) / Math.max(b.h, 1), 1.5)
    const ox = (w - b.w * z) / 2 - b.x * z
    const oy = (h - b.h * z) / 2 - b.y * z
    ctx.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr)
    drawShape(ctx, record, { theme: t, store, zoom: z, onAssetLoad: draw })
  }
  draw()
}
