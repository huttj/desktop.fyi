#!/usr/bin/env python3
"""Re-applies desktop.fyi's additions to a freshly vendored Quickdraw.

Usage, from the repo root:
    rm -rf vendor/quickdraw/packages && mkdir -p vendor/quickdraw/packages && git -C ../quickdraw archive HEAD packages/core packages/react | tar -x -C vendor/quickdraw/
    git -C ../quickdraw rev-parse HEAD > vendor/quickdraw/UPSTREAM_COMMIT
    python3 vendor/quickdraw/apply-hooks.py

Each replacement asserts its anchor is found exactly once, so an upstream
change that moves the code fails loudly instead of silently dropping a hook.
"""
import os

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'packages', 'core')

def patch(path, reps):
    p = os.path.join(root, path)
    s = open(p).read()
    for old, new in reps:
        if s.count(new) == 1:
            continue  # already applied (checked first: a result may still contain its own anchor)
        assert s.count(old) == 1, f'{path}: anchor not found exactly once:\n{old[:80]}'
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/editor.js', [
    # 1. the hooks
    ("""    this.camera = camera || { x: 0, y: 0, z: 1 }
""", """    this.camera = camera || { x: 0, y: 0, z: 1 }
    // Host hooks: decide per shape whether it is on the board at all (a
    // filtered-out shape is not drawn, hit, selected, fitted or exported)
    // and how opaque it draws (0..1). Both optional, read on every render.
    this.shapeFilter = null
    this.shapeAlpha = null
"""),
    # 2. everything that lists shapes goes through the filter
    ("""    return this.store.shapes().sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))""",
     """    const f = this.shapeFilter
    const list = f ? this.store.shapes().filter((s) => f(s)) : this.store.shapes()
    return list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))"""),
    ("""    for (const s of this.store.shapes()) b = boundsUnion(b, pageBounds(s))""",
     """    for (const s of this.shapesSorted()) b = boundsUnion(b, pageBounds(s))"""),
    ("""    this.setSelection(this.store.shapes().filter((s) => !this.shapeLocked?.(s)).map((s) => s.id))""",
     """    this.setSelection(this.shapesSorted().filter((s) => !this.shapeLocked?.(s)).map((s) => s.id))"""),
    # 3. per-shape opacity in the render pass
    ("""      drawShape(ctx, s, {
        theme: this.theme, store: this.store, zoom: cam.z,
        ghost: this.session?.type === 'erasing' && this.session.hits.has(s.id),""",
     """      const alpha = this.shapeAlpha ? this.shapeAlpha(s) : 1
      if (alpha <= 0) continue
      if (alpha < 1) { ctx.save(); ctx.globalAlpha *= alpha }
      drawShape(ctx, s, {
        theme: this.theme, store: this.store, zoom: cam.z,
        ghost: this.session?.type === 'erasing' && this.session.hits.has(s.id),"""),
    ("""        onAssetLoad: () => this.requestRender(),
      })
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }""", """        onAssetLoad: () => this.requestRender(),
      })
      if (alpha < 1) ctx.restore()
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }"""),
    # 4. notes keep their yellow paper when the pen is black (our default)
    ("""color: this.styles.color === DEFAULT_STYLES.color ? 'yellow' : this.styles.color,""",
     """color: this.styles.color === DEFAULT_STYLES.color || this.styles.color === 'black' ? 'yellow' : this.styles.color,"""),
])

patch('types/index.d.ts', [
    ("""  bindHover: string | null
""", """  bindHover: string | null
  /** Host hook: a shape this returns false for is not drawn, hit, selected, fitted or exported. */
  shapeFilter: ((shape: ShapeRecord) => boolean) | null
  /** Host hook: how opaque a shape draws on screen (0..1). */
  shapeAlpha: ((shape: ShapeRecord) => number) | null
"""),
])
print('hooks applied')
