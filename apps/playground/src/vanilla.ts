import { mountZoomPort, type DOMRenderMode } from "@zoomport/dom"

const viewport = document.querySelector<HTMLElement>("#viewport")!
const content = document.querySelector<HTMLElement>("#content")!
const inspector = document.querySelector<HTMLElement>("#inspector")!
const zoom = document.querySelector<HTMLElement>("#zoom")!
const label = document.querySelector<HTMLElement>("#mode-label")!
const menu = document.querySelector<HTMLSelectElement>("#mobile-renderer")!
const names = {
  "css-transform": "CSS transform",
  "css-hybrid": "CSS hybrid · resolution-aware",
  "css-layout": "CSS native zoom",
  "css-resize": "CSS native resize",
} as const
type Mode = keyof typeof names
const renderers = document.querySelector<HTMLElement>("#renderers")!
const buttons = new Map<Mode, HTMLButtonElement>()
const port = mountZoomPort({
  viewport, content, renderer: "css-transform",
  css: { size: { width: 1200, height: 800 }, maxLayerPixels: 36_000_000, tierHysteresis: 0.12 },
  minScale: 0.07, maxScale: 32, wheelMode: "auto", wheelAtBounds: "release",
  pointerMoveScheduling: "frame",
  bounds: { x: 0, y: 0, width: 1200, height: 800 },
})
let lastSample = 0
let lastZoomLabel = ""
// Keep inspector nodes stable. Recreating the entire tree ten times/second
// creates garbage and dirties unrelated layout in a rendering benchmark.
const inspectorValues = new Map<string, HTMLElement>()
function inspect(force = false) {
  const now = performance.now()
  const c = port.engine.getSnapshot()
  const zoomLabel = `${Math.round(c.scale * 100)}%`
  if (zoomLabel !== lastZoomLabel) {
    zoom.textContent = zoomLabel
    lastZoomLabel = zoomLabel
  }
  if (!force && now - lastSample < 100) return
  lastSample = now
  const props: Array<[string,string]> = [
    ["Camera X", c.x.toFixed(2)],
    ["Camera Y", c.y.toFixed(2)],
    ["Zoom", `${(c.scale * 100).toFixed(2)}%`],
    ["Native transform", content.style.transform || "none"],
    ["CSS zoom", content.style.zoom || "1"],
    ["Layer width", content.style.width || "auto"],
    ["Render mode", port.renderer],
    ["DPR", String(window.devicePixelRatio || 1)],
  ]
  for (const [name,value] of props) {
    let right = inspectorValues.get(name)
    if (!right) {
      const item = document.createElement("div")
      item.className = "meta"
      const left = document.createElement("span")
      right = document.createElement("strong")
      left.textContent = name
      item.append(left,right)
      inspector.append(item)
      inspectorValues.set(name,right)
    }
    if (right.textContent !== value) right.textContent = value
  }
}
port.engine.subscribe(() => inspect())
function changeRenderer(mode: Mode) {
  port.setRenderer(mode)
  menu.value = mode
  label.textContent = names[mode]
  for (const [key,button] of buttons) {
    button.classList.toggle("active", key === mode)
    button.setAttribute("aria-pressed", String(key === mode))
  }
  inspect(true)
}
for (const mode of Object.keys(names) as Mode[]) {
  const button = document.createElement("button")
  button.className = "mode"
  const title = document.createElement("span")
  title.textContent = names[mode]
  const caption = document.createElement("em")
  caption.textContent = mode === "css-hybrid" ? "DPR" : mode === "css-transform" ? "GPU" : "Native"
  button.append(title,caption)
  button.addEventListener("click", () => changeRenderer(mode))
  buttons.set(mode, button)
  renderers.append(button)
}
menu.addEventListener("change", () => changeRenderer(menu.value as Mode))
document.querySelector("#zoom-in")!.addEventListener("click", () => port.engine.zoomBy(1.25))
document.querySelector("#zoom-out")!.addEventListener("click", () => port.engine.zoomBy(1 / 1.25))
document.querySelector("#fit")!.addEventListener("click", () => port.fit(undefined, 30))
changeRenderer("css-transform")
requestAnimationFrame(() => { port.fit(undefined, 30); inspect(true) })
window.addEventListener("pagehide", () => port.dispose(), { once: true })
// Debug/test surface only: inspect the actual engine without connecting it to UI state.
Object.assign(window, { __zoomportVanilla: port })
