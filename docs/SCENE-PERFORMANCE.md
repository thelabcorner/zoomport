# Scene-scale rendering: spatial culling, conservative visibility and semantic LOD

ZoomPort's camera supports unbounded world coordinates and multiple renderers.
The scene-optimization subsystem is **framework-independent**: React, Effect,
vanilla HTML, native SVG, Canvas, WebGL and WebGPU can all share its visibility
and LOD decisions without coupling animation frames to React renders.

These utilities optimize a 2D axis-aligned pan/zoom camera. They are not 3D
perspective-frustum culling, occlusion culling or automatic hit-testing.

## Architecture

1. `SceneIndex` builds a median-partitioned bounding-volume hierarchy (BVH)
   over each item's world-space AABB. Leaves default to 16 items.
2. `query(bounds)` finds intersecting IDs with tree-pruned traversal. For
   a query that fully encloses an internal subtree, entire contiguous index
   ranges are added without further per-shape intersection tests.
3. `upsert` and `remove` store short-lived immutable-record overrides, so
   moving one shape doesn't rebuild a 100,000-item hierarchy. Stale base entries
   are suppressed. After at least 128 changes or ~8% of the live scene by
   default, the hierarchy is compacted.
4. `SceneVisibility` adds viewport overscan and a larger camera-motion cache
   margin. A camera frame whose *actual visible region* fits entirely inside
   the conservative cache triggers **zero spatial queries** and returns the
   original visible Set object.
5. The visibility cache is also bounded by **relative zoom change**. This
   prevents a deep zoom into a previously fitted whole-scene view from
   continuing to draw every distant object. Default maximum reuse ratio: 1.35.
6. `queryLOD(bounds,scale,maxClusterPx,minClusterItems)` collapses clean BVH
   subtrees with sufficiently small projected bounds into semantic aggregate
   proxies. It expands branches containing live modifications, preserving
   correctness until compaction.

The scene store, user selection state, editing state, hit-testing and exports
remain application-owned; visibility does not remove objects from the store.

## Vanilla JavaScript / TypeScript: DOM

```ts
import { SceneIndex, SceneVisibility } from "@zoomport/core"
import { mountZoomPort, connectDOMCulling } from "@zoomport/dom"

const port = mountZoomPort({ viewport, content, renderer: "css-transform" })
const culling = connectDOMCulling(port.engine, viewport, [
  { id: "shape-a", node: shapeA, bounds: { x: 20, y: 20, width: 300, height: 100 } },
  { id: "shape-b", node: shapeB, bounds: { x: 8000, y: 5000, width: 200, height: 100 } },
], { overscanPx: 96, cacheMarginPx: 256 })

culling.upsert({ id: "shape-a", node: shapeA,
  bounds: { x: 180, y: 20, width: 300, height: 100 }, pinned: true })
culling.pin("shape-a", true) // keep the shape shown while editing
culling.invalidate()         // after external resize/geometry policy changes
// On teardown, restores every original inline display value.
culling.dispose()
port.dispose()
```

This adapter writes `display` only for IDs crossing a visibility threshold,
retains the DOM structure and input handlers, and restores pre-existing inline
display styles when disposed. It does **not** virtualize 100K DOM nodes or remove
their memory. For huge HTML scenes, virtualize DOM creation upstream using
`SceneVisibility.getVisible()` instead.

## Canvas / WebGL / WebGPU: renderer-owned drawing

```ts
const index = new SceneIndex(sceneObjects.map(o => ({ id:o.id, bounds:o.bounds })))
const visibility = new SceneVisibility(index, {
  overscanPx: 32,
  cacheMarginPx: 160,
  cacheMaxScaleRatio: 1.35,
})
const viewport = {width:0,height:0} // set from ResizeObserver
const draw = (ctx:CanvasRenderingContext2D, camera:Readonly<Camera>) => {
  const change = visibility.update(camera, viewport)
  // change.added / removed can update retained GPU instance buffers.
  for (const id of visibility.getVisible()) {
    const object = sceneObjectsByID.get(id)!
    drawObject(ctx, object)
  }
}
```

`SceneVisibility` is a conservative *superset* of immediately visible
objects. When the camera moves within the cached guard band, the extra
prefetched objects may still be emitted for drawing. Hardware clipping handles
their pixels; applications can choose smaller margins if command submission
is expensive. There is no false-negative visibility inside valid geometry
bounds.

For semantic LOD, use `index.queryLOD(worldAABB, camera.scale, 96, 32, reuseArray)`.
Each returned `item` is an original ID. Each `cluster` has stable
`key` (until compaction), world `bounds` and represented `count`.
Your renderer decides how to draw aggregated geometry or an image/tile.
Because a proxy is an approximation of its descendants, it is intentionally
**not pixel-perfect**. Maintain full-resolution scene objects for edits,
hit tests and exports.

## Performance evidence (October 10, 2026)

The reproducible benchmark is `npm run bench:scene`. Local Windows Node
24.21.0, 100K rectangular shapes, 400 world-AABB queries, five measured runs:

| Workload | BVH median / query | Full scan / query | Relative speed |
| --- | ---: | ---: | ---: |
| Sparse grid, ~98 results | 17.6 µs | 357.1 µs | ~20.3× |
| Dense cluster, ~11,698 results | 1116 µs | 952 µs | ~0.85× |

An independent later run with the final hierarchy/LOD implementation measured
31.1 µs indexed versus 403.5 µs linear (**12.97×**) on the sparse
100K distribution; the dense distribution measured 1058.4 µs indexed
versus 1124.9 µs linear (**1.06×**). These differences show why paired,
repeated profiles matter. The index **is not universally faster than a
scan** when a large fraction of the scene is visible. The benefit of LOD
comes from reducing the *actual renderer commands* in that case.

Real Chromium 155 browser benchmark: `npx playwright test -c
playwright.bench.config.ts bench/browser/scene.spec.ts`. One workstation,
DPR 1, median of 12 draw callbacks per scenario:

| Scale | Mode | Draw operations | Callback CPU median |
| --- | --- | ---: | ---: |
| 100% | Naive | 100,000 | 12.1 ms |
| 100% | Indexed | 832 | 0.2 ms |
| 5% | Naive | 100,000 | 101.4 ms |
| 5% | Indexed | 100,000 | 24.4 ms |
| 5% | Hierarchy LOD | 64 | Below 0.1 ms (rounded in captured output) |

No benchmark above includes actual GPU/presentation latency or guarantees
60/120/144 FPS. The absolute timings depend on hardware, browser engine,
shape drawing commands, world distribution and DPR; the synthetic and real
browser workloads are not interchangeable.

## Tuning and caveats

- Expand AABBs to include shadows, glows, annotations and strokes that can
  extend outside geometric bounds. Pin selected or actively edited shapes.
- Use `overscanPx` to avoid visible popping on fast pans; set
  `cacheMarginPx` to trade less frequent spatial queries against more
  submitted offscreen objects. Test pan and zoom together.
- `cacheMaxScaleRatio` prevents stale enormous cached candidate sets when
  zooming inward. Values close to 1 requery more often.
- Batch frequent scene edits; too many transient geometry updates can trigger
  reindexing. The override compaction threshold is configurable.
- Cache LOD aggregate artwork and use hysteresis where visual changes
  near semantic zoom thresholds could cause flicker.
- `queryLOD` is for visualization, not precision selection. Use individual
  object geometry for hit testing.
- Browser workers and OffscreenCanvas, GPU instance/indirect drawing,
  tiled-cache invalidation, and scene-store-driven virtualized DOM remain
  potential extensions, not implemented functionality.

## Live proof

The performance lab lives at `/culling.html` on the existing playground
server, including the LAN demo on port 11274. It has an actual 100,000-object
scene and three modes: full naive drawing, indexed individual culling, and
hierarchical LOD. Its inspector displays operations, query counts, projected
LOD mode and draw CPU. All strategies share the same camera.
