import { MediaRouter } from "@media-router/client"
import { builtinProviderPlugins } from "@media-router/providers"

const client = new MediaRouter({
  plugins: builtinProviderPlugins,
  providers: {
    openaiProxy: {
      plugin: "openai",
      baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
    },
  },
})

const result = await client.generateImage({
  provider: "openaiProxy",
  model: "gpt-image-1",
  input: {
    prompt: "a clean product render of a white desk lamp",
  },
  options: {
    width: 1024,
    height: 1024,
    count: 1,
  },
})

console.log(JSON.stringify(result, null, 2))
