import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

const script = readFileSync(fileURLToPath(new URL("../packages/dom/dist/zoomport.global.js", import.meta.url)), "utf8")
const scope = {}
runInNewContext(script, scope, { timeout: 3000 })
assert.equal(typeof scope.ZoomPort?.mountZoomPort, "function")
assert.equal(typeof scope.ZoomPort?.CameraController, "function")
assert.equal(typeof scope.ZoomPort?.connectSVGViewBox, "function")
assert.equal(typeof scope.ZoomPort?.bindViewport, "function")
const controller = new scope.ZoomPort.CameraController({ initial: { x: 3, y: 5, scale: 2 } })
assert.equal(controller.getSnapshot().scale, 2)
controller.destroy()
console.log(`Vanilla global IIFE smoke passed (${Buffer.byteLength(script)} bytes uncompressed, no DOM globals needed for import)`)