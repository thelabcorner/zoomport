import type { Camera, CameraController, Size } from "@zoomport/core"

export interface RenderAdapter {
  /** Force a redraw without changing the camera, e.g. after scene/image updates. */
  invalidate(): void
  dispose(): void
}
export type CssRenderMode = "css-transform" | "css-hybrid" | "css-layout" | "css-resize"
export interface CSSAdapterOptions {
  mode?: CssRenderMode
  /** Content's intrinsic dimensions in world units. Mandatory for css-resize. */
  size?: Readonly<Size>
  /** Hybrid surface budget in CSS pixels (before device pixel ratio). */
  maxLayerPixels?: number
  /** Optional physical pixel ceiling for a hybrid layer; accounts for DPR. */
  maxDevicePixels?: number
  /** Optional per-axis device-pixel budget for a hybrid layer. */
  maxDeviceDimension?: number
  /** Explicit DPR for reproducibility. Defaults to devicePixelRatio. */
  pixelRatio?: number
  /** 0..0.49 fractional tier hysteresis; prevents repaint oscillation. */
  tierHysteresis?: number
  /** 2D keeps text composition predictable; 3D may assist heavily layered scenes. */
  translate3d?: boolean
  /** Append an existing local CSS transform after the camera transform. */
  composeTransform?: boolean
}
export function connectRenderer(engine: CameraController, render: (camera: Readonly<Camera>) => void): RenderAdapter {
  let active = true
  const invalidate = () => { if (active) render(engine.getSnapshot()) }
  invalidate()
  const unsubscribe = engine.subscribe(render)
  return { invalidate, dispose() { if (!active) return; active = false; unsubscribe() } }
}
const translateXY = (x: number, y: number, gpu: boolean): string =>
  gpu ? `translate3d(${x}px,${y}px,0)` : `translate(${x}px,${y}px)`
const translate = (c: Readonly<Camera>, gpu: boolean): string => translateXY(c.x, c.y, gpu)

/**
 * Three distinct presentation strategies sharing exactly the same camera math:
 * - css-transform: fast compositor-friendly scaling, no anti-blur guarantees.
 * - css-hybrid: paint a larger element at discrete 2x zoom buckets and use a
 *   reciprocal CSS scale to bridge continuously. Requires responsive children.
 * - css-layout: CSS zoom induces layout/paint, potentially clearer typography.
 * - css-resize: sizes the native element (img/svg); caller must ensure children resize.
 * None can create image detail beyond an image's original source pixels.
 */
export function connectCSS(
  engine: CameraController,
  node: HTMLElement,
  options: CSSAdapterOptions = {},
): RenderAdapter {
  const mode = options.mode ?? "css-transform"
  const size = options.size
  if ((mode === "css-resize" || mode === "css-hybrid") &&
    (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0))
    throw new RangeError("ZoomPort: css-resize/css-hybrid requires finite positive intrinsic size")
  const gpu = options.translate3d ?? false
  const localTransform = options.composeTransform && node.style.transform && node.style.transform !== "none"
    ? ` ${node.style.transform}` : ""
  const old = {
    transform: node.style.transform,
    transformOrigin: node.style.transformOrigin,
    zoom: node.style.zoom,
    width: node.style.width,
    height: node.style.height,
  }
  node.style.transformOrigin = "0 0"
  const maxPixels = Number.isFinite(options.maxLayerPixels) && (options.maxLayerPixels ?? 0) > 0
    ? options.maxLayerPixels! : 16_000_000
  const sourceDpr = options.pixelRatio ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
  const dpr = Number.isFinite(sourceDpr) && sourceDpr > 0 ? sourceDpr : 1
  const physicalPixels = Number.isFinite(options.maxDevicePixels) && (options.maxDevicePixels ?? 0) > 0
    ? options.maxDevicePixels! / (dpr * dpr) : Infinity
  const dimensionLimit = Number.isFinite(options.maxDeviceDimension) && (options.maxDeviceDimension ?? 0) > 0
    ? options.maxDeviceDimension! / dpr : Infinity
  const budgetRatio = size ? Math.min(
    Math.sqrt(Math.min(maxPixels, physicalPixels) / (size.width * size.height)),
    dimensionLimit / size.width, dimensionLimit / size.height,
  ) : 1
  // The bound is a power of two, so raster tiers do not oscillate frame-by-frame.
  const budgetTier = Math.max(1, Math.pow(2, Math.floor(Math.log2(Math.max(1, budgetRatio)))))
  const hysteresis = Math.max(0, Math.min(0.49, options.tierHysteresis ?? 0.12))
  let previousTier = 0
  let previousScale = NaN
  const subscription = connectRenderer(engine, (c) => {
    if (mode === "css-transform") {
      node.style.transform = `${translate(c, gpu)} scale(${c.scale})${localTransform}`
    } else if (mode === "css-hybrid") {
      let tier = previousTier || 1
      while (tier < budgetTier && c.scale > tier * (1 + hysteresis)) tier *= 2
      while (tier > 1 && c.scale < (tier / 2) * (1 - hysteresis)) tier /= 2
      if (tier !== previousTier) {
        node.style.width = String(size!.width * tier) + "px"
        node.style.height = String(size!.height * tier) + "px"
        previousTier = tier
      }
      node.style.transform = `${translate(c, gpu)} scale(${c.scale / tier})${localTransform}`
    } else if (mode === "css-layout") {
      // Pans dominate interactive frames; setting a layout-affecting property
      // at unchanged scale serves no purpose even when the browser may no-op it.
      if (c.scale !== previousScale) node.style.zoom = String(c.scale)
      // CSS 'zoom' magnifies CSS translate() offsets as well as the element.
      // Express the camera offset in pre-zoom units to keep the world-to-screen
      // mapping x_screen = camera.x + world.x * camera.scale exact.
      node.style.transform = `${translateXY(c.x / c.scale, c.y / c.scale, gpu)}${localTransform}`
    } else {
      if (c.scale !== previousScale) {
        node.style.width = String(size!.width * c.scale) + "px"
        node.style.height = String(size!.height * c.scale) + "px"
      }
      node.style.transform = `${translate(c, gpu)}${localTransform}`
    }
    previousScale = c.scale
  })
  return {
    invalidate: subscription.invalidate,
    dispose() {
      subscription.dispose()
      node.style.transform = old.transform
      node.style.transformOrigin = old.transformOrigin
      node.style.zoom = old.zoom
      node.style.width = old.width
      node.style.height = old.height
    },
  }
}

/** SVG <g> camera transform keeps SVG geometry in SVG user space. */
export function connectSVG(engine: CameraController, group: SVGGElement, options: { composeTransform?: boolean } = {}): RenderAdapter {
  const previous = group.getAttribute("transform")
  const local = options.composeTransform && previous ? ` ${previous}` : ""
  const adapter = connectRenderer(engine, (c) => {
    group.setAttribute("transform", `translate(${c.x} ${c.y}) scale(${c.scale})${local}`)
  })
  return { invalidate: adapter.invalidate, dispose() { adapter.dispose(); if (previous === null) group.removeAttribute("transform"); else group.setAttribute("transform", previous) } }
}

/**
 * Root SVG viewport: changes visible world rectangle, not a bitmap compositor transform.
 * The SVG's CSS box must match the viewport box; preserveAspectRatio=none is necessary
 * for 1 world unit to map to exactly camera.scale CSS pixels on both axes.
 */
export function connectSVGViewBox(engine: CameraController, svg: SVGSVGElement, options: { syncViewport?: boolean } = {}): RenderAdapter {
  const oldBox = svg.getAttribute("viewBox")
  const oldAspect = svg.getAttribute("preserveAspectRatio")
  svg.setAttribute("preserveAspectRatio", "none")
  // Reading clientWidth after mutating viewBox can synchronously flush layout.
  // Cache the SVG box and refresh it only on actual resize/invalidation.
  let boxWidth = svg.clientWidth
  let boxHeight = svg.clientHeight
  const render = (c: Readonly<Camera>) => {
    const viewport = engine.getViewport()
    // Native SVG pixels belong to the SVG box, not necessarily the outer DOM
    // viewport. If an embedded SVG is smaller than its host, using the host's
    // dimensions silently halves the effective zoom and breaks hit geometry.
    const width = boxWidth || viewport.width
    const height = boxHeight || viewport.height
    if (width <= 0 || height <= 0) return
    svg.setAttribute("viewBox",
      `${-c.x / c.scale} ${-c.y / c.scale} ${width / c.scale} ${height / c.scale}`)
  }
  const adapter = connectRenderer(engine, render)
  // React's outer Viewport may already observe size. This observer also handles
  // standalone svg use and the case where a resize leaves the camera unchanged.
  const resize = () => {
    boxWidth = svg.clientWidth
    boxHeight = svg.clientHeight
    if (options.syncViewport !== false) engine.setViewport(boxWidth, boxHeight)
    render(engine.getSnapshot())
  }
  resize()
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null
  observer?.observe(svg)
  let active = true
  return { invalidate() { if (active) resize() }, dispose() {
    if (!active) return
    active = false
    adapter.dispose()
    observer?.disconnect()
    if (oldBox === null) svg.removeAttribute("viewBox"); else svg.setAttribute("viewBox", oldBox)
    if (oldAspect === null) svg.removeAttribute("preserveAspectRatio"); else svg.setAttribute("preserveAspectRatio", oldAspect)
  } }
}

/** Canvas is redrawn in device pixels on each camera update, never CSS magnified. */
export function connectCanvas2D(
  engine: CameraController,
  canvas: HTMLCanvasElement,
  draw: (ctx: CanvasRenderingContext2D, camera: Readonly<Camera>) => void,
  pixelRatio: () => number = () => typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
): RenderAdapter {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("ZoomPort: 2D canvas context unavailable")
  // Size is provided by layout/ResizeObserver, not by each drawing frame.
  // Cache it to avoid forced synchronous layout after canvas writes.
  let cssWidth = canvas.clientWidth
  let cssHeight = canvas.clientHeight
  const canObserve = typeof ResizeObserver !== "undefined"
  const paint = (c: Readonly<Camera>) => {
    if (!canObserve) {
      cssWidth = canvas.clientWidth
      cssHeight = canvas.clientHeight
    }
    const input = pixelRatio()
    const dpr = Number.isFinite(input) ? Math.max(1, Math.min(4, input)) : 1
    const width = Math.max(1, Math.ceil(cssWidth * dpr))
    const height = Math.max(1, Math.ceil(cssHeight * dpr))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    ctx.resetTransform()
    ctx.clearRect(0, 0, width, height)
    ctx.setTransform(dpr * c.scale, 0, 0, dpr * c.scale, dpr * c.x, dpr * c.y)
    draw(ctx, c)
  }
  const adapter = connectRenderer(engine, paint)
  const observer = canObserve ? new ResizeObserver(() => {
    cssWidth = canvas.clientWidth
    cssHeight = canvas.clientHeight
    paint(engine.getSnapshot())
  }) : null
  observer?.observe(canvas)
  let active = true
  return {
    invalidate() {
      if (!active) return
      cssWidth = canvas.clientWidth
      cssHeight = canvas.clientHeight
      paint(engine.getSnapshot())
    },
    dispose() { if (!active) return; active = false; adapter.dispose(); observer?.disconnect() },
  }
}

/** WebGL, WebGPU, Three.js, PIXI, or any custom renderer owns its own matrix/LOD. */
export const connectCustom = connectRenderer
