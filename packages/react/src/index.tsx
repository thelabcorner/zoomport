import * as React from "react"
import { CameraController, screenToWorld, type Camera, type Bounds, type Point, type Size, type ZoomPortOptions } from "@zoomport/core"
import { connectCSS, connectSVG, type CssRenderMode } from "./adapters.js"
import { bindViewport, type InteractionOptions, type WheelMode } from "@zoomport/dom"
import { Image, SVGViewport } from "./renderers.js"
export { CameraController, screenToWorld, worldToScreen, visibleWorldBounds, writeWebGLMatrix, fitBounds, zoomAround, SceneIndex, SceneVisibility, type SpatialEntry, type SceneLODEntry, type SceneIndexOptions, type VisibilityOptions, type Camera, type Bounds, type Point } from "@zoomport/core"
export { connectDOMCulling } from "@zoomport/dom"
export type { DOMSceneItem, DOMCullingOptions, DOMCullingHandle } from "@zoomport/dom"
export { Image, SVGViewport } from "./renderers.js"
export type { NativeImageProps, ImageResolution, SVGViewportProps } from "./renderers.js"
export { connectCSS, connectSVG, connectSVGViewBox, connectCanvas2D, connectCustom, connectRenderer } from "./adapters.js"
export type { CssRenderMode, CSSAdapterOptions, RenderAdapter } from "./adapters.js"
const useBrowserLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect
export interface RootProps extends Omit<ZoomPortOptions, "scheduler"> {
  children: React.ReactNode
  /** Controlled synchronization. Updates are reflected optimistically until the next prop change. */
  value?: Camera
  /** Change this key to make an externally supplied value authoritative, even
   * when it equals a recent onCameraChange echo (e.g. undo/redo or history jump). */
  valueRevision?: string | number
  onCameraChange?: (camera: Readonly<Camera>) => void
  wheelMode?: WheelMode
  wheelSensitivity?: number
  /** Override the imperfect wheel-vs-trackpad auto heuristic for a specific event. */
  resolveWheelMode?: (event: WheelEvent) => Exclude<WheelMode, "auto">
  /** Capture all wheel gestures (default), or let the page scroll at camera limits. */
  wheelAtBounds?: "capture" | "release"
  /** Default false: keep nested ZoomPort gestures from also driving an ancestor. */
  propagateGestures?: boolean
  panButtons?: readonly number[]
  disabled?: boolean
  enablePan?: boolean
  enablePinch?: boolean
  enableKeyboard?: boolean
  enableInertia?: boolean
  /** Keyboard pan distance in CSS pixels; holding Shift multiplies it by 10/3. */
  keyboardStep?: number
  /** Keyboard zoom multiplier per keypress, greater than 1. */
  keyboardZoomFactor?: number
  /** Maximum pointer travel that remains a click, in viewport CSS pixels. */
  clickDistance?: number
  /** Suppress the synthesized click after a drag (default true). */
  suppressClickOnDrag?: boolean
  /** Optional per-frame pointermove coalescing for high-rate stylus/touch input. */
  pointerMoveScheduling?: "immediate" | "frame"
  /** Default DOM content renderer; individual Content can override it. */
  renderer?: CssRenderMode
}
// Camera-only consumers should not re-render merely because a controlled Root
// receives a new value prop or an unrelated interaction setting changes.
const EngineContext = React.createContext<CameraController | null>(null)
type RootInteractionOptions = InteractionOptions & { renderer?: CssRenderMode }
const OptionsContext = React.createContext<RootInteractionOptions | null>(null)
export function useZoomPort(): CameraController {
  const value = React.useContext(EngineContext)
  if (!value) throw new Error("ZoomPort components must be nested inside ZoomPort.Root")
  return value
}
function useRootOptions() {
  const value = React.useContext(OptionsContext)
  if (!value) throw new Error("ZoomPort.Viewport must be inside ZoomPort.Root")
  return value
}
export function useCamera(): Readonly<Camera> {
  const engine = useZoomPort()
  return React.useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
}
/**
 * Subscribe to just a projected camera value. Prefer primitive projections or
 * supply an equality function for object projections to preserve snapshot identity.
 * The selector must be pure; this hook does not schedule any camera frames.
 */
export function useCameraSelector<T>(
  selector: (camera: Readonly<Camera>) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const engine = useZoomPort()
  const cache = React.useRef<{ engine: CameraController; value: T } | null>(null)
  const selectedSnapshot = React.useCallback(() => {
    const next = selector(engine.getSnapshot())
    const previous = cache.current
    if (previous && previous.engine === engine && isEqual(previous.value, next)) return previous.value
    cache.current = { engine, value: next }
    return next
  }, [engine, selector, isEqual])
  return React.useSyncExternalStore(engine.subscribe, selectedSnapshot, selectedSnapshot)
}
export function Root(props: RootProps) {
  const [engine] = React.useState(() => new CameraController({ ...props, initial: props.value ?? props.initial }))
  const interactions = React.useMemo<RootInteractionOptions>(() => ({
    wheelMode:props.wheelMode, wheelSensitivity:props.wheelSensitivity,
    wheelAtBounds:props.wheelAtBounds, resolveWheelMode:props.resolveWheelMode,
    propagateGestures:props.propagateGestures, panButtons:props.panButtons,
    disabled:props.disabled, enablePan:props.enablePan, enablePinch:props.enablePinch,
    enableKeyboard:props.enableKeyboard, enableInertia:props.enableInertia,
    renderer:props.renderer, keyboardStep:props.keyboardStep, keyboardZoomFactor:props.keyboardZoomFactor,
    clickDistance:props.clickDistance, suppressClickOnDrag:props.suppressClickOnDrag,
    pointerMoveScheduling:props.pointerMoveScheduling,
  }), [props.wheelMode, props.wheelSensitivity, props.wheelAtBounds, props.resolveWheelMode,
    props.propagateGestures, props.panButtons, props.disabled, props.enablePan, props.enablePinch,
    props.enableKeyboard, props.enableInertia, props.renderer, props.keyboardStep, props.keyboardZoomFactor,
    props.clickDistance, props.suppressClickOnDrag, props.pointerMoveScheduling])
  // A controlled consumer commonly echoes snapshots through onCameraChange.
  // These are observations, not external navigation commands. Replaying an echo
  // with jumpTo() on each React commit would cancel all active interpolation.
  // Echoes may be structurally cloned by state managers. Keep a bounded ring
  // of recent emitted snapshots so those acknowledgements cannot cancel RAF.
  // Unlike an unbounded identity set, older states remain valid navigation targets.
  const recentEmissions = React.useRef<Readonly<Camera>[]>([])
  const emissionIndex = React.useRef(0)
  const previousValueRevision = React.useRef(props.valueRevision)
  React.useEffect(() => engine.configure({
    minScale: props.minScale,
    maxScale: props.maxScale,
    zoomTimeConstant: props.zoomTimeConstant,
    panTimeConstant: props.panTimeConstant,
    momentumHalfLife: props.momentumHalfLife,
    centerWhenSmaller: props.centerWhenSmaller,
  }), [engine, props.minScale, props.maxScale, props.zoomTimeConstant, props.panTimeConstant,
       props.momentumHalfLife, props.centerWhenSmaller])
  React.useEffect(() => {
    if (props.bounds !== undefined) engine.setBounds(props.bounds)
  }, [engine, props.bounds])
  React.useEffect(() => {
    const media = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    const sync = () => engine.setReducedMotion(props.reducedMotion ?? media?.matches ?? false)
    sync()
    media?.addEventListener?.("change", sync)
    return () => media?.removeEventListener?.("change", sync)
  }, [engine, props.reducedMotion])
  React.useEffect(() => {
    const revisionChanged = previousValueRevision.current !== props.valueRevision
    previousValueRevision.current = props.valueRevision
    if (!props.value) return
    if (!revisionChanged) {
      for (const snapshot of recentEmissions.current) {
        if (snapshot && snapshot.x === props.value.x && snapshot.y === props.value.y && snapshot.scale === props.value.scale)
          return
      }
    }
    const current = engine.getSnapshot()
    if (revisionChanged || current.x !== props.value.x || current.y !== props.value.y || current.scale !== props.value.scale)
      engine.jumpTo(props.value)
  }, [engine, props.value, props.valueRevision])
  const callback = React.useRef(props.onCameraChange)
  React.useEffect(() => { callback.current = props.onCameraChange }, [props.onCameraChange])
  React.useEffect(() => engine.subscribe((camera) => {
    recentEmissions.current[emissionIndex.current++ % 16] = camera
    callback.current?.(camera)
  }), [engine])
  React.useEffect(() => () => engine.destroy(), [engine])
  return <EngineContext.Provider value={engine}>
    <OptionsContext.Provider value={interactions}>{props.children}</OptionsContext.Provider>
  </EngineContext.Provider>
}
export interface ViewportProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible text description of the interactive viewport. */
  "aria-label"?: string
}
export const Viewport = React.forwardRef<HTMLDivElement, ViewportProps>(function Viewport(
  { style, children, tabIndex = 0, role = "region", ...htmlProps }, forwardedRef,
) {
  const engine = useZoomPort()
  const opts = useRootOptions()
  const element = React.useRef<HTMLDivElement | null>(null)
  const activeOpts = React.useRef(opts)
  React.useEffect(() => { activeOpts.current = opts })
  React.useImperativeHandle(forwardedRef, () => element.current as HTMLDivElement, [])
  React.useEffect(() => {
    const node = element.current
    if (!node) return
    const resize = () => engine.setViewport(node.clientWidth, node.clientHeight)
    resize()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [engine])
  React.useEffect(() => {
    const node = element.current
    if (!node) return
    return bindViewport(engine, node, () => activeOpts.current)
    }, [engine, opts.disabled, opts.enablePan, opts.enablePinch, opts.pointerMoveScheduling])
   return <div {...htmlProps} ref={element} role={role} tabIndex={tabIndex}
     aria-label={htmlProps["aria-label"] ?? "Pan and zoom viewport"}
     style={{ position: "relative", overflow: "hidden",
       touchAction: opts.disabled || (opts.enablePan === false && opts.enablePinch === false) ? "auto" : "none",
       ...style }}>{children}</div>
})
export interface ContentProps extends React.HTMLAttributes<HTMLDivElement> {
  renderMode?: CssRenderMode
  /** Required for css-resize mode. Child should fill the resized box, e.g. width/height:100%. */
  intrinsicSize?: Size
  /** Upper bound for stepped high-resolution css-hybrid layers, in CSS pixels. */
  maxLayerPixels?: number
  /** Upper bound in device pixels, including DPR. */
  maxDevicePixels?: number
  /** Optional per-axis physical pixel limit for hybrid tiers. */
  maxDeviceDimension?: number
  /** DPR override for hybrid budgeting. */
  pixelRatio?: number
  /** Tier hysteresis for css-hybrid mode; defaults to 0.12. */
  tierHysteresis?: number
  /** Select CSS 3D translation where compositor promotion is appropriate. */
  translate3d?: boolean
  /** Apply a local CSS transform inside the camera's scale and translation. */
  composeTransform?: boolean
}
export const Content = React.forwardRef<HTMLDivElement, ContentProps>(function Content(
  { style, renderMode, intrinsicSize, maxLayerPixels, maxDevicePixels, maxDeviceDimension, pixelRatio, tierHysteresis, translate3d, composeTransform, ...props }, forwardedRef,
) {
  const engine = useZoomPort()
  const opts = useRootOptions()
  const local = React.useRef<HTMLDivElement | null>(null)
  React.useImperativeHandle(forwardedRef, () => local.current as HTMLDivElement, [])
  useBrowserLayoutEffect(() => {
    const node = local.current
    if (!node) return
    const adapter = connectCSS(engine, node, { mode: renderMode ?? opts.renderer, size: intrinsicSize, maxLayerPixels, maxDevicePixels, maxDeviceDimension, pixelRatio, tierHysteresis, translate3d, composeTransform })
    return () => adapter.dispose()
  }, [engine, renderMode, opts.renderer, intrinsicSize?.width, intrinsicSize?.height, maxLayerPixels, maxDevicePixels, maxDeviceDimension, pixelRatio, tierHysteresis, translate3d, composeTransform])
  return <div {...props} ref={local} style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", ...style }} />
})
export interface SVGContentProps extends React.SVGProps<SVGGElement> {
  /** Preserve a local SVG transform inside the camera transform. */
  composeTransform?: boolean
}
export const SVGContent = React.forwardRef<SVGGElement, SVGContentProps>(function SVGContent({ composeTransform, ...props }, ref) {
  const engine = useZoomPort()
  const local = React.useRef<SVGGElement | null>(null)
  React.useImperativeHandle(ref, () => local.current as SVGGElement, [])
  useBrowserLayoutEffect(() => {
    const node = local.current
    if (!node) return
    const adapter = connectSVG(engine, node, { composeTransform })
    return () => adapter.dispose()
  }, [engine, composeTransform])
  return <g {...props} ref={local} />
})
export const ZoomPort = { Root, Viewport, Content, SVGContent, SVGViewport, Image } as const
