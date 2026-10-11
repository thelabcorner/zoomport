import { expect, test } from "@playwright/test"

test.describe("100K world-space scene performance demo", () => {
  test("actually changes draw work across indexed, overview and naive pipelines", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto("/culling.html")
    await expect(page.locator("#viewport")).toBeVisible()
    const lab = () => page.evaluate(() => {
      const l = (window as any).__zoomportLab
      return { count:l.index.size,draws:l.stats.draws, candidates:l.stats.candidates,
        lod:l.stats.lod,queryCount:l.stats.queries }
    })
    await expect.poll(async()=> (await lab()).count).toBe(100000)
    await expect.poll(async()=> (await lab()).lod).toBe("overview")
    const atFit = await lab()
    expect(atFit.draws).toBeGreaterThan(0)
    expect(atFit.draws).toBeLessThan(1000)
    await page.getByRole("button", { name: /Indexed culling only/ }).click()
    await page.evaluate(() => (window as any).__zoomportLab.port.engine.jumpTo({x:-1400,y:-1100,scale:1}))
    await expect.poll(async()=> (await lab()).lod).toBe("individual")
    const indexed = await lab()
    expect(indexed.candidates).toBeGreaterThan(1)
    expect(indexed.candidates).toBeLessThan(1000)
    await page.getByRole("button", { name: /Naive full-scene loop/ }).click()
    await expect.poll(async()=> (await lab()).draws).toBe(100000)
    const naive = await lab()
    expect(naive.draws).toBe(100000)
    expect(indexed.draws).toBeLessThan(naive.draws)
    await page.getByRole("button", { name: /Adaptive index/ }).click()
    await expect.poll(async()=> (await lab()).draws).toBeLessThan(1000)
    expect(errors).toEqual([])
  })
  test("mobile selectors and world navigation preserve viewport bounds", async ({ page }) => {
    await page.setViewportSize({width:390,height:844})
    await page.goto("/culling.html")
    await expect(page.locator("#mode-mobile")).toBeVisible()
    await expect.poll(async () => page.evaluate(() => (window as any).__zoomportLab.index.size)).toBe(100000)
    await page.locator("#mode-mobile").selectOption("indexed")
    await expect.poll(async () => page.evaluate(() => (window as any).__zoomportLab.stats.lod)).toBe("individual")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.locator("#viewport")).toHaveCSS("touch-action","none")
    await page.getByRole("button",{name:"Fit world"}).click()
    await expect.poll(() => page.locator("#zoom").innerText()).not.toBe("")
  })
})
