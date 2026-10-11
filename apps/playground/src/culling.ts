import { SceneIndex, SceneVisibility, type Camera, type SceneLODEntry } from "@zoomport/core"
import { mountZoomPort } from "@zoomport/dom"

const GRID = 317
const COUNT = 100_000
const CELL = 40
const WORLD = { x: 0, y: 0, width: GRID * CELL, height: Math.ceil(COUNT / GRID) * CELL }
const viewport = document.querySelector<HTMLElement>("#viewport")!
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!
let measured = { width: viewport.clientWidth, height: viewport.clientHeight }
const viewportObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
  measured = { width: viewport.clientWidth, height: viewport.clientHeight }
}) : null
viewportObserver?.observe(viewport)
const zoomLabel = document.querySelector<HTMLElement>("#zoom")!
const modeSelector = document.querySelector<HTMLSelectElement>("#mode-mobile")!
const options = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")]
type Mode = "adaptive" | "indexed" | "naive"
let mode: Mode = "adaptive"
let inOverview = true
const stats = { draws: 0, candidates: 0, queries: 0, cpuMs: 0, lod: "overview" }

const entries = function* () {
  for (let i = 0; i < COUNT; i++) {
    yield { id: i, bounds: {
      x: (i % GRID) * CELL,
      y: Math.floor(i / GRID) * CELL,
      width: 23, height: 23,
    } }
  }
}
const index = new SceneIndex(entries())
const visible = new SceneVisibility(index, { overscanPx: 20, cacheMarginPx: 200 })
const lodScratch: SceneLODEntry<number>[] = []

function shape(ctx: CanvasRenderingContext2D, id: number, detailed: boolean): void {
  const col = id % GRID, row = Math.floor(id / GRID)
  const x = col * CELL, y = row * CELL
  const accented = id % 23 === 0 || (col % 17 === 0 && row % 17 === 0)
  ctx.fillStyle = accented ? "#aaff00" : "#dce5d9"
  ctx.fillRect(x, y, 23, 23)
  if (detailed) {
    ctx.strokeStyle = accented ? "#739f22" : "#bac8b7"
    ctx.lineWidth = 0.9
    ctx.strokeRect(x + 0.45, y + 0.45, 22.1, 22.1)
    if (id % 9 === 0) {
      ctx.fillStyle = "#29382b"
      ctx.fillRect(x + 6, y + 6, 11, 11)
    }
  }
}
function overview(ctx: CanvasRenderingContext2D, camera: Readonly<Camera>): number {
  const bounds = {
    x: (-camera.x) / camera.scale, y: (-camera.y) / camera.scale,
    width: measured.width / camera.scale, height: measured.height / camera.scale,
  }
  lodScratch.length = 0
  index.queryLOD(bounds, camera.scale, 90, 32, lodScratch)
  stats.queries++
  let drawn = 0
  for (const item of lodScratch) {
    if (item.kind === "item") {
      shape(ctx, item.id, false)
      drawn++
      continue
    }
    const { x, y, width, height } = item.bounds
    ctx.fillStyle = item.count > 512 ? "#b0ec45" : "#dbe7d4"
    ctx.fillRect(x, y, Math.max(2,width), Math.max(2,height))
    ctx.strokeStyle = "#aac1a5"
    ctx.lineWidth = 3
    ctx.strokeRect(x + 1.5, y + 1.5, Math.max(2,width-3), Math.max(2,height-3))
    if (camera.scale > 0.1 && width * camera.scale > 35) {
      ctx.fillStyle = "#343f32"
      ctx.font = "bold 36px ui-sans-serif,system-ui"
      ctx.fillText(String(item.count), x + 12, y + 48)
    }
    drawn++
  }
  return drawn
}
function draw(ctx: CanvasRenderingContext2D, camera: Readonly<Camera>): void {
  const start = performance.now()
  const { scale } = camera
  if (scale > 0.32) inOverview = false
  else if (scale < 0.25) inOverview = true
  const useLOD = mode === "adaptive" && inOverview
  stats.lod = useLOD ? "overview" : "individual"
  if (useLOD) {
    stats.draws = overview(ctx, camera)
    stats.candidates = 0
  } else if (mode === "naive") {
    for (let i = 0; i < COUNT; i++) shape(ctx, i, scale > 1)
    stats.draws = COUNT
    stats.candidates = COUNT
  } else {
    const changes = visible.update(camera, measured)
    if (changes.requeried) stats.queries++
    const candidates = visible.getVisible()
    for (const id of candidates) shape(ctx, id, scale > 1)
    stats.draws = stats.candidates = candidates.size
  }
  stats.cpuMs = performance.now() - start
}

const port = mountZoomPort({
  viewport, content: canvas, renderer: "canvas2d", draw,
  bounds: WORLD, minScale: 0.015, maxScale: 12,
  centerWhenSmaller: true, wheelMode: "auto", wheelAtBounds: "release",
  pointerMoveScheduling: "frame", enableInertia: true,
})
const setMode = (next: Mode) => {
  mode = next
  modeSelector.value = next
  for (const option of options) {
    const active = option.dataset.mode === next
    option.classList.toggle("active", active)
    option.setAttribute("aria-pressed", String(active))
  }
  visible.invalidate()
  port.invalidate()
}
for (const option of options)
  option.addEventListener("click", () => setMode(option.dataset.mode as Mode))
modeSelector.addEventListener("change", () => setMode(modeSelector.value as Mode))
document.querySelector<HTMLButtonElement>("#fit")!.addEventListener("click", () => port.engine.fit(WORLD, 28, true))
document.querySelector<HTMLButtonElement>("#in")!.addEventListener("click", () => port.engine.zoomBy(1.7))
document.querySelector<HTMLButtonElement>("#out")!.addEventListener("click", () => port.engine.zoomBy(1 / 1.7))
let lastScale = -1
port.engine.subscribe(camera => {
  if (camera.scale === lastScale) return
  lastScale = camera.scale
  zoomLabel.textContent = `${Math.round(camera.scale * 100)}%`
})
const fields = {
  visible: document.querySelector<HTMLElement>("#visible")!,
  candidates: document.querySelector<HTMLElement>("#candidates")!,
  queries: document.querySelector<HTMLElement>("#queries")!,
  skipped: document.querySelector<HTMLElement>("#skipped")!,
  lod: document.querySelector<HTMLElement>("#lod")!,
  drawtime: document.querySelector<HTMLElement>("#drawtime")!,
  scale: document.querySelector<HTMLElement>("#scale")!,
}
const report = () => {
  const snapshot = port.engine.getSnapshot()
  const values = {
    visible: stats.draws.toLocaleString(),
    candidates: stats.candidates.toLocaleString(),
    queries: stats.queries.toLocaleString(),
    skipped: (COUNT - (stats.lod === "overview" ? 0 : stats.draws)).toLocaleString(),
    lod: stats.lod,
    drawtime: `${stats.cpuMs.toFixed(2)} ms`,
    scale: `${(snapshot.scale * 100).toFixed(2)}%`,
  }
  for (const key of Object.keys(fields) as (keyof typeof fields)[])
    if (fields[key].textContent !== values[key]) fields[key].textContent = values[key]
}
const interval = window.setInterval(report, 160);
(window as typeof window & { __zoomportLab?: unknown }).__zoomportLab = { port, index, visibility: visible, stats, setMode }
window.addEventListener("pagehide", () => { window.clearInterval(interval); viewportObserver?.disconnect(); port.dispose() }, { once:true })
requestAnimationFrame(() => {
  port.engine.fit(WORLD, 24, false)
  zoomLabel.textContent = `${Math.round(port.engine.getSnapshot().scale * 100)}%`
  report()
})
