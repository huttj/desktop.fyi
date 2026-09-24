import type { Person } from '../shared/types'

export type People = Map<string, Person>

const COLORS = ['#FF802B', '#EC5E41', '#F2555A', '#F04F88', '#E34BA9', '#BD54C6', '#9D5BD2', '#7B66DC', '#02B1CC', '#11B3A3', '#39B178', '#55B467']

export function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]!
}

export function nameOf(people: People, id: string | undefined | null, meId?: string | null) {
  if (!id) return 'someone'
  if (meId && id === meId) return 'You'
  const p = people.get(id)
  return p?.name ?? (p?.handle ? `@${p.handle}` : 'someone')
}

export function handleOf(people: People, id: string | undefined | null) {
  const h = id ? people.get(id)?.handle : null
  return h ? `@${h}` : null
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function relativeTime(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}
