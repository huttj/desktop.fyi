import type { Editor } from '@quickdrawjs/core'
import { useEffect, useState } from 'react'
import { provisionalAge } from '../shared/freshness'
import type { ItemMeta, Me } from '../shared/types'
import type { BoardSync } from './sync'

interface State {
  x: number
  y: number
  ids: string[]
  allPinned: boolean
  anyStale: boolean
}

/**
 * A small bar under the selection for the things you may look after: keep
 * them so they never age, or make them fresh again right now. Shows for the desktop's
 * owner on anything, and for anyone on their own things.
 */
export function SelectionActions({ editor, me, owner, metas, metaVersion, sync }: { editor: Editor; me: Me; owner: string | null; metas: Map<string, ItemMeta>; metaVersion: number; sync: BoardSync | null }) {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    const compute = () => {
      const editing = (editor as unknown as { editing: unknown }).editing
      const b = editor.selectionBounds()
      if (!b || editing) return setState(null)
      const now = Date.now()
      const ids: string[] = []
      let allPinned = true
      let anyStale = false
      for (const id of editor.selection) {
        const meta = metas.get(id)
        if (!meta) continue
        if (me.id !== owner && meta.by !== me.id) continue
        ids.push(id)
        if (!meta.pinned) allPinned = false
        if (!meta.pinned && provisionalAge(meta, now) > 0.05) anyStale = true
      }
      if (!ids.length) return setState(null)
      const s = editor.pageToScreen(b.x + b.w / 2, b.y + b.h)
      setState({ x: Math.round(s.x), y: Math.round(s.y), ids, allPinned, anyStale })
    }
    const offs = (['selection', 'camera', 'change', 'edit'] as const).map((ev) => editor.on(ev, compute))
    compute()
    return () => {
      for (const off of offs) off()
    }
  }, [editor, metas, metaVersion, me.id, owner])

  if (!state) return null
  const n = state.ids.length
  return (
    <div className="SelectionActions" style={{ transform: `translate(${state.x}px, ${state.y}px) translate(-50%, 10px)` }} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className={`SelectionActions-button${state.allPinned ? ' SelectionActions-button--on' : ''}`} onClick={() => sync?.pin(state.ids, !state.allPinned)} title={state.allPinned ? 'Let it age again' : 'Keep this: it never fades'}>
        <KeepIcon /> {state.allPinned ? 'Kept' : 'Keep'}
        {n > 1 ? ` ${n}` : ''}
      </button>
      {state.anyStale && (
        <button type="button" className="SelectionActions-button" onClick={() => sync?.freshen(state.ids)} title="Reset its age to zero">
          <SparkIcon /> Freshen
        </button>
      )}
    </div>
  )
}

function KeepIcon() {
  // a bookmark: kept for good
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 17v4M17 19h4" />
    </svg>
  )
}
