import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// A refresh must start at the top: iOS restores the last scroll offset, and the
// keyboard leaves one behind while typing on the board.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
window.addEventListener('pageshow', () => window.scrollTo(0, 0))
window.visualViewport?.addEventListener('resize', () => window.scrollTo(0, 0))

// The page itself never zooms: a pinch over the chrome would blow up every pill,
// and the board does its own zooming. iOS ignores the viewport's user-scalable
// for pinches, so its gesture events are refused here (except inside a field).
const inField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => { if (!inField(e.target)) e.preventDefault() }, { passive: false })
}
document.addEventListener(
  'touchmove',
  (e) => {
    if ((e as TouchEvent & { scale?: number }).scale !== undefined && (e as TouchEvent & { scale?: number }).scale !== 1 && !inField(e.target)) e.preventDefault()
  },
  { passive: false }
)
// a double tap zooms the page on iOS unless the tap lands on something that says otherwise
let lastTap = 0
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now()
    if (now - lastTap < 350 && !inField(e.target)) e.preventDefault()
    lastTap = now
  },
  { passive: false }
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
