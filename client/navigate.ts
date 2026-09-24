/**
 * Moving between desktops in place. The URL changes and the app swaps the
 * board; nothing reloads, so the feed and the rest of the chrome stay put.
 */
const EVENT = 'dfyi:navigate'

export function navigate(path: string) {
  const url = new URL(path, window.location.href)
  if (url.pathname === window.location.pathname) {
    window.location.hash = url.hash
    return
  }
  window.history.pushState(null, '', url.pathname + url.hash)
  window.dispatchEvent(new Event(EVENT))
}

export function onNavigate(fn: () => void) {
  window.addEventListener(EVENT, fn)
  window.addEventListener('popstate', fn)
  return () => {
    window.removeEventListener(EVENT, fn)
    window.removeEventListener('popstate', fn)
  }
}
