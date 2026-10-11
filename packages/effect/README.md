# @zoomport/effect

Optional scoped integration with **Effect v4** (not required for `@zoomport/core`, `@zoomport/dom`, or `@zoomport/react`).

```sh
npm install @zoomport/effect effect@^4
```

```ts
import { Effect, Stream } from "effect"
import { scopedViewport, cameraChanges } from "@zoomport/effect"

const program = Effect.scoped(Effect.gen(function* () {
  const port = yield* scopedViewport({
    viewport: document.querySelector<HTMLElement>("#viewport")!,
    content: document.querySelector<HTMLElement>("#content")!,
    wheelMode: "zoom",
  })
  yield* Stream.runForEach(
    cameraChanges(port.engine).pipe(Stream.take(3)),
    (camera) => Effect.sync(() => console.log(camera.scale)),
  )
}))
await Effect.runPromise(program)
```

The scope owns the mounted listeners/observers/RAF. The DOM nodes remain yours. `scopedCamera` owns a standalone engine; `scopedCameraListener` provides scoped subscription cleanup. `cameraChanges` uses a sliding one-item buffer to prevent unbounded frame-event backlogs. Avoid placing the Effect runtime inside the camera's per-frame callback.

For very large DOM/SVG worlds, `scopedDOMCulling(engine, viewport, items, options)` owns spatial-index subscriptions for the scope and restores original inline styles on interruption or completion. `@zoomport/effect` uses the same framework-neutral BVH and visibility policies as the React and vanilla packages; it does not run an Effect computation on every animation frame.