import * as React from "react"
import { connectCanvas2D, useZoomPort } from "@zoomport/react"

export const ART = { x: 0, y: 0, width: 1280, height: 820 } as const

const lines = Array.from({ length: 13 }, (_, i) => i)
const bars = [52, 86, 65, 109, 92, 131, 111, 158, 134, 187, 170, 209]

/** The same world-space art is used by all SVG and CSS renderers. */
export function VectorScene({ responsive = false }: { responsive?: boolean }) {
  return <svg className={responsive ? "scene-svg is-responsive" : "scene-svg"} width={responsive ? "100%" : ART.width} height={responsive ? "100%" : ART.height}
    viewBox="0 0 1280 820" xmlns="http://www.w3.org/2000/svg" aria-label="Precision typography, geometry, line work and color artwork">
    <defs>
      <pattern id="precision-grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M28 0H0V28" fill="none" stroke="#e7e8e4" strokeWidth="1"/>
      </pattern>
      <clipPath id="poster-clip"><rect x="708" y="96" width="512" height="618" rx="9"/></clipPath>
    </defs>
    <rect width="1280" height="820" fill="#ffffff"/>
    <rect width="1280" height="820" fill="url(#precision-grid)" opacity=".52"/>
    <path d="M0 60H1280" stroke="#d8dad6"/>
    <text x="48" y="37" fontFamily="Inter, sans-serif" fontWeight="650" fontSize="15" fill="#181a18">ZOOMPORT™</text>
    <text x="505" y="37" fontFamily="Inter, sans-serif" fontSize="12" fill="#727870">DESIGN SYSTEM / 001</text>
    <text x="1225" y="37" fontFamily="Inter, sans-serif" fontSize="12" fill="#727870" textAnchor="end">SCALE IS A SUPERPOWER</text>
    <text x="49" y="140" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600" fill="#6b706a">THE CAMERA EXPERIMENT</text>
    <text x="43" y="259" fontFamily="Inter, sans-serif" fontSize="100" fontWeight="750" letterSpacing="-8" fill="#171916">Zoom with</text>
    <text x="43" y="373" fontFamily="Inter, sans-serif" fontSize="117" fontWeight="750" letterSpacing="-9" fill="#171916">intention.</text>
    <rect x="50" y="405" width="535" height="1" fill="#cccfcb"/>
    <text x="50" y="446" fontFamily="Inter, sans-serif" fontSize="20" fill="#5a605b">One coordinate space.</text>
    <text x="50" y="477" fontFamily="Inter, sans-serif" fontSize="20" fill="#5a605b">Seven rendering pipelines.</text>
    <g transform="translate(50 540)">
      <rect width="258" height="147" rx="8" fill="#f3f4f1" stroke="#e1e3dd"/>
      <text x="17" y="28" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="600" fill="#535953">01 / FINE DETAIL</text>
      {lines.map(i => <line key={i} x1={24 + i * 17} y1="50" x2={24 + i * 17} y2="124" stroke={i%3 === 0 ? "#222723" : "#868e81"} strokeWidth={i%3 === 0 ? 1 : 0.35}/>)}
      <path d="M22 119L238 52" stroke="#171917" strokeWidth=".6"/>
      <circle cx="153" cy="83" r="24" fill="none" stroke="#181a18" strokeWidth=".7"/>
      <circle cx="153" cy="83" r="17" fill="none" stroke="#181a18" strokeWidth=".45"/>
    </g>
    <g transform="translate(325 540)">
      <rect width="258" height="147" rx="8" fill="#f3f4f1" stroke="#e1e3dd"/>
      <text x="17" y="28" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="600" fill="#535953">02 / SUBPIXEL TEST</text>
      {bars.map((n,i) => <rect key={i} x={20+i*19} y={127-n*.35} width="9" height={n*.35} rx=".4" fill={i>7?"#8fae08":"#292e26"}/>)}
      <path d="M20 127H243" stroke="#949991" strokeWidth=".7"/>
    </g>
    <rect x="708" y="96" width="512" height="618" rx="9" fill="#20231f"/>
    <g clipPath="url(#poster-clip)">
      <g stroke="#41483c" fill="none" strokeWidth=".8">
        {Array.from({length: 10},(_,i)=><circle key={i} cx="978" cy="389" r={40+i*39}/>)}
        <path d="M708 389H1220M978 96V714"/>
        {Array.from({length:7},(_,i)=><path key={i} d={"M708 "+(135+i*85)+"H1220"}/>)}
      </g>
      <circle cx="978" cy="389" r="169" fill="#aaff00"/>
      <circle cx="978" cy="389" r="94" fill="#20231f"/>
      <circle cx="978" cy="389" r="45" fill="#aaff00"/>
      <circle cx="978" cy="389" r="8" fill="#20231f"/>
      <path d="M735 141L1192 648" stroke="#f5f6ee" strokeWidth="1"/>
      <path d="M1215 140L743 645" stroke="#f5f6ee" strokeWidth=".5"/>
    </g>
    <rect x="727" y="117" width="96" height="27" rx="4" fill="#aaff00"/>
    <text x="775" y="135" fontFamily="Inter, sans-serif" textAnchor="middle" fontSize="12" fontWeight="750" fill="#171a14">LIVE VECTOR</text>
    <text x="741" y="685" fontFamily="Inter, sans-serif" fontSize="12" fill="#ffffff">SHAPE / SCALE / PRESERVE</text>
    <text x="1189" y="685" textAnchor="end" fontFamily="Inter, sans-serif" fontSize="12" fill="#c8cfbd">ZP — 2026</text>
    <line x1="48" y1="754" x2="1230" y2="754" stroke="#d7d9d4"/>
    <text x="48" y="784" fontFamily="Inter, sans-serif" fontSize="13" fill="#7a8076">Drag to pan  ·  Scroll or pinch to zoom  ·  Inspect vector details at 400%</text>
    <text x="1225" y="784" textAnchor="end" fontFamily="Inter, sans-serif" fontSize="13" fill="#7a8076">1280 × 820 / SVG</text>
  </svg>
}

/** A genuinely native Canvas 2D pipeline, rendered in device pixels on each camera update. */
export function CanvasScene() {
  const engine = useZoomPort()
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useLayoutEffect(() => {
    if (!ref.current) return
    const adapter = connectCanvas2D(engine, ref.current, (ctx) => {
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, ART.width, ART.height)
      ctx.strokeStyle = "#e5e7e1"
      ctx.lineWidth = .55
      for(let x=0;x<ART.width;x+=28) {ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,820);ctx.stroke()}
      for(let y=0;y<ART.height;y+=28) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke()}
      ctx.fillStyle="#181a17"
      ctx.font="700 92px Inter, sans-serif"
      ctx.fillText("Zoom with",48,255)
      ctx.font="700 112px Inter, sans-serif"
      ctx.fillText("intention.",48,372)
      ctx.font="500 21px Inter, sans-serif"
      ctx.fillStyle="#616760"
      ctx.fillText("One coordinate space.",50,438)
      ctx.fillText("Seven rendering pipelines.",50,473)
      ctx.fillStyle="#20231f"
      ctx.beginPath(); ctx.roundRect(708,96,512,618,9);ctx.fill()
      ctx.save()
      ctx.beginPath();ctx.rect(708,96,512,618);ctx.clip()
      ctx.strokeStyle="#41483c"
      ctx.lineWidth=.8
      for(let i=0;i<10;i++){ctx.beginPath();ctx.arc(978,389,40+i*39,0,Math.PI*2);ctx.stroke()}
      ctx.fillStyle="#aaff00"
      ctx.beginPath();ctx.arc(978,389,169,0,Math.PI*2);ctx.fill()
      ctx.fillStyle="#20231f"
      ctx.beginPath();ctx.arc(978,389,94,0,Math.PI*2);ctx.fill()
      ctx.fillStyle="#aaff00"
      ctx.beginPath();ctx.arc(978,389,45,0,Math.PI*2);ctx.fill()
      ctx.strokeStyle="#f3f3ed";ctx.lineWidth=1
      ctx.beginPath();ctx.moveTo(735,141);ctx.lineTo(1192,648);ctx.stroke()
      ctx.restore()
      ctx.fillStyle="#171a14"; ctx.fillRect(728,117,117,28)
      ctx.fillStyle="#aaff00";ctx.fillRect(728,117,117,28)
      ctx.fillStyle="#171a14";ctx.font="700 12px Inter, sans-serif";ctx.fillText("NATIVE CANVAS",739,136)
      ctx.font="600 13px Inter, sans-serif"
      ctx.fillText("PIXEL DENSITY AWARE",50,710)
      ctx.strokeStyle="#d7d9d4";ctx.beginPath();ctx.moveTo(48,754);ctx.lineTo(1230,754);ctx.stroke()
      ctx.font="13px Inter, sans-serif";ctx.fillStyle="#7a8076"
      ctx.fillText("Device-pixel redraw on camera updates",48,784)
    })
    return () => adapter.dispose()
  }, [engine])
  return <canvas ref={ref} className="native-canvas" data-zoomport-renderer="canvas2d" data-testid="canvas2d-surface" aria-label="Native Canvas 2D rendering" />
}
