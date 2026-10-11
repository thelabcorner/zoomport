import { build } from "esbuild"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const modulePath = resolve(root, "node_modules/.cache/zoomport-vector-export.mjs")
const outputPath = resolve(root, "apps/playground/public/vector-scene.svg")

await mkdir(dirname(modulePath), { recursive: true })
try {
  await build({
    entryPoints: [resolve(root, "apps/playground/src/scenes.tsx")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: modulePath,
    logLevel: "silent",
  })

  const { VectorScene } = await import(pathToFileURL(modulePath).href)
  const svg = renderToStaticMarkup(createElement(VectorScene))
  if (!svg.startsWith("<svg ") || !svg.includes('viewBox="0 0 1280 820"')) {
    throw new Error("Vector scene did not render the expected SVG artwork")
  }
  await writeFile(outputPath, `${svg}\n`, "utf8")
  console.log(`Exported ${outputPath}`)
} finally {
  await rm(modulePath, { force: true })
}
