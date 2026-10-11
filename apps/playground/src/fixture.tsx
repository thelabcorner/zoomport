import * as React from "react"
import { createRoot } from "react-dom/client"
import { ZoomPort, useZoomPort, connectCanvas2D, type CssRenderMode } from "@zoomport/react"
import type { CameraController } from "@zoomport/core"

declare global {
  interface Window { __zoomportFixture?: CameraController }
}
const mode = new URLSearchParams(location.search).get("mode") ?? "svg-viewbox"
const validCSS = new Set<CssRenderMode>(["css-transform", "css-hybrid", "css-layout", "css-resize"])
const intrinsic = { width: 800, height: 600 }
function Shapes() {
  return <>
    <rect width="800" height="600" fill="#fff" />
    <circle cx="200" cy="150" r="20" fill="#d000ff" data-testid="world-circle" />
  </>
}
function Bridge() {
  const engine = useZoomPort()
  React.useEffect(() => {
    window.__zoomportFixture = engine
    return () => { if (window.__zoomportFixture === engine) delete window.__zoomportFixture }
  }, [engine])
  return null
}
function CanvasScene() {
  const engine = useZoomPort()
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useLayoutEffect(() => {
    if (!ref.current) return
    const adapter = connectCanvas2D(engine, ref.current, (ctx) => {
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, 800, 600)
      ctx.fillStyle = "#d000ff"
      ctx.beginPath()
      ctx.arc(200, 150, 20, 0, 2 * Math.PI)
      ctx.fill()
    }, () => 1)
    return () => adapter.dispose()
  }, [engine])
  return <canvas ref={ref} width={600} height={400}
    style={{position:"absolute",inset:0,width:"100%",height:"100%"}} />
}
function Fixture() {
  return <ZoomPort.Root initial={{x:0,y:0,scale:1}} minScale={0.25} maxScale={20}
    reducedMotion wheelMode="zoom" wheelAtBounds="capture">
    <ZoomPort.Viewport aria-label="Browser verification viewport"
      data-testid="viewport"
      style={{width:600,height:400,background:"#fff",touchAction:"none"}}>
      <Bridge />
      {validCSS.has(mode as CssRenderMode)
        ? <ZoomPort.Content renderMode={mode as CssRenderMode} intrinsicSize={intrinsic}
            maxLayerPixels={4_000_000} style={{width:800,height:600}}>
            <svg width="100%" height="100%" viewBox="0 0 800 600"><Shapes /></svg>
          </ZoomPort.Content>
        : mode === "svg-transform"
          ? <svg width="600" height="400" style={{position:"absolute",inset:0}}>
              <ZoomPort.SVGContent><Shapes /></ZoomPort.SVGContent>
            </svg>
          : mode === "canvas2d" ? <CanvasScene />
          : <ZoomPort.SVGViewport><Shapes /></ZoomPort.SVGViewport>}
    </ZoomPort.Viewport>
  </ZoomPort.Root>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
