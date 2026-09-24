import { describe, expect, it } from 'vitest'
import { runDecay, type DecayItem } from './decay'
import { ARCHIVE_AT, BUMP, DAY_MS, HIDE_AT, PROXIMITY_R0, alphaAt, provisionalAge, visibilityAt } from './freshness'

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

  it('a move is a small bump, an edit a large one, together capped', () => {
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
        { itemId: 'c', kind: 'move' },
      ],
      T0 + DAY_MS
    )
    expect(r.bumps.get('a')).toBeCloseTo(BUMP.move)
    expect(r.bumps.get('b')).toBeCloseTo(BUMP.edit)
    expect(r.bumps.get('c')).toBeCloseTo(3) // capped
    expect(r.scores.get('a')).toBeCloseTo(1 - BUMP.move)
    expect(r.scores.get('b')).toBeCloseTo(0)
  })

  it('a new item is fresh and freshens its neighbours by distance', () => {
    const old1 = item('near', { score: 2, cx: 0 })
    const old2 = item('far', { score: 2, cx: PROXIMITY_R0 * 3 })
    const fresh = item('new', { createdAt: T0 + DAY_MS / 2, scoredAt: T0 + DAY_MS / 2, cx: 0 })
    const r = runDecay([old1, old2, fresh], [{ itemId: 'new', kind: 'create' }], T0 + DAY_MS)
    expect(r.scores.get('new')).toBeCloseTo(0.5)
    // the neighbour at distance 0 gets the whole "near" bump
    expect(r.bumps.get('near')).toBeCloseTo(BUMP.near)
    expect(r.scores.get('near')).toBeCloseTo(2 + 1 - BUMP.near)
    // the one three radii away gets a tenth of it
    expect(r.bumps.get('far')).toBeCloseTo(BUMP.near / 10)
  })

  it('moving next to something newer earns a medium bump', () => {
    const mover = item('mover', { createdAt: T0 - 10 * DAY_MS, cx: 0 })
    const newer = item('newer', { createdAt: T0 - DAY_MS, cx: 50 })
    const r = runDecay([mover, newer], [{ itemId: 'mover', kind: 'move' }], T0 + DAY_MS)
    const w = 1 / (1 + (50 / PROXIMITY_R0) ** 2)
    expect(r.bumps.get('mover')).toBeCloseTo(BUMP.move + BUMP.near * w)
    // and the newer neighbour catches the spread of the move
    expect(r.bumps.get('newer')).toBeCloseTo(BUMP.move * w)
  })

  it('an edit on a thing freshens the comments sitting on it, and the reverse', () => {
    const post = item('post', { score: 2.5, cx: 0 })
    const comment = item('comment', { score: 2.5, cx: 120, createdAt: T0 - DAY_MS })
    const edited = runDecay([post, comment], [{ itemId: 'post', kind: 'edit' }], T0 + DAY_MS)
    expect(edited.bumps.get('comment')!).toBeGreaterThan(1)
    const replied = runDecay([post, comment], [{ itemId: 'comment', kind: 'edit' }], T0 + DAY_MS)
    expect(replied.bumps.get('post')!).toBeGreaterThan(1)
  })

  it('ignores events for items it was not given', () => {
    const r = runDecay([item('a')], [{ itemId: 'ghost', kind: 'edit' }], T0 + DAY_MS)
    expect(r.scores.get('a')).toBeCloseTo(1)
  })
})

describe('freshness', () => {
  it('provisional age counts time and subtracts pending bumps', () => {
    const meta = { score: 1, scoredAt: T0, pending: 0.5 }
    expect(provisionalAge(meta, T0 + DAY_MS)).toBeCloseTo(1.5)
    expect(provisionalAge({ ...meta, pending: 10 }, T0 + DAY_MS)).toBeCloseTo(0)
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
