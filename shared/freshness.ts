import type { ItemMeta } from './types'

/**
 * How things age on a desktop. An item's score is its age in days; time adds
 * to it, attention takes from it. The daily pass (see decay.ts) settles the
 * books; between passes everyone works from the provisional age below.
 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** Fully fresh until this age (days). */
export const FADE_START = 1
/** Fading until this age; then hidden from everyone but its author. */
export const HIDE_AT = 3
/** Archived (gone from the board) at this age. */
export const ARCHIVE_AT = 7
/** Archived items are kept this long for a data request, then deleted. */
export const PURGE_AFTER_DAYS = 30

/** Direct bumps, in days of life. */
export const BUMP = {
  move: 0.5,
  edit: 2,
  /** A new item next to you, or you moved next to something newer (scaled by distance). */
  near: 1,
} as const
/** The most direct bumps one item can bank in a day. */
export const DIRECT_CAP = 3
/** The most it can gain from its neighbours in a day. */
export const SPREAD_CAP = 2
/** The most one item can gain in total per day. */
export const TOTAL_CAP = 4

/** Proximity falls off as 1 / (1 + (d / R0)^2); beyond R_MAX it is ignored. */
export const PROXIMITY_R0 = 260
export const PROXIMITY_R_MAX = 1200

/** Fading items never drop below this opacity while still visible. */
export const MIN_VISIBLE_ALPHA = 0.14
/** Hidden items the author chose to see. */
export const GHOST_ALPHA = 0.22

export function falloff(distance: number): number {
  if (distance >= PROXIMITY_R_MAX) return 0
  const r = distance / PROXIMITY_R0
  return 1 / (1 + r * r)
}

/** Age in days right now, before the next daily pass makes it official. */
export function provisionalAge(meta: Pick<ItemMeta, 'score' | 'scoredAt' | 'pending'> & { pinned?: boolean }, now: number): number {
  if (meta.pinned) return 0
  const elapsed = Math.max(0, now - meta.scoredAt) / DAY_MS
  return Math.max(0, meta.score + elapsed - Math.min(meta.pending, DIRECT_CAP))
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

export function describeAge(age: number, pinned = false): string {
  if (pinned) return 'kept'
  const v = visibilityAt(age)
  if (v === 'fresh') return 'fresh'
  if (v === 'fading') {
    const left = HIDE_AT - age
    if (left < 1 / 24) return 'about to vanish'
    if (left < 1) return `vanishes in ${Math.max(1, Math.round(left * 24))}h`
    return `vanishes in ${Math.round(left * 10) / 10}d`
  }
  if (v === 'hidden') {
    const left = ARCHIVE_AT - age
    return left < 1 ? 'hidden, gone within a day' : `hidden, gone in ${Math.round(left)}d`
  }
  return 'gone'
}
