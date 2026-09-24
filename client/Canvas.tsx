import { Quickdraw, useQuickdrawStore, type Editor, type GridId, type ThemeId } from '@quickdrawjs/react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Peer } from '../shared/protocol'
import type { ItemMeta, Me, Profile } from '../shared/types'
import { api } from './api'
import { AttributionOverlay } from './AttributionOverlay'
import { BoardHeader } from './BoardHeader'
import { Cursors } from './Cursors'
import { installFreshness, type FreshnessState, type LayerView } from './freshness'
import { installLinkify } from './linkify'
import type { People } from './people'
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

  // The room's bookkeeping, read by the render hooks on every frame.
  const fresh = useRef<FreshnessState>({ metas: new Map<string, ItemMeta>(), viewerId: me?.id ?? null, view: 'all', showHidden: false })

  const initialView = useMemo(() => parseView(window.location.hash), [])
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

  useEffect(() => lookup(peers.map((p) => p.userId)), [peers, lookup])

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
        if (!applyView(ed, initialView)) {
          setNotice('That item is no longer on this desktop')
          if (store.shapes().length) ed.fitContent({ maxZoom: 1 })
        }
      } else if (store.shapes().length) ed.fitContent({ maxZoom: 1 })
    },
    [initialView, store]
  )

  useEffect(() => {
    const sync = new BoardSync(store, socketUrl(handle), {
      canEdit: !!me,
      layer: () => layerRef.current(),
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
  }, [store, me, handle, frame, lookup])

  const onMount = useCallback(
    (ed: Editor) => {
      editorRef.current = ed
      setEditor(ed)
      if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = ed

      if (syncRef.current?.isReady) frame(ed)
      mirrorViewToHash(ed)

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

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const ed = editorRef.current
    if (!ed || !me) return
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

  if (profile === 'missing') {
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
      {editor && <Cursors editor={editor} peers={peers} people={people} />}
      {editor && <AttributionOverlay editor={editor} people={people} metas={fresh.current.metas} meId={me?.id ?? null} />}
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
      <TopBar me={me} onMeChange={onMeChange} onSignOut={onSignOut} editor={editor} status={status} peers={peers} people={people} />
      {notice && <div className="Notice">{notice}</div>}
    </div>
  )
}
