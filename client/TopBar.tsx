import type { Editor } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import type { Peer } from '../shared/protocol'
import type { Me } from '../shared/types'
import { Avatar } from './Avatar'
import { nameOf, type People } from './people'
import { PhotoDialog } from './PhotoDialog'
import type { SyncStatus } from './sync'
import { viewLink } from './viewLink'

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline. Reconnecting…',
}

/** Top-right chrome: who is here, copy-a-link-to-this-view, account menu. */
export function TopBar({
  me,
  onMeChange,
  onSignOut,
  editor,
  status,
  peers,
  people,
}: {
  me: Me | null
  onMeChange?: (me: Me) => void
  onSignOut: () => void
  editor: Editor | null
  status: SyncStatus
  peers: Peer[]
  people: People
}) {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
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
      <div className="TopBar-people" title={`${STATUS_LABEL[status]}${whoIsHere ? ` · ${whoIsHere}` : ''}`}>
        {me ? (
          <button type="button" className={`AvatarButton TopBar-status--${status}`} onClick={() => setPhotoOpen(true)} title="Change your photo">
            <Avatar id={me.id} name={me.name ?? '?'} avatar={me.avatar} className="Avatar--me" />
          </button>
        ) : (
          <span className={`TopBar-status TopBar-status--${status}`} />
        )}
        {others.slice(0, 5).map((id) => (
          <Avatar key={id} id={id} name={nameOf(people, id)} avatar={people.get(id)?.avatar ?? null} />
        ))}
        {others.length > 5 && <span className="Avatar Avatar--more">+{others.length - 5}</span>}
      </div>
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
          <button type="button" className="TopBar-button TopBar-button--quiet" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            {me.name}
          </button>
          {menuOpen && (
            <div className="TopBar-dropdown">
              <a className="TopBar-item" href={`/@${me.handle}`}>
                My desktop
              </a>
              <a className="TopBar-item" href="/feed">
                Feed
              </a>
              <a className="TopBar-item" href="/settings">
                Settings
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
        <a className="TopBar-button TopBar-button--primary" href="/login">
          Sign in to add
        </a>
      )}
      {photoOpen && me && onMeChange && <PhotoDialog me={me} onChange={onMeChange} onClose={() => setPhotoOpen(false)} />}
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
