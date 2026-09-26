// Arrow bindings: an arrow's (or line's) end can be tied to a shape. The
// binding remembers where on the shape it points — an anchor in the shape's
// box, as fractions — and the end is placed where the arrow's path enters
// the shape's outline, so the arrow stops at the edge and follows the shape
// when it moves, resizes or rotates. Stored on the arrow's props as
// `startBind` / `endBind`: { id, nx, ny }. Dependency-free ESM.

import { localBounds, lineHeads } from './shapes.js'
import { rotWith, geoPolygon, ellipsePolygon, pointInPolygon } from './geometry.js'
import { SIZES } from './palette.js'

// what an arrow can tie to: shapes with a body. Ink and other arrows can't
// hold an end.
export const BINDABLE = new Set(['geo', 'text', 'note', 'image'])

const frame = (shape) => {
  const lb = localBounds(shape)
  return { lb, cx: shape.x + lb.x + lb.w / 2, cy: shape.y + lb.y + lb.h / 2 }
}

// the shape's outline as a page-space polygon, flat [x, y, ...]
export function outlinePolygon(shape) {
  const { lb, cx, cy } = frame(shape)
  const p = shape.props
  const poly = shape.type === 'geo'
    ? (p.geo === 'ellipse' ? ellipsePolygon(p.w, p.h, 48) : geoPolygon(p.geo, p.w, p.h))
    : [lb.x, lb.y, lb.x + lb.w, lb.y, lb.x + lb.w, lb.y + lb.h, lb.x, lb.y + lb.h]
  const out = []
  for (let i = 0; i < poly.length; i += 2) {
    const r = rotWith(shape.x + poly[i], shape.y + poly[i + 1], cx, cy, shape.rot || 0)
    out.push(r.x, r.y)
  }
  return out
}

// is the page point inside the shape's body?
export const insideShape = (shape, px, py) => pointInPolygon(px, py, outlinePolygon(shape))

// page point → anchor in the shape's box (0..1 each way), rotation undone.
// Points near the middle snap to the centre — that's where most arrows want
// to aim — unless `precise` asks for the exact spot.
export function anchorAt(shape, px, py, { precise = false } = {}) {
  const { lb, cx, cy } = frame(shape)
  const r = rotWith(px, py, cx, cy, -(shape.rot || 0))
  let nx = (r.x - shape.x - lb.x) / (lb.w || 1)
  let ny = (r.y - shape.y - lb.y) / (lb.h || 1)
  if (!precise && Math.abs(nx - 0.5) < 0.25 && Math.abs(ny - 0.5) < 0.25) nx = ny = 0.5
  return { nx, ny }
}

// the anchor back on the page
export function anchorPoint(shape, nx, ny) {
  const { lb, cx, cy } = frame(shape)
  return rotWith(shape.x + lb.x + nx * lb.w, shape.y + lb.y + ny * lb.h, cx, cy, shape.rot || 0)
}

// t along a→b where it crosses c→d, or null
const segT = (ax, ay, bx, by, cx, cy, dx, dy) => {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

// where a→b first enters the polygon, as t along a→b; null if never
function entryT(ax, ay, bx, by, poly) {
  let best = null
  const n = poly.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const t = segT(ax, ay, bx, by, poly[i * 2], poly[i * 2 + 1], poly[j * 2], poly[j * 2 + 1])
    if (t !== null && (best === null || t < best)) best = t
  }
  return best
}

// The terminals an arrow's bindings put it at: page points { start, end },
// or null when nothing is bound. A bound end aims at its anchor from the
// other end (from the curve's control point when the arrow bends, so the
// tangent is right) and lands where that ray enters the shape's outline.
// An arrowhead stops a little short so the tip doesn't sit on the line.
export function boundTerminals(arrow, store) {
  const p = arrow.props
  const sb = p.startBind && store.get(p.startBind.id)
  const eb = p.endBind && store.get(p.endBind.id)
  if (!sb && !eb) return null
  const w = SIZES[p.size] || 4
  let start = sb ? anchorPoint(sb, p.startBind.nx, p.startBind.ny) : { x: arrow.x, y: arrow.y }
  let end = eb ? anchorPoint(eb, p.endBind.nx, p.endBind.ny) : { x: arrow.x + p.dx, y: arrow.y + p.dy }
  const place = (shape, bind, from, gap) => {
    const a = anchorPoint(shape, bind.nx, bind.ny)
    const t = entryT(from.x, from.y, a.x, a.y, outlinePolygon(shape))
    if (t === null) return a // the ray starts inside: point at the anchor itself
    const ux = a.x - from.x, uy = a.y - from.y
    const d = Math.hypot(ux, uy) || 1
    return { x: from.x + ux * t - (ux / d) * gap, y: from.y + uy * t - (uy / d) * gap }
  }
  const solve = () => {
    const dx = end.x - start.x, dy = end.y - start.y
    const len = Math.hypot(dx, dy) || 1
    const bend = p.bend || 0
    const ctrl = bend ? { x: start.x + dx / 2 + (-dy / len) * bend * 2, y: start.y + dy / 2 + (dx / len) * bend * 2 } : null
    // an end wearing a head stops short of the outline so the head's tip sits on it
    const heads = lineHeads(arrow)
    const gap = (head) => (head !== 'none' ? w * 1.2 + 1 : w * 0.5)
    return {
      start: sb ? place(sb, p.startBind, ctrl || end, gap(heads.start)) : start,
      end: eb ? place(eb, p.endBind, ctrl || start, gap(heads.end)) : end,
    }
  }
  let r = solve()
  // the bend's control point depends on the terminals: a second pass settles it
  if (p.bend) { start = r.start; end = r.end; r = solve() }
  return r
}

// The arrow re-solved against the store: bindings to shapes that are gone
// are dropped, bound ends land on their outlines. Returns the same record
// when nothing changes, so a reactor can stop.
export function rebindArrow(arrow, store) {
  let props = arrow.props
  for (const k of ['startBind', 'endBind']) {
    if (props[k] && !store.get(props[k].id)) { const { [k]: _gone, ...rest } = props; props = rest }
  }
  const a = props === arrow.props ? arrow : { ...arrow, props }
  const t = boundTerminals(a, store)
  if (!t) return a
  const dx = t.end.x - t.start.x, dy = t.end.y - t.start.y
  const eq = (u, v) => Math.abs(u - v) < 1e-6
  if (eq(t.start.x, a.x) && eq(t.start.y, a.y) && eq(dx, a.props.dx) && eq(dy, a.props.dy)) return a
  return { ...a, x: t.start.x, y: t.start.y, props: { ...a.props, dx, dy } }
}

// bindings that point at ids outside `kept` are dropped; ids in `remap`
// are rewritten — for duplicating and pasting an arrow with (or without)
// the shapes it's tied to
export function remapBindings(props, remap) {
  let out = props
  for (const k of ['startBind', 'endBind']) {
    const b = out[k]
    if (!b) continue
    if (remap[b.id]) out = { ...out, [k]: { ...b, id: remap[b.id] } }
    else { const { [k]: _gone, ...rest } = out; out = rest }
  }
  return out
}
