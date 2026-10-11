# ZoomPort Playground · Style Guide

## Purpose and visual direction

The playground is an engineering workbench, not a marketing mockup. Every rendered element should clarify how ZoomPort works, expose real functionality, or make scene manipulation easier.

The design follows the refined, information-dense layout of the ForgePrint playground: neutral light surfaces, New York-style compact controls, Inter/system sans typography, architectural hairlines, and an explicit examples / canvas / inspector hierarchy. ZoomPort adds one deliberate brand accent: **#AAFF00**.

## Color and hierarchy

| Token | Value | Role |
| --- | --- | --- |
| Brand accent | `#AAFF00` | Logo, active render affordances, artwork key element |
| Primary ink | `#18181b` | Body and headings |
| Secondary ink | `#71717a` | Explanations and metadata |
| Hairline | `#e4e4e7` | Pane separation and control borders |
| Base | `#fafafa` | Page and auxiliary panels |
| Paper | `#ffffff` | Workspace and controls |
| Inset | `#f4f4f5` | Subtle chrome |
| Scene black | `#20231f` | Actual editable-like visual demo world |

Lime should **never** be used for long text, indicators on white without sufficient dark contrast, decorative shadows, or broad page sections. It marks active behavior, not generic success. Real status indicators use distinguishable shape/text alongside color. Keep the surface light-only; don't introduce a dark UI theme in demos without a product requirement.

## Density, typography and layout

- Use Inter with system sans fallbacks. UI text is typically 10–13px; panel section labels 11px; headings 24–32px.
- Use 4px spacing increments with intentional 6/10/14px offsets. Keep control height around 29–32px on desktop and at least 40px for critical phone touch controls.
- Use a 54px desktop topbar and 42–43px workbench headers; align labels and controls to one baseline.
- Preserve a three-column hierarchy on desktop: scene and renderer choices / camera viewport / actual pipeline inspector.
- On tablets, turn the left selector into horizontal scrollable actions. On phones, stack the inspector beneath the viewport, retain a clear top renderer selector, and offer an immersive viewport.
- Panels use 1px borders rather than stacked cards and shadows. Floating camera HUD may use one restrained functional shadow.
- Text hierarchy comes from weight and value contrast, not all-caps, oversized tracking, artificial monospace labels, gradients, or flashy illustration.

## Interaction contract

1. The renderer selector **must change the underlying adapter**. A label-only switch is a defect.
2. Maintain the shared camera state when switching renderer within the same scene; preserve cursor/gesture math.
3. The world-space SVG geometry is intrinsic 1280 × 820; do not force a native nested SVG to inherit the host CSS viewport size. Responsive SVG is allowed for CSS hybrid/resize modes, where its resized parent owns physical dimensions.
4. Only expose meaningful renderers for the chosen scene. The image gallery supports the four DOM/image renderers; the vector scene supports all seven pipelines.
5. The right inspector must sample actual DOM/SVG/Canvas state, not reproduce inferred values as proof. Sample only at a bounded cadence, independently of React commits.
6. Changing the drawing pipeline is distinct from changing the source content. The CSS gallery SVG is an image source; the editor-like vector canvas uses native SVG geometry or Canvas primitives.
7. The demo must not promise universal anti-aliasing or photographic superresolution. Raster resolution depends on input assets and resampling.
8. Reduced-motion, semantic labels, keyboard access, pointer capture lifecycle, responsive tap targets and real mobile pinch behavior are required.

## Proof before claims

- Test each renderer's genuine native output, e.g. `style.transform`, `style.zoom`, width/height, SVG transform, `viewBox`, or Canvas backing buffer and pixels.
- Verify SVG world geometry remains coherent in native viewBox mode.
- Verify CSS hybrid layer tiers actually change in the browser at high zoom.
- Test editor/gallery selection, fullscreen, camera state preservation, touch pinch, and viewport overflow at phone dimensions.
- Validate in Chromium, Firefox and WebKit. Desktop browser emulation does not certify physical iOS Safari or Android GPU behavior.
- Do not add fabricated performance scores, customer proof, external network requirements, or mock inspector telemetry.

## Code placement

The demo is deliberately separated from the published headless library:

- `apps/playground/src/main.tsx`: workbench chrome, public controls, runtime inspector and adapter selection.
- `apps/playground/src/scenes.tsx`: world-space SVG and Canvas demo artwork.
- `apps/playground/src/styles.css`: desktop and shared visual language.
- `apps/playground/src/mobile.css`: responsive refinements, fullscreen and mobile controls.
- `tests/browser/renderer-switch.spec.ts`: renderer contract certification.

Do not ship these application styles with `@zoomport/react` or `@zoomport/core`. All UI must remain replaceable by consumers.
