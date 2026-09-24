import { pageBounds, type Editor } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import { describeAge, provisionalAge, visibilityAt } from '../shared/freshness'
import type { ItemMeta } from '../shared/types'
import { colorFor, nameOf, relativeTime, type People } from './people'

interface Info {
  x: number
  y: number
  by: string
  at: number
  editedBy: string | null
  editedAt: number
  age: number
  pinned: boolean
}

/**
 * Shows who made (and last touched) the hovered shape and how it is doing,
 * pinned above its top-left corner. Falls back to the single selected shape
 * so it also works on touch devices.
 */
export function AttributionOverlay({ editor, people, metas, meId }: { editor: Editor; people: People; metas: Map<string, ItemMeta>; meId: string | null }) {
  const [info, setInfo] = useState<Info | null>(null)
  const hovered = useRef<string | null>(null)
  const lastKey = useRef('')

  useEffect(() => {
    const compute = () => {
      const selected = editor.selection.size === 1 ? [...editor.selection][0] : null
      const id = hovered.current ?? selected
      const shape = id ? editor.store.get(id) : undefined
      const editing = (editor as unknown as { editing: unknown }).editing
      const meta = shape && shape.typeName === 'shape' && !editing ? metas.get(shape.id) : undefined
      let next: Info | null = null
      if (shape && shape.typeName === 'shape' && meta) {
        const b = pageBounds(shape)
        const s = editor.pageToScreen(b.x, b.y)
        next = {
          x: Math.round(s.x),
          y: Math.round(s.y),
          by: meta.by,
          at: meta.at,
          editedBy: meta.editedBy !== meta.by ? meta.editedBy : null,
          editedAt: meta.editedAt,
          age: Math.round(provisionalAge(meta, Date.now()) * 100) / 100,
          pinned: meta.pinned,
        }
      }
      const key = next ? JSON.stringify(next) : ''
      if (key === lastKey.current) return
      lastKey.current = key
      setInfo(next)
    }

    const el = editor.container
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const r = el.getBoundingClientRect()
      const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
      const id = editor.hitTest(p.x, p.y)?.id ?? null
      if (id !== hovered.current) {
        hovered.current = id
        compute()
      }
    }
    const onLeave = () => {
      hovered.current = null
      compute()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    const offs = (['selection', 'camera', 'change', 'edit'] as const).map((ev) => editor.on(ev, compute))
    compute()
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      for (const off of offs) off()
    }
  }, [editor, metas])

  if (!info) return null
  const v = visibilityAt(info.age)

  return (
    <div className="Attribution" style={{ transform: `translate(${info.x}px, ${info.y}px) translateY(calc(-100% - 6px))` }}>
      {people.get(info.by)?.avatar ? (
        <img className="Attribution-photo" src={people.get(info.by)!.avatar!} alt="" />
      ) : (
        <span className="Attribution-dot" style={{ background: colorFor(info.by) }} />
      )}
      <span>
        <strong>{nameOf(people, info.by, meId)}</strong>
        <span className="Attribution-time"> · {relativeTime(info.at)}</span>
      </span>
      {info.editedBy && (
        <span className="Attribution-edit">
          touched by <strong>{nameOf(people, info.editedBy, meId)}</strong>
          <span className="Attribution-time"> · {relativeTime(info.editedAt)}</span>
        </span>
      )}
      <span className={`Attribution-edit Attribution-age Attribution-age--${info.pinned ? 'pinned' : v}`}>{describeAge(info.age, info.pinned)}</span>
    </div>
  )
}
