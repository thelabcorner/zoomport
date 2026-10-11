# @zoomport/dom

Framework-free, headless pan/zoom viewport controller with native DOM, SVG, and Canvas rendering.

```sh
npm install @zoomport/dom
```

```html
<div id="viewport" style="height:500px;position:relative;overflow:hidden">
  <div id="content" style="width:1200px;height:800px;position:absolute;transform-origin:0 0">
    <img src="/art.svg" width="1200" height="800" alt="Artwork">
  </div>
</div>
<script type="module">
  import { mountZoomPort } from "@zoomport/dom"
  const port = mountZoomPort({
    viewport: document.querySelector("#viewport"),
    content: document.querySelector("#content"),
    wheelMode: "zoom",
    renderer: "css-transform",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
  })
  port.fit(undefined, 32)
  // Call port.dispose() when unmounting this view.
</script>
```

Use any ESM-capable bundler or an import map to resolve the package name. With no bundler, use an ESM CDN after publication, or import a locally built ESM bundle. Native browsers do not resolve npm package specifiers on their own.

### No bundler, no modules, no dependencies

The package also builds `dist/zoomport.global.js` as a self-contained IIFE.
It exposes `window.ZoomPort` in ordinary HTML, including older script-tag
integrations. No React, Effect, import map, or bundler is required **at runtime**.

```html
<script src="/vendor/zoomport.global.js"></script>
<script>
  const port = ZoomPort.mountZoomPort({
    viewport: document.getElementById("viewport"),
    content: document.getElementById("content")
  })
</script>
```

Copy the distribution file from the installed npm package (or load it from
a trusted CDN after publication). The normal ESM build remains independently
tree-shakeable.

Switch CSS renderers using `port.setRenderer("css-hybrid")` with an intrinsic `css.size` to enable resolution stepping. Use `connectSVG`, `connectSVGViewBox`, `connectCanvas2D` directly for custom scenes, or supply an SVG/canvas surface to `mountZoomPort`. The same `CameraController` is used in React and vanilla applications.