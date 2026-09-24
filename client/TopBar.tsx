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

  const others = [...new Set(peers.map((p) => p.userId))].filter((id) => id !== me?.id)
  const whoIsHere = [me ? 'You' : null, ...others.map((id) => nameOf(people, id))].filter(Boolean).join(', ')

  return (
    <div className="TopBar" onPointerDown={(e) => e.stopPropagation()}>
      {others.length > 0 && (
        <div className="TopBar-people" title={whoIsHere}>
          {others.slice(0, 5).map((id) => (
            <Avatar key={id} id={id} name={nameOf(people, id)} avatar={people.get(id)?.avatar ?? null} />
          ))}
          {others.length > 5 && <span className="Avatar Avatar--more">+{others.length - 5}</span>}
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
            className={`TopBar-button TopBar-me TopBar-status--${status}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            title={STATUS_LABEL[status]}
          >
            <Avatar id={me.id} name={me.name ?? '?'} avatar={me.avatar} className="Avatar--me" />
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
        <>
          <span className={`TopBar-status TopBar-status--${status}`} title={STATUS_LABEL[status]} />
          <a className="TopBar-button TopBar-button--primary" href="/login">
            Sign in to add
          </a>
        </>
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

function FeedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  )
}
