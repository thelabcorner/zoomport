import * as React from "react"
import { afterEach, describe, expect, test } from "vitest"
import { act, fireEvent, render, cleanup } from "@testing-library/react"
import { ZoomPort, useZoomPort, type RootProps } from "./index"
import type { CameraController } from "@zoomport/core"

afterEach(cleanup)

function fixture(props: Partial<RootProps> = {}) {
  let engine: CameraController | undefined
  function Capture() { engine = useZoomPort(); return null }
  const view = render(<ZoomPort.Root reducedMotion {...props}>
    <ZoomPort.Viewport data-testid="viewport"><Capture /></ZoomPort.Viewport>
  </ZoomPort.Root>)
  const node = view.getByTestId("viewport") as HTMLDivElement
  Object.defineProperty(node, "clientWidth", { configurable: true, value: 200 })
  Object.defineProperty(node, "clientHeight", { configurable: true, value: 100 })
  node.getBoundingClientRect = () => ({
    left: 50, top: 20, right: 450, bottom: 220, width: 400, height: 200,
    x: 50, y: 20, toJSON: () => ({}),
  })
  const captured = new Set<number>()
  node.setPointerCapture = (id) => { captured.add(id) }
  node.hasPointerCapture = (id) => captured.has(id)
  node.releasePointerCapture = (id) => { captured.delete(id) }
  return { view, node, engine: engine!, captured }
}
function pointer(node: HTMLElement, type: string, id: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, "pointerId", { value: id })
  Object.defineProperty(event, "pointerType", { value: "touch" })
  fireEvent(node, event)
}

describe("viewport input invariants", () => {
  test("nested viewports do not double-consume a child's wheel gesture", () => {
    let outer: CameraController | undefined
    let inner: CameraController | undefined
    let reactWheels = 0
    function Capture({inside}: {inside:boolean}) {
      const engine = useZoomPort()
      if (inside) inner = engine
      else outer = engine
      return null
    }
    const view = render(<ZoomPort.Root reducedMotion wheelMode="zoom">
      <ZoomPort.Viewport data-testid="outer">
        <Capture inside={false} />
        <ZoomPort.Root reducedMotion wheelMode="zoom">
          <ZoomPort.Viewport data-testid="inner" onWheel={() => reactWheels++}><Capture inside /></ZoomPort.Viewport>
        </ZoomPort.Root>
      </ZoomPort.Viewport>
    </ZoomPort.Root>)
    act(() => fireEvent.wheel(view.getByTestId("inner"), {
      deltaY: -100, clientX: 50, clientY: 40, cancelable: true,
    }))
    expect(inner!.getSnapshot().scale).toBeGreaterThan(1)
    expect(outer!.getSnapshot().scale).toBe(1)
    expect(reactWheels).toBe(1)
    view.unmount()
  })

  test("nested keyboard navigation only moves the focused viewport", () => {
    let outer: CameraController | undefined
    let inner: CameraController | undefined
    let keys = 0
    function Capture({child}: {child:boolean}) {
      const engine = useZoomPort()
      if (child) inner = engine
      else outer = engine
      return null
    }
    const view = render(<ZoomPort.Root reducedMotion>
      <ZoomPort.Viewport data-testid="parent"><Capture child={false} />
        <ZoomPort.Root reducedMotion><ZoomPort.Viewport data-testid="child" onKeyDown={() => keys++}>
          <Capture child />
        </ZoomPort.Viewport></ZoomPort.Root>
      </ZoomPort.Viewport>
    </ZoomPort.Root>)
    act(() => fireEvent.keyDown(view.getByTestId("child"), {key:"ArrowLeft",cancelable:true}))
    expect(inner!.getSnapshot().x).toBe(48)
    expect(outer!.getSnapshot().x).toBe(0)
    expect(keys).toBe(1)
    view.unmount()
  })

  test("wheel pivot respects an axis-aligned CSS-scaled host viewport", () => {
    const f = fixture({ wheelMode: "zoom" })
    const pivot = { x: 40, y: 30 } // client(130, 80) in the 2x host
    act(() => fireEvent.wheel(f.node, {
      deltaY: -100, deltaMode: 0, clientX: 130, clientY: 80, cancelable: true,
    }))
    const c = f.engine.getSnapshot()
    expect(c.scale).toBeGreaterThan(1)
    expect(c.x).toBeCloseTo(pivot.x * (1 - c.scale), 8)
    expect(c.y).toBeCloseTo(pivot.y * (1 - c.scale), 8)
    f.view.unmount()
  })

  test("the event-specific wheel override handles trackpads without false zooms", () => {
    const f = fixture({ wheelMode: "zoom", resolveWheelMode: () => "pan" })
    act(() => fireEvent.wheel(f.node, { deltaX: 70, deltaY: 90, cancelable: true }))
    expect(f.engine.getSnapshot()).toMatchObject({ x: -70, y: -90, scale: 1 })
    f.view.unmount()
  })

  test("two pointers never cause a phantom pan when pinch is disabled", () => {
    const f = fixture({ enablePinch: false, enableInertia: false })
    act(() => {
      pointer(f.node, "pointerdown", 1, 90, 60)
      pointer(f.node, "pointermove", 1, 130, 60)
    })
    expect(f.engine.getSnapshot().x).toBe(20)
    act(() => {
      pointer(f.node, "pointerdown", 2, 190, 70)
      pointer(f.node, "pointermove", 2, 250, 70)
      pointer(f.node, "pointermove", 1, 170, 60)
    })
    expect(f.engine.getSnapshot().x).toBe(20)
    act(() => {
      pointer(f.node, "pointerup", 2, 250, 70)
      pointer(f.node, "pointermove", 1, 210, 60)
    })
    expect(f.engine.getSnapshot().x).toBe(40)
    act(() => pointer(f.node, "pointerup", 1, 210, 60))
    expect(f.captured.size).toBe(0)
    f.view.unmount()
  })

  test("disabled viewport does not intercept native touch scroll", () => {
    const f = fixture({ disabled: true })
    expect(f.node.style.touchAction).toBe("auto")
    act(() => fireEvent.wheel(f.node, { deltaY: 55, cancelable: true }))
    expect(f.engine.getSnapshot()).toMatchObject({ x: 0, y: 0, scale: 1 })
    f.view.unmount()
  })
})

describe("configurable input ownership", () => {
  test("frame-coalesced pointer moves publish only the latest location per RAF", () => {
    const originalRequest = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 1
    globalThis.requestAnimationFrame = callback => {
      const id = nextId++
      frames.set(id, callback)
      return id
    }
    globalThis.cancelAnimationFrame = id => { frames.delete(id) }
    try {
      const f = fixture({pointerMoveScheduling:"frame", enableInertia:false})
      const observed: number[] = []
      f.engine.subscribe(c => observed.push(c.x))
      act(() => {
        pointer(f.node, "pointerdown", 1, 90, 60)
        for (let i = 0; i < 12; i++) pointer(f.node, "pointermove", 1, 92 + i * 4, 60)
      })
      expect(observed).toEqual([])
      expect(frames.size).toBe(1)
      const frame = frames.values().next().value!
      frames.clear()
      act(() => frame(16))
      expect(f.engine.getSnapshot().x).toBe(23)
      expect(observed).toEqual([23])
      act(() => {
        pointer(f.node, "pointermove", 1, 154, 60)
        pointer(f.node, "pointerup", 1, 154, 60)
      })
      expect(frames.size).toBe(0)
      expect(f.engine.getSnapshot().x).toBe(32)
      f.view.unmount()
    } finally {
      globalThis.requestAnimationFrame = originalRequest
      globalThis.cancelAnimationFrame = originalCancel
    }
  })
  test("unmount cancels queued frame updates and releases active pointer capture", () => {
    const originalRequest = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    const pending = new Set<number>()
    globalThis.requestAnimationFrame = () => { pending.add(13); return 13 }
    globalThis.cancelAnimationFrame = id => { pending.delete(id) }
    try {
      const f = fixture({pointerMoveScheduling:"frame"})
      act(() => {
        pointer(f.node,"pointerdown",1,90,60)
        pointer(f.node,"pointermove",1,110,60)
      })
      expect(pending.size).toBe(1)
      f.view.unmount()
      expect(pending.size).toBe(0)
      expect(f.captured.size).toBe(0)
    } finally {
      globalThis.requestAnimationFrame = originalRequest
      globalThis.cancelAnimationFrame = originalCancel
    }
  })
  test("disabling a viewport mid-gesture relinquishes capture immediately", () => {
    let engine: CameraController | undefined
    function Capture() { engine = useZoomPort(); return null }
    const tree = (disabled: boolean) => <ZoomPort.Root disabled={disabled} reducedMotion>
      <ZoomPort.Viewport data-testid="gesture"><Capture /></ZoomPort.Viewport>
    </ZoomPort.Root>
    const view = render(tree(false))
    const node = view.getByTestId("gesture") as HTMLDivElement
    const captured = new Set<number>()
    node.setPointerCapture = id => { captured.add(id) }
    node.hasPointerCapture = id => captured.has(id)
    node.releasePointerCapture = id => { captured.delete(id) }
    act(() => pointer(node,"pointerdown",1,10,10))
    expect(captured.has(1)).toBe(true)
    act(() => view.rerender(tree(true)))
    expect(captured.size).toBe(0)
    const before = engine!.getSnapshot()
    act(() => pointer(node,"pointermove",1,100,100))
    expect(engine!.getSnapshot()).toBe(before)
    view.unmount()
  })
  test("clicks survive taps but not completed drag gestures", () => {
    const f = fixture({enableInertia:false,clickDistance:5})
    let clicks = 0
    f.node.addEventListener("click", () => clicks++)
    act(() => {
      pointer(f.node,"pointerdown",1,90,60)
      pointer(f.node,"pointermove",1,130,60)
      pointer(f.node,"pointerup",1,130,60)
    })
    const dragged = new MouseEvent("click",{bubbles:true,cancelable:true})
    act(() => f.node.dispatchEvent(dragged))
    expect(dragged.defaultPrevented).toBe(true)
    expect(clicks).toBe(0)
    act(() => {
      pointer(f.node,"pointerdown",2,90,60)
      pointer(f.node,"pointermove",2,94,60)
      pointer(f.node,"pointerup",2,94,60)
    })
    const tapped = new MouseEvent("click",{bubbles:true,cancelable:true})
    act(() => f.node.dispatchEvent(tapped))
    expect(tapped.defaultPrevented).toBe(false)
    expect(clicks).toBe(1)
    f.view.unmount()
  })
  test("wheel pass-through releases browser scrolling at camera limits", () => {
    const f = fixture({wheelMode:"zoom",wheelAtBounds:"release",minScale:1,maxScale:2})
    const blocked = new WheelEvent("wheel", {bubbles:true,cancelable:true,deltaY:100})
    act(() => f.node.dispatchEvent(blocked))
    expect(blocked.defaultPrevented).toBe(false)
    expect(f.engine.getSnapshot().scale).toBe(1)
    const accepted = new WheelEvent("wheel", {bubbles:true,cancelable:true,deltaY:-100})
    act(() => f.node.dispatchEvent(accepted))
    expect(accepted.defaultPrevented).toBe(true)
    expect(f.engine.getSnapshot().scale).toBeGreaterThan(1)
    f.view.unmount()
  })
  test("keyboard pan and zoom are configurable", () => {
    const f = fixture({keyboardStep:75,keyboardZoomFactor:2})
    act(() => fireEvent.keyDown(f.node, {key:"ArrowLeft",cancelable:true}))
    expect(f.engine.getSnapshot().x).toBe(75)
    act(() => fireEvent.keyDown(f.node, {key:"+",cancelable:true}))
    expect(f.engine.getSnapshot().scale).toBe(2)
    f.view.unmount()
  })
})
