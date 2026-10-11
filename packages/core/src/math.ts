export interface Point { x: number; y: number }
export interface Camera { x: number; y: number; scale: number }
export interface Size { width: number; height: number }
export interface Bounds extends Point { width: number; height: number }
const ZERO: Point = { x: 0, y: 0 }

export const finite = (n: number): boolean => Number.isFinite(n)
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale }
}
export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: camera.x + p.x * camera.scale, y: camera.y + p.y * camera.scale }
}
/** Visible world AABB, with optional overscan in *screen* pixels for culling. */
export function visibleWorldBounds(camera: Camera, viewport: Size, overscan = 0): Bounds {
  if (![camera.x, camera.y, camera.scale, viewport.width, viewport.height, overscan].every(finite) ||
      camera.scale <= 0 || viewport.width < 0 || viewport.height < 0 || overscan < 0)
    throw new RangeError("ZoomPort: invalid visible-world bounds input")
  const inv = 1 / camera.scale
  return {
    x: (-camera.x - overscan) * inv,
    y: (-camera.y - overscan) * inv,
    width: (viewport.width + 2 * overscan) * inv,
    height: (viewport.height + 2 * overscan) * inv,
  }
}
/**
 * Populate a reusable column-major 4x4 projection into WebGL clip space.
 * +Y world coordinates run downward, like DOM/SVG/Canvas.
 * With worldOrigin, the caller must upload origin-relative vertex positions
 * (vertex.x - worldOrigin.x etc), preserving Float32 precision in large scenes.
 */
export function writeWebGLMatrix(
  camera: Camera, viewport: Size, out: Float32Array = new Float32Array(16), worldOrigin: Point = ZERO,
): Float32Array {
  if (![viewport.width, viewport.height, camera.x, camera.y, camera.scale, worldOrigin.x, worldOrigin.y].every(finite) ||
      viewport.width <= 0 || viewport.height <= 0 || camera.scale <= 0 || out.length < 16)
    throw new RangeError("ZoomPort: invalid WebGL matrix input")
  out.fill(0, 0, 16)
  out[0] = (2 * camera.scale) / viewport.width
  out[5] = (-2 * camera.scale) / viewport.height
  out[10] = 1
  out[12] = 2 * (camera.x + worldOrigin.x * camera.scale) / viewport.width - 1
  out[13] = 1 - 2 * (camera.y + worldOrigin.y * camera.scale) / viewport.height
  out[15] = 1
  return out
}
export function zoomAround(camera: Camera, nextScale: number, pivot: Point): Camera {
  const ratio = nextScale / camera.scale
  return { x: pivot.x - (pivot.x - camera.x) * ratio, y: pivot.y - (pivot.y - camera.y) * ratio, scale: nextScale }
}
export function constrain(camera: Camera, viewport: Size, bounds: Bounds | null, centerSmall = true): Camera {
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return camera
  // Hot path: compute the two independent intervals without allocating a
  // closure, then preserve identity when the camera already satisfies bounds.
  const lx = viewport.width - (bounds.x + bounds.width) * camera.scale
  const hx = -bounds.x * camera.scale
  const ly = viewport.height - (bounds.y + bounds.height) * camera.scale
  const hy = -bounds.y * camera.scale
  const nextX = lx > hx ? centerSmall ? (lx + hx) / 2 : clamp(camera.x, hx, lx) : clamp(camera.x, lx, hx)
  const nextY = ly > hy ? centerSmall ? (ly + hy) / 2 : clamp(camera.y, hy, ly) : clamp(camera.y, ly, hy)
  const x = nextX === 0 ? 0 : nextX
  const y = nextY === 0 ? 0 : nextY
  if (x === camera.x && y === camera.y) return camera
  return { x, y, scale: camera.scale }
}
export function fitBounds(bounds: Bounds, viewport: Size, padding = 24, minScale = 0.05, maxScale = 32): Camera {
  if (![bounds.x,bounds.y,bounds.width,bounds.height,viewport.width,viewport.height,padding,minScale,maxScale].every(finite) ||
      bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0 ||
      minScale <= 0 || maxScale < minScale) {
    throw new RangeError("ZoomPort: fitBounds requires finite positive dimensions")
  }
  const usableW = Math.max(1, viewport.width - Math.max(0, padding) * 2)
  const usableH = Math.max(1, viewport.height - Math.max(0, padding) * 2)
  const scale = clamp(Math.min(usableW / bounds.width, usableH / bounds.height), minScale, maxScale)
  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * scale,
    scale,
  }
}
