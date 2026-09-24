import type { Editor } from '@quickdrawjs/core'
import { useEffect, useReducer } from 'react'
import type { Peer } from '../shared/protocol'
import { colorFor, nameOf, type People } from './people'

/** Everyone else's pointer, in their colour, with their name (visitors in grey). */
export function Cursors({ editor, peers, people }: { editor: Editor; peers: Peer[]; people: People }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => editor.on('camera', rerender), [editor])

  return (
    <div className="Cursors">
      {peers.map((peer) => {
        if (!peer.cursor) return null
        const s = editor.pageToScreen(peer.cursor.x, peer.cursor.y)
        const color = peer.userId ? colorFor(peer.userId) : '#9a958b'
        return (
          <div key={peer.sessionId} className="Cursor" style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M2 2 L16 8.5 L9.5 10 L7 16 Z" fill={color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="Cursor-name" style={{ background: color }}>
              {peer.userId && people.get(peer.userId)?.avatar && <img className="Cursor-photo" src={people.get(peer.userId)!.avatar!} alt="" />}
              {peer.userId ? nameOf(people, peer.userId) : 'A visitor'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
