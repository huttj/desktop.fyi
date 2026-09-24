import { useEffect, useState } from 'react'
import type { Me, UserSummary } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'

export function Admin({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!me.isAdmin) return
    api.admin
      .list()
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load users'))
  }, [me.isAdmin])

  if (!me.isAdmin) {
    return (
      <div className="Screen">
        <div className="Card">
          <h1 className="Wordmark">desktop.fyi</h1>
          <p>This page is for admins.</p>
          <a className="Button" href="/">
            Back
          </a>
        </div>
      </div>
    )
  }

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
    <div className="Screen Screen--top">
      <div className="Card Card--wide">
        <header className="AdminHeader">
          <h1 className="Wordmark">people</h1>
          <nav className="AdminNav">
            <a href={`/@${me.handle}`}>My desktop</a>
            <a href="/feed">Feed</a>
            <button className="Link" onClick={onSignOut}>
              Sign out
            </button>
          </nav>
        </header>
        <p className="Muted">Everyone who has signed in. "Run decay" runs a desktop's daily pass right now.</p>
        {error && <p className="Error">{error}</p>}
        {notice && <p className="Muted">{notice}</p>}
        {users === null ? (
          <p className="Muted">Loading…</p>
        ) : (
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
                    )}{' '}
                    {!u.isAdmin && (
                      <button className="Link Link--danger" onClick={() => remove(u)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
