export interface Me {
  id: string
  email: string
  handle: string | null
  name: string | null
  /** Upload URL of a small square photo, or null for initials. */
  avatar: string | null
  bio: string | null
  isAdmin: boolean
}

/** The public face of a person: enough to label a cursor, a layer, a shape. */
export interface Person {
  id: string
  handle: string | null
  name: string | null
  avatar: string | null
  bio?: string | null
}

export interface Profile extends Person {
  followers: number
  following: number
  /** Only when signed in. */
  isFollowing?: boolean
  followsYou?: boolean
  liveItems: number
  lastActivityAt: number | null
}

export interface UserSummary extends Person {
  email: string
  isAdmin: boolean
  createdAt: number
  lastLoginAt: number | null
}

/**
 * What the board knows about an item beyond its Quickdraw record. Lives next
 * to the record on the server (never inside it) and is stamped by the room,
 * so nobody can forge who made a thing or how fresh it is.
 */
export interface ItemMeta {
  /** The layer (a user id: the owner's for the desktop itself, a visitor's for their additions). */
  layer: string
  /** Who made it. */
  by: string
  at: number
  editedBy: string
  editedAt: number
  /** Age in days at `scoredAt`, as the last daily pass left it. */
  score: number
  scoredAt: number
  /** Direct bumps earned since then (capped); the provisional age subtracts these. */
  pending: number
  /** Warmth from new things placed nearby since then (capped); also subtracted. */
  warmed: number
  /** Kept things do not age ("Keep" in the UI). Set by the owner or the author. */
  pinned: boolean
}

export interface FeedItem {
  id: string
  boardId: string
  meta: ItemMeta
  /** Provisional age in days when the feed was built. */
  age: number
  /** The Quickdraw record, for a thumbnail. Absent when it is too big to ship. */
  record?: unknown
  /** The image asset an image shape points at. */
  asset?: unknown
}

/** Where a visible thing sits on a desktop, and what it says if it is text: enough to cluster by. */
export interface PlacedItem {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** A short text (or label), with a size rank, so a cluster can be captioned. */
  text?: string
  weight?: number
  /** Quickdraw's group, when the thing is in one: members cluster together however far apart. */
  group?: string
}

export interface BoardActivity {
  recent: FeedItem[]
  vanishing: FeedItem[]
  placed: PlacedItem[]
}

export interface Feed {
  recent: FeedItem[]
  vanishing: FeedItem[]
  /** Every visible thing on each desktop in the feed, by desktop, for clustering. */
  placed: Record<string, PlacedItem[]>
  people: Person[]
}

/** Things on one desktop that touch each other travel as one: a highlight with its words, a caption with its picture. */
export interface EveryoneGroup {
  boardId: string
  /** Newest edit among the members. */
  editedAt: number
  /** The freshest member's provisional age in days. */
  age: number
  /** Members that can be drawn (their records travel), newest first. */
  items: FeedItem[]
}

/** The public room: the newest things on every desktop, and how big the place is. */
export interface Everyone {
  groups: EveryoneGroup[]
  people: Person[]
  counts: {
    /** Desktops that exist (people who finished signing up). */
    desktops: number
    /** Desktops touched in the last week. */
    active: number
    /** Things visible on all of them right now. */
    things: number
  }
  builtAt: number
}

/** A personal access token as listed: never the secret itself, only its first characters. */
export interface ApiToken {
  id: string
  label: string
  prefix: string
  createdAt: number
  lastUsedAt: number | null
}

export interface ApiError {
  error: string
}

/** One earlier state of an item, kept before each sitting of edits. Newest first from the API. */
export interface Revision {
  seq: number
  at: number
  by: string
  kind: 'edit'
  /** The Quickdraw record as it stood just before that sitting of edits. */
  record: unknown
}

/** Who has been looking at a desktop. Only its owner (or an admin) may see this. */
export interface DesktopStats {
  liveNow: number
  today: { views: number; people: number }
  week: { views: number; people: number }
  allTime: number
}
