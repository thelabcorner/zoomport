import { visibleWorldBounds, type Bounds, type Camera, type Size } from "./math.js"

/** A scene object with a stable identity and a world-space axis-aligned bounding box. */
export interface SpatialEntry<ID extends string | number = string> {
  id: ID
  bounds: Readonly<Bounds>
}

interface RecordBox<ID extends string | number> {
  id: ID
  minX: number
  minY: number
  maxX: number
  maxY: number
  cx: number
  cy: number
  leaf?: Node
}
interface Node {
  minX: number; minY: number; maxX: number; maxY: number
  start: number; end: number
  left: Node | null; right: Node | null
  parent: Node | null
  ordinal: number
  dirty: boolean
}
/** A group-level summary or a single shape, selected by projected screen size. */
export type SceneLODEntry<ID extends string | number> =
  | { kind: "item"; id: ID }
  | { kind: "cluster"; key: string; bounds: Bounds; count: number }
export interface SceneIndexOptions {
  /** Maximum entries in each leaf. Defaults to 16. */
  leafSize?: number
  /** Overlay size before rebuilding the immutable tree. Defaults to max(128, 8% of entries). */
  rebuildThreshold?: number
}
function record<ID extends string | number>(entry: SpatialEntry<ID>): RecordBox<ID> {
  const { x, y, width, height } = entry.bounds
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0 ||
      !Number.isFinite(x + width) || !Number.isFinite(y + height))
    throw new RangeError("ZoomPort: spatial bounds must be finite with nonnegative extents")
  return { id: entry.id, minX: x, minY: y, maxX: x + width, maxY: y + height,
    cx: x + width / 2, cy: y + height / 2 }
}
const intersects = (a: RecordBox<string | number> | Node, b: Bounds): boolean =>
  a.minX <= b.x + b.width && a.maxX >= b.x &&
  a.minY <= b.y + b.height && a.maxY >= b.y

function validQuery(b: Bounds): void {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
      b.width < 0 || b.height < 0 || !Number.isFinite(b.x + b.width) || !Number.isFinite(b.y + b.height))
    throw new RangeError("ZoomPort: invalid spatial query")
}

/**
 * Median-split BVH for predominantly static, potentially unbounded editor scenes.
 *
 * Tree queries are pruned hierarchically, not linearly scanned. Mutations go to a
 * bounded override layer, so moving one shape does not rebuild a 100k-shape tree.
 * Once the override grows large, it is compacted into a fresh tree. Query results
 * are complete even before compaction; there are no stale/duplicate IDs.
 */
export class SceneIndex<ID extends string | number = string> {
  private base = new Map<ID, RecordBox<ID>>()
  private overlay = new Map<ID, RecordBox<ID> | null>()
  private ordered: RecordBox<ID>[] = []
  private tree: Node | null = null
  private count = 0
  private readonly leafSize: number
  private readonly rebuildThreshold: number | undefined
  private revision = 0
  private generation = 0
  private ordinal = 0

  constructor(entries: Iterable<SpatialEntry<ID>> = [], options: SceneIndexOptions = {}) {
    this.leafSize = options.leafSize ?? 16
    this.rebuildThreshold = options.rebuildThreshold
    if (!Number.isSafeInteger(this.leafSize) || this.leafSize < 2 ||
        (this.rebuildThreshold !== undefined &&
         (!Number.isSafeInteger(this.rebuildThreshold) || this.rebuildThreshold < 1)))
      throw new RangeError("ZoomPort: invalid scene-index options")
    for (const entry of entries) this.base.set(entry.id, record(entry))
    this.count = this.base.size
    this.compact()
  }
  get size(): number { return this.count }
  get version(): number { return this.revision }
  has(id: ID): boolean {
    if (this.overlay.has(id)) return this.overlay.get(id) !== null
    return this.base.has(id)
  }
  upsert(entry: SpatialEntry<ID>): void {
    const next = record(entry)
    if (!this.has(entry.id)) this.count++
    this.markDirty(entry.id)
    this.overlay.set(entry.id, next)
    this.revision++
    this.compactIfNeeded()
  }
  remove(id: ID): boolean {
    if (!this.has(id)) return false
    this.count--
    this.markDirty(id)
    this.overlay.set(id, null)
    this.revision++
    this.compactIfNeeded()
    return true
  }
  clear(): void {
    this.base.clear(); this.overlay.clear(); this.ordered = []; this.tree = null
    this.count = 0; this.revision++
  }
  /** Rebuild explicitly after large import/mutation batches. */
  compact(): void {
    for (const [id, value] of this.overlay) {
      if (value === null) this.base.delete(id)
      else this.base.set(id, value)
    }
    this.overlay.clear()
    this.ordered = Array.from(this.base.values())
    this.generation++
    this.ordinal = 0
    this.tree = this.build(0, this.ordered.length, null)
  }
  private markDirty(id: ID): void {
    let node: Node | null = this.base.get(id)?.leaf ?? null
    while (node && !node.dirty) {
      node.dirty = true
      node = node.parent
    }
  }
  private compactIfNeeded(): void {
    if (this.overlay.size >= (this.rebuildThreshold ?? Math.max(128, Math.ceil(this.count * 0.08))))
      this.compact()
  }
  private partition(start: number, end: number, middle: number, axis: "cx" | "cy"): void {
    const items = this.ordered
    let lo = start, hi = end - 1
    while (lo < hi) {
      const pivot = items[(lo + hi) >>> 1]![axis]
      let i = lo, j = hi
      while (i <= j) {
        while (items[i]![axis] < pivot) i++
        while (items[j]![axis] > pivot) j--
        if (i <= j) {
          const temp = items[i]!
          items[i] = items[j]!
          items[j] = temp
          i++; j--
        }
      }
      if (middle <= j) hi = j
      else if (middle >= i) lo = i
      else return
    }
  }
  private build(start: number, end: number, parent: Node | null): Node | null {
    if (start === end) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let minCX = Infinity, minCY = Infinity, maxCX = -Infinity, maxCY = -Infinity
    for (let i = start; i < end; i++) {
      const r = this.ordered[i]!
      if (r.minX < minX) minX = r.minX
      if (r.minY < minY) minY = r.minY
      if (r.maxX > maxX) maxX = r.maxX
      if (r.maxY > maxY) maxY = r.maxY
      if (r.cx < minCX) minCX = r.cx
      if (r.cy < minCY) minCY = r.cy
      if (r.cx > maxCX) maxCX = r.cx
      if (r.cy > maxCY) maxCY = r.cy
    }
    const node: Node = { minX, minY, maxX, maxY, start, end, left: null, right: null,
      parent, ordinal: this.ordinal++, dirty: false }
    if (end - start <= this.leafSize) {
      for (let i = start; i < end; i++) this.ordered[i]!.leaf = node
      return node
    }
    const mid = (start + end) >>> 1
    this.partition(start, end, mid, maxCX - minCX >= maxCY - minCY ? "cx" : "cy")
    node.left = this.build(start, mid, node)
    node.right = this.build(mid, end, node)
    return node
  }
  /** No result-array allocation if the caller reuses `out`. */
  query(bounds: Bounds, out: ID[] = []): ID[] {
    validQuery(bounds)
    this.searchNode(this.tree, bounds, out)
    for (const r of this.overlay.values()) if (r && intersects(r, bounds)) out.push(r.id)
    return out
  }
  private searchNode(node: Node | null, bounds: Bounds, out: ID[]): void {
    if (!node || !intersects(node, bounds)) return
    // Entire BVH subtree is inside the query. Its entries occupy one contiguous
    // interval; skip all descendant traversal and individual AABB tests.
    if (bounds.x <= node.minX && bounds.y <= node.minY &&
        bounds.x + bounds.width >= node.maxX && bounds.y + bounds.height >= node.maxY) {
      for (let i = node.start; i < node.end; i++) {
        const r = this.ordered[i]!
        if (!this.overlay.has(r.id)) out.push(r.id)
      }
      return
    }
    if (node.left) {
      this.searchNode(node.left, bounds, out)
      this.searchNode(node.right, bounds, out)
      return
    }
    for (let i = node.start; i < node.end; i++) {
      const r = this.ordered[i]!
      if (!this.overlay.has(r.id) && intersects(r, bounds)) out.push(r.id)
    }
  }
  /**
   * Screen-space hierarchy traversal: clean subtrees whose projected extents
   * fit the pixel budget become single semantic proxies. Edited branches are
   * expanded, never summarized from stale geometry.
   *
   * Clusters require application-defined drawing (heatmap, aggregated glyph,
   * raster tile, etc.) and are NOT guaranteed pixel-identical to their shapes.
   */
  queryLOD(bounds: Bounds, scale: number, maxClusterPx = 96, minClusterItems = 32,
    out: SceneLODEntry<ID>[] = []): SceneLODEntry<ID>[] {
    validQuery(bounds)
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(maxClusterPx) || maxClusterPx <= 0 ||
        !Number.isSafeInteger(minClusterItems) || minClusterItems < 2)
      throw new RangeError("ZoomPort: invalid screen-space LOD policy")
    this.visitLOD(this.tree, bounds, scale, maxClusterPx, minClusterItems, out)
    for (const r of this.overlay.values())
      if (r && intersects(r, bounds)) out.push({kind:"item",id:r.id})
    return out
  }
  private visitLOD(node: Node | null, area: Bounds, scale: number, maxClusterPx: number,
    minClusterItems: number, out: SceneLODEntry<ID>[]): void {
    if (!node || !intersects(node, area)) return
    if (!node.dirty && node.end - node.start >= minClusterItems &&
        (node.maxX - node.minX) * scale <= maxClusterPx &&
        (node.maxY - node.minY) * scale <= maxClusterPx) {
      out.push({ kind: "cluster", key: `${this.generation}:${node.ordinal}`,
        bounds: { x:node.minX, y:node.minY, width:node.maxX-node.minX, height:node.maxY-node.minY },
        count: node.end - node.start })
      return
    }
    if (node.left) {
      this.visitLOD(node.left, area, scale, maxClusterPx, minClusterItems, out)
      this.visitLOD(node.right, area, scale, maxClusterPx, minClusterItems, out)
      return
    }
    for (let i = node.start; i < node.end; i++) {
      const r = this.ordered[i]!
      if (!this.overlay.has(r.id) && intersects(r, area)) out.push({kind:"item",id:r.id})
    }
  }
}

/** Conservative camera-space interest region with spatial-index query caching. */
export interface VisibilityOptions {
  /** Extra visible screen-space pixels at each edge. Default 64. */
  overscanPx?: number
  /** Further camera-movement slack before querying again. Default 256. */
  cacheMarginPx?: number
  /** Force visibility re-evaluation after this relative zoom change. Default 1.35.
   * Prevents a zoomed-in camera from retaining an entire zoomed-out world's candidates. */
  cacheMaxScaleRatio?: number
}
const NO_CHANGE = { requeried: false, added: [] as never[], removed: [] as never[] }
export class SceneVisibility<ID extends string | number = string> {
  private visible = new Set<ID>()
  private pinned = new Set<ID>()
  private region: Bounds | null = null
  private indexVersion = -1
  private queriedScale = NaN
  private readonly overscanPx: number
  private readonly cacheMarginPx: number
  private readonly cacheMaxScaleRatio: number
  constructor(readonly index: SceneIndex<ID>, options: VisibilityOptions = {}) {
    this.overscanPx = options.overscanPx ?? 64
    this.cacheMarginPx = options.cacheMarginPx ?? 256
    this.cacheMaxScaleRatio = options.cacheMaxScaleRatio ?? 1.35
    if (!Number.isFinite(this.overscanPx) || this.overscanPx < 0 ||
        !Number.isFinite(this.cacheMarginPx) || this.cacheMarginPx < 0 ||
        !Number.isFinite(this.cacheMaxScaleRatio) || this.cacheMaxScaleRatio <= 1)
      throw new RangeError("ZoomPort: invalid visibility cache options")
  }
  getVisible(): ReadonlySet<ID> { return this.visible }
  get size(): number { return this.visible.size }
  /** Force a query after scene/geometry policy changes. */
  invalidate(): void { this.region = null }
  pin(id: ID, enabled = true): void {
    if (enabled) this.pinned.add(id)
    else this.pinned.delete(id)
    this.invalidate()
  }
  update(camera: Readonly<Camera>, viewport: Readonly<Size>):
    { requeried: boolean; added: ID[]; removed: ID[] } {
    if (viewport.width <= 0 || viewport.height <= 0) return NO_CHANGE
    // Check enclosure without creating even a world-bounds object on the RAF hot path.
    const s = camera.scale
    if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(camera.x) || !Number.isFinite(camera.y))
      throw new RangeError("ZoomPort: invalid camera for culling")
    const minX = (-camera.x - this.overscanPx) / s
    const minY = (-camera.y - this.overscanPx) / s
    const maxX = (viewport.width - camera.x + this.overscanPx) / s
    const maxY = (viewport.height - camera.y + this.overscanPx) / s
    const r = this.region
    if (r && this.indexVersion === this.index.version &&
        s <= this.queriedScale * this.cacheMaxScaleRatio &&
        s * this.cacheMaxScaleRatio >= this.queriedScale &&
        minX >= r.x && minY >= r.y && maxX <= r.x + r.width && maxY <= r.y + r.height)
      return NO_CHANGE
    const area = visibleWorldBounds(camera, viewport, this.overscanPx + this.cacheMarginPx)
    const next = new Set(this.index.query(area))
    for (const id of this.pinned) if (this.index.has(id)) next.add(id)
    const added: ID[] = [], removed: ID[] = []
    for (const id of this.visible) if (!next.has(id)) removed.push(id)
    for (const id of next) if (!this.visible.has(id)) added.push(id)
    if (added.length || removed.length) this.visible = next
    this.region = area
    this.indexVersion = this.index.version
    this.queriedScale = s
    return { requeried: true, added, removed }
  }
}
