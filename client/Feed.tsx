import type { AssetRecord, ShapeRecord } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import { describeAge } from '../shared/freshness'
import type { Feed as FeedData, FeedItem, Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { nameOf, relativeTime, type People } from './people'
import { renderThumb } from './thumb'
import { itemLink } from './viewLink'

/** What the people you follow have made lately, and what is about to disappear. */
export function Feed({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [feed, setFeed] = useState<FeedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches

  useEffect(() => {
    api
      .feed()
      .then(setFeed)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the feed'))
  }, [])

  const people: People = new Map((feed?.people ?? []).map((p) => [p.id, p]))
  people.set(me.id, { id: me.id, handle: me.handle, name: me.name, avatar: me.avatar })

  return (
    <div className="Screen Screen--top">
      <div className="Card Card--wide Card--feed">
        <header className="AdminHeader">
          <h1 className="Wordmark">feed</h1>
          <nav className="AdminNav">
            <a href={`/@${me.handle}`}>My desktop</a>
            <a href="/settings">Settings</a>
            <button className="Link" onClick={onSignOut}>
              Sign out
            </button>
          </nav>
        </header>
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
                    <FeedCard key={`v:${item.boardId}:${item.id}`} item={item} people={people} meId={me.id} dark={dark} showAge />
                  ))}
                </div>
              )}
            </section>
            <section className="FeedSection">
              <h2 className="FeedSection-title">New from people you follow</h2>
              {feed.recent.length === 0 ? (
                <p className="Muted">Quiet this week. Follow people from their desktops to see what they make here.</p>
              ) : (
                <div className="FeedGrid">
                  {feed.recent.map((item) => (
                    <FeedCard key={`r:${item.boardId}:${item.id}`} item={item} people={people} meId={me.id} dark={dark} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function FeedCard({ item, people, meId, dark, showAge = false }: { item: FeedItem; people: People; meId: string; dark: boolean; showAge?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const record = item.record as ShapeRecord | undefined
  const asset = item.asset as AssetRecord | undefined

  useEffect(() => {
    if (!canvas.current || !record) return
    try {
      renderThumb(canvas.current, record, asset, dark ? 'dark' : 'light')
    } catch (e) {
      console.warn('thumbnail failed', e)
    }
  }, [record, asset, dark])

  const boardHandle = people.get(item.boardId)?.handle ?? null
  const href = boardHandle ? itemLink(boardHandle, item.id) : '#'
  const onOwnDesktop = item.meta.layer === item.boardId
  const where = item.boardId === meId ? 'your desktop' : `${nameOf(people, item.boardId, meId)}'s desktop`

  return (
    <a className={`FeedCard FeedCard--${item.age >= 1 ? 'fading' : 'fresh'}`} href={href} style={{ opacity: showAge ? Math.max(0.35, 1 - (item.age - 1) / 3) : 1 }}>
      <div className="FeedCard-thumb">
        {record ? <canvas ref={canvas} /> : <span className="Muted">a big drawing</span>}
      </div>
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
