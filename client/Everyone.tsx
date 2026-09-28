import { pageBounds, type AssetRecord, type ShapeRecord } from '@quickdrawjs/core'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { alphaAt } from '../shared/freshness'
import type { Everyone as EveryoneData, FeedItem, Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { nameOf, relativeTime, type People } from './people'
import { renderThumb } from './thumb'
import { itemsLink } from './viewLink'

/**
 * The public room: the newest things on every desktop, scattered over one
 * shared surface, newest at the centre. Each is drawn small, the way it sits
 * on its own desktop, and leads there. Nobody's things are hidden here that
 * are not hidden there: every desktop is public already.
 */

interface Placed {
  item: FeedItem
  x: number
  y: number
  w: number
  h: number
}

/** Things draw at most this fraction of life size, inside this box; the spiral spaces them about this far apart. */
const MINIATURE = 0.6
const CARD_MAX_W = 200
const CARD_MAX_H = 150
const CARD_MIN = 56
/** renderThumb keeps this much air around a record; the card grows by it so the record itself lands at MINIATURE. */
const THUMB_MARGIN = 12
const SPACING = 112
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const GAP = 14

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/** Newest at the centre, spiralling out; a nudge apart wherever two still overlap. */
function scatter(items: FeedItem[]): Placed[] {
  const placed: Placed[] = items.map((item, i) => {
    const b = pageBounds(item.record as ShapeRecord)
    const scale = Math.min(MINIATURE, (CARD_MAX_W - 2 * THUMB_MARGIN) / Math.max(b.w, 1), (CARD_MAX_H - 2 * THUMB_MARGIN) / Math.max(b.h, 1))
    const w = Math.max(CARD_MIN, b.w * scale + 2 * THUMB_MARGIN)
    const h = Math.max(CARD_MIN, b.h * scale + 2 * THUMB_MARGIN)
    const r = SPACING * Math.sqrt(i)
    const t = i * GOLDEN
    const jx = (hash(item.id) - 0.5) * 40
    const jy = (hash(item.id + '/y') - 0.5) * 40
    return { item, x: r * Math.cos(t) + jx - w / 2, y: r * Math.sin(t) + jy - h / 2, w, h }
  })
  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!, b = placed[j]!
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
  return placed
}

const ZOOM_MIN = 0.35
const ZOOM_MAX = 2

export function Everyone({ me }: { me: Me | null }) {
  const [data, setData] = useState<EveryoneData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const surface = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 })
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  /** Whether the press that just ended was a pan (so the click it produces is not a visit). */
  const panned = useRef(false)

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

  // The centre of the room starts in the middle of the window, a touch below the header.
  useEffect(() => {
    const el = surface.current
    if (!el) return
    const fit = () => setCamera((c) => ({ ...c, x: el.clientWidth / 2, y: el.clientHeight / 2 + 20, z: el.clientWidth < 560 ? 0.75 : c.z }))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const people: People = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data])
  const placed = useMemo(() => (data ? scatter(data.items) : []), [data])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false }
    panned.current = false
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      // Only now is it a pan: capturing any earlier would steal a plain click from the thing under it.
      d.moved = true
      panned.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setCamera((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy }))
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }
  // A drag that moved is a pan, not a visit to whatever it ended over.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (panned.current) e.preventDefault()
  }
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const r = e.currentTarget.getBoundingClientRect()
      const px = e.clientX - r.left, py = e.clientY - r.top
      setCamera((c) => {
        const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z * Math.exp(-e.deltaY * 0.01)))
        const k = z / c.z
        return { x: px - (px - c.x) * k, y: py - (py - c.y) * k, z }
      })
    } else {
      setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
    }
  }
  // The page is locked against browser zoom; the wheel must not bubble into that or the pinch guard.
  useEffect(() => {
    const el = surface.current
    if (!el) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const counts = data?.counts
  return (
    <div className="World" data-theme={theme}>
      <div
        ref={surface}
        className="World-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onWheel={onWheel}
      >
        <div className="World-plane" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
          {placed.map((p) => (
            <Thing key={p.item.id} placed={p} people={people} meId={me?.id ?? null} theme={theme} />
          ))}
        </div>
      </div>
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
      {data && placed.length === 0 && <div className="Notice">Nothing has been made this week. Be the first.</div>}
      {data && placed.length > 0 && <div className="World-hint Muted">The newest things sit in the middle. Drag to look around; click anything to visit its desktop.</div>}
    </div>
  )
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function Thing({ placed, people, meId, theme }: { placed: Placed; people: People; meId: string | null; theme: 'light' | 'dark' }) {
  const { item, x, y, w, h } = placed
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    try {
      renderThumb(canvas.current, [item.record as ShapeRecord], item.asset ? [item.asset as AssetRecord] : [], theme)
    } catch (e) {
      console.warn('thumbnail failed', e)
    }
  }, [item, theme])
  const owner = people.get(item.boardId)
  const by = nameOf(people, item.meta.by, meId)
  const where = item.meta.by === item.boardId ? '' : ` on ${nameOf(people, item.boardId, meId)}'s desktop`
  const title = `${by}${where} · ${relativeTime(item.meta.editedAt)}`
  return (
    <a
      className="World-thing"
      href={owner?.handle ? itemsLink(owner.handle, [item.id]) : '#'}
      style={{ left: x, top: y, width: w, height: h, opacity: alphaAt(item.age) }}
      title={title}
      draggable={false}
    >
      <canvas ref={canvas} />
      <span className="World-by">
        <Avatar id={item.meta.by} name={nameOf(people, item.meta.by)} avatar={people.get(item.meta.by)?.avatar ?? null} className="Avatar--small" />
        <span className="World-caption">{title}</span>
      </span>
    </a>
  )
}
