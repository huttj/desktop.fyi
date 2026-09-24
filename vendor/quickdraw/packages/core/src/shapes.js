// Shape definitions: bounds, canvas rendering and hit-testing for every
// board shape type. Records are immutable, so per-shape caches (freehand
// outlines, wobbled geo paths, text layout) key off the props object in
// WeakMaps and invalidate themselves by replacement.
// Dependency-free ESM (see palette.js).

import {
  SIZES, INK_SIZES, FONT_SIZES, NOTE_FONT_SIZES, FONTS, HIGHLIGHT_ALPHA, HIGHLIGHT_SCALE, HIGHLIGHT_PLAIN,
} from './palette.js'
import {
  ptsBounds, rotWith, distToPolyline, pointInPolygon, pointInEllipse,
  geoPolygon, ellipsePolygon, cloudPolygon, CLOUD_START, CLOUD_CURVES,
  wobblePolyline, traceSmooth, segIntersectsBounds,
  boundsIntersect, boundsContain,
} from './geometry.js'
import { strokeOutline } from './freehand.js'

export const NOTE_W = 200
export const NOTE_PAD = 20
const LABEL_PAD = 12

// semi fill: a near-opaque wash of the paper, so the shape occludes what's
// behind it without committing to a color
export const SEMI = { light: 'rgba(249, 247, 241, 0.85)', dark: 'rgba(32, 30, 25, 0.85)' }

// ---- local bounds (origin = shape.x/y, unrotated) --------------------------

export function localBounds(shape) {
  const p = shape.props
  switch (shape.type) {
    case 'draw':
    case 'highlight': {
      const b = ptsBounds(p.pts, 3)
      const m = SIZES[p.size] * (shape.type === 'highlight' ? HIGHLIGHT_SCALE / 2 : 0.75)
      return { x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 }
    }
    case 'arrow':
    case 'line': {
      const bend = p.bend || 0
      const x = Math.min(0, p.dx) - Math.abs(bend)
      const y = Math.min(0, p.dy) - Math.abs(bend)
      return { x, y, w: Math.abs(p.dx) + Math.abs(bend) * 2, h: Math.abs(p.dy) + Math.abs(bend) * 2 }
    }
    case 'text': {
      const l = textLayout(shape)
      return { x: 0, y: 0, w: l.w, h: l.h }
    }
    case 'note': {
      const l = noteLayout(shape)
      return { x: 0, y: 0, w: l.boxW * (p.scale || 1), h: l.boxH * (p.scale || 1) }
    }
    case 'image':
      return { x: 0, y: 0, w: p.w, h: p.h }
    case 'geo':
    default:
      return { x: 0, y: 0, w: p.w || 1, h: p.h || 1 }
  }
}

// axis-aligned page bounds, rotation included
export function pageBounds(shape) {
  const lb = localBounds(shape)
  if (!shape.rot) return { x: shape.x + lb.x, y: shape.y + lb.y, w: lb.w, h: lb.h }
  const cx = shape.x + lb.x + lb.w / 2
  const cy = shape.y + lb.y + lb.h / 2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of [
    [shape.x + lb.x, shape.y + lb.y],
    [shape.x + lb.x + lb.w, shape.y + lb.y],
    [shape.x + lb.x + lb.w, shape.y + lb.y + lb.h],
    [shape.x + lb.x, shape.y + lb.y + lb.h],
  ]) {
    const r = rotWith(px, py, cx, cy, shape.rot)
    if (r.x < minX) minX = r.x
    if (r.x > maxX) maxX = r.x
    if (r.y < minY) minY = r.y
    if (r.y > maxY) maxY = r.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// page point -> shape-local point (un-rotate, un-translate)
export function toLocal(shape, px, py) {
  if (shape.rot) {
    const lb = localBounds(shape)
    const cx = shape.x + lb.x + lb.w / 2
    const cy = shape.y + lb.y + lb.h / 2
    const r = rotWith(px, py, cx, cy, -shape.rot)
    return { x: r.x - shape.x, y: r.y - shape.y }
  }
  return { x: px - shape.x, y: py - shape.y }
}

// ---- caches ----------------------------------------------------------------

const outlineCache = new WeakMap() // draw props -> Path2D
const geoPathCache = new WeakMap() // geo props+id key stored on props via WeakMap keyed by props (id captured at build)
let layoutCache = new WeakMap() // text/note/geo-label props -> layout

// Text measured before a web font arrived was measured in the fallback
// face: once the fonts are in, every layout is stale. The editor calls this
// when the document's fonts finish loading.
export function invalidateTextLayout() {
  layoutCache = new WeakMap()
  baselineCache.clear()
}

let measureCtx = null
const measurer = () => {
  if (!measureCtx) measureCtx = (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas')).getContext('2d')
  return measureCtx
}

// The editing textarea positions glyphs by CSS line-box math (half-leading
// around ascent+descent), while canvas 'middle' centers on the em square —
// they disagree by a few px, so committed text would shift. Draw with
// 'alphabetic' at the CSS baseline instead so canvas matches the textarea.
const baselineCache = new Map()
export function lineBaseline(font, fontSize, lh) {
  const key = `${fontSize}|${lh}|${font}`
  let b = baselineCache.get(key)
  if (b === undefined) {
    const ctx = measurer()
    ctx.font = `500 ${fontSize}px ${font}`
    const m = ctx.measureText('Mg')
    const a = m.fontBoundingBoxAscent ?? fontSize * 0.8
    const d = m.fontBoundingBoxDescent ?? fontSize * 0.2
    b = (lh - (a + d)) / 2 + a
    baselineCache.set(key, b)
  }
  return b
}

// ---- text layout -----------------------------------------------------------
// Text can carry marks: runs of { from, to } character offsets with any of
// b (bold), i (italic), u (underline), s (strike), code, hl (highlight) and
// href (a link). Bold, italic and code change how a run measures, so the
// wrapping knows about them; the rest only change how it's drawn. Marks
// live on props.marks for text and notes, props.labelMarks for geo labels.

// a run's font
export const runFont = (st, fontSize, font) =>
  `${st.i ? 'italic ' : ''}${st.b ? 700 : 500} ${fontSize}px ${st.code ? FONTS.mono : font}`

// the runs covering [from, to) of a text: [start, end, style] — unmarked
// stretches get an empty style
export function runsIn(marks, from, to) {
  if (!marks || !marks.length) return [[from, to, {}]]
  const out = []
  let pos = from
  for (const m of marks) {
    if (m.to <= from || m.from >= to) continue
    const s = Math.max(m.from, from), e = Math.min(m.to, to)
    if (s > pos) out.push([pos, s, {}])
    if (e > s) out.push([s, e, m])
    pos = Math.max(pos, e)
  }
  if (pos < to) out.push([pos, to, {}])
  return out
}
const measureSpan = (ctx, text, from, to, marks, fontSize, font) => {
  let w = 0
  for (const [s, e, st] of runsIn(marks, from, to)) {
    ctx.font = runFont(st, fontSize, font)
    w += ctx.measureText(text.slice(s, e)).width
  }
  return w
}

// lines as { text, w, start }: `start` is the line's offset in the full
// text, so marks can be sliced per line
function wrapLines(text, font, fontSize, maxW, marks) {
  const ctx = measurer()
  const str = String(text ?? '')
  const out = []
  let pos = 0
  for (const para of str.split('\n')) {
    if (para === '') { out.push({ text: '', w: 0, start: pos }); pos += 1; continue }
    let line = '', lineStart = pos, cur = pos
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue
      const test = line + word
      if (line && maxW && measureSpan(ctx, str, lineStart, cur + word.length, marks, fontSize, font) > maxW) {
        out.push({ text: line, w: measureSpan(ctx, str, lineStart, cur, marks, fontSize, font), start: lineStart })
        const trimmed = word.trimStart()
        lineStart = cur + (word.length - trimmed.length)
        line = trimmed
      } else line = test
      cur += word.length
    }
    out.push({ text: line, w: measureSpan(ctx, str, lineStart, cur, marks, fontSize, font), start: lineStart })
    pos += para.length + 1
  }
  // a line's width leaves its trailing spaces out, as a text box does: they
  // hang past the edge and never push centred or right-aligned text over
  for (const l of out) {
    const trimmed = l.text.replace(/\s+$/, '')
    if (trimmed.length !== l.text.length) l.w = measureSpan(ctx, str, l.start, l.start + trimmed.length, marks, fontSize, font)
  }
  return out
}

// one line's runs with their widths: [{ str, st, x, w }], x from the line's left
export function lineRuns(text, line, marks, fontSize, font) {
  const ctx = measurer()
  const out = []
  let x = 0
  for (const [s, e, st] of runsIn(marks, line.start, line.start + line.text.length)) {
    ctx.font = runFont(st, fontSize, font)
    const str = String(text ?? '').slice(s, e)
    const w = ctx.measureText(str).width
    out.push({ str, st, x, w })
    x += w
  }
  return out
}

export function textLayout(shape) {
  const p = shape.props
  const hit = layoutCache.get(p)
  if (hit) return hit
  const fontSize = FONT_SIZES[p.size] * (p.scale || 1)
  const font = FONTS[p.font || 'draw']
  const lh = fontSize * 1.32
  const maxW = p.autosize === false && p.w ? p.w : 0
  const lines = wrapLines(p.text, font, fontSize, maxW, p.marks)
  const w = maxW || Math.max(8, ...lines.map((l) => l.w)) + 2
  const l = { lines, fontSize, font, lh, w, h: Math.max(lh, lines.length * lh) }
  layoutCache.set(p, l)
  return l
}

export function noteLayout(shape) {
  const p = shape.props
  const hit = layoutCache.get(p)
  if (hit) return hit
  const fontSize = NOTE_FONT_SIZES[p.size]
  const font = FONTS[p.font || 'draw']
  const lh = fontSize * 1.35
  // the sticky's box: props.w / props.h when it's been resized, else the
  // classic square — and never shorter than its text needs
  const boxW = p.w || NOTE_W
  const lines = wrapLines(p.text, font, fontSize, boxW - NOTE_PAD * 2, p.marks)
  const textH = lines.length * lh
  const l = { lines, fontSize, font, lh, textH, boxW, boxH: Math.max(p.h || boxW, textH + NOTE_PAD * 2) }
  layoutCache.set(p, l)
  return l
}

export function geoLabelLayout(shape) {
  const p = shape.props
  if (!p.label) return null
  const key = p
  let hit = layoutCache.get(key)
  if (hit) return hit
  const fontSize = FONT_SIZES[p.labelSize || 's']
  const font = FONTS[p.font || 'draw']
  const lh = fontSize * 1.3
  const lines = wrapLines(p.label, font, fontSize, Math.max(24, p.w - LABEL_PAD * 2), p.labelMarks)
  hit = { lines, fontSize, font, lh, textH: lines.length * lh }
  layoutCache.set(key, hit)
  return hit
}

// Carry marks across an edit of their text. Edits are local — a stretch of
// the old text became a stretch of the new — so positions before it stay,
// positions after it shift, and positions inside it collapse to its start.
// A boundary right at the edit counts as "after": typing at the end of a
// bold run extends it, typing at its start doesn't (the editors' rule).
// Runs left empty go.
export function mapMarks(marks, oldText, newText) {
  if (!marks || !marks.length) return marks
  const o = String(oldText ?? ''), n = String(newText ?? '')
  let a = 0
  while (a < o.length && a < n.length && o[a] === n[a]) a++
  let k = 0
  while (k < o.length - a && k < n.length - a && o[o.length - 1 - k] === n[n.length - 1 - k]) k++
  const b = o.length - k
  const delta = n.length - o.length
  const map = (pos) => (pos < a ? pos : pos >= b ? pos + delta : a)
  return marks.map((m) => ({ ...m, from: map(m.from), to: map(m.to) })).filter((m) => m.to > m.from)
}

// ---- editing marks ---------------------------------------------------------
// Marks are kept as sorted, non-overlapping runs, adjacent equal runs merged.
const MARK_KEYS = ['b', 'i', 'u', 's', 'code', 'hl', 'href']
const sameStyle = (a, b) => MARK_KEYS.every((k) => (a[k] ?? false) === (b[k] ?? false))
const styleOf = (m) => { const o = {}; for (const k of MARK_KEYS) if (m[k]) o[k] = m[k]; return o }
export function normalizeMarks(marks) {
  const out = []
  for (const m of [...(marks || [])].sort((x, y) => x.from - y.from)) {
    if (m.to <= m.from || !Object.keys(styleOf(m)).length) continue
    const last = out[out.length - 1]
    if (last && last.to >= m.from && sameStyle(last, m)) last.to = Math.max(last.to, m.to)
    else out.push({ from: m.from, to: m.to, ...styleOf(m) })
  }
  return out
}
// the style at a text position (the run containing it), {} when plain
export function markAt(marks, pos) {
  for (const m of marks || []) if (pos >= m.from && pos < m.to) return styleOf(m)
  return {}
}
// does every character of [from, to) carry the key?
export function hasMark(marks, from, to, key) {
  if (to <= from) return !!markAt(marks, from)[key]
  let pos = from
  for (const m of marks || []) {
    if (m.to <= pos || m.from >= to) continue
    if (m.from > pos || !m[key]) return false
    pos = Math.min(m.to, to)
    if (pos >= to) return true
  }
  return false
}
// [from, to) with the key set (to `value`, true by default) or cleared;
// runs are split at the edges so the rest of the text keeps its marks
export function setMark(marks, from, to, key, on, value = true) {
  if (to <= from) return normalizeMarks(marks)
  const out = []
  for (const m of marks || []) {
    if (m.to <= from || m.from >= to) { out.push(m); continue }
    if (m.from < from) out.push({ ...m, to: from })
    if (m.to > to) out.push({ ...m, from: to })
    const mid = { ...m, from: Math.max(m.from, from), to: Math.min(m.to, to) }
    if (on) mid[key] = value; else delete mid[key]
    out.push(mid)
  }
  if (on) {
    // the stretches of [from, to) no run covered get a run of their own
    let pos = from
    for (const m of normalizeMarks(marks)) {
      if (m.to <= from || m.from >= to) continue
      if (m.from > pos) out.push({ from: pos, to: m.from, [key]: value })
      pos = Math.max(pos, m.to)
    }
    if (pos < to) out.push({ from: pos, to, [key]: value })
  }
  return normalizeMarks(out)
}

// where the text of a text/note/geo shape sits in its local frame:
// { lines, fontSize, font, lh, top, marks, text, left(line), scale }
function textBlock(shape) {
  const p = shape.props
  if (shape.type === 'text') {
    const l = textLayout(shape)
    const align = p.align || 'start'
    return { ...l, top: 0, marks: p.marks, text: p.text, scale: 1,
      left: (line) => (align === 'middle' ? l.w / 2 - line.w / 2 : align === 'end' ? l.w - line.w : 0) }
  }
  if (shape.type === 'note') {
    const l = noteLayout(shape)
    // notes centre their text unless told otherwise (older notes carry no align)
    const align = p.align || 'middle'
    return { ...l, top: Math.max(NOTE_PAD, l.boxH / 2 - l.textH / 2), marks: p.marks, text: p.text, scale: p.scale || 1,
      left: (line) => (align === 'start' ? NOTE_PAD : align === 'end' ? l.boxW - NOTE_PAD - line.w : l.boxW / 2 - line.w / 2) }
  }
  if (shape.type === 'geo') {
    const l = geoLabelLayout(shape)
    if (!l) return null
    return { ...l, top: p.h / 2 - l.textH / 2, marks: p.labelMarks, text: p.label, scale: 1, left: (line) => p.w / 2 - line.w / 2 }
  }
  return null
}

// What's under a shape-local point in the text: `offset`, the caret a
// click there would land at (the nearest character boundary), and `index`,
// the character the point is actually over (-1 past the line's end). Null
// when the shape has no text block.
export function textHitAt(shape, lx, ly) {
  const tb = textBlock(shape)
  if (!tb || !tb.lines.length) return null
  const x = lx / tb.scale, y = ly / tb.scale
  const li = Math.max(0, Math.min(tb.lines.length - 1, Math.floor((y - tb.top) / tb.lh)))
  const line = tb.lines[li]
  const ctx = measurer()
  let acc = tb.left(line)
  let pos = line.start
  for (const r of lineRuns(tb.text, line, tb.marks, tb.fontSize, tb.font)) {
    ctx.font = runFont(r.st, tb.fontSize, tb.font)
    for (const ch of r.str) {
      const w = ctx.measureText(ch).width
      if (x < acc + w) return { offset: x < acc + w / 2 ? pos : pos + ch.length, index: x >= acc ? pos : -1 }
      acc += w
      pos += ch.length
    }
  }
  return { offset: line.start + line.text.length, index: -1 }
}
export const textOffsetAt = (shape, lx, ly) => textHitAt(shape, lx, ly)?.offset ?? null

// the link under a shape-local point, or null
export function textLinkAt(shape, lx, ly) {
  const tb = textBlock(shape)
  if (!tb || !tb.marks?.some((m) => m.href)) return null
  const x = lx / tb.scale, y = ly / tb.scale
  const line = tb.lines[Math.floor((y - tb.top) / tb.lh)]
  if (!line || y < tb.top) return null
  const x0 = tb.left(line)
  for (const r of lineRuns(tb.text, line, tb.marks, tb.fontSize, tb.font)) {
    if (r.st.href && x >= x0 + r.x && x <= x0 + r.x + r.w) return r.st.href
  }
  return null
}

// the link badge a shape with a url wears at its top-right corner: local
// centre and radius
export const URL_BADGE = 9
export function urlBadgeAt(shape) {
  if (!shape.props.url) return null
  const lb = localBounds(shape)
  return { x: lb.x + lb.w - URL_BADGE - 3, y: lb.y + URL_BADGE + 3, r: URL_BADGE }
}

// ---- image crop ------------------------------------------------------------

// `crop` is normalized — { x, y, w, h } as fractions of the source picture —
// and absent means the whole picture. The shape's box (w×h) shows exactly
// that window, so the full source, laid in the shape's local frame, is the
// box scaled up by 1/crop and pushed back by the crop offset.
export function imageFrame(shape) {
  const p = shape.props
  const c = p.crop
  if (!c) return { x: 0, y: 0, w: p.w, h: p.h }
  const fw = p.w / (c.w || 1)
  const fh = p.h / (c.h || 1)
  return { x: -c.x * fw, y: -c.y * fh, w: fw, h: fh }
}

// ---- image assets ----------------------------------------------------------

const imgCache = new Map() // assetId -> { img, ready }
export function assetImage(store, assetId, onReady) {
  let e = imgCache.get(assetId)
  if (e) return e.ready ? e.img : null
  const asset = store.asset(assetId)
  if (!asset) return null
  const img = new Image()
  e = { img, ready: false }
  imgCache.set(assetId, e)
  img.onload = () => { e.ready = true; onReady && onReady() }
  // a picture hosted elsewhere (a tldraw paste that couldn't be fetched)
  // loads with CORS so export can still read the canvas; a host that won't
  // allow that gets a plain load, which shows but can't be exported
  const remote = /^https?:/i.test(asset.src)
  if (remote) img.crossOrigin = 'anonymous'
  img.onerror = () => {
    if (!remote || img.crossOrigin == null) return
    img.crossOrigin = null
    img.src = asset.src
  }
  img.src = asset.src
  return null
}

// ---- rendering -------------------------------------------------------------

export const dashFor = (dash, w) =>
  dash === 'dashed' ? [w * 3.2, w * 2.6] : dash === 'dotted' ? [0.01, w * 2.5] : null

function strokeStyled(ctx, dash, w) {
  ctx.lineWidth = w
  ctx.lineJoin = 'round'
  ctx.lineCap = dash === 'dotted' ? 'round' : 'round'
  const d = dashFor(dash, w)
  ctx.setLineDash(d || [])
}

// polygon path (wobbled for 'draw' dash), cached per props object
function geoPath(shape) {
  const p = shape.props
  let path = geoPathCache.get(p)
  if (path) return path
  path = new Path2D()
  buildGeoPath(path, shape)
  geoPathCache.set(p, path)
  return path
}
// The geo outline into any path sink (a Path2D, or the SVG export's string
// builder) — one geometry for the canvas and the file.
export function buildGeoPath(path, shape) {
  const p = shape.props
  if (p.geo === 'ellipse') {
    if (p.dash === 'draw') {
      const pts = wobblePolyline(ellipsePolygon(p.w, p.h, 40), shape.id, { step: 18, amp: Math.min(2, p.w / 40 + 0.6) })
      traceSmooth(path, pts, true)
      path.closePath()
    } else {
      path.ellipse(p.w / 2, p.h / 2, Math.max(0.5, p.w / 2), Math.max(0.5, p.h / 2), 0, 0, Math.PI * 2)
    }
  } else if (p.geo === 'cloud') {
    if (p.dash === 'draw') {
      // same treatment as the ellipse: sample the curve, wobble it, retrace
      // smoothly — so the cloud is hand-drawn like every other shape in the
      // default style rather than a lone crisp vector
      const pts = wobblePolyline(cloudPolygon(p.w, p.h), shape.id, { step: 18, amp: Math.min(2, (p.w + p.h) / 160 + 0.6) })
      traceSmooth(path, pts, true)
      path.closePath()
    } else {
      path.moveTo(CLOUD_START[0] * p.w, CLOUD_START[1] * p.h)
      for (const [c1x, c1y, c2x, c2y, ex, ey] of CLOUD_CURVES) {
        path.bezierCurveTo(c1x * p.w, c1y * p.h, c2x * p.w, c2y * p.h, ex * p.w, ey * p.h)
      }
      path.closePath()
    }
  } else {
    const poly = geoPolygon(p.geo, p.w, p.h)
    if (p.dash === 'draw') {
      const pts = wobblePolyline(poly, shape.id, { step: 22, amp: Math.min(2.2, (p.w + p.h) / 160 + 0.6) })
      const n = pts.length / 2
      path.moveTo(pts[0], pts[1])
      for (let i = 1; i < n; i++) path.lineTo(pts[i * 2], pts[i * 2 + 1])
      path.closePath()
    } else {
      const n = poly.length / 2
      path.moveTo(poly[0], poly[1])
      for (let i = 1; i < n; i++) path.lineTo(poly[i * 2], poly[i * 2 + 1])
      path.closePath()
    }
  }
}

const patternCache = new Map() // `${color}|${theme}` -> CanvasPattern
function hatchPattern(ctx, colorHex, themeId) {
  const key = colorHex + '|' + themeId
  let pat = patternCache.get(key)
  if (pat) return pat
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const pctx = c.getContext('2d')
  pctx.strokeStyle = colorHex
  pctx.globalAlpha = 0.55
  pctx.lineWidth = 1.4
  pctx.beginPath()
  // 45° lines, tiled
  pctx.moveTo(-2, 6); pctx.lineTo(6, -2)
  pctx.moveTo(2, 10); pctx.lineTo(10, 2)
  pctx.stroke()
  pat = ctx.createPattern(c, 'repeat')
  patternCache.set(key, pat)
  return pat
}

function fillPath(ctx, path, p, theme) {
  if (!p.fill || p.fill === 'none') return
  if (p.fill === 'semi') ctx.fillStyle = SEMI[theme.id]
  else if (p.fill === 'pattern') ctx.fillStyle = hatchPattern(ctx, theme.colors[p.color].stroke, theme.id)
  else ctx.fillStyle = theme.colors[p.color].fill
  ctx.fill(path)
}

// Draw laid-out lines, run by run: bold / italic / code change the font,
// highlight paints a band behind, links and underlines rule under, strike
// rules through. `left(line)` gives each line's left edge (alignment).
function drawTextLines(ctx, theme, tb, color, top) {
  const bl = lineBaseline(tb.font, tb.fontSize, tb.lh)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const rule = Math.max(1, tb.fontSize / 16)
  let y = top + bl
  for (const line of tb.lines) {
    const x0 = tb.left(line)
    for (const r of lineRuns(tb.text, line, tb.marks, tb.fontSize, tb.font)) {
      ctx.font = runFont(r.st, tb.fontSize, tb.font)
      if (r.st.hl) {
        ctx.fillStyle = theme.colors.yellow.note
        ctx.fillRect(x0 + r.x - 1, y - bl, r.w + 2, tb.lh)
      }
      ctx.fillStyle = color
      ctx.fillText(r.str, x0 + r.x, y)
      if (r.st.href || r.st.u) ctx.fillRect(x0 + r.x, y + tb.fontSize * 0.12, r.w, rule)
      if (r.st.s) ctx.fillRect(x0 + r.x, y - tb.fontSize * 0.3, r.w, rule)
    }
    y += tb.lh
  }
}
function drawLabel(ctx, theme, shape, color) {
  const tb = textBlock(shape)
  if (tb) drawTextLines(ctx, theme, tb, color, tb.top)
}
// the link badge: a small disc with an arrow, at the shape's top-right
function drawUrlBadge(ctx, theme, shape, color) {
  const b = urlBadgeAt(shape)
  if (!b) return
  ctx.save()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
  ctx.fillStyle = theme.handleFill
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(b.x - 3.5, b.y + 3.5)
  ctx.lineTo(b.x + 3.5, b.y - 3.5)
  ctx.moveTo(b.x - 1, b.y - 3.5)
  ctx.lineTo(b.x + 3.5, b.y - 3.5)
  ctx.lineTo(b.x + 3.5, b.y + 1)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.restore()
}

// the freehand outline as a Path2D, cached; live strokes (done !== true)
// rebuild every frame so the ink grows under the pen
function drawPath(shape) {
  const p = shape.props
  if (p.done) {
    const hit = outlineCache.get(p)
    if (hit) return hit
  }
  const path = new Path2D()
  buildInkPath(path, shape)
  if (p.done) outlineCache.set(p, path)
  return path
}
// the pencil's filled outline into any path sink (see buildGeoPath)
export function buildInkPath(path, shape) {
  const p = shape.props
  const outline = strokeOutline(p.pts, { size: INK_SIZES[p.size], simulate: !p.isPen })
  traceSmooth(path, outline, true)
  path.closePath()
}

// Draw one shape. ctx is already in PAGE space (camera applied by caller);
// this applies the shape's own translate/rotate.
// opts: { theme, store, zoom, onAssetLoad, ghost, hideText, cropPreview }
export function drawShape(ctx, shape, opts) {
  const { theme } = opts
  const p = shape.props
  const col = theme.colors[p.color || 'black']
  ctx.save()
  if (opts.ghost) ctx.globalAlpha = 0.3
  const lb = localBounds(shape)
  if (shape.rot) {
    const cx = shape.x + lb.x + lb.w / 2
    const cy = shape.y + lb.y + lb.h / 2
    ctx.translate(cx, cy)
    ctx.rotate(shape.rot)
    ctx.translate(-cx, -cy)
  }
  ctx.translate(shape.x, shape.y)

  switch (shape.type) {
    case 'draw': {
      // 'draw' dash = pressure ink; solid/dashed/dotted render the same
      // smoothed centerline at an even width so the line style reads true
      if (p.dash && p.dash !== 'draw') {
        ctx.strokeStyle = col.stroke
        strokeStyled(ctx, p.dash, SIZES[p.size])
        ctx.beginPath()
        const flat = []
        for (let i = 0; i < p.pts.length; i += 3) flat.push(p.pts[i], p.pts[i + 1])
        traceSmooth(ctx, flat)
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.fillStyle = col.stroke
        ctx.fill(drawPath(shape))
      }
      break
    }
    case 'highlight': {
      const a = (opts.ghost ? 0.3 : 1) * HIGHLIGHT_ALPHA
      ctx.strokeStyle = col.stroke
      ctx.lineWidth = SIZES[p.size] * HIGHLIGHT_SCALE
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const flat = []
      for (let i = 0; i < p.pts.length; i += 3) flat.push(p.pts[i], p.pts[i + 1])
      traceSmooth(ctx, flat)
      // multiply soaks into light paper; on dark paper it would blacken —
      // lighten glows instead, like a marker on a chalkboard
      ctx.globalAlpha = a
      ctx.globalCompositeOperation = theme.id === 'dark' ? 'lighten' : 'multiply'
      ctx.stroke()
      // …but either blend vanishes on pixels of the opposite extreme (a
      // black picture under multiply, a white one under lighten): a faint
      // plain pass keeps the band visible there
      ctx.globalAlpha = a * HIGHLIGHT_PLAIN
      ctx.globalCompositeOperation = 'source-over'
      ctx.stroke()
      break
    }
    case 'geo': {
      const path = geoPath(shape)
      fillPath(ctx, path, p, theme)
      ctx.strokeStyle = col.stroke
      strokeStyled(ctx, p.dash, SIZES[p.size])
      ctx.stroke(path)
      ctx.setLineDash([])
      if (opts.hideText !== 'label') drawLabel(ctx, theme, shape, col.stroke)
      break
    }
    case 'arrow':
    case 'line': {
      const w = SIZES[p.size]
      ctx.strokeStyle = col.stroke
      strokeStyled(ctx, p.dash, w)
      const bend = p.bend || 0
      const len = Math.hypot(p.dx, p.dy) || 1
      const nx = -p.dy / len, ny = p.dx / len
      const cx2 = p.dx / 2 + nx * bend * 2 // control point: bend*2 puts the CURVE at bend offset
      const cy2 = p.dy / 2 + ny * bend * 2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      if (bend) ctx.quadraticCurveTo(cx2, cy2, p.dx, p.dy)
      else ctx.lineTo(p.dx, p.dy)
      ctx.stroke()
      ctx.setLineDash([])
      if (shape.type === 'arrow') {
        // chevron head aligned with the end tangent
        const tx = p.dx - cx2, ty = p.dy - cy2
        const ta = bend ? Math.atan2(ty, tx) : Math.atan2(p.dy, p.dx)
        const hl = Math.min(Math.max(w * 3.2, 12), len * 0.4)
        ctx.beginPath()
        ctx.moveTo(p.dx - Math.cos(ta - 0.5) * hl, p.dy - Math.sin(ta - 0.5) * hl)
        ctx.lineTo(p.dx, p.dy)
        ctx.lineTo(p.dx - Math.cos(ta + 0.5) * hl, p.dy - Math.sin(ta + 0.5) * hl)
        ctx.lineWidth = w
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      break
    }
    case 'text': {
      if (opts.hideText !== 'text') drawLabel(ctx, theme, shape, col.stroke)
      break
    }
    case 'note': {
      const l = noteLayout(shape)
      const s = p.scale || 1
      ctx.scale(s, s)
      ctx.fillStyle = col.note
      ctx.beginPath()
      ctx.roundRect(0, 0, l.boxW, l.boxH, 6)
      ctx.shadowColor = 'rgba(20, 16, 8, 0.22)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetY = 4
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      if (opts.hideText !== 'text') drawLabel(ctx, theme, shape, theme.noteText)
      break
    }
    case 'image': {
      const img = assetImage(opts.store, p.assetId, opts.onAssetLoad)
      if (img) {
        if (opts.cropPreview) {
          // crop mode: the whole picture shows through faintly around the window
          const f = imageFrame(shape)
          ctx.save()
          ctx.globalAlpha *= 0.35
          ctx.drawImage(img, f.x, f.y, f.w, f.h)
          ctx.restore()
        }
        ctx.beginPath()
        ctx.roundRect(0, 0, p.w, p.h, 4)
        ctx.save()
        ctx.clip()
        const c = p.crop
        if (c) {
          const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height
          ctx.drawImage(img, c.x * sw, c.y * sh, c.w * sw, c.h * sh, 0, 0, p.w, p.h)
        } else ctx.drawImage(img, 0, 0, p.w, p.h)
        ctx.restore()
      } else {
        ctx.fillStyle = SEMI[theme.id]
        ctx.beginPath()
        ctx.roundRect(0, 0, p.w, p.h, 4)
        ctx.fill()
      }
      break
    }
  }
  // a shape that links somewhere wears a badge (notes draw in their own
  // scale, so it rides that too)
  if (p.url) drawUrlBadge(ctx, theme, shape, shape.type === 'note' ? theme.noteText : col.stroke)
  ctx.restore()
}

// ---- hit testing -----------------------------------------------------------

// point hit in PAGE space; returns true when (px,py) touches the shape
export function hitShape(shape, px, py, tol, store) {
  const b = pageBounds(shape)
  const wide = tol + SIZES[shape.props.size || 'm'] * 2
  if (!boundsContain({ x: b.x - wide, y: b.y - wide, w: b.w + wide * 2, h: b.h + wide * 2 }, px, py)) return false
  const l = toLocal(shape, px, py)
  const p = shape.props
  switch (shape.type) {
    case 'draw':
      return distToPolyline(l.x, l.y, p.pts, 3) <= tol + SIZES[p.size] * 0.9
    case 'highlight':
      return distToPolyline(l.x, l.y, p.pts, 3) <= tol + (SIZES[p.size] * HIGHLIGHT_SCALE) / 2
    case 'geo': {
      const edgeTol = tol + SIZES[p.size]
      if (p.geo === 'ellipse') {
        const inside = pointInEllipse(l.x, l.y, p.w / 2, p.h / 2, p.w / 2, p.h / 2)
        if (p.fill !== 'none' || p.label) return inside || nearEllipseEdge(l, p, edgeTol)
        return nearEllipseEdge(l, p, edgeTol)
      }
      const poly = geoPolygon(p.geo, p.w, p.h)
      if (p.fill !== 'none' || p.label) {
        if (pointInPolygon(l.x, l.y, poly)) return true
      }
      return distToPolyline(l.x, l.y, poly, 2, true) <= edgeTol
    }
    case 'arrow':
    case 'line': {
      const pts = sampleLinePts(p, p.bend || 0)
      return distToPolyline(l.x, l.y, pts, 2) <= tol + SIZES[p.size]
    }
    case 'text':
    case 'note':
    case 'image': {
      const lb = localBounds(shape)
      return l.x >= lb.x - tol && l.x <= lb.x + lb.w + tol && l.y >= lb.y - tol && l.y <= lb.y + lb.h + tol
    }
  }
  return false
}

const nearEllipseEdge = (l, p, tol) => {
  const rx = p.w / 2, ry = p.h / 2
  if (rx <= 0 || ry <= 0) return false
  const outer = pointInEllipse(l.x, l.y, rx, ry, rx + tol, ry + tol)
  const inner = pointInEllipse(l.x, l.y, rx, ry, Math.max(0.5, rx - tol), Math.max(0.5, ry - tol))
  return outer && !inner
}

export const sampleLinePts = (p, bend) => {
  if (!bend) return [0, 0, p.dx, p.dy]
  const len = Math.hypot(p.dx, p.dy) || 1
  const nx = -p.dy / len, ny = p.dx / len
  const cx = p.dx / 2 + nx * bend * 2
  const cy = p.dy / 2 + ny * bend * 2
  const pts = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const mt = 1 - t
    pts.push(mt * mt * 0 + 2 * mt * t * cx + t * t * p.dx, mt * mt * 0 + 2 * mt * t * cy + t * t * p.dy)
  }
  return pts
}

// marquee (page-space rect) selection test
export function marqueeHits(shape, rect) {
  const b = pageBounds(shape)
  if (!boundsIntersect(b, rect)) return false
  // solid-bodied shapes select on bounds overlap
  if (['text', 'note', 'image'].includes(shape.type)) return true
  if (shape.type === 'geo' && shape.props.fill !== 'none') return true
  // stroke shapes want a real graze — cheap test on their (unrotated) points
  if (shape.rot) return true
  const p = shape.props
  const local = { x: rect.x - shape.x, y: rect.y - shape.y, w: rect.w, h: rect.h }
  let pts, stride = 2
  if (shape.type === 'draw' || shape.type === 'highlight') { pts = p.pts; stride = 3 }
  else if (shape.type === 'arrow' || shape.type === 'line') pts = sampleLinePts(p, p.bend || 0)
  else if (shape.type === 'geo') { pts = geoPolygon(p.geo, p.w, p.h); if (pointInPolygon(local.x + local.w / 2, local.y + local.h / 2, pts)) return true }
  if (!pts) return true
  const n = Math.floor(pts.length / stride)
  if (n === 1) return boundsContain(local, pts[0], pts[1])
  for (let i = 0; i < n - 1; i++) {
    if (segIntersectsBounds(pts[i * stride], pts[i * stride + 1], pts[(i + 1) * stride], pts[(i + 1) * stride + 1], local)) return true
  }
  // closed geo outline: also test the closing edge
  if (shape.type === 'geo' && n > 2) {
    if (segIntersectsBounds(pts[(n - 1) * stride], pts[(n - 1) * stride + 1], pts[0], pts[1], local)) return true
  }
  return false
}

// ---- transforms ------------------------------------------------------------

// scale a shape's local geometry about the LOCAL origin; caller repositions
// x/y. Returns a new shape.
// opts.handle: which handle pulled — text takes its top/bottom edge as a
// type-size handle (the font scales, the wrap width stays)
export function scaleShape(shape, sx, sy, { handle } = {}) {
  const p = shape.props
  switch (shape.type) {
    case 'draw':
    case 'highlight': {
      const pts = p.pts.slice()
      for (let i = 0; i < pts.length; i += 3) {
        pts[i] *= sx
        pts[i + 1] *= sy
      }
      return { ...shape, props: { ...p, pts } }
    }
    case 'geo':
      return { ...shape, props: { ...p, w: Math.max(1, p.w * sx), h: Math.max(1, p.h * sy) } }
    case 'arrow':
    case 'line':
      return { ...shape, props: { ...p, dx: p.dx * sx, dy: p.dy * sy, ...(p.bend ? { bend: p.bend * Math.sqrt(Math.abs(sx * sy)) } : {}) } }
    case 'image':
      return { ...shape, props: { ...p, w: Math.max(1, p.w * sx), h: Math.max(1, p.h * sy) } }
    case 'text': {
      if (handle === 't' || handle === 'b') {
        return { ...shape, props: { ...p, scale: Math.max(0.2, (p.scale || 1) * sy) } }
      }
      if (Math.abs(sx - sy) > 1e-9) {
        // a side pull sets the wrap width; the type keeps its size and
        // reflows, so the pulled edge lands where the pointer is
        const w = (p.autosize === false && p.w ? p.w : textLayout(shape).w) * sx
        return { ...shape, props: { ...p, autosize: false, w: Math.max(20, w) } }
      }
      // a uniform (corner) scale grows the type itself
      return { ...shape, props: { ...p, scale: Math.max(0.2, (p.scale || 1) * sx), ...(p.autosize === false && p.w ? { w: p.w * sx } : {}) } }
    }
    case 'note': {
      // the box resizes freely; the type keeps its size and rewraps
      const lay = noteLayout(shape)
      return { ...shape, props: { ...p, w: Math.max(60, lay.boxW * sx), h: Math.max(40, lay.boxH * sy) } }
    }
    default:
      return shape
  }
}
