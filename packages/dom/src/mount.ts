import { CameraController, type ZoomPortOptions, type Camera, type Bounds } from "@zoomport/core"
import { connectCSS, connectSVG, connectSVGViewBox, connectCanvas2D, type CSSAdapterOptions, type CssRenderMode, type RenderAdapter } from "./adapters.js"
import { bindViewport, type InteractionOptions } from "./input.js"

export type DOMRenderMode = CssRenderMode | "svg-transform" | "svg-viewbox" | "canvas2d"
export type RenderSurface = HTMLElement | SVGGElement | SVGSVGElement | HTMLCanvasElement
export interface MountOptions extends ZoomPortOptions, InteractionOptions {
  /** Existing viewport element; ZoomPort does not own or remove it. */
  viewport: HTMLElement
  /** Native DOM, SVG or Canvas drawing surface. */
  content: RenderSurface
  renderer?: DOMRenderMode
  /** CSS renderer options, including intrinsic content size and hybrid budgets. */
  css?: Omit<CSSAdapterOptions, "mode">
  /** Required for canvas2d, whose content must be drawn at every camera update. */
  draw?: (ctx: CanvasRenderingContext2D, camera: Readonly<Camera>) => void
  /** Restore state by default; supply an existing engine to share the same camera. */
  engine?: CameraController
  /** Apply accessible viewport defaults when attributes are absent. */
  accessible?: boolean
  /** Whether to observe viewport resizes (default true). */
  observeResize?: boolean
}
export interface MountedZoomPort {
  readonly engine: CameraController
  readonly renderer: DOMRenderMode
  /** Change renderer in place without resetting pan or zoom. */
  setRenderer(renderer: DOMRenderMode): void
  setOptions(options: Partial<InteractionOptions>): void
  fit(bounds?: Bounds, padding?: number): void
  invalidate(): void
  dispose(): void
}
/**
 * Zero-framework entry point. The application owns its DOM; ZoomPort owns only
 * the listeners, observers and style/attribute mutations it applies.
 * Does not depend on React, Effect, a CSS framework or DOM globals at import time.
 */
export function mountZoomPort(options: MountOptions): MountedZoomPort {
  const { viewport, content } = options
  const ownEngine = !options.engine
  const engine = options.engine ?? new CameraController(options)
  let renderer = options.renderer ?? "css-transform"
  let interactionOptions: InteractionOptions = { ...options }
  let disposed = false
  let adapter: RenderAdapter | null = null
  const previous = {
    position: viewport.style.position,
    overflow: viewport.style.overflow,
    touchAction: viewport.style.touchAction,
    tabindex: viewport.getAttribute("tabindex"),
    role: viewport.getAttribute("role"),
    label: viewport.getAttribute("aria-label"),
  }
  const isHTML = (node: RenderSurface): node is HTMLElement => node instanceof HTMLElement
  const isSVGGroup = (node: RenderSurface): node is SVGGElement => node instanceof SVGGElement
  const isSVGRoot = (node: RenderSurface): node is SVGSVGElement => node instanceof SVGSVGElement
  const isCanvas = (node: RenderSurface): node is HTMLCanvasElement => node instanceof HTMLCanvasElement
  const validateSurface = (mode: DOMRenderMode): void => {
    if (mode === "svg-transform" && !isSVGGroup(content)) throw new TypeError("ZoomPort: svg-transform requires an SVG <g> surface")
    if (mode === "svg-viewbox" && !isSVGRoot(content)) throw new TypeError("ZoomPort: svg-viewbox requires an <svg> surface")
    if (mode === "canvas2d" && (!isCanvas(content) || !options.draw)) throw new TypeError("ZoomPort: canvas2d requires a canvas and draw()")
    if (mode.startsWith("css-") && !isHTML(content)) throw new TypeError("ZoomPort: CSS modes require an HTMLElement surface")
    if ((mode === "css-resize" || mode === "css-hybrid") &&
      (!options.css?.size || !Number.isFinite(options.css.size.width) || !Number.isFinite(options.css.size.height) ||
       options.css.size.width <= 0 || options.css.size.height <= 0)) {
      throw new RangeError("ZoomPort: css-resize/css-hybrid requires positive intrinsic size")
    }
  }
  const buildAdapter = (mode: DOMRenderMode): RenderAdapter => {
    validateSurface(mode)
    if (mode === "svg-transform") {
      if (!isSVGGroup(content)) throw new TypeError("ZoomPort: svg-transform requires an SVG <g> surface")
      return connectSVG(engine, content)
    }
    if (mode === "svg-viewbox") {
      if (!isSVGRoot(content)) throw new TypeError("ZoomPort: svg-viewbox requires an <svg> surface")
      return connectSVGViewBox(engine, content, { syncViewport: false })
    }
    if (mode === "canvas2d") {
      if (!isCanvas(content) || !options.draw) throw new TypeError("ZoomPort: canvas2d requires a canvas and draw()")
      return connectCanvas2D(engine, content, options.draw)
    }
    if (!isHTML(content)) throw new TypeError("ZoomPort: CSS modes require an HTMLElement surface")
    return connectCSS(engine, content, { ...options.css, mode })
  }
  // Validate the first adapter before changing any viewport attributes.
  try { adapter = buildAdapter(renderer) }
  catch (error) { if (ownEngine) engine.destroy(); throw error }
  const accessibility = options.accessible !== false
  if (accessibility) {
    if (!viewport.hasAttribute("tabindex")) viewport.tabIndex = 0
    if (!viewport.hasAttribute("role")) viewport.setAttribute("role", "region")
    if (!viewport.hasAttribute("aria-label")) viewport.setAttribute("aria-label", "Pan and zoom viewport")
  }
  if (!viewport.style.position) viewport.style.position = "relative"
  if (!viewport.style.overflow) viewport.style.overflow = "hidden"
  const updateTouchAction = () => {
    viewport.style.touchAction = interactionOptions.disabled ||
      (interactionOptions.enablePan === false && interactionOptions.enablePinch === false) ? "auto" : "none"
  }
  updateTouchAction()
  const onResize = () => engine.setViewport(viewport.clientWidth, viewport.clientHeight)
  onResize()
  const resize = options.observeResize === false || typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize)
  resize?.observe(viewport)
  let inputDispose = bindViewport(engine, viewport, () => interactionOptions)
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
  const updateMotion = () => engine.setReducedMotion(options.reducedMotion ?? media?.matches ?? false)
  updateMotion()
  media?.addEventListener?.("change", updateMotion)
  return {
    engine,
    get renderer() { return renderer },
    setRenderer(mode) {
      if (disposed) throw new Error("ZoomPort: viewport already disposed")
      if (mode === renderer) return
      // Validate before disposing. Reattach the old renderer on unexpected
      // adapter failures; never capture a previous camera transform as "authored".
      validateSurface(mode)
      adapter?.dispose()
      try { adapter = buildAdapter(mode) }
      catch (error) { adapter = buildAdapter(renderer); throw error }
      renderer = mode
    },
    setOptions(next) {
      if (disposed) return
      // Release active pointer capture immediately on disabling or changing
      // gesture capabilities or scheduling mode, matching React's lifecycle.
      if (("disabled" in next && next.disabled !== interactionOptions.disabled) ||
          ("enablePan" in next && next.enablePan !== interactionOptions.enablePan) ||
          ("enablePinch" in next && next.enablePinch !== interactionOptions.enablePinch) ||
          ("pointerMoveScheduling" in next && next.pointerMoveScheduling !== interactionOptions.pointerMoveScheduling)) {
        inputDispose()
        interactionOptions = { ...interactionOptions, ...next }
        inputDispose = bindViewport(engine, viewport, () => interactionOptions)
      } else {
        interactionOptions = { ...interactionOptions, ...next }
      }
      updateTouchAction()
    },
    fit(bounds, padding) { if (!disposed) engine.fit(bounds, padding) },
    invalidate() { if (!disposed) adapter?.invalidate() },
    dispose() {
      if (disposed) return
      disposed = true
      inputDispose()
      resize?.disconnect()
      media?.removeEventListener?.("change", updateMotion)
      adapter?.dispose()
      viewport.style.position = previous.position
      viewport.style.overflow = previous.overflow
      viewport.style.touchAction = previous.touchAction
      for (const [attribute, value] of [["tabindex", previous.tabindex], ["role", previous.role], ["aria-label", previous.label]] as const) {
        if (value === null) viewport.removeAttribute(attribute)
        else viewport.setAttribute(attribute, value)
      }
      if (ownEngine) engine.destroy()
    },
  }
}