import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { prepareAvatar } from './avatarImage'

const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,19}$/

function suggestHandle(me: Me) {
  const base = (me.email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  return HANDLE_RE.test(base) ? base : ''
}

/** First sign-in: a name, a handle for your desktop's address, and optionally a photo. */
export function NamePrompt({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  const [name, setName] = useState(me.name ?? '')
  const [handle, setHandle] = useState(me.handle ?? suggestHandle(me))
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) return setPreview(null)
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  async function choosePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      setPhoto(await prepareAvatar(file))
    } catch {
      setError('Could not read that image.')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let next = await api.updateMe({ name, handle: handle.toLowerCase() })
      if (photo) next = await api.setAvatar(photo)
      onDone(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const handleOk = HANDLE_RE.test(handle.toLowerCase())

  return (
    <div className="Screen">
      <div className="Card">
        <h1 className="Wordmark">desktop.fyi</h1>
        <form onSubmit={submit} className="Form">
          <p>Welcome. What should we call you, and where should your desktop live?</p>
          <input
            className="Input"
            type="text"
            name="name"
            autoComplete="nickname"
            placeholder="Your name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            disabled={busy}
          />
          <label className="HandleField">
            <span className="HandleField-prefix">desktop.fyi/@</span>
            <input
              className="Input"
              type="text"
              name="handle"
              autoComplete="username"
              placeholder="handle"
              maxLength={20}
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              required
              disabled={busy}
              spellCheck={false}
            />
          </label>
          {handle && !handleOk && <p className="Muted">2 to 20 letters, digits or underscores.</p>}
          <label className="PhotoPick">
            {preview ? <img className="PhotoPick-preview" src={preview} alt="" /> : <span className="PhotoPick-empty" />}
            <span>
              {preview ? 'Change photo' : 'Add a photo'} <span className="Muted">(optional)</span>
            </span>
            <input type="file" accept="image/*" hidden onChange={choosePhoto} disabled={busy} />
          </label>
          <button className="Button" type="submit" disabled={busy || !name.trim() || !handleOk}>
            {busy ? 'Saving…' : 'Open my desktop'}
          </button>
          {error && <p className="Error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
