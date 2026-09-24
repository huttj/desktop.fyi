import { FormEvent, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { PhotoDialog } from './PhotoDialog'

/** Your photo, your name, a line about you. The handle is fixed: it is your desktop's address. */
export function Profile({ me, onMeChange, onSignOut }: { me: Me; onMeChange: (me: Me) => void; onSignOut: () => void }) {
  const [name, setName] = useState(me.name ?? '')
  const [bio, setBio] = useState(me.bio ?? '')
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
      onMeChange(await api.updateMe({ name, bio }))
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
          <h1 className="Wordmark">profile</h1>
          <nav className="AdminNav">
            <a href={`/@${me.handle}`}>My desktop</a>
          </nav>
        </header>
        <div className="PhotoDialog-current" style={{ marginBottom: 16 }}>
          <button type="button" className="AvatarButton" onClick={() => setPhotoOpen(true)} title="Change your photo">
            <Avatar id={me.id} name={me.name ?? '?'} avatar={me.avatar} className="Avatar--large" />
          </button>
          <div>
            <strong>@{me.handle}</strong>
            <div className="Muted">{me.email}</div>
            <button type="button" className="Link" onClick={() => setPhotoOpen(true)}>
              {me.avatar ? 'Change photo' : 'Add a photo'}
            </button>
          </div>
        </div>
        <form onSubmit={submit} className="Form">
          <label className="Field">
            <span className="Field-label">Name</span>
            <input className="Input" type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Your name" required disabled={busy} />
          </label>
          <label className="Field">
            <span className="Field-label">About you</span>
            <textarea className="Input Input--area" value={bio} maxLength={160} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="A line or two. Shows on your desktop." disabled={busy} />
          </label>
          <button className="Button" type="submit" disabled={busy}>
            {busy ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          {error && <p className="Error">{error}</p>}
        </form>
        <hr className="Rule" />
        <p className="Muted">
          Your desktop lives at desktop.fyi/@{me.handle}. Handles cannot be changed.
        </p>
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
