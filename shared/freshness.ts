import type { ItemMeta } from './types'

/**
 * How things age on a desktop. An item's score is its age in days (people see
 * it as a freshness percentage, see POINTS); time adds to it, attention takes
 * from it. The daily pass (see decay.ts) settles the books; between passes
 * everyone works from the provisional age below.
 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** Fully fresh until this age (days). */
export const FADE_START = 1
/** Fading until this age; then hidden from everyone but its author. */
export const HIDE_AT = 3
/** "Vanishing soon" in the feed: this much left before hiding, in days (6 hours). */
export const SOON = 6 / 24
/** Archived (gone from the board) at this age. */
export const ARCHIVE_AT = 7
/** Archived items are kept this long for a data request, then deleted. */
export const PURGE_AFTER_DAYS = 30

/**
 * Freshness is a score from 100 (just made) to 0 (hidden). Time takes points
 * away at a steady rate (100 over HIDE_AT days, about 1.4 an hour); attention
 * gives some back. The engine keeps the score as an age in days, so a bump is
 * written here in points and converted.
 */
export const POINTS = 100
export const days = (points: number) => (points / POINTS) * HIDE_AT
export const pointsOf = (age: number) => Math.max(0, Math.min(POINTS, POINTS * (1 - age / HIDE_AT)))
export const freshnessOf = (age: number) => pointsOf(age) / POINTS

/** Bumps, in days of life. A move barely counts: people shove things around to make space. */
export const BUMP = {
  /** 1 point. */
  move: days(1),
  /** 5 points. */
  edit: days(5),
  /** Moving next to something newer: 3 points, scaled by distance. */
  near: days(3),
  /** A new arrival warms its neighbours by up to 33 points (by distance): using a thing is what keeps it. */
  arrive: days(33),
} as const
/** The most direct bumps one item can bank in a day (15 points). */
export const DIRECT_CAP = days(15)
/** The most it can gain from its neighbours in a day: a full life. */
export const SPREAD_CAP = days(100)
/** The most one item can gain in total per day: a full life. */
export const TOTAL_CAP = days(100)
/** Freshen is offered once less than half a life is left. */
export const FRESHEN_BELOW = 0.5

/** Proximity falls off as 1 / (1 + (d / R0)^2); beyond R_MAX it is ignored. */
export const PROXIMITY_R0 = 260
export const PROXIMITY_R_MAX = 1200

/** Fading items never drop below this opacity while still visible: they drain of colour first (see fadeAt). */
export const MIN_VISIBLE_ALPHA = 0.55
/** Hidden items the author chose to see. */
export const GHOST_ALPHA = 0.4

export function falloff(distance: number): number {
  if (distance >= PROXIMITY_R_MAX) return 0
  const r = distance / PROXIMITY_R0
  return 1 / (1 + r * r)
}

/** Age in days right now, before the next daily pass makes it official. */
export function provisionalAge(meta: Pick<ItemMeta, 'score' | 'scoredAt' | 'pending'> & { pinned?: boolean; warmed?: number }, now: number): number {
  if (meta.pinned) return 0
  const elapsed = Math.max(0, now - meta.scoredAt) / DAY_MS
  return Math.max(0, meta.score + elapsed - Math.min(meta.pending, DIRECT_CAP) - Math.min(meta.warmed ?? 0, SPREAD_CAP))
}

export type Visibility = 'fresh' | 'fading' | 'hidden' | 'archived'

export function visibilityAt(age: number): Visibility {
  if (age >= ARCHIVE_AT) return 'archived'
  if (age >= HIDE_AT) return 'hidden'
  if (age >= FADE_START) return 'fading'
  return 'fresh'
}

/** Opacity for a visible item at this age (1 fresh, down to MIN_VISIBLE_ALPHA at the edge of hiding). */
export function alphaAt(age: number): number {
  if (age <= FADE_START) return 1
  if (age >= HIDE_AT) return MIN_VISIBLE_ALPHA
  const t = (age - FADE_START) / (HIDE_AT - FADE_START)
  return 1 - t * (1 - MIN_VISIBLE_ALPHA)
}

/** How much colour a visible item keeps at this age: full while fresh, a warm grey by the edge of hiding. */
export function fadeAt(age: number): number {
  if (age <= FADE_START) return 1
  if (age >= HIDE_AT) return 0
  return 1 - (age - FADE_START) / (HIDE_AT - FADE_START)
}

/** Can this viewer see the item at all? Hidden items show only to their author. */
export function canSee(meta: ItemMeta, age: number, viewerId: string | null): boolean {
  const v = visibilityAt(age)
  if (v === 'archived') return false
  if (v === 'hidden') return viewerId !== null && viewerId === meta.by
  return true
}

/** Days until the item is hidden (negative once it is), for "vanishing soon" copy. */
export function daysUntilHidden(age: number): number {
  return HIDE_AT - age
}

/** A span of days in whole days and hours: "2d", "5h", "1d 5h"; never less than an hour. */
export function describeSpan(days: number): string {
  const hours = Math.max(1, Math.round(days * 24))
  const d = Math.floor(hours / 24)
  const h = hours % 24
  if (!d) return `${h}h`
  return h ? `${d}d ${h}h` : `${d}d`
}

export function describeAge(age: number, pinned = false): string {
  if (pinned) return 'kept'
  const v = visibilityAt(age)
  const pct = `${Math.round(pointsOf(age))}%`
  if (v === 'fresh') return `${pct} fresh`
  if (v === 'fading') {
    const left = HIDE_AT - age
    if (left < 1 / 24) return 'about to vanish'
    return `${pct} · vanishes in ${describeSpan(left)}`
  }
  if (v === 'hidden') {
    const left = ARCHIVE_AT - age
    return left < 1 / 24 ? 'hidden, about to go' : `hidden, gone in ${describeSpan(left)}`
  }
  return 'gone'
}
