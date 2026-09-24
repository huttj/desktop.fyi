import type { AssetRecord, ShapeRecord } from '@quickdrawjs/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { describeAge } from '../shared/freshness'
import type { Feed as FeedData, FeedItem, Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { nameOf, relativeTime, type People } from './people'
import { renderThumb } from './thumb'
import { itemsLink } from './viewLink'

/** Things one person made on one desktop within the same stretch of time read as one entry. */
interface Group {
  key: string
  boardId: string
  by: string
  newest: number
  items: FeedItem[]
}

const GROUP_WINDOW_MS = 3 * 60 * 60 * 1000

function groupItems(items: FeedItem[]): Group[] {
  const groups: Group[] = []
  for (const item of [...items].sort((a, b) => b.meta.editedAt - a.meta.editedAt)) {
    const key = `${item.boardId}:${item.meta.by}`
    const g = groups.find((g) => g.key === key && g.newest - item.meta.editedAt < GROUP_WINDOW_MS)
    if (g) g.items.push(item)
    else groups.push({ key, boardId: item.boardId, by: item.meta.by, newest: item.meta.editedAt, items: [item] })
  }
  return groups
}

/** A panel beside the desktop: what the people you follow made lately, and what is about to disappear. */
export function FeedPanel({ me, theme, onClose }: { me: Me; theme: 'light' | 'dark'; onClose: () => void }) {
  const [feed, setFeed] = useState<FeedData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .feed()
      .then(setFeed)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the feed'))
  }, [])

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
  const recent = useMemo(() => (feed ? groupItems(feed.recent) : []), [feed])
  const vanishing = useMemo(() => (feed ? groupItems(feed.vanishing) : []), [feed])

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
                vanishing.map((g) => <Entry key={`v:${g.key}:${g.newest}`} group={g} people={people} meId={me.id} theme={theme} vanishing />)
              )}
            </section>
            <section className="FeedSection">
              <h2 className="FeedSection-title">New from people you follow</h2>
              {recent.length === 0 ? (
                <p className="Muted">Quiet this week. Find people to follow from the name at the top left.</p>
              ) : (
                recent.map((g) => <Entry key={`r:${g.key}:${g.newest}`} group={g} people={people} meId={me.id} theme={theme} />)
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function Entry({ group, people, meId, theme, vanishing = false }: { group: Group; people: People; meId: string; theme: 'light' | 'dark'; vanishing?: boolean }) {
  const boardHandle = people.get(group.boardId)?.handle ?? null
  const ids = group.items.map((i) => i.id)
  const href = boardHandle ? itemsLink(boardHandle, ids) : '#'
  const n = group.items.length
  const who = nameOf(people, group.by, meId)
  const onOwn = group.by === group.boardId
  const where = group.boardId === meId ? 'your desktop' : `${nameOf(people, group.boardId, meId)}'s desktop`
  const oldest = vanishing ? Math.max(...group.items.map((i) => i.age)) : 0
  const what = vanishing ? describeAge(oldest) : `${n === 1 ? 'something new' : `${n} new things`}${onOwn ? '' : ` on ${where}`}`

  return (
    <a className="Entry" href={href} style={{ opacity: vanishing ? Math.max(0.4, 1 - (oldest - 1) / 3) : 1 }}>
      <div className="Entry-head">
        <Avatar id={group.by} name={who} avatar={people.get(group.by)?.avatar ?? null} className="Avatar--small" />
        <span className="Entry-text">
          <span>
            <strong>{who}</strong>
            {vanishing && !onOwn ? <span className="Muted"> on {where}</span> : null}
          </span>
          <span className={`Entry-what${vanishing ? ' Entry-what--vanishing' : ''}`}>
            {what}
            <span className="Muted"> · {relativeTime(group.newest)}</span>
          </span>
        </span>
      </div>
      <div className={`Entry-thumbs Entry-thumbs--${Math.min(n, 4)}`}>
        {group.items.slice(0, 4).map((item, i) => (
          <Thumb key={item.id} item={item} theme={theme} more={i === 3 && n > 4 ? n - 3 : 0} />
        ))}
      </div>
    </a>
  )
}

function Thumb({ item, theme, more }: { item: FeedItem; theme: 'light' | 'dark'; more: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const record = item.record as ShapeRecord | undefined
  const asset = item.asset as AssetRecord | undefined
  useEffect(() => {
    if (!canvas.current || !record) return
    try {
      renderThumb(canvas.current, record, asset, theme)
    } catch (e) {
      console.warn('thumbnail failed', e)
    }
  }, [record, asset, theme])
  return (
    <div className="Entry-thumb">
      {record ? <canvas ref={canvas} /> : <span className="Muted">a big drawing</span>}
      {more > 0 && <span className="Entry-more">+{more}</span>}
    </div>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
