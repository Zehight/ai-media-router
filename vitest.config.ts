import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@miragari/core": root("./packages/core/src/index.ts"),
      "@miragari/client": root("./packages/client/src/index.ts"),
      "@miragari/providers": root("./packages/providers/src/index.ts"),
    },
  },
})
