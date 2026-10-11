import { test } from "@playwright/test"

type PerformanceMetric = { name: string; value: number }
const modes = ["css-transform", "css-hybrid", "css-layout", "css-resize", "svg-transform", "svg-viewbox", "canvas2d"]
const workloads = ["pan-only", "pan-and-zoom"] as const
function readMetric(metrics: PerformanceMetric[], name: string) {
  return metrics.find(metric => metric.name === name)?.value ?? 0
}
function percentile(values: number[], fraction: number) {
  return values[Math.floor((values.length - 1) * fraction)] ?? 0
}
for (const mode of modes) {
for (const workload of workloads) {
  test("browser profile: " + mode + " / " + workload, async ({page}, testInfo) => {
    await page.goto("/fixture.html?mode=" + mode)
    await page.waitForFunction(() => Boolean((window as any).__zoomportFixture))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")
    // Let Vite and the initial content paint settle before measuring.
    await page.waitForTimeout(150)
    const before = (await cdp.send("Performance.getMetrics")).metrics
    const timings = await page.evaluate(async (workload) => {
      const engine = (window as any).__zoomportFixture
      const durations: number[] = []
      const timestamps: number[] = []
      for (let i=0;i<120;i++) {
        await new Promise<void>(done => requestAnimationFrame(timestamp => {
          timestamps.push(timestamp)
          const t = performance.now()
           engine.jumpTo({x:30 + i * 0.8,y:25 - i * 0.3,
             scale:workload === "pan-only" ? 1.5 : 1.5 + i * 0.01})
          durations.push((performance.now() - t) * 1000)
          done()
        }))
      }
      await new Promise<void>(done => requestAnimationFrame(() => done()))
      const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]!)
      return {durations,intervals}
    }, workload)
    const after = (await cdp.send("Performance.getMetrics")).metrics
    const durations = timings.durations.toSorted((a,b)=>a-b)
    const intervals = timings.intervals.toSorted((a,b)=>a-b)
    const metrics: Record<string, number> = {}
    for (const name of ["LayoutCount","RecalcStyleCount","LayoutDuration","RecalcStyleDuration","ScriptDuration","TaskDuration"])
      metrics[name] = readMetric(after,name) - readMetric(before,name)
    const result = {
      renderer: mode,
      workload,
      browser: "chromium",
      samples: durations.length,
      // JS including synchronous adapter subscription/writes, but not GPU or paint.
      cameraJsMicroseconds: {median:percentile(durations,0.5),p95:percentile(durations,0.95)},
      actualRafMilliseconds: {median:percentile(intervals,0.5),p95:percentile(intervals,0.95)},
      browserMetrics:metrics,
    }
    console.log("ZOOMPORT_PROFILE " + JSON.stringify(result))
    await testInfo.attach("measurements.json",{
      body:Buffer.from(JSON.stringify(result,null,2)),contentType:"application/json",
    })
  })
}
}
