import { SceneIndex, SceneVisibility, type CameraController, type SpatialEntry, type VisibilityOptions } from "@zoomport/core"

/** An owned DOM scene item. Bounds are in world coordinates (not screen pixels). */
export interface DOMSceneItem<ID extends string | number = string> extends SpatialEntry<ID> {
  node: HTMLElement | SVGElement
  /** Keep selection handles, active edits, etc. visible even off-screen. */
  pinned?: boolean
}
export interface DOMCullingOptions extends VisibilityOptions {
  /** Observe the viewport's resized dimensions independently of camera changes. Default true. */
  observeResize?: boolean
}
export interface DOMCullingHandle<ID extends string | number = string> {
  readonly index: SceneIndex<ID>
  readonly visibility: SceneVisibility<ID>
  /** Add, replace or move an item. Replaces bounds and (optionally) its DOM node. */
  upsert(item: DOMSceneItem<ID>): void
  remove(id: ID): boolean
  pin(id: ID, enabled?: boolean): void
  invalidate(): void
  dispose(): void
}

type OwnedNode = { node: HTMLElement | SVGElement; display: string }
/**
 * Declarative-ish visibility ownership with zero React dependencies.
 * Does not remove DOM nodes or alter their data, event listeners, order, or ARIA
 * attributes. Only writes style.display when an object's visibility changes.
 */
export function connectDOMCulling<ID extends string | number>(
  engine: CameraController,
  viewport: HTMLElement,
  items: Iterable<DOMSceneItem<ID>>,
  options: DOMCullingOptions = {},
): DOMCullingHandle<ID> {
  const entries = Array.from(items)
  const index = new SceneIndex(entries)
  const visibility = new SceneVisibility(index, options)
  const nodes = new Map<ID, OwnedNode>()
  const pinned = new Set<ID>()
  for (const item of entries) {
    nodes.set(item.id, { node: item.node, display: item.node.style.display })
    if (item.pinned) { pinned.add(item.id); visibility.pin(item.id) }
  }
  let active = true
  let size = { width: viewport.clientWidth, height: viewport.clientHeight }
  const apply = () => {
    if (!active) return
    const changes = visibility.update(engine.getSnapshot(), size)
    for (const id of changes.removed) {
      const entry = nodes.get(id)
      if (entry && entry.node.style.display !== "none") entry.node.style.display = "none"
    }
    for (const id of changes.added) {
      const entry = nodes.get(id)
      if (entry && entry.node.style.display !== entry.display) entry.node.style.display = entry.display
    }
  }
  apply()
  // Start hidden for objects excluded by the initial visibility query.
  const visible = visibility.getVisible()
  for (const [id, entry] of nodes) {
    if (!visible.has(id) && entry.node.style.display !== "none") entry.node.style.display = "none"
  }
  const unsubscribe = engine.subscribe(apply)
  const resized = () => {
    const width = viewport.clientWidth, height = viewport.clientHeight
    if (width === size.width && height === size.height) return
    size = { width, height }
    visibility.invalidate()
    apply()
  }
  const observer = options.observeResize !== false && typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(resized) : null
  observer?.observe(viewport)
  const restore = (entry: OwnedNode) => { entry.node.style.display = entry.display }
  return {
    index,
    visibility,
    upsert(item) {
      if (!active) return
      const prior = nodes.get(item.id)
      if (prior && prior.node !== item.node) restore(prior)
      nodes.set(item.id, { node: item.node, display: prior?.node === item.node ? prior.display : item.node.style.display })
      index.upsert(item)
      if (!!item.pinned !== pinned.has(item.id)) {
        if (item.pinned) pinned.add(item.id)
        else pinned.delete(item.id)
        visibility.pin(item.id, !!item.pinned)
      }
      apply()
      if (!visibility.getVisible().has(item.id)) item.node.style.display = "none"
    },
    remove(id) {
      if (!active || !index.remove(id)) return false
      const entry = nodes.get(id)
      if (entry) restore(entry)
      nodes.delete(id)
      pinned.delete(id)
      visibility.pin(id, false)
      apply()
      return true
    },
    pin(id, enabled = true) {
      if (!active) return
      if (enabled) pinned.add(id)
      else pinned.delete(id)
      visibility.pin(id, enabled)
      apply()
    },
    invalidate() { if (active) { resized(); visibility.invalidate(); apply() } },
    dispose() {
      if (!active) return
      active = false
      unsubscribe()
      observer?.disconnect()
      for (const entry of nodes.values()) restore(entry)
      nodes.clear()
    },
  }
}
