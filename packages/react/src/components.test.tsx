import * as React from "react"
import { describe, expect, test, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { ZoomPort, useZoomPort, useCamera, useCameraSelector } from "./index"
import type { CameraController } from "@zoomport/core"

describe("React primitives", () => {
  test("server rendering works with both external-store hooks", () => {
    function ReadCamera() {
      const c = useCamera()
      const scale = useCameraSelector(snapshot => snapshot.scale)
      return <output>{c.x}:{c.y}:{scale}</output>
    }
    const html = renderToString(<ZoomPort.Root initial={{ x: 12, y: 34, scale: 2 }}>
      <ZoomPort.Viewport><ReadCamera /></ZoomPort.Viewport>
    </ZoomPort.Root>)
    expect(html.replaceAll("<!-- -->", "")).toContain("12:34:2")
  })
  test("image resolution work is skipped on pure pan and recalculated on DPR resize", () => {
    let engine: CameraController | undefined
    const requests: Array<{ width: number; dpr: number }> = []
    function Capture() { engine = useZoomPort(); return null }
    const view = render(<ZoomPort.Root><ZoomPort.Viewport><Capture />
      <ZoomPort.Image alt="Multi-DPR" src="/base.png"
        intrinsicWidth={400} intrinsicHeight={200} pixelRatio={undefined}
        resolveSource={({ bucketWidth, dpr }) => {
          requests.push({ width: bucketWidth, dpr })
          return "/source-" + bucketWidth + ".png"
        }} />
    </ZoomPort.Viewport></ZoomPort.Root>)
    const node = view.getByAltText("Multi-DPR") as HTMLImageElement
    const initialCalls = requests.length
    const oldWidth = node.style.width
    act(() => engine!.panBy(120, 30))
    expect(node.style.width).toBe(oldWidth)
    expect(requests.length).toBe(initialCalls)
    const originalDpr = window.devicePixelRatio
    try {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 })
      act(() => window.dispatchEvent(new Event("resize")))
      expect(requests.at(-1)?.dpr).toBe(2)
      expect(requests.at(-1)?.width).toBe(1024)
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: originalDpr })
      view.unmount()
    }
  })
  test("explicit controlled revision overrides previously emitted history snapshots", () => {
    let engine: CameraController | undefined
    let setControl: React.Dispatch<React.SetStateAction<{ value: {x: number; y: number; scale: number}; revision: number }>> | undefined
    function Capture() { engine = useZoomPort(); return null }
    function Controlled() {
      const [control, set] = React.useState({ value: { x: 0, y: 0, scale: 1 }, revision: 0 })
      setControl = set
      return <ZoomPort.Root reducedMotion value={control.value} valueRevision={control.revision}
        onCameraChange={camera => set(current => ({ ...current, value: { ...camera } }))}>
        <ZoomPort.Viewport><Capture /></ZoomPort.Viewport>
      </ZoomPort.Root>
    }
    const view = render(<Controlled />)
    act(() => engine!.jumpTo({ x: 75, y: 20, scale: 2 }))
    act(() => engine!.jumpTo({ x: 120, y: 40, scale: 3 }))
    // The first camera is still in the recent echo ring; an explicit history
    // revision must win even if a state manager clones its value.
    act(() => setControl!({ value: { x: 75, y: 20, scale: 2 }, revision: 1 }))
    expect(engine!.getSnapshot()).toEqual({ x: 75, y: 20, scale: 2 })
    view.unmount()
  })
  test("decoded image source updates never apply a superseded request", async () => {
    const pending: Array<{src:string; resolve:() => void}> = []
    vi.stubGlobal("Image", class {
      src = ""
      decode() {
        return new Promise<void>(resolve => pending.push({src:this.src,resolve}))
      }
    })
    let engine: CameraController | undefined
    function Capture() { engine = useZoomPort(); return null }
    try {
      const view = render(<ZoomPort.Root><ZoomPort.Viewport>
        <Capture />
        <ZoomPort.Image alt="Progressive" src="/base.jpg" intrinsicWidth={500} intrinsicHeight={250}
          maxSourceWidth={2048} pixelRatio={1} decodeBeforeSwap
          resolveSource={({bucketWidth}) => `/source-${bucketWidth}.jpg`} />
      </ZoomPort.Viewport></ZoomPort.Root>)
      const node = view.getByAltText("Progressive") as HTMLImageElement
      expect(pending.map(p => p.src)).toEqual(["/source-512.jpg"])
      expect(node.getAttribute("src")).toBe("/base.jpg")
      act(() => engine!.jumpTo({x:0,y:0,scale:2}))
      expect(pending.map(p => p.src)).toEqual(["/source-512.jpg","/source-1024.jpg"])
      await act(async () => { pending[0]!.resolve(); await Promise.resolve() })
      expect(node.getAttribute("src")).toBe("/base.jpg")
      await act(async () => { pending[1]!.resolve(); await Promise.resolve() })
      expect(node.getAttribute("src")).toBe("/source-1024.jpg")
      view.unmount()
    } finally { vi.unstubAllGlobals() }
  })
  test("selective subscriptions skip unrelated camera changes", () => {
    let engine: CameraController | undefined
    let renders = 0
    const projection = (c: {scale:number}) => Math.floor(c.scale * 100)
    function Capture() { engine = useZoomPort(); return null }
    function Indicator() {
      renders++
      const percent = useCameraSelector(projection)
      return <output>{percent}</output>
    }
    const view = render(<ZoomPort.Root reducedMotion>
      <ZoomPort.Viewport><Capture /><Indicator /></ZoomPort.Viewport>
    </ZoomPort.Root>)
    expect(renders).toBe(1)
    act(() => engine!.panBy(10,20))
    expect(renders).toBe(1)
    act(() => engine!.jumpTo({x:0,y:0,scale:2}))
    expect(renders).toBe(2)
    expect(view.getByText("200")).toBeTruthy()
    view.unmount()
  })
  test("context remains stable during externally echoed camera frames", () => {
    let engine: CameraController | undefined
    let renders = 0
    const Capture = React.memo(function Capture() {
      renders++
      engine = useZoomPort()
      return null
    })
    function Controlled() {
      const [value,setValue] = React.useState({x:0,y:0,scale:1})
      return <ZoomPort.Root value={value} onCameraChange={setValue} reducedMotion>
        <ZoomPort.Viewport><Capture /></ZoomPort.Viewport>
      </ZoomPort.Root>
    }
    const view = render(<Controlled />)
    act(() => engine!.jumpTo({x:40,y:20,scale:2}))
    expect(renders).toBe(1)
    view.unmount()
  })
  test("non-power-of-two image source cap preserves the available resolution", () => {
    const requests: number[] = []
    const view = render(<ZoomPort.Root><ZoomPort.Viewport>
      <ZoomPort.Image alt="Source cap" src="/base.png" intrinsicWidth={700} intrinsicHeight={350}
        pixelRatio={1} maxSourceWidth={1000} resolveSource={({bucketWidth}) => {
          requests.push(bucketWidth)
          return `/image-${bucketWidth}.png`
        }} />
    </ZoomPort.Viewport></ZoomPort.Root>)
    expect(requests).toEqual([1000])
    view.unmount()
  })
  test("camera frames do not re-render unobserving descendants", () => {
    let engine: CameraController | undefined
    let renders = 0
    function Capture() { engine = useZoomPort(); return null }
    function HeavyChild() { renders++; return <span>stable child</span> }
    const view = render(<ZoomPort.Root>
      <ZoomPort.Viewport aria-label="Test viewport">
        <ZoomPort.Content><HeavyChild /></ZoomPort.Content><Capture />
      </ZoomPort.Viewport>
    </ZoomPort.Root>)
    expect(renders).toBe(1)
    act(() => {
      engine!.setViewport(900,600)
      engine!.jumpTo({x:120,y:-80,scale:3})
    })
    const content = view.container.querySelector<HTMLDivElement>("[style*='scale']")
    expect(content?.style.transform).toContain("scale(3)")
    expect(renders).toBe(1)
    view.unmount()
  })

  test("resolution-aware Image resizes natively and only fetches on new bucket", () => {
    let engine: CameraController | undefined
    function Capture() { engine = useZoomPort(); return null }
    const requests: number[] = []
    const resolveSource = ({ bucketWidth }: {bucketWidth:number}) => {
      requests.push(bucketWidth)
      return "/tile-" + bucketWidth + ".png"
    }
    const view = render(<ZoomPort.Root><ZoomPort.Viewport>
      <ZoomPort.Image alt="Native image" intrinsicWidth={400} intrinsicHeight={200}
        src="/base.png" resolveSource={resolveSource} pixelRatio={2} />
      <Capture />
    </ZoomPort.Viewport></ZoomPort.Root>)
    const image = view.getByAltText("Native image") as HTMLImageElement
    act(() => { engine!.jumpTo({x:30,y:50,scale:1.2}) })
    expect(image.style.width).toBe("480px")
    expect(image.style.height).toBe("240px")
    expect(image.style.transform).toBe("translate(30px,50px)")
    expect(image.style.transform).not.toContain("scale")
    expect(requests).toEqual([1024])
    act(() => { engine!.jumpTo({x:30,y:50,scale:1.25}) })
    expect(requests).toEqual([1024])
    view.unmount()
  })

  test("controlled snapshot echoes never interrupt running animation", () => {
    vi.stubGlobal("requestAnimationFrame", () => 17)
    vi.stubGlobal("cancelAnimationFrame", () => {})
    let engine: CameraController | undefined
    function Capture() { engine = useZoomPort(); return null }
    function Controlled() {
      const [value, setValue] = React.useState({x:0,y:0,scale:1})
      return <ZoomPort.Root value={value} onCameraChange={setValue}>
        <ZoomPort.Viewport><Capture /></ZoomPort.Viewport>
      </ZoomPort.Root>
    }
    try {
      const view = render(<Controlled />)
      act(() => engine!.setCamera({x:120,y:80,scale:4}, true))
      act(() => engine!.advance(16))
      expect(engine!.getSnapshot().scale).toBeGreaterThan(1)
      expect(engine!.getSnapshot().scale).toBeLessThan(4)
      expect(engine!.getTarget().scale).toBe(4)
      view.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  test("cloned controlled echoes do not interrupt interpolation", () => {
    vi.stubGlobal("requestAnimationFrame", () => 17)
    vi.stubGlobal("cancelAnimationFrame", () => {})
    let engine: CameraController | undefined
    function Capture() { engine = useZoomPort(); return null }
    function Controlled() {
      const [value, setValue] = React.useState({x:0,y:0,scale:1})
      return <ZoomPort.Root value={value} onCameraChange={c => setValue({...c})}>
        <ZoomPort.Viewport><Capture /></ZoomPort.Viewport>
      </ZoomPort.Root>
    }
    try {
      const view = render(<Controlled />)
      act(() => engine!.setCamera({x:80,y:20,scale:4}, true))
      act(() => engine!.advance(16))
      expect(engine!.getSnapshot().scale).toBeGreaterThan(1)
      expect(engine!.getSnapshot().scale).toBeLessThan(4)
      expect(engine!.getTarget().scale).toBe(4)
      view.unmount()
    } finally { vi.unstubAllGlobals() }
  })
})
