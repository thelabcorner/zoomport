# ZoomPort integration guide

**Architecture:** The camera is a framework-independent mutable store.
Render adapters subscribe to it imperatively; UI frameworks use selective
subscriptions to display state. Camera frames never require React renders.
Plain `<script>` consumers can load `@zoomport/dom/dist/zoomport.global.js`
and call `ZoomPort.mountZoomPort(...)` without a build step.

## Plain DOM/HTML

```ts
import { mountZoomPort } from "@zoomport/dom"

const port = mountZoomPort({
  viewport: document.querySelector<HTMLElement>("#viewport")!,
  content: document.querySelector<HTMLElement>("#content")!,
  bounds: { x: 0, y: 0, width: 1600, height: 900 },
  css: { size: { width: 1600, height: 900 } },
  renderer: "css-hybrid",
  minScale: 0.1,
  maxScale: 24,
  wheelMode: "auto",
  wheelAtBounds: "release",
  pointerMoveScheduling: "frame",
})
port.fit(undefined, 32)
const unsubscribe = port.engine.subscribe(camera => console.log(camera.scale))
port.setRenderer("css-transform") // camera state is preserved
port.setOptions({ enableInertia: false })
// On teardown:
unsubscribe()
port.dispose()
```

Set the viewport's height explicitly. ZoomPort installs minimal default
`position`, `overflow`, `touch-action`, tabindex, role, and ARIA label
attributes **only when needed** and restores authored values on disposal.
It never destroys application-owned DOM nodes. Supplying an external
`engine` lets multiple views share a camera while keeping camera ownership
outside the DOM mount.

## Native rendering

`mountZoomPort` accepts an `SVGGElement` with `renderer:"svg-transform"`,
an `SVGSVGElement` with `renderer:"svg-viewbox"`, or a
`HTMLCanvasElement` with `renderer:"canvas2d"` plus a `draw` callback.
The renderer validates the element type. Use `connectSVG`,
`connectSVGViewBox`, `connectCanvas2D`, or `connectCustom` directly for
custom rendering lifecycles. Changing renderer cannot convert an HTML element
into an SVG element: select an appropriate surface yourself.

In `css-hybrid`, increasing backing dimensions improves vector/text
repainting opportunities but cannot invent pixels absent from bitmap sources.
Configure `maxDevicePixels`, `maxDeviceDimension` and `pixelRatio` to
bound resource use. In `css-layout`, browser layout work can occur on every
camera change. Benchmark with your actual scene.

## Effect v4

```ts
import { Effect } from "effect"
import { scopedCamera, scopedCameraListener } from "@zoomport/effect"

const program = Effect.scoped(Effect.gen(function* () {
  const camera = yield* scopedCamera({ maxScale: 16 })
  yield* scopedCameraListener(camera, snapshot => console.log(snapshot.scale))
  camera.zoomBy(2)
}))
await Effect.runPromise(program)
```

`scopedViewport` owns both DOM adapter and camera when you do not pass an
external engine. `cameraChanges(controller)` returns a v4 `Stream` of
camera snapshots with subscription cleanup on stream interruption.
Application event loops should not run a new Effect fiber for *every* RAF
camera update; use a stream consumer at the application boundary, or throttle.
The camera stream uses a one-slot sliding buffer, so slow subscribers receive
the freshest snapshot instead of allocating an unbounded backlog.

## React

Use `ZoomPort.Root`, `ZoomPort.Viewport`, `ZoomPort.Content` and
`useCameraSelector`. All pointer/wheel/touch interactions use the same
`bindViewport` function as vanilla DOM. This avoids a second input
implementation. The adapter remains imperative and does not schedule
React render commits during animation.

## SSR and accessibility

Importing `@zoomport/core`, `@zoomport/dom`, and `@zoomport/effect`
does not access `window` or `document` at module evaluation time.
Only mount client-side after the DOM exists. For motion preferences, vanilla
DOM mounts follow `prefers-reduced-motion` unless `reducedMotion` is
explicitly configured.

ZoomPort does not disable native page scrolling globally. Use
`wheelAtBounds:"release"` when embedded in scrollable documents. Set
`aria-label` on the viewport to name the specific artwork or interaction.

## Debug and measurement

- `engine.getSnapshot()`: current camera (world units to screen pixels).
- `engine.getTarget()`: interpolation destination.
- `engine.getViewport()`: observed CSS-pixel dimensions.
- `engine.subscribe(listener)`: subscribe directly; always unsubscribe.
- `port.invalidate()`: repaint without changing the camera.
- `port.dispose()`: remove DOM listeners and restore authored styles.

Run `npm run check`, `npm run test:browser`, and
`npm run bench:browser` for repeatable verification.

## High-frequency performance configuration

For canvas editors or touch/stylus-heavy scenes, enable
`pointerMoveScheduling: "frame"` on the vanilla mount or React Root.
ZoomPort then retains only the latest movement sample per active pointer
and publishes one camera update per animation frame (including two-finger
pinch updates). The queued sample is flushed before pointerup/pointercancel,
so release geometry and inertia use the latest pointer state. On unmount,
the pending frame is canceled and pointer capture is released.

The default, `"immediate"`, is still appropriate for input-latency-sensitive
applications (such as precision pen tools) that need an update per
dispatched event. ZoomPort does **not** silently activate `pointerrawupdate`
or process every `getCoalescedEvents()` sample: those techniques are better
suited to stroke reconstruction than moving a viewport.

For applications with many simultaneously animated viewports, the default
browser scheduler pools their callbacks into one native
`requestAnimationFrame` per refresh. Each controller still owns its
cancelable logical callback and receives the same frame timestamp.
You may supply a custom `FrameScheduler` through `@zoomport/core`, or
create an independently pooled scheduler with
`createSharedFrameScheduler(nativeScheduler)` for custom timing/tests.
The scheduler uses recycled callback maps and does not allocate a new
container per frame.

### Renderer economics

| Rendering strategy | Typical camera-frame DOM work | Main tradeoff |
| --- | --- | --- |
| CSS transform | Transform property | Fast compositor path; may magnify raster layers |
| CSS hybrid | Transform, with width/height on tier transitions | Better vector/text repaint opportunity at the cost of backing-layer memory |
| CSS layout zoom | Transform; CSS `zoom` only when scale changes | Can induce layout when scale changes |
| Native resize | Transform; width/height only when scale changes | Intrinsic resize and image re-rasterization cost |
| SVG group | One native transform attribute | SVG complexity controls paint cost |
| SVG viewBox | One native viewBox attribute | Native vector quality; renderer/layout workload-dependent |
| Canvas 2D | Clear and redraw, cached layout size | Draw cost scales with visible scene complexity |

Canvas backing dimensions and SVG viewport sizes are cached between actual
resizes, avoiding repeated synchronous geometry reads on animation frames.
Use `invalidate()` after a manual size or backing-source change.
`ResizeObserver` is used where available; old environments fall back to
live reads for Canvas 2D to preserve resizing correctness.

Avoid global `will-change: transform` across hundreds of elements: layer
promotion has a GPU-memory cost. Culling large scenes and choosing a
renderer that fits the content have greater impact than camera arithmetic.

### Benchmark interpretation

`npm run bench` measures CPU-side camera simulations at 60/120/144 Hz;
it **does not** measure screen FPS. `npm run bench:browser` is the
browser rendering-counter suite and must be repeated on representative
hardware, with warm-up, stable viewport/DPR, and equivalent scene content.
Track input-to-present latency, long frames, layouts, paints, raster memory,
and image sharpness separately; maximizing one metric is not a universal win.