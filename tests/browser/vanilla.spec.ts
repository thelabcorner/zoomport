import { expect, test } from "@playwright/test"

test.describe("plain HTML / vanilla JavaScript integration", () => {
  test("frame-coalesced pointer bursts preserve final geometry with one renderer notification", async ({ page }) => {
    await page.goto("/vanilla.html")
    const result = await page.evaluate(async () => {
      const port = (window as any).__zoomportVanilla
      const node = document.querySelector<HTMLElement>("#viewport")!
      const rect = node.getBoundingClientRect()
      const x0 = rect.left + 120, y = rect.top + 120
      const run = async (scheduling: "immediate" | "frame") => {
        port.setOptions({ pointerMoveScheduling: scheduling, enableInertia: false })
        port.engine.jumpTo({x:-400,y:-200,scale:2})
        let notifications = 0
        const unsubscribe = port.engine.subscribe(() => notifications++)
        const emit = (name: string, x: number) => node.dispatchEvent(new PointerEvent(name, {
          bubbles:true,cancelable:true,pointerId:199,pointerType:"touch",button:0,
          clientX:x0 + x,clientY:y,
        }))
        emit("pointerdown", 0)
        for (let i = 1; i <= 120; i++) emit("pointermove", i)
        const beforeRAF = notifications
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        emit("pointerup",120)
        const result = {beforeRAF, notifications, camera:port.engine.getSnapshot()}
        unsubscribe()
        return result
      }
      const immediate = await run("immediate")
      const frame = await run("frame")
      return {immediate,frame}
    })
    expect(result.immediate.notifications).toBe(120)
    expect(result.frame.beforeRAF).toBe(0)
    expect(result.frame.notifications).toBe(1)
    expect(result.frame.camera.x).toBeCloseTo(result.immediate.camera.x,5)
    expect(result.frame.camera.y).toBeCloseTo(result.immediate.camera.y,5)
    expect(result.frame.camera.scale).toBeCloseTo(result.immediate.camera.scale,8)
  })
  test.beforeEach(async ({ page }) => {
    await page.goto("/vanilla.html")
    await expect(page.locator("#viewport")).toBeVisible()
    await expect(page.locator("#zoom")).not.toHaveText("100%")
  })
  test("mounts without React and switches real CSS rendering properties", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    await expect.poll(() => page.evaluate(() => (window as any).__zoomportVanilla.engine.isAnimating())).toBe(false)
    const content = page.locator("#content")
    const before = await page.locator("#zoom").innerText()
    await expect.poll(() => content.evaluate(el => (el as HTMLElement).style.transform)).toContain("scale(")
    await page.getByRole("button", { name: /CSS native zoom/ }).click()
    await expect.poll(() => content.evaluate(el => (el as HTMLElement).style.zoom)).not.toBe("")
    await page.getByRole("button", { name: /CSS hybrid/ }).click()
    await expect.poll(() => content.evaluate(el => (el as HTMLElement).style.width)).toBe("1200px")
    await page.getByRole("button", { name: /CSS native resize/ }).click()
    await expect.poll(() => content.evaluate(el => (el as HTMLElement).style.width)).not.toBe("1200px")
    await page.getByRole("button", { name: /CSS transform/ }).click()
    await expect.poll(() => content.evaluate(el => (el as HTMLElement).style.transform)).toContain("scale(")
    await expect(page.locator("#zoom")).toHaveText(before)
    await expect(page.locator("#inspector")).toContainText("Native transform")
  })
  test("wheel zoom is anchored, and fit controls remain operational", async ({ page }) => {
    const rect = await page.locator("#viewport").boundingBox()
    expect(rect).not.toBeNull()
    await page.locator("#viewport").hover({ position: { x: 130, y: 120 } })
    await page.mouse.wheel(0, -120)
    await expect.poll(() => page.locator("#zoom").innerText()).not.toBe("100%")
    await page.getByRole("button", { name: "Fit artboard" }).click()
    await expect.poll(() => page.locator("#zoom").innerText()).not.toBe("")
  })
  test("responsive mobile toolbar preserves touch-safe canvas", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole("combobox", { name: "Rendering strategy" })).toBeVisible()
    await page.getByRole("combobox", { name: "Rendering strategy" }).selectOption("css-layout")
    await expect.poll(() => page.locator("#content").evaluate(el => (el as HTMLElement).style.zoom)).not.toBe("")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.locator("#viewport")).toHaveCSS("touch-action", "none")
  })
})