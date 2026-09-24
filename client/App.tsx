import { useCallback, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Canvas } from './Canvas'
import { Landing } from './Landing'
import { Login } from './Login'
import { NamePrompt } from './NamePrompt'
import { navigate, onNavigate } from './navigate'

type AuthState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; me: Me }

const HANDLE_PATH = /^\/@([a-z0-9_]{2,20})\/?$/i

const DESKTOP_PATH = /^\/@[a-z0-9_]{2,20}\/?$/i

/** Follows a link to another desktop in place: the URL changes, the board swaps, nothing reloads. */
function useInPlaceNavigation() {
  const [path, setPath] = useState(() => decodeURIComponent(window.location.pathname))
  useEffect(() => {
    const onPop = () => setPath(decodeURIComponent(window.location.pathname))
    const offNav = onNavigate(onPop)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || !DESKTOP_PATH.test(decodeURIComponent(url.pathname))) return
      e.preventDefault()
      navigate(url.pathname + url.hash)
    }
    document.addEventListener('click', onClick)
    return () => {
      offNav()
      document.removeEventListener('click', onClick)
    }
  }, [])
  return path
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const path = useInPlaceNavigation()

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
