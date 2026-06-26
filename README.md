# MediaRouter

MediaRouter is a TypeScript-first SDK for normalizing media generation providers behind one stateless interface.

## Current scope

- SDK only. No hosted gateway or server runtime in v1.
- Stateless async jobs. Users persist `GenerationJob` handles themselves.
- Public image, video, audio, and model3d parameters stay stable; provider-specific knobs go into `providerOptions`.
- Providers are contributed as plugins. Simple JSON providers can use `defineHttpProvider`; complex providers can implement the driver lifecycle directly.
- Users pass `width` and `height`; provider plugins map them to provider-specific size, ratio, and resolution fields.
- Image providers can declare `count.strategy: "split"` when native batch counts are limited. By default any split child failure fails the batch; `RunOptions.partialFailure: "return-successful"` returns successful assets plus failed child metadata. Nested `RunOptions.batch` remains available when callers want to group batch controls explicitly.

## Packages

- `@miragari/core`: shared protocol, provider plugin definitions, dimensions, errors, and validation.
- `@miragari/client`: `MediaRouter` SDK, registry, wait/poll, image count splitting.
- `@miragari/providers`: built-in OpenAI, Google, Qwen/Wan, HappyHorse, and Volcengine Ark provider plugins.

## Example

Use `createMediaRouter()` from `@miragari/providers` when you want the
built-in providers preinstalled. Provider entries can omit `plugin` when the
provider key matches the built-in plugin key, such as `openai` or `qwen`.
For built-in provider keys, the provider config can be just the API key string,
or omitted entirely when a common API key environment variable is present.
Built-in provider configs can be passed directly at the top level, such as
`createMediaRouter({ openai: process.env.OPENAI_API_KEY })`; use nested
`providers` for aliases, proxies, or when you want to override top-level
provider-key shortcuts explicitly.
Recognized keys include `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`,
`DASHSCOPE_API_KEY`, `QWEN_API_KEY`, `FAL_KEY`, `FAL_API_KEY`,
`ARK_API_KEY`, and `VOLCENGINE_API_KEY`.
When you select one built-in provider, pass top-level `apiKey` instead of a
nested provider config.
Top-level `apiKey` belongs to the top-level built-in `provider` shortcut. Use
explicit `providers` for aliases, proxies, multiple providers, or
`defaults.provider` overrides.
If multiple provider keys are present, pass `createMediaRouter("openai")`,
`createMediaRouter(["openai"])`, `provider: "openai"`, or
`providers: ["openai"]` so the router does not choose a paid provider
implicitly.
The string shortcut and top-level `provider` also set the global default
provider; the array shortcut and `providers: ["openai"]` only limit which
built-in providers are enabled.
When `providers` is omitted, a top-level built-in `provider` also selects the
matching environment-backed provider.
Profile-level providers do not remove this zero-config ambiguity; they only
apply when that profile is used.
`MediaRouter` infers media defaults from configured provider `defaultModels`.
Use top-level `provider` and `model` for global defaults, top-level
`profiles` for named presets, top-level `image`, `video`, `audio`, and
`model3d` for per-media defaults, and `defaults` only for nested or advanced
default maps.
Per-media defaults can be just a model string, such as
`image: "gpt-image-1"`, when no other media-specific defaults are needed.
Inside a top-level media slot, fields other than `provider`, `model`, `options`,
and `providerOptions` are treated as `options` shorthand. Profiles follow the
same rule, with `type` and `action` also reserved.
Media inputs, including repeated fields such as `images`, `videos`, and
`audios`, accept URL strings or local path strings; local paths are normalized
to file inputs before providers see the request. Image requests can use
`image` for the common single-reference case; it is normalized into the
provider-facing `input.images` list.
Generation results expose `asset` as the primary output (`assets[0]`) for the
common single-output case; use `assets` when the provider returns multiple
outputs.
Profile values can be full preset objects or just a media type string, such as
`thumbnail: "image"`.
The string profile shorthand applies to top-level `profiles`; object profile
shorthand works in both top-level `profiles` and nested `defaults.profiles`.
Top-level `provider`, `model`, `profiles`, and media slots are defaults
shortcuts; explicit `defaults` fields still take precedence when they overlap.
For one-off changes, pass the same default shortcuts in `RunOptions` to
override router defaults for that call without creating another client. Nested
`RunOptions.defaults` remains available for advanced maps and overrides the
shortcut fields when both are present.
Use `RunOptions.profile` for a one-shot profile binding when creating a
profile facade would be unnecessary.
Provider plugins can declare `defaultModels` to control this inference without
adding provider-specific logic to the router shell.
Custom aliases such as `geminiProxy` should keep `plugin` explicit.

```ts
import { createMediaRouter } from "@miragari/providers"

const client = createMediaRouter("openai")

const result = await client.generateImage(
  "a clean product render of a white desk lamp",
)

console.log(result.asset?.url)
```

```ts
const client = createMediaRouter({
  openai: process.env.OPENAI_API_KEY,
})
```

For aliases, proxies, or profile-specific defaults, pass only the overrides:

```ts
import { createMediaRouter } from "@miragari/providers"

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}

const client = createMediaRouter({
  provider: "openai",
  profiles: {
    thumbnail: "image",
    hdImage: {
      type: "image",
      width: 1024,
      height: 1024,
      quality: "high",
    },
    shortVideo: {
      type: "video",
      provider: "qwen",
      model: "wan2.7",
      options: { duration: 5 },
    },
  },
  image: {
    quality: "high",
  },
  providers: {
    openai: requiredEnv("OPENAI_API_KEY"),
    geminiProxy: {
      plugin: "google",
      baseURL: "https://my-gemini-proxy.example.com/v3/chat/gc",
      apiKey: requiredEnv("GEMINI_PROXY_API_KEY"),
      auth: { type: "bearer" },
      options: {
        apiVersionPath: "v1beta",
        generationMethod: "streamGenerateContent",
      },
    },
    qwen: requiredEnv("DASHSCOPE_API_KEY"),
    happyhorse: requiredEnv("FAL_KEY"),
  },
})

const result = await client.generateImage(
  "a clean product render of a white desk lamp",
)

const hdImage = client.profile("hdImage")
const hdResult = await hdImage.generateImage(
  "a clean product render of a white desk lamp",
)

const oneShot = await client.generateImage(
  "a clean product render of a white desk lamp",
  { profile: "hdImage" },
)

const draft = await client.generateImage(
  "a clean product render of a white desk lamp",
  { image: { quality: "draft" } },
)

const edited = await client.generateImage({
  prompt: "make this product photo cleaner",
  image: "./lamp.png",
})

const video = await client.profile("shortVideo").generateVideo({
  prompt: "a slow orbit shot of this product on a studio table",
  media: "./lamp.png",
})
```
