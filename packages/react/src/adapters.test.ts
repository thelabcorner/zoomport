import { describe, expect, test } from "vitest"
import { CameraController, type FrameScheduler } from "@zoomport/core"
import { connectCSS, connectSVG, connectSVGViewBox, connectCanvas2D, connectRenderer } from "./adapters"

const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} }
const camera = () => new CameraController({ scheduler })

describe("rendering strategies", () => {
  test("naive transform uses one translate-scale and cleans up styles", () => {
    const engine = camera()
    const el = document.createElement("div")
    el.style.transform = "rotate(1deg)"
    const adapter = connectCSS(engine, el)
    engine.jumpTo({x:12,y:-7,scale:3})
    expect(el.style.transform).toContain("scale(3)")
    expect(el.style.transform).toContain("translate(12px,-7px)")
    adapter.dispose()
    expect(el.style.transform).toBe("rotate(1deg)")
  })
  test("layout zoom uses CSS zoom rather than a compositor scale()", () => {
    const engine = camera()
    const el = document.createElement("div")
    const adapter = connectCSS(engine, el, {mode:"css-layout"})
    engine.jumpTo({x:11,y:12,scale:2.5})
    expect(el.style.zoom).toBe("2.5")
    expect(el.style.transform).not.toContain("scale")
    expect(el.style.transform).toBe("translate(4.4px,4.8px)")
    adapter.dispose()
  })
  test("hybrid quality tier obeys optional physical pixel budget at high DPR", () => {
    const engine = camera()
    const node = document.createElement("div")
    const adapter = connectCSS(engine, node, {
      mode: "css-hybrid", size: {width:200,height:100}, maxLayerPixels:320000,
      maxDevicePixels:400000, pixelRatio:3,
    })
    engine.jumpTo({x:0,y:0,scale:3.5})
    expect(node.style.width).toBe("200px")
    expect(node.style.transform).toContain("scale(3.5)")
    adapter.dispose()
    const lowDpr = connectCSS(engine, node, {
      mode: "css-hybrid", size: {width:200,height:100}, maxLayerPixels:320000,
      maxDevicePixels:400000, pixelRatio:1,
    })
    expect(node.style.width).toBe("800px")
    expect(node.style.transform).toContain("scale(0.875)")
    lowDpr.dispose()
  })
  test("native element resize updates dimensions without scaling transform", () => {
    const engine = camera()
    const el = document.createElement("div")
    const adapter = connectCSS(engine, el, {mode:"css-resize",size:{width:400,height:200}})
    engine.jumpTo({x:-20,y:2,scale:4})
    expect(el.style.width).toBe("1600px")
    expect(el.style.height).toBe("800px")
    expect(el.style.transform).toBe("translate(-20px,2px)")
    adapter.dispose()
    expect(() => connectCSS(engine, el, {mode:"css-resize"})).toThrow(RangeError)
  })
  test("hybrid CSS paints at a stepped higher resolution without layout work on every frame", () => {
    const engine = camera()
    const el = document.createElement("div")
    const adapter = connectCSS(engine, el, {mode:"css-hybrid", size:{width:200,height:100},maxLayerPixels:320000})
    engine.jumpTo({x:17,y:-21,scale:3.3})
    expect(el.style.width).toBe("800px")
    expect(el.style.height).toBe("400px")
    expect(el.style.transform).toBe("translate(17px,-21px) scale(0.825)")
    engine.jumpTo({x:18,y:-20,scale:3.9})
    expect(el.style.width).toBe("800px")
    engine.jumpTo({x:18,y:-20,scale:8})
    // Budget caps the prerasterization surface at 4x, so larger zooms fall back
    // to magnification rather than silently requesting huge offscreen layers.
    expect(el.style.width).toBe("800px")
    expect(el.style.transform).toContain("scale(2)")
    adapter.dispose()
  })
  test("native SVG group transforms geometry in user space", () => {
    const engine = camera()
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    group.setAttribute("transform", "rotate(10)")
    const adapter = connectSVG(engine, group)
    engine.jumpTo({x:99,y:81,scale:5})
    expect(group.getAttribute("transform")).toBe("translate(99 81) scale(5)")
    adapter.dispose()
    expect(group.getAttribute("transform")).toBe("rotate(10)")
  })
  test("viewBox maps screen viewport to exact world rectangle", () => {
    const engine = camera()
    engine.setViewport(800, 600)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    Object.defineProperty(svg, "clientWidth", {value:800})
    Object.defineProperty(svg, "clientHeight", {value:600})
    const adapter = connectSVGViewBox(engine, svg)
    engine.jumpTo({x:100,y:50,scale:2})
    expect(svg.getAttribute("viewBox")).toBe("-50 -25 400 300")
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none")
    adapter.dispose()
    expect(svg.hasAttribute("viewBox")).toBe(false)
  })
  test("Canvas2D transforms device pixels rather than scaling a CSS bitmap", () => {
    const engine = camera()
    const canvas = document.createElement("canvas")
    Object.defineProperty(canvas, "clientWidth", {value:500})
    Object.defineProperty(canvas, "clientHeight", {value:300})
    const ops: Array<[string,...number[]]> = []
    const mockContext = {
      resetTransform: () => { ops.push(["reset"]) },
      clearRect: (...v:number[]) => { ops.push(["clear",...v]) },
      setTransform: (...v:number[]) => { ops.push(["transform",...v]) },
    } as unknown as CanvasRenderingContext2D
    canvas.getContext = (() => mockContext) as unknown as typeof canvas.getContext
    const draw = () => { ops.push(["draw"]) }
    const adapter = connectCanvas2D(engine, canvas, draw, () => 2)
    engine.jumpTo({x:4,y:6,scale:3})
    expect(canvas.width).toBe(1000)
    expect(canvas.height).toBe(600)
    expect(ops).toContainEqual(["transform",6,0,0,6,8,12])
    const before = ops.length
    adapter.invalidate()
    expect(ops.length).toBeGreaterThan(before)
    adapter.dispose()
  })
  test("explicit redraw uses latest immutable camera and disposal is idempotent", () => {
    const engine = camera()
    const seen: number[] = []
    const adapter = connectRenderer(engine, c => seen.push(c.x))
    expect(seen).toEqual([0])
    engine.jumpTo({x:10,y:20,scale:2})
    adapter.invalidate()
    expect(seen).toEqual([0,10,10])
    adapter.dispose()
    adapter.dispose()
    adapter.invalidate()
    engine.jumpTo({x:11,y:20,scale:2})
    expect(seen).toEqual([0,10,10])
  })
})

describe("renderer configuration", () => {
  test("pure pan frames do not write CSS layout zoom or native resize dimensions", () => {
    for (const mode of ["css-layout", "css-resize"] as const) {
      const engine = camera()
      const node = document.createElement("div")
      const writes: Record<string, number> = { zoom: 0, width: 0, height: 0 }
      for (const key of Object.keys(writes)) {
        let value = ""
        Object.defineProperty(node.style, key, {
          configurable: true, get: () => value,
          set: (next: string) => { value = String(next); writes[key]!++ },
        })
      }
      const adapter = connectCSS(engine, node, {mode, size:{width:100,height:100}})
      const initial = { ...writes }
      for (let i = 1; i <= 100; i++) engine.jumpTo({x:i,y:-i,scale:1})
      expect(writes.zoom).toBe(initial.zoom)
      expect(writes.width).toBe(initial.width)
      expect(writes.height).toBe(initial.height)
      engine.jumpTo({x:100,y:-100,scale:2})
      expect(writes[mode === "css-layout" ? "zoom" : "width"]).toBeGreaterThan(initial[mode === "css-layout" ? "zoom" : "width"]!)
      adapter.dispose()
    }
  })
  test("SVG viewBox caches layout dimensions across camera frames", () => {
    const engine = camera()
    engine.setViewport(800, 600)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    let dimensionsRead = 0
    let width = 800
    Object.defineProperty(svg, "clientWidth", {get: () => { dimensionsRead++; return width }})
    Object.defineProperty(svg, "clientHeight", {get: () => { dimensionsRead++; return 600 }})
    const adapter = connectSVGViewBox(engine, svg, {syncViewport:false})
    const initialReads = dimensionsRead
    for (let x = 0; x < 100; x++) engine.jumpTo({x,y:0,scale:2})
    expect(dimensionsRead).toBe(initialReads)
    width = 400
    adapter.invalidate()
    expect(svg.getAttribute("viewBox")).toBe("-49.5 0 200 300")
    expect(dimensionsRead).toBeGreaterThan(initialReads)
    adapter.dispose()
  })
  test("Canvas observes layout dimensions instead of synchronously reading them per camera frame", () => {
    const previous = globalThis.ResizeObserver
    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis,"ResizeObserver",{configurable:true,writable:true,value:MockResizeObserver})
    try {
      const engine = camera()
      const canvas = document.createElement("canvas")
      let reads = 0
      Object.defineProperty(canvas, "clientWidth", {get: () => { reads++; return 300 }})
      Object.defineProperty(canvas, "clientHeight", {get: () => { reads++; return 200 }})
      canvas.getContext = (() => ({
        resetTransform() {}, clearRect() {}, setTransform() {},
      })) as unknown as typeof canvas.getContext
      const adapter = connectCanvas2D(engine, canvas, () => {}, () => 2)
      const initialReads = reads
      for (let i = 1; i <= 100; i++) engine.jumpTo({x:i,y:0,scale:1})
      expect(reads).toBe(initialReads)
      adapter.invalidate()
      expect(reads).toBeGreaterThan(initialReads)
      adapter.dispose()
    } finally {
      Object.defineProperty(globalThis,"ResizeObserver",{configurable:true,writable:true,value:previous})
    }
  })
  test("hybrid tiers obey per-axis physical pixel budgets", () => {
    const engine = camera()
    const el = document.createElement("div")
    const adapter = connectCSS(engine, el, {mode:"css-hybrid",size:{width:200,height:100},
      maxDeviceDimension:900,pixelRatio:2,maxLayerPixels:1e9})
    engine.jumpTo({x:0,y:0,scale:8})
    expect(el.style.width).toBe("400px")
    expect(el.style.height).toBe("200px")
    expect(el.style.transform).toContain("scale(4)")
    adapter.dispose()
  })
  test("CSS transform composition preserves authored local geometry", () => {
    const engine = camera()
    const el = document.createElement("div")
    el.style.transform = "rotate(12deg)"
    const adapter = connectCSS(engine, el, {composeTransform:true, translate3d:true})
    engine.jumpTo({x:30,y:40,scale:2})
    expect(el.style.transform).toBe("translate3d(30px,40px,0) scale(2) rotate(12deg)")
    adapter.dispose()
    expect(el.style.transform).toBe("rotate(12deg)")
  })
  test("SVG transforms can compose instead of replace local authored transforms", () => {
    const engine = camera()
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    group.setAttribute("transform", "rotate(12)")
    const adapter = connectSVG(engine, group, {composeTransform:true})
    engine.jumpTo({x:5,y:7,scale:3})
    expect(group.getAttribute("transform")).toBe("translate(5 7) scale(3) rotate(12)")
    adapter.dispose()
    expect(group.getAttribute("transform")).toBe("rotate(12)")
  })
  test("embedded SVG does not overwrite the parent camera viewport", () => {
    const engine = camera()
    engine.setViewport(800,600)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    Object.defineProperty(svg, "clientWidth", {value:400})
    Object.defineProperty(svg, "clientHeight", {value:300})
    const adapter = connectSVGViewBox(engine, svg, {syncViewport:false})
    expect(engine.getViewport()).toEqual({width:800,height:600})
    engine.jumpTo({x:0,y:0,scale:2})
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 150")
    adapter.dispose()
  })
})
