import { Effect, Queue, Stream } from "effect"
import { CameraController, type Camera, type CameraListener, type ZoomPortOptions } from "@zoomport/core"
import { connectDOMCulling, mountZoomPort, type DOMCullingOptions, type DOMSceneItem, type MountOptions } from "@zoomport/dom"

/** Scoped camera ownership. A canceled or completed Effect scope stops RAF and subscriptions. */
export const scopedCamera = (options: ZoomPortOptions = {}) =>
  Effect.acquireRelease(
    Effect.sync(() => new CameraController(options)),
    (controller) => Effect.sync(() => controller.destroy()),
  )

/** Scoped world-space culling; restores each element's authored display style
 * when the Effect scope closes, without taking ownership of DOM nodes. */
export const scopedDOMCulling = <ID extends string | number>(
  engine: CameraController,
  viewport: HTMLElement,
  items: Iterable<DOMSceneItem<ID>>,
  options: DOMCullingOptions = {},
) => Effect.acquireRelease(
  Effect.sync(() => connectDOMCulling(engine, viewport, items, options)),
  (culling) => Effect.sync(() => culling.dispose()),
)

/** Scoped DOM mount. Existing DOM nodes belong to the caller and are not removed. */
export const scopedViewport = (options: MountOptions) =>
  Effect.acquireRelease(
    Effect.sync(() => mountZoomPort(options)),
    (mounted) => Effect.sync(() => mounted.dispose()),
  )

/** Direct Effect operations for integrating the camera into an existing Effect program. */
export const snapshot = (controller: CameraController) => Effect.sync(() => controller.getSnapshot())
export const setCamera = (controller: CameraController, camera: Camera, animated = false) =>
  Effect.sync(() => controller.setCamera(camera, animated))

/** Safely attach a camera listener for the lifetime of an Effect scope. */
export const scopedCameraListener = (controller: CameraController, listener: CameraListener) =>
  Effect.acquireRelease(
    Effect.sync(() => controller.subscribe(listener)),
    (unsubscribe) => Effect.sync(unsubscribe),
  )

/**
 * Stream of camera snapshots. Emits the current snapshot immediately by default.
 * Uses the v4 callback/Queue API; unsubscribes on interruption or scope closure.
 * Prefer this at application boundaries rather than feeding every frame into UI state.
 */
export function cameraChanges(controller: CameraController, includeInitial = true) {
  return Stream.callback<Readonly<Camera>>((queue) =>
    Effect.gen(function* () {
      if (includeInitial) Queue.offerUnsafe(queue, controller.getSnapshot())
      const unsubscribe = controller.subscribe((camera) => Queue.offerUnsafe(queue, camera))
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
    }), { bufferSize: 1, strategy: "sliding" })
}