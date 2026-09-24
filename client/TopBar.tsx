import type { Editor } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import type { Peer } from '../shared/protocol'
import type { Me } from '../shared/types'
import { Avatar } from './Avatar'
import { nameOf, type People } from './people'
import type { SyncStatus } from './sync'
import { viewLink } from './viewLink'

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline. Reconnecting…',
}

/** Top-right chrome: who else is here, the feed, copy-a-link-to-this-view, and you (photo and name open the menu). */
export function TopBar({
  me,
  onSignOut,
  editor,
  status,
  peers,
  people,
  feedOpen,
  onFeed,
}: {
  me: Me | null
  onSignOut: () => void
  editor: Editor | null
  status: SyncStatus
  peers: Peer[]
  people: People
  feedOpen: boolean
  onFeed: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

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

  async function copyViewLink() {
    if (!editor) return
    await navigator.clipboard.writeText(viewLink(editor))
    setCopied(true)
  }

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
        <div className="TopBar-people TopBar-button" title={whoIsHere}>
          {others.slice(0, 4).map((id) => (
            <Avatar key={id} id={id} name={nameOf(people, id)} avatar={people.get(id)?.avatar ?? null} />
          ))}
          {others.length > 4 && <span className="Avatar Avatar--more">+{others.length - 4}</span>}
          <span className="TopBar-count TopBar-count--here">
            <EyeIcon /> {here}
          </span>
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
      <button
        type="button"
        className={`TopBar-button TopBar-button--icon${copied ? ' TopBar-button--done' : ''}`}
        onClick={copyViewLink}
        disabled={!editor}
        title={copied ? 'Copied!' : 'Copy a link to this view'}
        aria-label="Copy a link to this view"
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </button>
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
              <a className="TopBar-item" href="/profile">
                Profile
              </a>
              {me.isAdmin && (
                <a className="TopBar-item" href="/admin">
                  People
                </a>
              )}
              <button type="button" className="TopBar-item" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      ) : (
        <a className={`TopBar-button TopBar-button--primary${status === 'offline' ? ' TopBar-button--offline' : ''}`} href="/login" title={STATUS_LABEL[status]}>
          Sign in to add
        </a>
      )}
    </div>
  )
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
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
