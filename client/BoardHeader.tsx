import { useEffect, useMemo, useRef, useState } from 'react'
import { HIDE_AT, provisionalAge } from '../shared/freshness'
import type { ItemMeta, Me, Profile } from '../shared/types'
import { api } from './api'
import { Avatar } from './Avatar'
import { layersOf, type LayerView } from './freshness'
import { nameOf, type People } from './people'

/** Top-left chrome: whose desktop this is, follow them, and which layer you are looking at. */
export function BoardHeader({
  handle,
  me,
  owner,
  profile,
  onProfile,
  people,
  metas,
  metaVersion,
  view,
  onView,
  showHidden,
  onShowHidden,
}: {
  handle: string
  me: Me | null
  owner: string | null
  profile: Profile | null
  onProfile: (p: Profile) => void
  people: People
  metas: Map<string, ItemMeta>
  metaVersion: number
  view: LayerView
  onView: (v: LayerView) => void
  showHidden: boolean
  onShowHidden: (on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Layers, plus what each holds and how many of my things are hiding.
  const { layers, counts, hiddenMine } = useMemo(() => {
    const now = Date.now()
    const counts = new Map<string, number>()
    let hiddenMine = 0
    for (const m of metas.values()) {
      const age = provisionalAge(m, now)
      if (age >= HIDE_AT) {
        if (me && m.by === me.id) hiddenMine++
        continue
      }
      counts.set(m.layer, (counts.get(m.layer) ?? 0) + 1)
    }
    return { layers: owner ? layersOf(metas, owner) : [], counts, hiddenMine }
    // metaVersion is the signal that the map changed in place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metas, metaVersion, owner, me])

  const isMine = !!me && !!owner && me.id === owner
  const ownerName = owner ? nameOf(people, owner) : `@${handle}`

  async function toggleFollow() {
    if (!profile || !me) return
    setBusy(true)
    try {
      if (profile.isFollowing) {
        await api.unfollow(handle)
        onProfile({ ...profile, isFollowing: false, followers: profile.followers - 1 })
      } else {
        await api.follow(handle)
        onProfile({ ...profile, isFollowing: true, followers: profile.followers + 1 })
      }
    } finally {
      setBusy(false)
    }
  }

  const label = view === 'all' ? 'Everyone' : view === owner ? `${isMine ? 'My' : `${ownerName}'s`} desktop` : `${nameOf(people, view, me?.id)}'s layer`

  return (
    <div className="BoardHeader" onPointerDown={(e) => e.stopPropagation()}>
      <div className="BoardHeader-owner">
        {owner ? <Avatar id={owner} name={ownerName} avatar={people.get(owner)?.avatar ?? null} /> : <span className="Avatar Avatar--blank" />}
        <span className="BoardHeader-name">
          <strong>{isMine ? 'My desktop' : ownerName}</strong>
          <span className="BoardHeader-handle">@{handle}</span>
        </span>
        {me && !isMine && profile && (
          <button type="button" className={`TopBar-button${profile.isFollowing ? '' : ' TopBar-button--primary'}`} onClick={toggleFollow} disabled={busy}>
            {profile.isFollowing ? 'Following' : profile.followsYou ? 'Follow back' : 'Follow'}
          </button>
        )}
      </div>
      <div className="TopBar-menu" ref={menuRef}>
        <button type="button" className="TopBar-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Which layer to show">
          <LayersIcon /> {label}
        </button>
        {open && (
          <div className="TopBar-dropdown TopBar-dropdown--left">
            <button type="button" className={`TopBar-item${view === 'all' ? ' TopBar-item--on' : ''}`} onClick={() => (onView('all'), setOpen(false))}>
              Everyone
            </button>
            {layers.map((id) => (
              <button type="button" key={id} className={`TopBar-item${view === id ? ' TopBar-item--on' : ''}`} onClick={() => (onView(id), setOpen(false))}>
                {id === owner ? `${isMine ? 'My' : `${ownerName}'s`} desktop` : nameOf(people, id, me?.id)}
                <span className="TopBar-count">{counts.get(id) ?? 0}</span>
              </button>
            ))}
            {me && (
              <>
                <hr className="TopBar-rule" />
                <label className="TopBar-item TopBar-item--check">
                  <input type="checkbox" checked={showHidden} onChange={(e) => onShowHidden(e.target.checked)} />
                  Show my hidden things
                  <span className="TopBar-count">{hiddenMine}</span>
                </label>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function LayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  )
}
