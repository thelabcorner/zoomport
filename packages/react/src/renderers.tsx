import * as React from "react"
import type { Camera } from "@zoomport/core"
import { useZoomPort } from "./index.js"
import { connectSVGViewBox } from "./adapters.js"

const useBrowserLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

export interface ImageResolution {
  /** Exact target device-pixel width, before bucketing. */
  requiredWidth: number
  requiredHeight: number
  /** Stepped requested width, typically a power of two, or the exact configured cap. */
  bucketWidth: number
  scale: number
  dpr: number
}
export interface NativeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "width" | "height"> {
  intrinsicWidth: number
  intrinsicHeight: number
  /** Optional per-zoom URL provider. Without it, native src is used at every scale. */
  resolveSource?: (resolution: ImageResolution) => string
  /** Caps source-provider requests, not displayed dimensions. Non-power-of-two caps are honored exactly. */
  maxSourceWidth?: number
  /** 0..0.49 relative width hysteresis for source swapping. */
  sourceHysteresis?: number
  /** Optional DPR override; default is window.devicePixelRatio. */
  pixelRatio?: number
  /** Keep the previous source visible until a replacement finishes decoding. */
  decodeBeforeSwap?: boolean
}
/**
 * Native image layout zoom: modify the image's actual CSS pixel dimensions,
 * preserving the browser's image-resampling path rather than magnifying a
 * potentially stale compositor snapshot. This is not super-resolution.
 */
export const Image = React.forwardRef<HTMLImageElement, NativeImageProps>(function Image(
  { intrinsicWidth, intrinsicHeight, resolveSource, maxSourceWidth = 8192, pixelRatio, sourceHysteresis = 0.12, decodeBeforeSwap = false,
    style, src, ...rest }, forwardedRef,
) {
  const engine = useZoomPort()
  const nodeRef = React.useRef<HTMLImageElement | null>(null)
  React.useImperativeHandle(forwardedRef, () => nodeRef.current as HTMLImageElement, [])
  useBrowserLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) return
    if (!(intrinsicWidth > 0 && intrinsicHeight > 0 && Number.isFinite(intrinsicWidth) && Number.isFinite(intrinsicHeight)))
      throw new RangeError("ZoomPort.Image requires finite, positive intrinsic dimensions")
    let lastBucket = -1
    let lastSource = src ?? ""
    let lastScale = NaN
    let lastDpr = NaN
    let active = true
    let requestId = 0
    const render = (c: Readonly<Camera>) => {
      // Panning should not dirty layout by redundantly writing width/height.
      // Resize only when the projected image dimensions actually change.
      const scaleChanged = c.scale !== lastScale
      if (scaleChanged) {
        node.style.width = `${intrinsicWidth * c.scale}px`
        node.style.height = `${intrinsicHeight * c.scale}px`
        lastScale = c.scale
      }
      node.style.transform = `translate(${c.x}px,${c.y}px)`
      if (!resolveSource) return
      const measuredDpr = pixelRatio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio)
      const dpr = Number.isFinite(measuredDpr) ? Math.max(1, measuredDpr) : 1
      // Skip source-provider work for pure pans; use the latest DPR when a
      // window resize transfers the viewport between monitors.
      if (!scaleChanged && dpr === lastDpr && lastBucket >= 1) return
      lastDpr = dpr
      const requiredWidth = intrinsicWidth * c.scale * dpr
      const requiredHeight = intrinsicHeight * c.scale * dpr
      // Step requests geometrically: source loads must not follow every animation frame.
      const maxTier = Number.isFinite(maxSourceWidth) && maxSourceWidth > 0
        ? Math.max(1, Math.floor(maxSourceWidth)) : 8192
      const largestPowerTier = Math.pow(2, Math.floor(Math.log2(maxTier)))
      const threshold = Math.max(0, Math.min(0.49, sourceHysteresis))
      let bucketWidth = lastBucket < 1 ? Math.pow(2, Math.ceil(Math.log2(Math.max(1, requiredWidth)))) : lastBucket
      bucketWidth = Math.min(maxTier, Math.max(1, bucketWidth))
      while (bucketWidth < maxTier && requiredWidth > bucketWidth * (1 + threshold))
        bucketWidth = Math.min(maxTier, bucketWidth < largestPowerTier ? bucketWidth * 2 : maxTier)
      while (bucketWidth > 1) {
        const previous = bucketWidth > largestPowerTier ? largestPowerTier : bucketWidth / 2
        if (requiredWidth >= previous * (1 - threshold)) break
        bucketWidth = previous
      }
      if (bucketWidth === lastBucket) return
      lastBucket = bucketWidth
      const next = resolveSource({ requiredWidth, requiredHeight, bucketWidth, scale: c.scale, dpr })
      if (next && next !== lastSource) {
        lastSource = next
        const token = ++requestId
        if (decodeBeforeSwap) {
          const replacement = new window.Image()
          const commit = () => { if (active && token === requestId) node.src = next }
          if (typeof replacement.decode === "function") {
            replacement.src = next
            void replacement.decode().then(commit, () => { /* Keep the last working source. */ })
          } else {
            replacement.onload = commit
            replacement.src = next
          }
        } else node.src = next
      }
    }
    render(engine.getSnapshot())
    const unsubscribe = engine.subscribe(render)
    const resized = () => { lastDpr = NaN; render(engine.getSnapshot()) }
    if (resolveSource) window.addEventListener("resize", resized)
    return () => {
      active = false
      requestId++
      unsubscribe()
      if (resolveSource) window.removeEventListener("resize", resized)
    }
  }, [engine, intrinsicWidth, intrinsicHeight, resolveSource, maxSourceWidth, pixelRatio, sourceHysteresis, decodeBeforeSwap, src])
  return <img {...rest} src={src} ref={nodeRef}
    style={{ position: "absolute", left: 0, top: 0, maxWidth: "none", transformOrigin: "0 0", ...style }} />
})

export interface SVGViewportProps extends React.SVGProps<SVGSVGElement> {
  /** Native viewBox camera; content is maintained as real SVG paths and shapes. */
  children?: React.ReactNode
}
export const SVGViewport = React.forwardRef<SVGSVGElement, SVGViewportProps>(function SVGViewport(
  { style, children, ...rest }, forwardedRef,
) {
  const engine = useZoomPort()
  const local = React.useRef<SVGSVGElement | null>(null)
  React.useImperativeHandle(forwardedRef, () => local.current as SVGSVGElement, [])
  useBrowserLayoutEffect(() => {
    const node = local.current
    if (!node) return
    // The outer Viewport owns camera dimensions; do not overwrite them with a
    // nested SVG's box (which may differ because of padding or layout).
    const adapter = connectSVGViewBox(engine, node, { syncViewport: false })
    return () => adapter.dispose()
  }, [engine])
  return <svg {...rest} ref={local}
    style={{ display: "block", width: "100%", height: "100%", ...style }}>{children}</svg>
})
