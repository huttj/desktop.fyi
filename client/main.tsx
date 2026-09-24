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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
