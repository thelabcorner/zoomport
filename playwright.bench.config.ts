import { defineConfig } from "@playwright/test"
import base from "./playwright.config.js"

export default defineConfig({
  ...base,
  testDir: "./bench/browser",
  workers: 1,
  timeout: 180_000,
  projects: base.projects?.filter(project => project.name === "chromium"),
})
