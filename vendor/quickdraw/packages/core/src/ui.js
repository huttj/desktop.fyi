// The board's chrome: a floating dock of tools, a styles popover, and the
// board menu — plain DOM, one implementation for every host framework.
// The dock is responsive: tools overflow into a "more" flyout as the frame
// narrows, and a very small frame folds the whole kit into one button.
// Icons follow the Lucide geometry (24px grid, 2px stroke) so they read as
// the standard set users already know.
// Dependency-free ESM (see palette.js).

import { COLOR_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, GEO_IDS, GRID_IDS, FONT_IDS, ALIGN_IDS, FONTS, THEMES } from './palette.js'
import { pageBounds } from './shapes.js'

const SVG = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

const ICONS = {
  select: SVG('<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>'),
  hand: SVG('<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
  draw: SVG('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  highlight: SVG('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4l8 8Z"/>'),
  eraser: SVG('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  // a pointer wand with sparks at the tip — the sun-burst read as brightness
  laser: SVG('<path d="m3 21 9-9"/><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h-2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/><path d="M12.2 6.2 11 5"/>'),
  line: SVG('<path d="M19 5 5 19"/>'),
  arrow: SVG('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'),
  text: SVG('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  note: SVG('<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>'),
  image: SVG('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  undo: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
  redo: SVG('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>'),
  menu: SVG('<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>'),
  // double chevron up (the flyout opens above the dock) — dots would read as
  // a second dot-menu next to the board menu's vertical dots
  more: SVG('<path d="m7 12.5 5-5 5 5"/><path d="m7 18.5 5-5 5 5"/>'),
  // geo kinds
  rectangle: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  ellipse: SVG('<circle cx="12" cy="12" r="9"/>'),
  triangle: SVG('<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/>'),
  diamond: SVG('<path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/>'),
  hexagon: SVG('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'),
  star: SVG('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  cloud: SVG(`<path d="M7 17h10a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 10a3.5 3.5 0 0 0 0 7z"/>`),
  // menu glyphs
  download: SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  transparent: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><rect x="4" y="4" width="8" height="8" fill="currentColor" fill-opacity=".22" stroke="none"/><rect x="12" y="12" width="8" height="8" fill="currentColor" fill-opacity=".22" stroke="none"/>'),
  vector: SVG('<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>'),
  map: SVG('<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'),
  minimize: SVG('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'),
  copy: SVG('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>'),
  fit: SVG('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  trash: SVG('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  check: SVG('<path d="M20 6 9 17l-5-5"/>'),
  chevronRight: SVG('<path d="m9 18 6-6-6-6"/>'),
  chevronLeft: SVG('<path d="m15 18-6-6 6-6"/>'),
  sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon: SVG('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  // context menu glyphs
  cut: SVG('<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>'),
  paste: SVG('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
  selectAll: SVG('<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>'),
  zoomReset: SVG('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>'),
  crop: SVG('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
  group: SVG('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect width="7" height="5" x="7" y="7" rx="1"/><rect width="7" height="5" x="10" y="12" rx="1"/>'),
  ungroup: SVG('<rect width="8" height="6" x="5" y="4" rx="1"/><rect width="8" height="6" x="11" y="14" rx="1"/>'),
  bringToFront: SVG('<rect x="8" y="8" width="8" height="8" rx="2"/><path d="M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2"/><path d="M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2"/>'),
  sendToBack: SVG('<rect x="14" y="14" width="8" height="8" rx="2"/><rect x="2" y="2" width="8" height="8" rx="2"/><path d="M7 14v1a2 2 0 0 0 2 2h1"/><path d="M14 7h1a2 2 0 0 1 2 2v1"/>'),
  bringForward: SVG('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
  sendBackward: SVG('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  alignLeft: SVG('<rect width="9" height="6" x="6" y="14" rx="2"/><rect width="16" height="6" x="6" y="4" rx="2"/><path d="M2 2v20"/>'),
  alignCenter: SVG('<path d="M12 2v20"/><path d="M10 10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/><path d="M14 10h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-6"/><path d="M10 20H7a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3"/><path d="M14 20h3a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-3"/>'),
  alignRight: SVG('<rect width="16" height="6" x="2" y="4" rx="2"/><rect width="9" height="6" x="9" y="14" rx="2"/><path d="M22 22V2"/>'),
  alignTop: SVG('<rect width="6" height="16" x="4" y="6" rx="2"/><rect width="6" height="9" x="14" y="6" rx="2"/><path d="M22 2H2"/>'),
  alignMiddle: SVG('<path d="M2 12h20"/><path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/><path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/><path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1"/><path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1"/>'),
  alignBottom: SVG('<rect width="6" height="16" x="4" y="2" rx="2"/><rect width="6" height="9" x="14" y="9" rx="2"/><path d="M22 22H2"/>'),
  distributeH: SVG('<rect width="6" height="10" x="9" y="7" rx="2"/><path d="M4 22V2"/><path d="M20 22V2"/>'),
  distributeV: SVG('<rect width="10" height="6" x="7" y="9" rx="2"/><path d="M22 20H2"/><path d="M22 4H2"/>'),
}
// the action bar wears the same glyphs the menu already uses
ICONS.duplicate = ICONS.copy
ICONS.delete = ICONS.trash

// grid backdrops: bare paper, ruled lines, dotted intersections
const GRID_ICONS = {
  none: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  lines: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke-width="1.4"/>'),
  ruled: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 8.5h18M3 13h18M3 17.5h18" stroke-width="1.4"/>'),
  dots: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" stroke-width="2.2"/>'),
  crosses: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 6.5v3M6.5 8h3M16 6.5v3M14.5 8h3M12 10.5v3M10.5 12h3M8 14.5v3M6.5 16h3M16 14.5v3M14.5 16h3" stroke-width="1.3"/>'),
  iso: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m3 7 10.4 14M8.6 3 19 17M21 7 10.6 21M15.4 3 5 17" stroke-width="1.2"/>'),
}
const GRID_TIPS = {
  none: 'No grid', lines: 'Grid lines', ruled: 'Ruled paper',
  dots: 'Grid dots', crosses: 'Crosses', iso: 'Isometric',
}
const GRID_LABELS = { none: 'None', lines: 'Lines', ruled: 'Ruled', dots: 'Dots', crosses: 'Crosses', iso: 'Isometric' }

const DASH_ICONS = {
  draw: SVG('<path d="M4 15c3.2-4.5 6-5.5 8-3.5s5 1.5 8-4.5"/>'),
  solid: SVG('<path d="M4 12h16"/>'),
  dashed: SVG('<path d="M4 12h3.2M10.4 12h3.2M16.8 12h3.2"/>'),
  dotted: SVG('<path d="M4.5 12h.01M9.5 12h.01M14.5 12h.01M19.5 12h.01" stroke-width="3"/>'),
}
// the type families, each shown in itself
const FONT_TIPS = { draw: 'Hand-drawn', sans: 'Sans', serif: 'Serif', mono: 'Mono' }
const ALIGN_ICONS = {
  start: SVG('<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>'),
  middle: SVG('<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>'),
  end: SVG('<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>'),
}
const ALIGN_TIPS = { start: 'Align text left', middle: 'Center text', end: 'Align text right' }
const FILL_ICONS = {
  none: SVG('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  semi: SVG('<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" fill-opacity="0.18"/>'),
  solid: SVG('<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" fill-opacity="0.45" stroke="none"/><rect x="5" y="5" width="14" height="14" rx="2"/>'),
  pattern: SVG('<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M6 15 15 6M9 18l9-9" stroke-width="1.3"/>'),
}

const TIPS = {
  select: 'Select — V', hand: 'Hand — H', draw: 'Draw — D', highlight: 'Highlight — I',
  eraser: 'Eraser — E', laser: 'Laser — K', line: 'Line — L', arrow: 'Arrow — A',
  geo: 'Shape — G', text: 'Text — T', note: 'Sticky note — N', image: 'Insert image',
  undo: 'Undo — ⌘Z', redo: 'Redo — ⇧⌘Z', menu: 'Board menu', more: 'More tools',
  tools: 'Tools', duplicate: 'Duplicate — ⌘D', delete: 'Delete — ⌫',
}

// dock buttons in visual order (styles/more/menu ride at the end, always)
const DOCK_NAMES = ['select', 'hand', 'draw', 'highlight', 'eraser', 'laser', 'line', 'arrow', 'geo', 'text', 'note', 'image']
// the tools you can pull off the dock and drop on the board as a shape
const DROP_KINDS = new Set(['line', 'arrow', 'geo', 'text', 'note', ...GEO_IDS])
// what gives way first as the frame narrows (select and draw never yield)
const DROP_ORDER = ['hand', 'laser', 'line', 'note', 'image', 'highlight', 'text', 'arrow', 'eraser', 'geo']

export function buildUI(editor, { hidden = false, onSave, themeToggle = true, gridControl = true, minimap = true } = {}) {
  const root = editor.container
  // menu switches the host can drop — an app that owns its own theme chrome
  // doesn't want a second control for it on the canvas
  const opts = { themeToggle: themeToggle !== false, gridControl: gridControl !== false, minimap: minimap !== false }
  const ui = el('div', 'qd-ui')
  root.appendChild(ui)

  let popover = null // { name, el }
  // the context menu's Esc listener lives on the document while it's open
  let ctxKey = null
  const closeContextKey = () => {
    if (ctxKey) { document.removeEventListener('keydown', ctxKey, true); ctxKey = null }
  }
  const closePopover = () => {
    if (popover) { popover.el.remove(); popover = null; closeContextKey(); refresh() }
  }
  const openPopover = (name, build, anchor) => {
    if (popover?.name === name) return closePopover()
    closePopover()
    const p = el('div', 'qd-popover')
    build(p)
    ui.appendChild(p)
    popover = { name, el: p }
    // keep it inside the frame, roughly above its anchor
    requestAnimationFrame(() => {
      const ar = anchor.getBoundingClientRect()
      const rr = root.getBoundingClientRect()
      const pw = p.offsetWidth
      let left = ar.left - rr.left + ar.width / 2 - pw / 2
      left = Math.max(8, Math.min(left, rr.width - pw - 8))
      p.style.left = left + 'px'
    })
    refresh()
  }

  // ---- actions -------------------------------------------------------------
  const run = (name, b) => {
    if (name === 'image') { closePopover(); return editor.pickImage() }
    if (name === 'geo') return geoTap(b)
    closePopover()
    editor.setTool(name)
  }
  // the shape button: every tap arms the current kind AND shows the kinds,
  // so picking a shape never takes a second hunt for the menu
  const geoTap = (b) => {
    editor.setTool('geo')
    openPopover('geo', (p) => {
      p.classList.add('qd-geo-pop')
      for (const g of GEO_IDS) {
        const gb = el('button', 'qd-tool' + (editor.geoKind === g ? ' on' : ''))
        gb.innerHTML = ICONS[g]
        gb.title = g
        gb.addEventListener('pointerdown', (ev) => ev.stopPropagation())
        gb.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (gb.dataset.dragged) { delete gb.dataset.dragged; return }
          editor.setGeoKind(g)
          editor.setTool('geo')
          closePopover()
        })
        makeDraggable(gb, g) // a kind can be pulled straight onto the board
        p.appendChild(gb)
      }
    }, b)
  }

  const makeBtn = (name, onClick, cls = 'qd-tool') => {
    const b = el('button', cls)
    b.dataset.name = name
    b.innerHTML = ICONS[name] || ''
    b.title = TIPS[name] || name
    b.addEventListener('pointerdown', (e) => e.stopPropagation())
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      // the click that closes a drag-and-drop is not a tap on the tool
      if (b.dataset.dragged) { delete b.dataset.dragged; return }
      onClick(e, b)
    })
    if (DROP_KINDS.has(name)) makeDraggable(b, name)
    return b
  }

  // ---- drag a tool onto the board -----------------------------------------
  // Press a shape tool and pull it onto the board: a ghost of its icon rides
  // the pointer and the shape lands where it's let go. A press that doesn't
  // travel is still a click.
  function makeDraggable(b, kind) {
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || editor.readonly) return
      delete b.dataset.dragged
      const start = { x: e.clientX, y: e.clientY, id: e.pointerId }
      let ghost = null
      const move = (ev) => {
        if (ev.pointerId !== start.id) return
        if (!ghost) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
          ghost = el('div', 'qd-drag-ghost')
          ghost.innerHTML = ICONS[kind === 'geo' ? editor.geoKind : kind] || ''
          ui.appendChild(ghost)
          b.dataset.dragged = '1'
          // the button may live in a popover: closing that would detach it
          // mid-drag and lose the pointer, so it only hides until the drop
          if (popover) popover.el.style.visibility = 'hidden'
        }
        const rr = root.getBoundingClientRect()
        ghost.style.left = ev.clientX - rr.left + 'px'
        ghost.style.top = ev.clientY - rr.top + 'px'
      }
      const up = (ev) => {
        if (ev.pointerId !== start.id) return
        b.removeEventListener('pointermove', move)
        b.removeEventListener('pointerup', up)
        b.removeEventListener('pointercancel', up)
        if (!ghost) return
        ghost.remove()
        closePopover()
        const rr = root.getBoundingClientRect()
        const sx = ev.clientX - rr.left, sy = ev.clientY - rr.top
        // let go over the chrome or off the board: a change of mind
        const under = document.elementFromPoint?.(ev.clientX, ev.clientY)
        const onBoard = ev.type === 'pointerup' &&
          sx >= 0 && sy >= 0 && sx <= rr.width && sy <= rr.height && !(under && ui.contains(under))
        if (onBoard) editor.dropShape(kind, editor.screenToPage(sx, sy))
        else delete b.dataset.dragged
      }
      // capture from the press: the pointer leaves the 32px button long
      // before the drag threshold is met
      try { b.setPointerCapture(start.id) } catch {}
      b.addEventListener('pointermove', move)
      b.addEventListener('pointerup', up)
      b.addEventListener('pointercancel', up)
    })
  }

  // ---- dock ----------------------------------------------------------------
  const dock = el('div', 'qd-dock')
  ui.appendChild(dock)

  const dockBtns = new Map()
  const dividers = []
  const addBtn = (name) => {
    const b = makeBtn(name, (e, b2) => run(name, b2))
    dock.appendChild(b)
    dockBtns.set(name, b)
    return b
  }
  const divider = () => { const d = el('i', 'qd-div'); dock.appendChild(d); dividers.push(d) }

  addBtn('select'); addBtn('hand')
  divider()
  addBtn('draw'); addBtn('highlight'); addBtn('eraser'); addBtn('laser')
  divider()
  addBtn('line'); addBtn('arrow')
  addBtn('geo').classList.add('qd-geo-btn')
  addBtn('text'); addBtn('note'); addBtn('image')
  divider()

  // folded mode: one button wearing the current tool's icon opens the kit
  const toolsBtn = makeBtn('tools', (e, b) => openPopover('tools', (p) => buildGrid(p, [...DOCK_NAMES]), b))
  dock.appendChild(toolsBtn)

  // styles button: a ring of the current color
  const styleBtn = makeBtn('styles', (e, b) => openPopover('styles', buildStyles, b))
  styleBtn.classList.add('qd-style-btn')
  styleBtn.title = 'Color & style'
  const styleDot = el('span', 'qd-style-dot')
  styleBtn.appendChild(styleDot)
  dock.appendChild(styleBtn)

  const moreBtn = makeBtn('more', (e, b) => openPopover('more', (p) => buildGrid(p, hiddenNames), b))
  dock.appendChild(moreBtn)

  const menuBtn = makeBtn('menu', (e, b) => openPopover('menu', buildMenu, b))
  dock.appendChild(menuBtn)

  // ---- action bar ----------------------------------------------------------
  // history + selection actions ride their own small pill so they stay one
  // tap away no matter how far the tool dock folds
  const actionBar = el('div', 'qd-actions')
  ui.appendChild(actionBar)
  const actBtns = new Map()
  const addAction = (name, fn) => {
    const b = makeBtn(name, fn)
    actionBar.appendChild(b)
    actBtns.set(name, b)
    return b
  }
  addAction('undo', () => editor.store.undo())
  addAction('redo', () => editor.store.redo())
  actionBar.appendChild(el('i', 'qd-div'))
  addAction('duplicate', () => editor.duplicateSelection())
  addAction('delete', () => editor.deleteSelection())

  // ---- overflow grid (compact "more" / folded "tools") ---------------------
  function buildGrid(p, names) {
    p.classList.add('qd-grid-pop')
    for (const name of names) {
      const isTool = name !== 'image'
      const b = makeBtn(name, (e, b2) => run(name, b2))
      if (name === 'geo') b.innerHTML = ICONS[editor.geoKind]
      if (isTool && editor.tool === name) b.classList.add('on')
      p.appendChild(b)
    }
  }

  // ---- styles popover ------------------------------------------------------
  const theme = () => THEMES[editor.theme.id]
  function buildStyles(p) {
    p.classList.add('qd-style-pop')
    const cur = editor.currentStyles()
    const row = (cls) => { const r = el('div', 'qd-row ' + cls); p.appendChild(r); return r }

    const colors = row('qd-colors')
    for (const c of COLOR_IDS) {
      const b = el('button', 'qd-dot' + (cur.color === c ? ' on' : ''))
      b.style.setProperty('--dot', theme().colors[c].stroke)
      b.title = c
      b.addEventListener('click', (e) => { e.stopPropagation(); editor.setStyle('color', c); restyle() })
      colors.appendChild(b)
    }
    const sizes = row('qd-sizes')
    SIZE_IDS.forEach((s, i) => {
      const b = el('button', 'qd-opt' + (cur.size === s ? ' on' : ''))
      b.title = 'Size ' + s.toUpperCase()
      b.innerHTML = `<span class="qd-size-pip" style="--pip:${4 + i * 3}px"></span>`
      b.addEventListener('click', (e) => { e.stopPropagation(); editor.setStyle('size', s); restyle() })
      sizes.appendChild(b)
    })
    const dashes = row('qd-dashes')
    for (const d of DASH_IDS) {
      const b = el('button', 'qd-opt' + (cur.dash === d ? ' on' : ''))
      b.title = d === 'draw' ? 'hand-drawn' : d
      b.innerHTML = DASH_ICONS[d]
      b.addEventListener('click', (e) => { e.stopPropagation(); editor.setStyle('dash', d); restyle() })
      dashes.appendChild(b)
    }
    const fills = row('qd-fills')
    for (const f of FILL_IDS) {
      const b = el('button', 'qd-opt' + (cur.fill === f ? ' on' : ''))
      b.title = 'fill: ' + f
      b.innerHTML = FILL_ICONS[f]
      b.addEventListener('click', (e) => { e.stopPropagation(); editor.setStyle('fill', f); restyle() })
      fills.appendChild(b)
    }
    const fonts = row('qd-fonts')
    for (const f of FONT_IDS) {
      const b = el('button', 'qd-opt qd-font' + (cur.font === f ? ' on' : ''))
      b.title = FONT_TIPS[f]
      b.textContent = 'Aa'
      b.style.fontFamily = FONTS[f]
      b.addEventListener('click', (e) => { e.stopPropagation(); editor.setStyle('font', f); restyle() })
      fonts.appendChild(b)
    }
    const aligns = row('qd-aligns')
    for (const a of ALIGN_IDS) {
      const b = el('button', 'qd-opt' + (cur.align === a ? ' on' : ''))
      b.title = ALIGN_TIPS[a]
      b.innerHTML = ALIGN_ICONS[a]
      b.addEventListener('click', (e) => { e.stopPropagation(); editor.setStyle('align', a); restyle() })
      aligns.appendChild(b)
    }
    function restyle() {
      const c2 = editor.currentStyles()
      colors.querySelectorAll('.qd-dot').forEach((b, i) => b.classList.toggle('on', COLOR_IDS[i] === c2.color))
      sizes.querySelectorAll('.qd-opt').forEach((b, i) => b.classList.toggle('on', SIZE_IDS[i] === c2.size))
      dashes.querySelectorAll('.qd-opt').forEach((b, i) => b.classList.toggle('on', DASH_IDS[i] === c2.dash))
      fills.querySelectorAll('.qd-opt').forEach((b, i) => b.classList.toggle('on', FILL_IDS[i] === c2.fill))
      fonts.querySelectorAll('.qd-opt').forEach((b, i) => b.classList.toggle('on', FONT_IDS[i] === c2.font))
      aligns.querySelectorAll('.qd-opt').forEach((b, i) => b.classList.toggle('on', ALIGN_IDS[i] === c2.align))
      refresh()
    }
  }

  // ---- menu pieces ---------------------------------------------------------
  // one row of a menu: icon, label, optional shortcut; picking it closes the
  // menu and runs the action
  const menuItem = (p, icon, label, key, fn, enabled = true) => {
    const b = el('button', 'qd-menu-item')
    b.innerHTML = `<span class="qd-mi-ico">${ICONS[icon] || ''}</span><span class="qd-mi-label"></span>`
    b.querySelector('.qd-mi-label').textContent = label
    if (key) {
      const k = el('span', 'qd-mi-key')
      k.textContent = key
      b.appendChild(k)
    }
    b.disabled = !enabled
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      closePopover()
      try { await fn() } catch (err) { console.warn('board menu action failed', err) }
    })
    p.appendChild(b)
    return b
  }
  // a standard nested dropdown: the row grows a flyout beside the menu.
  // A div, not a button: the flyout nests inside, and buttons can't nest.
  // `build(sub)` fills the flyout; returns { row, sub }.
  const subRow = (p, { icon, label, value, build }) => {
    const row = el('div', 'qd-menu-item qd-has-sub')
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.innerHTML =
      `<span class="qd-mi-ico">${icon}</span>` +
      '<span class="qd-mi-label"></span>' +
      '<span class="qd-mi-value"></span>' +
      `<span class="qd-mi-chev">${ICONS.chevronRight}</span>`
    row.querySelector('.qd-mi-label').textContent = label
    row.querySelector('.qd-mi-value').textContent = value || ''
    const sub = el('div', 'qd-submenu')
    build(sub)
    row.appendChild(sub)
    const openSub = () => {
      row.classList.add('sub-open')
      // side with room wins: nested menus prefer the right, but the board
      // menu usually hugs the right edge of the frame
      const rr = root.getBoundingClientRect()
      const br = row.getBoundingClientRect()
      const fitsRight = br.right + sub.offsetWidth + 12 <= rr.right
      sub.classList.toggle('qd-sub-left', !fitsRight)
      // grow upward when the row sits low in the frame
      const fitsDown = br.top - 7 + sub.offsetHeight <= rr.bottom - 8
      sub.style.top = fitsDown ? '' : 'auto'
      sub.style.bottom = fitsDown ? '' : '-7px'
    }
    const closeSub = () => row.classList.remove('sub-open')
    let subT
    row.addEventListener('mouseenter', () => { clearTimeout(subT); openSub() })
    row.addEventListener('mouseleave', () => { subT = setTimeout(closeSub, 180) })
    // tap toggles, for pointers that don't hover
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      row.classList.contains('sub-open') ? closeSub() : openSub()
    })
    p.appendChild(row)
    return { row, sub }
  }

  // ---- menu ----------------------------------------------------------------
  function buildMenu(p) {
    p.classList.add('qd-menu-pop')
    const item = (icon, label, key, fn) => menuItem(p, icon, label, key, fn)
    // a labelled row of mutually exclusive icon buttons
    const segment = (label, ids, { icons, tips, current, onPick }) => {
      const row = el('div', 'qd-menu-row')
      const cap = el('span', 'qd-mi-label')
      cap.textContent = label
      row.appendChild(cap)
      const seg = el('div', 'qd-seg')
      for (const id of ids) {
        const b = el('button', 'qd-seg-btn' + (current === id ? ' on' : ''))
        b.innerHTML = icons[id]
        b.title = tips[id]
        b.setAttribute('aria-label', tips[id])
        b.addEventListener('click', (e) => {
          e.stopPropagation()
          onPick(id)
          seg.querySelectorAll('.qd-seg-btn').forEach((x, i) => x.classList.toggle('on', ids[i] === id))
        })
        seg.appendChild(b)
      }
      row.appendChild(seg)
      p.appendChild(row)
      return row
    }

    const hasSel = editor.selection.size > 0
    item('download', 'Export as PNG', null, () => saveImage(true, null))
    item('transparent', 'Export — transparent', null, () => saveImage(false, null))
    item('vector', 'Export as SVG', null, () => saveImage(true, null, 'svg'))
    if (hasSel) item('image', 'Export selection', null, () => saveImage(true, new Set(editor.selection)))
    if (hasSel) item('vector', 'Export selection as SVG', null, () => saveImage(true, new Set(editor.selection), 'svg'))
    item('copy', hasSel ? 'Copy selection as image' : 'Copy as image', null, () => copyImage(hasSel ? new Set(editor.selection) : null))
    p.appendChild(el('i', 'qd-menu-div'))
    if (hasSel) item('trash', 'Delete selection', '⌫', () => editor.deleteSelection())
    item('fit', 'Zoom to fit', '⇧1', () => editor.fitContent({ animate: 220 }))
    item('trash', 'Clear board', '⇧⌘⌫', () => editor.clearBoard())

    if (opts.gridControl || opts.themeToggle) p.appendChild(el('i', 'qd-menu-div'))
    if (opts.gridControl) {
      // six buttons inline read as clutter — the backdrops live in a flyout
      subRow(p, {
        icon: GRID_ICONS[editor.grid], label: 'Grid', value: GRID_LABELS[editor.grid],
        build: (sub) => {
          for (const id of GRID_IDS) {
            const b = el('button', 'qd-menu-item')
            b.innerHTML =
              `<span class="qd-mi-ico">${GRID_ICONS[id]}</span>` +
              '<span class="qd-mi-label"></span>' +
              `<span class="qd-mi-check">${editor.grid === id ? ICONS.check : ''}</span>`
            b.querySelector('.qd-mi-label').textContent = GRID_LABELS[id]
            b.title = GRID_TIPS[id]
            b.addEventListener('click', (e) => {
              e.stopPropagation()
              editor.setGrid(id)
              sub.querySelectorAll('.qd-mi-check').forEach((c, i) => { c.innerHTML = GRID_IDS[i] === id ? ICONS.check : '' })
              const row = sub.parentElement
              row.querySelector('.qd-mi-ico').innerHTML = GRID_ICONS[id]
              row.querySelector('.qd-mi-value').textContent = GRID_LABELS[id]
            })
            sub.appendChild(b)
          }
        },
      })
    }
    if (opts.themeToggle) {
      segment('Theme', ['light', 'dark'], {
        icons: { light: ICONS.sun, dark: ICONS.moon },
        tips: { light: 'Light theme', dark: 'Dark theme' },
        current: editor.theme.id,
        onPick: (id) => editor.setTheme(id),
      })
    }
  }
  // ---- context menu --------------------------------------------------------
  // Right-click (or a long press) on the board: a menu at the pointer with
  // what belongs there — edit, arrange, align and group for a selection, the
  // board's own actions over empty paper. The editor has already settled the
  // selection under the pointer by the time this fires.
  const ALIGN_ITEMS = [
    ['alignLeft', 'Align left', '⌥A', 'left'], ['alignCenter', 'Align center', '⌥H', 'center'],
    ['alignRight', 'Align right', '⌥D', 'right'], ['alignTop', 'Align top', '⌥W', 'top'],
    ['alignMiddle', 'Align middle', '⌥V', 'middle'], ['alignBottom', 'Align bottom', '⌥S', 'bottom'],
  ]
  function buildContextMenu(p) {
    p.classList.add('qd-menu-pop', 'qd-ctx')
    const item = (icon, label, key, fn, on = true) => menuItem(p, icon, label, key, fn, on)
    const divider = () => p.appendChild(el('i', 'qd-menu-div'))
    const sel = editor.selection
    const one = sel.size === 1 ? editor.store.get([...sel][0]) : null
    if (editor.cropping) {
      const img = editor.store.get(editor.cropping.id)
      item('check', 'Done cropping', 'Enter', () => editor.endCrop())
      item('crop', 'Reset crop', null, () => editor.resetCrop(img.id), !!img?.props.crop)
      return
    }
    if (!sel.size) {
      item('paste', 'Paste', '⌘V', () => editor.pasteFromClipboard())
      item('selectAll', 'Select all', '⌘A', () => editor.selectAll(), editor.store.shapes().length > 0)
      divider()
      item('fit', 'Zoom to fit', '⇧1', () => editor.fitContent({ animate: 220 }))
      item('zoomReset', 'Reset zoom', '⇧0', () => editor.resetZoom({ animate: 180 }))
      divider()
      item('download', 'Export as PNG', null, () => saveImage(true, null))
      item('vector', 'Export as SVG', null, () => saveImage(true, null, 'svg'))
      item('copy', 'Copy as image', null, () => copyImage(null))
      divider()
      item('trash', 'Clear board', '⇧⌘⌫', () => editor.clearBoard(), editor.store.shapes().length > 0)
      return
    }
    if (one && ['text', 'note', 'geo'].includes(one.type)) {
      item('text', 'Edit text', 'Enter', () => editor.editShapeText(one.id))
      divider()
    }
    if (one?.type === 'image') {
      item('crop', 'Crop image', 'Enter', () => editor.startCrop(one.id))
      if (one.props.crop) item('crop', 'Reset crop', null, () => editor.resetCrop(one.id))
      divider()
    }
    item('cut', 'Cut', '⌘X', () => editor.copySelection().then(() => editor.deleteSelection()))
    item('copy', 'Copy', '⌘C', () => editor.copySelection())
    item('paste', 'Paste', '⌘V', () => editor.pasteFromClipboard())
    item('duplicate', 'Duplicate', '⌘D', () => editor.duplicateSelection())
    item('trash', 'Delete', '⌫', () => editor.deleteSelection())
    divider()
    item('group', 'Group', '⌘G', () => editor.groupSelection(), editor.canGroup())
    item('ungroup', 'Ungroup', '⇧⌘G', () => editor.ungroupSelection(), editor.canUngroup())
    divider()
    subRow(p, {
      icon: ICONS.bringToFront, label: 'Reorder',
      build: (sub) => {
        menuItem(sub, 'bringToFront', 'Bring to front', '⇧]', () => editor.bringToFront())
        menuItem(sub, 'bringForward', 'Bring forward', ']', () => editor.bringForward())
        menuItem(sub, 'sendBackward', 'Send backward', '[', () => editor.sendBackward())
        menuItem(sub, 'sendToBack', 'Send to back', '⇧[', () => editor.sendToBack())
      },
    })
    const units = editor._selectionUnits().length
    const { row: alignRowEl } = subRow(p, {
      icon: ICONS.alignLeft, label: 'Align',
      build: (sub) => {
        for (const [icon, label, key, mode] of ALIGN_ITEMS) menuItem(sub, icon, label, key, () => editor.alignSelection(mode))
        sub.appendChild(el('i', 'qd-menu-div'))
        menuItem(sub, 'distributeH', 'Distribute horizontally', '⇧⌥H', () => editor.distributeSelection('horizontal'), units >= 3)
        menuItem(sub, 'distributeV', 'Distribute vertically', '⇧⌥V', () => editor.distributeSelection('vertical'), units >= 3)
      },
    })
    // one shape (or one group) has nothing to line up with
    alignRowEl.classList.toggle('qd-off', units < 2)
    divider()
    item('image', 'Export selection', null, () => saveImage(true, new Set(sel)))
    item('vector', 'Export selection as SVG', null, () => saveImage(true, new Set(sel), 'svg'))
    item('copy', 'Copy as image', null, () => copyImage(new Set(sel)))
  }
  function openContextMenu(x, y) {
    closePopover()
    const p = el('div', 'qd-popover')
    buildContextMenu(p)
    ui.appendChild(p)
    popover = { name: 'context', el: p }
    // the menu hangs off the pointer, flipping to stay inside the frame
    const rw = root.clientWidth, rh = root.clientHeight
    const pw = p.offsetWidth, ph = p.offsetHeight
    let left = x + 2, top = y + 2
    if (rw && left + pw > rw - 8) left = Math.max(8, x - pw - 2)
    if (rh && top + ph > rh - 8) top = Math.max(8, rh - ph - 8)
    p.style.left = left + 'px'
    p.style.top = top + 'px'
    // Esc closes it from anywhere; the editor's own Esc is fine with that
    ctxKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover() } }
    document.addEventListener('keydown', ctxKey, true)
    refresh()
  }

  async function copyImage(ids) {
    const blob = await editor.exportImage({ background: true, ids })
    if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }
  // format: 'png' (a raster of the board) or 'svg' (its vectors)
  async function saveImage(background, ids, format = 'png') {
    let blob
    if (format === 'svg') {
      const svg = editor.exportSvg({ background, ids })
      blob = svg ? new Blob([svg], { type: 'image/svg+xml' }) : null
    } else blob = await editor.exportImage({ background, ids })
    if (!blob) return
    if (onSave) return onSave(blob, background, format)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'quickdraw-' + new Date().toISOString().slice(0, 19).replaceAll(':', '.') + '.' + format
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
  // ---- keyboard help overlay (press ?) -----------------------------------
  const SHORTCUTS = [
    { label: 'Tools', rows: [
      ['Select', 'V / 1'], ['Hand (hold Space)', 'H'], ['Draw', 'D / P / B'],
      ['Highlight', 'I'], ['Eraser', 'E'], ['Laser', 'K'],
      ['Arrow', 'A'], ['Line', 'L'], ['Shape', 'G'],
      ['Rectangle', 'R'], ['Ellipse', 'O'], ['Text', 'T'], ['Sticky note', 'N'],
    ]},
    { label: 'Edit', rows: [
      ['Undo', '⌘Z'], ['Redo', '⇧⌘Z'], ['Select all', '⌘A'],
      ['Copy', '⌘C'], ['Cut', '⌘X'], ['Paste', '⌘V'], ['Duplicate', '⌘D'],
      ['Group', '⌘G'], ['Ungroup', '⇧⌘G'], ['Crop image', 'Enter'],
    ]},
    { label: 'Arrange', rows: [
      ['Bring forward / send backward', '] / ['], ['Bring to front / send to back', '⇧] / ⇧['],
      ['Align left / right', '⌥A / ⌥D'], ['Align top / bottom', '⌥W / ⌥S'],
      ['Align center / middle', '⌥H / ⌥V'], ['Distribute', '⇧⌥H / ⇧⌥V'],
      ['Nudge', 'Arrows (Shift = 8px)'], ['Context menu', 'Right-click / long press'],
    ]},
    { label: 'Dragging', rows: [
      ['Copy instead of move', '⌥ drag'], ['Proportional resize', '⇧ drag'],
      ['Resize about the centre', '⌥ / Ctrl drag'], ['Bind arrow to exact point', '⌥ drag'],
    ]},
    { label: 'View', rows: [
      ['Zoom to fit', '⇧1'], ['Reset zoom', '⇧0'], ['Zoom in / out', '⌘+ / ⌘−'],
    ]},
    { label: 'Board', rows: [
      ['Delete selection', '⌫'], ['Clear board', '⇧⌘⌫'],
      ['Edit / finish text', 'Enter'], ['Cancel / deselect', 'Esc'],
    ]},
    { label: 'Help', rows: [['Keyboard shortcuts', '?']] },
  ]
  const buildHelp = () => {
    const backdrop = el('div', 'qd-help-backdrop')
    const panel = el('div', 'qd-help-panel')
    const head = el('div', 'qd-help-head')
    const title = el('div', 'qd-help-title'); title.textContent = 'Keyboard shortcuts'
    const close = el('button', 'qd-help-close')
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    close.setAttribute('aria-label', 'Close')
    head.appendChild(title); head.appendChild(close)
    panel.appendChild(head)
    for (const g of SHORTCUTS) {
      const sec = el('div', 'qd-help-group')
      const gl = el('div', 'qd-help-glabel'); gl.textContent = g.label
      sec.appendChild(gl)
      for (const [name, keys] of g.rows) {
        const row = el('div', 'qd-help-row')
        const nm = el('span', 'qd-help-name'); nm.textContent = name
        const kc = el('span', 'qd-help-keys'); kc.textContent = keys
        row.appendChild(nm); row.appendChild(kc)
        sec.appendChild(row)
      }
      panel.appendChild(sec)
    }
    backdrop.appendChild(panel)
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeHelp() })
    close.addEventListener('click', () => closeHelp())
    return backdrop
  }
  let helpEl = null
  const closeHelp = () => {
    if (!helpEl) return
    helpEl.remove(); helpEl = null
    document.removeEventListener('keydown', onHelpKey, true)
  }
  const onHelpKey = (e) => {
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); closeHelp() }
  }
  const toggleHelp = () => {
    if (helpEl) { closeHelp(); return }
    helpEl = buildHelp()
    ui.appendChild(helpEl)
    document.addEventListener('keydown', onHelpKey, true)
    refresh()
  }
  editor.on('help', toggleHelp)

  // ---- minimap -------------------------------------------------------------
  // A small map of the whole drawing in the top-right corner: shapes as
  // soft blocks, the viewport as a frame. Click or drag to put the view
  // there, scroll to zoom; a button floating over its corner folds it down
  // to just that button. Narrow boards (phones) go without.
  const MM_W = 180, MM_H = 120, MM_PAD = 8
  const mm = el('div', 'qd-minimap')
  const mmCanvas = document.createElement('canvas')
  mmCanvas.className = 'qd-minimap-canvas'
  const mmToggle = el('button', 'qd-minimap-toggle')
  mmToggle.setAttribute('aria-label', 'Toggle minimap')
  mm.appendChild(mmCanvas)
  mm.appendChild(mmToggle)
  ui.appendChild(mm)
  let mmFolded = false
  let mmRaf = 0
  let mmMap = null // page → map transform of the last draw: { k, ox, oy, b }
  const mmVisible = () => opts.minimap && !mmFolded && (root.clientWidth || 600) >= 560
  const mapOf = () => {
    // the world the map shows: everything drawn, and the view, with a margin
    const vp = editor.viewportPageBounds()
    let b = editor.contentBounds()
    b = b ? {
      x: Math.min(b.x, vp.x), y: Math.min(b.y, vp.y),
      w: Math.max(b.x + b.w, vp.x + vp.w) - Math.min(b.x, vp.x), h: Math.max(b.y + b.h, vp.y + vp.h) - Math.min(b.y, vp.y),
    } : vp
    const k = Math.min((MM_W - MM_PAD * 2) / (b.w || 1), (MM_H - MM_PAD * 2) / (b.h || 1))
    return { k, ox: MM_W / 2 - (b.x + b.w / 2) * k, oy: MM_H / 2 - (b.y + b.h / 2) * k, b }
  }
  const drawMinimap = () => {
    mmRaf = 0
    if (!mmVisible()) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (mmCanvas.width !== MM_W * dpr) { mmCanvas.width = MM_W * dpr; mmCanvas.height = MM_H * dpr }
    const ctx = mmCanvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, MM_W, MM_H)
    const m = mmMap = mapOf()
    const t = editor.theme
    // shapes as blocks in the board's ink, quiet
    ctx.fillStyle = t.id === 'dark' ? 'rgba(255, 246, 224, 0.45)' : 'rgba(28, 27, 24, 0.32)'
    for (const s of editor.shapesSorted()) {
      const pb = pageBounds(s)
      const w = Math.max(2, pb.w * m.k), h = Math.max(2, pb.h * m.k)
      ctx.beginPath()
      ctx.roundRect(pb.x * m.k + m.ox, pb.y * m.k + m.oy, w, h, Math.min(2, w / 2, h / 2))
      ctx.fill()
    }
    // the viewport frame
    const vp = editor.viewportPageBounds()
    ctx.fillStyle = t.selectionFill
    ctx.strokeStyle = t.selection
    ctx.lineWidth = 1.5
    const vx = vp.x * m.k + m.ox, vy = vp.y * m.k + m.oy
    ctx.fillRect(vx, vy, vp.w * m.k, vp.h * m.k)
    ctx.strokeRect(vx + 0.75, vy + 0.75, vp.w * m.k - 1.5, vp.h * m.k - 1.5)
  }
  const requestMinimap = () => { if (!mmRaf && mmVisible()) mmRaf = requestAnimationFrame(drawMinimap) }
  const layoutMinimap = () => {
    mm.classList.toggle('qd-folded', mmFolded)
    mm.style.display = opts.minimap && (root.clientWidth || 600) >= 560 ? '' : 'none'
    mmToggle.innerHTML = mmFolded ? ICONS.map : ICONS.minimize
    mmToggle.title = mmFolded ? 'Show minimap' : 'Hide minimap'
    requestMinimap()
  }
  mmToggle.addEventListener('pointerdown', (e) => e.stopPropagation())
  mmToggle.addEventListener('click', (e) => { e.stopPropagation(); mmFolded = !mmFolded; layoutMinimap() })
  // a press puts the view there; a drag keeps it under the pointer
  const mmPageAt = (e) => {
    const r = mmCanvas.getBoundingClientRect()
    const m = mmMap || mapOf()
    return { x: (e.clientX - r.left - m.ox) / m.k, y: (e.clientY - r.top - m.oy) / m.k }
  }
  const mmCenterOn = (p, animate) => {
    const { w, h } = editor.viewSize()
    const z = editor.camera.z
    editor.setCamera({ z, x: w / 2 / z - p.x, y: h / 2 / z - p.y }, { animate })
  }
  mmCanvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    if (e.button !== 0) return
    try { mmCanvas.setPointerCapture(e.pointerId) } catch {}
    mmCanvas.classList.add('qd-dragging')
    mmCenterOn(mmPageAt(e), 0)
    const move = (ev) => { if (ev.pointerId === e.pointerId) mmCenterOn(mmPageAt(ev), 0) }
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return
      mmCanvas.classList.remove('qd-dragging')
      mmCanvas.removeEventListener('pointermove', move)
      mmCanvas.removeEventListener('pointerup', up)
      mmCanvas.removeEventListener('pointercancel', up)
    }
    mmCanvas.addEventListener('pointermove', move)
    mmCanvas.addEventListener('pointerup', up)
    mmCanvas.addEventListener('pointercancel', up)
  })
  // scrolling on the map zooms the view about its middle
  mmCanvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const { w, h } = editor.viewSize()
    editor.zoomAt(w / 2, h / 2, Math.exp(-e.deltaY * 0.012))
  }, { passive: false })
  layoutMinimap()

  // ---- responsive fit ------------------------------------------------------
  // Instead of scaling down, the dock sheds tools into the "more" flyout as
  // its frame narrows; below ~5 buttons of room it folds into a single
  // tools button. Fixed metrics keep the math cheap and honest.
  const BTN = 34 // 32px button + 2px gap
  const PAD = 16 // dock padding + border
  let hiddenNames = []
  let mode = null
  const fit = () => {
    const avail = (root.clientWidth || 600) - 16
    const fullW = PAD + (DOCK_NAMES.length + 2) * BTN + dividers.length * 7
    const slots = Math.floor((avail - PAD) / BTN)
    let m, hid
    if (avail >= fullW) {
      m = 'full'
      hid = []
    } else if (slots < 5) {
      m = 'mini'
      hid = [...DOCK_NAMES]
    } else {
      m = 'compact'
      // styles/more/menu take 3 slots; select and draw are pinned; the rest
      // of the room goes to the tools that yield last
      const extra = Math.max(0, slots - 5)
      const keep = new Set(['select', 'draw'])
      for (let i = DROP_ORDER.length - 1, n = extra; i >= 0 && n > 0; i--, n--) keep.add(DROP_ORDER[i])
      hid = DOCK_NAMES.filter((n) => !keep.has(n))
    }
    const changed = m !== mode || hid.join() !== hiddenNames.join()
    mode = m
    hiddenNames = hid
    if (!changed) return
    const hideSet = new Set(hid)
    for (const [n, b] of dockBtns) b.style.display = hideSet.has(n) ? 'none' : ''
    for (const d of dividers) d.style.display = m === 'full' ? '' : 'none'
    toolsBtn.style.display = m === 'mini' ? '' : 'none'
    moreBtn.style.display = m === 'compact' ? '' : 'none'
    dock.classList.toggle('qd-compact', m !== 'full')
    if (popover && ['more', 'tools', 'geo', 'context'].includes(popover.name)) closePopover()
    refresh()
  }
  // (the minimap follows the same frame: it folds away on narrow boards)
  const ro = new ResizeObserver(() => { fit(); layoutMinimap() })
  ro.observe(root)
  fit()

  // ---- state sync ----------------------------------------------------------
  function refresh() {
    for (const n of DOCK_NAMES) {
      const b = dockBtns.get(n)
      if (n === 'image') continue
      b.classList.toggle('on', editor.tool === n)
    }
    const geoBtn = dockBtns.get('geo')
    geoBtn.innerHTML = ICONS[editor.geoKind]
    actBtns.get('undo').disabled = !editor.store.canUndo
    actBtns.get('redo').disabled = !editor.store.canRedo
    const hasSel = editor.selection.size > 0
    actBtns.get('duplicate').disabled = !hasSel
    actBtns.get('delete').disabled = !hasSel
    // the folded button wears the active tool so the state stays visible
    toolsBtn.innerHTML = ICONS[editor.tool === 'geo' ? editor.geoKind : editor.tool] || ICONS.select
    toolsBtn.classList.toggle('on', popover?.name === 'tools')
    styleDot.style.background = editor.theme.colors[editor.currentStyles().color || 'blue'].stroke
    menuBtn.classList.toggle('on', popover?.name === 'menu')
    styleBtn.classList.toggle('on', popover?.name === 'styles')
    moreBtn.classList.toggle('on', popover?.name === 'more')
  }
  const offs = [
    editor.on('tool', refresh),
    editor.on('styles', refresh),
    editor.on('history', refresh),
    editor.on('selection', refresh),
    editor.on('theme', refresh),
    editor.on('grid', refresh),
    editor.on('contextmenu', ({ x, y }) => openContextMenu(x, y)),
    editor.on('change', requestMinimap),
    editor.on('camera', requestMinimap),
    editor.on('theme', requestMinimap),
  ]

  // popovers close when the pointer goes to the canvas
  const closeOnCanvas = (e) => { if (!ui.contains(e.target)) closePopover() }
  root.addEventListener('pointerdown', closeOnCanvas, { capture: true })

  const setHidden = (h) => ui.classList.toggle('qd-hidden', !!h)
  setHidden(hidden)
  refresh()

  return {
    setHidden,
    // live toggles for the menu switches; an open menu is rebuilt on next open
    setOptions(next = {}) {
      if ('themeToggle' in next) opts.themeToggle = next.themeToggle !== false
      if ('gridControl' in next) opts.gridControl = next.gridControl !== false
      if ('minimap' in next) { opts.minimap = next.minimap !== false; layoutMinimap() }
      if (popover?.name === 'menu') closePopover()
    },
    destroy() {
      offs.forEach((f) => f())
      ro.disconnect()
      cancelAnimationFrame(mmRaf)
      root.removeEventListener('pointerdown', closeOnCanvas, { capture: true })
      closeHelp()
      closePopover()
      ui.remove()
    },
  }
}

const el = (tag, cls) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}
