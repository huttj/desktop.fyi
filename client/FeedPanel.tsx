import type { AssetRecord, ShapeRecord } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import { describeAge } from '../shared/freshness'
import type { Feed as FeedData, FeedItem, Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { nameOf, relativeTime, type People } from './people'
import { renderThumb } from './thumb'
import { itemLink } from './viewLink'

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

  const people: People = new Map((feed?.people ?? []).map((p) => [p.id, p]))
  people.set(me.id, { id: me.id, handle: me.handle, name: me.name, avatar: me.avatar })

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
              {feed.vanishing.length === 0 ? (
                <p className="Muted">Nothing is fading right now.</p>
              ) : (
                <div className="FeedGrid">
                  {feed.vanishing.map((item) => (
                    <FeedCard key={`v:${item.boardId}:${item.id}`} item={item} people={people} meId={me.id} theme={theme} showAge />
                  ))}
                </div>
              )}
            </section>
            <section className="FeedSection">
              <h2 className="FeedSection-title">New from people you follow</h2>
              {feed.recent.length === 0 ? (
                <p className="Muted">Quiet this week. Find people to follow from the name at the top left.</p>
              ) : (
                <div className="FeedGrid">
                  {feed.recent.map((item) => (
                    <FeedCard key={`r:${item.boardId}:${item.id}`} item={item} people={people} meId={me.id} theme={theme} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function FeedCard({ item, people, meId, theme, showAge = false }: { item: FeedItem; people: People; meId: string; theme: 'light' | 'dark'; showAge?: boolean }) {
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

  const boardHandle = people.get(item.boardId)?.handle ?? null
  const href = boardHandle ? itemLink(boardHandle, item.id) : '#'
  const onOwnDesktop = item.meta.layer === item.boardId
  const where = item.boardId === meId ? 'your desktop' : `${nameOf(people, item.boardId, meId)}'s desktop`

  return (
    <a className="FeedCard" href={href} style={{ opacity: showAge ? Math.max(0.35, 1 - (item.age - 1) / 3) : 1 }}>
      <div className="FeedCard-thumb">{record ? <canvas ref={canvas} /> : <span className="Muted">a big drawing</span>}</div>
      <div className="FeedCard-meta">
        <Avatar id={item.meta.by} name={nameOf(people, item.meta.by)} avatar={people.get(item.meta.by)?.avatar ?? null} className="Avatar--small" />
        <span>
          <strong>{nameOf(people, item.meta.by, meId)}</strong>
          {onOwnDesktop ? '' : ` on ${where}`}
          <span className="Muted"> · {relativeTime(item.meta.editedAt)}</span>
        </span>
      </div>
      {showAge && <div className="FeedCard-age">{describeAge(item.age)}</div>}
    </a>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
