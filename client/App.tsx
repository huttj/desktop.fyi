import { useCallback, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { Admin } from './Admin'
import { api, ApiError } from './api'
import { Canvas } from './Canvas'
import { Feed } from './Feed'
import { Landing } from './Landing'
import { Login } from './Login'
import { NamePrompt } from './NamePrompt'
import { Settings } from './Settings'

type AuthState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; me: Me }

const HANDLE_PATH = /^\/@([a-z0-9_]{2,20})\/?$/i

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setAuth({ status: 'signed-in', me })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth({ status: 'signed-out' })
      else throw e
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.logout()
    setAuth({ status: 'signed-out' })
    window.location.assign('/')
  }, [])

  const updateMe = useCallback((me: Me) => setAuth({ status: 'signed-in', me }), [])

  const path = decodeURIComponent(window.location.pathname)
  const boardHandle = HANDLE_PATH.exec(path)?.[1]?.toLowerCase() ?? null

  if (auth.status === 'loading') return <Splash />

  if (auth.status === 'signed-out') {
    if (boardHandle) return <Canvas key={`viewer:${boardHandle}`} handle={boardHandle} me={null} onSignOut={signOut} />
    if (path === '/login' || path === '/feed' || path === '/admin' || path === '/settings') return <Login />
    return <Landing />
  }

  const me = auth.me
  // A first sign-in picks a name and a handle before anything else.
  if (!me.name || !me.handle) return <NamePrompt me={me} onDone={updateMe} />

  if (boardHandle) return <Canvas key={`${me.id}:${boardHandle}`} handle={boardHandle} me={me} onMeChange={updateMe} onSignOut={signOut} />
  if (path === '/feed') return <Feed me={me} onSignOut={signOut} />
  if (path === '/settings') return <Settings me={me} onMeChange={updateMe} onSignOut={signOut} />
  if (path === '/admin') return <Admin me={me} onSignOut={signOut} />
  // Home, /login and anything else: your own desktop.
  window.location.replace(`/@${me.handle}`)
  return <Splash />
}

function Splash() {
  return (
    <div className="Screen">
      <div className="Card Card--quiet">
        <h1 className="Wordmark">desktop.fyi</h1>
      </div>
    </div>
  )
}
