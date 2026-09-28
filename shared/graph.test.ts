import { describe, expect, it } from 'vitest'
import { gapBetween } from './bounds'
import { fitLabel, layoutGraph } from './graph'

const mint = (() => {
  let n = 0
  return (kind: string) => `${kind}:${++n}`
})()

describe('layoutGraph', () => {
  const laid = layoutGraph(
    {
      title: 'Players by zone',
      zones: [
        { title: 'CORE', color: 'violet', nodes: [{ id: 'a', label: 'Oliver Habryka' }, { id: 'b', label: 'Lighthaven (venue)' }, { id: 'c', label: 'LessWrong + AF' }] },
        { title: 'FUNDERS', color: 'green', nodes: [{ id: 'd', label: 'Coefficient Giving (Berger)' }, { id: 'e', label: 'SFF (still funds LC)' }] },
      ],
      edges: [{ from: 'd', to: 'b', label: 'cost-effective, but no grants', dashed: true }],
      caption: 'Zones = public roles.',
    },
    { x: 100, y: 100 },
    mint
  )
  const geos = laid.records.filter((r) => r.typeName === 'shape' && r.type === 'geo') as Array<{ id: string; x: number; y: number; groupId?: string; props: Record<string, unknown> }>
  const nodes = geos.filter((g) => g.props.label)

  it('sizes every node box to hold its label', () => {
    for (const n of nodes) {
      const fit = fitLabel(String(n.props.label))
      expect(Number(n.props.w)).toBeGreaterThanOrEqual(fit.w)
      expect(Number(n.props.h)).toBeGreaterThanOrEqual(fit.h)
    }
  })

  it('keeps nodes apart and zones apart', () => {
    const box = (g: (typeof geos)[number]) => ({ x: g.x, y: g.y, w: Number(g.props.w), h: Number(g.props.h) })
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(gapBetween(box(nodes[i]!), box(nodes[j]!))).toBeGreaterThan(0)
    const zones = geos.filter((g) => !g.props.label)
    expect(zones).toHaveLength(2)
    expect(gapBetween(box(zones[0]!), box(zones[1]!))).toBeGreaterThan(0)
  })

  it('ties edges to both nodes and groups each zone', () => {
    const arrow = laid.records.find((r) => r.typeName === 'shape' && r.type === 'arrow') as unknown as { props: { startBind: { id: string }; endBind: { id: string } } }
    expect(arrow.props.startBind.id).toBe(laid.nodeIds.d)
    expect(arrow.props.endBind.id).toBe(laid.nodeIds.b)
    const groups = new Set(nodes.map((n) => n.groupId))
    expect(groups.size).toBe(2)
  })

  it('reports bounds that hold everything', () => {
    for (const g of geos) {
      expect(g.x).toBeGreaterThanOrEqual(laid.bounds.x)
      expect(g.x + Number(g.props.w)).toBeLessThanOrEqual(laid.bounds.x + laid.bounds.w + 0.01)
    }
  })
})
