import { ARCHIVE_AT, BUMP, DAY_MS, DIRECT_CAP, SPREAD_CAP, TOTAL_CAP, falloff } from './freshness'

/**
 * The daily pass. Pure: give it every live item on a board, with where it
 * ended up, and the day's events; it returns the new age of each item and
 * which ones are now past saving.
 *
 * Rules, in days of life:
 *   - time adds the days elapsed since the item was last scored
 *   - moving an item is a small bump, editing it a large one (capped together)
 *   - moving next to newer things is a medium bump, scaled by distance
 *   - everything an item earns spreads to its neighbours by inverse square,
 *     so a comment keeps the thing it sits on alive and the reverse
 *   - a new item is itself fresh, and freshens what it lands next to
 */
export type EventKind = 'create' | 'move' | 'edit'

export interface DecayItem {
  id: string
  /** Centre of the item's page bounds. */
  cx: number
  cy: number
  createdAt: number
  score: number
  scoredAt: number
}

export interface DecayEvent {
  itemId: string
  kind: EventKind
}

export interface DecayResult {
  /** New score (age in days) for every item passed in. */
  scores: Map<string, number>
  /** Items now at or past the archive threshold. */
  archived: string[]
  /** What each item gained, for the curious (and the tests). */
  bumps: Map<string, number>
}

export function runDecay(items: DecayItem[], events: DecayEvent[], now: number): DecayResult {
  const byId = new Map(items.map((i) => [i.id, i]))

  // 1. Direct bumps from the item's own events, plus a flag for new arrivals
  //    and for movers (their proximity to newer things is judged below).
  const direct = new Map<string, number>()
  const created = new Set<string>()
  const moved = new Set<string>()
  for (const e of events) {
    if (!byId.has(e.itemId)) continue
    if (e.kind === 'create') {
      created.add(e.itemId)
      continue
    }
    if (e.kind === 'move') moved.add(e.itemId)
    direct.set(e.itemId, Math.min(DIRECT_CAP, (direct.get(e.itemId) ?? 0) + BUMP[e.kind]))
  }

  // 2. Neighbourhood. Boards are small (hundreds of items), so the plain
  //    quadratic sweep is fine; the radius cut keeps the constant low.
  const neighbours = (a: DecayItem) => {
    const out: Array<{ item: DecayItem; w: number }> = []
    for (const b of items) {
      if (b === a) continue
      const w = falloff(Math.hypot(a.cx - b.cx, a.cy - b.cy))
      if (w > 0) out.push({ item: b, w })
    }
    return out
  }

  // 3. Moving next to newer things: a medium bump scaled by the closest such neighbour.
  const nearBonus = new Map<string, number>()
  for (const id of moved) {
    const a = byId.get(id)!
    let best = 0
    for (const { item: b, w } of neighbours(a)) {
      if (b.createdAt > a.createdAt || created.has(b.id)) best = Math.max(best, w)
    }
    if (best > 0) nearBonus.set(id, BUMP.near * best)
  }

  // 4. Spread: what an item earned (or its arrival) reaches its neighbours.
  //    A new item radiates a full "near" bump; an edited/moved one radiates
  //    what it earned. Inverse square, capped per receiver.
  const spread = new Map<string, number>()
  const sources: Array<[DecayItem, number]> = []
  for (const id of created) sources.push([byId.get(id)!, BUMP.near])
  for (const [id, amount] of direct) if (!created.has(id)) sources.push([byId.get(id)!, amount])
  for (const [src, amount] of sources) {
    for (const { item: b, w } of neighbours(src)) {
      spread.set(b.id, Math.min(SPREAD_CAP, (spread.get(b.id) ?? 0) + amount * w))
    }
  }

  // 5. Settle.
  const scores = new Map<string, number>()
  const bumps = new Map<string, number>()
  const archived: string[] = []
  for (const item of items) {
    const elapsed = Math.max(0, now - item.scoredAt) / DAY_MS
    // Born since the last pass: its age is simply how long it has existed.
    const gained = created.has(item.id)
      ? 0
      : Math.min(TOTAL_CAP, (direct.get(item.id) ?? 0) + (nearBonus.get(item.id) ?? 0) + (spread.get(item.id) ?? 0))
    const age = created.has(item.id) ? Math.max(0, (now - item.createdAt) / DAY_MS) : Math.max(0, item.score + elapsed - gained)
    scores.set(item.id, age)
    bumps.set(item.id, gained)
    if (age >= ARCHIVE_AT) archived.push(item.id)
  }
  return { scores, archived, bumps }
}
