# @zoomport/core

Framework-independent world-space camera engine for deterministic pan/zoom, cursor anchoring, log-scale animation and inertia.

```ts
import { CameraController } from "@zoomport/core"

const engine = new CameraController({ minScale: 0.1, maxScale: 32 })
engine.setViewport(1200, 800)
engine.zoomAt(2, { x: 450, y: 320 })
const unsubscribe = engine.subscribe((camera) => console.log(camera))
// Dispose subscriptions and scheduler when done:
unsubscribe()
engine.destroy()
```

See the ZoomPort monorepo README for renderer integration and full options. Browser-wide visual fidelity is still being evaluated. MIT.
