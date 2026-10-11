import { defineConfig } from "@playwright/test"
import { existsSync } from "node:fs"

const localChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe"
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  workers: 2,
  retries: 0,
  reporter: "list",
  outputDir: "./test-results/browser",
  use: {
    baseURL: "http://127.0.0.1:4411",
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: (process.env.CI || process.env.ZOOMPORT_ALL_BROWSERS
    ? ["chromium", "firefox", "webkit"] as const : ["chromium"] as const).map(name => ({
    name,
    use: {
      browserName: name,
      launchOptions: name === "chromium" && process.platform === "win32" && existsSync(localChrome)
        ? { executablePath: localChrome } : {},
    },
  })),
  webServer: {
    command: "npm run dev -w @zoomport/playground -- --host 127.0.0.1 --port 4411 --strictPort",
    url: "http://127.0.0.1:4411/fixture.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
