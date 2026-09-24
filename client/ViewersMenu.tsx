import { useEffect, useState } from 'react'
import type { Peer } from '../shared/protocol'
import type { Me } from '../shared/types'
import { api } from './api'
import { Avatar } from './Avatar'
import { nameOf, type People } from './people'

interface Row {
  key: string
  userId: string | null
  label: string
  /** The windows this row stands for; a click watches the first one. */
  sessions: string[]
}

/**
 * Everyone here, one row per person (a visitor per window). Click a row to
 * watch what they are looking at; signed-in people can also be followed.
 */
export function ViewersMenu({ me, peers, people, watching, onWatch }: { me: Me | null; peers: Peer[]; people: People; watching: string | null; onWatch: (sessionId: string | null) => void }) {
  const [following, setFollowing] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!me?.handle) return
    api
      .following(me.handle)
      .then((list) => setFollowing(new Set(list.map((p) => p.id))))
      .catch(() => setFollowing(new Set()))
  }, [me?.handle])

  const rows: Row[] = []
  const byUser = new Map<string, string[]>()
  for (const p of peers) {
    if (!p.userId) {
      rows.push({ key: p.sessionId, userId: null, label: 'A visitor', sessions: [p.sessionId] })
      continue
    }
    const list = byUser.get(p.userId) ?? []
    list.push(p.sessionId)
    byUser.set(p.userId, list)
  }
  const named: Row[] = [...byUser].map(([userId, sessions]) => ({
    key: userId,
    userId,
    label: me && userId === me.id ? `You, in ${sessions.length === 1 ? 'another window' : `${sessions.length} other windows`}` : nameOf(people, userId),
    sessions,
  }))
  const all = [...named, ...rows]

  async function toggleFollow(userId: string) {
    const handle = people.get(userId)?.handle
    if (!handle || !following) return
    setBusy(userId)
    try {
      if (following.has(userId)) {
        await api.unfollow(handle)
        setFollowing((s) => {
          const n = new Set(s)
          n.delete(userId)
          return n
        })
      } else {
        await api.follow(handle)
        setFollowing((s) => new Set(s).add(userId))
      }
    } finally {
      setBusy(null)
    }
  }

  if (!all.length) return <p className="Muted PeoplePicker-empty">Nobody else is here right now.</p>

  return (
    <div className="PeoplePicker-list">
      <div className="PeoplePicker-heading">Here now · click to watch</div>
      {all.map((row) => {
        const isWatching = row.sessions.includes(watching ?? '')
        const canFollow = !!me && !!row.userId && row.userId !== me.id && !!people.get(row.userId)?.handle && following !== null
        return (
          <div key={row.key} className={`Viewer${isWatching ? ' Viewer--watching' : ''}`}>
            <button type="button" className="Person Viewer-person" onClick={() => onWatch(isWatching ? null : row.sessions[0]!)} title={isWatching ? 'Stop watching' : 'Watch what they are looking at'}>
              {row.userId ? (
                <Avatar id={row.userId} name={row.label} avatar={people.get(row.userId)?.avatar ?? null} className="Avatar--small" />
              ) : (
                <span className="Avatar Avatar--small Avatar--anon">?</span>
              )}
              <span className="Person-text">
                <span className="Person-name">{row.label}</span>
                <span className="Person-handle">
                  {isWatching ? 'watching' : row.userId && people.get(row.userId)?.handle ? `@${people.get(row.userId)!.handle}` : 'not signed in'}
                  {row.sessions.length > 1 && row.userId !== me?.id ? ` · ${row.sessions.length} windows` : ''}
                </span>
              </span>
            </button>
            {canFollow && (
              <button type="button" className={`TopBar-button Viewer-follow${following!.has(row.userId!) ? '' : ' TopBar-button--primary'}`} onClick={() => toggleFollow(row.userId!)} disabled={busy === row.userId}>
                {following!.has(row.userId!) ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
