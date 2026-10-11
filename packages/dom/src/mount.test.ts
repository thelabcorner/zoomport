import { afterEach, describe, expect, it } from "vitest"
import { CameraController } from "@zoomport/core"
import { mountZoomPort } from "./mount.js"

const active: Array<ReturnType<typeof mountZoomPort>> = []
afterEach(() => { for (const port of active.splice(0)) port.dispose(); document.body.replaceChildren() })
const setup = () => {
  const viewport = document.createElement("div")
  const content = document.createElement("div")
  viewport.append(content)
  document.body.append(viewport)
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  })
  return { viewport, content }
}
describe("framework-free mountZoomPort", () => {
  it("attaches a live camera and restores authored DOM on dispose", () => {
    const { viewport, content } = setup()
    viewport.style.overflow = "scroll"
    content.style.transform = "rotate(2deg)"
    const port = mountZoomPort({ viewport, content, wheelMode: "zoom", reducedMotion: true })
    active.push(port)
    expect(viewport.getAttribute("role")).toBe("region")
    expect(viewport.getAttribute("aria-label")).toBe("Pan and zoom viewport")
    expect(port.engine.getViewport()).toEqual({ width: 800, height: 600 })
    port.engine.jumpTo({ x: 21, y: -17, scale: 2 })
    expect(content.style.transform).toContain("scale(2)")
    port.dispose()
    expect(content.style.transform).toBe("rotate(2deg)")
    expect(viewport.style.overflow).toBe("scroll")
    expect(viewport.getAttribute("role")).toBeNull()
    expect(viewport.getAttribute("tabindex")).toBeNull()
    expect(viewport.style.touchAction ?? "").toBe("")
    port.dispose()
  })
  it("switches native rendering strategies without altering camera state", () => {
    const { viewport, content } = setup()
    const port = mountZoomPort({ viewport, content, css: { size: { width: 1200, height: 800 } }, reducedMotion: true })
    active.push(port)
    port.engine.jumpTo({ x: 45, y: 66, scale: 3 })
    const before = port.engine.getSnapshot()
    port.setRenderer("css-layout")
    expect(content.style.zoom).toBe("3")
    port.setRenderer("css-hybrid")
    expect(content.style.zoom ?? "").toBe("")
    expect(content.style.width).toBe("4800px")
    expect(port.engine.getSnapshot()).toEqual(before)
    port.setRenderer("css-transform")
    expect(content.style.width).toBe("")
    expect(content.style.transform).toContain("scale(3)")
    port.setRenderer("css-transform")
    expect(port.renderer).toBe("css-transform")
  })
  it("rejects incompatible mode switches without damaging the existing renderer", () => {
    const { viewport, content } = setup()
    const port = mountZoomPort({ viewport, content })
    active.push(port)
    expect(() => port.setRenderer("svg-viewbox")).toThrow("requires an <svg>")
    expect(() => port.setRenderer("css-hybrid")).toThrow("requires positive intrinsic size")
    port.engine.jumpTo({ x: 2, y: 3, scale: 1.5 })
    expect(content.style.transform).toContain("scale(1.5)")
    expect(port.renderer).toBe("css-transform")
  })
  it("allows runtime configuration and disables touch capture correctly", () => {
    const { viewport, content } = setup()
    const port = mountZoomPort({ viewport, content })
    active.push(port)
    expect(viewport.style.touchAction).toBe("none")
    port.setOptions({ disabled: true })
    expect(viewport.style.touchAction).toBe("auto")
    port.setOptions({ disabled: false, enablePan: false, enablePinch: false })
    expect(viewport.style.touchAction).toBe("auto")
    port.setOptions({ enablePan: true })
    expect(viewport.style.touchAction).toBe("none")
  })
  it("does not destroy an externally owned camera", () => {
    const { viewport, content } = setup()
    const external = new CameraController()
    const port = mountZoomPort({ viewport, content, engine: external })
    port.dispose()
    external.jumpTo({ x: 50, y: 10, scale: 2 })
    expect(external.getSnapshot().x).toBe(50)
    expect(() => port.setRenderer("css-layout")).toThrow("already disposed")
    external.destroy()
  })
})