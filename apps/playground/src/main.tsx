import * as React from "react"
import { createRoot } from "react-dom/client"
import {
  ArrowDownRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Code2,
  Expand, Focus, Github, Image as ImageIcon, Info, Layers2,
  Maximize2, Minus, MousePointer2, Plus, RotateCcw, Settings2, SlidersHorizontal,
  SquareDashedMousePointer, X,
} from "lucide-react"
import { ZoomPort, useCameraSelector, useZoomPort, type Camera, type CssRenderMode } from "@zoomport/react"
import { ART, CanvasScene, VectorScene } from "./scenes"
import "./styles.css"
import "./mobile.css"

type Renderer = CssRenderMode | "svg-transform" | "svg-viewbox" | "canvas2d"
type Scene = "vector" | "gallery"
const MODES: ReadonlyArray<{ id: Renderer; title: string; sub: string; tag: string }> = [
  { id: "css-transform", title: "CSS transform", sub: "Compositor scale", tag: "DOM" },
  { id: "css-hybrid", title: "CSS hybrid", sub: "Resolution-stepped paint", tag: "DOM" },
  { id: "css-layout", title: "CSS layout zoom", sub: "Layout / repaint", tag: "DOM" },
  { id: "css-resize", title: "Native resize", sub: "Dimension-driven scale", tag: "DOM" },
  { id: "svg-transform", title: "SVG transform", sub: "Native group matrix", tag: "SVG" },
  { id: "svg-viewbox", title: "SVG viewBox", sub: "World-space viewport", tag: "SVG" },
  { id: "canvas2d", title: "Canvas 2D", sub: "Device-pixel redraw", tag: "2D" },
]
const descriptions: Record<Renderer, string> = {
  "css-transform": "Transforms the DOM layer with translate() and scale(). Fast compositing; bitmap detail is source-dependent.",
  "css-hybrid": "Paints responsive content into larger tiered layers and bridges scales with a reciprocal CSS transform.",
  "css-layout": "Uses CSS zoom, compensating translation to preserve camera geometry. Reflow can be expensive.",
  "css-resize": "Changes native width and height instead of scaling the layer. Useful for SVG and image elements.",
  "svg-transform": "Updates a native SVG group transform attribute. Child paths remain vector geometry.",
  "svg-viewbox": "Updates the outer SVG viewBox in world coordinates. No CSS scaling is applied to the artwork.",
  "canvas2d": "Redraws vector commands into a device-pixel-sized Canvas 2D surface on camera updates.",
}
const zoomPercent = (camera: Readonly<Camera>) => Math.round(camera.scale * 100)
const fitPadding = (width: number) => Math.max(16, Math.min(76, width * .065))
const allowed = (mode: Renderer, scene: Scene) => scene === "vector" || mode.startsWith("css-")
const tag = (mode: Renderer) => MODES.find(item => item.id === mode)!.tag

function InitialFit() {
  const engine = useZoomPort()
  React.useEffect(() => {
    let frame = 0
    const check = () => {
      const { width, height } = engine.getViewport()
      if (width > 0 && height > 0) engine.fit(ART, fitPadding(width), false)
      else frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(check)
    return () => cancelAnimationFrame(frame)
  }, [engine])
  return null
}
function StageControls() {
  const engine = useZoomPort()
  const percent = useCameraSelector(zoomPercent)
  return <div className="hud" role="group" aria-label="Camera controls">
    <button aria-label="Zoom out" title="Zoom out" onClick={() => engine.zoomBy(1/1.25)}><Minus size={15}/></button>
    <output className="zoom-readout" aria-label="Current zoom">{percent}%</output>
    <button aria-label="Zoom in" title="Zoom in" onClick={() => engine.zoomBy(1.25)}><Plus size={15}/></button>
    <span className="hud-separator"/>
    <button aria-label="Fit artwork" title="Fit artwork" onClick={() => engine.fit(ART, fitPadding(engine.getViewport().width))}><Maximize2 size={15}/></button>
    <button aria-label="Reset to 100 percent" title="Reset to 100%" onClick={() => engine.setCamera({ x: 0, y: 0, scale: 1 }, true)}><RotateCcw size={15}/></button>
  </div>
}

/** The inspector reads genuine live element properties rather than repeating selection state. */
function RuntimeInspector({ mode }: { mode: Renderer }) {
  const engine = useZoomPort()
  const operation = React.useRef<HTMLOutputElement>(null)
  const position = React.useRef<HTMLOutputElement>(null)
  const zoom = React.useRef<HTMLOutputElement>(null)
  const surface = React.useRef<HTMLOutputElement>(null)
  const serial = React.useRef<HTMLOutputElement>(null)
  React.useEffect(() => {
    let scheduled = 0
    let timer = 0
    let lastSample = -Infinity
    let count = 0
    const inspect = () => {
      scheduled = 0
      lastSample = performance.now()
      const c = engine.getSnapshot()
      const node = document.querySelector<HTMLElement | SVGElement>(".viewport [data-zoomport-renderer]")
      if (position.current) position.current.textContent = Math.round(c.x) + ", " + Math.round(c.y) + " px"
      if (zoom.current) zoom.current.textContent = (c.scale * 100).toFixed(1) + "%"
      if (serial.current) serial.current.textContent = String(++count)
      if (!node) {
        if (operation.current) operation.current.textContent = "No active adapter"
        if (surface.current) surface.current.textContent = "—"
        return
      }
      const svg = node as SVGElement
      const html = node as HTMLElement
      const actual = mode === "svg-viewbox" ? "viewBox: " + (svg.getAttribute("viewBox") || "—")
        : mode === "svg-transform" ? "transform: " + (node.querySelector("g")?.getAttribute("transform") || "—")
        : mode === "canvas2d" && node instanceof HTMLCanvasElement ? "backing pixels: " + node.width + " × " + node.height
        : mode === "css-layout" ? "zoom: " + (html.style.zoom || "1") + " · " + (html.style.transform || "")
        : mode === "css-resize" ? "size: " + (html.style.width || "—") + " × " + (html.style.height || "—")
        : "transform: " + (html.style.transform || "—")
      if (operation.current) operation.current.textContent = actual
      if (surface.current) surface.current.textContent = node.tagName.toLowerCase() + (node instanceof HTMLCanvasElement ? " · device pixel buffer" : " · DOM element")
    }
    // Inspection is intentionally sampled (10 Hz), not tied to every camera
    // frame. A trailing sample captures the final settled state after gestures.
    const schedule = () => {
      if (scheduled || timer) return
      const delay = Math.max(0, 100 - (performance.now() - lastSample))
      if (delay === 0) scheduled = requestAnimationFrame(inspect)
      else timer = window.setTimeout(() => {
        timer = 0
        scheduled = requestAnimationFrame(inspect)
      }, delay)
    }
    schedule()
    const unsubscribe = engine.subscribe(schedule)
    return () => { cancelAnimationFrame(scheduled); clearTimeout(timer); unsubscribe() }
  }, [engine, mode])
  return <>
    <div className="inspector-heading"><span>Runtime inspection</span><span className="inspector-tag">Live DOM</span></div>
    <div className="inspector-section">
      <div className="value-row"><span>Active adapter</span><strong data-testid="active-renderer">{mode}</strong></div>
      <div className="value-row"><span>Native element</span><output ref={surface}>Inspecting…</output></div>
      <div className="value-row"><span>Camera position</span><output ref={position}>—</output></div>
      <div className="value-row"><span>Zoom</span><output ref={zoom}>—</output></div>
      <div className="value-row"><span>Render inspections</span><output ref={serial}>—</output></div>
    </div>
    <div className="inspector-heading"><span>Actual browser operation</span><span className="inspector-tag">Observed</span></div>
    <div className="operation-box"><output ref={operation} data-testid="renderer-runtime">Inspecting…</output></div>
    <p className="inspector-note"><Info size={13}/> Values above are read from the mounted element, not predicted from the selected renderer.</p>
  </>
}
function Snippet({ mode }: { mode: Renderer }) {
  const snippet = mode === "svg-viewbox" ? "<ZoomPort.SVGViewport>\n  <Artwork />\n</ZoomPort.SVGViewport>"
    : mode === "svg-transform" ? "<svg>\n  <ZoomPort.SVGContent>\n    <Artwork />\n  </ZoomPort.SVGContent>\n</svg>"
    : mode === "canvas2d" ? "connectCanvas2D(camera, canvas, drawScene)"
    : mode === "css-resize" ? '<ZoomPort.Content renderMode="css-resize"\n  intrinsicSize={{ width: 1280, height: 820 }}>\n  <Artwork />\n</ZoomPort.Content>'
    : '<ZoomPort.Content renderMode="' + mode + '"\n  intrinsicSize={{ width: 1280, height: 820 }}>\n  <Artwork />\n</ZoomPort.Content>'
  return <div className="snippet"><div className="snippet-head"><Code2 size={14}/> Integration <span>React / TypeScript</span></div>
    <pre><code>{snippet}</code></pre></div>
}
function SceneSurface({ renderer, scene }: { renderer: Renderer; scene: Scene }) {
  if (renderer === "canvas2d" && scene === "vector") return <CanvasScene />
  if (renderer === "svg-viewbox" && scene === "vector")
    return <ZoomPort.SVGViewport data-zoomport-renderer={renderer} data-testid="svg-viewbox-surface" aria-label="Native viewBox renderer"><VectorScene /></ZoomPort.SVGViewport>
  if (renderer === "svg-transform" && scene === "vector")
    return <svg data-zoomport-renderer={renderer} data-testid="svg-transform-surface" className="svg-root" aria-label="Native SVG group transform">
      <ZoomPort.SVGContent><VectorScene /></ZoomPort.SVGContent>
    </svg>
  if (scene === "gallery" && renderer === "css-resize")
    return <ZoomPort.Image data-zoomport-renderer={renderer} data-testid="native-image-surface" src="/gallery.svg"
      alt="Zoomable gallery artwork" intrinsicWidth={ART.width} intrinsicHeight={ART.height} draggable={false}/>
  return <ZoomPort.Content className="artboard" data-zoomport-renderer={renderer} data-testid="css-renderer"
    style={{ width: ART.width, height: ART.height }}
    renderMode={renderer as CssRenderMode} intrinsicSize={ART}>
    {scene === "vector" ? <VectorScene responsive={renderer === "css-hybrid" || renderer === "css-resize"}/>
      : <img className="gallery-image" src="/gallery.svg" alt="Gallery artwork" draggable={false}/>}
  </ZoomPort.Content>
}
function App() {
  const [scene, setScene] = React.useState<Scene>("vector")
  const [renderer, setRenderer] = React.useState<Renderer>("svg-viewbox")
  const [smooth, setSmooth] = React.useState(true)
  const [expanded, setExpanded] = React.useState(false)
  const [showCode, setShowCode] = React.useState(false)
  const [showInspector, setShowInspector] = React.useState(true)
  const chooseScene = (next: Scene) => {
    setScene(next)
    if (!allowed(renderer, next)) setRenderer("css-resize")
  }
  React.useEffect(() => {
    if (!expanded) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false) }
    window.addEventListener("keydown", onKey)
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey) }
  }, [expanded])
  const active = MODES.find(item => item.id === renderer)!
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Focus size={18} strokeWidth={2.2}/></div><strong>ZoomPort</strong><span className="brand-divider"/><span className="brand-sub">Playground</span></div>
      <nav className="top-links" aria-label="Navigation"><a href="#workspace" className="active">Playground</a><a href="/culling.html">100K Performance Lab</a><a href="/vanilla.html">Vanilla JS</a><a href="#architecture">Architecture</a></nav>
      <div className="top-status"><span className="status-dot"/><span>Running in your browser</span><span className="version">v0.1</span></div>
    </header>
    <section className="intro-bar"><div className="intro-content"><div className="kicker">ZoomPort / Interactive workbench</div>
      <h1>One camera. <span>Every canvas.</span></h1>
      <p>Pan, zoom and pinch through real rendering pipelines. Inspect what changes, not just how it looks.</p>
    </div><div className="intro-aside"><span className="meta-chip"><Check size={13}/> Headless React primitives</span><span>Built for galleries, editors and spatial interfaces.</span></div></section>
    <div className="workbench" id="workspace">
      <aside className="library" aria-label="Playground examples and rendering strategies">
        <div className="section-title"><span>Explore</span><Layers2 size={14}/></div>
        <div className="library-desc"><strong>Choose a scene</strong><span>One engine, different surfaces.</span></div>
        <div className="example-list" role="group" aria-label="Demo selection">
          <button className={"example " + (scene === "vector" ? "selected" : "")} aria-pressed={scene === "vector"} onClick={() => chooseScene("vector")}><SquareDashedMousePointer size={17}/><span><strong>Vector canvas</strong><small>Typography & fine detail</small></span>{scene === "vector" && <Check size={14}/>}</button>
          <button className={"example " + (scene === "gallery" ? "selected" : "")} aria-pressed={scene === "gallery"} onClick={() => chooseScene("gallery")}><ImageIcon size={17}/><span><strong>Image gallery</strong><small>Source image scaling</small></span>{scene === "gallery" && <Check size={14}/>}</button>
        </div>
        <div className="library-subheading"><span>Rendering strategies</span><span>{scene === "vector" ? "7" : "4"} available</span></div>
        <div className="renderer-list" role="group" aria-label="Renderers">
          {MODES.filter(item => allowed(item.id, scene)).map(item => <button key={item.id}
            data-testid={"select-" + item.id} aria-pressed={renderer === item.id}
            className={"renderer-item " + (renderer === item.id ? "selected" : "")} onClick={() => setRenderer(item.id)}>
            <span className="renderer-radio"/><span className="renderer-copy"><strong>{item.title}</strong><small>{item.sub}</small></span><span className="renderer-kind">{item.tag}</span>
          </button>)}
        </div>
        <div className="library-foot"><CircleHelp size={14}/><span>Gallery exposes DOM/image renderers. SVG and Canvas require vector-scene integration.</span></div>
      </aside>
      <ZoomPort.Root key={scene} bounds={ART} minScale={0.15} maxScale={12} wheelMode="zoom" reducedMotion={!smooth} pointerMoveScheduling="frame">
        <main className="workspace" aria-label="ZoomPort workspace">
          <div className="workspace-top"><div className="workspace-title"><MousePointer2 size={15}/><strong>Workspace</strong><span className="crumb">/</span><span>{scene === "vector" ? "Vector canvas" : "Image gallery"}</span></div>
            <div className="workspace-actions">
              <label className="smooth-toggle"><input type="checkbox" checked={smooth} onChange={e => setSmooth(e.target.checked)}/> Smooth motion</label>
              <button className={"tool-button " + (showInspector ? "is-active" : "")} title="Toggle inspector" aria-label="Toggle inspector" aria-pressed={showInspector} onClick={() => setShowInspector(v=>!v)}><Settings2 size={15}/></button>
              <button className={"tool-button " + (showCode ? "is-active" : "")} title="Toggle integration snippet" aria-label="Toggle integration snippet" aria-pressed={showCode} onClick={() => setShowCode(v=>!v)}><Code2 size={15}/></button>
            </div>
          </div>
          <div className="preview-top"><div className="preview-heading"><span className="status-dot"/> Live preview <span className="preview-sep">·</span> <span>{active.sub}</span></div>
            <label className="renderer-picker">Renderer <span className="select-shell"><select aria-label="Rendering strategy" value={renderer} onChange={e => setRenderer(e.target.value as Renderer)}>
              {MODES.filter(item => allowed(item.id, scene)).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
            </select><ChevronDown size={13}/></span></label>
          </div>
          <div className={"canvas-shell" + (expanded ? " is-expanded" : "")} data-active-renderer={renderer}>
            <ZoomPort.Viewport className="viewport" aria-label="Interactive ZoomPort demonstration">
              <InitialFit/>
              <SceneSurface renderer={renderer} scene={scene}/>
              <div className="viewport-note"><span className="live-square"/> <span>Live canvas</span> <span className="dot-separator">·</span> {tag(renderer)} pipeline</div>
              <StageControls/>
            </ZoomPort.Viewport>
            <button className="expand-button" aria-pressed={expanded} aria-label={expanded ? "Close immersive viewport" : "Open immersive viewport"}
              title={expanded ? "Exit immersive view" : "Immersive view"} onClick={() => setExpanded(v=>!v)}>{expanded ? <X size={16}/> : <Expand size={16}/>}<span>{expanded ? "Exit" : "Expand"}</span></button>
          </div>
          <div className="viewport-caption"><span><MousePointer2 size={13}/> Drag to pan <i>·</i> Scroll / pinch to zoom</span><span>{ART.width} × {ART.height} world units</span></div>
          {showCode && <Snippet mode={renderer}/>}
          <div className="workspace-foot"><span><span className="status-dot"/> Camera ready</span><span>World-space geometry preserved across renderer changes</span></div>
        </main>
        {showInspector && <aside className="inspector" aria-label="Renderer inspector">
          <div className="section-title"><span>Inspector</span><SlidersHorizontal size={14}/></div>
          <div className="inspector-intro"><div className="inspector-adapter">{active.title}</div><p>{descriptions[renderer]}</p>
            <div className="adapter-pill"><span className="status-dot"/> Active: {renderer}</div></div>
          <RuntimeInspector mode={renderer}/>
          <div className="inspector-bottom"><Info size={14}/><span>Different adapters can produce similar pixels. DOM attributes and CSS properties are the source of truth for this inspection.</span></div>
        </aside>}
      </ZoomPort.Root>
    </div>
    <section className="architecture" id="architecture">
      <div className="architecture-heading"><span className="kicker">Architecture</span><h2>Rendering is a choice. <span>Interaction is not.</span></h2><p>All seven adapters read the same continuously interpolated camera. Swap the surface without replacing gesture or world-space math.</p></div>
      <div className="architecture-grid">
        <div><div className="architecture-icon"><Focus size={18}/></div><strong>Camera core</strong><span>One frame-rate-independent coordinate system for every scene.</span><small>01 / Math & physics</small></div>
        <div><div className="architecture-icon"><Layers2 size={18}/></div><strong>Renderer adapters</strong><span>CSS, native SVG and Canvas 2D bind to the same camera.</span><small>02 / Scene rendering</small></div>
        <div><div className="architecture-icon"><ArrowUpRight size={18}/></div><strong>React primitives</strong><span>Composable, headless controls. Styling belongs to your application.</span><small>03 / Application layer</small></div>
      </div>
    </section>
    <footer className="site-footer"><span><span className="footer-symbol">⊕</span> ZoomPort · Open-source viewport primitives</span><span>Designed for everything worth a closer look <ArrowDownRight size={13}/></span></footer>
  </div>
}
createRoot(document.getElementById("root")!).render(<App />)
