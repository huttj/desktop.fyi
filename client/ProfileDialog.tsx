import { FormEvent, useEffect, useState } from 'react'
import { HANDLE_RE } from '../shared/handle'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { CloseButton } from './CloseButton'
import { PhotoDialog } from './PhotoDialog'

/** Your photo, your name, a line about you, and the handle your desktop lives at. */
export function ProfileDialog({ me, onMeChange, onClose }: { me: Me; onMeChange: (me: Me) => void; onClose: () => void }) {
  const [name, setName] = useState(me.name ?? '')
  const [handle, setHandle] = useState(me.handle ?? '')
  const [bio, setBio] = useState(me.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !photoOpen && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, photoOpen])

  const moving = handle !== (me.handle ?? '')
  const handleOk = HANDLE_RE.test(handle)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      onMeChange(await api.updateMe({ name, bio, ...(moving ? { handle } : {}) }))
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="Modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="Card Modal-card" role="dialog" aria-label="Your profile">
        <CloseButton onClose={onClose} />
        <div className="PhotoDialog-current">
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
            <textarea className="Input Input--area" value={bio} maxLength={160} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="A line or two. Links work. Shows on your desktop." disabled={busy} />
          </label>
          <label className="Field">
            <span className="Field-label">Handle</span>
            <span className="HandleField">
              <span className="HandleField-prefix">desktop.fyi/@</span>
              <input
                className="Input"
                type="text"
                autoComplete="username"
                maxLength={20}
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                required
                disabled={busy}
                spellCheck={false}
              />
            </span>
          </label>
          {moving && !handleOk && <p className="Muted">2 to 20 letters, digits or underscores.</p>}
          {moving && handleOk && (
            <p className="Warn">
              Moving to desktop.fyi/@{handle} breaks every link to desktop.fyi/@{me.handle}: the address itself, and any links to things on it that you or
              others have shared. The old name is freed up for anyone to take.
            </p>
          )}
          <div className="Modal-actions">
            <span className="Modal-spacer" />
            <button className="Button" type="submit" disabled={busy || (moving && !handleOk)}>
              {busy ? 'Saving…' : moving ? 'Save and move my desktop' : saved ? 'Saved' : 'Save'}
            </button>
          </div>
          {error && <p className="Error">{error}</p>}
        </form>
        <p className="Muted Profile-foot">
          Your desktop lives at desktop.fyi/@{me.handle}. <a href="/api/me/export">Download your data</a> (everything, archive included).
        </p>
      </div>
      {photoOpen && <PhotoDialog me={me} onChange={onMeChange} onClose={() => setPhotoOpen(false)} />}
    </div>
  )
}
