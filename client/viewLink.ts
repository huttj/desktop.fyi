import { pageBounds, type Editor } from '@quickdrawjs/core'

/** A shareable view: the page point at the middle of the screen, plus zoom; or an item to frame. */
export type View = { kind: 'camera'; x: number; y: number; z: number } | { kind: 'item'; id: string }

const VIEW_RE = /^#v=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/
const ITEM_RE = /^#i=([A-Za-z0-9:_-]{1,96})$/

export function parseView(hash: string): View | null {
  const m = VIEW_RE.exec(hash)
  if (m) {
    const view = { kind: 'camera' as const, x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
    return Number.isFinite(view.x) && Number.isFinite(view.y) && view.z > 0 ? view : null
  }
  const i = ITEM_RE.exec(hash)
  if (i) return { kind: 'item', id: i[1]! }
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

/** Applies a deep link. Returns false when it names an item that is not on the board (yet). */
export function applyView(editor: Editor, view: View): boolean {
  const { w, h } = editor.viewSize()
  if (view.kind === 'camera') {
    editor.setCamera({ x: w / (2 * view.z) - view.x, y: h / (2 * view.z) - view.y, z: view.z })
    return true
  }
  const shape = editor.store.get(view.id)
  if (!shape || shape.typeName !== 'shape') return false
  const b = pageBounds(shape)
  const z = Math.min(1, Math.min(w / (b.w + 200), h / (b.h + 200)))
  editor.setCamera({ x: w / (2 * z) - (b.x + b.w / 2), y: h / (2 * z) - (b.y + b.h / 2), z })
  editor.setSelection([shape.id])
  return true
}

export function viewLink(editor: Editor) {
  return `${window.location.origin}${window.location.pathname}${formatView(currentView(editor))}`
}

export function itemLink(handle: string, id: string) {
  return `/@${handle}#i=${encodeURIComponent(id)}`
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
