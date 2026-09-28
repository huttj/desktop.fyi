import { TOUCH } from '../shared/bounds'
import { DAY_MS } from '../shared/freshness'
import type { Everyone, EveryoneGroup, Feed, FeedItem, Person, PlacedItem, Profile } from '../shared/types'
import type { BoardDurableObject } from './BoardDurableObject'
import { Db, toPerson, type UserRow } from './db'

/** The views the API and the MCP tools both serve: a profile, the feed, the room. */

export const FEED_WINDOW_MS = 7 * DAY_MS
/** The public room: at most this many desktops are asked, this many clumps each, this many shown. */
const EVERYONE_MAX_BOARDS = 500
const EVERYONE_PER_BOARD = 200
const EVERYONE_GROUPS = 500

export function board(env: Env, ownerId: string) {
  const ns = env.BOARD as DurableObjectNamespace<BoardDurableObject>
  return ns.get(ns.idFromName(ownerId))
}

export async function profileOf(env: Env, target: UserRow, viewer: UserRow | null): Promise<Profile> {
  const d = new Db(env.DB)
  const [counts, summary, isFollowing, followsYou] = await Promise.all([
    d.followCounts(target.id),
    board(env, target.id).summary(),
    viewer ? d.isFollowing(viewer.id, target.id) : Promise.resolve(undefined),
    viewer ? d.isFollowing(target.id, viewer.id) : Promise.resolve(undefined),
  ])
  const profile: Profile = { ...toPerson(target), ...counts, liveItems: summary.liveItems, lastActivityAt: summary.lastActivityAt }
  if (viewer) {
    profile.isFollowing = isFollowing
    profile.followsYou = followsYou
  }
  return profile
}

/**
 * Fan out to the desktops you follow (and your own). Boards are the source of
 * truth for freshness, so nothing here is cached or indexed elsewhere.
 */
export async function buildFeed(env: Env, meId: string): Promise<Feed> {
  const d = new Db(env.DB)
  const following = await d.followingIds(meId)
  const since = Date.now() - FEED_WINDOW_MS
  const boards = [meId, ...following]
  const results = await Promise.all(
    boards.map(async (id) => {
      const stub = board(env, id)
      try {
        const [recent, vanishing, placed] = await Promise.all([stub.activity(since, 60), stub.vanishing(id === meId ? meId : null, 40), stub.placed()])
        return { id, recent, vanishing, placed }
      } catch (e) {
        console.warn('feed: board unavailable', id, e)
        return { id, recent: [] as FeedItem[], vanishing: [] as FeedItem[], placed: [] as PlacedItem[] }
      }
    })
  )
  const recent = results.flatMap((r) => r.recent).sort((a, b) => b.meta.editedAt - a.meta.editedAt).slice(0, 240)
  const vanishing = results.flatMap((r) => r.vanishing).sort((a, b) => b.age - a.age).slice(0, 120)
  const placed: Record<string, PlacedItem[]> = {}
  for (const r of results) if (r.placed.length) placed[r.id] = r.placed
  const ids = new Set<string>()
  for (const item of [...recent, ...vanishing]) {
    ids.add(item.boardId)
    ids.add(item.meta.by)
    ids.add(item.meta.layer)
    ids.add(item.meta.editedBy)
  }
  for (const id of following) ids.add(id)
  const people: Person[] = (await d.usersByIds([...ids])).map(toPerson)
  return { recent, vanishing, placed, people }
}

/** The newest things across every desktop, each with what it touches, and how big the place is. */
export async function buildEveryone(env: Env): Promise<Everyone> {
  const d = new Db(env.DB)
  const users = (await d.listUsers()).filter((u) => u.handle).slice(0, EVERYONE_MAX_BOARDS)
  const now = Date.now()
  const since = now - FEED_WINDOW_MS
  const results = await Promise.all(
    users.map(async (u) => {
      const stub = board(env, u.id)
      try {
        const [recent, summary] = await Promise.all([stub.recentGroups(since, EVERYONE_PER_BOARD, { reach: TOUCH }), stub.summary()])
        return { recent, summary }
      } catch (e) {
        console.warn('everyone: board unavailable', u.id, e)
        return { recent: [] as EveryoneGroup[], summary: { liveItems: 0, lastActivityAt: null as number | null } }
      }
    })
  )
  // only what the page can draw: the record itself travels, and big drawings do not
  const groups = results
    .flatMap((r) => r.recent)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.record) }))
    .filter((g) => g.items.length)
    .sort((a, b) => b.editedAt - a.editedAt)
    .slice(0, EVERYONE_GROUPS)
  const ids = new Set<string>()
  for (const g of groups) {
    ids.add(g.boardId)
    for (const i of g.items) ids.add(i.meta.by)
  }
  const people: Person[] = (await d.usersByIds([...ids])).map(toPerson)
  return {
    groups,
    people,
    counts: {
      desktops: users.length,
      active: results.filter((r) => r.summary.lastActivityAt !== null && r.summary.lastActivityAt >= since).length,
      things: results.reduce((n, r) => n + r.summary.liveItems, 0),
    },
    builtAt: now,
  }
}
