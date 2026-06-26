import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@miragari/ai-media-router-core": root("./packages/core/src/index.ts"),
      "@miragari/ai-media-router-client": root("./packages/client/src/index.ts"),
      "@miragari/ai-media-router": root("./packages/providers/src/index.ts"),
    },
  },
})
