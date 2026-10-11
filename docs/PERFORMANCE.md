# ZoomPort performance engineering

## Scope and evidence

Performance claims must separate **camera CPU**, **input event delivery**,
**browser style/layout/paint**, **GPU compositing**, and **source-image detail**.
For spatial visibility and semantic level-of-detail rendering over large
world-space scenes, see [SCENE-PERFORMANCE.md](SCENE-PERFORMANCE.md).
None of these measurements alone establishes end-to-end FPS or native
image quality. The baseline demonstration contains one deliberately compact
scene; production editors with hundreds of thousands of objects can behave
very differently.

### Browser measurement (October 10, 2026)

Chromium/Chrome headless on Windows x64, 120 RAF-driven camera updates per
renderer/workload; one run, real display cadence ~16.7 ms (60 Hz).
Recorded from Chrome Performance counters, not estimated from source code.
`npm run bench:browser` reproduces the fixture.

| Renderer | Pan-only layout events | Pan+zoom layout events | Pan-only layout duration (ms total) | Pan+zoom duration (ms total) |
| --- | ---: | ---: | ---: | ---: |
| CSS transform | 0 | 0 | 0 | 0 |
| CSS hybrid | 1 | 1 | 0.17 | 0.09 |
| CSS layout zoom | 1 | 120 | 0.55 | 50.94 |
| CSS native resize | 1 | 120 | 0.07 | 7.43 |
| Native SVG group | 120 | 120 | 4.36 | 3.23 |
| Native SVG viewBox | 120 | 120 | 9.08 | 7.54 |
| Canvas 2D | 0 | 0 | 0 | 0 |

Layout *counts* are not proportional to layout *cost*: SVG group had 120
events but only ~3–4 ms of aggregate layout in this lightweight fixture.
Canvas 2D still redraws pixels; zero layout events do not imply zero CPU,
rasterization or GPU work. The browser clock quantized the measured
camera-JavaScript medians at ~100 microseconds; these values are unsuitable
for precise sub-100µs comparative claims. Do not extrapolate this run into
real 120/144Hz performance.

### Implemented engineering measures

- **Frame-rate-independent camera interpolation**: no fixed per-frame easing.
  Pan-only frames avoid scale logarithms and exponentials entirely.
- **One shared native RAF** for many active cameras. Each logical callback
  retains independent cancelation, and two internal callback Maps are reused.
  A unit test exercises 64 concurrent cameras, verifying one native request.
- **Opt-in per-frame pointer coalescing**: latest sample per pointer, queued
  pointer updates flushed before release; React/vanilla use the same engine.
  One browser test sends 120 pointermove events and verifies 120 notifications
  in immediate mode versus one in frame mode, with the same final geometry.
  This result measures notification volume, **not** an FPS multiplier.
- **DOM adapters** avoid writing zoom/width/height for pan-only movement.
- **Canvas/SVG** use resize-cached dimensions rather than querying client
  geometry in their animation subscriber. Canvas without ResizeObserver
  retains a live-read fallback for compatibility.
- **Vanilla inspector** preserves DOM nodes across samples and updates the
  zoom label only on actual zoom changes.
- **Image strategy** separates source-resolution selection, DPI and CSS
  scaling. Higher requested pixel dimensions cannot recreate absent source
  detail.

### Configuration guidance

For one ordinary gallery, start with CSS transforms. For text/vector-rich
scenes that need crisp zoomed presentation, compare CSS hybrid, SVG, and
native layout/resize using representative artwork; do not choose purely on
layout event count. For touch-driven editors, choose
`pointerMoveScheduling: "frame"` when reduction in render call frequency is
more important than processing every raw movement sample. Precision tools
that need immediate feedback should retain `"immediate"`.

Set a memory budget for high-resolution hybrid layers and predecode image
sources instead of swapping partial images during a gesture. Prefer spatial
culling and level-of-detail policies before micro-optimizing transform
string construction.

### Next validation gates

Real high-refresh-rate hardware (120/144Hz), physical iOS Safari/Android
touch, image-sharpness screenshot comparisons at DPR 1/2/3, workload-scale
GPU/memory profiles, long-running leak and cancellation probes, and paired
A/B performance runs with pinned hardware/browser versions. Record median,
p95, throughput, battery/memory, layout and paint separately.
