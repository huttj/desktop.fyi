// SVG export: the drawing as vectors. Every shape type has its twin here,
// and the geometry comes from the same builders the canvas draws with — the
// pencil's outline, the seeded wobble, the cloud curves, the text layout —
// so the file matches the board mark for mark, at any size, in any design
// tool. Dependency-free ESM (see palette.js).

import { SIZES, HIGHLIGHT_ALPHA, HIGHLIGHT_SCALE, HIGHLIGHT_PLAIN, GRID_STEP, GRID_MAJOR } from './palette.js'
import {
  localBounds, pageBounds, textLayout, noteLayout, geoLabelLayout, lineBaseline, lineRuns,
  buildGeoPath, buildInkPath, dashFor, imageFrame, urlBadgeAt, NOTE_PAD, SEMI,
} from './shapes.js'
import { boundsUnion, boundsExpand, traceSmooth } from './geometry.js'

const n = (v) => String(Math.round(v * 100) / 100)
const deg = (rad) => (rad * 180) / Math.PI
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('')
const tag = (name, o, inner) => `<${name}${attrs(o)}` + (inner == null ? '/>' : `>${inner}</${name}>`)

// a path sink with the 2d-context subset the shape builders use, writing a
// path `d` string instead of a Path2D
class SvgPath {
  constructor() { this.d = '' }
  moveTo(x, y) { this.d += `M${n(x)} ${n(y)}` }
  lineTo(x, y) { this.d += `L${n(x)} ${n(y)}` }
  quadraticCurveTo(cx, cy, x, y) { this.d += `Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}` }
  bezierCurveTo(x1, y1, x2, y2, x, y) { this.d += `C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}` }
  ellipse(cx, cy, rx, ry) {
    // two half-turn arcs make the full ellipse
    this.d += `M${n(cx + rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}`
  }
  closePath() { this.d += 'Z' }
}

const smoothPath = (pts, closed = false) => {
  const p = new SvgPath()
  traceSmooth(p, pts, closed)
  return p.d
}
// draw/highlight points are [x, y, pressure] triplets
const centerline = (pts) => {
  const flat = []
  for (let i = 0; i < pts.length; i += 3) flat.push(pts[i], pts[i + 1])
  return flat
}

const strokeAttrs = (color, dash, w) => ({
  fill: 'none', stroke: color, 'stroke-width': n(w), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  'stroke-dasharray': dashFor(dash, w)?.map(n).join(' '),
})

// A block of laid-out text: lines of tspans, run by run, so bold, italic,
// code, links, underlines and strikes come through; highlights are bands
// painted behind. `left(line)` is each line's left edge (its alignment).
// Returns the highlight rects and the <text> element.
const textBlockSvg = (theme, { lines, fontSize, font, lh, marks, text, left }, color, top) => {
  const bl = lineBaseline(font, fontSize, lh)
  let bands = ''
  let spans = ''
  lines.forEach((line, i) => {
    const y = top + bl + i * lh
    const x0 = left(line)
    for (const r of lineRuns(text, line, marks, fontSize, font)) {
      if (r.st.hl) bands += tag('rect', { x: n(x0 + r.x - 1), y: n(y - bl), width: n(r.w + 2), height: n(lh), fill: theme.colors.yellow.note })
      const deco = [r.st.href || r.st.u ? 'underline' : '', r.st.s ? 'line-through' : ''].filter(Boolean).join(' ')
      spans += tag('tspan', {
        x: n(x0 + r.x), y: n(y),
        'font-weight': r.st.b ? 700 : null, 'font-style': r.st.i ? 'italic' : null,
        'font-family': r.st.code ? "'SF Mono', ui-monospace, Menlo, monospace" : null,
        'text-decoration': deco || null,
      }, esc(r.str))
    }
  })
  return bands + tag('text', { 'font-family': font, 'font-size': n(fontSize), 'font-weight': 500, fill: color, 'xml:space': 'preserve' }, spans)
}
const urlBadgeSvg = (theme, shape, color) => {
  const b = urlBadgeAt(shape)
  if (!b) return ''
  return tag('g', { stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    tag('circle', { cx: n(b.x), cy: n(b.y), r: b.r, fill: theme.handleFill }) +
    tag('path', { d: `M${n(b.x - 3.5)} ${n(b.y + 3.5)}L${n(b.x + 3.5)} ${n(b.y - 3.5)}M${n(b.x - 1)} ${n(b.y - 3.5)}L${n(b.x + 3.5)} ${n(b.y - 3.5)}L${n(b.x + 3.5)} ${n(b.y + 1)}`, fill: 'none' }))
}

// ---- one shape ------------------------------------------------------------

// `defs` collects shared definitions (hatch patterns, the note shadow, clip
// paths) keyed by id, so each is emitted once
export function shapeToSvg(shape, { theme, store, defs }) {
  const p = shape.props
  const col = theme.colors[p.color || 'black']
  let body = ''
  switch (shape.type) {
    case 'draw': {
      if (p.dash && p.dash !== 'draw') {
        body = tag('path', { d: smoothPath(centerline(p.pts)), ...strokeAttrs(col.stroke, p.dash, SIZES[p.size]) })
      } else {
        const path = new SvgPath()
        buildInkPath(path, shape)
        body = tag('path', { d: path.d, fill: col.stroke })
      }
      break
    }
    case 'highlight': {
      // the multiply blend soaks into light paper like the canvas does;
      // viewers without blend support still show the band, just opaque-ish
      const d = smoothPath(centerline(p.pts))
      const sa = strokeAttrs(col.stroke, 'solid', SIZES[p.size] * HIGHLIGHT_SCALE)
      body = tag('path', { d, ...sa, opacity: HIGHLIGHT_ALPHA, style: `mix-blend-mode:${theme.id === 'dark' ? 'lighten' : 'multiply'}` }) +
        tag('path', { d, ...sa, opacity: HIGHLIGHT_ALPHA * HIGHLIGHT_PLAIN }) // the plain pass, as on the canvas
      break
    }
    case 'geo': {
      const path = new SvgPath()
      buildGeoPath(path, shape)
      let fill = 'none'
      if (p.fill === 'semi') fill = SEMI[theme.id]
      else if (p.fill === 'solid') fill = col.fill
      else if (p.fill === 'pattern') {
        const id = 'qd-hatch-' + (p.color || 'black')
        defs.set(id, tag('pattern', { id, patternUnits: 'userSpaceOnUse', width: 8, height: 8 },
          tag('path', { d: 'M-2 6L6 -2M2 10L10 2', stroke: col.stroke, 'stroke-width': 1.4, opacity: 0.55 })))
        fill = `url(#${id})`
      }
      body = tag('path', { d: path.d, ...strokeAttrs(col.stroke, p.dash, SIZES[p.size]), fill })
      const lay = geoLabelLayout(shape)
      if (lay) {
        body += textBlockSvg(theme, { ...lay, marks: p.labelMarks, text: p.label, left: (line) => p.w / 2 - line.w / 2 }, col.stroke, p.h / 2 - lay.textH / 2)
      }
      break
    }
    case 'arrow':
    case 'line': {
      const w = SIZES[p.size]
      const bend = p.bend || 0
      const len = Math.hypot(p.dx, p.dy) || 1
      const nx = -p.dy / len, ny = p.dx / len
      const cx = p.dx / 2 + nx * bend * 2, cy = p.dy / 2 + ny * bend * 2
      const d = bend ? `M0 0Q${n(cx)} ${n(cy)} ${n(p.dx)} ${n(p.dy)}` : `M0 0L${n(p.dx)} ${n(p.dy)}`
      body = tag('path', { d, ...strokeAttrs(col.stroke, p.dash, w) })
      if (shape.type === 'arrow') {
        const ta = bend ? Math.atan2(p.dy - cy, p.dx - cx) : Math.atan2(p.dy, p.dx)
        const hl = Math.min(Math.max(w * 3.2, 12), len * 0.4)
        const head = `M${n(p.dx - Math.cos(ta - 0.5) * hl)} ${n(p.dy - Math.sin(ta - 0.5) * hl)}L${n(p.dx)} ${n(p.dy)}L${n(p.dx - Math.cos(ta + 0.5) * hl)} ${n(p.dy - Math.sin(ta + 0.5) * hl)}`
        body += tag('path', { d: head, ...strokeAttrs(col.stroke, 'solid', w) })
      }
      break
    }
    case 'text': {
      const l = textLayout(shape)
      const align = p.align || 'start'
      const left = (line) => (align === 'middle' ? l.w / 2 - line.w / 2 : align === 'end' ? l.w - line.w : 0)
      body = textBlockSvg(theme, { ...l, marks: p.marks, text: p.text, left }, col.stroke, 0)
      break
    }
    case 'note': {
      const l = noteLayout(shape)
      const s = p.scale || 1
      defs.set('qd-note-shadow', tag('filter', { id: 'qd-note-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' },
        tag('feDropShadow', { dx: 0, dy: 4, stdDeviation: 5, 'flood-color': 'rgba(20,16,8,0.22)' })))
      body = tag('g', { transform: s !== 1 ? `scale(${n(s)})` : null },
        tag('rect', { width: n(l.boxW), height: n(l.boxH), rx: 6, fill: col.note, filter: 'url(#qd-note-shadow)' }) +
        textBlockSvg(theme, { ...l, marks: p.marks, text: p.text, left: (line) => l.boxW / 2 - line.w / 2 }, theme.noteText, Math.max(NOTE_PAD, l.boxH / 2 - l.textH / 2)) +
        urlBadgeSvg(theme, shape, theme.noteText))
      break
    }
    case 'image': {
      const asset = store.asset(p.assetId)
      const clipId = 'qd-clip-' + shape.id.replace(/[^a-zA-Z0-9_-]/g, '_')
      defs.set(clipId, tag('clipPath', { id: clipId }, tag('rect', { width: n(p.w), height: n(p.h), rx: 4 })))
      if (asset) {
        // a cropped image draws its whole source under the window's clip
        const f = imageFrame(shape)
        body = tag('g', { 'clip-path': `url(#${clipId})` },
          tag('image', { href: asset.src, x: n(f.x), y: n(f.y), width: n(f.w), height: n(f.h), preserveAspectRatio: 'none' }))
      } else {
        body = tag('rect', { width: n(p.w), height: n(p.h), rx: 4, fill: SEMI[theme.id] })
      }
      break
    }
    default:
      return ''
  }
  if (p.url && shape.type !== 'note') body += urlBadgeSvg(theme, shape, col.stroke)
  // the shape's own frame: rotate about its centre, then its origin — the
  // same order the canvas applies
  const lb = localBounds(shape)
  const t = [
    shape.rot ? `rotate(${n(deg(shape.rot))} ${n(shape.x + lb.x + lb.w / 2)} ${n(shape.y + lb.y + lb.h / 2)})` : '',
    `translate(${n(shape.x)} ${n(shape.y)})`,
  ].filter(Boolean).join(' ')
  return tag('g', { transform: t, 'data-shape': shape.type }, body)
}

// ---- the grid as a repeating tile ------------------------------------------

// one major cell (GRID_MAJOR minor steps square), aligned to the page origin
// like the canvas lattice; 'iso' has no rectangular tile and is left off
function gridDefs(grid, theme) {
  if (grid === 'none' || grid === 'iso') return null
  const g = theme.grid?.[['dots', 'crosses'].includes(grid) ? 'dot' : 'line']
  if (!g) return null
  const size = GRID_STEP * GRID_MAJOR
  let inner = ''
  const line = (x1, y1, x2, y2, major) => tag('path', { d: `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, stroke: major ? g.major : g.minor, 'stroke-width': 1 })
  for (let k = 0; k < GRID_MAJOR; k++) {
    const v = k * GRID_STEP + 0.5, major = k === 0
    if (grid === 'lines') inner += line(v, 0, v, size, major)
    if (grid === 'lines' || grid === 'ruled') inner += line(0, v, size, v, major)
  }
  if (grid === 'dots' || grid === 'crosses') {
    for (let i = 0; i < GRID_MAJOR; i++) for (let j = 0; j < GRID_MAJOR; j++) {
      const x = i * GRID_STEP + 0.5, y = j * GRID_STEP + 0.5, major = i === 0 && j === 0
      if (grid === 'dots') inner += tag('circle', { cx: n(x), cy: n(y), r: 1.6, fill: g.minor })
      else {
        const arm = major ? 4.5 : 3
        inner += tag('path', { d: `M${n(x - arm)} ${n(y)}L${n(x + arm)} ${n(y)}M${n(x)} ${n(y - arm)}L${n(x)} ${n(y + arm)}`, stroke: major ? g.major : g.minor, 'stroke-width': 1 })
      }
    }
  }
  return tag('pattern', { id: 'qd-grid', patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: size, height: size }, inner)
}

// ---- the document ----------------------------------------------------------

// shapes: already sorted for drawing. Returns the SVG document string.
export function sceneToSvg(shapes, { theme, store, grid = 'none', background = true, margin = 48 }) {
  let b = null
  for (const s of shapes) b = boundsUnion(b, pageBounds(s))
  if (!b) return null
  b = boundsExpand(b, margin)
  const defs = new Map()
  const body = shapes.map((s) => shapeToSvg(s, { theme, store, defs })).join('\n')
  let paper = ''
  if (background) {
    paper += tag('rect', { x: n(b.x), y: n(b.y), width: n(b.w), height: n(b.h), fill: theme.background })
    const gd = gridDefs(grid, theme)
    if (gd) {
      defs.set('qd-grid', gd)
      paper += tag('rect', { x: n(b.x), y: n(b.y), width: n(b.w), height: n(b.h), fill: 'url(#qd-grid)' })
    }
  }
  const defsEl = defs.size ? tag('defs', {}, [...defs.values()].join('')) : ''
  return tag('svg', {
    xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    width: n(b.w), height: n(b.h), viewBox: `${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}`,
  }, defsEl + paper + '\n' + body)
}
