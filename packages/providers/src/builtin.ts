import type { ProviderPlugin } from "@miragari/core"
import { googleProvider } from "./google/index.js"
import { happyhorseProvider } from "./happyhorse/index.js"
import { openaiProvider } from "./openai/index.js"
import { qwenProvider } from "./qwen/index.js"
import { volcengineProvider } from "./volcengine/index.js"

export const builtinProviderPlugins = {
  openai: openaiProvider,
  google: googleProvider,
  qwen: qwenProvider,
  happyhorse: happyhorseProvider,
  volcengine: volcengineProvider,
} satisfies Record<string, ProviderPlugin>
