import { pageBounds, type Bounds, type Editor } from '@quickdrawjs/core'

/** A shareable view: the page point at the middle of the screen plus zoom, or one or more items to frame. */
export type View = { kind: 'camera'; x: number; y: number; z: number } | { kind: 'items'; ids: string[] }

const VIEW_RE = /^#v=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/
const ITEMS_RE = /^#i=([A-Za-z0-9:_,-]{1,4000})$/

export function parseView(hash: string): View | null {
  const m = VIEW_RE.exec(hash)
  if (m) {
    const view = { kind: 'camera' as const, x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
    return Number.isFinite(view.x) && Number.isFinite(view.y) && view.z > 0 ? view : null
  }
  const i = ITEMS_RE.exec(decodeURIComponent(hash))
  if (i) {
    const ids = i[1]!.split(',').filter(Boolean).slice(0, 60)
    return ids.length ? { kind: 'items', ids } : null
  }
  return null
}

export function currentView(editor: Editor) {
  const { w, h } = editor.viewSize()
  const c = editor.screenToPage(w / 2, h / 2)
  return { x: c.x, y: c.y, z: editor.camera.z }
}

export function formatView(view: { x: number; y: number; z: number }) {
  return `#v=${view.x.toFixed(1)},${view.y.toFixed(1)},${view.z.toFixed(3)}`
}

function union(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * Applies a deep link. Items are framed together (centred, zoomed to fit, selected).
 * Returns false when it names items that are not on the board (for this viewer).
 */
export interface Inset {
  left?: number
  top?: number
  bottom?: number
}

export function applyView(editor: Editor, view: View, { animate = 0, inset = {} as Inset } = {}): boolean {
  const { w: fullW, h: fullH } = editor.viewSize()
  // a panel covers part of the board (left on a desktop, bottom on a phone): frame things in what is left
  const insetLeft = inset.left ?? 0
  const insetTop = inset.top ?? 0
  const w = fullW - insetLeft
  const h = fullH - insetTop - (inset.bottom ?? 0)
  if (view.kind === 'camera') {
    editor.setCamera({ x: w / (2 * view.z) - view.x + insetLeft / view.z, y: h / (2 * view.z) - view.y + insetTop / view.z, z: view.z }, { animate })
    return true
  }
  const present = view.ids.filter((id) => editor.shapesSorted().some((s) => s.id === id))
  if (!present.length) return false
  let b: Bounds | null = null
  for (const id of present) b = union(b, pageBounds(editor.store.get(id) as Parameters<typeof pageBounds>[0]))
  const box = b!
  const pad = Math.min(240, Math.max(60, Math.min(w, h) * 0.2))
  const z = Math.max(0.1, Math.min(1, Math.min(w / (box.w + pad), h / (box.h + pad))))
  editor.setCamera({ x: w / (2 * z) - (box.x + box.w / 2) + insetLeft / z, y: h / (2 * z) - (box.y + box.h / 2) + insetTop / z, z }, { animate })
  // the hand only looks; the pointer picks things up
  if (editor.tool !== 'hand') editor.setSelection(present)
  return true
}

export function viewLink(editor: Editor) {
  return `${window.location.origin}${window.location.pathname}${formatView(currentView(editor))}`
}

export function itemsLink(handle: string, ids: string[]) {
  return `/@${handle}#i=${ids.map(encodeURIComponent).join(',')}`
}

/** Mirrors the camera into the URL hash (throttled) so the address bar is always a deep link. */
export function mirrorViewToHash(editor: Editor) {
  let timer = 0
  const write = () => {
    timer = 0
    const hash = formatView(currentView(editor))
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
  }
  return editor.on('camera', () => {
    if (!timer) timer = window.setTimeout(write, 250)
  })
}
