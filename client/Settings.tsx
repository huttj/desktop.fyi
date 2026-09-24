import { FormEvent, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { PhotoDialog } from './PhotoDialog'

export function Settings({ me, onMeChange, onSignOut }: { me: Me; onMeChange: (me: Me) => void; onSignOut: () => void }) {
  const [name, setName] = useState(me.name ?? '')
  const [handle, setHandle] = useState(me.handle ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      onMeChange(await api.updateMe({ name, handle }))
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="Screen Screen--top">
      <div className="Card">
        <header className="AdminHeader">
          <h1 className="Wordmark">settings</h1>
          <nav className="AdminNav">
            <a href={`/@${me.handle}`}>My desktop</a>
            <a href="/feed">Feed</a>
          </nav>
        </header>
        <div className="PhotoDialog-current" style={{ marginBottom: 16 }}>
          <button type="button" className="AvatarButton" onClick={() => setPhotoOpen(true)} title="Change your photo">
            <Avatar id={me.id} name={me.name ?? '?'} avatar={me.avatar} className="Avatar--large" />
          </button>
          <div>
            <strong>{me.name}</strong>
            <div className="Muted">{me.email}</div>
          </div>
        </div>
        <form onSubmit={submit} className="Form">
          <input className="Input" type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Your name" required disabled={busy} />
          <label className="HandleField">
            <span className="HandleField-prefix">desktop.fyi/@</span>
            <input className="Input" type="text" value={handle} maxLength={20} onChange={(e) => setHandle(e.target.value.toLowerCase())} required disabled={busy} spellCheck={false} />
          </label>
          <p className="Muted">Changing your handle changes your desktop's address; old links stop working.</p>
          <button className="Button" type="submit" disabled={busy}>
            {busy ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          {error && <p className="Error">{error}</p>}
        </form>
        <hr className="Rule" />
        <p className="Muted">
          Everything on your desktop, archive included, as JSON: <a href="/api/me/export">download your data</a>.
        </p>
        <p>
          <button className="Link" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </div>
      {photoOpen && <PhotoDialog me={me} onChange={onMeChange} onClose={() => setPhotoOpen(false)} />}
    </div>
  )
}
