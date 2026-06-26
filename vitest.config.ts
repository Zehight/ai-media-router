import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@media-router/core": root("./packages/core/src/index.ts"),
      "@media-router/client": root("./packages/client/src/index.ts"),
      "@media-router/providers": root("./packages/providers/src/index.ts"),
    },
  },
})
