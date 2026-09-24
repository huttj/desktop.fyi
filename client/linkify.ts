import type { Diff, ShapeRecord, Store, TextMark } from '@quickdrawjs/core'

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/gi

/**
 * Pasted links become links. A store reactor: any new text or note whose
 * text holds a URL and has no link marks yet gets href marks for each one,
 * inside the same transaction as the paste.
 */
export function installLinkify(store: Store): () => void {
  return store.react((diff: Diff) => {
    for (const rec of Object.values(diff.added)) {
      if (rec.typeName !== 'shape') continue
      const s = rec as ShapeRecord
      if (s.type !== 'text' && s.type !== 'note') continue
      const text: string = typeof s.props.text === 'string' ? s.props.text : ''
      const marks: TextMark[] = Array.isArray(s.props.marks) ? s.props.marks : []
      if (!text || marks.some((m) => m.href)) continue
      const found: TextMark[] = []
      for (const m of text.matchAll(URL_RE)) {
        found.push({ from: m.index!, to: m.index! + m[0].length, href: m[0] })
      }
      if (!found.length) continue
      store.put({ ...s, props: { ...s.props, marks: [...marks, ...found] } })
    }
  })
}
