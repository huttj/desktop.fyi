import { describe, expect, it } from 'vitest'
import { runDecay, type DecayItem } from './decay'
import { ARCHIVE_AT, BUMP, DAY_MS, DIRECT_CAP, HIDE_AT, PROXIMITY_R0, alphaAt, days, describeAge, describeSpan, pointsOf, provisionalAge, visibilityAt } from './freshness'

const T0 = Date.UTC(2026, 8, 1)
const item = (id: string, over: Partial<DecayItem> = {}): DecayItem => ({
  id,
  cx: 0,
  cy: 0,
  createdAt: T0 - 5 * DAY_MS,
  score: 0,
  scoredAt: T0,
  ...over,
})

describe('runDecay', () => {
  it('ages an untouched item by the elapsed time', () => {
    const r = runDecay([item('a')], [], T0 + DAY_MS)
    expect(r.scores.get('a')).toBeCloseTo(1)
    expect(r.archived).toEqual([])
  })

  it('archives at the threshold', () => {
    const r = runDecay([item('a', { score: 6.5 })], [], T0 + DAY_MS)
    expect(r.scores.get('a')).toBeCloseTo(7.5)
    expect(r.archived).toEqual(['a'])
  })

  it('a move is a tiny bump, an edit a small one, together capped', () => {
    const items = [item('a'), item('b'), item('c')]
    // far apart so nothing spreads
    items[1].cx = 100_000
    items[2].cx = 200_000
    const r = runDecay(
      items,
      [
        { itemId: 'a', kind: 'move' },
        { itemId: 'b', kind: 'edit' },
        { itemId: 'c', kind: 'edit' },
        { itemId: 'c', kind: 'edit' },
        { itemId: 'c', kind: 'edit' },
        { itemId: 'c', kind: 'edit' },
        { itemId: 'c', kind: 'move' },
      ],
      T0 + DAY_MS
    )
    expect(r.bumps.get('a')).toBeCloseTo(BUMP.move)
    expect(r.bumps.get('b')).toBeCloseTo(BUMP.edit)
    expect(r.bumps.get('c')).toBeCloseTo(DIRECT_CAP) // 4 edits and a move = 21 points, capped at 15
    expect(r.scores.get('a')).toBeCloseTo(1 - BUMP.move)
    expect(r.scores.get('b')).toBeCloseTo(1 - BUMP.edit)
  })

  it('a new item is fresh and warms its neighbours by distance; two bring an old thing right back', () => {
    const old1 = item('near', { score: 2, cx: 0 })
    const old2 = item('far', { score: 2, cx: PROXIMITY_R0 * 3 })
    const young = item('young', { score: 0.2, cy: 0, cx: 0 })
    const fresh = item('new', { createdAt: T0 + DAY_MS / 2, scoredAt: T0 + DAY_MS / 2, cx: 0 })
    const r = runDecay([old1, old2, young, fresh], [{ itemId: 'new', kind: 'create' }], T0 + DAY_MS)
    expect(r.scores.get('new')).toBeCloseTo(0.5)
    // at distance 0 the old one gets the whole "arrive" bump
    expect(r.bumps.get('near')).toBeCloseTo(BUMP.arrive)
    expect(r.scores.get('near')).toBeCloseTo(3 - BUMP.arrive)
    // the one three radii away gets a tenth of that
    expect(r.bumps.get('far')).toBeCloseTo(BUMP.arrive / 10)
    // the young one cannot get younger than born
    expect(r.scores.get('young')).toBeCloseTo(Math.max(0, 1.2 - BUMP.arrive))
    // and the newcomer itself gains nothing
    expect(r.bumps.get('new')).toBe(0)
    // two arrivals next to a thing on its last legs put it back near full
    const dying = item('dying', { score: 1.8, cx: 5000 }) // 7% by the time of the pass
    const two = runDecay(
      [dying, item('n1', { createdAt: T0 + DAY_MS / 2, scoredAt: T0 + DAY_MS / 2, cx: 5000 }), item('n2', { createdAt: T0 + DAY_MS / 2, scoredAt: T0 + DAY_MS / 2, cx: 5000 })],
      [{ itemId: 'n1', kind: 'create' }, { itemId: 'n2', kind: 'create' }],
      T0 + DAY_MS
    )
    expect(pointsOf(two.scores.get('dying')!)).toBeGreaterThan(60)
  })

  it('moving next to something newer earns a small bump', () => {
    const mover = item('mover', { createdAt: T0 - 10 * DAY_MS, cx: 0, score: 1 })
    const newer = item('newer', { createdAt: T0 - DAY_MS, cx: 50, score: 2 })
    const r = runDecay([mover, newer], [{ itemId: 'mover', kind: 'move' }], T0 + DAY_MS)
    const w = 1 / (1 + (50 / PROXIMITY_R0) ** 2)
    expect(r.bumps.get('mover')).toBeCloseTo(BUMP.move + BUMP.near * w)
    // and the neighbour catches the warmth of the move
    expect(r.bumps.get('newer')).toBeCloseTo(BUMP.move * w)
  })

  it('an edit on a thing freshens the comments sitting on it, and the reverse', () => {
    const post = item('post', { score: 2.5, cx: 0 })
    const comment = item('comment', { score: 2.5, cx: 120, createdAt: T0 - DAY_MS })
    const edited = runDecay([post, comment], [{ itemId: 'post', kind: 'edit' }], T0 + DAY_MS)
    expect(edited.bumps.get('comment')!).toBeGreaterThan(0)
    const replied = runDecay([post, comment], [{ itemId: 'comment', kind: 'edit' }], T0 + DAY_MS)
    expect(replied.bumps.get('post')!).toBeGreaterThan(0)
  })

  it('a pinned item does not age', () => {
    const r = runDecay([item('a', { score: 6.9, pinned: true })], [], T0 + 10 * DAY_MS)
    expect(r.scores.get('a')).toBe(0)
    expect(r.archived).toEqual([])
  })

  it('ignores events for items it was not given', () => {
    const r = runDecay([item('a')], [{ itemId: 'ghost', kind: 'edit' }], T0 + DAY_MS)
    expect(r.scores.get('a')).toBeCloseTo(1)
  })
})

describe('freshness', () => {
  it('provisional age counts time and subtracts pending bumps, capped', () => {
    const meta = { score: 1, scoredAt: T0, pending: days(5) }
    expect(provisionalAge(meta, T0 + DAY_MS)).toBeCloseTo(2 - days(5))
    expect(provisionalAge({ ...meta, pending: 10 }, T0 + DAY_MS)).toBeCloseTo(2 - DIRECT_CAP)
    // warmth from new neighbours counts right away too
    expect(provisionalAge({ ...meta, warmed: days(33) }, T0 + DAY_MS)).toBeCloseTo(2 - days(5) - days(33))
  })

  it('reads as a score out of 100 that runs out at hiding', () => {
    expect(pointsOf(0)).toBe(100)
    expect(pointsOf(HIDE_AT / 2)).toBe(50)
    expect(pointsOf(HIDE_AT)).toBe(0)
    expect(pointsOf(ARCHIVE_AT)).toBe(0)
    expect(days(100)).toBe(HIDE_AT)
    expect(describeAge(0.3)).toBe('90% fresh')
    expect(describeAge(2)).toBe('33% · vanishes in 1d')
    expect(describeAge(2, true)).toBe('kept')
  })

  it('maps age to visibility and opacity', () => {
    expect(visibilityAt(0.5)).toBe('fresh')
    expect(visibilityAt(2)).toBe('fading')
    expect(visibilityAt(HIDE_AT)).toBe('hidden')
    expect(visibilityAt(ARCHIVE_AT)).toBe('archived')
    expect(alphaAt(0.5)).toBe(1)
    expect(alphaAt(2)).toBeLessThan(1)
    expect(alphaAt(2)).toBeGreaterThan(alphaAt(2.9))
  })
})

describe('describeSpan', () => {
  it('speaks in whole days and hours', () => {
    expect(describeSpan(2)).toBe('2d')
    expect(describeSpan(1.5)).toBe('1d 12h')
    expect(describeSpan(0.2)).toBe('5h')
    expect(describeSpan(0.001)).toBe('1h')
    expect(describeSpan(1.99)).toBe('2d')
  })
})
