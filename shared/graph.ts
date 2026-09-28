import type { BoardRecord } from '@quickdrawjs/core'
import type { Box } from './bounds'

/**
 * A zoned graph laid out as records: zones side by side (wrapping to rows),
 * each a dashed box with a title and its nodes in a grid, every node a box
 * sized to its label; edges are arrows tied to both ends, with their captions
 * set off to one side where the line is clear, else in a legend below.
 * Pure: the caller mints ids and decides where it goes.
 */

export interface GraphNode {
  /** How edges name it. */
  id: string
  label: string
  /** rectangle by default; ellipse, diamond, ... */
  geo?: string
  color?: string
}

export interface GraphZone {
  title?: string
  color?: string
  nodes: GraphNode[]
  /** Nodes per row; default about the square root of the count. */
  columns?: number
}

export interface GraphEdge {
  from: string
  to: string
  label?: string
  color?: string
  dashed?: boolean
  /** arrow (default), none, or both. */
  head?: 'arrow' | 'none' | 'both'
}

export interface GraphSpec {
  title?: string
  zones: GraphZone[]
  edges?: GraphEdge[]
  caption?: string
  /** How wide a row of zones may run before the next zone starts a new row. */
  maxWidth?: number
}

/** Quickdraw's label metrics: size s labels, 12 of padding inside the box. */
const LABEL_FONT = 20
const LABEL_LINE = LABEL_FONT * 1.3
const LABEL_PAD = 12
const CHAR_W = LABEL_FONT * 0.6
const NODE_MIN_W = 120
const NODE_MAX_W = 280
const NODE_GAP = 20
const ZONE_PAD = 20
const ZONE_GAP = 48
const ZONE_TITLE_FONT = 26
const ZONE_TITLE_H = ZONE_TITLE_FONT * 1.32 + 12
const TITLE_FONT = 36

/** Lines a label takes at a width, word-wrapped roughly the way the board does it. */
export function labelLines(label: string, width: number): number {
  const perLine = Math.max(1, Math.floor((width - LABEL_PAD * 2) / CHAR_W))
  let lines = 0
  for (const para of label.split('\n')) {
    let line = 0
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const need = (line ? line + 1 : 0) + word.length
      if (line && need > perLine) {
        lines++
        line = word.length
      } else line = need
    }
    lines++
  }
  return lines
}

/** The box a label needs: as wide as its longest word or line up to the cap, and as tall as its wrapped lines. */
export function fitLabel(label: string): { w: number; h: number } {
  const longestWord = Math.max(...label.split(/\s+/).map((w) => w.length), 1)
  const natural = Math.max(...label.split('\n').map((l) => l.length), 1) * CHAR_W + LABEL_PAD * 2 + 8
  const w = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, longestWord * CHAR_W + LABEL_PAD * 2 + 8, natural))
  const h = Math.max(44, labelLines(label, w) * LABEL_LINE + LABEL_PAD * 2)
  return { w: Math.ceil(w), h: Math.ceil(h) }
}

export interface LaidGraph {
  records: BoardRecord[]
  bounds: Box
  /** Node name → record id. */
  nodeIds: Record<string, string>
}

export function layoutGraph(spec: GraphSpec, at: { x: number; y: number }, mint: (kind: string) => string, baseZ = 1): LaidGraph {
  const records: BoardRecord[] = []
  const nodeIds: Record<string, string> = {}
  const nodeBoxes: Record<string, Box> = {}
  let z = baseZ
  const shape = (type: string, x: number, y: number, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const rec = { id: mint(type), typeName: 'shape', type, x, y, rot: 0, z: z++, props, ...extra } as unknown as BoardRecord
    records.push(rec)
    return rec
  }
  const text = (x: number, y: number, str: string, size: 's' | 'm' | 'l', opts: { color?: string; w?: number; align?: string; font?: string } = {}) =>
    shape('text', x, y, {
      text: str,
      color: opts.color ?? 'black',
      size,
      font: opts.font ?? 'sans',
      align: opts.align ?? 'start',
      autosize: opts.w === undefined,
      ...(opts.w !== undefined ? { w: opts.w } : {}),
      scale: 1,
    })

  let cursorY = at.y
  if (spec.title) {
    text(at.x, cursorY, spec.title, 'l', { font: 'serif' })
    cursorY += TITLE_FONT * 1.32 + 24
  }

  // zones: each sized from its grid of label-fitted nodes, placed left to right, wrapping
  const maxWidth = spec.maxWidth ?? 2600
  let rowX = at.x
  let rowY = cursorY
  let rowH = 0
  let right = at.x
  for (const zone of spec.zones) {
    const n = zone.nodes.length
    // a couple of columns by default (a zone reads as a list), more only for big zones
    const cols = Math.max(1, Math.min(n, zone.columns ?? Math.max(1, Math.round(Math.sqrt(n / 2)))))
    const rows = Math.ceil(n / cols)
    const fits = zone.nodes.map((nd) => fitLabel(nd.label))
    const nw = Math.max(NODE_MIN_W, ...fits.map((f) => f.w))
    const nh = Math.max(44, ...fits.map((f) => f.h))
    const titleH = zone.title ? ZONE_TITLE_H : 0
    const zw = Math.max(cols * nw + (cols - 1) * NODE_GAP + ZONE_PAD * 2, zone.title ? zone.title.length * ZONE_TITLE_FONT * 0.55 + ZONE_PAD * 2 : 0)
    const zh = titleH + rows * nh + (rows - 1) * NODE_GAP + ZONE_PAD * 2
    if (rowX > at.x && rowX + zw > at.x + maxWidth) {
      rowX = at.x
      rowY += rowH + ZONE_GAP
      rowH = 0
    }
    const groupId = mint('group')
    const color = zone.color ?? 'grey'
    shape('geo', rowX, rowY, { geo: 'rectangle', w: zw, h: zh, color, size: 'm', dash: 'dashed', fill: 'none', font: 'sans' }, { groupId })
    if (zone.title) {
      const t = text(rowX + ZONE_PAD, rowY + ZONE_PAD - 4, zone.title, 'm', { color, font: 'sans' })
      ;(t as unknown as { groupId: string }).groupId = groupId
    }
    zone.nodes.forEach((nd, i) => {
      const c = i % cols, r = Math.floor(i / cols)
      const x = rowX + ZONE_PAD + c * (nw + NODE_GAP)
      const y = rowY + ZONE_PAD + titleH + r * (nh + NODE_GAP)
      const rec = shape('geo', x, y, { geo: nd.geo ?? 'rectangle', w: nw, h: nh, color: nd.color ?? color, size: 'm', dash: 'solid', fill: 'none', font: 'sans', label: nd.label, labelSize: 's' }, { groupId })
      nodeIds[nd.id] = rec.id
      nodeBoxes[nd.id] = { x, y, w: nw, h: nh }
    })
    rowX += zw + ZONE_GAP
    rowH = Math.max(rowH, zh)
    right = Math.max(right, rowX - ZONE_GAP)
  }
  let bottom = rowY + rowH

  // edges: arrows from centre to centre, tied to both ends (the board stops them at the boxes' edges)
  const legend: Array<{ line: string; color: string }> = []
  const labelOf = Object.fromEntries(spec.zones.flatMap((z) => z.nodes.map((n) => [n.id, n.label])))
  for (const e of spec.edges ?? []) {
    const a = nodeBoxes[e.from], b = nodeBoxes[e.to]
    if (!a || !b) continue
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2
    const head = e.head ?? 'arrow'
    shape(head === 'none' ? 'line' : 'arrow', ax, ay, {
      dx: bx - ax,
      dy: by - ay,
      bend: 0,
      headStart: head === 'both' ? 'arrow' : 'none',
      headEnd: head === 'none' ? 'none' : 'arrow',
      color: e.color ?? 'black',
      size: 's',
      dash: e.dashed ? 'dashed' : 'solid',
      startBind: { id: nodeIds[e.from], nx: 0.5, ny: 0.5 },
      endBind: { id: nodeIds[e.to], nx: 0.5, ny: 0.5 },
    })
    if (e.label) {
      // set off to one side of the line, along the normal; slid along the edge from its middle
      // outward until it lies on no node, so a caption never covers a box
      const len = Math.hypot(bx - ax, by - ay) || 1
      const nx = -(by - ay) / len, ny = (bx - ax) / len
      const w = Math.min(240, e.label.length * LABEL_FONT * 0.55 + 8)
      const h = LABEL_LINE * labelLines(e.label, w)
      const boxes = Object.values(nodeBoxes)
      const at = (t: number) => ({ x: ax + (bx - ax) * t + nx * 18 - w / 2, y: ay + (by - ay) * t + ny * 18 - h / 2 })
      const clear = (b: { x: number; y: number }) => boxes.every((n) => b.x + w <= n.x || n.x + n.w <= b.x || b.y + h <= n.y || n.y + n.h <= b.y)
      let spot: { x: number; y: number } | null = null
      for (let i = 0; i < 15 && !spot; i++) {
        const t = 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.05
        const c = at(t)
        if (clear(c)) spot = c
      }
      if (spot) text(spot.x, spot.y, e.label, 's', { color: e.color ?? 'black', w, align: 'middle' })
      // no clear spot along the line (it crosses a zone full of boxes): the caption goes in a legend below
      else legend.push({ line: `${labelOf[e.from]} → ${labelOf[e.to]}: ${e.label}`, color: e.color ?? 'black' })
    }
  }

  if (legend.length) {
    bottom += 20
    const w = Math.max(320, right - at.x)
    for (const l of legend) {
      text(at.x, bottom, l.line, 's', { color: l.color, w })
      bottom += LABEL_LINE * labelLines(l.line, w) + 4
    }
  }
  if (spec.caption) {
    bottom += 20
    text(at.x, bottom, spec.caption, 's', { color: 'grey', w: Math.max(320, right - at.x) })
    bottom += LABEL_LINE * labelLines(spec.caption, Math.max(320, right - at.x)) + 8
  }
  return { records, nodeIds, bounds: { x: at.x, y: at.y, w: right - at.x, h: bottom - at.y } }
}
