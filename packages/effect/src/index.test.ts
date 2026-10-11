import { describe, expect, it } from "vitest"
import { Effect, Stream } from "effect"
import { CameraController } from "@zoomport/core"
import { cameraChanges, scopedCamera, scopedCameraListener, scopedDOMCulling, snapshot } from "./index.js"

describe("Effect v4 integration", () => {
  it("creates and releases scoped camera ownership", async () => {
    const c = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const camera = yield* scopedCamera({ initial: { x: 12, y: 14, scale: 2 } })
      const state = yield* snapshot(camera)
      expect(state).toEqual({ x: 12, y: 14, scale: 2 })
      return camera
    })))
    expect(c.isAnimating()).toBe(false)
  })
  it("releases scoped subscription on scope closure", async () => {
    const engine = new CameraController()
    let notifications = 0
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* scopedCameraListener(engine, () => notifications++)
      engine.jumpTo({ x: 10, y: 0, scale: 1 })
    })))
    expect(notifications).toBe(1)
    engine.jumpTo({ x: 20, y: 0, scale: 1 })
    expect(notifications).toBe(1)
    engine.destroy()
  })
  it("immediately streams its current camera snapshot", async () => {
    const engine = new CameraController({ initial: { x: 1, y: 2, scale: 3 } })
    const result = await Effect.runPromise(Stream.runCollect(cameraChanges(engine).pipe(Stream.take(1))))
    expect(result).toEqual([{ x: 1, y: 2, scale: 3 }])
    engine.destroy()
  })
  it("restores culling-managed DOM display after scoped release", async () => {
    const viewport = document.createElement("div")
    const inside = document.createElement("div")
    const outside = document.createElement("div")
    outside.style.display = "inline-block"
    document.body.append(viewport)
    viewport.append(inside, outside)
    Object.defineProperties(viewport, {
      clientWidth: { configurable:true, value:100 },
      clientHeight: { configurable:true, value:100 },
    })
    const engine = new CameraController()
    engine.setViewport(100, 100)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const mounted = yield* scopedDOMCulling(engine, viewport, [
        { id:1, node:inside, bounds:{x:0,y:0,width:10,height:10} },
        { id:2, node:outside, bounds:{x:1000,y:1000,width:10,height:10} },
      ], {overscanPx:0,cacheMarginPx:0,observeResize:false})
      expect(mounted.visibility.getVisible().has(1)).toBe(true)
      expect(outside.style.display).toBe("none")
    })))
    expect(outside.style.display).toBe("inline-block")
    engine.destroy()
    viewport.remove()
  })
})