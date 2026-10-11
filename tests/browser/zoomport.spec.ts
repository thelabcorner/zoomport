import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"

type Camera = {x: number; y: number; scale: number}
type BrowserFixture = Window & {
  __zoomportFixture?: {
    getSnapshot(): Camera
    jumpTo(next: Camera): void
  }
}
async function fixture(page: import("@playwright/test").Page, mode = "svg-viewbox") {
  await page.goto("/fixture.html?mode=" + mode)
  await page.waitForFunction(() => Boolean((window as BrowserFixture).__zoomportFixture))
}
function magentaBounds(buffer: Buffer) {
  const png = PNG.sync.read(buffer)
  let left = png.width, top = png.height, right = -1, bottom = -1, count = 0
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      if (png.data[i]! < 150 || png.data[i+1]! > 45 || png.data[i+2]! < 150 || png.data[i+3]! < 250) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      count++
    }
  return { left, top, right, bottom, count }
}
for (const mode of ["css-transform", "css-hybrid", "css-layout", "css-resize", "svg-transform", "svg-viewbox", "canvas2d"]) {
  test(mode + " renders camera geometry at native browser pixels", async ({page}, testInfo) => {
    await fixture(page, mode)
    await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.jumpTo({ x:35, y:20, scale:1.6 }))
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const png = await page.getByTestId("viewport").screenshot()
    await testInfo.attach(mode + ".png", {body: png, contentType:"image/png"})
    const bounds = magentaBounds(png)
    expect(bounds.count).toBeGreaterThan(2800)
    expect(Math.abs((bounds.left + bounds.right) / 2 - 355)).toBeLessThan(2)
    expect(Math.abs((bounds.top + bounds.bottom) / 2 - 260)).toBeLessThan(2)
    expect(Math.abs((bounds.right - bounds.left + 1) - 64)).toBeLessThan(3)
    expect(Math.abs((bounds.bottom - bounds.top + 1) - 64)).toBeLessThan(3)
  })
}
test("actual wheel retains world point under cursor", async ({page}) => {
  await fixture(page)
  const before = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  await page.mouse.move(240, 180)
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot().scale)).toBeGreaterThan(1)
  const after = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  const worldX = (240 - before.x) / before.scale
  const worldY = (180 - before.y) / before.scale
  expect((240 - after.x) / after.scale).toBeCloseTo(worldX, 5)
  expect((180 - after.y) / after.scale).toBeCloseTo(worldY, 5)
})
test("real pointer drag pans without unexpected momentum under reduced motion", async ({page}) => {
  await fixture(page)
  await page.mouse.move(100, 100)
  await page.mouse.down()
  await page.mouse.move(160, 130, {steps: 3})
  await page.mouse.up()
  const after = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  expect(after.x).toBeCloseTo(60, 1)
  expect(after.y).toBeCloseTo(30, 1)
})
test("keyboard pan and zoom operate on the focusable viewport", async ({page}) => {
  await fixture(page)
  await page.getByTestId("viewport").focus()
  await page.keyboard.press("ArrowRight")
  let camera = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  expect(camera.x).toBe(-48)
  await page.keyboard.press("Shift+Equal")
  camera = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  expect(camera.scale).toBeCloseTo(1.2, 5)
})
test("wheel anchoring stays correct inside a CSS-scaled host viewport", async ({page}) => {
  await fixture(page)
  await page.getByTestId("viewport").evaluate((node) => {
    node.style.transformOrigin = "top left"
    node.style.transform = "scale(0.8)"
  })
  const bounds = await page.getByTestId("viewport").boundingBox()
  expect(bounds).not.toBeNull()
  const world = {x:180,y:150}
  await page.mouse.move(bounds!.x + world.x * 0.8, bounds!.y + world.y * 0.8)
  await page.mouse.wheel(0,-100)
  await expect.poll(async () => page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot().scale)).toBeGreaterThan(1)
  const c = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  expect((world.x - c.x) / c.scale).toBeCloseTo(world.x, 5)
  expect((world.y - c.y) / c.scale).toBeCloseTo(world.y, 5)
})
test("Chrome multitouch CDP events produce a true pinch gesture", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "CDP touch injection is Chromium-specific")
  await fixture(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setTouchEmulationEnabled", {enabled:true,maxTouchPoints:2})
  const start = [{x:180,y:170,id:1},{x:260,y:170,id:2}]
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:start})
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:140,y:170,id:1},{x:300,y:170,id:2}]})
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]})
  const after = await page.evaluate(() => (window as BrowserFixture).__zoomportFixture!.getSnapshot())
  expect(after.scale).toBeGreaterThan(1.5)
})
