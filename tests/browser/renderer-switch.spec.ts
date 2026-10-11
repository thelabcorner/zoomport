import { expect, test } from "@playwright/test"

/** These tests check the browser-native operations, not merely the selector label. */
test.describe("real renderer switching", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.locator(".zoom-readout")).not.toHaveText("100%")
  })

  test("switches all seven real pipelines while preserving the camera", async ({ page }) => {
    const picker = page.getByRole("combobox", { name: "Rendering strategy" })
    const before = await page.locator(".zoom-readout").innerText()
    await expect(page.getByTestId("svg-viewbox-surface")).toHaveAttribute("viewBox", /-?\d/)
    await expect(page.getByTestId("renderer-runtime")).toContainText("viewBox:")
    await picker.selectOption("css-transform")
    const css = page.getByTestId("css-renderer")
    await expect(css).toHaveAttribute("data-zoomport-renderer", "css-transform")
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.transform)).toContain("scale(")
    await expect(page.getByTestId("svg-viewbox-surface")).toHaveCount(0)
    await picker.selectOption("css-layout")
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.zoom)).not.toBe("")
    await expect(page.getByTestId("renderer-runtime")).toContainText("zoom:")
    await picker.selectOption("css-resize")
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.width)).not.toBe("1280px")
    await expect(page.getByTestId("renderer-runtime")).toContainText("size:")
    await picker.selectOption("css-hybrid")
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.transform)).toContain("scale(")
    await picker.selectOption("svg-transform")
    await expect.poll(() => page.getByTestId("svg-transform-surface").locator("g").first().getAttribute("transform")).toMatch(/^translate\(/)
    await expect(page.getByTestId("renderer-runtime")).toContainText("transform:")
    await picker.selectOption("canvas2d")
    const canvas = page.getByTestId("canvas2d-surface")
    await expect(canvas).toBeVisible()
    await expect.poll(() => canvas.evaluate(node => (node as HTMLCanvasElement).width)).toBeGreaterThan(200)
    await expect(page.getByTestId("renderer-runtime")).toContainText("backing pixels:")
    const opaque = await canvas.evaluate(node => {
      const context = (node as HTMLCanvasElement).getContext("2d")!
      const width = (node as HTMLCanvasElement).width
      const height = (node as HTMLCanvasElement).height
      const data = context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data
      return data[3]
    })
    expect(opaque).toBeGreaterThan(0)
    await expect(page.locator(".zoom-readout")).toHaveText(before)
  })

  test("CSS hybrid actually changes backing layer tier when zoomed", async ({ page }) => {
    await page.getByRole("combobox", { name: "Rendering strategy" }).selectOption("css-hybrid")
    await page.getByRole("button", { name: "Reset to 100 percent" }).click()
    const css = page.getByTestId("css-renderer")
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.width)).toBe("1280px")
    await page.getByRole("button", { name: "Zoom in" }).click({ clickCount: 4, delay: 50 })
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.width), { timeout: 5000 }).toBe("2560px")
    await expect.poll(() => css.evaluate(node => (node as HTMLElement).style.transform)).toContain("scale(")
  })

  test("native SVG viewBox changes after zoom while the DOM remains SVG", async ({ page }) => {
    const root = page.getByTestId("svg-viewbox-surface")
    const before = await root.getAttribute("viewBox")
    await page.getByRole("button", { name: "Zoom in" }).click()
    await expect.poll(async () => root.getAttribute("viewBox")).not.toBe(before)
    await expect(root.locator("svg")).toHaveCount(1)
  })

  test("native viewBox preserves artwork world dimensions rather than stretching the inner SVG", async ({ page }) => {
    const geometry = await page.getByTestId("svg-viewbox-surface").evaluate(node => {
      const outer = node as SVGSVGElement
      const inner = outer.querySelector<SVGSVGElement>("svg.scene-svg")!
      const viewBox = outer.viewBox.baseVal
      const background = inner.querySelector('rect[width="1280"]')!
      return {
        actualWidth: background.getBoundingClientRect().width,
        expectedWidth: 1280 * outer.clientWidth / viewBox.width,
        intrinsicWidth: inner.getAttribute("width"),
      }
    })
    expect(geometry.intrinsicWidth).toBe("1280")
    expect(Math.abs(geometry.actualWidth - geometry.expectedWidth)).toBeLessThan(2)
  })

  test("gallery uses a genuine native image path, and excludes vector-only adapters", async ({ page }) => {
    await page.getByRole("button", { name: "Image gallery" }).click()
    await expect(page.getByRole("combobox", { name: "Rendering strategy" })).toHaveValue("css-resize")
    const image = page.getByTestId("native-image-surface")
    await expect(image).toHaveJSProperty("naturalWidth", 1280)
    await expect(image).toHaveAttribute("data-zoomport-renderer", "css-resize")
    await expect(page.getByRole("combobox", { name: "Rendering strategy" }).locator('option[value="svg-viewbox"]')).toHaveCount(0)
    await page.getByRole("combobox", { name: "Rendering strategy" }).selectOption("css-transform")
    await expect(page.getByTestId("css-renderer")).toBeVisible()
    await expect(page.getByTestId("native-image-surface")).toHaveCount(0)
  })

  test("inspector values and native element actually update when switching renderers", async ({ page }) => {
    await expect(page.getByTestId("active-renderer")).toHaveText("svg-viewbox")
    await expect(page.getByTestId("renderer-runtime")).toContainText("viewBox:")
    await page.getByTestId("select-css-layout").click()
    await expect(page.getByTestId("active-renderer")).toHaveText("css-layout")
    await expect(page.getByTestId("renderer-runtime")).toContainText("zoom:")
    await page.getByTestId("select-canvas2d").click()
    await expect(page.getByTestId("active-renderer")).toHaveText("canvas2d")
    await expect(page.getByTestId("renderer-runtime")).toContainText("backing pixels:")
  })

  test("inspector samples camera changes and settles on the final observed zoom", async ({ page }) => {
    await page.getByRole("combobox", { name: "Rendering strategy" }).selectOption("css-layout")
    await page.getByRole("button", { name: "Reset to 100 percent" }).click()
    await page.getByRole("button", { name: "Zoom in" }).click()
    const readout = page.locator(".zoom-readout")
    await expect(readout).toHaveText("125%")
    await expect.poll(() => page.locator(".inspector-section").first().locator(".value-row").nth(3).locator("output").innerText())
      .toBe("125.0%")
    await expect(page.getByTestId("renderer-runtime")).toContainText("zoom:")
  })
})
