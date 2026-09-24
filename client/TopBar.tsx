import { useEffect, useRef, useState } from 'react'
import type { Peer } from '../shared/protocol'
import type { Me } from '../shared/types'
import { Avatar } from './Avatar'
import { nameOf, type People } from './people'
import type { Dialog } from './Canvas'
import { ViewersMenu } from './ViewersMenu'
import type { SyncStatus } from './sync'

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline. Reconnecting…',
}

/** Top-right chrome: who else is here (a menu: watch or follow them), the feed, and you. */
export function TopBar({
  me,
  onSignOut,
  status,
  peers,
  people,
  feedOpen,
  onFeed,
  watching,
  onWatch,
  onOpen,
}: {
  me: Me | null
  onSignOut: () => void
  status: SyncStatus
  peers: Peer[]
  people: People
  feedOpen: boolean
  onFeed: (open: boolean) => void
  watching: string | null
  onWatch: (sessionId: string | null) => void
  onOpen: (dialog: Dialog) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewersOpen, setViewersOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const viewersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!viewersOpen) return
    const onDown = (e: PointerEvent) => {
      if (!viewersRef.current?.contains(e.target as Node)) setViewersOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewersOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [viewersOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Other people (one avatar each, however many windows), plus visitors who are not signed in.
  const others = [...new Set(peers.map((p) => p.userId).filter((id): id is string => !!id))].filter((id) => id !== me?.id)
  const visitors = peers.filter((p) => !p.userId).length
  const myWindows = me ? peers.filter((p) => p.userId === me.id).length : 0
  const here = others.length + visitors
  const whoIsHere = [
    ...others.map((id) => nameOf(people, id)),
    visitors ? `${visitors} visitor${visitors === 1 ? '' : 's'}` : null,
    myWindows ? `you in ${myWindows} other window${myWindows === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="TopBar" onPointerDown={(e) => e.stopPropagation()}>
      {here > 0 && (
        <div className="TopBar-menu" ref={viewersRef}>
          <button type="button" className={`TopBar-people TopBar-button${watching ? ' TopBar-button--on' : ''}`} title={whoIsHere} onClick={() => setViewersOpen((o) => !o)} aria-expanded={viewersOpen}>
            {others.slice(0, 4).map((id) => (
              <Avatar key={id} id={id} name={nameOf(people, id)} avatar={people.get(id)?.avatar ?? null} />
            ))}
            {others.length > 4 && <span className="Avatar Avatar--more">+{others.length - 4}</span>}
            <span className="TopBar-count TopBar-count--here">
              <EyeIcon /> {here}
            </span>
          </button>
          {viewersOpen && (
            <div className="TopBar-dropdown PeoplePicker">
              <ViewersMenu
                me={me}
                peers={peers}
                people={people}
                watching={watching}
                onWatch={(id) => {
                  onWatch(id)
                  setViewersOpen(false)
                }}
              />
            </div>
          )}
        </div>
      )}
      {me && (
        <button
          type="button"
          className={`TopBar-button TopBar-button--icon${feedOpen ? ' TopBar-button--on' : ''}`}
          onClick={() => onFeed(!feedOpen)}
          title={feedOpen ? 'Close the feed' : 'Feed: what people you follow made, and what is vanishing'}
          aria-label="Feed"
          aria-pressed={feedOpen}
        >
          <FeedIcon />
        </button>
      )}
      {me ? (
        <div className="TopBar-menu" ref={menuRef}>
          <button
            type="button"
            className={`TopBar-button TopBar-me${status === 'offline' ? ' TopBar-button--offline' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            title={STATUS_LABEL[status]}
          >
            <Avatar id={me.id} name={me.name ?? '?'} avatar={me.avatar} />
            <span>{me.name}</span>
          </button>
          {menuOpen && (
            <div className="TopBar-dropdown">
              <a className="TopBar-item" href={`/@${me.handle}`}>
                My desktop
              </a>
              <button
                type="button"
                className="TopBar-item"
                onClick={() => {
                  onFeed(true)
                  setMenuOpen(false)
                }}
              >
                Feed
              </button>
              <button type="button" className="TopBar-item" onClick={() => (onOpen('profile'), setMenuOpen(false))}>
                Profile
              </button>
              <button type="button" className="TopBar-item" onClick={() => (onOpen('stats'), setMenuOpen(false))}>
                Stats
              </button>
              {me.isAdmin && (
                <button type="button" className="TopBar-item" onClick={() => (onOpen('people'), setMenuOpen(false))}>
                  People
                </button>
              )}
              <button type="button" className="TopBar-item" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      ) : (
        <a className={`TopBar-button TopBar-button--primary${status === 'offline' ? ' TopBar-button--offline' : ''}`} href="/login" title={STATUS_LABEL[status]}>
          Log in
        </a>
      )}
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function FeedIcon() {
  // a page of entries: a picture beside lines, twice
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <path d="M13 5h8M13 9h6" />
      <rect x="3" y="14" width="6" height="6" rx="1.5" />
      <path d="M13 15h8M13 19h6" />
    </svg>
  )
}
