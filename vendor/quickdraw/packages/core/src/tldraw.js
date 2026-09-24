// tldraw import: what you copy in tldraw pastes here as our shapes. tldraw
// writes its clipboard as a hidden <div data-tldraw> in the HTML entry —
// plain JSON in its versions 2 and 3 (v3 keeps the image assets plain and
// lz-string-compresses the rest), lz-string base64 in older builds — with
// the shapes, the arrow bindings and the image assets. This module reads
// all three, decodes the stroke paths, and maps every shape type it can
// onto ours: text, notes, geo, freehand ink, highlights, arrows and lines
// (bindings included), images with their crop, frames, and groups.
// Dependency-free ESM: the two codecs tldraw relies on are ported inline.

import { localBounds } from './shapes.js'
import { rotWith } from './geometry.js'
import { COLOR_IDS } from './palette.js'

// ---- lz-string: decompressFromBase64 ---------------------------------------
// A faithful port of the one routine we need from pieroxy's lz-string
// (MIT). tldraw compresses its clipboard payload with it.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]))

export function decompressFromBase64(input) {
  if (input == null) return ''
  if (input === '') return null
  return lzDecompress(input.length, 32, (i) => B64_INDEX.get(input.charAt(i)) ?? 0)
}

function lzDecompress(length, resetValue, getNextValue) {
  const dictionary = []
  let enlargeIn = 4, dictSize = 4, numBits = 3, entry = '', w, c
  const result = []
  const data = { val: getNextValue(0), position: resetValue, index: 1 }
  for (let i = 0; i < 3; i++) dictionary[i] = i
  const readBits = (n) => {
    let bits = 0, power = 1
    const maxpower = Math.pow(2, n)
    while (power !== maxpower) {
      const resb = data.val & data.position
      data.position >>= 1
      if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++) }
      bits |= (resb > 0 ? 1 : 0) * power
      power <<= 1
    }
    return bits
  }
  switch (readBits(2)) {
    case 0: c = String.fromCharCode(readBits(8)); break
    case 1: c = String.fromCharCode(readBits(16)); break
    case 2: return ''
  }
  dictionary[3] = c
  w = c
  result.push(c)
  for (;;) {
    if (data.index > length) return ''
    c = readBits(numBits)
    switch (c) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(readBits(8))
        c = dictSize - 1
        enlargeIn--
        break
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(16))
        c = dictSize - 1
        enlargeIn--
        break
      case 2:
        return result.join('')
    }
    if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++ }
    if (dictionary[c]) entry = dictionary[c]
    else if (c === dictSize) entry = w + w.charAt(0)
    else return null
    result.push(entry)
    dictionary[dictSize++] = w + entry.charAt(0)
    enlargeIn--
    w = entry
    if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++ }
  }
}

// ---- tldraw's stroke path codec --------------------------------------------
// Draw and highlight segments carry their points as base64: the first point
// as three little-endian Float32s, every later point as Float16 deltas.
// `dim` 2 leaves the pressure out (it's the 0.5 default).

const float16 = (bits) => {
  const sign = bits >> 15, exp = (bits >> 10) & 0x1f, frac = bits & 0x3ff
  let v
  if (exp === 0) v = frac * (Math.pow(2, -14) / 1024)
  else if (exp === 31) v = frac ? NaN : Infinity
  else v = Math.pow(2, exp - 15) * (1 + frac / 1024)
  return sign ? -v : v
}
const bytesOf = (b64) => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// flat [x, y, pressure, ...] triplets
export function decodeDrawPath(b64, dim = 3) {
  if (!b64) return []
  const bytes = bytesOf(b64)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const f16 = (o) => (dv.getFloat16 ? dv.getFloat16(o, true) : float16(dv.getUint16(o, true)))
  const head = dim === 2 ? 8 : 12
  if (bytes.length < head) return []
  let x = dv.getFloat32(0, true), y = dv.getFloat32(4, true)
  let z = dim === 2 ? 0.5 : dv.getFloat32(8, true)
  const out = [x, y, z]
  const step = dim === 2 ? 4 : 6
  for (let o = head; o + step <= bytes.length; o += step) {
    x += f16(o)
    y += f16(o + 2)
    if (dim !== 2) z += f16(o + 4)
    out.push(x, y, z)
  }
  return out
}

// ---- the clipboard payload ------------------------------------------------

// tldraw's content ({ shapes, bindings, assets, rootShapeIds, schema }) from
// the HTML (or text) it put on the clipboard, or null when it isn't tldraw's
export function parseTldrawClipboard(text) {
  if (!text) return null
  const m = String(text).match(/<div data-tldraw[^>]*>([\s\S]*?)<\/div>/)
  if (!m) return null
  let raw = m[1].trim()
  // the HTML entry may have been entity-escaped in transit
  if (raw.includes('&quot;') || raw.includes('&amp;')) raw = unescapeHtml(raw)
  let json
  try { json = JSON.parse(raw) } catch {
    try { json = JSON.parse(decompressFromBase64(raw) || '') } catch { return null }
  }
  if (!json || json.type !== 'application/tldraw') return null
  try {
    if (json.version === 3) {
      const other = JSON.parse(decompressFromBase64(json.data.otherCompressed) || '{}')
      return { assets: json.data.assets || [], ...other }
    }
    return json.data || null // v2 and the legacy payload carry the content plainly
  } catch { return null }
}
const unescapeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// ---- conversion ------------------------------------------------------------

const GEO_MAP = {
  rectangle: 'rectangle', ellipse: 'ellipse', oval: 'ellipse', triangle: 'triangle',
  diamond: 'diamond', rhombus: 'diamond', 'rhombus-2': 'diamond', hexagon: 'hexagon',
  pentagon: 'hexagon', octagon: 'hexagon', star: 'star', cloud: 'cloud', heart: 'cloud',
}
const color = (c) => (COLOR_IDS.includes(c) ? c : c === 'white' ? 'grey' : 'black')
const size = (s) => (['s', 'm', 'l', 'xl'].includes(s) ? s : 'm')
const font = (f) => (['draw', 'sans', 'serif', 'mono'].includes(f) ? f : 'draw')
const dash = (d) => (['draw', 'solid', 'dashed', 'dotted'].includes(d) ? d : 'draw')
const fill = (f) => (f === 'fill' ? 'solid' : ['none', 'semi', 'solid', 'pattern'].includes(f) ? f : 'none')

// tldraw's rich text (TipTap JSON), or a legacy string, as our text plus
// marks: runs of { from, to } with b / i / u / s / code / hl / href
export function richTextToText(rt) {
  if (rt == null) return { text: '', marks: [] }
  if (typeof rt === 'string') return { text: rt, marks: [] }
  let text = ''
  const marks = []
  const MARK = { bold: 'b', italic: 'i', underline: 'u', strike: 's', code: 'code', highlight: 'hl' }
  const walk = (node) => {
    if (!node) return
    if (node.type === 'text') {
      const from = text.length
      text += node.text || ''
      const st = {}
      for (const m of node.marks || []) {
        if (m.type === 'link' && m.attrs?.href) st.href = m.attrs.href
        else if (MARK[m.type]) st[MARK[m.type]] = true
      }
      if (Object.keys(st).length && text.length > from) marks.push({ from, to: text.length, ...st })
      return
    }
    if (node.type === 'hardBreak') { text += '\n'; return }
    const kids = node.content || []
    if (node.type === 'listItem') text += '• '
    kids.forEach((k, i) => {
      // blocks stack as lines; inline content runs on
      if (i && ['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList'].includes(k.type)) text += '\n'
      walk(k)
    })
  }
  walk(rt)
  return { text, marks }
}
export const richTextToPlain = (rt) => richTextToText(rt).text
// tabs come through as spaces (see the editor's normalizeText); marks shift with them
function untab({ text, marks }) {
  if (!text.includes('\t')) return { text, marks }
  const out = []
  let t = ''
  const map = new Array(text.length + 1)
  for (let i = 0; i < text.length; i++) { map[i] = t.length; t += text[i] === '\t' ? '    ' : text[i] }
  map[text.length] = t.length
  for (const m of marks) out.push({ ...m, from: map[m.from], to: map[m.to] })
  return { text: t, marks: out }
}

// segments → flat [x, y, pressure] triplets, whatever encoding they use
function segmentPoints(segments, scaleX = 1, scaleY = 1) {
  const pts = []
  for (const seg of segments || []) {
    if (seg.path != null) {
      const d = decodeDrawPath(seg.path, seg.dim)
      for (let i = 0; i < d.length; i += 3) pts.push(d[i] * scaleX, d[i + 1] * scaleY, d[i + 2])
    } else {
      for (const p of seg.points || []) pts.push(p.x * scaleX, p.y * scaleY, p.z ?? 0.5)
    }
  }
  return pts
}

// Convert tldraw content to { shapes, assets }: our records, still carrying
// tldraw's ids (the editor hands out fresh ones on paste). Positions are
// page-absolute — tldraw nests children in groups and frames — and each
// rotated shape is placed so it lands where tldraw showed it (tldraw turns
// a shape about its origin, we turn it about its centre).
export function convertTldrawContent(content) {
  const shapes = (content?.shapes || []).filter((s) => s && s.typeName === 'shape')
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const kids = new Map()
  for (const s of shapes) {
    const pid = byId.has(s.parentId) ? s.parentId : null
    if (!kids.has(pid)) kids.set(pid, [])
    kids.get(pid).push(s)
  }
  const byIndex = (a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)
  // arrow bindings by arrow id (tldraw v3 keeps them as separate records)
  const bindings = new Map()
  for (const b of content?.bindings || []) {
    if (b?.type !== 'arrow') continue
    if (!bindings.has(b.fromId)) bindings.set(b.fromId, {})
    bindings.get(b.fromId)[b.props?.terminal] = b
  }

  const out = []
  let z = 0
  const walk = (parentId, origin, rot, groupId) => {
    for (const s of (kids.get(parentId) || []).slice().sort(byIndex)) {
      const o = rotWith(origin.x + s.x, origin.y + s.y, origin.x, origin.y, rot)
      const r = rot + (s.rotation || 0)
      let group = groupId
      if (s.type === 'group') group = group || 'group:' + s.id // flat groups: the outermost wins
      const rec = convertShape(s, o, r, bindings.get(s.id))
      if (rec) {
        rec.z = ++z
        if (group) rec.groupId = group
        out.push(rec)
      }
      walk(s.id, o, r, group)
    }
  }
  walk(null, { x: 0, y: 0 }, 0, null)

  const assets = (content?.assets || [])
    .filter((a) => a && a.type === 'image' && a.props?.src)
    .map((a) => ({ id: a.id, typeName: 'asset', src: a.props.src, w: a.props.w || 1, h: a.props.h || 1 }))
  return { shapes: out, assets }
}

// one tldraw shape → our record at page origin `o` with rotation `r`
function convertShape(s, o, r, binds) {
  const p = s.props || {}
  const base = { id: s.id, typeName: 'shape', x: o.x, y: o.y, rot: 0, z: 0 }
  switch (s.type) {
    case 'text': {
      const { text, marks } = untab(richTextToText(p.richText ?? p.text))
      return placed({
        ...base, type: 'text',
        props: {
          text, color: color(p.color), size: size(p.size), font: font(p.font),
          align: p.textAlign || p.align || 'start', autosize: p.autoSize !== false, scale: p.scale || 1,
          ...(p.autoSize === false && p.w ? { w: p.w } : {}),
          ...(marks.length ? { marks } : {}), ...link(p),
        },
      }, o, r)
    }
    case 'note': {
      const { text, marks } = untab(richTextToText(p.richText ?? p.text))
      return placed({
        ...base, type: 'note',
        props: { text, color: color(p.color), size: size(p.size), font: font(p.font), scale: p.scale || 1, ...(marks.length ? { marks } : {}), ...link(p) },
      }, o, r)
    }
    case 'geo': {
      const { text: label, marks } = untab(richTextToText(p.richText ?? p.text))
      return placed({
        ...base, type: 'geo',
        props: {
          geo: GEO_MAP[p.geo] || 'rectangle', w: Math.max(1, p.w || 1), h: Math.max(1, (p.h || 1) + (p.growY || 0)),
          color: color(p.color), size: size(p.size), dash: dash(p.dash), fill: fill(p.fill), font: font(p.font),
          ...(label ? { label, labelSize: size(p.size), ...(marks.length ? { labelMarks: marks } : {}) } : {}),
          ...link(p),
        },
      }, o, r)
    }
    case 'frame':
      return placed({
        ...base, type: 'geo',
        props: {
          geo: 'rectangle', w: Math.max(1, p.w || 1), h: Math.max(1, p.h || 1),
          color: color(p.color || 'black'), size: 's', dash: 'solid', fill: 'none', font: 'sans',
          ...(p.name ? { label: p.name, labelSize: 's' } : {}),
        },
      }, o, r)
    case 'draw':
    case 'highlight': {
      const pts = segmentPoints(p.segments, p.scaleX || 1, p.scaleY || 1)
      if (pts.length < 3) return null
      return placed({
        ...base, type: s.type,
        props: {
          pts, color: color(p.color), size: size(p.size), done: true,
          ...(s.type === 'draw' ? { dash: dash(p.dash) } : {}),
          ...(p.isPen ? { isPen: true } : {}),
        },
      }, o, r)
    }
    case 'arrow': {
      // terminals: v3 keeps points on the shape and bindings beside it;
      // older data had { type: 'binding' | 'point' } terminals inline
      const term = (t, which) => {
        const b = binds?.[which]
        if (b) return { x: t?.x || 0, y: t?.y || 0, bind: { id: b.toId, ...anchor(b.props) } }
        if (t?.type === 'binding') return { x: 0, y: 0, bind: { id: t.boundShapeId, ...anchor(t) } }
        return { x: t?.x || 0, y: t?.y || 0, bind: null }
      }
      let a = term(p.start, 'start'), b = term(p.end, 'end')
      let bend = p.kind === 'elbow' ? 0 : p.bend || 0
      const headAt = (v) => v && v !== 'none'
      let type = 'arrow'
      if (!headAt(p.arrowheadEnd) && headAt(p.arrowheadStart)) { [a, b] = [b, a]; bend = -bend } // head at the start: flip it round
      else if (!headAt(p.arrowheadEnd) && !headAt(p.arrowheadStart)) type = 'line'
      // bake the shape's rotation into the vector — our arrows don't turn
      const pa = rotWith(o.x + a.x, o.y + a.y, o.x, o.y, r)
      const pb = rotWith(o.x + b.x, o.y + b.y, o.x, o.y, r)
      return {
        ...base, type, x: pa.x, y: pa.y,
        props: {
          dx: pb.x - pa.x || 0.01, dy: pb.y - pa.y || 0.01, bend,
          color: color(p.color), size: size(p.size), dash: p.dash === 'draw' ? 'solid' : dash(p.dash),
          ...(a.bind ? { startBind: a.bind } : {}), ...(b.bind ? { endBind: b.bind } : {}),
        },
      }
    }
    case 'line': {
      const pts = Object.values(p.points || {}).sort(byIndexKey)
      if (pts.length < 2) return null
      const abs = pts.map((q) => rotWith(o.x + q.x, o.y + q.y, o.x, o.y, r))
      const d = p.dash === 'draw' ? 'solid' : dash(p.dash)
      if (abs.length === 2) {
        return {
          ...base, type: 'line', x: abs[0].x, y: abs[0].y,
          props: { dx: abs[1].x - abs[0].x || 0.01, dy: abs[1].y - abs[0].y || 0.01, bend: 0, color: color(p.color), size: size(p.size), dash: d },
        }
      }
      // a polyline (or spline) becomes an even-width stroke through its points
      const flat = []
      for (const q of abs) flat.push(q.x - abs[0].x, q.y - abs[0].y, 0.5)
      return { ...base, type: 'draw', x: abs[0].x, y: abs[0].y, props: { pts: flat, color: color(p.color), size: size(p.size), dash: d, done: true } }
    }
    case 'image': {
      const c = p.crop
      const crop = c?.topLeft && c?.bottomRight
        ? { x: c.topLeft.x, y: c.topLeft.y, w: c.bottomRight.x - c.topLeft.x, h: c.bottomRight.y - c.topLeft.y }
        : null
      const full = !crop || (crop.x <= 0 && crop.y <= 0 && crop.w >= 1 && crop.h >= 1)
      return placed({
        ...base, type: 'image',
        props: { w: Math.max(1, p.w || 1), h: Math.max(1, p.h || 1), assetId: p.assetId, ...(full ? {} : { crop }), ...link(p) },
      }, o, r)
    }
    default:
      return null // groups have no body; embeds, videos and bookmarks have no twin here
  }
}
// a shape-level link (tldraw's `url` prop) comes along as ours
const link = (p) => (typeof p.url === 'string' && /^(https?:|mailto:)/i.test(p.url) ? { url: p.url } : {})
const anchor = (bp) => {
  const a = bp?.isPrecise === false || !bp?.normalizedAnchor ? { x: 0.5, y: 0.5 } : bp.normalizedAnchor
  return { nx: a.x, ny: a.y }
}
const byIndexKey = (a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)

// tldraw rotates a shape about its origin; we rotate about the centre of
// its box. Put our centre where tldraw's ended up and the shape lands where
// it was — for that the box must be measured, so this runs after props are set.
function placed(rec, o, r) {
  if (!r) return rec
  rec.rot = r
  const lb = localBounds(rec)
  const c = rotWith(o.x + lb.x + lb.w / 2, o.y + lb.y + lb.h / 2, o.x, o.y, r)
  rec.x = c.x - lb.x - lb.w / 2
  rec.y = c.y - lb.y - lb.h / 2
  return rec
}
