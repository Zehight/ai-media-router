# MediaRouter

MediaRouter is a TypeScript-first SDK for normalizing image and video generation providers behind one stateless interface.

## Current scope

- SDK only. No hosted gateway or server runtime in v1.
- Stateless async jobs. Users persist `GenerationJob` handles themselves.
- Public image/video parameters stay stable; provider-specific knobs go into `providerOptions`.
- Providers are contributed as plugins. Simple JSON providers can use `defineHttpProvider`; complex providers can implement the driver lifecycle directly.
- Users pass `width` and `height`; provider plugins map them to provider-specific size, ratio, and resolution fields.
- Image providers can declare `count.strategy: "split"` when native batch counts are limited. By default any split child failure fails the batch; `options.partialFailure: "return-successful"` returns successful assets plus failed child metadata.

## Packages

- `@media-router/core`: shared protocol, provider plugin definitions, dimensions, errors, and validation.
- `@media-router/client`: `MediaRouter` SDK, registry, wait/poll, image count splitting.
- `@media-router/providers`: built-in OpenAI, Google, and Volcengine Ark provider plugins.

## Example

```ts
import { MediaRouter } from "@media-router/client"
import { builtinProviderPlugins } from "@media-router/providers"

const client = new MediaRouter({
  plugins: builtinProviderPlugins,
  providers: {
    openaiProxy: {
      plugin: "openai",
      baseURL: "https://my-proxy.example.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
    },
    geminiProxy: {
      plugin: "google",
      baseURL: "https://my-gemini-proxy.example.com/v3/chat/gc",
      apiKey: process.env.GEMINI_PROXY_API_KEY,
      auth: { type: "bearer" },
      options: {
        apiVersionPath: "v1beta",
        generationMethod: "streamGenerateContent",
      },
    },
  },
})

const result = await client.generateImage({
  provider: "openaiProxy",
  model: "gpt-image-1",
  input: { prompt: "a clean product render of a white desk lamp" },
  options: { width: 1024, height: 1024, count: 1 },
})
```
