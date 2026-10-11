import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
export default defineConfig({
  resolve: { alias: {
    "@zoomport/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    "@zoomport/react": fileURLToPath(new URL("./packages/react/src/index.tsx", import.meta.url)),
    "@zoomport/dom/adapters": fileURLToPath(new URL("./packages/dom/src/adapters.ts", import.meta.url)),
    "@zoomport/dom/input": fileURLToPath(new URL("./packages/dom/src/input.ts", import.meta.url)),
    "@zoomport/dom": fileURLToPath(new URL("./packages/dom/src/index.ts", import.meta.url)),
    "@zoomport/effect": fileURLToPath(new URL("./packages/effect/src/index.ts", import.meta.url)),
  }},
  test: { environment: "jsdom", include: ["packages/**/*.test.ts", "packages/**/*.test.tsx"], testTimeout: 10000 },
})
