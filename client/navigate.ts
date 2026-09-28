/**
 * Moving between desktops in place. The URL changes and the app swaps the
 * board; nothing reloads, so the feed and the rest of the chrome stay put.
 */
const EVENT = 'dfyi:navigate'

/** `replace` swaps the current entry instead of adding one (a desktop that was renamed under you). */
export function navigate(path: string, opts?: { replace?: boolean }) {
  const url = new URL(path, window.location.href)
  if (url.pathname === window.location.pathname) {
    window.location.hash = url.hash
    return
  }
  if (opts?.replace) window.history.replaceState(null, '', url.pathname + url.hash)
  else window.history.pushState(null, '', url.pathname + url.hash)
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
