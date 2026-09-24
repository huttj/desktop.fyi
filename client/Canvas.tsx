import { Quickdraw, useQuickdrawStore, type Editor, type GridId, type ThemeId } from '@quickdrawjs/react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Peer } from '../shared/protocol'
import type { ItemMeta, Me, Profile } from '../shared/types'
import { api } from './api'
import { AttributionOverlay } from './AttributionOverlay'
import { BoardHeader } from './BoardHeader'
import { Cursors } from './Cursors'
import { FeedPanel } from './FeedPanel'
import { SelectionActions } from './SelectionActions'
import { AdminDialog } from './AdminDialog'
import { ProfileDialog } from './ProfileDialog'
import { StatsDialog } from './StatsDialog'
import { Viewports } from './Viewports'
import { installFreshness, type FreshnessState, type LayerView } from './freshness'
import { installLinkify } from './linkify'
import { nameOf, type People } from './people'
import { BoardSync, type SyncStatus } from './sync'
import { TopBar } from './TopBar'
import { applyView, mirrorViewToHash, parseView } from './viewLink'

const GRIDS: GridId[] = ['none', 'lines', 'ruled', 'dots', 'crosses', 'iso']

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

function socketUrl(handle: string) {
  return `${window.location.origin.replace(/^http/, 'ws')}/api/connect/${encodeURIComponent(handle)}`
}

/**
 * One desktop. `me` is null for anonymous viewers: they can look around but
 * the room refuses their edits. Signed-in visitors add to their own layer.
 */
export type Dialog = 'stats' | 'profile' | 'people'

export function Canvas({ handle, me, onMeChange, onSignOut }: { handle: string; me: Me | null; onMeChange?: (me: Me) => void; onSignOut: () => void }) {
  const store = useQuickdrawStore()
  const editorRef = useRef<Editor | null>(null)
  const syncRef = useRef<BoardSync | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [theme, setTheme] = useState<ThemeId>(() =>
    readPref('dfyi:theme', ['light', 'dark'], window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  const [grid, setGrid] = useState<GridId>(() => readPref('dfyi:grid', GRIDS, 'dots'))
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [peers, setPeers] = useState<Peer[]>([])
  const [people, setPeople] = useState<People>(() => new Map())
  const [profile, setProfile] = useState<Profile | null | 'missing'>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const [view, setViewState] = useState<LayerView>('all')
  const [showHidden, setShowHiddenState] = useState(false)
  const [metaVersion, setMetaVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [feedOpen, setFeedOpen] = useState(() => !!me && window.location.hash === '#feed')
  const [dialog, setDialog] = useState<Dialog | null>(() => {
    if (!me) return null
    const h = window.location.hash
    return h === '#profile' ? 'profile' : h === '#people' && me.isAdmin ? 'people' : h === '#stats' ? 'stats' : null
  })
  /** The window whose view my camera is tracking, until I move it myself. */
  const [watching, setWatching] = useState<string | null>(null)

  // The room's bookkeeping, read by the render hooks on every frame.
  const fresh = useRef<FreshnessState>({ metas: new Map<string, ItemMeta>(), viewerId: me?.id ?? null, view: 'all', showHidden: false })

  const initialView = useMemo(() => parseView(window.location.hash), [])

  // Opening the feed from another page lands on "#feed"; the camera hash takes over from there.
  useEffect(() => {
    if (/^#(feed|profile|people|stats)$/.test(window.location.hash)) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  const framed = useRef(false)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    api
      .profile(handle)
      .then(setProfile)
      .catch(() => setProfile('missing'))
  }, [handle, me?.id])

  // People are looked up by id as they appear: authors, layers, peers.
  const lookedUp = useRef(new Set<string>())
  const lookup = useCallback((ids: Iterable<string>) => {
    const unknown = [...new Set(ids)].filter((id) => id && !lookedUp.current.has(id))
    if (!unknown.length) return
    for (const id of unknown) lookedUp.current.add(id)
    api
      .people(unknown)
      .then((list) =>
        setPeople((prev) => {
          const next = new Map(prev)
          for (const p of list) next.set(p.id, p)
          return next
        })
      )
      .catch(() => {
        for (const id of unknown) lookedUp.current.delete(id)
      })
  }, [])

  useEffect(() => {
    if (me) {
      lookedUp.current.add(me.id)
      setPeople((prev) => new Map(prev).set(me.id, { id: me.id, handle: me.handle, name: me.name, avatar: me.avatar }))
    }
  }, [me])

  useEffect(() => lookup(peers.map((p) => p.userId).filter((id): id is string => !!id)), [peers, lookup])

  useEffect(() => (me ? installLinkify(store) : undefined), [store, me])

  const setView = useCallback((v: LayerView) => {
    fresh.current.view = v
    setViewState(v)
    editorRef.current?.setSelection([])
    editorRef.current?.requestRender()
  }, [])

  const setShowHidden = useCallback((on: boolean) => {
    fresh.current.showHidden = on
    setShowHiddenState(on)
    editorRef.current?.requestRender()
  }, [])

  /** Where a change of mine lands: the desktop itself if it is mine and I am looking at it, else my own layer. */
  const layerFor = useCallback(() => {
    if (!me) return ''
    if (owner === me.id && view !== 'all' && view !== me.id) return view
    return me.id
  }, [me, owner, view])
  const layerRef = useRef(layerFor)
  layerRef.current = layerFor

  // Adding something while looking at someone else's layer would put it out of sight: widen the view.
  useEffect(() => {
    if (!me) return
    return store.listen(
      (diff) => {
        if (!Object.keys(diff.added).length) return
        const target = layerRef.current()
        if (fresh.current.view !== 'all' && fresh.current.view !== target) setView('all')
      },
      { source: 'user' }
    )
  }, [store, me, setView])

  const frame = useCallback(
    (ed: Editor) => {
      if (framed.current) return
      framed.current = true
      if (initialView) {
        if (!applyView(ed, initialView, { insetLeft: panelInset() })) {
          setNotice('That item is no longer on this desktop')
          if (store.shapes().length) ed.fitContent({ maxZoom: 1 })
        }
      } else if (store.shapes().length) ed.fitContent({ maxZoom: 1 })
    },
    [initialView, store]
  )

  const missing = profile === 'missing'
  useEffect(() => {
    if (missing) return
    const sync = new BoardSync(store, socketUrl(handle), {
      canEdit: !!me,
      layer: () => layerRef.current(),
      viewport: () => editorRef.current?.viewportPageBounds() ?? null,
      onStatus: setStatus,
      onPeers: setPeers,
      onLaser: (strokes) => editorRef.current?.setRemoteScribbles(strokes),
      onInit: (info) => setOwner(info.owner),
      onMetas: (metas, reset) => {
        const map = fresh.current.metas
        if (reset) map.clear()
        for (const [id, meta] of Object.entries(metas)) map.set(id, meta)
        lookup(Object.values(metas).flatMap((m) => [m.by, m.layer, m.editedBy]))
        setMetaVersion((v) => v + 1)
        editorRef.current?.requestRender()
      },
      onReady: (first) => {
        if (first && editorRef.current) frame(editorRef.current)
      },
      onRejected: setNotice,
    })
    syncRef.current = sync
    sync.connect()
    return () => {
      sync.close()
      syncRef.current = null
    }
  }, [store, me, handle, frame, lookup, missing])

  const onMount = useCallback(
    (ed: Editor) => {
      editorRef.current = ed
      setEditor(ed)
      if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = ed

      if (syncRef.current?.isReady) frame(ed)
      mirrorViewToHash(ed)
      ed.on('camera', () => syncRef.current?.sendViewport(ed.viewportPageBounds()))
      syncRef.current?.sendViewport(ed.viewportPageBounds())

      if (!me) {
        ed.setTool('hand')
        ed.on('tool', () => {
          if (ed.tool !== 'hand') ed.setTool('hand')
        })
        return
      }
      ed.on('scribbles', () => syncRef.current?.sendLaser(ed.getScribbles()))
    },
    [me, frame]
  )

  useEffect(() => (editor ? installFreshness(editor, fresh.current) : undefined), [editor])

  // Watching: my camera follows theirs as it moves; touching the board myself ends it.
  useEffect(() => {
    if (!editor || !watching) return
    const peer = peers.find((p) => p.sessionId === watching)
    if (!peer) return setWatching(null)
    if (peer.viewport) editor.followBounds(peer.viewport, { animate: 160 })
  }, [editor, watching, peers])
  useEffect(() => {
    if (!editor || !watching) return
    const stop = () => setWatching(null)
    // Any move of my own ends it: a press or scroll on the board, or a key that is not typed into a field.
    const onKey = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e as unknown as { key: string }).key === 'Escape') return // closes menus, not this
      stop()
    }
    const el = editor.container
    el.addEventListener('pointerdown', stop)
    el.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', stop)
      el.removeEventListener('wheel', stop)
      window.removeEventListener('keydown', onKey)
    }
  }, [editor, watching])
  const watchedPeer = watching ? peers.find((p) => p.sessionId === watching) : null
  const watchedName = watchedPeer ? (watchedPeer.userId ? (me && watchedPeer.userId === me.id ? 'your other window' : nameOf(people, watchedPeer.userId)) : 'a visitor') : null

  // A link to items on this very desktop (from the feed, say) only changes the hash: follow it.
  const feedOpenRef = useRef(feedOpen)
  feedOpenRef.current = feedOpen
  const panelInset = () => (feedOpenRef.current ? Math.min(400, window.innerWidth * 0.5) : 0)
  useEffect(() => {
    if (!editor) return
    const onHash = () => {
      const view = parseView(window.location.hash)
      if (!view || view.kind !== 'items') return
      if (!applyView(editor, view, { animate: 260, insetLeft: panelInset() })) setNotice('That item is no longer on this desktop')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [editor])

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const ed = editorRef.current
    if (!ed) return
    const r = ed.container.getBoundingClientRect()
    syncRef.current?.sendCursor(ed.screenToPage(e.clientX - r.left, e.clientY - r.top))
  }
  const onPointerLeave = () => syncRef.current?.sendCursor(null)

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  const guards = me
    ? {}
    : {
        onKeyDownCapture: (e: KeyboardEvent<HTMLDivElement>) => {
          const meta = e.metaKey || e.ctrlKey
          const zoom = (meta && ['=', '+', '-'].includes(e.key)) || (e.shiftKey && ['1', '!', '0', ')'].includes(e.key))
          if (!zoom) e.stopPropagation()
        },
        onPasteCapture: stop,
        onDropCapture: stop,
        onDragOverCapture: stop,
        onContextMenuCapture: stop,
      }

  if (missing) {
    return (
      <div className="Screen">
        <div className="Card">
          <h1 className="Wordmark">desktop.fyi</h1>
          <p>There is no desktop at @{handle}.</p>
          <a className="Button" href="/">
            {me ? 'Back to mine' : 'Home'}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="CanvasRoot" data-theme={theme} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} {...guards}>
      <Quickdraw
        store={store}
        theme={theme}
        grid={grid}
        styles={{ color: 'black' }}
        hideUi={!me}
        watermark={false}
        onMount={onMount}
        onThemeChange={(t) => {
          setTheme(t)
          writePref('dfyi:theme', t)
        }}
        onGridChange={(g) => {
          setGrid(g)
          writePref('dfyi:grid', g)
        }}
      />
      {editor && <Viewports editor={editor} peers={peers} people={people} meId={me?.id ?? null} />}
      {editor && <Cursors editor={editor} peers={peers} people={people} />}
      {editor && <AttributionOverlay editor={editor} people={people} metas={fresh.current.metas} meId={me?.id ?? null} />}
      {editor && me && <SelectionActions editor={editor} me={me} owner={owner} metas={fresh.current.metas} metaVersion={metaVersion} sync={syncRef.current} />}
      <BoardHeader
        handle={handle}
        me={me}
        owner={owner}
        profile={profile}
        onProfile={setProfile}
        people={people}
        metas={fresh.current.metas}
        metaVersion={metaVersion}
        view={view}
        onView={setView}
        showHidden={showHidden}
        onShowHidden={setShowHidden}
      />
      <TopBar me={me} onSignOut={onSignOut} editor={editor} status={status} peers={peers} people={people} feedOpen={feedOpen} onFeed={setFeedOpen} watching={watching} onWatch={setWatching} onOpen={setDialog} />
      {dialog === 'stats' && me && <StatsDialog me={me} onClose={() => setDialog(null)} />}
      {dialog === 'profile' && me && onMeChange && <ProfileDialog me={me} onMeChange={onMeChange} onSignOut={onSignOut} onClose={() => setDialog(null)} />}
      {dialog === 'people' && me?.isAdmin && <AdminDialog me={me} onClose={() => setDialog(null)} />}
      {watchedName && (
        <button type="button" className="Notice Notice--button" onClick={() => setWatching(null)} onPointerDown={(e) => e.stopPropagation()}>
          Watching {watchedName} · click to stop
        </button>
      )}
      {feedOpen && me && <FeedPanel me={me} theme={theme} onClose={() => setFeedOpen(false)} />}
      {notice && <div className="Notice">{notice}</div>}
    </div>
  )
}
