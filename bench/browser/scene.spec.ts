import { expect, test } from "@playwright/test"

test("100k-shape renderer draw-call cost: naive / indexed / hierarchy LOD", async ({ page }, testInfo) => {
  await page.setViewportSize({width:1280,height:760})
  await page.goto("/culling.html")
  await page.waitForFunction(() => Boolean((window as any).__zoomportLab))
  const data = await page.evaluate(() => {
    const lab = (window as any).__zoomportLab
    const { port, stats, setMode } = lab
    const results: Array<{ mode:string; zoom:number; operations:number; candidates:number; medianDrawMs:number; p90DrawMs:number }>=[]
    const median=(list:number[])=>list.slice().sort((a,b)=>a-b)[Math.floor(list.length/2)]!
    for (const scale of [1, 0.05]) {
      for (const mode of ["naive","indexed","adaptive"] as const) {
        setMode(mode)
        const anchor = {x:scale===1?-1400:-200,y:scale===1?-1100:-200,scale}
        port.engine.jumpTo(anchor)
        const samples:number[]=[]
        let operations=0,candidates=0
        for(let i=-2;i<12;i++) {
          port.invalidate()
          if (i>=0) {samples.push(stats.cpuMs);operations=stats.draws;candidates=stats.candidates}
        }
        samples.sort((a,b)=>a-b)
        results.push({ mode,zoom:scale,operations,candidates,
          medianDrawMs:+median(samples).toFixed(3),
          p90DrawMs:+samples[Math.floor(samples.length*.9)]!.toFixed(3) })
      }
    }
    return { version:navigator.userAgent, dpr:devicePixelRatio,shapeCount:lab.index.size, results }
  })
  expect(data.shapeCount).toBe(100000)
  const indexed = data.results.find(x=>x.mode==="indexed"&&x.zoom===1)!
  const naive = data.results.find(x=>x.mode==="naive"&&x.zoom===1)!
  const overview = data.results.find(x=>x.mode==="adaptive"&&x.zoom===0.05)!
  expect(indexed.operations).toBeLessThan(naive.operations)
  expect(overview.operations).toBeLessThan(1000)
  await testInfo.attach("zoomport-100k-scene-performance.json", {
    body: JSON.stringify({ notes:"Single Chromium run; draw callback CPU only, not GPU/presentation or sustained FPS",...data},null,2),
    contentType:"application/json",
  })
  console.log(JSON.stringify(data,null,2))
})
