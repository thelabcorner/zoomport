import { describe, expect, test } from "vitest"
import { CameraController, createSharedFrameScheduler, screenToWorld, worldToScreen, visibleWorldBounds, writeWebGLMatrix, fitBounds, constrain, type FrameScheduler } from "./index"

const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} }
const close = (a: number, b: number, tolerance = 1e-7) => expect(Math.abs(a - b)).toBeLessThan(tolerance)

describe("camera engine", () => {
  test("roundtrips points under arbitrary translation/zoom", () => {
    const c = { x: -183.222, y: 712.5, scale: 3.437 }
    const p = { x: 4.3, y: -19.9 }
    const result = screenToWorld(c, worldToScreen(c, p))
    close(result.x, p.x); close(result.y, p.y)
  })
  test("visible-world culling bounds include a screen-space overscan margin", () => {
    const c = { x: 25, y: -50, scale: 2.5 }
    const bounds = visibleWorldBounds(c, {width:500,height:300}, 25)
    close(bounds.x, -20)
    close(bounds.y, 10)
    close(bounds.width, 220)
    close(bounds.height, 140)
    expect(() => visibleWorldBounds(c, {width:500,height:300}, -1)).toThrow(RangeError)
  })
  test("GPU world-origin rebasing preserves large-scene projected geometry", () => {
    const origin = {x: 100_000_000, y: -50_000_000}
    const camera = {x: -200_000_000 + 135, y: 100_000_000 - 75, scale: 2}
    const viewport = {width:800,height:600}
    const out = writeWebGLMatrix(camera, viewport, new Float32Array(16), origin)
    const point = {x: origin.x + 75, y: origin.y + 125}
    const expected = worldToScreen(camera, point)
    close(out[0]! * 75 + out[12]!, expected.x / viewport.width * 2 - 1, 1e-6)
    close(out[5]! * 125 + out[13]!, 1 - expected.y / viewport.height * 2, 1e-6)
    expect(() => writeWebGLMatrix(camera, viewport, out, {x: NaN, y: 0})).toThrow(RangeError)
  })
  test("WebGL camera matrix uses the same world-to-screen geometry", () => {
    const camera = { x: 50, y: -60, scale: 3 }
    const screen = { width: 800, height: 600 }
    const buffer = new Float32Array(16)
    expect(writeWebGLMatrix(camera, screen, buffer)).toBe(buffer)
    const point = { x: 75, y: 140 }
    close(buffer[0]! * point.x + buffer[12]!, (worldToScreen(camera, point).x / screen.width) * 2 - 1, 1e-6)
    close(buffer[5]! * point.y + buffer[13]!, 1 - (worldToScreen(camera, point).y / screen.height) * 2, 1e-6)
  })

  test("cursor anchoring remains invariant throughout every interpolated frame", () => {
    const engine = new CameraController({ scheduler })
    engine.setViewport(1280, 720)
    const point = { x: 311.3, y: 629.2 }
    const before = screenToWorld(engine.getSnapshot(), point)
    engine.zoomAt(9.72, point)
    for (let i = 0; i < 90; i++) {
      engine.advance(1000 / 144)
      const under = screenToWorld(engine.getSnapshot(), point)
      close(under.x, before.x, 1e-6); close(under.y, before.y, 1e-6)
    }
    close(engine.getSnapshot().scale, 9.72, 0.001)
    engine.destroy()
  })

  test("retargeting a zoom during animation anchors the currently visible world point", () => {
    const engine = new CameraController({ scheduler })
    engine.setViewport(900, 600)
    engine.zoomAt(5, {x:111, y:143})
    engine.advance(16)
    const pivot = {x:723, y:201}
    const before = screenToWorld(engine.getSnapshot(), pivot)
    engine.zoomAt(2.8, pivot)
    for (let i = 0; i < 20; i++) {
      engine.advance(8.333)
      const world = screenToWorld(engine.getSnapshot(), pivot)
      close(world.x, before.x); close(world.y, before.y)
    }
  })

  test("physically integrated fling displacement is frame-rate independent", () => {
    const a = new CameraController({ scheduler, momentumHalfLife: 200 })
    const b = new CameraController({ scheduler, momentumHalfLife: 200 })
    a.fling(2.5, -1.25); b.fling(2.5, -1.25)
    for (let i=0;i<10;i++) a.advance(60)
    for (let i=0;i<60;i++) b.advance(10)
    close(a.getSnapshot().x, b.getSnapshot().x, 1e-5)
    close(a.getSnapshot().y, b.getSnapshot().y, 1e-5)
  })

  test("fit uses available viewport and keeps content centered", () => {
    const b = {x:10,y:25,width:200,height:100}
    const c = fitBounds(b, {width:500,height:300}, 20)
    close(c.scale, 2.3)
    close(worldToScreen(c, {x:110,y:75}).x, 250)
    close(worldToScreen(c, {x:110,y:75}).y, 150)
  })

  test("constrain keeps small content centered and large content inside bounds", () => {
    const b = { x:0, y:0, width:100, height:100 }
    expect(constrain({x:999,y:-500,scale:1}, {width:300,height:200}, b)).toEqual({x:100,y:50,scale:1})
    expect(constrain({x:-999,y:500,scale:4}, {width:300,height:200}, b)).toEqual({x:-100,y:0,scale:4})
  })

  test("rejects invalid camera and sizing input", () => {
    const engine = new CameraController({ scheduler })
    expect(() => engine.jumpTo({x:0,y:0,scale:0})).toThrow(RangeError)
    expect(() => engine.setViewport(Infinity, 10)).toThrow(RangeError)
    expect(() => engine.setBounds({x:0,y:0,width:-1,height:10})).toThrow(RangeError)
    expect(() => new CameraController({minScale:10,maxScale:2})).toThrow(RangeError)
    expect(() => new CameraController({zoomTimeConstant:NaN})).toThrow(RangeError)
    expect(() => new CameraController({panTimeConstant:-1})).toThrow(RangeError)
    expect(() => new CameraController({momentumHalfLife:Infinity})).toThrow(RangeError)
    expect(() => fitBounds({x:0,y:0,width:10,height:10}, {width:100,height:100},24,NaN,2)).toThrow(RangeError)
  })

  test("unsubscribe and teardown do not leak callbacks", () => {
    const engine = new CameraController({ scheduler })
    let observed = 0
    const off = engine.subscribe(() => observed++)
    engine.jumpTo({x:10,y:0,scale:1})
    off()
    engine.jumpTo({x:20,y:0,scale:1})
    engine.destroy()
    expect(observed).toBe(1)
  })
})

describe("camera integration boundaries", () => {
  test("shared RAF scheduler coalesces simultaneous cameras and cancels the unused next frame", () => {
    const nativeFrames = new Map<number, (timestamp:number) => void>()
    let requests = 0
    let cancellations = 0
    const pooled = createSharedFrameScheduler({
      request: callback => { nativeFrames.set(++requests,callback); return requests },
      cancel: id => { cancellations++; nativeFrames.delete(id) },
    })
    const engines = Array.from({length:64}, () => new CameraController({scheduler:pooled}))
    for (const engine of engines) engine.zoomAt(3,{x:120,y:60})
    expect(requests).toBe(1)
    expect(nativeFrames.size).toBe(1)
    const first = nativeFrames.get(1)!
    nativeFrames.delete(1)
    first(16)
    expect(requests).toBe(2)
    expect(nativeFrames.size).toBe(1)
    for (const engine of engines) {
      expect(engine.getSnapshot().scale).toBeGreaterThan(1)
      engine.destroy()
    }
    expect(cancellations).toBe(1)
    expect(nativeFrames.size).toBe(0)
  })
  test("shared scheduler prevents canceled callbacks from running during a batch", () => {
    let frame: ((timestamp:number)=>void) | null = null
    let requests = 0
    const pooled = createSharedFrameScheduler({
      request: callback => { frame = callback; return ++requests },
      cancel() { frame = null },
    })
    const seen: string[] = []
    let b = 0
    pooled.request(() => {
      seen.push("a")
      pooled.cancel(b)
      pooled.request(() => seen.push("next"))
    })
    b = pooled.request(() => seen.push("canceled"))
    expect(requests).toBe(1)
    const first = frame!
    first(1)
    expect(seen).toEqual(["a"])
    expect(requests).toBe(2)
    const second = frame!
    second(2)
    expect(seen).toEqual(["a","next"])
  })
  test("nested batches notify once and recover after exceptions", () => {
    const engine = new CameraController({scheduler})
    const observed: number[] = []
    engine.subscribe(c => observed.push(c.x))
    engine.batch(() => {
      engine.jumpTo({x:10,y:0,scale:1})
      engine.batch(() => engine.jumpTo({x:20,y:0,scale:1}))
      engine.jumpTo({x:30,y:0,scale:1})
    })
    expect(observed).toEqual([30])
    expect(() => engine.batch(() => {
      engine.jumpTo({x:40,y:0,scale:1})
      throw new Error("intentional")
    })).toThrow("intentional")
    expect(observed).toEqual([30,40])
    engine.jumpTo({x:50,y:0,scale:1})
    expect(observed).toEqual([30,40,50])
  })
  test("non-mutating edge checks obey bounded pan and zoom limits", () => {
    const engine = new CameraController({scheduler, minScale:1, maxScale:4, bounds:{x:0,y:0,width:200,height:200}})
    engine.setViewport(100,100)
    const before = engine.getSnapshot()
    expect(engine.canPanBy(20,20)).toBe(false)
    expect(engine.canPanBy(-10,0)).toBe(true)
    expect(engine.canZoomBy(0.5)).toBe(false)
    expect(engine.canZoomBy(2)).toBe(true)
    expect(engine.getSnapshot()).toBe(before)
    engine.jumpTo({x:-100,y:-100,scale:4})
    expect(engine.canZoomBy(2)).toBe(false)
    expect(engine.canZoomBy(0.5)).toBe(true)
    expect(engine.canPanBy(NaN,10)).toBe(false)
  })
  test("equivalent world bounds keep an interpolated cursor anchor intact", () => {
    const engine = new CameraController({scheduler})
    engine.setViewport(500,500)
    const bounds = {x:-1000,y:-1000,width:2000,height:2000}
    engine.setBounds(bounds)
    const pivot = {x:120,y:220}
    const before = screenToWorld(engine.getSnapshot(), pivot)
    engine.zoomAt(3, pivot)
    for(let i=0;i<10;i++) {
      engine.setBounds({...bounds})
      engine.advance(16)
      const after = screenToWorld(engine.getSnapshot(), pivot)
      close(after.x, before.x); close(after.y, before.y)
    }
  })
})
