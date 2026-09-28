import { FormEvent, useEffect, useState } from 'react'
import { HANDLE_RE } from '../shared/handle'
import type { ApiToken, Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { CloseButton } from './CloseButton'
import { relativeTime } from './people'
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
        <ApiKeys />
        <p className="Muted Profile-foot">
          Your desktop lives at desktop.fyi/@{me.handle}. <a href="/api/me/export">Download your data</a> (everything, archive included).
        </p>
      </div>
      {photoOpen && <PhotoDialog me={me} onChange={onMeChange} onClose={() => setPhotoOpen(false)} />}
    </div>
  )
}

/**
 * Personal access keys: for scripts, and as an MCP link for Claude. A key reads
 * everything you can and writes only to your desktop. The secret shows once.
 */
function ApiKeys() {
  const [keys, setKeys] = useState<ApiToken[] | null>(null)
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [minted, setMinted] = useState<{ token: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || keys) return
    api.tokens.list().then(setKeys).catch(() => setKeys([]))
  }, [open, keys])

  async function mint(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { token, row } = await api.tokens.create(label)
      setMinted({ token, label: row.label })
      setKeys((k) => [row, ...(k ?? [])])
      setLabel('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    try {
      await api.tokens.revoke(id)
      setKeys((k) => (k ?? []).filter((t) => t.id !== id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    }
  }

  const mcpLink = minted ? `${window.location.origin}/mcp?token=${minted.token}` : ''
  return (
    <section className="Keys">
      <button type="button" className="Link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        API keys{keys?.length ? ` (${keys.length})` : ''}
      </button>
      {open && (
        <div className="Keys-body">
          <p className="Muted">A key reads everything you can see and writes only to your desktop. Give it to Claude as an MCP connector, or send it as a bearer token.</p>
          {keys === null && <p className="Muted">Loading…</p>}
          {keys?.map((t) => (
            <div key={t.id} className="Keys-row">
              <span className="Keys-label">
                <strong>{t.label}</strong> <code>{t.prefix}…</code>
              </span>
              <span className="Muted">{t.lastUsedAt ? `used ${relativeTime(t.lastUsedAt)}` : 'never used'}</span>
              <button type="button" className="Link Link--danger" onClick={() => revoke(t.id)}>
                Revoke
              </button>
            </div>
          ))}
          {minted && (
            <div className="Keys-minted">
              <p>
                <strong>{minted.label}</strong>: copy this now, it will not show again.
              </p>
              <code className="Keys-secret">{minted.token}</code>
              <p className="Muted">Paste this into Claude as a custom connector (no sign-in):</p>
              <code className="Keys-secret">{mcpLink}</code>
              <p className="Muted">In Claude Code:</p>
              <code className="Keys-secret">claude mcp add --transport http desktop-fyi "{mcpLink}"</code>
              <p className="Muted">
                For scripts, send it as <code>Authorization: Bearer {minted.token.slice(0, 10)}…</code> on any /api call (and /mcp accepts that too).
              </p>
            </div>
          )}
          <form className="Form Form--row" onSubmit={mint}>
            <input className="Input" type="text" value={label} maxLength={40} placeholder="What is it for? (a label)" onChange={(e) => setLabel(e.target.value)} disabled={busy} />
            <button className="Button Button--ghost" type="submit" disabled={busy}>
              {busy ? 'Making…' : 'New key'}
            </button>
          </form>
          {error && <p className="Error">{error}</p>}
        </div>
      )}
    </section>
  )
}
