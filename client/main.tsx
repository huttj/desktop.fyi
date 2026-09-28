import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { lockPage } from '@quickdrawjs/core'
import './index.css'

// The page stays out of the way: the board zooms and scrolls, the document never does.
lockPage()
// Nor does the browser's own zoom, anywhere: ⌘/ctrl with +, - or 0 belongs to whatever is on screen.
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && ['=', '+', '-', '_', '0'].includes(e.key)) e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
