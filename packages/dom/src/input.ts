import { screenToWorld, type Point, type CameraController } from "@zoomport/core"

export type WheelMode = "auto" | "zoom" | "pan" | "none"
export interface InteractionOptions {
  wheelMode?: WheelMode
  wheelSensitivity?: number
  wheelAtBounds?: "capture" | "release"
  resolveWheelMode?: (event: WheelEvent) => Exclude<WheelMode, "auto">
  propagateGestures?: boolean
  panButtons?: readonly number[]
  disabled?: boolean
  enablePan?: boolean
  enablePinch?: boolean
  enableKeyboard?: boolean
  enableInertia?: boolean
  keyboardStep?: number
  keyboardZoomFactor?: number
  clickDistance?: number
  suppressClickOnDrag?: boolean
  /** Coalesce high-frequency pointermove into one camera publication per RAF.
   * immediate (default) preserves event-by-event movement and lowest latency. */
  pointerMoveScheduling?: "immediate" | "frame"
}

const IGNORE = "button,input,textarea,select,a,[contenteditable]:not([contenteditable='false']),[data-zoomport-ignore]"
// Do not stop native bubbling: React delegates synthetic event handlers at its
// root, so stopPropagation() inside our low-level listener can suppress the
// consumer's own onWheel/onPointerDown props. Track handled events instead.
const claimedGestures = new WeakSet<Event>()
function ignored(event: Event, viewport: HTMLElement): boolean {
  const target = event.target
  return target instanceof Element && target !== viewport && Boolean(target.closest(IGNORE))
}
function localPoint(e: { clientX: number; clientY: number }, element: HTMLElement): Point {
  const box = element.getBoundingClientRect()
  // A CSS-scaled ancestor changes client coordinates but not the viewport's
  // layout coordinate system. Guard zero dimensions before first layout.
  const sx = box.width > 0 && element.clientWidth > 0 ? element.clientWidth / box.width : 1
  const sy = box.height > 0 && element.clientHeight > 0 ? element.clientHeight / box.height : 1
  return { x: (e.clientX - box.left) * sx, y: (e.clientY - box.top) * sy }
}
type Pointer = Point & { t: number }
interface GestureState {
  pointers: Map<number, Pointer>
  mode: "idle" | "pan" | "pinch"
  last: Pointer | null
  samples: Pointer[]
  pinch: { distance: number; scale: number; anchor: Point } | null
  origin: Point | null
  dragged: boolean
}
const initialGesture = (): GestureState => ({
  pointers: new Map(), mode: "idle", last: null, samples: [], pinch: null,
  origin: null, dragged: false,
})
function getPair(points: Map<number, Pointer>): [Pointer, Pointer] | null {
  const it = points.values()
  const a = it.next().value
  const b = it.next().value
  return a && b ? [a, b] : null
}

export function bindViewport(
  engine: CameraController, node: HTMLElement, getOptions: () => InteractionOptions = () => ({}),
): () => void {
  const activeOpts = { get current() { return getOptions() } }
  const gesture = initialGesture()
  const pendingMoves = new Map<number, PointerEvent>()
  let pointerFrame: number | null = null
  const cancelPointerFrame = () => {
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame)
    pointerFrame = null
    pendingMoves.clear()
  }
  let suppressClickUntil = 0
  const endGesture = () => {
    cancelPointerFrame()
    for (const id of gesture.pointers.keys()) {
      try { if (node.hasPointerCapture(id)) node.releasePointerCapture(id) } catch { /* unmounted capture */ }
    }
    gesture.pointers.clear()
    gesture.samples = []
    gesture.last = null
    gesture.pinch = null
    gesture.mode = "idle"
    gesture.origin = null
    gesture.dragged = false
  }
  const beginPinch = () => {
    const pair = getPair(gesture.pointers)
    if (!pair) return
    const [a, b] = pair
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
    const current = engine.getSnapshot()
    gesture.pinch = { distance, scale: current.scale, anchor: screenToWorld(current, center) }
    gesture.mode = "pinch"
    gesture.dragged = true
    gesture.samples = []
    gesture.last = null
    engine.stop()
  }
  const wheel = (event: WheelEvent) => {
    const options = activeOpts.current
    if (options.disabled || claimedGestures.has(event) || ignored(event, node)) return
    const { wheelMode = "auto" } = options
    const deltaFactor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
    const dx = event.deltaX * deltaFactor
    const dy = event.deltaY * deltaFactor
    const mode: WheelMode = options.resolveWheelMode?.(event) ?? (wheelMode === "auto"
      ? (event.ctrlKey || event.metaKey || event.deltaMode !== 0 ||
         (Math.abs(dx) < 0.01 && Math.abs(dy) >= 45) ? "zoom" : "pan")
      : wheelMode)
    if (mode === "none" || (!dx && !dy)) return
    if (options.wheelAtBounds === "release") {
      if (mode === "pan" && !engine.canPanBy(-dx, -dy)) return
      if (mode === "zoom") {
        const speed = options.wheelSensitivity ?? (event.ctrlKey ? 0.009 : 0.0018)
        const delta = Math.max(-320, Math.min(320, dy))
        if (!engine.canZoomBy(Math.exp(-delta * speed))) return
      }
    }
    if (event.cancelable) event.preventDefault()
    if (!options.propagateGestures) claimedGestures.add(event)
    if (mode === "pan") engine.panBy(-dx, -dy, false)
    else {
      const speed = options.wheelSensitivity ?? (event.ctrlKey ? 0.009 : 0.0018)
      const delta = Math.max(-320, Math.min(320, dy))
      engine.zoomBy(Math.exp(-delta * speed), localPoint(event, node))
    }
  }
  const flushMoves = () => {
    if (!pendingMoves.size) return
    // Processing each pointer's latest sample preserves the final centroid,
    // while batch() prevents duplicate renderer updates for a two-finger frame.
    engine.batch(() => {
      for (const event of pendingMoves.values()) processMove(event)
    })
    pendingMoves.clear()
  }
  const pointerDown = (event: PointerEvent) => {
    if (pointerFrame !== null) {
      cancelAnimationFrame(pointerFrame)
      pointerFrame = null
      flushMoves()
    }
    suppressClickUntil = 0
    const options = activeOpts.current
    if (options.disabled || claimedGestures.has(event) || ignored(event, node) ||
        (options.enablePan === false && options.enablePinch === false)) return
    if (event.pointerType !== "touch" && !(options.panButtons ?? [0, 1]).includes(event.button)) return
    if (!options.propagateGestures) claimedGestures.add(event)
    const p = { ...localPoint(event, node), t: performance.now() }
    gesture.pointers.set(event.pointerId, p)
    try { node.setPointerCapture(event.pointerId) } catch { /* browser may have released the pointer */ }
    if (gesture.pointers.size === 1) {
      gesture.origin = p
      gesture.dragged = false
    }
    if (gesture.pointers.size >= 2 && options.enablePinch !== false) beginPinch()
    else if (gesture.pointers.size >= 2) {
      // Never accidentally translate a single-pointer pan using the second
      // finger when pinch is disabled. Resume from the remaining position.
      gesture.mode = "idle"; gesture.last = null; gesture.samples = []
      engine.stop()
    } else if (options.enablePan !== false) {
      engine.stop(); gesture.mode = "pan"; gesture.last = p; gesture.samples = [p]
    }
  }
  const processMove = (event: PointerEvent) => {
    if (!gesture.pointers.has(event.pointerId)) return
    if (activeOpts.current.disabled ||
        (activeOpts.current.enablePan === false && activeOpts.current.enablePinch === false)) {
      endGesture()
      return
    }
    const p = { ...localPoint(event, node), t: performance.now() }
    gesture.pointers.set(event.pointerId, p)
    if (gesture.mode === "pinch" && activeOpts.current.enablePinch !== false) {
      gesture.dragged = true
      const pair = getPair(gesture.pointers)
      const pinch = gesture.pinch
      if (!pair || !pinch) return
      const [a,b] = pair
      const center = { x: (a.x+b.x)/2, y:(a.y+b.y)/2 }
      const distance = Math.max(1, Math.hypot(b.x-a.x,b.y-a.y))
      engine.gesturePinch(engine.getSnapshot(), pinch.anchor, center, pinch.scale * distance / pinch.distance)
    } else if (gesture.mode === "pan" && gesture.last && gesture.pointers.size === 1) {
      const origin = gesture.origin
      const distance = activeOpts.current.clickDistance
      const threshold = distance !== undefined && Number.isFinite(distance) && distance >= 0 ? distance : 5
      if (origin && (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2 > threshold * threshold)
        gesture.dragged = true
      if (activeOpts.current.enablePan !== false) engine.gesturePan(p.x - gesture.last.x, p.y - gesture.last.y)
      gesture.last = p
      gesture.samples.push(p)
      // Keep only the last ~100ms for a stable release velocity.
      while (gesture.samples.length > 2 && p.t - gesture.samples[0]!.t > 100) gesture.samples.shift()
    }
  }
  const pointerMove = (event: PointerEvent) => {
    if (!gesture.pointers.has(event.pointerId)) return
    if (activeOpts.current.pointerMoveScheduling !== "frame") {
      processMove(event)
      return
    }
    pendingMoves.set(event.pointerId, event)
    if (pointerFrame === null) {
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = null
        flushMoves()
      })
    }
  }
  const pointerEnd = (event: PointerEvent) => {
    if (!gesture.pointers.has(event.pointerId)) return
    if (pointerFrame !== null) {
      cancelAnimationFrame(pointerFrame)
      pointerFrame = null
      flushMoves()
    }
    const wasPinch = gesture.mode === "pinch"
    gesture.pointers.delete(event.pointerId)
    try { if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId) } catch { /* released */ }
    if (gesture.pointers.size >= 2) {
      if (activeOpts.current.enablePinch !== false) beginPinch()
      else { gesture.mode = "idle"; gesture.last = null; gesture.samples = [] }
      return
    }
    if (gesture.pointers.size === 1) {
      const p = gesture.pointers.values().next().value as Pointer
      gesture.mode = activeOpts.current.enablePan === false ? "idle" : "pan"; gesture.last = p; gesture.samples = [p]; gesture.pinch = null
      return
    }
    if (!wasPinch && !activeOpts.current.disabled && activeOpts.current.enablePan !== false &&
        activeOpts.current.enableInertia !== false && event.type === "pointerup" && gesture.samples.length >= 2) {
      const first = gesture.samples[0]!
      const last = gesture.samples[gesture.samples.length - 1]!
      const elapsed = last.t - first.t
      if (elapsed > 8 && performance.now() - last.t < 90)
        engine.fling((last.x - first.x) / elapsed, (last.y - first.y) / elapsed)
    }
    if (gesture.dragged && activeOpts.current.suppressClickOnDrag !== false)
      suppressClickUntil = performance.now() + 500
    endGesture()
  }
  const captureClick = (event: MouseEvent) => {
    if (suppressClickUntil && performance.now() <= suppressClickUntil) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    suppressClickUntil = 0
  }
  const keydown = (event: KeyboardEvent) => {
    if (activeOpts.current.disabled || activeOpts.current.enableKeyboard === false ||
        claimedGestures.has(event) || ignored(event, node) || event.altKey || event.ctrlKey || event.metaKey) return
     const baseStep = activeOpts.current.keyboardStep
     const step = (baseStep !== undefined && Number.isFinite(baseStep) && baseStep > 0 ? baseStep : 48) * (event.shiftKey ? 10 / 3 : 1)
     const rawFactor = activeOpts.current.keyboardZoomFactor
     const factor = rawFactor !== undefined && Number.isFinite(rawFactor) && rawFactor > 1 ? rawFactor : 1.2
    switch (event.key) {
      case "ArrowLeft": engine.panBy(step, 0, true); break
      case "ArrowRight": engine.panBy(-step, 0, true); break
      case "ArrowUp": engine.panBy(0, step, true); break
      case "ArrowDown": engine.panBy(0, -step, true); break
       case "+": case "=": engine.zoomBy(factor); break
       case "-": case "_": engine.zoomBy(1 / factor); break
      case "0": engine.fit(undefined, 24); break
      default: return
    }
    event.preventDefault()
    if (!activeOpts.current.propagateGestures) claimedGestures.add(event)
  }
  const blur = () => { endGesture(); engine.stop() }
  node.addEventListener("wheel", wheel, { passive: false })
  node.addEventListener("pointerdown", pointerDown)
  node.addEventListener("click", captureClick, true)
  node.addEventListener("pointermove", pointerMove)
  node.addEventListener("pointerup", pointerEnd)
  node.addEventListener("pointercancel", pointerEnd)
  node.addEventListener("lostpointercapture", pointerEnd)
  node.addEventListener("keydown", keydown)
  window.addEventListener("blur", blur)
  return () => {
    node.removeEventListener("wheel", wheel)
    node.removeEventListener("pointerdown", pointerDown)
    node.removeEventListener("click", captureClick, true)
    node.removeEventListener("pointermove", pointerMove)
    node.removeEventListener("pointerup", pointerEnd)
    node.removeEventListener("pointercancel", pointerEnd)
    node.removeEventListener("lostpointercapture", pointerEnd)
    node.removeEventListener("keydown", keydown)
     window.removeEventListener("blur", blur)
     endGesture()
   }
 // Disable/reconfigure an active gesture by immediately releasing capture.

}
