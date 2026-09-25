// The page around a board. A whiteboard wants the browser to stay out of
// the way: no pinch or double-tap zooming the page (the board zooms itself),
// no scrolling document (a phone's keyboard nudges one, and a reload brings
// the offset back with the chrome shifted), and a scroll pinned to the top.
// Dependency-free, like the rest.

const inField = (t) => !!t?.closest?.('input, textarea, [contenteditable]')

/**
 * Lock the page: refuse pinch and double-tap zoom outside text fields, make
 * the document unscrollable (body fixed, full height), and pin the scroll.
 * Returns a function that undoes it.
 */
export function lockPage({ zoom = true, scroll = true } = {}) {
  const offs = []
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)) }
  if (zoom) {
    // Safari's gesture events are the pinch; other browsers report it as a scaled touchmove
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) on(document, type, (e) => { if (!inField(e.target)) e.preventDefault() }, { passive: false })
    on(document, 'touchmove', (e) => { if (e.scale !== undefined && e.scale !== 1 && !inField(e.target)) e.preventDefault() }, { passive: false })
    let lastTap = 0
    on(document, 'touchend', (e) => {
      const now = Date.now()
      if (now - lastTap < 350 && !inField(e.target)) e.preventDefault()
      lastTap = now
    }, { passive: false })
  }
  if (scroll) {
    const html = document.documentElement, body = document.body
    const prev = { html: html.style.cssText, body: body.style.cssText }
    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    Object.assign(body.style, { position: 'fixed', inset: '0', width: '100%', height: '100dvh', overflow: 'hidden', overscrollBehavior: 'none', touchAction: 'none' })
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    const top = () => window.scrollTo(0, 0)
    top()
    on(window, 'pageshow', top)
    if (window.visualViewport) on(window.visualViewport, 'resize', top)
    offs.push(() => { html.style.cssText = prev.html; body.style.cssText = prev.body })
  }
  return () => { for (const off of offs.splice(0)) off() }
}
