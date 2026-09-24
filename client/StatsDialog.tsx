import { useEffect, useState } from 'react'
import type { DesktopStats, Me, Profile } from '../shared/types'
import { api, ApiError } from './api'

/** A small card of who has been looking at your desktop, and who follows it. Only you see it. */
export function StatsDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [stats, setStats] = useState<DesktopStats | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!me.handle) return
    api.stats(me.handle).then(setStats).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'))
    api.profile(me.handle).then(setProfile).catch(() => {})
  }, [me.handle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="Modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="Card Modal-card Stats" role="dialog" aria-label="Your desktop's stats">
        <div className="Stats-head">
          <strong>Your desktop</strong>
          <span className="Muted">Only you can see this</span>
        </div>
        {error && <p className="Error">{error}</p>}
        {!stats && !error && <p className="Muted">Loading…</p>}
        {stats && (
          <div className="Stats-grid">
            <Stat n={stats.liveNow} label="here now" />
            <Stat n={stats.today.views} label={`view${stats.today.views === 1 ? '' : 's'} today`} />
            <Stat n={stats.week.views} label={`this week, from ${stats.week.people} ${stats.week.people === 1 ? 'person' : 'people'}`} />
            <Stat n={stats.allTime} label="all time" />
            {profile && <Stat n={profile.followers} label={`follower${profile.followers === 1 ? '' : 's'}`} />}
            {profile && <Stat n={profile.liveItems} label={`thing${profile.liveItems === 1 ? '' : 's'} on it`} />}
          </div>
        )}
        <div className="Modal-actions">
          <span className="Modal-spacer" />
          <button type="button" className="Button Button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="Stat">
      <span className="Stat-n">{n.toLocaleString()}</span>
      <span className="Stat-label">{label}</span>
    </div>
  )
}
