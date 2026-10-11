# @zoomport/react

Headless, composable React 18/19 pan and zoom primitives built on @zoomport/core.

```tsx
import { ZoomPort } from "@zoomport/react"

<ZoomPort.Root minScale={0.25} maxScale={16} wheelMode="zoom">
  <ZoomPort.Viewport aria-label="Artwork viewport" style={{ height: 480 }}>
    <ZoomPort.Content renderMode="css-transform">
      <img src="/art.svg" alt="Artwork" />
    </ZoomPort.Content>
  </ZoomPort.Viewport>
</ZoomPort.Root>
```

Rendering strategies: `css-transform`, `css-hybrid`, `css-layout`, `css-resize`, native `SVGContent` and `SVGViewport`, `Image` with resolution-aware source selection, Canvas 2D, and custom adapters.

`useZoomPort()` gives imperative controls without frame renders; `useCamera()` opts in to camera subscriptions. Styles are application-owned.

**Pre-release.** Verify production visual quality on your browser/device matrix. MIT.
