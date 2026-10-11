import { performance } from "node:perf_hooks"
import { CameraController } from "../packages/core/dist/index.js"
const scheduler = { request: () => 1, cancel() {} }
const rates = [60, 120, 144]
const scenarios = [
  { name: "unbounded", bounds: null },
  { name: "bounded", bounds: { x: -3000, y: -3000, width: 6000, height: 6000 } },
]
const steps = Number(process.env.ZOOMPORT_BENCH_STEPS || 10000)
const repeats = Number(process.env.ZOOMPORT_BENCH_REPEATS || 7)
if (!Number.isSafeInteger(steps) || steps < 100 || steps > 1_000_000 || !Number.isSafeInteger(repeats) || repeats < 3 || repeats > 100)
  throw new RangeError("Invalid bounded benchmark arguments")
const results = []
for (const scenario of scenarios) {
for (const hz of rates) {
  const samples = []
  for (let run = -1; run < repeats; run++) {
    const engine = new CameraController({ scheduler, maxScale: 48, bounds: scenario.bounds })
    engine.setViewport(1600, 900)
    const start = performance.now()
    for (let i = 0; i < steps; i++) {
      if (i % 41 === 0) engine.zoomBy(i % 82 === 0 ? 1.14 : 1 / 1.14, { x: 217, y: 355 })
      if (i % 67 === 0) engine.fling(1.25, -0.4)
      engine.advance(1000 / hz)
    }
    const elapsed = performance.now() - start
    const c = engine.getSnapshot()
    if (![c.x, c.y, c.scale].every(Number.isFinite)) throw new Error("Non-finite camera detected")
    engine.destroy()
    if (run >= 0) samples.push(elapsed * 1000 / steps)
  }
  samples.sort((a,b) => a-b)
  const medianUs = samples[Math.floor(samples.length / 2)]
  const p90Us = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.9) - 1)]
  results.push({ scenario: scenario.name, hz, steps, repeats, medianMicrosecondsPerStep: +medianUs.toFixed(4),
    p90MicrosecondsPerStep: +p90Us.toFixed(4), simulatedFrameBudgetMs: +(1000 / hz).toFixed(4) })
}
}
console.log(JSON.stringify({ benchmark: "ZoomPort synthetic camera CPU only",
  platform: process.platform + "/" + process.arch, node: process.version,
  note: "Not browser FPS: excludes DOM, layout, paint, GPU, decoding, and React profiling", results }, null, 2))
