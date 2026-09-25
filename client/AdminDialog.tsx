import { useEffect, useState } from 'react'
import type { Me, UserSummary } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { CloseButton } from './CloseButton'

/** Admins: everyone who has signed in, with a way to run a desktop's daily pass or remove someone. */
export function AdminDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    api.admin
      .list()
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load users'))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function remove(u: UserSummary) {
    if (!confirm(`Remove ${u.email} and delete their desktop? This cannot be undone.`)) return
    setError(null)
    try {
      await api.admin.remove(u.id)
      setUsers((prev) => (prev ?? []).filter((x) => x.id !== u.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove')
    }
  }

  async function runDecay(u: UserSummary) {
    if (!u.handle) return
    setError(null)
    try {
      const r = await api.admin.runDecay(u.handle)
      setNotice(`@${u.handle}: ${r.items} items scored, ${r.archived} archived, ${r.events} events settled`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to run')
    }
  }

  return (
    <div className="Modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="Card Card--wide Modal-card" role="dialog" aria-label="People">
        <CloseButton onClose={onClose} />
        <div className="Stats-head">
          <strong>People</strong>
          <span className="Muted">Everyone who has signed in. "Run decay" runs a desktop's daily pass now.</span>
        </div>
        {error && <p className="Error">{error}</p>}
        {notice && <p className="Muted">{notice}</p>}
        {users === null ? (
          <p className="Muted">Loading…</p>
        ) : (
          <div className="Admin-scroll">
            <table className="Table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Last sign-in</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="Table-person">
                      <Avatar id={u.id} name={u.name ?? '?'} avatar={u.avatar} className="Avatar--small" />
                      {u.handle ? <a href={`/@${u.handle}`}>@{u.handle}</a> : <span className="Muted">no handle yet</span>}
                      {u.isAdmin && <span className="Tag">admin</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : <span className="Muted">never</span>}</td>
                    <td className="Table-actions">
                      {u.handle && (
                        <button className="Link" onClick={() => runDecay(u)}>
                          Run decay
                        </button>
                      )}
                      {!u.isAdmin && u.id !== me.id && (
                        <button className="Link Link--danger" onClick={() => remove(u)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
