import type { Editor } from '@quickdrawjs/core'
import { useEffect, useReducer } from 'react'
import type { Peer } from '../shared/protocol'
import { colorFor, nameOf, type People } from './people'

const ANON = '#9a958b'

/** What everyone else is looking at: their window, drawn as a frame in their colour, with their name. */
export function Viewports({ editor, peers, people, meId }: { editor: Editor; peers: Peer[]; people: People; meId: string | null }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => editor.on('camera', rerender), [editor])

  const { w: vw, h: vh } = editor.viewSize()
  return (
    <div className="Viewports">
      {peers.map((peer) => {
        if (!peer.viewport) return null
        const a = editor.pageToScreen(peer.viewport.x, peer.viewport.y)
        const b = editor.pageToScreen(peer.viewport.x + peer.viewport.w, peer.viewport.y + peer.viewport.h)
        // a window much larger than ours would only ever surround us: skip its frame, keep its label
        const covers = a.x <= 0 && a.y <= 0 && b.x >= vw && b.y >= vh
        const color = peer.userId ? colorFor(peer.userId) : ANON
        const label = peer.userId ? (peer.userId === meId ? 'You, in another window' : nameOf(people, peer.userId)) : 'A visitor'
        return (
          <div
            key={peer.sessionId}
            className={`Viewport${covers ? ' Viewport--covers' : ''}`}
            style={{ transform: `translate(${a.x}px, ${a.y}px)`, width: b.x - a.x, height: b.y - a.y, borderColor: color }}
          >
            <span className="Viewport-label" style={{ background: color, transform: covers ? `translate(${Math.max(8, -a.x + 8)}px, ${Math.max(8, -a.y + 8)}px)` : undefined }}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
