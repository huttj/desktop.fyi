import { pageBounds, type AssetRecord, type Editor, type ShapeRecord } from '@quickdrawjs/core'
import { Quickdraw, openUrl, useQuickdrawStore } from '@quickdrawjs/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import type { Box } from '../shared/bounds'
import { alphaAt, fadeAt } from '../shared/freshness'
import type { Everyone as EveryoneData, EveryoneGroup, Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { Landing } from './Landing'
import { navigate } from './navigate'
import { nameOf, relativeTime, type People } from './people'
import { unionBounds } from './thumb'
import { imageLevels } from './uploads'
import { itemsLink } from './viewLink'

/**
 * The public room: the newest clumps from every desktop, laid out at true
 * size on one Quickdraw board, newest at the centre. Things draw, age and
 * fade exactly as on their own desktops; a click on one visits it there.
 * Nobody's things are hidden here that are not hidden there: every desktop
 * is public already. Signed out, it is also the front door: the welcome
 * card sits over it.
 */

interface Laid {
  group: EveryoneGroup
  /** Where the clump sits in the room (page units), after its records were shifted. */
  box: Box
}

/** Room between things, and the grain of the occupancy grid the packer works on, page units. */
const GAP = 40
const CELL = 32

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * A clump's footprint: the boxes its members actually cover, not the box
 * around them all. Text, notes, pictures and geometry are their boxes; an
 * arrow or line is a run of small boxes along its path (bend included); ink
 * is a run along its points. Each is padded by half the gap. Relative to the
 * clump's own top-left, so the packer can slide the whole footprint around.
 */
function footprint(records: ShapeRecord[], origin: { x: number; y: number }): Box[] {
  const out: Box[] = []
  const pad = GAP / 2
  const dot = (x: number, y: number) => out.push({ x: x - origin.x - pad, y: y - origin.y - pad, w: pad * 2, h: pad * 2 })
  for (const r of records) {
    const p = r.props as Record<string, unknown>
    if (r.type === 'arrow' || r.type === 'line') {
      const dx = Number(p.dx) || 0, dy = Number(p.dy) || 0, bend = Number(p.bend) || 0
      const len = Math.hypot(dx, dy) || 1
      // Quickdraw's quadratic: the control point sits at twice the bend so the curve passes at the bend
      const cx = dx / 2 + (-dy / len) * bend * 2, cy = dy / 2 + (dx / len) * bend * 2
      const steps = Math.max(2, Math.ceil(len / CELL))
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, u = 1 - t
        dot(r.x + u * u * 0 + 2 * u * t * cx + t * t * dx, r.y + 2 * u * t * cy + t * t * dy)
      }
      continue
    }
    if ((r.type === 'draw' || r.type === 'highlight') && Array.isArray(p.pts)) {
      const pts = p.pts as number[]
      const stride = Math.max(3, 3 * Math.floor(pts.length / 3 / 200)) // at most ~200 samples
      for (let i = 0; i + 1 < pts.length; i += stride) dot(r.x + pts[i]!, r.y + pts[i + 1]!)
      continue
    }
    const b = pageBounds(r)
    out.push({ x: b.x - origin.x - pad, y: b.y - origin.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 })
  }
  return out
}

/**
 * Packs the clumps, newest at the centre: each one walks a spiral outward from
 * a little inside the filled disc and takes the first spot where its footprint
 * lands on nothing, so later things settle into the gaps and corners earlier
 * ones left. A clump strides in proportion to its size (a wall-sized photo
 * stepping a cell at a time took seconds), and one that still finds nowhere
 * goes just past everything, never on top of anything. Returns each clump's
 * box in the room and the shift that puts its records there.
 */
function layout(groups: EveryoneGroup[]): Array<Laid & { dx: number; dy: number }> {
  const occupied = new Set<number>()
  const cell = (v: number) => Math.floor(v / CELL)
  const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768)
  const each = (boxes: Box[], ox: number, oy: number, fn: (k: number) => boolean | void) => {
    for (const b of boxes) {
      const x = b.x + ox, y = b.y + oy
      for (let cx = cell(x); cx <= cell(x + b.w); cx++) for (let cy = cell(y); cy <= cell(y + b.h); cy++) if (fn(key(cx, cy)) === false) return false
    }
    return true
  }
  const free = (boxes: Box[], ox: number, oy: number) => each(boxes, ox, oy, (k) => !occupied.has(k))
  const take = (boxes: Box[], ox: number, oy: number) => each(boxes, ox, oy, (k) => void occupied.add(k))
  const out: Array<Laid & { dx: number; dy: number }> = []
  let filled = 0
  let right = 0 // the room's right edge so far
  for (const group of groups) {
    const records = group.items.map((it) => it.record as ShapeRecord | undefined).filter((r): r is ShapeRecord => !!r)
    const b = unionBounds(records)
    if (!b) continue
    const print = footprint(records, b)
    const area = print.reduce((n, f) => n + f.w * f.h, 0)
    // start a little inside the edge of what is filled: gaps there get used, and the search stays short
    let r = Math.sqrt(filled / Math.PI) * 0.6
    let t = hash(group.items[0]!.id) * Math.PI * 2
    const stride = Math.max(CELL, Math.min(b.w, b.h) / 4)
    let spot: { x: number; y: number } | null = null
    for (let n = 0; n < 20000; n++) {
      const x = r * Math.cos(t) - b.w / 2, y = r * Math.sin(t) - b.h / 2
      if (free(print, x, y)) {
        spot = { x, y }
        break
      }
      const dt = stride / Math.max(r, stride)
      t += dt
      r += (stride * dt) / (Math.PI * 2)
    }
    if (!spot) spot = { x: right + GAP, y: -b.h / 2 }
    take(print, spot.x, spot.y)
    right = Math.max(right, spot.x + b.w)
    filled += area
    const box = { x: spot.x, y: spot.y, w: b.w, h: b.h }
    out.push({ group, box, dx: box.x - b.x, dy: box.y - b.y })
  }
  return out
}

export function Everyone({ me, welcome = false }: { me: Me | null; welcome?: boolean }) {
  const store = useQuickdrawStore()
  const [data, setData] = useState<EveryoneData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [welcoming, setWelcoming] = useState(welcome)
  const [editor, setEditor] = useState<Editor | null>(null)
  /** The thing under the pointer: its clump alone wears a chip, at that thing's foot. */
  const [hover, setHover] = useState<string | null>(null)
  /** Each thing's age and clump, for the render hooks and for a click. */
  const ages = useRef(new Map<string, number>())
  const clumpOf = useRef(new Map<string, Laid>())

  useEffect(() => {
    api
      .everyone()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the room'))
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = () => setTheme(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', follow)
    return () => mq.removeEventListener('change', follow)
  }, [])

  useEffect(() => {
    if (!welcoming) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setWelcoming(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [welcoming])

  const people: People = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data])

  // Lay the clumps out and put every record on the board, shifted into place.
  const laid = useMemo(() => (data ? layout(data.groups) : []), [data])
  useEffect(() => {
    ages.current.clear()
    clumpOf.current.clear()
    const seen = new Set<string>()
    store.transact(() => {
      for (const l of laid) {
        for (const item of l.group.items) {
          const rec = item.record as ShapeRecord | undefined
          if (!rec || seen.has(rec.id)) continue
          seen.add(rec.id)
          ages.current.set(rec.id, item.age)
          clumpOf.current.set(rec.id, l)
          const asset = item.asset as AssetRecord | undefined
          if (asset && !seen.has(asset.id)) {
            seen.add(asset.id)
            store.put(asset, 'remote')
          }
          store.put({ ...rec, x: rec.x + l.dx, y: rec.y + l.dy }, 'remote')
        }
      }
    }, 'remote')
    // Open a step past the fit, so the room spills off the edges and reads as a crowd rather than a chart.
    if (editor && laid.length) {
      editor.fitContent({ maxZoom: 1 })
      const { w, h } = editor.viewSize()
      editor.zoomAt(w / 2, h / 2, 1.7)
    }
    editor?.requestRender()
  }, [store, laid, editor])

  const onMount = useCallback((ed: Editor) => {
    setEditor(ed)
    if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = ed
    // Look only: the hand, and every shape locked. Things age as on their desktops.
    ed.setTool('hand')
    ed.on('tool', () => {
      if (ed.tool !== 'hand') ed.setTool('hand')
    })
    ed.shapeLocked = () => true
    ed.shapeAlpha = (s) => alphaAt(ages.current.get(s.id) ?? 0)
    ed.shapeFade = (s) => fadeAt(ages.current.get(s.id) ?? 0)
    ed.openLink = openUrl
    // the room opens zoomed out over dozens of pictures: tiny copies first, sharper ones as you zoom in
    ed.imageLevels = imageLevels
    // Until the room arrives, the newest's spot (the origin) sits in the middle.
    const { w, h } = ed.viewSize()
    ed.setCamera({ x: w / 2, y: h / 2, z: 1 })
    // The thing under the pointer wears its chip: who, where, when.
    ed.container.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      const r = ed.container.getBoundingClientRect()
      const pt = ed.screenToPage(e.clientX - r.left, e.clientY - r.top)
      const hit = ed.hitTest(pt.x, pt.y, { inside: true })
      setHover(hit && clumpOf.current.has(hit.id) ? hit.id : null)
    })
    ed.container.addEventListener('pointerleave', () => setHover(null))
    // A tap (not a drag) on a thing visits it on its desktop; ⌘/ctrl or middle click opens a tab.
    let press: { x: number; y: number; at: number; newTab: boolean } | null = null
    ed.container.addEventListener('pointerdown', (e) => {
      press = { x: e.clientX, y: e.clientY, at: Date.now(), newTab: e.metaKey || e.ctrlKey || e.button === 1 }
    }, true)
    ed.container.addEventListener('pointerup', (e) => {
      const p = press
      press = null
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4 || Date.now() - p.at > 700) return
      const r = ed.container.getBoundingClientRect()
      const pt = ed.screenToPage(e.clientX - r.left, e.clientY - r.top)
      const hit = ed.hitTest(pt.x, pt.y, { inside: true })
      const l = hit ? clumpOf.current.get(hit.id) : null
      if (!l) return
      const href = hrefOf(l, peopleRef.current)
      if (!href) return
      if (p.newTab) window.open(href, '_blank')
      else navigate(href)
    })
  }, [])
  const peopleRef = useRef(people)
  peopleRef.current = people

  // Not a place to draw: keys other than zoom, and paste or drop, stay out of the board.
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  const guards = {
    onKeyDownCapture: (e: KeyboardEvent<HTMLDivElement>) => {
      const meta = e.metaKey || e.ctrlKey
      const zoom = (meta && ['=', '+', '-', '0'].includes(e.key)) || (e.shiftKey && ['1', '!', '0', ')'].includes(e.key))
      if (!zoom) e.stopPropagation()
    },
    onPasteCapture: stop,
    onDropCapture: stop,
    onDragOverCapture: stop,
    onContextMenuCapture: stop,
  }

  const counts = data?.counts
  return (
    <div className="World" data-theme={theme} {...guards}>
      <Quickdraw store={store} theme={theme} grid="dots" watermark={false} onMount={onMount} />
      {editor && hover && <Chips editor={editor} laid={clumpOf.current.get(hover) ?? null} at={hover} people={people} meId={me?.id ?? null} />}
      <header className="World-header">
        <a className="World-wordmark" href="/">
          desktop.fyi
        </a>
        <div className="World-title">
          <strong>Everyone</strong>
          <span className="World-counts">
            {error && <span className="Error">{error}</span>}
            {!data && !error && 'Looking around…'}
            {counts && (
              <>
                {plural(counts.desktops, 'desktop')} · {counts.active} busy this week · {plural(counts.things, 'thing')} out right now
              </>
            )}
          </span>
        </div>
      </header>
      <div className="World-corner">
        {me ? (
          <a className="TopBar-button" href={`/@${me.handle}`}>
            My desktop
          </a>
        ) : (
          <a className="TopBar-button TopBar-button--primary" href="/login">
            Log in
          </a>
        )}
      </div>
      {data && laid.length === 0 && <div className="Notice">Nothing has been made this week. Be the first.</div>}
      {data && laid.length > 0 && !welcoming && <div className="World-hint Muted">The newest things sit in the middle. Zoom in to read, drag to look around; click anything to visit its desktop.</div>}
      {welcoming && (
        <div className="World-welcome" onPointerDown={(e) => e.target === e.currentTarget && setWelcoming(false)}>
          <Landing onDismiss={() => setWelcoming(false)} />
        </div>
      )}
    </div>
  )
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function hrefOf(l: Laid, people: People): string | null {
  const handle = people.get(l.group.boardId)?.handle
  return handle ? itemsLink(handle, l.group.items.map((i) => i.id)) : null
}

/**
 * A chip at the foot of the clump under the pointer: who, where, when. It sits
 * in page coordinates on a layer that carries the camera, so a pan moves it
 * with the board. Nothing else is decorated: the room reads as a desktop.
 */
function Chips({ editor, laid: l, at, people, meId }: { editor: Editor; laid: Laid | null; at: string; people: People; meId: string | null }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => editor.on('camera', rerender), [editor])
  if (!l) return null
  const newest = l.group.items[0]!
  // at the foot of the thing under the pointer (its record on the board is already shifted into the room)
  const shape = editor.store.get(at) as ShapeRecord | undefined
  const foot = shape ? pageBounds(shape) : null
  const spot = foot ? { x: foot.x, y: foot.y + foot.h } : { x: l.box.x, y: l.box.y + l.box.h }
  const by = nameOf(people, newest.meta.by, meId)
  const where = newest.meta.by === l.group.boardId ? '' : ` on ${nameOf(people, l.group.boardId, meId)}'s desktop`
  const count = l.group.items.length > 1 ? ` · ${l.group.items.length} things` : ''
  const title = `${by}${where} · ${relativeTime(l.group.editedAt)}${count}`
  const cam = editor.camera
  return (
    <div className="World-chips" style={{ transform: `translate(${cam.x * cam.z}px, ${cam.y * cam.z}px) scale(${cam.z})`, ['--iz' as string]: 1 / cam.z }}>
      <a className="World-by" href={hrefOf(l, people) ?? '#'} style={{ translate: `${spot.x}px ${spot.y}px` }} draggable={false}>
        <Avatar id={newest.meta.by} name={nameOf(people, newest.meta.by)} avatar={people.get(newest.meta.by)?.avatar ?? null} className="Avatar--small" />
        <span className="World-caption">{title}</span>
      </a>
    </div>
  )
}
