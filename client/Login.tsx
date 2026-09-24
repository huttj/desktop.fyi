import { FormEvent, useState } from 'react'
import { api, ApiError } from './api'

export function Login() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string }>(() =>
    new URLSearchParams(window.location.search).get('login') === 'invalid'
      ? { kind: 'error', message: 'That sign-in link is expired or already used. Request a new one.' }
      : { kind: 'idle' }
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState({ kind: 'sending' })
    try {
      await api.requestLink(email)
      setState({ kind: 'sent' })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof ApiError ? err.message : 'Something went wrong.' })
    }
  }

  return (
    <div className="Screen">
      <div className="Card">
        <h1 className="Wordmark">
          <a href="/">desktop.fyi</a>
        </h1>
        {state.kind === 'sent' ? (
          <>
            <p>Check your email. A sign-in link is on its way to</p>
            <p>
              <strong>{email}</strong>
            </p>
            <p className="Muted">It works once and expires in 15 minutes. New here? The link makes your desktop.</p>
            <button className="Button Button--ghost" onClick={() => setState({ kind: 'idle' })}>
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="Form">
            <p>Sign in, or make a desktop, with just your email. No password.</p>
            <input
              className="Input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@yourdomain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={state.kind === 'sending'}
            />
            <button className="Button" type="submit" disabled={state.kind === 'sending' || !email}>
              {state.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {state.kind === 'error' && <p className="Error">{state.message}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
