import { clamp, constrain, finite, fitBounds, screenToWorld, type Bounds, type Camera, type Point, type Size } from "./math.js"

export interface FrameScheduler {
  request(callback: (timestamp: number) => void): number
  cancel(id: number): void
}
/**
 * Pool animation requests across controllers. One browser RAF timestamp updates
 * every active camera, avoiding N independent browser requests in a gallery.
 * Callbacks added while flushing run on the next frame, not the current one.
 * Native browser globals are only accessed when a frame is requested (SSR safe).
 */
export function createSharedFrameScheduler(
  native: FrameScheduler = {
    request: callback => requestAnimationFrame(callback),
    cancel: id => cancelAnimationFrame(id),
  },
): FrameScheduler {
  let nextId = 1
  let nativeId: number | null = null
  let queued = new Map<number, (timestamp: number) => void>()
  let spare = new Map<number, (timestamp: number) => void>()
  let flushing: Map<number, (timestamp: number) => void> | null = null
  const tick = (timestamp: number) => {
    nativeId = null
    const batch = queued
    // Recycle both Map buffers so sustained 144Hz animation allocates no
    // per-frame scheduler container, even across hundreds of cameras.
    queued = spare
    spare = batch
    flushing = batch
    try {
      for (const callback of batch.values()) {
        // Isolate errors: an unrelated viewport must not strand other cameras.
        try { callback(timestamp) }
        catch (error) { queueMicrotask(() => { throw error }) }
      }
    } finally {
      batch.clear()
      flushing = null
    }
  }
  return {
    request(callback) {
      const id = nextId++
      queued.set(id, callback)
      if (nativeId === null) nativeId = native.request(tick)
      return id
    },
    cancel(id) {
      queued.delete(id)
      flushing?.delete(id)
      if (!queued.size && nativeId !== null) {
        native.cancel(nativeId)
        nativeId = null
      }
    },
  }
}
const browserScheduler = createSharedFrameScheduler()
export interface ZoomPortOptions {
  initial?: Camera
  minScale?: number
  maxScale?: number
  zoomTimeConstant?: number
  panTimeConstant?: number
  /** Velocity half-life in milliseconds, independent of display refresh rate. */
  momentumHalfLife?: number
  bounds?: Bounds | null
  centerWhenSmaller?: boolean
  reducedMotion?: boolean
  scheduler?: FrameScheduler
}
export type CameraListener = (camera: Readonly<Camera>) => void
type Anchor = { screenX: number; screenY: number; worldX: number; worldY: number }
const IDENTITY: Camera = { x: 0, y: 0, scale: 1 }
const EPS_POS = 0.005
const EPS_LOG_SCALE = 0.00001
// Multiplicative scale convergence avoids repeated logarithms on the RAF hot path.
// Equivalent to abs(log(target/current)) > EPS_LOG_SCALE for finite positive scales.
const SCALE_RATIO_MIN = Math.exp(-EPS_LOG_SCALE)
const SCALE_RATIO_MAX = Math.exp(EPS_LOG_SCALE)
const EPS_VELOCITY = 0.003
function validateCamera(camera: Camera): void {
  if (!finite(camera.x) || !finite(camera.y) || !finite(camera.scale) || camera.scale <= 0)
    throw new RangeError("ZoomPort: camera must contain finite x/y and positive scale")
}
function validateBounds(bounds: Bounds | null): void {
  if (bounds && (![bounds.x, bounds.y, bounds.width, bounds.height].every(finite) || bounds.width <= 0 || bounds.height <= 0))
    throw new RangeError("ZoomPort: invalid world-space content bounds")
}
export class CameraController {
  private current: Camera
  private target: Camera
  private anchor: Anchor | null = null
  private frame: number | null = null
  private previousTime = 0
  private vx = 0
  private vy = 0
  private viewport: Size = { width: 0, height: 0 }
  private bounds: Bounds | null
  private minScale: number
  private maxScale: number
  private zoomTau: number
  private panTau: number
  private decay: number
  private centerSmall: boolean
  private reducedMotion: boolean
  private readonly scheduler: FrameScheduler
  private readonly listeners = new Set<CameraListener>()
  private batchDepth = 0
  private pendingNotification = false
  private readonly frameCallback = (time: number) => {
    this.frame = null
    const dt = this.previousTime ? time - this.previousTime : 1000 / 60
    this.previousTime = time
    // Long background suspensions must not create enormous momentum displacement.
    if (dt > 250) { this.vx = 0; this.vy = 0 }
    this.advance(Math.max(0, Math.min(dt, 64)))
  }
  constructor(options: ZoomPortOptions = {}) {
    const { minScale = 0.05, maxScale = 32 } = options
    const zoomTau = options.zoomTimeConstant ?? 58
    const panTau = options.panTimeConstant ?? 48
    const halfLife = options.momentumHalfLife ?? 180
    if (!finite(minScale) || !finite(maxScale) || minScale <= 0 || maxScale < minScale)
      throw new RangeError("ZoomPort: minScale/maxScale must be finite, positive, and ordered")
    if (![zoomTau, panTau, halfLife].every(finite) || zoomTau < 0 || panTau < 0 || halfLife <= 0)
      throw new RangeError("ZoomPort: zoom/pan time constants and momentum half-life must be finite and nonnegative")
    this.minScale = minScale
    this.maxScale = maxScale
    this.zoomTau = zoomTau
    this.panTau = panTau
    this.decay = Math.LN2 / halfLife
    this.centerSmall = options.centerWhenSmaller ?? true
    this.reducedMotion = options.reducedMotion ?? false
    this.bounds = options.bounds ?? null
    validateBounds(this.bounds)
    this.scheduler = options.scheduler ?? browserScheduler
    const initial = options.initial ?? IDENTITY
    validateCamera(initial)
    const c = { x: initial.x, y: initial.y, scale: clamp(initial.scale, minScale, maxScale) }
    this.current = c
    this.target = c
  }
  getSnapshot = (): Readonly<Camera> => this.current
  getTarget = (): Readonly<Camera> => this.target
  getViewport = (): Readonly<Size> => this.viewport
  getBounds = (): Readonly<Bounds> | null => this.bounds
  isAnimating = (): boolean => this.frame !== null
  subscribe = (listener: CameraListener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Group synchronous camera operations into a single subscriber notification. */
  batch<T>(update: () => T): T {
    this.batchDepth++
    try { return update() }
    finally {
      if (--this.batchDepth === 0 && this.pendingNotification) {
        this.pendingNotification = false
        for (const listener of this.listeners) listener(this.current)
      }
    }
  }
  private publish(next: Camera) {
    const old = this.current
    if (next.x === old.x && next.y === old.y && next.scale === old.scale) return
    this.current = next
    if (this.batchDepth) { this.pendingNotification = true; return }
    for (const listener of this.listeners) listener(next)
  }
  private stopFrame() {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    this.previousTime = 0
  }
  private requestFrame() {
    if (this.frame === null) this.frame = this.scheduler.request(this.frameCallback)
  }
  private bounded(camera: Camera): Camera {
    return constrain(camera, this.viewport, this.bounds, this.centerSmall)
  }
  /** Reconfigure physics and zoom limits without replacing camera subscribers. */
  configure(options: Pick<ZoomPortOptions,
    "minScale" | "maxScale" | "zoomTimeConstant" | "panTimeConstant" |
    "momentumHalfLife" | "centerWhenSmaller">): void {
    const min = options.minScale ?? this.minScale
    const max = options.maxScale ?? this.maxScale
    const zoom = options.zoomTimeConstant ?? this.zoomTau
    const pan = options.panTimeConstant ?? this.panTau
    const halfLife = options.momentumHalfLife ?? Math.LN2 / this.decay
    if (![min,max,zoom,pan,halfLife].every(finite) || min <= 0 || max < min ||
        zoom < 0 || pan < 0 || halfLife <= 0)
      throw new RangeError("ZoomPort: invalid runtime limits/physics")
    this.minScale = min
    this.maxScale = max
    this.zoomTau = zoom
    this.panTau = pan
    this.decay = Math.LN2 / halfLife
    this.centerSmall = options.centerWhenSmaller ?? this.centerSmall
    const bounded = this.bounded({ ...this.current, scale: clamp(this.current.scale, min, max) })
    const next = this.bounded({ ...this.target, scale: clamp(this.target.scale, min, max) })
    if (bounded.x !== this.current.x || bounded.y !== this.current.y || bounded.scale !== this.current.scale) {
      this.stopFrame()
      this.anchor = null
      this.vx = this.vy = 0
      this.target = next
      this.publish(bounded)
    } else this.target = next
    if (this.isMoving()) this.requestFrame()
  }
  setViewport(width: number, height: number): void {
    if (!finite(width) || !finite(height) || width < 0 || height < 0)
      throw new RangeError("ZoomPort: invalid viewport")
    if (width === this.viewport.width && height === this.viewport.height) return
    this.viewport = { width, height }
    this.anchor = null
    this.target = this.bounded(this.target)
    this.publish(this.bounded(this.current))
    if (this.isMoving()) this.requestFrame()
  }
  setBounds(bounds: Bounds | null): void {
    validateBounds(bounds)
    // Equivalent bounds props should not reset active cursor anchoring.
    const old = this.bounds
    if (bounds === old || (!bounds && !old) || (bounds && old &&
      bounds.x === old.x && bounds.y === old.y &&
      bounds.width === old.width && bounds.height === old.height)) return
    this.bounds = bounds ? { ...bounds } : null
    this.anchor = null
    this.target = this.bounded(this.target)
    this.publish(this.bounded(this.current))
    if (this.isMoving()) this.requestFrame()
  }
  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled
    if (enabled) this.jumpTo(this.target)
  }
  setCamera(camera: Camera, animated = false): void {
    validateCamera(camera)
    const next = this.bounded({ x: camera.x, y: camera.y, scale: clamp(camera.scale, this.minScale, this.maxScale) })
    this.anchor = null
    this.vx = 0
    this.vy = 0
    this.target = next
    if (animated && !this.reducedMotion) this.requestFrame()
    else this.jumpTo(next)
  }
  jumpTo(camera: Camera): void {
    validateCamera(camera)
    const next = this.bounded({ x: camera.x, y: camera.y, scale: clamp(camera.scale, this.minScale, this.maxScale) })
    this.stopFrame()
    this.anchor = null
    this.vx = 0
    this.vy = 0
    this.target = next
    this.publish(next)
  }
  /** True when an immediate pan would visibly move the camera after constraints. */
  canPanBy(dx: number, dy: number): boolean {
    if (!finite(dx) || !finite(dy) || (!dx && !dy)) return false
    const c = this.current
    const next = this.bounded({ x: c.x + dx, y: c.y + dy, scale: c.scale })
    return next.x !== c.x || next.y !== c.y
  }
  /** Check the configured scale interval without scheduling a frame or changing the camera. */
  canZoomBy(factor: number): boolean {
    if (!finite(factor) || factor <= 0 || factor === 1) return false
    return clamp(this.target.scale * factor, this.minScale, this.maxScale) !== this.target.scale
  }
  panBy(dx: number, dy: number, animated = false): void {
    if (!finite(dx) || !finite(dy)) return
    this.anchor = null
    this.vx = 0
    this.vy = 0
    if (animated && !this.reducedMotion) {
      this.target = this.bounded({ ...this.target, x: this.target.x + dx, y: this.target.y + dy })
      this.requestFrame()
    } else this.jumpTo({ ...this.current, x: this.current.x + dx, y: this.current.y + dy })
  }
  /**
   * Every interpolated frame preserves the exact *currently displayed* world
   * point beneath pivot; retargeting mid-flight does not introduce an anchor jump.
   */
  zoomAt(scale: number, pivot: Point, animated = true): void {
    if (!finite(scale) || scale <= 0 || !finite(pivot.x) || !finite(pivot.y)) return
    const nextScale = clamp(scale, this.minScale, this.maxScale)
    if (nextScale === this.current.scale && !this.isMoving()) return
    const world = screenToWorld(this.current, pivot)
    this.anchor = { screenX: pivot.x, screenY: pivot.y, worldX: world.x, worldY: world.y }
    this.vx = 0
    this.vy = 0
    this.target = this.bounded({
      x: pivot.x - world.x * nextScale,
      y: pivot.y - world.y * nextScale,
      scale: nextScale,
    })
    if (!animated || this.reducedMotion) this.jumpTo(this.target)
    else this.requestFrame()
  }
  zoomBy(factor: number, pivot: Point = { x: this.viewport.width / 2, y: this.viewport.height / 2 }, animated = true) {
    if (!finite(factor) || factor <= 0) return
    this.zoomAt(this.target.scale * factor, pivot, animated)
  }
  fit(bounds: Bounds = this.bounds as Bounds, padding = 24, animated = true): void {
    if (!bounds) return
    this.setCamera(fitBounds(bounds, this.viewport, padding, this.minScale, this.maxScale), animated)
  }
  /** Instantly translate an active pointer; cancel competing animated targets. */
  gesturePan(dx: number, dy: number): void { this.panBy(dx, dy, false) }
  /** Apply simultaneous centroid translation and scale from one immutable pre-gesture camera. */
  gesturePinch(start: Camera, worldAnchor: Point, center: Point, scale: number): void {
    if (!finite(scale) || scale <= 0) return
    const s = clamp(scale, this.minScale, this.maxScale)
    this.jumpTo({ x: center.x - worldAnchor.x * s, y: center.y - worldAnchor.y * s, scale: s })
    void start
  }
  fling(vx: number, vy: number): void {
    if (this.reducedMotion || !finite(vx) || !finite(vy)) return
    this.vx = clamp(vx, -4, 4)
    this.vy = clamp(vy, -4, 4)
    if (this.vx || this.vy) this.requestFrame()
  }
  stop(): void { this.stopFrame(); this.anchor = null; this.vx = 0; this.vy = 0; this.target = this.current }
  destroy(): void { this.stop(); this.listeners.clear() }
  private isMoving(): boolean {
    return Math.abs(this.target.x - this.current.x) > EPS_POS ||
      Math.abs(this.target.y - this.current.y) > EPS_POS ||
      this.target.scale / this.current.scale < SCALE_RATIO_MIN ||
      this.target.scale / this.current.scale > SCALE_RATIO_MAX ||
      Math.abs(this.vx) > EPS_VELOCITY || Math.abs(this.vy) > EPS_VELOCITY
  }
  /** Deterministic simulator entrypoint for tests and fixed-timestep benchmarks. */
  advance(dt: number): void {
    if (!finite(dt) || dt <= 0) return
    dt = Math.min(dt, 64)
    let c = this.current
    // Most pan-only frames never change scale: skip all scale transcendental math.
    let s = c.scale
    if (s !== this.target.scale) {
      const scaleBlend = this.zoomTau <= 0 ? 1 : -Math.expm1(-dt / this.zoomTau)
      s *= Math.exp(Math.log(this.target.scale / s) * scaleBlend)
      const ratio = s / this.target.scale
      if (ratio >= SCALE_RATIO_MIN && ratio <= SCALE_RATIO_MAX) s = this.target.scale
    }
    const anchor = this.anchor
    // Anchor zoom is solved analytically; it never needs the pan easing coefficient.
    const translationBlend = anchor ? 0 : this.panTau <= 0 ? 1 : -Math.expm1(-dt / this.panTau)
    let x = anchor ? anchor.screenX - anchor.worldX * s : c.x + (this.target.x - c.x) * translationBlend
    let y = anchor ? anchor.screenY - anchor.worldY * s : c.y + (this.target.y - c.y) * translationBlend
    if (!anchor && Math.abs(x - this.target.x) <= EPS_POS) x = this.target.x
    if (!anchor && Math.abs(y - this.target.y) <= EPS_POS) y = this.target.y
    if (this.vx || this.vy) {
      const decayed = -Math.expm1(-this.decay * dt)
      const decay = 1 - decayed
      const integral = decayed / this.decay
      x += this.vx * integral
      y += this.vy * integral
      this.vx *= decay
      this.vy *= decay
      if (Math.abs(this.vx) <= EPS_VELOCITY) this.vx = 0
      if (Math.abs(this.vy) <= EPS_VELOCITY) this.vy = 0
      this.target = { x, y, scale: this.target.scale }
    }
    const constrained = this.bounded({ x, y, scale: s })
    if (constrained.x !== x) { this.vx = 0; this.anchor = null }
    if (constrained.y !== y) { this.vy = 0; this.anchor = null }
    this.publish(constrained)
    if (this.anchor && s === this.target.scale) {
      this.anchor = null
      this.target = this.bounded({ ...this.target, x: constrained.x, y: constrained.y })
    }
    if (this.isMoving()) this.requestFrame()
    else { this.stopFrame(); this.target = this.current; this.anchor = null }
  }
}
