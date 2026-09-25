import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { lockPage } from '@quickdrawjs/core'
import './index.css'

// The page stays out of the way: the board zooms and scrolls, the document never does.
lockPage()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
