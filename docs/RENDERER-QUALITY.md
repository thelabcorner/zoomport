# ZoomPort Rendering QA Contract

## Fidelity invariant

For every camera, world point (wx,wy) must appear at (camera.x + wx*camera.scale, camera.y + wy*camera.scale), up to browser antialiasing and numerical tolerances. Changing renderers must not change this transform.

## Rendering choices

- CSS compositor: `css-transform` is cheapest for arbitrary DOM. It does not force rerasterization when magnifying cached layers.
- CSS hybrid: `css-hybrid` resizes the content at powers-of-two tiers and CSS scales by the residual ratio. It reduces per-frame layout work but is bounded by `maxLayerPixels` and optionally `maxDevicePixels`/DPR. Children must resize with the parent; fixed-size children violate the camera/world-space invariant at higher tiers. Browser repaint decisions still vary.
- CSS layout: `css-layout` uses CSS zoom; layout and containing-block behavior differ from transform.
- Native layout: `css-resize` changes actual dimensions continuously; excellent for vector-root SVG and full-resolution images when content is responsive, potentially expensive on text-heavy DOM.
- SVG: native group transforms or native viewBox manipulate live vector geometry.
- Embedded SVG: when the outer React viewport owns camera sizing, `SVGViewport` preserves its ownership and renders its viewBox using the SVG element's *own* CSS box size; camera world-to-pixel scale must remain correct even when the SVG is smaller than the viewport.
- Raster images: no mode creates information beyond the source. Use responsive high-resolution sources with `ZoomPort.Image`.
- Canvas 2D: DPR-aware backing store; original primitives repainted under the camera.
- WebGL/WebGPU: user-owned tile/image sampling and LOD. `writeWebGLMatrix(camera, viewport, reusedFloat32Array)` supplies the correct top-left-Y-down world-to-clip projection without per-frame allocations.

Never mislabel `image-rendering: pixelated` or `crisp-edges` as antialiasing improvements. These choose resampling styles, not missing detail recovery.

## Browser acceptance matrix — not executed yet

Browsers: Chrome, Firefox, Safari; desktop trackpad and wheel; iOS Safari and Android Chrome pinch; DPR 1, 1.5, 2, 3; scales 0.25, 0.75, 1, 1.25, 2, 4, 8, 16.

Fixtures: SVG strokes and tight curves, subpixel joins, text at fractional zoom, masks/filters, embedded SVG `<img>`, photo with exact native pixels, zoom beyond intrinsic photo resolution, CSS-transform raster layers, nested/scrolling DOM, viewport resize, orientation change.

Capture: transformed point error; reference-image RMSE/SSIM; layer count and GPU texture memory; layout/repaint cost; image URL changes and decode duration; wheel input latency; touch-action pointer cancellation; nested wheel propagation; controlled-state animation echo; keyboard focus; reduced-motion behavior; lifecycle StrictMode mount/unmount.

## Performance interpretation

The synthetic 60/120/144 Hz benchmark is **camera CPU work only**. It does not establish user-visible frames/sec, browser paint quality, or a superiority claim over third-party libraries. For published performance comparisons pin baseline and candidate versions, warm up, randomize run order, measure browser traces and device configuration, and report distributions and confidence intervals.

## Remaining release gates

Cross-browser visual parity and pinch input automation; React 18 and 19 compatibility matrix; screenshot regression artifacts; source provider decode/crossfade; hysteresis on image resolution tier changes; WCAG keyboard and focus audits; npm namespace availability and publishing ownership; correct packaging across bundlers and Node native ESM.
