import { pageBounds, type AssetRecord, type ShapeRecord } from '@quickdrawjs/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { describeAge } from '../shared/freshness'
import type { Feed as FeedData, FeedItem, Me, PlacedItem } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { nameOf, relativeTime, type People } from './people'
import { gapBetween, renderThumb } from './thumb'
import { itemsLink } from './viewLink'

/**
 * A cluster: things that sit together on one desktop. Whatever people put
 * near each other belongs together, the same instinct the decay rules use,
 * so a title, a picture and the sticky beside it read as one entry.
 */
interface Group {
  key: string
  boardId: string
  /** Who contributed, most recent first. */
  people: string[]
  newest: number
  oldestAge: number
  items: FeedItem[]
  /** A short piece of text from the cluster, if it has one: its caption. */
  title: string | null
}

/** Boxes closer than this (page units) belong to the same cluster; bigger things reach a touch further. */
const CLUSTER_GAP = 110

/**
 * Clusters run over everything placed on a desktop, not only the things in
 * the feed, so a long column whose older parts are not "new" still reads as
 * one entry; each cluster then shows the feed's things that sit in it.
 */
function clusterItems(items: FeedItem[], placedByBoard: Record<string, PlacedItem[]>): Group[] {
  const groups: Group[] = []
  const byBoard = new Map<string, FeedItem[]>()
  for (const item of items) {
    const list = byBoard.get(item.boardId) ?? []
    list.push(item)
    byBoard.set(item.boardId, list)
  }
  for (const [boardId, list] of byBoard) {
    // every placed thing on the desktop; where the feed carries the record, its exact box replaces the server's estimate
    const exact = new Map<string, PlacedItem>()
    for (const item of list) {
      if (!item.record) continue
      const b = pageBounds(item.record as ShapeRecord)
      exact.set(item.id, { id: item.id, x: b.x, y: b.y, w: b.w, h: b.h })
    }
    const nodes: PlacedItem[] = (placedByBoard[boardId] ?? []).map((n) => (exact.has(n.id) ? { ...n, ...exact.get(n.id)! } : n))
    const known = new Set(nodes.map((n) => n.id))
    for (const [id, n] of exact) {
      if (known.has(id)) continue
      nodes.push(n)
      known.add(id)
    }
    const parent = nodes.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!
        const reach = CLUSTER_GAP + 0.04 * Math.min(Math.max(a.w, a.h), Math.max(b.w, b.h))
        if (gapBetween(a, b) <= reach) parent[find(i)] = find(j)
      }
    }
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    const buckets = new Map<number, { items: FeedItem[]; nodes: PlacedItem[] }>()
    for (const item of list) {
      const i = index.get(item.id)
      const root = i === undefined ? -1 - buckets.size : find(i)
      const bucket = buckets.get(root) ?? { items: [], nodes: [] }
      bucket.items.push(item)
      buckets.set(root, bucket)
    }
    nodes.forEach((n, i) => buckets.get(find(i))?.nodes.push(n))
    for (const bucket of buckets.values()) groups.push(makeGroup(boardId, bucket.items, bucket.nodes))
  }
  return groups
}

function makeGroup(boardId: string, items: FeedItem[], nodes: PlacedItem[]): Group {
  const sorted = [...items].sort((a, b) => b.meta.editedAt - a.meta.editedAt)
  const people = [...new Set(sorted.map((i) => i.meta.by))]
  return {
    key: `${boardId}:${sorted.map((i) => i.id).join(',')}`,
    boardId,
    people,
    newest: sorted[0]!.meta.editedAt,
    oldestAge: Math.max(...sorted.map((i) => i.age)),
    items: sorted,
    title: titleOf(nodes),
  }
}

/** The biggest short text anywhere in the cluster, the way a heading would be. */
function titleOf(nodes: PlacedItem[]): string | null {
  let best: PlacedItem | null = null
  for (const n of nodes) {
    if (!n.text) continue
    if (!best || (n.weight ?? 0) > (best.weight ?? 0)) best = n
  }
  return best?.text ?? null
}

/** A panel beside the desktop: what the people you follow made lately, and what is about to disappear. */
/** The last feed fetched, so the panel comes back filled when the desktop changes. */
let lastFeed: FeedData | null = null

const REFRESH_MS = 30_000

/**
 * The feed keeps itself current: every half minute while open, whenever the
 * board in front of you changes (`changeKey`), and when the tab comes back.
 */
export function FeedPanel({ me, theme, changeKey = 0, onClose }: { me: Me; theme: 'light' | 'dark'; changeKey?: number; onClose: () => void }) {
  const [feed, setFeed] = useState<FeedData | null>(lastFeed)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let inflight = false
    const load = () => {
      if (inflight || document.visibilityState === 'hidden') return
      inflight = true
      api
        .feed()
        .then((f) => {
          if (!alive) return
          lastFeed = f
          setFeed(f)
          setError(null)
        })
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Could not load the feed'))
        .finally(() => {
          inflight = false
        })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // changeKey: the board changed under us, fetch again
  }, [changeKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const people: People = useMemo(() => {
    const map: People = new Map((feed?.people ?? []).map((p) => [p.id, p]))
    map.set(me.id, { id: me.id, handle: me.handle, name: me.name, avatar: me.avatar })
    return map
  }, [feed, me])
  const recent = useMemo(() => (feed ? clusterItems(feed.recent, feed.placed ?? {}).sort((a, b) => b.newest - a.newest) : []), [feed])
  const vanishing = useMemo(() => (feed ? clusterItems(feed.vanishing, feed.placed ?? {}).sort((a, b) => b.oldestAge - a.oldestAge) : []), [feed])

  return (
    <aside className="FeedPanel" onPointerDown={(e) => e.stopPropagation()}>
      <header className="FeedPanel-header">
        <strong>Feed</strong>
        <button type="button" className="TopBar-button TopBar-button--icon TopBar-button--quiet" onClick={onClose} aria-label="Close the feed" title="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="FeedPanel-body">
        {error && <p className="Error">{error}</p>}
        {!feed && !error && <p className="Muted">Loading…</p>}
        {feed && (
          <>
            <section className="FeedSection">
              <h2 className="FeedSection-title">Vanishing soon</h2>
              {vanishing.length === 0 ? (
                <p className="Muted">Nothing is fading right now.</p>
              ) : (
                vanishing.map((g) => <Entry key={`v:${g.key}`} group={g} people={people} meId={me.id} theme={theme} vanishing />)
              )}
            </section>
            <section className="FeedSection">
              <h2 className="FeedSection-title">New from people you follow</h2>
              {recent.length === 0 ? (
                <p className="Muted">Quiet this week. Find people to follow from the name at the top left.</p>
              ) : (
                recent.map((g) => <Entry key={`r:${g.key}`} group={g} people={people} meId={me.id} theme={theme} />)
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function listNames(ids: string[], people: People, meId: string) {
  const names = ids.map((id) => nameOf(people, id, meId))
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

function Entry({ group, people, meId, theme, vanishing = false }: { group: Group; people: People; meId: string; theme: 'light' | 'dark'; vanishing?: boolean }) {
  const boardHandle = people.get(group.boardId)?.handle ?? null
  const href = boardHandle ? itemsLink(boardHandle, group.items.map((i) => i.id)) : '#'
  const n = group.items.length
  const who = listNames(group.people, people, meId)
  const onOwn = group.people.every((id) => id === group.boardId)
  const where = group.boardId === meId ? 'your desktop' : `${nameOf(people, group.boardId, meId)}'s desktop`
  const count = `${n} thing${n === 1 ? '' : 's'}`
  const what = vanishing ? `${count} · ${describeAge(group.oldestAge)}` : `${count}${onOwn ? '' : ` on ${where}`}`

  return (
    <a className="Entry" href={href} style={{ opacity: vanishing ? Math.max(0.4, 1 - (group.oldestAge - 1) / 3) : 1 }}>
      <div className="Entry-head">
        <span className="Entry-avatars">
          {group.people.slice(0, 3).map((id) => (
            <Avatar key={id} id={id} name={nameOf(people, id)} avatar={people.get(id)?.avatar ?? null} className="Avatar--small" />
          ))}
        </span>
        <span className="Entry-text">
          <span>
            <strong>{who}</strong>
            <span className="Muted"> · {relativeTime(group.newest)}</span>
          </span>
          <span className={`Entry-what${vanishing ? ' Entry-what--vanishing' : ''}`}>{what}</span>
        </span>
      </div>
      {group.title && <div className="Entry-title">{group.title}</div>}
      <Scene items={group.items} theme={theme} />
    </a>
  )
}

function Scene({ items, theme }: { items: FeedItem[]; theme: 'light' | 'dark' }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const records = items.map((i) => i.record as ShapeRecord | undefined).filter((r): r is ShapeRecord => !!r)
  const assets = items.map((i) => i.asset as AssetRecord | undefined).filter((a): a is AssetRecord => !!a)
  const key = records.map((r) => r.id).join(',')
  useEffect(() => {
    if (!canvas.current || !records.length) return
    try {
      renderThumb(canvas.current, records, assets, theme)
    } catch (e) {
      console.warn('thumbnail failed', e)
    }
    // records/assets are derived from items; the id list is the identity that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme])
  return <div className={`Entry-scene${records.length > 1 ? ' Entry-scene--wide' : ''}`}>{records.length ? <canvas ref={canvas} /> : <span className="Muted">a big drawing</span>}</div>
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
