import type { AssetRecord, Editor, ShapeRecord } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import { provisionalAge } from '../shared/freshness'
import type { ItemMeta, Me, Revision } from '../shared/types'
import { api } from './api'
import { nameOf, relativeTime, type People } from './people'
import type { BoardSync } from './sync'
import { renderThumb } from './thumb'

interface State {
  x: number
  y: number
  ids: string[]
  /** Things as the person counts them (a group is one). */
  count: number
  allPinned: boolean
  anyStale: boolean
  /** The one thing of yours that is selected, when it is just one: its history is yours to page through. */
  single: string | null
}

/**
 * A small bar under the selection for the things you may look after: keep
 * them so they never age, or make them fresh again right now. Shows for the desktop's
 * owner on anything, and for anyone on their own things.
 */
export function SelectionActions({
  editor,
  me,
  owner,
  handle,
  people,
  theme,
  metas,
  metaVersion,
  sync,
}: {
  editor: Editor
  me: Me
  owner: string | null
  handle: string
  people: People
  theme: 'light' | 'dark'
  metas: Map<string, ItemMeta>
  metaVersion: number
  sync: BoardSync | null
}) {
  const [state, setState] = useState<State | null>(null)
  const [historyOf, setHistoryOf] = useState<string | null>(null)

  useEffect(() => {
    const compute = () => {
      const editing = (editor as unknown as { editing: unknown }).editing
      const b = editor.selectionBounds()
      // out of the way while one of the board's own menus is up
      const menuOpen = !!editor.container.querySelector('.qd-menu-pop')
      if (!b || editing || menuOpen) return setState(null)
      const now = Date.now()
      const ids: string[] = []
      // what the person sees as one thing: a group counts once, however many shapes it holds
      const units = new Set<string>()
      let allPinned = true
      let anyStale = false
      for (const id of editor.selection) {
        const meta = metas.get(id)
        if (!meta) continue
        if (me.id !== owner && meta.by !== me.id) continue
        ids.push(id)
        const shape = editor.store.get(id)
        units.add((shape && shape.typeName === 'shape' && shape.groupId) || id)
        if (!meta.pinned) allPinned = false
        if (!meta.pinned && provisionalAge(meta, now) > 0.05) anyStale = true
      }
      if (!ids.length) return setState(null)
      const s = editor.pageToScreen(b.x + b.w / 2, b.y + b.h)
      const only = editor.selection.size === 1 && ids.length === 1 ? ids[0]! : null
      const onlyRec = only ? editor.store.get(only) : undefined
      const single = only && metas.get(only)?.by === me.id && onlyRec?.typeName === 'shape' && !onlyRec.groupId ? only : null
      setState({ x: Math.round(s.x), y: Math.round(s.y), ids, count: units.size, allPinned, anyStale, single })
    }
    const offs = (['selection', 'camera', 'change', 'edit', 'contextmenu'] as const).map((ev) => editor.on(ev, compute))
    // menus come and go in the DOM without an event of their own
    const mo = new MutationObserver(compute)
    mo.observe(editor.container, { childList: true, subtree: true })
    compute()
    return () => {
      for (const off of offs) off()
      mo.disconnect()
    }
  }, [editor, metas, metaVersion, me.id, owner])

  // the history closes with the selection it belonged to
  const single = state?.single ?? null
  useEffect(() => {
    if (historyOf && historyOf !== single) setHistoryOf(null)
  }, [historyOf, single])

  if (!state) return null
  const n = state.count
  return (
    <div className="SelectionActions" style={{ transform: `translate(${state.x}px, ${state.y}px) translate(-50%, 10px)` }} onPointerDown={(e) => e.stopPropagation()}>
      {historyOf && <History editor={editor} id={historyOf} handle={handle} me={me} people={people} theme={theme} onClose={() => setHistoryOf(null)} />}
      <button type="button" className={`SelectionActions-button${state.allPinned ? ' SelectionActions-button--on' : ''}`} onClick={() => sync?.pin(state.ids, !state.allPinned)} title={state.allPinned ? 'Let it age again' : 'Keep this: it never fades'}>
        <KeepIcon /> {n > 1 ? (state.allPinned ? 'Keeping these' : 'Keep these') : state.allPinned ? 'Kept' : 'Keep'}
        {n > 1 && <span className="SelectionActions-count">{n}</span>}
      </button>
      {state.anyStale && (
        <button type="button" className="SelectionActions-button" onClick={() => sync?.freshen(state.ids)} title="Reset its age to zero">
          <SparkIcon /> Freshen
        </button>
      )}
      {state.single && (
        <button type="button" className={`SelectionActions-button${historyOf ? ' SelectionActions-button--on' : ''}`} onClick={() => setHistoryOf((h) => (h ? null : state.single))} title="Earlier versions of this, to bring one back">
          <HistoryIcon /> History
        </button>
      )}
    </div>
  )
}

/**
 * Earlier states of one item, newest first, each with a little picture of how it
 * looked. Choosing one puts it back as an ordinary edit, so the state it replaces
 * joins the list and you can page back and forth.
 */
function History({ editor, id, handle, me, people, theme, onClose }: { editor: Editor; id: string; handle: string; me: Me; people: People; theme: 'light' | 'dark'; onClose: () => void }) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // fetched on opening, and again a beat after the item changes (a restore adds a step)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      api
        .history(handle, id)
        .then((r) => alive && (setRevisions(r), setError(null)))
        .catch((e: Error) => alive && setError(e.message))
    }
    load()
    const off = editor.on('change', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 600)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [editor, handle, id])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const restore = (rev: Revision) => {
    const rec = rev.record as ShapeRecord
    if (!rec || rec.typeName !== 'shape' || rec.id !== id) return
    const current = editor.store.get(id)
    if (!current || current.typeName !== 'shape') return
    // it comes back where the thing sits now in the stack, and in its current group
    editor.store.put({ ...rec, z: current.z, groupId: current.groupId }, 'user')
  }

  return (
    <div className="History" ref={ref}>
      <div className="History-head">
        <strong>History</strong>
        <span className="Muted">what this looked like before</span>
      </div>
      {error && <p className="Muted History-empty">{error}</p>}
      {revisions && !revisions.length && !error && <p className="Muted History-empty">No earlier versions yet. Each edit or move from now on keeps one.</p>}
      {revisions && revisions.length > 0 && (
        <div className="History-list">
          {revisions.map((rev) => (
            <button type="button" key={rev.seq} className="History-row" onClick={() => restore(rev)} title="Bring this version back">
              <Thumb editor={editor} record={rev.record as ShapeRecord} theme={theme} />
              <span className="History-text">
                <span className="History-what">
                  {rev.kind === 'move' ? 'Before a move' : rev.kind === 'remove' ? 'Before it was removed' : 'Before an edit'}
                </span>
                <span className="Muted">
                  {relativeTime(rev.at)}
                  {rev.by !== me.id ? ` · ${nameOf(people, rev.by)}` : ''}
                </span>
                {snippetOf(rev.record) && <span className="History-snippet">{snippetOf(rev.record)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The words in a text-like record, for a row that reads at a glance. */
function snippetOf(record: unknown): string | null {
  const rec = record as ShapeRecord | undefined
  const text = rec?.props?.text ?? rec?.props?.label
  if (typeof text !== 'string' || !text.trim()) return null
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 90 ? `${one.slice(0, 88)}…` : one
}

function Thumb({ editor, record, theme }: { editor: Editor; record: ShapeRecord; theme: 'light' | 'dark' }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current || record?.typeName !== 'shape') return
    const assetId = record.props?.assetId as string | undefined
    const asset = assetId ? (editor.store.get(assetId) as unknown as AssetRecord | undefined) : undefined
    renderThumb(canvas.current, [record], asset?.typeName === 'asset' ? [asset] : [], theme)
  }, [editor, record, theme])
  return <canvas ref={canvas} className="History-thumb" />
}

function HistoryIcon() {
  // a clock, turned back
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
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
