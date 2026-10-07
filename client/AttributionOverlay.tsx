import { pageBounds, type Editor, type ShapeRecord } from '@quickdrawjs/core'
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
 * (or the one selected group) so it also works on touch devices. A group ages
 * as one, so it gets one tooltip: above the whole group, from its first
 * member's making to its latest touch, unless the group is open (double-click)
 * and its members are being picked one by one.
 */
export function AttributionOverlay({ editor, people, metas, meId }: { editor: Editor; people: People; metas: Map<string, ItemMeta>; meId: string | null }) {
  const [info, setInfo] = useState<Info | null>(null)
  const hovered = useRef<string | null>(null)
  const lastKey = useRef('')

  useEffect(() => {
    const groupOf = (shape: ShapeRecord | undefined) => (shape?.groupId && shape.groupId !== editor.focusedGroup ? shape.groupId : null)
    const compute = () => {
      const sel = [...editor.selection]
      const selGroup = sel.length > 1 ? groupOf(editor.store.get(sel[0]!) as ShapeRecord | undefined) : null
      const selected = sel.length === 1 || (selGroup && sel.every((id) => (editor.store.get(id) as ShapeRecord | undefined)?.groupId === selGroup)) ? sel[0]! : null
      const id = hovered.current ?? selected
      const shape = id ? editor.store.get(id) : undefined
      const editing = (editor as unknown as { editing: unknown }).editing
      let next: Info | null = null
      // tucked away mid-drag, back where the thing lands
      if (shape && shape.typeName === 'shape' && !editing && !editor.dragging) {
        const group = groupOf(shape)
        const members = (group ? editor.groupMembers(group) : [shape.id]).map((m) => editor.store.get(m)).filter((m): m is ShapeRecord => m?.typeName === 'shape')
        const known = members.flatMap((m) => (metas.has(m.id) ? [{ shape: m, meta: metas.get(m.id)! }] : []))
        if (known.length) {
          let b = pageBounds(members[0]!)
          for (const m of members.slice(1)) b = union(b, pageBounds(m))
          const s = editor.pageToScreen(b.x, b.y)
          const first = known.reduce((a, k) => (k.meta.at < a.meta.at ? k : a))
          const latest = known.reduce((a, k) => (k.meta.editedAt > a.meta.editedAt ? k : a))
          const now = Date.now()
          // members share one clock; the freshest stands for the group should one lag (a meta in flight)
          const age = Math.min(...known.map((k) => provisionalAge(k.meta, now)))
          next = {
            x: Math.round(s.x),
            y: Math.round(s.y),
            by: first.meta.by,
            at: first.meta.at,
            editedBy: latest.meta.editedBy !== first.meta.by ? latest.meta.editedBy : null,
            editedAt: latest.meta.editedAt,
            age: Math.round(age * 100) / 100,
            pinned: known.some((k) => k.meta.pinned),
          }
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
      const id = editor.hitTest(p.x, p.y, { inside: true })?.id ?? null
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
    const offs = (['selection', 'camera', 'change', 'edit', 'dragging'] as const).map((ev) => editor.on(ev, compute))
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

function union(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
