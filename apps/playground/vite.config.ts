import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

/**
 * A repository Pages deployment lives under /zoomport/. Keep local dev rooted
 * at /, and let the build accept an explicit base for custom-domain hosting.
 */
const base = process.env.ZOOMPORT_PUBLIC_BASE ?? "/"

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 4411 },
  build: {
    outDir: "../../dist-playground",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        fixture: resolve(import.meta.dirname, "fixture.html"),
        vanilla: resolve(import.meta.dirname, "vanilla.html"),
        culling: resolve(import.meta.dirname, "culling.html"),
      },
    },
  },
})
