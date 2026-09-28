import type { AssetRecord, Editor, ShapeRecord } from '@quickdrawjs/core'
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

const GOLDEN = Math.PI * (3 - Math.sqrt(5))
/** Room between clumps, page units. */
const GAP = 120

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * Newest at the centre, spiralling out by area, so big clumps take the room
 * they need; then a nudge apart wherever two still overlap. Returns each
 * clump's box in the room and the shift that puts its records there.
 */
function layout(groups: EveryoneGroup[]): Array<Laid & { dx: number; dy: number }> {
  const boxes: Array<{ x: number; y: number; w: number; h: number; ox: number; oy: number; group: EveryoneGroup }> = []
  let area = 0
  for (const group of groups) {
    const records = group.items.map((it) => it.record as ShapeRecord | undefined).filter((r): r is ShapeRecord => !!r)
    const b = unionBounds(records)
    if (!b) continue
    const i = boxes.length
    area += (b.w + GAP) * (b.h + GAP)
    const r = i === 0 ? 0 : Math.sqrt(area / Math.PI)
    const t = i * GOLDEN
    const key = group.items[0]!.id
    const jx = (hash(key) - 0.5) * GAP
    const jy = (hash(key + '/y') - 0.5) * GAP
    boxes.push({ x: r * Math.cos(t) + jx - b.w / 2, y: r * Math.sin(t) + jy - b.h / 2, w: b.w, h: b.h, ox: b.x, oy: b.y, group })
  }
  for (let pass = 0; pass < 300; pass++) {
    let moved = false
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + GAP
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + GAP
        if (ox <= 0 || oy <= 0) continue
        moved = true
        // push apart along the shorter overlap; the newer one (lower index) yields less
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2
        if (ox < oy) {
          const dir = bx >= ax ? 1 : -1
          a.x -= dir * ox * 0.35
          b.x += dir * ox * 0.65
        } else {
          const dir = by >= ay ? 1 : -1
          a.y -= dir * oy * 0.35
          b.y += dir * oy * 0.65
        }
      }
    }
    if (!moved) break
  }
  return boxes.map((b) => ({ group: b.group, box: { x: b.x, y: b.y, w: b.w, h: b.h }, dx: b.x - b.ox, dy: b.y - b.oy }))
}

export function Everyone({ me, welcome = false }: { me: Me | null; welcome?: boolean }) {
  const store = useQuickdrawStore()
  const [data, setData] = useState<EveryoneData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [welcoming, setWelcoming] = useState(welcome)
  const [editor, setEditor] = useState<Editor | null>(null)
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
    // Open on the whole room; zooming in to read is the visitor's move.
    if (editor && laid.length) editor.fitContent({ maxZoom: 1 })
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
    // Until the room arrives, the newest's spot (the origin) sits in the middle.
    const { w, h } = ed.viewSize()
    ed.setCamera({ x: w / 2, y: h / 2, z: 1 })
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
      {editor && <Chips editor={editor} laid={laid} people={people} meId={me?.id ?? null} />}
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
 * A chip at each clump's foot: who, where, when; the caption unfolds on hover.
 * The chips sit in page coordinates on a layer that carries the camera, so a
 * pan moves them with the board and only the layer's transform changes.
 */
function Chips({ editor, laid, people, meId }: { editor: Editor; laid: Laid[]; people: People; meId: string | null }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => editor.on('camera', rerender), [editor])
  const chips = useMemo(
    () =>
      laid.map((l) => {
        const newest = l.group.items[0]!
        const by = nameOf(people, newest.meta.by, meId)
        const where = newest.meta.by === l.group.boardId ? '' : ` on ${nameOf(people, l.group.boardId, meId)}'s desktop`
        const count = l.group.items.length > 1 ? ` · ${l.group.items.length} things` : ''
        const title = `${by}${where} · ${relativeTime(l.group.editedAt)}${count}`
        return (
          <a key={newest.id} className="World-by" href={hrefOf(l, people) ?? '#'} title={title} style={{ translate: `${l.box.x}px ${l.box.y + l.box.h}px` }} draggable={false}>
            <Avatar id={newest.meta.by} name={nameOf(people, newest.meta.by)} avatar={people.get(newest.meta.by)?.avatar ?? null} className="Avatar--small" />
            <span className="World-caption">{title}</span>
          </a>
        )
      }),
    [laid, people, meId]
  )
  const cam = editor.camera
  return (
    <div className="World-chips" style={{ transform: `translate(${cam.x * cam.z}px, ${cam.y * cam.z}px) scale(${cam.z})`, ['--iz' as string]: 1 / cam.z }}>
      {chips}
    </div>
  )
}
