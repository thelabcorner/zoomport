# Contributing to ZoomPort

ZoomPort is pre-release. Camera geometry, input handling, and renderer behavior are covered by tests because regressions in those areas can be hard to spot by eye.

## Run the checks

Use Node.js 20.19 or newer.

```sh
npm ci
npm run check
npx playwright install chromium firefox webkit
npm run test:browser
```

For all three Playwright browser engines, set `ZOOMPORT_ALL_BROWSERS=1` before `npm run test:browser`. CI runs this browser matrix on Linux. The local default uses Chromium only.

Use `npm run bench`, `npm run bench:scene`, and `npm run bench:browser` for performance changes. Synthetic camera throughput, browser layout counters, and actual rendered frame rates measure different costs. Keep those results separate.

## Send a change

- Describe the behavior that changes and include a small reproduction when fixing a bug.
- Add a unit test for geometry or lifecycle changes. Add a Playwright regression for observable pointer, wheel, SVG, or renderer behavior.
- Keep the four packages' public exports, TypeScript declarations, and documentation consistent.
- If you add a performance claim, name the hardware, browser/runtime, workload, and measurement method. Include the baseline.

See [the integration guide](docs/INTEGRATION.md) and [rendering QA contract](docs/RENDERER-QUALITY.md) before changing a renderer.

Contributions are licensed under [MIT](LICENSE).
