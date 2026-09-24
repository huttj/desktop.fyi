import type { Editor, ShapeRecord } from '@quickdrawjs/core'
import { GHOST_ALPHA, alphaAt, canSee, provisionalAge, visibilityAt } from '../shared/freshness'
import type { ItemMeta } from '../shared/types'

/** Which layers are on screen: everything, or one person's. */
export type LayerView = 'all' | string

export interface FreshnessState {
  metas: Map<string, ItemMeta>
  viewerId: string | null
  view: LayerView
  /** The author's toggle: also draw my own hidden things, faintly. */
  showHidden: boolean
}

/**
 * Wires the board's bookkeeping into the editor's render hooks: what is on
 * screen and how faded it draws follow each item's provisional age, the
 * chosen layer, and the viewer. Re-renders every minute so fades progress
 * while you watch.
 */
export function installFreshness(editor: Editor, state: FreshnessState): () => void {
  const decide = (shape: ShapeRecord): number => {
    const meta = state.metas.get(shape.id)
    // A record the room has not stamped yet (just made here) is fresh and on our layer.
    if (!meta) return 1
    if (state.view !== 'all' && meta.layer !== state.view) return 0
    const age = provisionalAge(meta, Date.now())
    const v = visibilityAt(age)
    if (v === 'archived') return 0
    if (v === 'hidden') {
      if (!state.showHidden || !canSee(meta, age, state.viewerId)) return 0
      return GHOST_ALPHA
    }
    return alphaAt(age)
  }
  editor.shapeFilter = (s) => decide(s) > 0
  editor.shapeAlpha = decide
  editor.requestRender()
  const timer = window.setInterval(() => editor.requestRender(), 60_000)
  return () => {
    clearInterval(timer)
    editor.shapeFilter = null
    editor.shapeAlpha = null
    editor.requestRender()
  }
}

/** Layers present on the board, owner first, then by first appearance. */
export function layersOf(metas: Map<string, ItemMeta>, owner: string): string[] {
  const seen = new Set<string>([owner])
  const out = [owner]
  for (const m of metas.values()) {
    if (!seen.has(m.layer)) {
      seen.add(m.layer)
      out.push(m.layer)
    }
  }
  return out
}
