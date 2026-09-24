import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'
import { prepareAvatar } from './avatarImage'

/** Pick a new profile photo (drop or browse) or remove the current one. */
export function PhotoDialog({ me, onChange, onClose }: { me: Me; onChange: (me: Me) => void; onClose: () => void }) {
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function use(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('That is not an image.')
    setBusy('upload')
    setError(null)
    try {
      onChange(await api.setAvatar(await prepareAvatar(file)))
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not use that photo.')
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('remove')
    setError(null)
    try {
      onChange(await api.clearAvatar())
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the photo.')
      setBusy(null)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    void use(e.dataTransfer.files?.[0])
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    void use(file)
  }

  return (
    <div className="Modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="Card Modal-card" role="dialog" aria-label="Your photo">
        <div className="PhotoDialog-current">
          <Avatar id={me.id} name={me.name ?? '?'} avatar={me.avatar} className="Avatar--large" />
          <div>
            <strong>{me.name}</strong>
            <div className="Muted">{me.avatar ? 'This is how you appear to everyone.' : 'No photo yet, just your initials.'}</div>
          </div>
        </div>
        <button
          type="button"
          className={`DropZone${over ? ' DropZone--over' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          disabled={busy !== null}
        >
          {busy === 'upload' ? 'Uploading…' : 'Drop a photo here, or click to choose one'}
        </button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onPick} />
        {error && <p className="Error">{error}</p>}
        <div className="Modal-actions">
          {me.avatar && (
            <button type="button" className="Link Link--danger" onClick={remove} disabled={busy !== null}>
              {busy === 'remove' ? 'Removing…' : 'Remove photo'}
            </button>
          )}
          <span className="Modal-spacer" />
          <button type="button" className="Button Button--ghost" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
