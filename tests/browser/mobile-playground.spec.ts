import { expect, test } from "@playwright/test"

test.describe("responsive demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
  })

  test("fits the vector canvas into a narrow viewport without horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("button", { name: "Vector canvas" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Image gallery" })).toBeVisible()
    await expect.poll(async () => Number((await page.locator(".zoom-readout").innerText()).replace("%", ""))).toBeLessThan(100)
    const viewport = await page.locator(".viewport").boundingBox()
    expect(viewport).not.toBeNull()
    expect(viewport!.width).toBeGreaterThan(320)
    expect(viewport!.height).toBeGreaterThan(420)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await testInfo.attach("mobile-canvas.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    })
  })

  test("switches renderers and scenes, then fills the screen immersively", async ({ page }, testInfo) => {
    await page.getByRole("button", { name: "Image gallery" }).click()
    await expect(page.getByRole("combobox", { name: "Rendering strategy" })).toHaveValue("css-resize")
    const image = page.locator(".viewport img")
    await expect(image).toHaveJSProperty("naturalWidth", 1280)
    await page.getByRole("combobox", { name: "Rendering strategy" }).selectOption("css-hybrid")
    await expect(page.locator(".viewport .gallery-image")).toBeVisible()
    await page.getByRole("button", { name: "Open immersive viewport" }).click()
    const bounds = await page.locator(".canvas-shell").boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBe(390)
    expect(bounds!.height).toBe(844)
    await testInfo.attach("mobile-immersive.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    })
    await page.getByRole("button", { name: "Close immersive viewport" }).click()
    await expect(page.locator(".canvas-shell")).not.toHaveClass(/is-expanded/)
  })
})

test("Chromium touch pinch magnifies the actual mobile playground", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "CDP touch injection is Chromium-specific")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect.poll(async () => {
    const t = await page.locator(".zoom-readout").innerText()
    return Number(t.replace("%", ""))
  }).toBeLessThan(100)
  const before = Number((await page.locator(".zoom-readout").innerText()).replace("%", ""))
  const box = await page.locator(".viewport").boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 35, y: cy, id: 1 }, { x: cx + 35, y: cy, id: 2 }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 95, y: cy, id: 1 }, { x: cx + 95, y: cy, id: 2 }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect.poll(async () => Number((await page.locator(".zoom-readout").innerText()).replace("%", ""))).toBeGreaterThan(before)
})