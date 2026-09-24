import { useCallback, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Canvas } from './Canvas'
import { Landing } from './Landing'
import { Login } from './Login'
import { NamePrompt } from './NamePrompt'

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
    if (['/login', '/feed', '/admin', '/profile', '/settings', '/stats'].includes(path)) return <Login />
    return <Landing />
  }

  const me = auth.me
  // A first sign-in picks a name and a handle before anything else.
  if (!me.name || !me.handle) return <NamePrompt me={me} onDone={updateMe} />

  if (boardHandle) return <Canvas key={`${me.id}:${boardHandle}`} handle={boardHandle} me={me} onMeChange={updateMe} onSignOut={signOut} />
  // Feed, profile and people live on your desktop as panels and popups; anything else is your desktop too.
  const open = path === '/feed' ? '#feed' : path === '/profile' || path === '/settings' ? '#profile' : path === '/admin' ? '#people' : ''
  window.location.replace(`/@${me.handle}${open}`)
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
