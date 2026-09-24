import { useEffect, useMemo, useRef, useState } from 'react'
import { HIDE_AT, provisionalAge } from '../shared/freshness'
import type { ItemMeta, Me, Person, Profile } from '../shared/types'
import { api } from './api'
import { Avatar } from './Avatar'
import { layersOf, type LayerView } from './freshness'
import { Linkified } from './Linkified'
import { navigate } from './navigate'
import { nameOf, type People } from './people'

/** Top-left chrome: whose desktop this is (and a way to anyone else's), and which layer you are looking at. */
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
  const isMine = !!me && !!owner && me.id === owner
  const ownerPerson: Person | null = profile ?? (owner ? people.get(owner) ?? null : null)
  const ownerName = ownerPerson?.name ?? `@${handle}`

  return (
    <div className="BoardHeader" onPointerDown={(e) => e.stopPropagation()}>
      <PeoplePicker handle={handle} me={me} owner={owner} ownerName={ownerName} ownerPerson={ownerPerson} profile={profile} onProfile={onProfile} />
      <LayerPicker me={me} owner={owner} ownerName={ownerName} isMine={isMine} people={people} metas={metas} metaVersion={metaVersion} view={view} onView={onView} showHidden={showHidden} onShowHidden={onShowHidden} />
    </div>
  )
}

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, ref])
}

/** The owner's name is a door to everyone: the people you follow, your followers, and a search. */
function PeoplePicker({
  handle,
  me,
  owner,
  ownerName,
  ownerPerson,
  profile,
  onProfile,
}: {
  handle: string
  me: Me | null
  owner: string | null
  ownerName: string
  ownerPerson: Person | null
  profile: Profile | null
  onProfile: (p: Profile) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Person[] | null>(null)
  const [following, setFollowing] = useState<Person[] | null>(null)
  const [followers, setFollowers] = useState<Person[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useDismiss(open, () => setOpen(false), ref)

  // Your own graph, fetched once per opening.
  useEffect(() => {
    if (!open || !me?.handle) return
    api.following(me.handle).then(setFollowing).catch(() => setFollowing([]))
    api.followers(me.handle).then(setFollowers).catch(() => setFollowers([]))
    setTimeout(() => input.current?.focus(), 0)
  }, [open, me?.handle])

  // Search as you type, a beat behind.
  useEffect(() => {
    if (!open || !me) return
    const q = query.trim()
    if (!q) return setResults(null)
    const t = setTimeout(() => api.search(q).then(setResults).catch(() => setResults([])), 180)
    return () => clearTimeout(t)
  }, [query, open, me])

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

  const isMine = !!me && !!owner && me.id === owner
  const go = (p: Person) => {
    if (!p.handle) return
    setOpen(false)
    navigate(`/@${p.handle}`)
  }
  const row = (p: Person, extra?: string) => (
    <button type="button" key={p.id} className="Person" onClick={() => go(p)}>
      <Avatar id={p.id} name={p.name ?? '?'} avatar={p.avatar} className="Avatar--small" />
      <span className="Person-text">
        <span className="Person-name">{p.name ?? `@${p.handle}`}</span>
        <span className="Person-handle">@{p.handle}{extra ? ` · ${extra}` : ''}</span>
      </span>
    </button>
  )
  const followingIds = new Set((following ?? []).map((p) => p.id))

  return (
    <div className="TopBar-menu" ref={ref}>
      <button type="button" className="BoardHeader-owner" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="People">
        {owner ? <Avatar id={owner} name={ownerName} avatar={ownerPerson?.avatar ?? null} /> : <span className="Avatar Avatar--blank" />}
        <span className="BoardHeader-name">
          <strong>{ownerName}</strong>
          <span className="BoardHeader-handle">@{handle}</span>
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="TopBar-dropdown TopBar-dropdown--left PeoplePicker">
          <div className="PeoplePicker-owner">
            <div className="PeoplePicker-ownerRow">
              {owner && <Avatar id={owner} name={ownerName} avatar={ownerPerson?.avatar ?? null} className="Avatar--large" />}
              <div className="Person-text">
                <span className="Person-name">{ownerName}</span>
                <span className="Person-handle">@{handle}</span>
                {profile && (
                  <span className="Person-handle">
                    {profile.followers} follower{profile.followers === 1 ? '' : 's'} · {profile.following} following
                  </span>
                )}
              </div>
            </div>
            {ownerPerson?.bio && (
              <p className="PeoplePicker-bio">
                <Linkified text={ownerPerson.bio} />
              </p>
            )}
            {me && !isMine && profile && (
              <button type="button" className={`TopBar-button${profile.isFollowing ? '' : ' TopBar-button--primary'}`} onClick={toggleFollow} disabled={busy}>
                {profile.isFollowing ? 'Following' : profile.followsYou ? 'Follow back' : 'Follow'}
              </button>
            )}
          </div>
          {me ? (
            <>
              <input ref={input} className="Input Input--small" type="search" placeholder="Find anyone by handle or name" value={query} onChange={(e) => setQuery(e.target.value)} />
              {results ? (
                <div className="PeoplePicker-list">
                  {results.length === 0 && <p className="Muted PeoplePicker-empty">Nobody by that name yet.</p>}
                  {results.map((p) => row(p, followingIds.has(p.id) ? 'following' : undefined))}
                </div>
              ) : (
                <div className="PeoplePicker-list">
                  {me.handle && (
                    <>
                      {row({ id: me.id, handle: me.handle, name: me.name, avatar: me.avatar }, isMine ? 'this desktop' : 'my desktop')}
                      <hr className="TopBar-rule" />
                    </>
                  )}
                  {following && following.length > 0 && (
                    <>
                      <div className="PeoplePicker-heading">Following</div>
                      {following.map((p) => row(p))}
                    </>
                  )}
                  {followers && followers.length > 0 && (
                    <>
                      <div className="PeoplePicker-heading">Followers</div>
                      {followers.map((p) => row(p, followingIds.has(p.id) ? 'mutual' : undefined))}
                    </>
                  )}
                  {following && followers && !following.length && !followers.length && (
                    <p className="Muted PeoplePicker-empty">Nobody yet. Search for someone, or share your desktop's link.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <a className="TopBar-item" href="/login">
              Sign in to follow people
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function LayerPicker({
  me,
  owner,
  ownerName,
  isMine,
  people,
  metas,
  metaVersion,
  view,
  onView,
  showHidden,
  onShowHidden,
}: {
  me: Me | null
  owner: string | null
  ownerName: string
  isMine: boolean
  people: People
  metas: Map<string, ItemMeta>
  metaVersion: number
  view: LayerView
  onView: (v: LayerView) => void
  showHidden: boolean
  onShowHidden: (on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)

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

  const desktopLabel = isMine ? 'Just me' : `Just ${ownerName}`
  const onDesktop = view === owner || view === 'owner'
  // The desktop alone is the resting state: the pill is just the icon then.
  const label = view === 'all' ? 'Everyone' : onDesktop ? null : me && view === me.id ? 'Your layer' : `${nameOf(people, view)}'s layer`

  return (
    <div className="TopBar-menu" ref={ref}>
      <button type="button" className={`TopBar-button${label ? '' : ' TopBar-button--icon'}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={label ? 'Which layer to show' : `${desktopLabel}. Which layer to show`}>
        <LayersIcon />
        {label && <span>{label}</span>}
      </button>
      {open && (
        <div className="TopBar-dropdown TopBar-dropdown--left">
          <button type="button" className={`TopBar-item${view === 'all' ? ' TopBar-item--on' : ''}`} onClick={() => (onView('all'), setOpen(false))}>
            Everyone
          </button>
          {layers.map((id) => (
            <button type="button" key={id} className={`TopBar-item${view === id || (id === owner && onDesktop) ? ' TopBar-item--on' : ''}`} onClick={() => (onView(id), setOpen(false))}>
              {id === owner ? desktopLabel : me && id === me.id ? 'Your layer' : `${nameOf(people, id)}'s layer`}
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
  )
}

function LayersIcon() {
  return (
    <svg className="LayersIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
