// The Quickdraw editor: camera, tools, selection, input and rendering over a
// Store. Framework-free — the React and React Native SDKs wrap it, plain
// pages use it bare, and every host gets the identical feel.
// Dependency-free ESM: runs in any modern browser as-is, no build step.

import { Store, newId } from './store.js'
import { themeOf, SIZES, FONT_SIZES, GEO_IDS, COLOR_IDS, GRID_IDS, GRID_STEP, GRID_MAJOR } from './palette.js'
import {
  localBounds, pageBounds, toLocal, drawShape, hitShape, marqueeHits,
  scaleShape, textLayout, noteLayout, NOTE_W, sampleLinePts, imageFrame,
  mapMarks, textLinkAt, textHitAt, urlBadgeAt, invalidateTextLayout, markAt, hasMark, setMark,
} from './shapes.js'
import { boundsUnion, boundsExpand, boundsContain, clamp, rotWith } from './geometry.js'
import { sceneToSvg } from './svg.js'
import { BINDABLE, insideShape, anchorAt, rebindArrow, remapBindings } from './bindings.js'
import { parseTldrawClipboard, convertTldrawContent } from './tldraw.js'
import { TextSurface } from './textedit.js'

const ZOOM_MIN = 0.05
const ZOOM_MAX = 8
const HANDLE = 8 // screen px
const RESIZE_CURSORS = {
  tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize',
  t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize',
}
const DEFAULT_STYLES = { color: 'blue', size: 'm', dash: 'draw', fill: 'none', font: 'draw', align: 'start' }
// the eight box handles as fractions of a box — crop mode and the rotated
// resize frame both hang theirs here
const BOX_HANDLES = {
  tl: [0, 0], t: [0.5, 0], tr: [1, 0], l: [0, 0.5], r: [1, 0.5], bl: [0, 1], b: [0.5, 1], br: [1, 1],
}
const CROP_MIN = 8 // page units — a crop window never collapses past this
// Rotation for a mouse: no knob, just a zone outside each corner where the
// cursor turns into a rotate arrow (tldraw's way). The zone reaches this
// far (screen px) from the corner, beyond the resize handle.
const ROTATE_ZONE = 24
// The rotate cursor: tldraw's own corner arrow (MIT), a data-URL SVG turned
// to sit against its corner — 0° for the top-left, a quarter turn more for
// each corner clockwise, plus the shape's rotation — with a soft shadow so
// it reads on any paper. Browsers have no rotate cursor of their own.
const ROTATE_CORNER_SVG =
  `<path d='M22.4789 9.45728L25.9935 12.9942L22.4789 16.5283V14.1032C18.126 14.1502 14.6071 17.6737 14.5675 22.0283H17.05L13.513 25.543L9.97889 22.0283H12.5674C12.6071 16.5691 17.0214 12.1503 22.4789 12.1031L22.4789 9.45728Z' fill='black'/>` +
  `<path fill-rule='evenodd' clip-rule='evenodd' d='M21.4789 7.03223L27.4035 12.9945L21.4789 18.9521V15.1868C18.4798 15.6549 16.1113 18.0273 15.649 21.0284H19.475L13.5128 26.953L7.55519 21.0284H11.6189C12.1243 15.8155 16.2679 11.6677 21.4789 11.1559L21.4789 7.03223ZM22.4789 12.1031C17.0214 12.1503 12.6071 16.5691 12.5674 22.0284H9.97889L13.513 25.543L17.05 22.0284H14.5675C14.5705 21.6896 14.5947 21.3558 14.6386 21.0284C15.1157 17.4741 17.9266 14.6592 21.4789 14.1761C21.8063 14.1316 22.1401 14.1069 22.4789 14.1032V16.5284L25.9935 12.9942L22.4789 9.45729L22.4789 12.1031Z' fill='white'/>`
const rotateCursors = new Map()
const rotateCursor = (deg) => {
  const d = ((Math.round(deg / 5) * 5) % 360 + 360) % 360
  let c = rotateCursors.get(d)
  if (c) return c
  const a = (-d * Math.PI) / 180
  const dx = Math.cos(a) - Math.sin(a), dy = Math.sin(a) + Math.cos(a)
  const svg =
    `<svg height='32' width='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'>` +
    `<defs><filter id='shadow' y='-40%' x='-40%' width='180px' height='180%' color-interpolation-filters='sRGB'>` +
    `<feDropShadow dx='${dx.toFixed(2)}' dy='${dy.toFixed(2)}' stdDeviation='1.2' flood-opacity='.5'/></filter></defs>` +
    `<g fill='none' transform='rotate(${d} 16 16)' filter='url(%23shadow)'>${ROTATE_CORNER_SVG}</g></svg>`
  c = `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}") 16 16, pointer`
  rotateCursors.set(d, c)
  return c
}
const LONG_PRESS = 500 // ms of a still touch before the context menu opens

export const ALIGN_MODES = ['left', 'center', 'right', 'top', 'middle', 'bottom']

export const TOOLS = ['select', 'hand', 'draw', 'highlight', 'eraser', 'laser', 'arrow', 'line', 'geo', 'text', 'note']

// local position of the bend handle: the curve's midpoint (chord midpoint
// when straight — sampleLinePts collapses to the two endpoints at bend 0)
const bendMidpoint = (pr) => {
  if (!pr.bend) return { x: pr.dx / 2, y: pr.dy / 2 }
  const mid = sampleLinePts(pr, pr.bend)
  const mi = Math.floor(mid.length / 4) * 2
  return { x: mid[mi], y: mid[mi + 1] }
}

export class Editor {
  constructor({ container, store, theme = 'light', grid = 'lines', readonly = false, camera, styles, geoKind } = {}) {
    this.container = container
    this.store = store || new Store()
    this.theme = themeOf(theme)
    this.grid = GRID_IDS.includes(grid) ? grid : 'lines'
    this.readonly = !!readonly
    this.camera = camera || { x: 0, y: 0, z: 1 }
    // Host hooks: decide per shape whether it is on the board at all (a
    // filtered-out shape is not drawn, hit, selected, fitted or exported)
    // and how opaque it draws (0..1). Both optional, read on every render.
    this.shapeFilter = null
    this.shapeAlpha = null
    this.styles = { ...DEFAULT_STYLES, ...(styles || {}) }
    this.geoKind = geoKind || 'rectangle'
    this.tool = 'select' // the pointer, like every desktop drawing tool
    this.selection = new Set()
    this.session = null
    this.editing = null // { id, textarea, field: 'text' | 'label' }
    // the group a double-click dived into: its members select one at a time
    this.focusedGroup = null
    this.cropping = null // { id } while an image is in crop mode
    this.bindHover = null // the shape an arrow end being dragged would tie to
    this.scribbles = [] // local laser strokes
    this.remoteScribbles = []
    this.remoteScribblesAt = 0
    this.spaceHeld = false
    this.captureCanvas = null
    // pen mode: once a stylus is seen, fingers stop drawing — a resting palm
    // is ignored, two fingers still steer the camera. setPenMode(false) opts
    // back out; auto-arm happens only once so that choice sticks.
    this.penMode = false
    this._penSeen = false
    // a coarse pointer (touch) can't hover a corner zone: it keeps the
    // rotate knob. The media query decides, and any touch seen confirms it.
    this._coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches
    this._penDown = false
    this._events = new Map()
    this._raf = 0
    this._camAnim = 0
    this._pointers = new Map()
    this._ptrType = new Map() // pointerId -> pointerType, for pen-mode gating
    this._destroyed = false

    // DOM
    container.classList.add('qd-root')
    container.tabIndex = 0
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'qd-canvas'
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'qd-overlay'
    container.prepend(this.overlay)
    container.prepend(this.canvas)

    this._bind()
    this._unsubStore = this.store.listen(() => {
      this._pruneSelection()
      this.requestRender()
      this.emit('change')
    })
    // history moves on its own channel: the end of a gesture batch changes
    // canUndo/canRedo without emitting a document diff
    this._unsubHistory = this.store.listenHistory(() => this.emit('history'))
    // bound arrows follow their shapes inside the same transaction
    this._unsubReact = this.store.react((diff) => this._reactBindings(diff))
    this.requestRender()
  }

  // ---- events --------------------------------------------------------------
  on(ev, fn) {
    if (!this._events.has(ev)) this._events.set(ev, new Set())
    this._events.get(ev).add(fn)
    return () => this._events.get(ev).delete(fn)
  }
  emit(ev, ...args) {
    const s = this._events.get(ev)
    if (s) for (const fn of [...s]) { try { fn(...args) } catch (e) { console.warn('board event failed', e) } }
  }

  // ---- camera --------------------------------------------------------------
  viewSize() {
    return { w: this.container.clientWidth || 1, h: this.container.clientHeight || 1 }
  }
  screenToPage(sx, sy) {
    const c = this.camera
    return { x: sx / c.z - c.x, y: sy / c.z - c.y }
  }
  pageToScreen(px, py) {
    const c = this.camera
    return { x: (px + c.x) * c.z, y: (py + c.y) * c.z }
  }
  viewportPageBounds() {
    const { w, h } = this.viewSize()
    const c = this.camera
    return { x: -c.x, y: -c.y, w: w / c.z, h: h / c.z }
  }
  setCamera(cam, { animate = 0 } = {}) {
    this._cancelFitEase()
    cancelAnimationFrame(this._camAnim)
    if (!animate) {
      this.camera = { ...cam }
      this._afterCamera()
      return
    }
    const from = { ...this.camera }
    const t0 = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - t0) / animate)
      const e = 1 - Math.pow(1 - t, 3)
      this.camera = {
        x: from.x + (cam.x - from.x) * e,
        y: from.y + (cam.y - from.y) * e,
        z: from.z + (cam.z - from.z) * e,
      }
      this._afterCamera()
      if (t < 1) this._camAnim = requestAnimationFrame(step)
    }
    this._camAnim = requestAnimationFrame(step)
  }
  _afterCamera() {
    this.requestRender()
    this.emit('camera')
  }
  pan(dxScreen, dyScreen) {
    const c = this.camera
    this.setCamera({ ...c, x: c.x + dxScreen / c.z, y: c.y + dyScreen / c.z })
  }
  zoomAt(sx, sy, mult, opts) {
    const c = this.camera
    const z = clamp(c.z * mult, ZOOM_MIN, ZOOM_MAX)
    const p = this.screenToPage(sx, sy)
    this.setCamera({ z, x: sx / z - p.x, y: sy / z - p.y }, opts)
  }
  contentBounds() {
    let b = null
    for (const s of this.shapesSorted()) b = boundsUnion(b, pageBounds(s))
    return b
  }
  // Re-fit the camera to the drawn content with a margin — the transition
  // companion. Zoom capped at 1:1 so a lone small mark doesn't blow up.
  // `ease` (ms): one rAF loop owns the camera for the whole beat — the fit
  // target re-reads the live-resizing frame every frame, the camera's
  // starting offset from it decays once, and the render happens in the same
  // frame as the camera write. Resize ticks that arrive while the ease is
  // running are no-ops; a second driver on another clock reads as judder.
  fitContent({ margin = 0.08, maxZoom = 1, animate = 0, ease = 0 } = {}) {
    // called before the container has layout (mount effects, hidden tabs):
    // defer until the first render tick that sees real dimensions, or the
    // camera would clamp to minimum zoom and strand the drawing microscopic
    if (this._deferFit(() => this.fitContent({ margin, maxZoom, animate, ease }))) return
    const fitNow = () => {
      const b = this.contentBounds()
      if (!b || b.w <= 0 || b.h <= 0) return null
      const { w, h } = this.viewSize()
      const inset = Math.min(w, h) * margin
      const z = clamp(Math.min(maxZoom, (w - inset * 2) / b.w, (h - inset * 2) / b.h), ZOOM_MIN, ZOOM_MAX)
      if (!isFinite(z) || z <= 0) return null
      return { z, x: w / 2 / z - (b.x + b.w / 2), y: h / 2 / z - (b.y + b.h / 2) }
    }
    if (!ease) {
      const fit = fitNow()
      if (fit) this.setCamera(fit, { animate })
      return
    }
    this._easeToFit(fitNow, ease)
  }
  // Fit an explicit page rect into the view — e.g. a remote peer's viewport,
  // mirrored live. Cover-fit: the rect's center stays centered and the
  // frame fills edge to edge, so differing aspect ratios crop rather than
  // letterbox. `ease` tracks a live frame resize exactly like fitContent's.
  followBounds(b, { animate = 0, ease = 0 } = {}) {
    if (!b || !(b.w > 0) || !(b.h > 0)) return
    if (this._deferFit(() => this.followBounds(b, { animate, ease }))) return
    const fitNow = () => {
      const { w, h } = this.viewSize()
      const z = clamp(Math.max(w / b.w, h / b.h), ZOOM_MIN, ZOOM_MAX)
      if (!isFinite(z) || z <= 0) return null
      return { z, x: w / 2 / z - (b.x + b.w / 2), y: h / 2 / z - (b.y + b.h / 2) }
    }
    if (!ease) {
      const fit = fitNow()
      if (fit) this.setCamera(fit, { animate })
      return
    }
    this._easeToFit(fitNow, ease)
  }
  // true (and remembers the retry) while the container has no layout yet;
  // render() replays the latest pending fit once real dimensions appear
  _deferFit(retry) {
    const { w, h } = this.viewSize()
    if (w > 1 && h > 1) return false
    this._pendingFit = retry
    return true
  }
  // one rAF loop owns the camera for the whole beat: the fit target re-reads
  // the live-resizing frame every frame, the starting offset decays once
  _easeToFit(fitNow, ease) {
    if (this._fitEase) return // the loop below is already tracking the frame
    const fit0 = fitNow()
    if (!fit0) return
    const c = this.camera
    const fe = this._fitEase = { t0: 0, dur: ease, dx: c.x - fit0.x, dy: c.y - fit0.y, dz: c.z - fit0.z }
    cancelAnimationFrame(this._camAnim)
    const step = (now) => {
      if (this._fitEase !== fe || this._destroyed) return
      if (!fe.t0) fe.t0 = now
      const t = Math.min(1, (now - fe.t0) / fe.dur)
      const e = 1 - Math.pow(1 - t, 3)
      const fit = fitNow()
      if (fit) {
        this.camera = {
          z: fit.z + fe.dz * (1 - e),
          x: fit.x + fe.dx * (1 - e),
          y: fit.y + fe.dy * (1 - e),
        }
        this.render()
        this.emit('camera')
      }
      if (t < 1) this._fitEaseRaf = requestAnimationFrame(step)
      else this._fitEase = null
    }
    this._fitEaseRaf = requestAnimationFrame(step)
  }
  _cancelFitEase() {
    this._fitEase = null
    cancelAnimationFrame(this._fitEaseRaf)
  }
  // ---- tools / styles ------------------------------------------------------
  setTool(tool) {
    if (!TOOLS.includes(tool)) return
    this._commitText()
    this.endCrop()
    this.tool = tool
    if (tool !== 'select') this.setSelection([])
    this._syncCursor()
    this.emit('tool')
    this.requestRender()
  }
  setGeoKind(kind) {
    if (GEO_IDS.includes(kind)) { this.geoKind = kind; this.emit('tool') }
  }
  setTheme(id) {
    const t = themeOf(id)
    if (t === this.theme) return
    this._crossfadeTheme()
    this.theme = t
    this.container.dataset.qdTheme = t.id
    this.requestRender()
    this.emit('theme')
  }
  // Freeze the outgoing theme as a bitmap over the board and fade it out, so
  // a theme switch melts from one paper to the other instead of hard-cutting.
  _crossfadeTheme() {
    if (this._destroyed) return
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const w = this.canvas.width, h = this.canvas.height
    if (!w || !h) return
    try {
      const snap = document.createElement('canvas')
      snap.width = w
      snap.height = h
      snap.getContext('2d').drawImage(this.canvas, 0, 0)
      snap.className = 'qd-theme-fade'
      this._themeFade?.remove()
      this._themeFade = snap
      this.overlay.after(snap)
      // two frames: one to paint at full opacity, one to start the transition
      requestAnimationFrame(() => requestAnimationFrame(() => { snap.style.opacity = '0' }))
      const done = () => {
        snap.remove()
        if (this._themeFade === snap) this._themeFade = null
      }
      snap.addEventListener('transitionend', done, { once: true })
      setTimeout(done, 600) // safety net if transitionend never fires
    } catch {
      // a stubbed 2D context (tests, exotic embeds) just skips the fade
    }
  }
  // 'none' | 'lines' | 'dots' — the backdrop behind the drawing
  setGrid(id) {
    if (!GRID_IDS.includes(id) || id === this.grid) return
    this.grid = id
    this.requestRender()
    this.emit('grid')
  }
  setReadonly(ro) {
    this.readonly = !!ro
    if (ro) { this._cancelSession(); this._commitText(); this.endCrop(); this.setSelection([]) }
    this._syncCursor()
  }
  setPenMode(on) {
    on = !!on
    if (this.penMode === on) return
    this.penMode = on
    this.emit('penmode')
  }
  // pointers eligible for the two-finger pinch: in pen mode the pen itself
  // never counts — only fingers steer the camera
  _pinchPoints() {
    const pts = []
    for (const [id, p] of this._pointers) {
      if (this.penMode && this._ptrType.get(id) === 'pen') continue
      pts.push(p)
    }
    return pts
  }
  setStyle(key, value) {
    this.styles = { ...this.styles, [key]: value }
    if (this.selection.size) {
      const APPLIES = {
        color: ['draw', 'highlight', 'geo', 'arrow', 'line', 'text', 'note'],
        size: ['draw', 'highlight', 'geo', 'arrow', 'line', 'text', 'note'],
        dash: ['draw', 'geo', 'arrow', 'line'],
        fill: ['geo'],
        font: ['text', 'note', 'geo'],
        align: ['text', 'note'],
      }
      this.store.transact(() => {
        for (const id of this.selection) {
          const s = this.store.get(id)
          if (s && APPLIES[key]?.includes(s.type)) this.store.update(id, { props: { [key]: value } })
        }
      })
    }
    this.emit('styles')
  }
  // shared styles of the selection (null value = mixed), or the pen styles
  currentStyles() {
    if (!this.selection.size) return { ...this.styles }
    const out = {}
    for (const id of this.selection) {
      const s = this.store.get(id)
      if (!s) continue
      for (const k of ['color', 'size', 'dash', 'fill', 'font', 'align']) {
        // a note without an align is a centred note
        const v = k === 'align' && s.type === 'note' ? (s.props.align ?? 'middle') : s.props[k]
        if (v === undefined) continue
        if (!(k in out)) out[k] = v
        else if (out[k] !== v) out[k] = null
      }
    }
    return { ...this.styles, ...out }
  }

  // ---- selection -----------------------------------------------------------
  setSelection(ids) {
    this.selection = new Set(ids)
    this.requestRender()
    this.emit('selection')
  }
  _pruneSelection() {
    let dirty = false
    for (const id of this.selection) if (!this.store.has(id)) { this.selection.delete(id); dirty = true }
    if (dirty) this.emit('selection')
  }
  selectionBounds() {
    let b = null
    for (const id of this.selection) {
      const s = this.store.get(id)
      if (s) b = boundsUnion(b, pageBounds(s))
    }
    return b
  }
  deleteSelection() {
    if (!this.selection.size) return
    this.store.remove([...this.selection])
    this.setSelection([])
  }
  // Empties the board in one undoable step (⇧⌘⌫, or the board menu).
  clearBoard() {
    if (!this.store.ids().length) return
    this._cancelSession()
    this._commitText()
    this.store.clear()
    this.setSelection([])
  }
  selectAll() {
    if (this.tool !== 'select') this.setTool('select')
    this.setSelection(this.shapesSorted().map((s) => s.id))
  }
  duplicateSelection(offset = 16) {
    if (!this.selection.size) return
    const ids = []
    let z = this.store.maxZ()
    const groups = {} // copies of a group stay a group — a fresh one
    const idMap = {} // arrows tied to shapes copied alongside stay tied — to the copies
    for (const id of this.selection) if (this.store.has(id)) idMap[id] = newId()
    this.store.transact(() => {
      for (const id of this.selection) {
        const s = this.store.get(id)
        if (!s || s.typeName === 'asset') continue
        const copy = { ...s, id: idMap[id], x: s.x + offset, y: s.y + offset, z: ++z, props: remapBindings(s.props, idMap) }
        if (s.groupId) copy.groupId = groups[s.groupId] ||= newId('group')
        this.store.put(copy)
        ids.push(copy.id)
      }
    })
    this.setSelection(ids)
  }

  // ---- groups --------------------------------------------------------------
  // A group is a shared `groupId` on its members — no container record, so
  // the flat store keeps its one-level shape and every reader of the wire
  // format keeps working. Selecting any member selects them all; a
  // double-click focuses the group so its members can be picked one by one.
  groupMembers(groupId) {
    return this.store.shapes().filter((s) => s.groupId === groupId).map((s) => s.id)
  }
  // the given ids plus every sibling of a grouped one — unless that group is
  // the focused one, where a member stands alone
  _withGroups(ids) {
    const out = new Set()
    for (const id of ids) {
      const s = this.store.get(id)
      if (!s) continue
      out.add(id)
      if (s.groupId && s.groupId !== this.focusedGroup) for (const m of this.groupMembers(s.groupId)) out.add(m)
    }
    return [...out]
  }
  // groups in the selection, and whether it can be grouped / ungrouped
  selectionGroups() {
    const g = new Set()
    for (const id of this.selection) { const s = this.store.get(id); if (s?.groupId) g.add(s.groupId) }
    return [...g]
  }
  canGroup() {
    if (this.selection.size < 2) return false
    // already exactly one whole group: nothing to do
    const g = this.selectionGroups()
    return !(g.length === 1 && this.groupMembers(g[0]).length === this.selection.size &&
      [...this.selection].every((id) => this.store.get(id)?.groupId === g[0]))
  }
  canUngroup() { return this.selectionGroups().length > 0 }
  groupSelection() {
    if (!this.canGroup()) return
    const ids = [...this.selection].filter((id) => this.store.has(id))
    const groupId = newId('group')
    // members of touched groups come along — groups are flat, so a group of
    // groups merges into one
    const all = new Set(ids)
    for (const g of this.selectionGroups()) for (const m of this.groupMembers(g)) all.add(m)
    this.store.transact(() => { for (const id of all) this.store.update(id, { groupId }) })
    this.focusedGroup = null
    this.setSelection([...all])
  }
  ungroupSelection() {
    const ids = new Set()
    for (const g of this.selectionGroups()) for (const m of this.groupMembers(g)) ids.add(m)
    if (!ids.size) return
    this.store.transact(() => {
      for (const id of ids) {
        const { groupId, ...rest } = this.store.get(id)
        this.store.put(rest)
      }
    })
    this.focusedGroup = null
    this.setSelection([...this.selection])
  }
  _groupBounds(groupId) {
    let b = null
    for (const id of this.groupMembers(groupId)) b = boundsUnion(b, pageBounds(this.store.get(id)))
    return b
  }

  // ---- z order -------------------------------------------------------------
  // The selection moves as a block, relative order kept. A one-step move hops
  // the block over its nearest unselected neighbour and lands on fractional
  // z between the shapes around it — only the moved shapes change, so the
  // diff stays small for sync.
  bringToFront() { this._reorder(1, true) }
  sendToBack() { this._reorder(-1, true) }
  bringForward() { this._reorder(1, false) }
  sendBackward() { this._reorder(-1, false) }
  _reorder(dir, toEnd) {
    const sel = this.selection
    if (!sel.size) return
    const list = this.shapesSorted()
    const moves = [] // [picked[], below, above]
    {
      const picked = list.filter((s) => sel.has(s.id))
      const rest = list.filter((s) => !sel.has(s.id))
      if (!picked.length || !rest.length) return
      let below = null, above = null // the unselected neighbours the block lands between
      if (toEnd) {
        if (dir > 0) below = rest[rest.length - 1]
        else above = rest[0]
      } else if (dir > 0) {
        // past the first unselected shape above the lowest selected one
        const from = list.indexOf(picked[0])
        below = list.slice(from + 1).find((s) => !sel.has(s.id))
        if (!below) return // already on top
        above = rest[rest.indexOf(below) + 1] || null
      } else {
        const from = list.indexOf(picked[picked.length - 1])
        above = list.slice(0, from).reverse().find((s) => !sel.has(s.id))
        if (!above) return // already at the bottom
        below = rest[rest.indexOf(above) - 1] || null
      }
      moves.push([picked, below, above])
    }
    if (!moves.length) return
    this.store.transact(() => {
      for (const [picked, below, above] of moves) {
        const n = picked.length
        if (below && above && above.z - below.z < 1e-6 * (n + 1)) {
          // the gap has been halved too many times to split again: give every
          // shape a whole number and start over on clean ground
          this.shapesSorted().forEach((s, i) => this.store.update(s.id, { z: i + 1 }))
          return this._reorder(dir, toEnd)
        }
        picked.forEach((s, k) => {
          const z = !below ? above.z - (n - k)
            : !above ? below.z + k + 1
              : below.z + ((above.z - below.z) * (k + 1)) / (n + 1)
          this.store.update(s.id, { z })
        })
      }
    })
  }

  // ---- align / distribute --------------------------------------------------
  // Units: a group moves as one block, everything else on its own. Bounds
  // are page-space, rotation included, so rotated shapes line up on what
  // you see.
  _selectionUnits() {
    const units = new Map()
    for (const id of this.selection) {
      const s = this.store.get(id)
      if (!s) continue
      const key = s.groupId && s.groupId !== this.focusedGroup ? 'g:' + s.groupId : 's:' + id
      const u = units.get(key) || { ids: [], b: null }
      u.ids.push(id)
      u.b = boundsUnion(u.b, pageBounds(s))
      units.set(key, u)
    }
    return [...units.values()]
  }
  // mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  alignSelection(mode) {
    if (!ALIGN_MODES.includes(mode)) return
    const units = this._selectionUnits()
    if (units.length < 2) return
    let all = null
    for (const u of units) all = boundsUnion(all, u.b)
    this.store.transact(() => {
      for (const { ids, b } of units) {
        const dx = mode === 'left' ? all.x - b.x
          : mode === 'center' ? all.x + all.w / 2 - (b.x + b.w / 2)
            : mode === 'right' ? all.x + all.w - (b.x + b.w) : 0
        const dy = mode === 'top' ? all.y - b.y
          : mode === 'middle' ? all.y + all.h / 2 - (b.y + b.h / 2)
            : mode === 'bottom' ? all.y + all.h - (b.y + b.h) : 0
        this._nudge(ids, dx, dy)
      }
    })
  }
  // axis: 'horizontal' | 'vertical' — even gaps between neighbours, the two
  // outermost stay where they are
  distributeSelection(axis) {
    const h = axis === 'horizontal'
    const units = this._selectionUnits()
    if (units.length < 3) return
    const mid = (b) => (h ? b.x + b.w / 2 : b.y + b.h / 2)
    const size = (b) => (h ? b.w : b.h)
    const pos = (b) => (h ? b.x : b.y)
    units.sort((a, b) => mid(a.b) - mid(b.b))
    const first = units[0].b, last = units[units.length - 1].b
    const span = pos(last) + size(last) - pos(first)
    const inner = units.reduce((n, u) => n + size(u.b), 0)
    const gap = (span - inner) / (units.length - 1)
    this.store.transact(() => {
      let cursor = pos(first) + size(first)
      for (let i = 1; i < units.length - 1; i++) {
        const u = units[i]
        const target = cursor + gap
        const d = target - pos(u.b)
        this._nudge(u.ids, h ? d : 0, h ? 0 : d)
        cursor = target + size(u.b)
      }
    })
  }
  _nudge(ids, dx, dy) {
    if (!dx && !dy) return
    for (const id of ids) {
      const s = this.store.get(id)
      if (s) this.store.update(id, { x: s.x + dx, y: s.y + dy })
    }
  }

  shapesSorted() {
    // plain z order, highlights included: their multiply blend makes a
    // highlight look the same over ink as under it, and keeps it on top of
    // a picture it was drawn over — the marker-on-paper feel without a
    // separate layer (tldraw does the same)
    const f = this.shapeFilter
    const list = f ? this.store.shapes().filter((s) => f(s)) : this.store.shapes()
    return list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
  }
  // The shape under a page point, topmost first. `inside` (the select tool)
  // also takes the empty middle of a hollow shape, and the empty space
  // inside a group's frame, as a hit — the smallest such body wins, so a
  // box inside a box picks the inner one. The eraser leaves that off: a
  // sweep through an empty box shouldn't take the box.
  hitTest(px, py, { inside = false } = {}) {
    const tol = 8 / this.camera.z
    const list = this.shapesSorted()
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitShape(list[i], px, py, tol, this.store)) return list[i]
    }
    if (!inside) return null
    let best = null, bestArea = Infinity
    for (const s of list) {
      if (s.type !== 'geo' || s.props.fill !== 'none') continue
      const area = s.props.w * s.props.h
      if (area < bestArea && insideShape(s, px, py)) { best = s; bestArea = area }
    }
    if (best) return best
    const seen = new Set()
    for (const s of list) {
      if (!s.groupId || seen.has(s.groupId)) continue
      seen.add(s.groupId)
      const b = this._groupBounds(s.groupId)
      if (b && boundsContain(b, px, py) && b.w * b.h < bestArea) { best = s; bestArea = b.w * b.h }
    }
    return best
  }

  // ---- input ---------------------------------------------------------------
  _bind() {
    const c = this.container
    this._onDown = (e) => this._pointerDown(e)
    this._onMove = (e) => this._pointerMove(e)
    this._onUp = (e) => this._pointerUp(e)
    this._onWheel = (e) => this._wheel(e)
    this._onKeyDown = (e) => this._keyDown(e)
    this._onKeyUp = (e) => this._keyUp(e)
    this._onDblClick = (e) => this._dblClick(e)
    this._onDrop = (e) => this._drop(e)
    this._onDragOver = (e) => { e.preventDefault(); e.stopPropagation() }
    this._onPaste = (e) => this._paste(e)
    this._onContextMenu = (e) => this._contextMenu(e)
    c.addEventListener('contextmenu', this._onContextMenu)
    c.addEventListener('pointerdown', this._onDown)
    c.addEventListener('pointermove', this._onMove)
    c.addEventListener('pointerup', this._onUp)
    c.addEventListener('pointercancel', this._onUp)
    c.addEventListener('wheel', this._onWheel, { passive: false })
    c.addEventListener('keydown', this._onKeyDown)
    c.addEventListener('keyup', this._onKeyUp)
    c.addEventListener('dblclick', this._onDblClick)
    c.addEventListener('drop', this._onDrop)
    c.addEventListener('dragover', this._onDragOver)
    c.addEventListener('paste', this._onPaste)
    // losing focus mid-gesture (a host app may reclaim the space key by
    // blurring the board) must not leave a sticky space-pan behind
    this._onBlur = () => { this.spaceHeld = false; this._syncCursor() }
    c.addEventListener('blur', this._onBlur)
    // ⌘= / ⌘- / ⌘0 zoom the board, never the page — wherever focus is,
    // unless it's in a field that isn't ours
    this._onDocKey = (e) => this._docKey(e)
    document.addEventListener('keydown', this._onDocKey, true)
    // a browser without overflow: clip may still scroll the board to chase a
    // caret; put it straight back
    this._onScroll = () => { if (c.scrollLeft || c.scrollTop) { c.scrollLeft = 0; c.scrollTop = 0 } }
    c.addEventListener('scroll', this._onScroll)
    this._ro = new ResizeObserver(() => this.requestRender())
    this._ro.observe(c)
    // web fonts landing after the first paint: re-measure and redraw
    this._onFonts = () => { invalidateTextLayout(); this.requestRender() }
    document.fonts?.addEventListener?.('loadingdone', this._onFonts)
  }

  _evPoint(e) {
    const r = this.container.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  _pointerDown(e) {
    if (this.readonly) return
    if (e.target !== this.canvas && e.target !== this.overlay && e.target !== this.container) return
    if (e.button === 2) return
    if (this.editing) this._commitText()
    this.container.focus({ preventScroll: true })
    const s = this._evPoint(e)
    this._pointers.set(e.pointerId, s)
    this._ptrType.set(e.pointerId, e.pointerType)
    try { this.container.setPointerCapture(e.pointerId) } catch {}

    if (e.pointerType === 'touch' && !this._coarse) { this._coarse = true; this.requestRender() }
    if (e.pointerType === 'pen') {
      this._penDown = true
      // first stylus contact arms pen mode, once — turning it off is a choice
      if (!this._penSeen) { this._penSeen = true; this.setPenMode(true) }
    }

    // second finger: the gesture becomes a pinch — a just-started stroke is
    // taken back, it was the start of a zoom, not a mark. While the pen is
    // down in pen mode, landing fingers are a resting palm, never a pinch.
    if (!this.penMode || e.pointerType !== 'pen') {
      const pp = this._pinchPoints()
      if (pp.length === 2 && !(this.penMode && this._penDown)) {
        this._abortForPinch()
        const [a, b] = pp
        this.session = {
          type: 'pinch',
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          cam: { ...this.camera },
        }
        return
      }
      if (pp.length > 2) return
    }
    // in pen mode a finger never draws
    if (this.penMode && e.pointerType === 'touch') return
    if (this._pointers.size > 2) return
    if (this.session?.type === 'pinch') return

    const p = this.screenToPage(s.x, s.y)
    if (e.button === 1 || this.spaceHeld || this.tool === 'hand') {
      this.session = { type: 'panning', last: s }
      this._syncCursor('grabbing')
      return
    }

    switch (this.tool) {
      case 'draw':
      case 'highlight': return this._beginDraw(e, p)
      case 'eraser': return this._beginErase(p)
      case 'laser': return this._beginLaser(p)
      case 'arrow':
      case 'line': return this._beginLineish(this.tool, p, e)
      case 'geo': return this._beginGeo(p, e)
      // placing waits for pointerup: the textarea we focus would otherwise be
      // blurred again by the browser's default focus-on-mousedown action
      case 'text':
      case 'note':
        this.session = { type: 'placing', tool: this.tool, page: p }
        return
      case 'select': return this._beginSelect(e, s, p)
    }
  }

  _pointerMove(e) {
    if (this.readonly) return
    if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, this._evPoint(e))
    const ss = this.session
    if (!ss) {
      this._hoverCursor(e)
      return
    }
    // in pen mode a finger only ever steers the camera — a palm dragging
    // across the glass must not extend the pen's stroke
    if (this.penMode && e.pointerType === 'touch' && ss.type !== 'pinch' && ss.type !== 'panning') return
    const s = this._evPoint(e)
    const p = this.screenToPage(s.x, s.y)
    // a press that travels is a drag, not a long press
    if (this._pressTimer && ss.pressAt && Math.hypot(s.x - ss.pressAt.x, s.y - ss.pressAt.y) > 6) this._clearPressTimer()

    switch (ss.type) {
      case 'pinch': {
        const pp = this._pinchPoints()
        if (pp.length < 2) return
        const [a, b] = pp
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const z = clamp(ss.cam.z * (dist / ss.dist), ZOOM_MIN, ZOOM_MAX)
        // keep the page point under the initial pinch center pinned, then pan
        // with the center as it travels
        const p0 = { x: ss.center.x / ss.cam.z - ss.cam.x, y: ss.center.y / ss.cam.z - ss.cam.y }
        this.setCamera({ z, x: center.x / z - p0.x, y: center.y / z - p0.y })
        return
      }
      case 'panning': {
        this.pan(s.x - ss.last.x, s.y - ss.last.y)
        ss.last = s
        return
      }
      case 'drawing': return this._extendDraw(e, p)
      case 'erasing': return this._extendErase(p)
      case 'lasering': return this._extendLaser(p)
      case 'lineish': return this._dragLineish(p, e)
      case 'geo-create': return this._dragGeo(p, e)
      case 'marquee': {
        ss.rect = {
          x: Math.min(ss.origin.x, p.x), y: Math.min(ss.origin.y, p.y),
          w: Math.abs(p.x - ss.origin.x), h: Math.abs(p.y - ss.origin.y),
        }
        const hits = this._withGroups(this.shapesSorted().filter((sh) => marqueeHits(sh, ss.rect)).map((sh) => sh.id))
        this.setSelection(ss.additive ? [...new Set([...ss.base, ...hits])] : hits)
        return
      }
      case 'translating': return this._dragTranslate(p, e)
      case 'resizing': return this._dragResize(p, e)
      case 'rotating': return this._dragRotate(p, e)
      case 'handle': return this._dragHandle(p, e)
      case 'cropping': return this._dragCrop(p, e)
      case 'pressing': {
        if (Math.hypot(s.x - ss.start.x, s.y - ss.start.y) > 4) {
          // the press became a drag — start translating (alt = drag a copy);
          // a linked shape held for a drag gets selected now
          if (ss.link && ss.hit && !this.selection.has(ss.hit.id)) this.setSelection(ss.pick)
          this.session = null
          this._beginTranslate(ss.page, e)
          if (this.session) this._dragTranslate(p, e)
        }
        return
      }
    }
  }

  _pointerUp(e) {
    this._pointers.delete(e.pointerId)
    this._ptrType.delete(e.pointerId)
    if (e.pointerType === 'pen') this._penDown = false
    this._clearPressTimer()
    const ss = this.session
    if (!ss) return
    if (ss.type === 'pinch') {
      if (this._pinchPoints().length < 2) this.session = null
      return
    }
    // a palm lift in pen mode must not end the pen's live stroke
    if (this.penMode && e.pointerType === 'touch' && ss.type !== 'panning') return
    switch (ss.type) {
      case 'panning':
        this.session = null
        this._syncCursor()
        return
      case 'drawing': return this._endDraw()
      case 'erasing': return this._endErase()
      case 'lasering': return this._endLaser()
      case 'lineish': return this._endLineish()
      case 'geo-create': return this._endGeo()
      case 'marquee':
        this.session = null
        this.requestRender()
        return
      case 'translating': return this._endTranslate()
      case 'placing': {
        this.session = null
        ss.tool === 'note' ? this._placeNote(ss.page) : this._placeText(ss.page)
        return
      }
      case 'resizing':
      case 'rotating':
      case 'handle':
        this.store.endBatch()
        this.session = null
        this.bindHover = null
        this._syncCursor()
        this.requestRender()
        return
      case 'cropping':
        // the crop batch stays open until crop mode ends — many drags, one undo
        this.session = null
        this._syncCursor()
        this.requestRender()
        return
      case 'pressing': {
        // a clean click on a link follows it (a drag would have replaced
        // this session, so a linked shape still moves)
        if (ss.link) { this.session = null; openUrl(ss.link); return }
        // a clean click: selection settles to the pressed shape (or clears);
        // an additive click toggles — unless the down-stroke just added it
        if (ss.hit) this.setSelection(ss.additive ? (ss.added ? [...this.selection] : this._toggled(ss.pick)) : ss.pick)
        else if (!ss.additive) this.setSelection([])
        this.session = null
        return
      }
    }
  }

  // toggle a block (a shape, or a whole group) in and out of the selection
  _toggled(ids) {
    const next = new Set(this.selection)
    if (ids.every((id) => next.has(id))) for (const id of ids) next.delete(id)
    else for (const id of ids) next.add(id)
    return [...next]
  }
  _clearPressTimer() {
    clearTimeout(this._pressTimer)
    this._pressTimer = 0
  }

  _abortForPinch() {
    const ss = this.session
    if (!ss) return
    if (ss.type === 'drawing') {
      this.store.remove([ss.id])
      this.store.endBatch()
    } else if (ss.type === 'lineish' || ss.type === 'geo-create') {
      this.store.remove([ss.id])
      this.store.endBatch()
    } else if (['translating', 'resizing', 'rotating', 'handle', 'erasing'].includes(ss.type)) {
      this.store.endBatch()
    }
    // a cropping drag just stops; its batch belongs to crop mode
    this.session = null
    this.bindHover = null
    this._clearPressTimer()
  }
  _cancelSession() {
    this._abortForPinch()
    this.requestRender()
  }

  // ---- draw / highlight ----------------------------------------------------
  _beginDraw(e, p) {
    const type = this.tool
    const id = newId()
    this.store.beginBatch()
    const shape = {
      id, typeName: 'shape', type, x: p.x, y: p.y, rot: 0, z: this.store.maxZ() + 1,
      props: {
        pts: [0, 0, e.pressure || 0.5],
        color: this.styles.color,
        size: this.styles.size,
        // the pencil honors the line style too: 'draw' is pressure ink, the
        // others render as an even-width (dashed/dotted/solid) line
        ...(type === 'draw' ? { dash: this.styles.dash } : {}),
        done: false,
        ...(e.pointerType === 'pen' ? { isPen: true } : {}),
      },
    }
    this.store.put(shape)
    this.session = { type: 'drawing', id, last: p }
  }
  _extendDraw(e, p) {
    const ss = this.session
    const shape = this.store.get(ss.id)
    if (!shape) { this.session = null; return }
    const minD = 1.25 / this.camera.z
    if (Math.hypot(p.x - ss.last.x, p.y - ss.last.y) < minD) return
    ss.last = p
    // coalesced points ride along for pens — extra fidelity is free
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
    const pts = shape.props.pts.slice()
    for (const ce of evs.length ? evs : [e]) {
      const cp = this.screenToPage(...(() => { const r = this._evPoint(ce); return [r.x, r.y] })())
      pts.push(cp.x - shape.x, cp.y - shape.y, ce.pressure || 0.5)
    }
    this.store.update(ss.id, { props: { pts } })
  }
  _endDraw() {
    const ss = this.session
    if (this.store.get(ss.id)) this.store.update(ss.id, { props: { done: true } })
    this.store.endBatch()
    this.session = null
  }

  // ---- eraser --------------------------------------------------------------
  _beginErase(p) {
    this.session = { type: 'erasing', hits: new Set(), trail: [p.x, p.y], last: p }
    this._eraseAt(p)
    this.requestRender()
  }
  _extendErase(p) {
    const ss = this.session
    // test along the swept segment so fast swipes don't tunnel through shapes
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - ss.last.x, p.y - ss.last.y) / (6 / this.camera.z)))
    for (let i = 1; i <= steps; i++) {
      this._eraseAt({ x: ss.last.x + ((p.x - ss.last.x) * i) / steps, y: ss.last.y + ((p.y - ss.last.y) * i) / steps })
    }
    ss.trail.push(p.x, p.y)
    if (ss.trail.length > 40) ss.trail.splice(0, ss.trail.length - 40)
    ss.last = p
    this.requestRender()
  }
  _eraseAt(p) {
    const hit = this.hitTest(p.x, p.y)
    if (hit) this.session.hits.add(hit.id)
  }
  _endErase() {
    const hits = [...this.session.hits]
    this.session = null
    if (hits.length) this.store.remove(hits) // one transaction — one undo
    this.requestRender()
  }

  // ---- laser ---------------------------------------------------------------
  _beginLaser(p) {
    const stroke = { id: newId('scrib'), points: [{ x: p.x, y: p.y }], opacity: 1, done: false, at: performance.now() }
    this.scribbles.push(stroke)
    this.session = { type: 'lasering', stroke }
    this._laserTick()
    this.emit('scribbles')
  }
  _extendLaser(p) {
    const st = this.session.stroke
    st.points.push({ x: p.x, y: p.y })
    if (st.points.length > 220) st.points.splice(0, st.points.length - 220)
    st.at = performance.now()
    this.emit('scribbles')
    this.requestRender()
  }
  _endLaser() {
    this.session.stroke.done = true
    this.session.stroke.at = performance.now()
    this.session = null
    this.emit('scribbles')
  }
  _laserTick() {
    if (this._laserRaf) return
    const tick = () => {
      this._laserRaf = 0
      const now = performance.now()
      let dirty = false
      this.scribbles = this.scribbles.filter((st) => {
        if (!st.done) return true
        const age = now - st.at
        const o = 1 - Math.max(0, age - 250) / 850
        if (o !== st.opacity) { st.opacity = Math.max(0, o); dirty = true }
        return o > 0
      })
      if (dirty) { this.emit('scribbles'); this.requestRender() }
      if (this.scribbles.length || this.remoteScribbles.length) this._laserRaf = requestAnimationFrame(tick)
    }
    this._laserRaf = requestAnimationFrame(tick)
  }
  // remote laser (a collaborator's) — drawn like ours, kept fresh by the caller
  setRemoteScribbles(list) {
    this.remoteScribbles = list || []
    this.remoteScribblesAt = performance.now()
    this._laserTick()
    this.requestRender()
  }
  getScribbles() {
    return this.scribbles.map((s) => ({ points: s.points, opacity: s.opacity }))
  }

  // ---- line / arrow --------------------------------------------------------
  // An arrow drawn from inside a shape, or ended over one, ties itself to
  // it: the end rides the shape's outline and follows it from then on. ⌥
  // binds to the exact point instead of snapping to the shape's centre.
  _beginLineish(type, p, e) {
    const id = newId()
    this.store.beginBatch()
    const target = this._bindTarget(p, id)
    this.store.put({
      id, typeName: 'shape', type, x: p.x, y: p.y, rot: 0, z: this.store.maxZ() + 1,
      props: {
        dx: 0.01, dy: 0.01, bend: 0,
        color: this.styles.color, size: this.styles.size,
        dash: this.styles.dash === 'draw' ? 'solid' : this.styles.dash,
        ...(target ? { startBind: { id: target.id, ...anchorAt(target, p.x, p.y, { precise: e.altKey }) } } : {}),
      },
    })
    this.session = { type: 'lineish', id }
  }
  _dragLineish(p, e) {
    const s = this.store.get(this.session.id)
    if (!s) return
    let dx = p.x - s.x, dy = p.y - s.y
    if (e.shiftKey) {
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12)
      const len = Math.hypot(dx, dy)
      dx = Math.cos(a) * len
      dy = Math.sin(a) * len
    }
    this.store.update(s.id, { props: { dx, dy, ...this._endBinding(s, 'endBind', p, e) } })
  }
  _endLineish() {
    const s = this.store.get(this.session.id)
    this.session = null
    this.bindHover = null
    if (s && Math.hypot(s.props.dx, s.props.dy) < 2 / this.camera.z) this.store.remove([s.id])
    this.store.endBatch()
    if (s) { this.setTool('select'); this.setSelection([s.id]) }
  }
  // the topmost shape with a body under the page point — the one an arrow
  // end let go here would tie to
  _bindTarget(p, excludeId) {
    const list = this.shapesSorted()
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]
      if (s.id === excludeId || !BINDABLE.has(s.type)) continue
      if (insideShape(s, p.x, p.y)) return s
    }
    return null
  }
  // the props patch that ties (or frees) one end of `arrow` for a pointer at p
  _endBinding(arrow, key, p, e) {
    const target = this._bindTarget(p, arrow.id)
    this.bindHover = target ? target.id : null
    this.requestRender()
    if (!target) return arrow.props[key] ? { [key]: undefined } : {}
    return { [key]: { id: target.id, ...anchorAt(target, p.x, p.y, { precise: e.altKey }) } }
  }
  // arrows tied to shapes that moved, resized, rotated or vanished get
  // re-solved inside the same transaction (see Store.react)
  _reactBindings(diff) {
    const touched = new Set([...Object.keys(diff.updated), ...Object.keys(diff.removed), ...Object.keys(diff.added)])
    if (!touched.size) return
    for (const s of this.store.shapes()) {
      if (s.type !== 'arrow' && s.type !== 'line') continue
      const p = s.props
      if (!p.startBind && !p.endBind) continue
      if (!touched.has(s.id) && !(p.startBind && touched.has(p.startBind.id)) && !(p.endBind && touched.has(p.endBind.id))) continue
      const next = rebindArrow(s, this.store)
      if (next !== s) this.store.put(next)
    }
  }

  // ---- geo -----------------------------------------------------------------
  _beginGeo(p, e) {
    const id = newId()
    this.store.beginBatch()
    this.store.put({
      id, typeName: 'shape', type: 'geo', x: p.x, y: p.y, rot: 0, z: this.store.maxZ() + 1,
      props: {
        geo: this.geoKind, w: 1, h: 1,
        color: this.styles.color, size: this.styles.size,
        dash: this.styles.dash, fill: this.styles.fill, font: this.styles.font,
      },
    })
    this.session = { type: 'geo-create', id, origin: p, dragged: false }
  }
  _dragGeo(p, e) {
    const ss = this.session
    const s = this.store.get(ss.id)
    if (!s) return
    ss.dragged = true
    let w = p.x - ss.origin.x
    let h = p.y - ss.origin.y
    if (e.shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * m
      h = Math.sign(h || 1) * m
    }
    this.store.update(ss.id, {
      x: Math.min(ss.origin.x, ss.origin.x + w),
      y: Math.min(ss.origin.y, ss.origin.y + h),
      props: { w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) },
    })
  }
  _endGeo() {
    const ss = this.session
    this.session = null
    const s = this.store.get(ss.id)
    if (s && (!ss.dragged || s.props.w < 4 || s.props.h < 4)) {
      // a click drops a ready-made shape
      this.store.update(s.id, { x: s.x - 80, y: s.y - 80, props: { w: 160, h: 160 } })
    }
    this.store.endBatch()
    if (s) { this.setTool('select'); this.setSelection([s.id]) }
  }

  // ---- text / note ---------------------------------------------------------
  _placeText(p) {
    const id = newId()
    this.store.beginBatch()
    this.store.put({
      id, typeName: 'shape', type: 'text', x: p.x, y: p.y - FONT_SIZES[this.styles.size] * 0.66, rot: 0,
      z: this.store.maxZ() + 1,
      props: { text: '', color: this.styles.color, size: this.styles.size, font: this.styles.font, align: this.styles.align, autosize: true, scale: 1 },
    })
    this.setTool('select')
    this.setSelection([id])
    this._startTextEdit(id, 'text', { fresh: true })
  }
  _placeNote(p) {
    const id = newId()
    this.store.beginBatch()
    this.store.put({
      id, typeName: 'shape', type: 'note', x: p.x - NOTE_W / 2, y: p.y - NOTE_W / 2, rot: 0,
      z: this.store.maxZ() + 1,
      props: { text: '', color: this.styles.color === DEFAULT_STYLES.color || this.styles.color === 'black' ? 'yellow' : this.styles.color, size: 'm', font: this.styles.font, scale: 1 },
    })
    this.setTool('select')
    this.setSelection([id])
    this._startTextEdit(id, 'text', { fresh: true })
  }

  // The text surface: a real textarea floated over the canvas, styled to
  // match the render, so editing feels native (IME, selection, caret).
  // at: the page point of the double-click that opened the edit — the word
  // there gets selected (the caret lands there on whitespace); a third
  // quick click selects everything. Without it (Enter), all is selected.
  _startTextEdit(id, field, { fresh = false, at = null } = {}) {
    this._commitText()
    const shape = this.store.get(id)
    if (!shape) return
    if (!fresh) this.store.beginBatch()
    // the surface shows the text as it will be drawn, marks and all
    const ta = new TextSurface({ hlColor: this.theme.colors.yellow.note })
    ta.render(
      field === 'label' ? shape.props.label || '' : shape.props.text || '',
      (field === 'label' ? shape.props.labelMarks : shape.props.marks) || [],
    )
    this.container.appendChild(ta.el)
    // pending: marks toggled with nothing selected — they land on whatever
    // is typed next at that spot, and are forgotten when the caret moves
    this.editing = { id, field, textarea: ta, fresh, pending: {}, caret: ta.selectionStart }
    const ed = this.editing
    const mk = field === 'label' ? 'labelMarks' : 'marks'
    const sync = () => {
      const cur = this.store.get(id)
      if (!cur) return
      let text = ta.value, marks = ta.marks
      // a pasted tab would render eight columns wide here and one on the
      // canvas: make it spaces, keeping the caret where it was
      if (text.includes('\t')) {
        const at = ta.selectionStart
        const at2 = normalizeText(text.slice(0, at)).length
        const fixed = normalizeText(text)
        marks = mapMarks(marks, text, fixed) || []
        text = fixed
        ta.render(text, marks, [at2, at2])
      }
      const old = String((field === 'label' ? cur.props.label : cur.props.text) || '')
      // marks toggled with nothing selected land on what was just typed
      const keys = Object.keys(ed.pending)
      if (keys.length && text.length > old.length) {
        let a = 0
        while (a < old.length && a < text.length && old[a] === text[a]) a++
        const b2 = a + (text.length - old.length)
        for (const k of keys) marks = setMark(marks, a, b2, k, ed.pending[k])
        ta.render(text, marks)
      }
      const patch = field === 'label' ? { label: text } : { text }
      patch[mk] = marks.length ? marks : undefined
      this.store.update(id, { props: patch })
      ed.caret = ta.selectionStart
      this._layoutTextEditor()
      this.emit('edit')
    }
    ta.addEventListener('qdinput', sync)
    // the caret wandering off drops pending marks; the toolbar follows the selection
    const onCaret = () => {
      if (ta.selectionStart !== ed.caret || ta.selectionEnd !== ta.selectionStart) {
        if (Object.keys(ed.pending).length) ed.pending = {}
        ed.caret = ta.selectionStart
      }
      this.emit('edit')
    }
    for (const evn of ['keyup', 'mouseup', 'select', 'touchend']) ta.addEventListener(evn, onCaret)
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        this._commitText()
        this.container.focus({ preventScroll: true })
        return
      }
      // formatting, tldraw's keys: ⌘B / ⌘I / ⌘U, ⇧⌘X strike, ⌘E code,
      // ⇧⌘H highlight, ⌘K link
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.altKey) return
      const k = e.key.toLowerCase()
      const key = e.shiftKey ? { x: 's', h: 'hl' }[k] : { b: 'b', i: 'i', u: 'u', e: 'code' }[k]
      if (key) { e.preventDefault(); this.toggleMark(key); return }
      if (k === 'k' && !e.shiftKey) { e.preventDefault(); this.promptLink() }
    })
    ta.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      // the third click of a triple-click lands here, on the surface that
      // the double-click just opened: it selects everything
      if (ed.openedAt && performance.now() - ed.openedAt < 500) {
        const s = this._evPoint(e)
        if (Math.hypot(s.x - ed.openedAtPoint.x, s.y - ed.openedAtPoint.y) < 12) {
          e.preventDefault()
          ta.select()
          this.emit('edit')
        }
      }
      ed.openedAt = 0
    })
    ta.addEventListener('blur', () => this._commitText())
    this._layoutTextEditor()
    ta.focus()
    if (at && !fresh) {
      const l = toLocal(shape, at.x, at.y)
      const text = ta.value
      const hit = textHitAt(shape, l.x, l.y)
      if (!hit) ta.select()
      else if (hit.index >= 0 && /\S/.test(text[hit.index])) {
        // the word the point is on
        let s = hit.index, e = hit.index + 1
        while (s > 0 && /\S/.test(text[s - 1])) s--
        while (e < text.length && /\S/.test(text[e])) e++
        ta.setSelectionRange(s, e)
        ed.caret = s
      } else {
        // whitespace, or past the end: just the caret
        ta.setSelectionRange(hit.offset, hit.offset)
        ed.caret = hit.offset
      }
      ed.openedAt = performance.now()
      ed.openedAtPoint = this.pageToScreen(at.x, at.y)
    } else if (!fresh) ta.select()
    this.emit('edit')
    this.requestRender()
  }
  _layoutTextEditor() {
    const ed = this.editing
    if (!ed) return
    const shape = this.store.get(ed.id)
    if (!shape) return
    const z = this.camera.z
    const ta = ed.textarea
    let lay, w, h, align = 'left'
    let ox = 0, oy = 0 // where the surface sits inside the shape, page units
    if (shape.type === 'note') {
      lay = noteLayout(shape)
      const s = shape.props.scale || 1
      // anchor the surface where the canvas draws the (vertically centered)
      // text block, so committing doesn't jump the text — 20 = NOTE_PAD
      const yStart = Math.max(20, lay.boxH / 2 - lay.textH / 2)
      ox = 20 * s
      oy = yStart * s
      w = (lay.boxW - 40) * s
      h = lay.textH * s
      align = shape.props.align === 'start' ? 'left' : shape.props.align === 'end' ? 'right' : 'center'
      ta.style.font = `500 ${lay.fontSize * s * z}px ${lay.font}`
      ta.style.lineHeight = lay.lh * s * z + 'px'
    } else if (shape.type === 'geo' && ed.field === 'label') {
      const p = shape.props
      const fs = FONT_SIZES[p.labelSize || 's']
      const fam = FONTS[p.font || 'draw']
      ox = 8
      oy = 8
      w = p.w - 16
      h = p.h - 16
      align = 'center'
      ta.style.font = `500 ${fs * z}px ${fam}`
      ta.style.lineHeight = fs * 1.3 * z + 'px'
      ta.style.paddingTop = Math.max(0, (h * z) / 2 - fs * 1.3 * z) / 2 + 'px'
    } else {
      lay = textLayout(shape)
      w = Math.max(lay.w + 4, 40)
      h = lay.h + 4
      const p = shape.props
      align = p.align === 'middle' ? 'center' : p.align === 'end' ? 'right' : 'left'
      ta.style.font = `500 ${lay.fontSize * z}px ${lay.font}`
      ta.style.lineHeight = lay.lh * z + 'px'
    }
    // the surface is laid at the shape's unrotated place, then turned about
    // the shape's centre like the canvas turns the shape: text is edited in
    // place, at whatever angle it sits
    const pos = this.pageToScreen(shape.x + ox, shape.y + oy)
    const lb = localBounds(shape)
    const col = this.theme.colors[shape.props.color || 'black']
    ta.style.left = pos.x + 'px'
    ta.style.top = pos.y + 'px'
    ta.style.width = w * z + 'px'
    ta.style.height = h * z + 'px'
    ta.style.textAlign = align
    ta.style.color = shape.type === 'note' ? this.theme.noteText : col.stroke
    ta.style.transformOrigin = `${(lb.x + lb.w / 2 - ox) * z}px ${(lb.y + lb.h / 2 - oy) * z}px`
    ta.style.transform = shape.rot ? `rotate(${shape.rot}rad)` : ''
  }
  // ---- formatting while editing --------------------------------------------
  // the style at the caret (or across the selection), pending toggles included
  editingStyle() {
    const ed = this.editing
    if (!ed) return null
    const cur = this.store.get(ed.id)
    if (!cur) return null
    const marks = cur.props[ed.field === 'label' ? 'labelMarks' : 'marks'] || []
    const ta = ed.textarea
    const s = ta.selectionStart, e = ta.selectionEnd
    const st = {}
    for (const k of ['b', 'i', 'u', 's', 'code', 'hl', 'href']) {
      st[k] = s === e ? markAt(marks, Math.max(0, s - 1))[k] || false : hasMark(marks, s, e, k) ? (k === 'href' ? markAt(marks, s).href : true) : false
    }
    for (const k of Object.keys(ed.pending)) st[k] = ed.pending[k]
    return st
  }
  // toggle a mark (b, i, u, s, code, hl) over the selection; with nothing
  // selected it applies to what's typed next
  toggleMark(key, value = true) {
    const ed = this.editing
    if (!ed) return
    const ta = ed.textarea
    const s = ta.selectionStart, e = ta.selectionEnd
    const mk = ed.field === 'label' ? 'labelMarks' : 'marks'
    const cur = this.store.get(ed.id)
    if (!cur) return
    const marks = cur.props[mk] || []
    if (s === e) {
      const on = key in ed.pending ? ed.pending[key] : !!markAt(marks, Math.max(0, s - 1))[key]
      ed.pending[key] = on ? false : value
      ed.caret = s // the key-up that follows the shortcut is not a caret move
      this.emit('edit')
      return
    }
    const next = setMark(marks, s, e, key, !hasMark(marks, s, e, key), value)
    this.store.update(ed.id, { props: { [mk]: next.length ? next : undefined } })
    ta.render(ta.value, next, [s, e]) // shown at once
    ta.focus()
    ta.setSelectionRange(s, e)
    this.emit('edit')
  }
  // link the selection to `href` (empty = unlink); no selection links the
  // word at the caret
  setLink(href) {
    const ed = this.editing
    if (!ed) return
    const ta = ed.textarea
    let s = ta.selectionStart, e = ta.selectionEnd
    if (s === e) {
      const t = ta.value
      while (s > 0 && !/\s/.test(t[s - 1])) s--
      while (e < t.length && !/\s/.test(t[e])) e++
      if (s === e) return
    }
    const mk = ed.field === 'label' ? 'labelMarks' : 'marks'
    const cur = this.store.get(ed.id)
    if (!cur) return
    const clean = String(href || '').trim()
    const next = setMark(cur.props[mk] || [], s, e, 'href', !!clean, clean)
    this.store.update(ed.id, { props: { [mk]: next.length ? next : undefined } })
    ta.render(ta.value, next, [s, e])
    ta.focus()
    ta.setSelectionRange(s, e)
    this.emit('edit')
  }
  // ask for a link (⌘K): the browser's prompt, prefilled with the current one
  promptLink() {
    const st = this.editingStyle()
    if (!st) return
    const href = typeof window !== 'undefined' && window.prompt ? window.prompt('Link to', st.href || 'https://') : null
    if (href === null) { this.editing?.textarea.focus(); return }
    this.setLink(href === 'https://' ? '' : href)
  }
  _commitText() {
    const ed = this.editing
    if (!ed) return
    this.editing = null
    const shape = this.store.get(ed.id)
    ed.textarea.remove()
    if (shape) {
      const value = ed.field === 'label' ? shape.props.label : shape.props.text
      if (!String(value || '').trim() && (shape.type === 'text' || (shape.type === 'note' && ed.fresh))) {
        // empty text evaporates
        this.store.remove([ed.id])
        this.selection.delete(ed.id)
      }
    }
    this.store.endBatch()
    this.emit('edit')
    this.requestRender()
  }

  // ---- select tool ---------------------------------------------------------
  _beginSelect(e, s, p) {
    const additive = e.shiftKey
    // handles first — they extend beyond the shapes
    const h = this._hitHandle(s.x, s.y)
    if (this.cropping) {
      const img = this.store.get(this.cropping.id)
      const inside = img && hitShape(img, p.x, p.y, 0, this.store)
      if (h?.kind === 'crop' || inside) {
        this.session = {
          type: 'cropping', which: h ? h.which : 'move',
          orig: img, frame: imageFrame(img), start: toLocal(img, p.x, p.y),
        }
        this._syncCursor(h ? RESIZE_CURSORS[h.which] : 'move')
        return
      }
      // a press away from the picture leaves crop mode and goes on as usual
      this.endCrop()
    }
    if (h) {
      this.store.beginBatch()
      if (h.kind === 'rotate') {
        const b = this.selectionBounds()
        this.session = {
          type: 'rotating',
          center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
          start: Math.atan2(p.y - (b.y + b.h / 2), p.x - (b.x + b.w / 2)),
          orig: this._snapshotSelection(),
          corner: h.corner || null, // the zone the drag started in: its cursor turns with the shape
        }
        this._syncCursor(h.cursor || 'grabbing')
      } else if (h.kind === 'handle') {
        this.session = { type: 'handle', which: h.which, id: h.id }
      } else {
        const one = this.selection.size === 1 ? this.store.get([...this.selection][0]) : null
        this.session = {
          type: 'resizing', handle: h.which, init: this.selectionBounds(), orig: this._snapshotSelection(),
          rotated: !!(one && one.rot), // a rotated shape resizes in its own frame
        }
        this._syncCursor(RESIZE_CURSORS[h.which] || 'default')
      }
      return
    }
    const hit = this.hitTest(p.x, p.y, { inside: true })
    // a press outside the focused group steps back out of it
    if (this.focusedGroup && hit?.groupId !== this.focusedGroup) this.focusedGroup = null
    if (hit) {
      // a press on a link (the badge of a shape that links, or a linked run
      // of its text) follows it on release — if it didn't turn into a drag
      const link = this._linkAt(hit, p)
      // a grouped shape brings its siblings along (unless its group is focused)
      const pick = this._withGroups([hit.id])
      const wasSelected = this.selection.has(hit.id)
      // (a press on a link leaves the selection alone until it turns out to be a drag)
      if (!wasSelected && !additive && !link) this.setSelection(pick)
      else if (additive && !wasSelected) this.setSelection([...this.selection, ...pick])
      // `added` marks a shape shift-selected on the way down, so the clean
      // click on the way up keeps it instead of toggling it straight back out
      this.session = { type: 'pressing', hit, pick, additive, added: additive && !wasSelected, start: s, page: p, pressAt: s, link }
    } else {
      this.session = { type: 'marquee', origin: p, rect: null, additive, base: [...this.selection], pressAt: s }
      if (!additive) this.setSelection([])
    }
    // a still finger opens the context menu — touch has no right button
    if (e.pointerType === 'touch') {
      const ss = this.session
      this._clearPressTimer()
      this._pressTimer = setTimeout(() => {
        this._pressTimer = 0
        if (this.session !== ss) return
        this.session = null
        this._openContextMenu(s)
      }, LONG_PRESS)
    }
  }
  _snapshotSelection() {
    const m = new Map()
    for (const id of this.selection) {
      const sh = this.store.get(id)
      if (sh) m.set(id, sh)
    }
    return m
  }
  _beginTranslate(p, e) {
    if (!this.selection.size) return
    this.store.beginBatch()
    // an arrow dragged away from a shape it's tied to lets go of it — unless
    // the shape is coming along
    this.store.transact(() => {
      for (const id of this.selection) {
        const s = this.store.get(id)
        if (!s || (s.type !== 'arrow' && s.type !== 'line')) continue
        const keep = {}
        for (const k of ['startBind', 'endBind']) if (s.props[k] && this.selection.has(s.props[k].id)) keep[s.props[k].id] = s.props[k].id
        const props = remapBindings(s.props, keep)
        if (props !== s.props) this.store.put({ ...s, props })
      }
    })
    const base = this._snapshotSelection()
    this.session = { type: 'translating', start: p, last: p, shift: !!e.shiftKey, orig: base, base, copied: false }
    if (e.altKey) this._copyForDrag()
    this._syncCursor('move')
  }
  // ⌥ is live for the whole drag: while it's down the move is a copy — the
  // originals sit where they were and copies ride the pointer — and letting
  // go of it turns the drag back into a move. Whatever mode is on when the
  // button comes up is what's kept.
  _copyForDrag() {
    const ss = this.session
    if (!ss || ss.type !== 'translating' || ss.copied) return
    ss.copied = true
    this.store.transact(() => {
      for (const [id, orig] of ss.base) if (this.store.has(id)) this.store.put(orig)
      this.duplicateSelection(0)
    })
    ss.copyIds = [...this.selection]
    ss.orig = this._snapshotSelection()
    this._applyTranslate()
    this._syncCursor('copy')
  }
  _uncopyForDrag() {
    const ss = this.session
    if (!ss || ss.type !== 'translating' || !ss.copied) return
    ss.copied = false
    this.store.transact(() => this.store.remove(ss.copyIds))
    ss.copyIds = null
    ss.orig = ss.base
    this.setSelection([...ss.base.keys()])
    this._applyTranslate()
    this._syncCursor('move')
  }
  _dragTranslate(p, e) {
    const ss = this.session
    ss.last = p
    ss.shift = !!e.shiftKey
    if (e.altKey && !ss.copied) this._copyForDrag()
    else if (!e.altKey && ss.copied) this._uncopyForDrag()
    this._applyTranslate()
  }
  // the moved shapes follow the pointer's offset from the press
  _applyTranslate() {
    const ss = this.session
    let dx = ss.last.x - ss.start.x
    let dy = ss.last.y - ss.start.y
    if (ss.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
    this.store.transact(() => {
      for (const [id, orig] of ss.orig) {
        if (this.store.has(id)) this.store.update(id, { x: orig.x + dx, y: orig.y + dy })
      }
    })
  }
  _endTranslate() {
    this.store.endBatch()
    this.session = null
    this._syncCursor()
    this.requestRender()
  }
  // The scale pair a handle pull comes to, given what's selected. Corners go
  // proportional on shift, and always for shapes that only scale as a whole
  // (images, notes, text). A side pull on a whole-scaling shape scales it as
  // a whole by that axis, so its far edge stays pinned instead of drifting;
  // text takes a side pull as its wrap width (see scaleShape).
  _resizeScales(handle, sx, sy, shapes, e) {
    const corner = handle.length === 2
    const whole = shapes.every((sh) => ['image', 'text'].includes(sh.type))
    if (corner && (e.shiftKey || whole)) { const s = Math.max(sx, sy); return [s, s] }
    return [sx, sy]
  }
  // ⌥ (or ctrl) resizes about the centre instead of the far edge
  _fromCenter(e) { return !!(e.altKey || e.ctrlKey) }
  _dragResize(p, e) {
    const ss = this.session
    if (ss.rotated) return this._dragResizeRotated(p, e)
    const { handle, init } = ss
    const center = this._fromCenter(e)
    const ax = center ? init.x + init.w / 2 : handle.includes('l') ? init.x + init.w : init.x // anchor
    const ay = center ? init.y + init.h / 2 : handle.includes('t') ? init.y + init.h : init.y
    // scales clamp positive — dragging past the anchor pins at tiny, no flips
    let sx = handle.includes('l') || handle.includes('r')
      ? (p.x - ax) / ((handle.includes('l') ? init.x : init.x + init.w) - ax)
      : 1
    let sy = handle.includes('t') || handle.includes('b')
      ? (p.y - ay) / ((handle.includes('t') ? init.y : init.y + init.h) - ay)
      : 1
    sx = isFinite(sx) ? Math.max(0.02, sx) : 1
    sy = isFinite(sy) ? Math.max(0.02, sy) : 1
    ;[sx, sy] = this._resizeScales(handle, sx, sy, [...ss.orig.values()], e)
    this.store.transact(() => {
      for (const [id, orig] of ss.orig) {
        if (!this.store.has(id)) continue
        const scaled = scaleShape(orig, sx, sy, { handle })
        // shape origin maps through the anchor like any other point — except
        // text pulled by its top edge, whose new height (the type re-wraps)
        // is measured so the bottom edge stays exactly put
        const y = scaled.type === 'text' && handle === 't' ? ay - localBounds(scaled).h : ay + (orig.y - ay) * sy
        this.store.put({ ...scaled, x: ax + (orig.x - ax) * sx, y })
      }
    })
  }
  // A single rotated shape resizes in its own frame: the pointer is taken
  // into the shape's starting coordinates, the box is resized there with the
  // opposite edge anchored, and the result is placed so that box lands back
  // on the page under the same rotation — the anchor stays put on screen.
  _dragResizeRotated(p, e) {
    const ss = this.session
    const [id, orig] = [...ss.orig][0]
    if (!this.store.has(id)) return
    const h = ss.handle
    const lb = localBounds(orig)
    const l = toLocal(orig, p.x, p.y)
    const center = this._fromCenter(e)
    const cx = lb.x + lb.w / 2, cy = lb.y + lb.h / 2
    let x0 = lb.x, y0 = lb.y, x1 = lb.x + lb.w, y1 = lb.y + lb.h
    // sizes pin at tiny instead of flipping, like the unrotated resize
    const minW = lb.w * 0.02, minH = lb.h * 0.02
    if (h.includes('l')) x0 = Math.min(l.x, (center ? cx : x1) - minW)
    if (h.includes('r')) x1 = Math.max(l.x, (center ? cx : x0) + minW)
    if (h.includes('t')) y0 = Math.min(l.y, (center ? cy : y1) - minH)
    if (h.includes('b')) y1 = Math.max(l.y, (center ? cy : y0) + minH)
    if (center) {
      // the far edge mirrors the pulled one about the centre
      if (h.includes('l')) x1 = 2 * cx - x0; else if (h.includes('r')) x0 = 2 * cx - x1
      if (h.includes('t')) y1 = 2 * cy - y0; else if (h.includes('b')) y0 = 2 * cy - y1
    }
    const [sx, sy] = this._resizeScales(h, (x1 - x0) / lb.w, (y1 - y0) / lb.h, [orig], e)
    // rebuild the box from the settled scales: about the centre, or away
    // from the anchored edge (the top/left for an axis that wasn't pulled)
    if (center) { x0 = cx - (lb.w * sx) / 2; x1 = cx + (lb.w * sx) / 2; y0 = cy - (lb.h * sy) / 2; y1 = cy + (lb.h * sy) / 2 }
    else {
      if (h.includes('l')) x0 = x1 - lb.w * sx; else x1 = x0 + lb.w * sx
      if (h.includes('t')) y0 = y1 - lb.h * sy; else y1 = y0 + lb.h * sy
    }
    const sc = scaleShape(orig, sx, sy, { handle: h })
    const nb = localBounds(sc)
    // the new box's centre in the starting frame, then on the page; the
    // shape then pivots on that centre, so the box lands where it was framed
    const c = rotWith(orig.x + (x0 + x1) / 2, orig.y + (y0 + y1) / 2, orig.x + lb.x + lb.w / 2, orig.y + lb.y + lb.h / 2, orig.rot)
    this.store.put({ ...sc, x: c.x - nb.x - nb.w / 2, y: c.y - nb.y - nb.h / 2 })
  }
  _dragRotate(p, e) {
    const ss = this.session
    let delta = Math.atan2(p.y - ss.center.y, p.x - ss.center.x) - ss.start
    if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12)
    if (ss.corner) {
      // the cursor turns with the frame it's turning
      const base = { tl: 0, tr: 90, br: 180, bl: 270 }[ss.corner]
      const one = ss.orig.size === 1 ? [...ss.orig.values()][0] : null
      this._syncCursor(rotateCursor(base + (((one?.rot || 0) + delta) * 180) / Math.PI))
    }
    this.store.transact(() => {
      for (const [id, orig] of ss.orig) {
        if (!this.store.has(id)) continue
        const lb = localBounds(orig)
        const cx = orig.x + lb.x + lb.w / 2
        const cy = orig.y + lb.y + lb.h / 2
        const nc = rotWith(cx, cy, ss.center.x, ss.center.y, delta)
        this.store.update(id, {
          x: orig.x + nc.x - cx,
          y: orig.y + nc.y - cy,
          rot: ((orig.rot || 0) + delta) % (Math.PI * 2),
        })
      }
    })
  }
  // arrow / line endpoint + bend handles
  _dragHandle(p, e) {
    const ss = this.session
    const s = this.store.get(ss.id)
    if (!s) return
    const pr = s.props
    if (ss.which === 'start') {
      const ex = s.x + pr.dx, ey = s.y + pr.dy
      this.store.update(s.id, { x: p.x, y: p.y, props: { dx: ex - p.x, dy: ey - p.y, ...this._endBinding(s, 'startBind', p, e) } })
    } else if (ss.which === 'end') {
      let dx = p.x - s.x, dy = p.y - s.y
      if (e.shiftKey) {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12)
        const len = Math.hypot(dx, dy)
        dx = Math.cos(a) * len
        dy = Math.sin(a) * len
      }
      this.store.update(s.id, { props: { dx, dy, ...this._endBinding(s, 'endBind', p, e) } })
    } else if (ss.which === 'bend') {
      // signed distance of the pointer from the straight chord
      const len = Math.hypot(pr.dx, pr.dy) || 1
      const nx = -pr.dy / len, ny = pr.dx / len
      const bend = (p.x - (s.x + pr.dx / 2)) * nx + (p.y - (s.y + pr.dy / 2)) * ny
      this.store.update(s.id, { props: { bend: Math.abs(bend) < 4 / this.camera.z ? 0 : bend } })
    }
  }

  // ---- image crop ----------------------------------------------------------
  // Crop mode: the image's box becomes a window onto the picture. The whole
  // source shows through faintly, the box handles trim the window, and a drag
  // inside slides the picture behind it. Everything is worked in the shape's
  // starting frame, so a rotated picture stays visually pinned while its box
  // (and with it, its rotation pivot) changes. One batch for the whole mode:
  // any number of drags undo as one step.
  startCrop(id) {
    const s = this.store.get(id)
    if (!s || s.type !== 'image' || this.readonly || this.cropping?.id === id) return
    this.endCrop()
    this._commitText()
    if (this.tool !== 'select') this.setTool('select')
    this.setSelection([id])
    this.store.beginBatch()
    this.cropping = { id }
    this.emit('crop')
    this.requestRender()
  }
  endCrop() {
    if (!this.cropping) return
    this.cropping = null
    this.store.endBatch()
    this.emit('crop')
    this.requestRender()
  }
  // back to the whole picture, the window's centre staying put
  resetCrop(id = [...this.selection][0]) {
    const s = id && this.store.get(id)
    if (!s || s.type !== 'image' || !s.props.crop) return
    const f = imageFrame(s)
    this.store.put(this._cropPatch(s, f, f))
  }
  // the shape with a new window (`win`) onto the source rect (`frame`), both
  // in orig's local frame. A rotated shape pivots on its own centre, so the
  // window's centre is the one point that must land where it visually is.
  _cropPatch(orig, frame, win) {
    const p = orig.props
    const c = rotWith(orig.x + win.x + win.w / 2, orig.y + win.y + win.h / 2, orig.x + p.w / 2, orig.y + p.h / 2, orig.rot || 0)
    const crop = { x: (win.x - frame.x) / frame.w, y: (win.y - frame.y) / frame.h, w: win.w / frame.w, h: win.h / frame.h }
    const full = crop.x <= 1e-6 && crop.y <= 1e-6 && crop.w >= 1 - 1e-6 && crop.h >= 1 - 1e-6
    const { crop: _drop, ...rest } = p
    const props = { ...rest, w: win.w, h: win.h, ...(full ? {} : { crop }) }
    return { ...orig, x: c.x - win.w / 2, y: c.y - win.h / 2, props }
  }
  _dragCrop(p) {
    const ss = this.session
    const { orig, frame } = ss
    const l = toLocal(orig, p.x, p.y)
    const dx = l.x - ss.start.x, dy = l.y - ss.start.y
    const w0 = orig.props.w, h0 = orig.props.h
    let win = { x: 0, y: 0, w: w0, h: h0 }, fr = frame
    if (ss.which === 'move') {
      // slide the picture behind the window, never past its edges
      fr = { ...frame, x: clamp(frame.x + dx, w0 - frame.w, 0), y: clamp(frame.y + dy, h0 - frame.h, 0) }
    } else {
      const h = ss.which
      let x0 = 0, y0 = 0, x1 = w0, y1 = h0
      if (h.includes('l')) x0 = clamp(dx, frame.x, x1 - CROP_MIN)
      if (h.includes('r')) x1 = clamp(w0 + dx, x0 + CROP_MIN, frame.x + frame.w)
      if (h.includes('t')) y0 = clamp(dy, frame.y, y1 - CROP_MIN)
      if (h.includes('b')) y1 = clamp(h0 + dy, y0 + CROP_MIN, frame.y + frame.h)
      win = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    this.store.put(this._cropPatch(orig, fr, win))
  }
  // a shape-local point on screen, the shape's rotation applied
  _localToScreen(s, lx, ly) {
    const lb = localBounds(s)
    const r = rotWith(s.x + lx, s.y + ly, s.x + lb.x + lb.w / 2, s.y + lb.y + lb.h / 2, s.rot || 0)
    return this.pageToScreen(r.x, r.y)
  }
  _hitCropHandle(sx, sy) {
    const s = this.cropping && this.store.get(this.cropping.id)
    if (!s) return null
    for (const [which, h] of this._boxHandles(s)) {
      if (Math.abs(h.x - sx) <= HANDLE && Math.abs(h.y - sy) <= HANDLE) return which
    }
    return null
  }
  // the eight handles of a shape's own (rotated) box, on screen: [which, {x, y}]
  _boxHandles(s) {
    const lb = localBounds(s)
    return Object.entries(BOX_HANDLES).map(([which, [fx, fy]]) =>
      [which, this._localToScreen(s, lb.x + fx * lb.w, lb.y + fy * lb.h)])
  }

  // ---- context menu --------------------------------------------------------
  _contextMenu(e) {
    if (this.readonly) return
    if (e.target !== this.canvas && e.target !== this.overlay && e.target !== this.container) return
    e.preventDefault()
    this._openContextMenu(this._evPoint(e))
  }
  // right-click / long press at a screen point: the shape under it (with its
  // group) becomes the selection unless it's already in it, then the UI layer
  // gets the word. Hosts drawing their own chrome listen for 'contextmenu'.
  _openContextMenu(s) {
    this._commitText()
    const p = this.screenToPage(s.x, s.y)
    const hit = this.hitTest(p.x, p.y, { inside: true })
    if (hit) {
      if (this.tool !== 'select') this.setTool('select')
      if (!this.selection.has(hit.id)) this.setSelection(this._withGroups([hit.id]))
    } else if (!this.cropping) this.setSelection([])
    this.emit('contextmenu', { x: s.x, y: s.y, page: p, hit })
  }

  // ---- placing from the toolbar --------------------------------------------
  // A tool dragged off the dock lands here: a ready-made shape at the drop
  // point, in the current styles, selected — text and notes already in edit.
  // kind: 'text' | 'note' | 'arrow' | 'line' | 'geo' (current kind) | a geo id
  dropShape(kind, at) {
    if (this.readonly) return null
    this._commitText()
    this.endCrop()
    if (kind === 'text' || kind === 'note') {
      kind === 'text' ? this._placeText(at) : this._placeNote(at)
      return [...this.selection][0] || null
    }
    const st = this.styles
    const id = newId()
    const base = { id, typeName: 'shape', rot: 0, z: this.store.maxZ() + 1 }
    let shape
    if (kind === 'arrow' || kind === 'line') {
      shape = {
        ...base, type: kind, x: at.x - 80, y: at.y,
        props: { dx: 160, dy: 0, bend: 0, color: st.color, size: st.size, dash: st.dash === 'draw' ? 'solid' : st.dash },
      }
    } else {
      const geo = kind === 'geo' ? this.geoKind : kind
      if (!GEO_IDS.includes(geo)) return null
      shape = {
        ...base, type: 'geo', x: at.x - 80, y: at.y - 80,
        props: { geo, w: 160, h: 160, color: st.color, size: st.size, dash: st.dash, fill: st.fill, font: st.font },
      }
    }
    this.store.put(shape)
    this.setTool('select')
    this.setSelection([id])
    return id
  }

  // the pointer tells you what a press would do: resize arrows over handles,
  // move over a selected shape, grab over the rotate knob
  _hoverCursor(e) {
    if (this.tool !== 'select' || this.spaceHeld || this.editing) return
    if (e.target !== this.canvas && e.target !== this.overlay && e.target !== this.container) return
    const s = this._evPoint(e)
    const h = this._hitHandle(s.x, s.y)
    if (h) {
      this._syncCursor(
        h.kind === 'rotate' ? h.cursor || 'grab' : h.kind === 'handle' ? 'pointer' : RESIZE_CURSORS[h.which] || 'default'
      )
      return
    }
    const p = this.screenToPage(s.x, s.y)
    const hit = this.hitTest(p.x, p.y, { inside: true })
    if (hit && this._linkAt(hit, p)) { this._syncCursor('pointer'); return }
    this._syncCursor(hit && this.selection.has(hit.id) ? 'move' : null)
  }
  // the link under a page point on a shape: its url badge, or a linked run
  // of its text — or null
  _linkAt(shape, p) {
    const l = toLocal(shape, p.x, p.y)
    const b = urlBadgeAt(shape)
    if (b) {
      const s = shape.type === 'note' ? shape.props.scale || 1 : 1
      if (Math.hypot(l.x / s - b.x, l.y / s - b.y) <= b.r + 2) return shape.props.url
    }
    return textLinkAt(shape, l.x, l.y)
  }

  // The rotate knob: 22px out from the middle of the top edge. A single
  // rotated shape hangs it off ITS top edge, so the knob turns with the
  // frame instead of hovering over the axis-aligned box. Returns the knob
  // (x, y) and the point it attaches to (ax, ay), in screen px.
  _rotateHandle(one) {
    if (one && one.rot) {
      const lb = localBounds(one)
      const a = this._localToScreen(one, lb.x + lb.w / 2, lb.y)
      return { x: a.x + Math.sin(one.rot) * 22, y: a.y - Math.cos(one.rot) * 22, ax: a.x, ay: a.y }
    }
    const b = this.selectionBounds()
    if (!b) return null
    const tl = this.pageToScreen(b.x, b.y)
    const br = this.pageToScreen(b.x + b.w, b.y + b.h)
    const ax = (tl.x + br.x) / 2
    return { x: ax, y: tl.y - 22, ax, ay: tl.y }
  }

  // which handle sits at screen point? returns { kind, which, id }
  _hitHandle(sx, sy) {
    if (this.tool !== 'select' || !this.selection.size) return null
    if (this.cropping) {
      const which = this._hitCropHandle(sx, sy)
      return which ? { kind: 'crop', which } : null
    }
    const one = this.selection.size === 1 ? this.store.get([...this.selection][0]) : null
    // arrows and lines carry their own handles instead of a resize box
    if (one && (one.type === 'arrow' || one.type === 'line')) {
      const pr = one.props
      const pts = [
        { which: 'start', x: one.x, y: one.y },
        { which: 'end', x: one.x + pr.dx, y: one.y + pr.dy },
      ]
      const bm = bendMidpoint(pr)
      pts.push({ which: 'bend', x: one.x + bm.x, y: one.y + bm.y })
      for (const h of pts) {
        const s = this.pageToScreen(h.x, h.y)
        if (Math.hypot(s.x - sx, s.y - sy) <= HANDLE + 3) return { kind: 'handle', which: h.which, id: one.id }
      }
      return null
    }
    const b = this.selectionBounds()
    if (!b) return null
    const tl = this.pageToScreen(b.x, b.y)
    const br = this.pageToScreen(b.x + b.w, b.y + b.h)
    const rotatable = !one || !['arrow', 'line'].includes(one.type)
    if (rotatable && this._coarse) {
      const r = this._rotateHandle(one)
      if (Math.hypot(r.x - sx, r.y - sy) <= HANDLE + 2) return { kind: 'rotate' }
    }
    for (const [which, s] of this._resizeHandles(one, b)) {
      if (Math.abs(s.x - sx) <= HANDLE && Math.abs(s.y - sy) <= HANDLE) return { kind: 'resize', which }
    }
    if (rotatable) {
      const z = this._hitRotateZone(one, b, sx, sy)
      if (z) return z
    }
    // a text box's whole top and bottom edge is its type-size handle
    if (one?.type === 'text') {
      const p = this.screenToPage(sx, sy)
      const l = one.rot ? toLocal(one, p.x, p.y) : { x: p.x - one.x, y: p.y - one.y }
      const lb = localBounds(one)
      const tol = HANDLE / this.camera.z
      if (l.x >= lb.x && l.x <= lb.x + lb.w) {
        if (Math.abs(l.y - lb.y) <= tol) return { kind: 'resize', which: 't' }
        if (Math.abs(l.y - (lb.y + lb.h)) <= tol) return { kind: 'resize', which: 'b' }
      }
    }
    return null
  }
  // the invisible rotate zones: just outside each corner of the box (the
  // shape's own, turned, for a rotated single shape), past the resize
  // handle, and never inside the box itself
  _hitRotateZone(one, b, sx, sy) {
    const rot = one?.rot || 0
    const handles = Object.fromEntries(this._resizeHandles(one, b).filter(([w]) => w.length === 2))
    // the pointer in the box's frame, to tell outside from inside
    const p = this.screenToPage(sx, sy)
    const l = one && rot ? toLocal(one, p.x, p.y) : p
    const box = one && rot ? localBounds(one) : b
    const outside = l.x < box.x || l.x > box.x + box.w || l.y < box.y || l.y > box.y + box.h
    if (!outside) return null
    const BASE = { tl: 0, tr: 90, br: 180, bl: 270 }
    for (const [corner, h] of Object.entries(handles)) {
      const d = Math.hypot(h.x - sx, h.y - sy)
      if (d > HANDLE + 2 && d <= ROTATE_ZONE) {
        return { kind: 'rotate', corner, cursor: rotateCursor(BASE[corner] + (rot * 180) / Math.PI) }
      }
    }
    return null
  }
  // the resize handles on screen, [which, {x, y}]: a rotated single shape's
  // ride its own frame, otherwise they sit on the selection's box. On text
  // the top and bottom ones set the type size (see scaleShape).
  _resizeHandles(one, b) {
    const names = Object.keys(BOX_HANDLES)
    if (one && one.rot) return this._boxHandles(one).filter(([which]) => names.includes(which))
    const tl = this.pageToScreen(b.x, b.y)
    const br = this.pageToScreen(b.x + b.w, b.y + b.h)
    return names.map((which) => {
      const [fx, fy] = BOX_HANDLES[which]
      return [which, { x: tl.x + (br.x - tl.x) * fx, y: tl.y + (br.y - tl.y) * fy }]
    })
  }

  _dblClick(e) {
    if (this.readonly || this.tool !== 'select') return
    const s = this._evPoint(e)
    const p = this.screenToPage(s.x, s.y)
    const hit = this.hitTest(p.x, p.y, { inside: true })
    if (hit) {
      if (hit.groupId && hit.groupId !== this.focusedGroup) {
        // dive into the group: from here its members select one at a time
        this.focusedGroup = hit.groupId
        this.setSelection([hit.id])
        return
      }
      if (hit.type === 'text' || hit.type === 'note') {
        this.setSelection([hit.id])
        this._startTextEdit(hit.id, 'text', { at: p })
        return
      }
      if (hit.type === 'geo') {
        this.setSelection([hit.id])
        this._startTextEdit(hit.id, 'label', { at: p })
        return
      }
      if (hit.type === 'image') {
        this.cropping?.id === hit.id ? this.endCrop() : this.startCrop(hit.id)
        return
      }
      return
    }
    if (this.cropping) { this.endCrop(); return }
    this._placeText(p)
  }

  // ---- keyboard ------------------------------------------------------------
  _keyDown(e) {
    if (this.readonly || this.editing) return
    const meta = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (k === ' ') {
      if (!this.spaceHeld) { this.spaceHeld = true; this._syncCursor() }
      e.preventDefault()
      return
    }
    // ⌥ pressed mid-drag (before the pointer moves again) still turns it into a copy
    if (k === 'alt' && this.session?.type === 'translating') { this._copyForDrag(); return }
    if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? this.store.redo() : this.store.undo(); return }
    if (meta && k === 'a') { e.preventDefault(); this.selectAll(); return }
    if (meta && k === 'd') { e.preventDefault(); this.duplicateSelection(); return }
    if (meta && k === 'g') { e.preventDefault(); e.shiftKey ? this.ungroupSelection() : this.groupSelection(); return }
    if (meta && k === 'c') { e.preventDefault(); this.copySelection(); return }
    if (meta && k === 'x') { e.preventDefault(); this.copySelection().then(() => this.deleteSelection()); return }
    // ⌘V is left to the browser: its paste event brings files, HTML and text
    // without a permission prompt, and lands in _paste
    if (meta && k === 'v') return
    if (meta && (k === '=' || k === '+')) { e.preventDefault(); this._zoomCenter(1.25); return }
    if (meta && k === '-') { e.preventDefault(); this._zoomCenter(1 / 1.25); return }
    if (k === 'escape') {
      if (this.session) this._cancelSession()
      else if (this.cropping) this.endCrop()
      else if (this.focusedGroup) {
        // step back out: the whole group is the selection again
        const g = this.focusedGroup
        this.focusedGroup = null
        this.setSelection(this.groupMembers(g))
      } else if (this.selection.size) this.setSelection([])
      else this.setTool('select')
      return
    }
    // ⌥ + a letter: align / distribute (tldraw's map). e.code, because on a
    // Mac the option key turns the letter into a symbol before it reaches us.
    if (e.altKey && !meta && this.selection.size > 1) {
      const align = { KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'center', KeyV: 'middle' }
      if (e.shiftKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
        e.preventDefault()
        this.distributeSelection(e.code === 'KeyH' ? 'horizontal' : 'vertical')
        return
      }
      if (align[e.code]) { e.preventDefault(); this.alignSelection(align[e.code]); return }
    }
    // the UI layer listens for this and toggles the shortcuts overlay
    if (k === '?') { e.preventDefault(); this.emit('help'); return }
    // wipe the board — two modifiers deep, and undoable like any other edit
    if (meta && e.shiftKey && (k === 'delete' || k === 'backspace')) {
      e.preventDefault()
      this.clearBoard()
      return
    }
    if (k === 'delete' || k === 'backspace') { this.deleteSelection(); return }
    if (k === 'enter' && this.cropping) { e.preventDefault(); this.endCrop(); return }
    if (k === 'enter' && this.selection.size === 1) {
      const s = this.store.get([...this.selection][0])
      if (s && ['text', 'note'].includes(s.type)) { e.preventDefault(); this._startTextEdit(s.id, 'text') }
      else if (s && s.type === 'geo') { e.preventDefault(); this._startTextEdit(s.id, 'label') }
      else if (s && s.type === 'image') { e.preventDefault(); this.startCrop(s.id) }
      return
    }
    if (k.startsWith('arrow')) {
      const d = (e.shiftKey ? 32 : 4) / 1
      const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0
      const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0
      if (this.selection.size) {
        e.preventDefault()
        this.store.transact(() => this._nudge([...this.selection], dx, dy))
      }
      return
    }
    if (!meta) {
      // ] / [ step one layer; with shift they go all the way (tldraw's map).
      // Shift turns the bracket into a brace on most layouts — accept both.
      const shifted = e.shiftKey || k === '}' || k === '{'
      if (k === ']' || k === '}') { shifted ? this.bringToFront() : this.bringForward(); return }
      if (k === '[' || k === '{') { shifted ? this.sendToBack() : this.sendBackward(); return }
      const toolKeys = {
        v: 'select', '1': 'select', h: 'hand', d: 'draw', p: 'draw', b: 'draw',
        i: 'highlight', e: 'eraser', k: 'laser', a: 'arrow', l: 'line',
        t: 'text', n: 'note', g: 'geo',
      }
      if (toolKeys[k]) { this.setTool(toolKeys[k]); return }
      const geoKeys = { r: 'rectangle', o: 'ellipse' }
      if (geoKeys[k]) { this.setGeoKind(geoKeys[k]); this.setTool('geo'); return }
      if (e.shiftKey && k === '!') { this.fitContent({ animate: 220 }); return }
    }
    if (e.shiftKey && k === '1') { this.fitContent({ animate: 220 }); return }
    if (e.shiftKey && k === '0') this.resetZoom()
  }
  // the page-wide zoom keys: the board owns them while it's on the page
  _docKey(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    const k = e.key
    const dir = k === '=' || k === '+' ? 1 : k === '-' || k === '_' ? -1 : k === '0' ? 0 : null
    if (dir === null) return
    const t = e.target
    // someone else's field (an input, a textarea, another editable) keeps its keys
    if (t && t !== document.body && t !== this.container && !this.container.contains(t)) {
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
    }
    if (!this.container.isConnected) return
    e.preventDefault()
    e.stopPropagation()
    if (dir === 0) this.resetZoom()
    else this._zoomCenter(dir > 0 ? 1.25 : 1 / 1.25)
  }
  _keyUp(e) {
    if (e.key === ' ') { this.spaceHeld = false; this._syncCursor() }
    // ⌥ let go mid-drag: back to a move
    if (e.key === 'Alt' && this.session?.type === 'translating') this._uncopyForDrag()
  }
  _zoomCenter(mult) {
    const { w, h } = this.viewSize()
    this.zoomAt(w / 2, h / 2, mult, { animate: 140 })
  }
  // back to 1:1 about the middle of the view (⇧0)
  resetZoom({ animate = 180 } = {}) {
    const { w, h } = this.viewSize()
    this.zoomAt(w / 2, h / 2, 1 / this.camera.z, { animate })
  }
  // open the text surface on a text, note (body) or geo (label) shape
  editShapeText(id) {
    const s = this.store.get(id)
    if (!s || this.readonly) return
    if (s.type === 'text' || s.type === 'note') this._startTextEdit(id, 'text')
    else if (s.type === 'geo') this._startTextEdit(id, 'label')
  }

  _wheel(e) {
    if (this.readonly) return
    e.preventDefault()
    const s = this._evPoint(e)
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.012))
    } else {
      this.pan(-e.deltaX, -e.deltaY)
    }
  }

  _syncCursor(force) {
    const cur = force
      ? force
      : this.readonly
        ? 'default'
        : this.spaceHeld || this.tool === 'hand'
          ? 'grab'
          : ['draw', 'highlight', 'eraser', 'laser', 'arrow', 'line', 'geo'].includes(this.tool)
            ? 'crosshair'
            : this.tool === 'text'
              ? 'text'
              : 'default'
    this.container.style.cursor = cur
  }

  // ---- clipboard / images --------------------------------------------------
  async copySelection() {
    if (!this.selection.size) return
    const shapes = []
    const assets = {}
    for (const id of this.selection) {
      const s = this.store.get(id)
      if (!s) continue
      shapes.push(s)
      if (s.type === 'image' && s.props.assetId) {
        const a = this.store.asset(s.props.assetId)
        if (a) assets[a.id] = a
      }
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify({ quickdraw: 1, shapes, assets }))
    } catch (e) { console.warn('board copy failed', e) }
  }
  // Programmatic paste (a menu item; ⌘V goes through the browser's own
  // paste event, which needs no permission). Images first, then HTML — that's
  // where tldraw keeps its shapes — then text: our payload, or plain words.
  async pasteFromClipboard() {
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read()
        for (const it of items) {
          const t = it.types.find((t2) => t2.startsWith('image/'))
          if (t) {
            const blob = await it.getType(t)
            this.importImageBlobs([blob])
            return
          }
        }
        for (const it of items) {
          if (!it.types.includes('text/html')) continue
          const html = await (await it.getType('text/html')).text()
          if (await this._pasteHtml(html)) return
        }
      }
    } catch {}
    try {
      const text = await navigator.clipboard.readText()
      await this._pasteText(text)
    } catch {}
  }
  // tldraw's clipboard HTML → its shapes on our board; true when it was that
  async _pasteHtml(html) {
    const content = parseTldrawClipboard(html)
    if (!content) return false
    await this.importTldraw(content)
    return true
  }
  // clipboard text: our own payload, tldraw's (its text fallback), or plain
  // words, which land as a text shape mid-view
  async _pasteText(text) {
    if (!text || !text.trim()) return false
    try {
      const data = JSON.parse(text)
      if (data && data.quickdraw && Array.isArray(data.shapes)) { this._pasteShapes(data); return true }
    } catch {}
    if (await this._pasteHtml(text)) return true
    const vp = this.viewportPageBounds()
    const id = newId()
    this.store.put({
      id, typeName: 'shape', type: 'text', x: vp.x + vp.w / 2, y: vp.y + vp.h / 2, rot: 0, z: this.store.maxZ() + 1,
      props: { text: normalizeText(text), color: this.styles.color, size: this.styles.size, font: this.styles.font, align: this.styles.align, autosize: true, scale: 1 },
    })
    // centre it on the view now that it has a size
    const b = pageBounds(this.store.get(id))
    this.store.update(id, { x: vp.x + vp.w / 2 - b.w / 2, y: vp.y + vp.h / 2 - b.h / 2 })
    if (this.tool !== 'select') this.setTool('select')
    this.setSelection([id])
    return true
  }
  // tldraw content (see tldraw.js) → our board, centred in the view (or at
  // `at`), selected. Image assets hosted at URLs are fetched into data URLs
  // so they render, export and sync like our own; one that can't be fetched
  // keeps its URL and still shows. Returns the new ids.
  async importTldraw(content, { at } = {}) {
    const { shapes, assets } = convertTldrawContent(content)
    if (!shapes.length) return []
    await Promise.all(assets.map(async (a) => {
      if (!/^https?:/i.test(a.src)) return
      try {
        const blob = await (await fetch(a.src, { mode: 'cors' })).blob()
        const img = await readImage(blob)
        a.src = img.src; a.w = img.w; a.h = img.h
      } catch (e) { console.warn('tldraw image not fetched, keeping its URL', a.src, e) }
    }))
    return this._pasteShapes({ shapes, assets }, { center: at || 'view' })
  }
  // put a bundle of our records on the board with fresh ids, groups,
  // bindings and assets remapped; nudged by 16px like a duplicate, or
  // centred on a page point ('view' = the middle of the viewport)
  _pasteShapes(data, { center = null } = {}) {
    let z = this.store.maxZ()
    const ids = []
    let dx = 16, dy = 16
    if (center) {
      let b = null
      for (const s of data.shapes) b = boundsUnion(b, pageBounds(s))
      const vp = this.viewportPageBounds()
      const target = center === 'view' ? { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 } : center
      dx = b ? target.x - (b.x + b.w / 2) : 0
      dy = b ? target.y - (b.y + b.h / 2) : 0
    }
    this.store.transact(() => {
      const assetMap = {}
      for (const a of Object.values(data.assets || {})) {
        const nid = newId('asset')
        assetMap[a.id] = nid
        this.store.put({ ...a, id: nid })
      }
      const groups = {} // pasted groups are new groups
      const idMap = {}
      for (const s of data.shapes) idMap[s.id] = newId()
      for (const s of data.shapes) {
        const nid = idMap[s.id]
        ids.push(nid)
        const rec = {
          ...s, id: nid, x: s.x + dx, y: s.y + dy, z: ++z,
          props: remapBindings(s.props.assetId ? { ...s.props, assetId: assetMap[s.props.assetId] || s.props.assetId } : s.props, idMap),
        }
        if (s.groupId) rec.groupId = groups[s.groupId] ||= newId('group')
        this.store.put(rec)
      }
    })
    if (this.tool !== 'select') this.setTool('select')
    this.setSelection(ids)
    return ids
  }
  // the browser's paste event (⌘V): image files, then HTML (tldraw's
  // shapes live there), then text
  _paste(e) {
    if (this.readonly || this.editing) return
    const cd = e.clipboardData
    const files = [...(cd?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) { e.preventDefault(); this.importImageBlobs(files); return }
    const html = cd?.getData?.('text/html') || ''
    const text = cd?.getData?.('text/plain') || ''
    if (!html && !text) return
    e.preventDefault()
    this._pasteHtml(html).then((done) => (done ? null : this._pasteText(text))).catch((err) => console.warn('paste failed', err))
  }
  _drop(e) {
    if (this.readonly) return
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    const s = this._evPoint(e)
    this.importImageBlobs(files, this.screenToPage(s.x, s.y))
  }
  async importImageBlobs(blobs, at) {
    for (const blob of blobs) {
      try {
        const { src, w, h } = await readImage(blob)
        const vp = this.viewportPageBounds()
        // land at a comfortable size: at most ~60% of the view
        const scale = Math.min(1, (vp.w * 0.6) / w, (vp.h * 0.6) / h)
        const pw = Math.max(8, w * scale)
        const ph = Math.max(8, h * scale)
        const cx = at ? at.x : vp.x + vp.w / 2
        const cy = at ? at.y : vp.y + vp.h / 2
        const assetId = newId('asset')
        this.store.transact(() => {
          this.store.put({ id: assetId, typeName: 'asset', src, w, h })
          this.store.put({
            id: newId(), typeName: 'shape', type: 'image',
            x: cx - pw / 2, y: cy - ph / 2, rot: 0, z: this.store.maxZ() + 1,
            props: { w: pw, h: ph, assetId },
          })
        })
        if (at) { at = { x: at.x + 24, y: at.y + 24 } }
      } catch (e2) { console.warn('image import failed', e2) }
    }
  }
  pickImage() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => { if (input.files?.length) this.importImageBlobs([...input.files]) }
    input.click()
  }

  // ---- export --------------------------------------------------------------
  // Renders the drawing into a PNG at crisp resolution — with the paper
  // behind it, or on transparency. Everything by default; pass ids (a Set)
  // to export just those shapes.
  async exportImage({ background = true, scale = 2, margin = 48, ids = null } = {}) {
    let b = null
    const shapes = this.shapesSorted().filter((s) => !ids || ids.has(s.id))
    for (const s of shapes) b = boundsUnion(b, pageBounds(s))
    if (!b) return null
    b = boundsExpand(b, margin)
    // stay under ~24MP however big the drawing is
    const cap = Math.sqrt(24e6 / (b.w * b.h))
    const k = Math.min(scale, cap)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(b.w * k))
    canvas.height = Math.max(1, Math.round(b.h * k))
    const ctx = canvas.getContext('2d')
    if (background) {
      ctx.fillStyle = this.theme.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // the grid travels with the paper: an exported board looks like the board
      this._drawGrid(ctx, { x: -b.x, y: -b.y, z: k }, canvas.width, canvas.height, 1)
    }
    ctx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k)
    // make sure every image asset is decoded before the snap
    await this._decodeAssets(shapes)
    for (const s of shapes) drawShape(ctx, s, { theme: this.theme, store: this.store, zoom: k })
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
  }
  // The drawing as an SVG document string — vectors all the way, so it
  // scales without limit and opens in any design tool. Same options as
  // exportImage (no `scale`: there is no pixel density to pick).
  exportSvg({ background = true, margin = 48, ids = null } = {}) {
    const shapes = this.shapesSorted().filter((s) => !ids || ids.has(s.id))
    if (!shapes.length) return null
    return sceneToSvg(shapes, { theme: this.theme, store: this.store, grid: background ? this.grid : 'none', background, margin })
  }
  async _decodeAssets(shapes) {
    const waits = []
    for (const s of shapes) {
      if (s.type !== 'image' || !s.props.assetId) continue
      const a = this.store.asset(s.props.assetId)
      if (!a) continue
      waits.push(new Promise((res) => {
        const img = new Image()
        img.onload = res
        img.onerror = res
        img.src = a.src
        if (img.complete) res()
      }))
    }
    await Promise.all(waits)
  }

  // ---- rendering -----------------------------------------------------------
  requestRender() {
    if (this._raf || this._destroyed) return
    this._raf = requestAnimationFrame(() => {
      this._raf = 0
      this.render()
    })
  }
  resize() {
    this.requestRender()
  }

  // content-only pass (paper + shapes), reused by the screen, the capture
  // canvas and image export
  renderScene(ctx, cam, w, h, { dpr = 1, background = true, hideEditing = false } = {}) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (background) {
      ctx.fillStyle = this.theme.background
      ctx.fillRect(0, 0, w * dpr, h * dpr)
    } else {
      ctx.clearRect(0, 0, w * dpr, h * dpr)
    }
    if (background) this._drawGrid(ctx, cam, w * dpr, h * dpr, dpr)
    ctx.setTransform(cam.z * dpr, 0, 0, cam.z * dpr, cam.x * cam.z * dpr, cam.y * cam.z * dpr)
    const vp = { x: -cam.x, y: -cam.y, w: w / cam.z, h: h / cam.z }
    const pad = 64 / cam.z
    const vis = boundsExpand(vp, pad)
    for (const s of this.shapesSorted()) {
      const pb = pageBounds(s)
      if (pb.x + pb.w < vis.x || pb.x > vis.x + vis.w || pb.y + pb.h < vis.y || pb.y > vis.y + vis.h) continue
      const alpha = this.shapeAlpha ? this.shapeAlpha(s) : 1
      if (alpha <= 0) continue
      if (alpha < 1) { ctx.save(); ctx.globalAlpha *= alpha }
      drawShape(ctx, s, {
        theme: this.theme, store: this.store, zoom: cam.z,
        ghost: this.session?.type === 'erasing' && this.session.hits.has(s.id),
        // the floating textarea is the visible text while editing — but only on
        // screen; capture/export have no DOM, so they keep the canvas text
        hideText: hideEditing && this.editing?.id === s.id ? this.editing.field : null,
        // the whole picture ghosts around the crop window — on screen only
        cropPreview: hideEditing && this.cropping?.id === s.id,
        onAssetLoad: () => this.requestRender(),
      })
      if (alpha < 1) ctx.restore()
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  // The lattice, drawn in device pixels so rules stay hairline-crisp at any
  // zoom. Spacing doubles or halves to stay in a comfortable band, and a new
  // level fades in as you zoom rather than popping into place.
  // W/H are device px; the ctx must be untransformed.
  _drawGrid(ctx, cam, W, H, dpr) {
    if (this.grid === 'none' || !(cam.z > 0)) return
    // point-like marks (dots, crosses) carry less ink, so they use the darker ramp
    const g = this.theme.grid?.[['dots', 'crosses'].includes(this.grid) ? 'dot' : 'line']
    if (!g) return
    let step = GRID_STEP
    while (step * cam.z < 18) step *= 2
    while (step * cam.z > 72) step /= 2
    const fade = clamp((step * cam.z - 16) / 14, 0, 1)
    if (fade <= 0) return
    const z = cam.z * dpr
    // first line/dot of each axis that lands inside the frame
    const n0 = Math.ceil(-cam.x / step)
    const m0 = Math.ceil(-cam.y / step)
    const isMajor = (i) => i % GRID_MAJOR === 0
    const cols = [], rows = []
    for (let n = n0, x = (n0 * step + cam.x) * z; x <= W; n++, x += step * z) cols.push([x, isMajor(n)])
    for (let m = m0, y = (m0 * step + cam.y) * z; y <= H; m++, y += step * z) rows.push([y, isMajor(m)])

    ctx.save()
    if (this.grid === 'lines' || this.grid === 'ruled') {
      for (const major of [false, true]) {
        ctx.beginPath()
        // half-pixel offsets keep a 1px rule on one device pixel, not two
        if (this.grid === 'lines') {
          for (const [x, m] of cols) if (m === major) { const p = Math.round(x) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H) }
        }
        for (const [y, m] of rows) if (m === major) { const p = Math.round(y) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p) }
        ctx.strokeStyle = major ? g.major : g.minor
        ctx.globalAlpha = fade
        ctx.lineWidth = 1
        ctx.stroke()
      }
    } else if (this.grid === 'crosses') {
      // a small + at each intersection — the draughtsman's registration marks
      for (const major of [false, true]) {
        const arm = (major ? 4.5 : 3) * dpr
        ctx.beginPath()
        for (const [y, my] of rows) {
          const py = Math.round(y) + 0.5
          for (const [x, mx] of cols) {
            if ((mx && my) !== major) continue
            const px = Math.round(x) + 0.5
            ctx.moveTo(px - arm, py); ctx.lineTo(px + arm, py)
            ctx.moveTo(px, py - arm); ctx.lineTo(px, py + arm)
          }
        }
        ctx.strokeStyle = major ? g.major : g.minor
        ctx.globalAlpha = fade
        ctx.lineWidth = 1
        ctx.stroke()
      }
    } else if (this.grid === 'iso') {
      // isometric weave: the two 30° diagonal families make a diamond lattice
      // that stays self-aligned at every zoom. One quiet weight — major
      // emphasis turns a woven field into noise.
      const s = Math.tan(Math.PI / 6) // 30° from horizontal
      ctx.beginPath()
      for (const sign of [1, -1]) {
        const slope = sign * s
        // page-space intercepts k*step, mapped into device space
        const b0 = -slope * cam.x + cam.y // device intercept of the k=0 line, /z
        const lo = Math.min(0, -slope * (W / z)) // device-x range → intercept range
        const hi = Math.max(H / z, H / z - slope * (W / z))
        const k0 = Math.ceil((lo - b0) / step)
        const k1 = Math.floor((hi - b0) / step)
        for (let k = k0; k <= k1; k++) {
          const b = (b0 + k * step) * z
          ctx.moveTo(0, b)
          ctx.lineTo(W, b + slope * W)
        }
      }
      ctx.strokeStyle = g.minor
      ctx.globalAlpha = fade
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      // one weight, one ink — emphasized dots read as stray marks on the paper
      const r = 1.6 * dpr
      ctx.beginPath()
      for (const [y] of rows) {
        for (const [x] of cols) {
          ctx.moveTo(x + r, y)
          ctx.arc(x, y, r, 0, Math.PI * 2)
        }
      }
      ctx.fillStyle = g.minor
      ctx.globalAlpha = fade
      ctx.fill()
    }
    ctx.restore()
  }

  render() {
    if (this._destroyed) return
    if (this._pendingFit) {
      const { w: pw, h: ph } = this.viewSize()
      if (pw > 1 && ph > 1) {
        const fit = this._pendingFit
        this._pendingFit = null
        fit()
      }
    }
    const { w, h } = this.viewSize()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    for (const c of [this.canvas, this.overlay]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
    }
    const ctx = this.canvas.getContext('2d')
    this.renderScene(ctx, this.camera, w, h, { dpr, hideEditing: true })
    this._renderOverlay(w, h, dpr)
    this._renderCapture()
    if (this.editing) this._layoutTextEditor()
  }

  // a 9px handle square at a screen point, turned with its shape
  _drawHandle(ctx, h, rot) {
    ctx.save()
    ctx.translate(h.x, h.y)
    if (rot) ctx.rotate(rot)
    ctx.beginPath()
    ctx.rect(-4.5, -4.5, 9, 9)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  _renderOverlay(w, h, dpr) {
    const ctx = this.overlay.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    ctx.scale(dpr, dpr)
    const cam = this.camera
    const t = this.theme

    // crop mode: the source frame dashed, the window solid with its handles
    const cropImg = this.cropping && this.store.get(this.cropping.id)
    if (cropImg) {
      const f = imageFrame(cropImg)
      const quad = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([lx, ly]) => this._localToScreen(cropImg, lx, ly))
      const trace = (pts) => {
        ctx.beginPath()
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
        ctx.closePath()
      }
      ctx.strokeStyle = t.selection
      ctx.fillStyle = t.handleFill
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      trace(quad(f.x, f.y, f.w, f.h))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1.5
      trace(quad(0, 0, cropImg.props.w, cropImg.props.h))
      ctx.stroke()
      for (const [, h] of this._boxHandles(cropImg)) this._drawHandle(ctx, h, cropImg.rot)
    }

    // groups: a dashed frame around each selected group, and around the
    // focused one while you're inside it
    if (this.tool === 'select' && !this.editing && !cropImg) {
      const frames = new Set(this.selectionGroups())
      if (this.focusedGroup) frames.add(this.focusedGroup)
      ctx.strokeStyle = t.selection
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      for (const g of frames) {
        const b = this._groupBounds(g)
        if (!b) continue
        const tl = this.pageToScreen(b.x - 4, b.y - 4)
        ctx.strokeRect(tl.x, tl.y, (b.w + 8) * cam.z, (b.h + 8) * cam.z)
      }
      ctx.setLineDash([])
    }

    // selection
    if (this.tool === 'select' && this.selection.size && !this.editing && !cropImg) {
      const one = this.selection.size === 1 ? this.store.get([...this.selection][0]) : null
      ctx.strokeStyle = t.selection
      ctx.fillStyle = t.handleFill
      ctx.lineWidth = 1.5
      if (one && (one.type === 'arrow' || one.type === 'line')) {
        const pr = one.props
        const hs = [
          this.pageToScreen(one.x, one.y),
          this.pageToScreen(one.x + pr.dx, one.y + pr.dy),
        ]
        const bm = bendMidpoint(pr)
        hs.push(this.pageToScreen(one.x + bm.x, one.y + bm.y))
        for (const p2 of hs) {
          ctx.beginPath()
          ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      } else {
        // rotated single shape draws its true (rotated) frame
        if (one && one.rot) {
          const lb = localBounds(one)
          const cx = one.x + lb.x + lb.w / 2
          const cy = one.y + lb.y + lb.h / 2
          ctx.beginPath()
          const corners = [
            [one.x + lb.x, one.y + lb.y], [one.x + lb.x + lb.w, one.y + lb.y],
            [one.x + lb.x + lb.w, one.y + lb.y + lb.h], [one.x + lb.x, one.y + lb.y + lb.h],
          ].map(([px, py]) => {
            const r = rotWith(px, py, cx, cy, one.rot)
            return this.pageToScreen(r.x, r.y)
          })
          ctx.moveTo(corners[0].x, corners[0].y)
          for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
          ctx.closePath()
          ctx.stroke()
        }
        const b = this.selectionBounds()
        if (b) {
          const tl = this.pageToScreen(b.x, b.y)
          const br = this.pageToScreen(b.x + b.w, b.y + b.h)
          if (!(one && one.rot)) ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
          // the rotate knob, for fingers: a stem from the top edge to it.
          // A mouse rotates from the corners instead (see _hitRotateZone).
          if (this._coarse) {
            const r = this._rotateHandle(one)
            const dx = (r.x - r.ax) / 22, dy = (r.y - r.ay) / 22
            ctx.beginPath()
            ctx.moveTo(r.ax, r.ay)
            ctx.lineTo(r.x - dx * 5, r.y - dy * 5)
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(r.x, r.y, 5, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          // resize handles: on the box — a rotated shape's own box, squares
          // turned with it
          for (const [, h] of this._resizeHandles(one, b)) this._drawHandle(ctx, h, one?.rot || 0)
        }
      }
    }

    // the shape an arrow end being dragged would tie to
    const hover = this.bindHover && this.store.get(this.bindHover)
    if (hover) {
      const b = pageBounds(hover)
      const tl = this.pageToScreen(b.x - 3, b.y - 3)
      ctx.strokeStyle = t.selection
      ctx.lineWidth = 2
      ctx.strokeRect(tl.x, tl.y, (b.w + 6) * cam.z, (b.h + 6) * cam.z)
    }

    // marquee
    if (this.session?.type === 'marquee' && this.session.rect) {
      const r = this.session.rect
      const tl = this.pageToScreen(r.x, r.y)
      ctx.fillStyle = t.selectionFill
      ctx.strokeStyle = t.selection
      ctx.lineWidth = 1
      ctx.fillRect(tl.x, tl.y, r.w * cam.z, r.h * cam.z)
      ctx.strokeRect(tl.x, tl.y, r.w * cam.z, r.h * cam.z)
    }

    // eraser trail
    if (this.session?.type === 'erasing' && this.session.trail.length > 2) {
      ctx.strokeStyle = t.id === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const tr = this.session.trail
      for (let i = 0; i < tr.length; i += 2) {
        const sp = this.pageToScreen(tr[i], tr[i + 1])
        i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y)
      }
      ctx.stroke()
    }

    // laser scribbles — local and remote, same glow
    const remoteAlive = this.remoteScribbles.length && performance.now() - this.remoteScribblesAt < 2500
    const all = [...this.scribbles, ...(remoteAlive ? this.remoteScribbles : [])]
    for (const sc of all) {
      const pts = sc.points || []
      if (pts.length < 2) continue
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const sp = this.pageToScreen(pts[i].x, pts[i].y)
        i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y)
      }
      ctx.strokeStyle = t.scribble
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = t.scribble
      ctx.shadowBlur = 9
      ctx.globalAlpha = sc.opacity ?? 1
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }
  }

  // clean pixels for recordings: the current view, contain-fitted into the
  // capture canvas (bands are paper — the compositor's cover crop trims them)
  setCaptureCanvas(canvas) {
    this.captureCanvas = canvas
    if (canvas) this.requestRender()
  }
  // heartbeat repaint for captureStream consumers — repaints ONLY the capture
  // canvas so idle recordings keep receiving frames
  renderCaptureTick() {
    this._renderCapture()
  }
  _renderCapture() {
    const c = this.captureCanvas
    if (!c) return
    // nobody is recording/streaming this board — skip the extra pass
    if (this.captureGate && !this.captureGate()) return
    const { w, h } = this.viewSize()
    if (!w || !h) return
    const cam = this.camera
    const vp = { x: -cam.x, y: -cam.y, w: w / cam.z, h: h / cam.z }
    const z2 = Math.min(c.width / vp.w, c.height / vp.h)
    const cam2 = {
      z: z2,
      x: c.width / 2 / z2 - (vp.x + vp.w / 2),
      y: c.height / 2 / z2 - (vp.y + vp.h / 2),
    }
    const ctx = c.getContext('2d', { alpha: false, desynchronized: true })
    this.renderScene(ctx, cam2, c.width, c.height, { dpr: 1 })
    // remote laser reaches recordings too
    const remoteAlive = this.remoteScribbles.length && performance.now() - this.remoteScribblesAt < 2500
    if (remoteAlive || this.scribbles.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      for (const sc of [...this.scribbles, ...(remoteAlive ? this.remoteScribbles : [])]) {
        const pts = sc.points || []
        if (pts.length < 2) continue
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const x = (pts[i].x + cam2.x) * cam2.z
          const y = (pts[i].y + cam2.y) * cam2.z
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.strokeStyle = this.theme.scribble
        ctx.lineWidth = 3.5 * (z2 / cam.z)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.shadowColor = this.theme.scribble
        ctx.shadowBlur = 9
        ctx.globalAlpha = sc.opacity ?? 1
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
      }
    }
  }

  destroy() {
    this._destroyed = true
    this._commitText()
    this.endCrop()
    this._themeFade?.remove()
    this._themeFade = null
    cancelAnimationFrame(this._raf)
    cancelAnimationFrame(this._camAnim)
    cancelAnimationFrame(this._fitEaseRaf || 0)
    cancelAnimationFrame(this._laserRaf || 0)
    this._unsubStore()
    this._unsubHistory()
    this._unsubReact()
    this._ro.disconnect()
    const c = this.container
    c.removeEventListener('pointerdown', this._onDown)
    c.removeEventListener('pointermove', this._onMove)
    c.removeEventListener('pointerup', this._onUp)
    c.removeEventListener('pointercancel', this._onUp)
    c.removeEventListener('wheel', this._onWheel)
    c.removeEventListener('keydown', this._onKeyDown)
    c.removeEventListener('keyup', this._onKeyUp)
    c.removeEventListener('dblclick', this._onDblClick)
    c.removeEventListener('drop', this._onDrop)
    c.removeEventListener('dragover', this._onDragOver)
    c.removeEventListener('paste', this._onPaste)
    c.removeEventListener('contextmenu', this._onContextMenu)
    c.removeEventListener('blur', this._onBlur)
    c.removeEventListener('scroll', this._onScroll)
    document.removeEventListener('keydown', this._onDocKey, true)
    document.fonts?.removeEventListener?.('loadingdone', this._onFonts)
    this._clearPressTimer()
    this.canvas.remove()
    this.overlay.remove()
    c.classList.remove('qd-root')
  }
}

// text as the board keeps it: Unix newlines, tabs as four spaces (a tab
// draws as one space on a canvas and eight columns in a textarea)
export const normalizeText = (t) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')

// follow a link from the board, in a new tab and only to somewhere sane
export function openUrl(href) {
  if (!/^(https?:|mailto:)/i.test(String(href))) return
  try { window.open(href, '_blank', 'noopener,noreferrer') } catch {}
}

// decode + gently downscale an imported image, return a dataURL asset
async function readImage(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = url
    })
    let { width: w, height: h } = img
    const MAX = 2048
    const k = Math.min(1, MAX / Math.max(w, h))
    if (k < 1 || blob.type === 'image/heic') {
      const c = document.createElement('canvas')
      c.width = Math.round(w * k)
      c.height = Math.round(h * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      const isPhoto = blob.type === 'image/jpeg' || blob.size > 600_000
      return { src: c.toDataURL(isPhoto ? 'image/jpeg' : 'image/png', 0.85), w: c.width, h: c.height }
    }
    const src = await new Promise((res) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.readAsDataURL(blob)
    })
    return { src, w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}
