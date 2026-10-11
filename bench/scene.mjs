import { performance } from "node:perf_hooks"
import { SceneIndex, SceneVisibility } from "../packages/core/dist/index.js"

let seed = 0x12345678
function rand() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
const sizes = [1000, 10000, 100000]
const runs = Number(process.env.ZOOMPORT_SCENE_RUNS || 5)
const qCount = Number(process.env.ZOOMPORT_SCENE_QUERIES || 400)
if (!Number.isSafeInteger(runs) || runs < 3 || runs > 50 || !Number.isSafeInteger(qCount) || qCount < 100 || qCount > 10000)
  throw new RangeError("invalid benchmark config")
const median = a => a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]
const results=[]
for (const distribution of ["grid","clustered"]) for (const n of sizes) {
  const side = Math.ceil(Math.sqrt(n))
  const entries=Array.from({length:n}, (_,i)=>{
    const col=i%side,row=Math.floor(i/side)
    const x=distribution==="grid" ? col*40 : col*3
    const y=distribution==="grid" ? row*40 : row*3
    return {id:i, bounds:{x,y,width:12,height:12}}
  })
  const extent = distribution==="grid" ? side*40 : side*3
  const areas=Array.from({length:qCount},()=>({
    x: rand() * extent,
    y: rand() * extent,
    width: 480,
    height: 320,
  }))
  const before=performance.now()
  const index=new SceneIndex(entries)
  const buildMs=performance.now()-before
  const result=[]
  let count=0
  function indexed() {
    let found=0
    for(const area of areas) {result.length=0;index.query(area,result);found+=result.length}
    return found
  }
  function linear() {
    let found=0
    for(const area of areas) {
      const maxX=area.x+area.width, maxY=area.y+area.height
      for(const v of entries) {
        const b=v.bounds
        if(b.x<=maxX&&b.x+b.width>=area.x&&b.y<=maxY&&b.y+b.height>=area.y)found++
      }
    }
    return found
  }
  const expected=linear(), actual=indexed()
  if(expected!==actual) throw Error("index must match linear visible count")
  const indexedSamples=[],linearSamples=[]
  for(let k=-1;k<runs;k++){
    let start=performance.now(); const a=indexed();let indexedMs=performance.now()-start
    start=performance.now();const b=linear();let linearMs=performance.now()-start
    if(a!==b)throw Error("query mismatch")
    if(k>=0){indexedSamples.push(indexedMs);linearSamples.push(linearMs)}
  }
  const vis=new SceneVisibility(index,{overscanPx:32,cacheMarginPx:256})
  let refreshed=0
  const vs={width:480,height:320}
  const startVisibility=performance.now()
  for(let i=0;i<1000;i++){
    const r=vis.update({x:-((i*0.5)%300), y:-((i*0.25)%300), scale:1},vs)
    if(r.requeried)refreshed++
  }
  const visibilityMs=performance.now()-startVisibility
  results.push({
    distribution,shapes:n,queries:qCount,
    buildMs:+buildMs.toFixed(3),averageVisible:+(actual/qCount).toFixed(1),
    indexedMedianMs:+median(indexedSamples).toFixed(3),
    linearMedianMs:+median(linearSamples).toFixed(3),
    indexedPerQueryMicroseconds:+(median(indexedSamples)*1000/qCount).toFixed(3),
    linearPerQueryMicroseconds:+(median(linearSamples)*1000/qCount).toFixed(3),
    speedup:+(median(linearSamples)/median(indexedSamples)).toFixed(2),
    visibilityRefreshes:refreshed,visibility1000StepsMs:+visibilityMs.toFixed(3),
  })
}
console.log(JSON.stringify({benchmark:"ZoomPort spatial BVH query vs linear scan",platform:process.platform,version:process.version,
  note:"Synthetic CPU only, no browser paint/DOM work. Results must not be interpreted as FPS.",results},null,2))
