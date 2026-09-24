// Type declarations for @quickdrawjs/core.
// The engine itself is dependency-free ESM JavaScript; these types describe
// its public API.

export type ToolId =
  | 'select' | 'hand' | 'draw' | 'highlight' | 'eraser' | 'laser'
  | 'arrow' | 'line' | 'geo' | 'text' | 'note'

export type ColorId =
  | 'black' | 'grey' | 'light-violet' | 'violet' | 'blue' | 'light-blue'
  | 'yellow' | 'orange' | 'green' | 'light-green' | 'light-red' | 'red'

export type SizeId = 's' | 'm' | 'l' | 'xl'
export type DashId = 'draw' | 'solid' | 'dashed' | 'dotted'
export type FillId = 'none' | 'semi' | 'solid' | 'pattern'
export type FontId = 'draw' | 'sans' | 'serif' | 'mono'
export type TextAlignId = 'start' | 'middle' | 'end'
export type GeoId = 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'cloud'
export type ThemeId = 'light' | 'dark'
export type GridId = 'none' | 'lines' | 'ruled' | 'dots' | 'crosses' | 'iso'

export interface Bounds { x: number; y: number; w: number; h: number }
export interface Camera { x: number; y: number; z: number }

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'
/** What a dragged toolbar item drops as: a tool name or a specific geo kind. */
export type DropKind = 'text' | 'note' | 'arrow' | 'line' | 'geo' | GeoId

/**
 * An image's crop window, as fractions of the source picture (0–1).
 * Absent on an image shape means the whole picture.
 */
export interface CropRect { x: number; y: number; w: number; h: number }

/**
 * One end of an arrow or line tied to a shape: the shape's id and the anchor
 * it points at, as fractions of the shape's box. Lives on the arrow's props
 * as `startBind` / `endBind`; the end itself is re-solved onto the shape's
 * outline whenever the shape changes.
 */
export interface ArrowBinding { id: string; nx: number; ny: number }

/** Payload of the 'contextmenu' event: where (screen + page) and what was under the pointer. */
export interface ContextMenuEvent {
  x: number
  y: number
  page: { x: number; y: number }
  hit: ShapeRecord | null
}

export interface Styles {
  color: ColorId
  size: SizeId
  dash: DashId
  fill: FillId
  font: FontId
  /** Text shapes only. */
  align: TextAlignId
}

export type ShapeType =
  | 'draw' | 'highlight' | 'geo' | 'arrow' | 'line' | 'text' | 'note' | 'image'

/**
 * A run of marked text: character offsets [from, to) in the shape's text
 * with any of bold, italic, underline, strike, code, highlight, or a link.
 * Text and notes carry them as `props.marks`, geo labels as `props.labelMarks`.
 */
export interface TextMark {
  from: number
  to: number
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  code?: boolean
  hl?: boolean
  href?: string
}

/** A shape record. `props` vary by `type`; records are treated as immutable. */
export interface ShapeRecord {
  id: string
  typeName: 'shape'
  type: ShapeType
  x: number
  y: number
  rot: number
  z: number
  /** Members of a group share an id; there is no group record. */
  groupId?: string
  props: Record<string, any>
}

/** An image asset record (dataURL source shared by image shapes). */
export interface AssetRecord {
  id: string
  typeName: 'asset'
  src: string
  w: number
  h: number
}

export type BoardRecord = ShapeRecord | AssetRecord

/**
 * A diff between two document states. This is the wire format: sync relays,
 * op logs and undo history all speak it.
 */
export interface Diff {
  added: Record<string, BoardRecord>
  removed: Record<string, BoardRecord>
  updated: Record<string, [BoardRecord, BoardRecord]>
}

export type DiffSource = 'user' | 'remote'

/** Serialized document: `{ document: { store: { [id]: record } } }`. */
export interface Snapshot {
  document: { store: Record<string, BoardRecord> }
}

export interface Theme {
  id: ThemeId
  background: string
  colors: Record<ColorId, { stroke: string; fill: string; note: string }>
  noteText: string
  selection: string
  selectionFill: string
  handleFill: string
  scribble: string
  grid: {
    line: { minor: string; major: string }
    dot: { minor: string; major: string }
  }
}

export interface ScribbleStroke {
  points: Array<{ x: number; y: number }>
  opacity?: number
}

export const TOOLS: ToolId[]
export const ALIGN_MODES: AlignMode[]
export const COLOR_IDS: ColorId[]
export const SIZE_IDS: SizeId[]
export const DASH_IDS: DashId[]
export const FILL_IDS: FillId[]
export const GEO_IDS: GeoId[]
export const GRID_IDS: GridId[]
export const FONT_IDS: FontId[]
export const ALIGN_IDS: TextAlignId[]
export const THEMES: Record<ThemeId, Theme>
export const SIZES: Record<SizeId, number>
export const FONT_SIZES: Record<SizeId, number>
export const FONTS: Record<FontId, string>

export function themeOf(id?: string): Theme
export function newId(prefix?: string): string
export function isDiffEmpty(d: Diff | null | undefined): boolean
export function invertDiff(d: Diff): Diff
export function composeDiff(a: Diff, b: Diff): Diff

/** Local (unrotated, origin-relative) bounds of a shape. */
export function localBounds(shape: ShapeRecord): Bounds
/** Axis-aligned page bounds of a shape, rotation included. */
export function pageBounds(shape: ShapeRecord): Bounds
/** The runs covering [from, to) of a text: [start, end, style]; unmarked stretches get an empty style. */
export function runsIn(marks: TextMark[] | undefined, from: number, to: number): Array<[number, number, Partial<TextMark>]>
/** Carry marks across an edit of their text (positions before stay, after shift, inside collapse; empty runs go). */
export function mapMarks(marks: TextMark[] | undefined, oldText: string, newText: string): TextMark[] | undefined
/** The style at a text position, {} when plain. */
export function markAt(marks: TextMark[] | undefined, pos: number): Partial<TextMark>
/** Does every character of [from, to) carry the key? */
export function hasMark(marks: TextMark[] | undefined, from: number, to: number, key: keyof TextMark): boolean
/** [from, to) with the key set (to `value`) or cleared; runs are split at the edges. */
export function setMark(marks: TextMark[] | undefined, from: number, to: number, key: keyof TextMark, on: boolean, value?: boolean | string): TextMark[]
/** Sorted, non-overlapping runs with adjacent equal ones merged. */
export function normalizeMarks(marks: TextMark[] | undefined): TextMark[]
/** What's under a shape-local point in a text block: the nearest caret `offset` and the character `index` the point is over (-1 past the end). */
export function textHitAt(shape: ShapeRecord, lx: number, ly: number): { offset: number; index: number } | null
/** The caret offset a click at a shape-local point lands at, or null. */
export function textOffsetAt(shape: ShapeRecord, lx: number, ly: number): number | null
/** The link under a shape-local point on a text, note, or geo label, or null. */
export function textLinkAt(shape: ShapeRecord, lx: number, ly: number): string | null
/** The link badge a shape with `props.url` wears (local centre and radius), or null. */
export function urlBadgeAt(shape: ShapeRecord): { x: number; y: number; r: number } | null
/**
 * The text surface: a contenteditable that shows marks as they're applied,
 * wearing a textarea's API. The editor mounts one while text is edited
 * (`editor.editing.textarea`); custom UIs can drive it the same way.
 */
export class TextSurface {
  constructor(opts?: { hlColor?: string })
  readonly el: HTMLDivElement
  value: string
  readonly marks: TextMark[]
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly style: CSSStyleDeclaration
  /** Draw text and marks into the DOM (keeping the selection, or setting `sel`). */
  render(text: string, marks: TextMark[] | undefined, sel?: [number, number]): void
  /** Text and marks read back from the DOM as it is now. */
  read(): { text: string; marks: TextMark[] }
  setSelectionRange(start: number, end?: number): void
  select(): void
  focus(): void
  remove(): void
  /** Replace the selection with text, the marks around it carrying on. */
  insertText(text: string): void
  addEventListener(type: string, fn: (e: Event) => void, opts?: any): void
  removeEventListener(type: string, fn: (e: Event) => void, opts?: any): void
  dispatchEvent(e: Event): boolean
  getBoundingClientRect(): DOMRect
}

/** Text as the board keeps it: Unix newlines, tabs as four spaces. */
export function normalizeText(text: string): string
/** Follow a link from the board: a new tab, http(s) and mailto only. */
export function openUrl(href: string): void
/** The full source picture of an image shape, laid out in the shape's local frame (crop undone). */
export function imageFrame(shape: ShapeRecord): Bounds
/** Render one shape into a 2d context already transformed to page space. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeRecord,
  opts: {
    theme: Theme
    store: Store
    zoom?: number
    ghost?: boolean
    /** Crop mode: draw the whole picture faintly around the crop window. */
    cropPreview?: boolean
    onAssetLoad?: () => void
  }
): void
/** Point hit-test in page space. */
export function hitShape(shape: ShapeRecord, px: number, py: number, tol: number, store: Store): boolean

/** What tldraw puts on the clipboard: its records, as it serializes them. */
export interface TldrawContent {
  shapes: any[]
  bindings?: any[]
  assets?: any[]
  rootShapeIds?: string[]
  schema?: any
}
/** tldraw's content from the HTML (or text) it put on the clipboard, or null when it isn't tldraw's. */
export function parseTldrawClipboard(text: string): TldrawContent | null
/** tldraw's rich text → our text plus marks. */
export function richTextToText(richText: unknown): { text: string; marks: TextMark[] }
/** tldraw content → our records (still carrying tldraw's ids) and image assets. */
export function convertTldrawContent(content: TldrawContent): { shapes: ShapeRecord[]; assets: AssetRecord[] }
/** tldraw's base64 stroke path → flat [x, y, pressure, ...] triplets. */
export function decodeDrawPath(b64: string, dim?: 2 | 3): number[]
/** Plain text out of tldraw's rich text (TipTap JSON), or a legacy string. */
export function richTextToPlain(richText: unknown): string
/** lz-string's decompressFromBase64, ported (tldraw compresses its clipboard with it). */
export function decompressFromBase64(input: string): string | null

/** Shape types an arrow end can tie to. */
export const BINDABLE: Set<ShapeType>
/** Page point → anchor in the shape's box; points near the middle snap to the centre unless `precise`. */
export function anchorAt(shape: ShapeRecord, px: number, py: number, opts?: { precise?: boolean }): { nx: number; ny: number }
/** The anchor back on the page. */
export function anchorPoint(shape: ShapeRecord, nx: number, ny: number): { x: number; y: number }
/** The shape's outline as a page-space polygon, flat [x, y, ...]. */
export function outlinePolygon(shape: ShapeRecord): number[]
/** Where an arrow's bindings put its ends (null when nothing is bound). */
export function boundTerminals(arrow: ShapeRecord, store: Store): { start: { x: number; y: number }; end: { x: number; y: number } } | null
/** The arrow re-solved against the store (same record when nothing changes). */
export function rebindArrow(arrow: ShapeRecord, store: Store): ShapeRecord

/** One shape as an SVG `<g>` string. `defs` collects shared definitions (patterns, filters, clips) by id. */
export function shapeToSvg(shape: ShapeRecord, opts: { theme: Theme; store: Store; defs: Map<string, string> }): string
/** A drawn-order list of shapes as a complete SVG document string (null when empty). */
export function sceneToSvg(
  shapes: ShapeRecord[],
  opts: { theme: Theme; store: Store; grid?: GridId; background?: boolean; margin?: number }
): string | null

/**
 * Turn a raw pointer trail ([x, y, pressure, ...] triplets) into a filled
 * outline polygon ([x, y, ...]) whose width breathes with pressure.
 */
export function strokeOutline(
  pts: number[],
  opts?: { size?: number; thinning?: number; streamline?: number; simulate?: boolean; taper?: boolean }
): number[]

/**
 * The document store. Every mutation happens inside a transaction; one diff
 * is emitted per outermost transaction. History batches gestures so a whole
 * stroke or drag undoes as one step.
 */
export class Store {
  records: Map<string, BoardRecord>
  undos: Diff[]
  redos: Diff[]

  get(id: string): BoardRecord | undefined
  has(id: string): boolean
  ids(): string[]
  all(): BoardRecord[]
  shapes(): ShapeRecord[]
  asset(id: string): AssetRecord | null
  readonly size: number

  /** Subscribe to changes; returns an unsubscribe function. */
  listen(fn: (diff: Diff, source: DiffSource) => void, opts?: { source?: DiffSource | 'all' }): () => void

  /**
   * Subscribe to undo/redo availability changes (fires when canUndo/canRedo
   * may have changed, including at the end of a gesture batch, which emits no
   * document diff of its own).
   */
  listenHistory(fn: () => void): () => void

  transact(fn: () => void, source?: DiffSource): void
  put(rec: BoardRecord, source?: DiffSource): void
  update(id: string, patch: Partial<BoardRecord> & { props?: Record<string, any> }, source?: DiffSource): void
  remove(ids: string[], source?: DiffSource): void
  /** Apply a diff produced elsewhere (a peer, an op log). */
  applyDiff(diff: Diff, source?: DiffSource): void
  /**
   * Register a reactor: runs inside every local transaction, after its body
   * and before it commits, and may write more records into it (derived state
   * lands in the same diff and undo step). Runs until a pass writes nothing.
   */
  react(fn: (diff: Diff) => void): () => void

  beginBatch(): void
  endBatch(): void
  readonly canUndo: boolean
  readonly canRedo: boolean
  undo(): void
  redo(): void

  getSnapshot(): Snapshot
  loadSnapshot(snap: Snapshot, source?: DiffSource): void
  clear(source?: DiffSource): void
  maxZ(): number
  minZ(): number
}

export interface EditorOptions {
  container: HTMLElement
  store?: Store
  theme?: ThemeId | string
  grid?: GridId
  readonly?: boolean
  camera?: Camera
  styles?: Partial<Styles>
  geoKind?: GeoId
}

export type EditorEvent =
  | 'change' | 'history' | 'camera' | 'tool' | 'styles' | 'selection'
  | 'theme' | 'grid' | 'edit' | 'scribbles' | 'penmode' | 'help'
  | 'crop' | 'contextmenu'

/**
 * The editor: camera, tools, selection, input and rendering over a Store.
 * Framework-free — attach it to any element.
 */
export class Editor {
  constructor(opts: EditorOptions)

  container: HTMLElement
  canvas: HTMLCanvasElement
  overlay: HTMLCanvasElement
  store: Store
  theme: Theme
  grid: GridId
  readonly: boolean
  camera: Camera
  styles: Styles
  geoKind: GeoId
  tool: ToolId
  selection: Set<string>
  penMode: boolean
  /** The group a double-click dived into (its members select one at a time), or null. */
  focusedGroup: string | null
  /** The image in crop mode, or null. */
  cropping: { id: string } | null
  /** While an arrow end is being dragged: the id of the shape it would tie to, or null. */
  bindHover: string | null
  /** Host hook: a shape this returns false for is not drawn, hit, selected, fitted or exported. */
  shapeFilter: ((shape: ShapeRecord) => boolean) | null
  /** Host hook: how opaque a shape draws on screen (0..1). */
  shapeAlpha: ((shape: ShapeRecord) => number) | null
  /** Host hook: a shape this returns true for cannot be picked up by the pointer (it still draws, its links open, the eraser reaches it). */
  shapeLocked: ((shape: ShapeRecord) => boolean) | null

  on(ev: 'contextmenu', fn: (e: ContextMenuEvent) => void): () => void
  on(ev: EditorEvent, fn: (...args: any[]) => void): () => void
  emit(ev: EditorEvent, ...args: any[]): void

  // camera
  viewSize(): { w: number; h: number }
  screenToPage(sx: number, sy: number): { x: number; y: number }
  pageToScreen(px: number, py: number): { x: number; y: number }
  viewportPageBounds(): Bounds
  setCamera(cam: Camera, opts?: { animate?: number }): void
  pan(dxScreen: number, dyScreen: number): void
  zoomAt(sx: number, sy: number, mult: number, opts?: { animate?: number }): void
  contentBounds(): Bounds | null
  fitContent(opts?: { margin?: number; maxZoom?: number; animate?: number; ease?: number }): void
  followBounds(b: Bounds, opts?: { animate?: number; ease?: number }): void
  /** Back to 1:1 about the middle of the view (⇧0). */
  resetZoom(opts?: { animate?: number }): void

  // tools / styles
  setTool(tool: ToolId): void
  setGeoKind(kind: GeoId): void
  setTheme(id: ThemeId | string): void
  /** 'none' | 'lines' | 'ruled' | 'dots' | 'crosses' | 'iso' — the backdrop behind the drawing. */
  setGrid(id: GridId): void
  setReadonly(ro: boolean): void
  setPenMode(on: boolean): void
  setStyle<K extends keyof Styles>(key: K, value: Styles[K]): void
  currentStyles(): Partial<Record<keyof Styles, string | null>>

  // selection
  setSelection(ids: string[]): void
  selectionBounds(): Bounds | null
  deleteSelection(): void
  /** Empty the board in one undoable step (⇧⌘⌫). */
  clearBoard(): void
  selectAll(): void
  duplicateSelection(offset?: number): void
  /** Open the text surface on a text, note, or geo (label) shape. */
  editShapeText(id: string): void
  /** While editing: the style at the caret (or across the selection), pending toggles included. */
  editingStyle(): Record<string, boolean | string> | null
  /** While editing: toggle a mark over the selection, or for what's typed next (⌘B / ⌘I / ⌘U / ⇧⌘X / ⌘E / ⇧⌘H). */
  toggleMark(key: 'b' | 'i' | 'u' | 's' | 'code' | 'hl'): void
  /** While editing: link the selection (or the word at the caret); empty unlinks. */
  setLink(href: string): void
  /** While editing: ask for a link with the browser's prompt (⌘K). */
  promptLink(): void
  shapesSorted(): ShapeRecord[]
  hitTest(px: number, py: number, opts?: { inside?: boolean; unlocked?: boolean }): ShapeRecord | null

  // z order — the selection moves as a block, relative order kept
  bringToFront(): void
  sendToBack(): void
  /** One step up past the nearest unselected neighbour. */
  bringForward(): void
  /** One step down past the nearest unselected neighbour. */
  sendBackward(): void

  // align / distribute — each group counts as one unit, bounds are page-space
  alignSelection(mode: AlignMode): void
  /** Even gaps between neighbours; needs three or more units. */
  distributeSelection(axis: DistributeAxis): void

  // groups — a shared `groupId` on the members, no container record
  /** Ids of every shape in a group. */
  groupMembers(groupId: string): string[]
  /** Group ids present in the selection. */
  selectionGroups(): string[]
  canGroup(): boolean
  canUngroup(): boolean
  /** Group the selection (⌘G). Groups are flat: grouping groups merges them. */
  groupSelection(): void
  /** Dissolve every group in the selection (⇧⌘G). */
  ungroupSelection(): void

  // image crop — one undo step for the whole crop session
  /** Enter crop mode on an image (double-click, Enter, or the context menu). */
  startCrop(id: string): void
  /** Leave crop mode, keeping the crop. */
  endCrop(): void
  /** Back to the whole picture, the window's centre staying put. */
  resetCrop(id?: string): void

  /** Drop a ready-made shape at a page point — what a tool dragged off the dock does. Returns the new id. */
  dropShape(kind: DropKind, at: { x: number; y: number }): string | null

  // laser scribbles (live pointer trails, not part of the document)
  setRemoteScribbles(list: ScribbleStroke[]): void
  getScribbles(): ScribbleStroke[]

  // clipboard / images
  copySelection(): Promise<void>
  /** Programmatic paste: images, tldraw's clipboard HTML, our own payload, or plain text (as a text shape). ⌘V uses the browser's paste event instead. */
  pasteFromClipboard(): Promise<void>
  /**
   * Put tldraw content (see `parseTldrawClipboard`) on the board: converted
   * to our shapes, centred in the view (or at `at`), selected. Remote image
   * assets are fetched into data URLs. Resolves with the new ids.
   */
  importTldraw(content: TldrawContent, opts?: { at?: { x: number; y: number } }): Promise<string[]>
  importImageBlobs(blobs: Blob[] | File[], at?: { x: number; y: number }): Promise<void>
  pickImage(): void

  /** Render the drawing to a PNG blob (null when the board is empty). */
  exportImage(opts?: { background?: boolean; scale?: number; margin?: number; ids?: Set<string> | null }): Promise<Blob | null>
  /** The drawing as an SVG document string — vectors all the way (null when empty). */
  exportSvg(opts?: { background?: boolean; margin?: number; ids?: Set<string> | null }): string | null

  // rendering
  requestRender(): void
  render(): void
  resize(): void
  renderScene(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    opts?: { dpr?: number; background?: boolean; hideEditing?: boolean }
  ): void
  /** Mirror clean board pixels into an extra canvas (for capture/recording). */
  setCaptureCanvas(canvas: HTMLCanvasElement | null): void
  renderCaptureTick(): void

  destroy(): void
}

/**
 * When the action bar (undo, redo, duplicate, delete) shows: 'touch' only
 * where the primary input is touch (the default — with a mouse and keyboard
 * every action is a key away), 'always', or 'never'.
 */
export type ActionBarMode = 'touch' | 'always' | 'never'

export interface BoardUI {
  setHidden(hidden: boolean): void
  /** Live-toggle the board menu's theme / grid switches. */
  setOptions(opts: { themeToggle?: boolean; gridControl?: boolean; minimap?: boolean; actions?: ActionBarMode }): void
  destroy(): void
}

export interface BuildUIOptions {
  hidden?: boolean
  /** Receives every export instead of the browser download: a PNG blob, or an SVG blob when `format` is 'svg'. */
  onSave?: (blob: Blob, background: boolean, format: 'png' | 'svg') => void
  /** Show the theme switch in the board menu (default true). */
  themeToggle?: boolean
  /** Show the grid switch in the board menu (default true). */
  gridControl?: boolean
  /** Show the minimap in the top-right corner (default true; hidden on narrow boards regardless). */
  minimap?: boolean
  /** When the action bar shows (default 'touch'). */
  actions?: ActionBarMode
}

/** Build the floating toolbar / style popovers / board menu for an editor. */
export function buildUI(editor: Editor, opts?: BuildUIOptions): BoardUI

/**
 * Append the corner "Quickdraw" mark to a board's container and return it.
 * `createQuickdraw` and the framework bindings call this for you.
 */
export function buildWatermark(editor: Editor): HTMLAnchorElement

export interface QuickdrawInstance {
  editor: Editor
  ui: BoardUI
  destroy(): void
}

export interface CreateQuickdrawOptions extends EditorOptions {
  hideUi?: boolean
  /** Receives every export instead of the browser download: a PNG blob, or an SVG blob when `format` is 'svg'. */
  onSave?: (blob: Blob, background: boolean, format: 'png' | 'svg') => void
  themeToggle?: boolean
  gridControl?: boolean
  /** Show the minimap (default true). */
  minimap?: boolean
  /** When the action bar shows (default 'touch'). */
  actions?: ActionBarMode
  /**
   * Show the small "Quickdraw" mark in the board's corner (default true).
   * Keeping it is a free way to support the project.
   */
  watermark?: boolean
}

/** One call: editor + toolbar chrome in a container. */
export function createQuickdraw(opts: CreateQuickdrawOptions): QuickdrawInstance
