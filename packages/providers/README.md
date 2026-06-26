# @miragari/ai-media-router

Built-in MediaRouter providers plus the `createMediaRouter()` convenience
factory.

## Install

```bash
npm install @miragari/ai-media-router
```

## Use this package when

- you want the quickest entrypoint for app integration
- you need built-in OpenAI, Google, Qwen, HappyHorse, or Volcengine adapters
- you also want provider authoring helpers such as `defineHttpProvider()`

## Repository docs

- Root overview: <https://github.com/Zehight/ai-media-router>
- English docs: <https://github.com/Zehight/ai-media-router/blob/main/docs/en/getting-started.md>
- 中文文档: <https://github.com/Zehight/ai-media-router/blob/main/docs/zh-CN/getting-started.md>

---

# Adding a Provider

MediaRouter providers are contributed as provider plugins. A provider plugin is
the facade between MediaRouter's shared request protocol and one provider's API.
Core supplies stable types, basic validation, dimension helpers, job lifecycle,
and normalized outputs. The provider facade decides how to consume the request
and which provider endpoint to call.

Use `defineHttpProvider()` when the provider is a JSON HTTP API with a create
endpoint and optional polling endpoint. Use request-level `parseResponse`,
`parseError`, `contentType`, and `serializeBody` hooks when the provider
returns SSE, text, non-standard error bodies, form requests, multipart, or
binary payloads. Implement a custom `ProviderPlugin` driver only when the
provider needs custom signing or a non-standard task lifecycle.

By default, plain objects are sent as JSON. `URLSearchParams`, `FormData`,
`Blob`, `ArrayBuffer`, typed arrays, and strings are sent as-is with a matching
content type when one is safe to infer.

## Architecture Rules

- `context.request.action` is an opaque provider-facing intent string. The SDK
  passes it through and never validates, enumerates, or routes by it.
- `context.request.input` and `context.request.options` contain shared
  parameters for the request media type. Keep provider-specific switches in
  `providerOptions`.
- `context.resolved.dimensions` is a helper result. Providers choose which
  fields to use; core does not force a provider request shape.
- `capabilities` are metadata and coarse validation constraints. They support
  docs, UI, tests, dimensions, count splitting, and simple limits; they do not
  choose endpoints.
- Unsupported actions or unsupported standard inputs must fail explicitly. Do
  not silently drop `input.images`, `input.mask`, audio, video, or model inputs.
- Provider outputs should be built with toolkit helpers such as `completed`,
  `pendingProviderJob`, and `polledJob`. Those helpers are provider-facade
  contracts, not HTTP-only utilities.

## Implementation Flow

1. Add `definition.ts` with model `type`, `async`, `capabilities.actions`,
   dimensions, count behavior, and media-input limits.
2. Add `provider.ts` with a provider facade that maps MediaRouter requests to
   provider HTTP requests.
3. In the facade, branch by `action` and/or input shape only inside provider
   code.
4. Use provider toolkit helpers for common input, dimension, asset, job, and
   error handling.
5. Add harness tests proving request mapping, unsupported input failures,
   output normalization, and async lifecycle behavior when applicable.

## Minimal HTTP Provider

```ts
import {
  assetsFromImageData,
  completed,
  describeMediaInput,
  defineHttpProvider,
  getImageInputs,
  requirePrompt,
  unsupportedInput,
} from "@miragari/ai-media-router"

export const exampleProvider = defineHttpProvider({
  id: "example",
  displayName: "Example",
  baseURL: "https://api.example.com/v1",
  auth: { type: "bearer" },
  models: {
    "example-image": {
      id: "example-image",
      type: "image",
      async: false,
      capabilities: {
        actions: {
          generate: { consumes: ["input.prompt", "options.width", "options.height"] },
          reference: { consumes: ["input.prompt", "input.images"] },
        },
        count: { supported: true, max: 4, strategy: "native" },
      },
    },
  },
  create: {
    request: {
      method: "POST",
      path: "/images",
      body: (context) => {
        const images = getImageInputs(context.request)
        if (context.request.action === "reference" && !images.length) {
          unsupportedInput(context, "input.images", "reference action requires images")
        }

        return {
          model: context.request.model,
          prompt: requirePrompt(context),
          n: context.request.options?.count,
          size: context.resolved.dimensions?.size,
          image: images[0] ? mapExampleImage(context, images[0]) : undefined,
          ...context.request.providerOptions,
        }
      },
    },
    output: (response, context) =>
      completed({
        context,
        assets: response.data?.flatMap((item) => item.url ? [item.url] : []) ?? [],
        raw: response,
      }),
  },
})

function mapExampleImage(context, input) {
  const media = describeMediaInput(input)
  if (media.kind === "url") return media.url
  if (media.kind === "base64") {
    return { data: media.data, mime_type: media.mimeType }
  }
  unsupportedInput(context, "input.images", `unsupported media kind: ${media.kind}`)
}
```

## Provider Facade Contract

The provider driver is the facade. Core does not route by action, media inputs,
or model metadata. A provider decides how to consume the shared request
protocol:

```ts
function imageBody(context: ProviderCreateContext) {
  const images = getImageInputs(context.request)

  switch (context.request.action) {
    case "edit":
      if (!context.request.input.mask) {
        unsupportedInput(context, "input.mask", "edit action requires a mask")
      }
      return editImageBody(context)
    case "reference":
      if (!images.length) {
        unsupportedInput(context, "input.images", "reference action requires images")
      }
      return referenceImageBody(context)
    case undefined:
    case "generate":
      return generateImageBody(context)
    default:
      unsupportedAction(context)
  }
}
```

Providers may also branch by input shape instead of `action` when that is the
provider's natural facade:

```ts
if (context.request.input.mask) return editImageBody(context)
if (getImageInputs(context.request).length) return referenceImageBody(context)
return generateImageBody(context)
```

Both approaches are valid. The important rule is that the decision lives in the
provider facade, not in core metadata.

## Standard Inputs And Provider Options

Each media type has its own shared request shape:

- Image: `input.prompt`, `input.negativePrompt`, `input.images`, `input.mask`,
  `options.width`, `options.height`, `options.count`, `options.seed`,
  `options.quality`, `options.outputFormat`.
- Video: `input.prompt`, `input.image`, `input.firstFrame`, `input.lastFrame`,
  `input.images`, `input.video`, `input.videos`, `input.audio`,
  `input.audios`, `options.width`, `options.height`, `options.duration`,
  `options.fps`, `options.seed`, `options.mode`, `options.quality`,
  `options.audioEnabled`.
- Audio: `input.prompt`, `input.text`, `input.audio`, `input.audios`,
  `options.duration`, `options.seed`, `options.voice`, `options.format`,
  `options.sampleRate`.
- Model3D: `input.prompt`, `input.images`, `input.model`, `options.format`,
  `options.quality`, `options.texture`, `options.seed`.

Use `providerOptions` for everything that is provider-specific, unstable, or
not shared across providers. Examples: `watermark`, `enhancePrompt`,
`cameraFixed`, provider-native response formats, safety settings, custom
callback URLs, and provider beta flags.

Do not read SDK execution controls from the request body. `RunOptions` controls
router behavior such as `dimensionMode`, wait timeouts, and image batch
splitting. Provider request mapping should read `context.request` and
`context.resolved`.

Do not add a shared option just because one provider supports it. Add shared
fields only when they are meaningful across providers and media types.

## Dimensions

The client resolves dimensions once and passes them to providers as
`context.resolved.dimensions`.

```ts
const dimensions = context.resolved.dimensions

return {
  size: dimensions?.providerSize ?? dimensions?.size,
  width: dimensions?.fmtWidth ?? dimensions?.width,
  height: dimensions?.fmtHeight ?? dimensions?.height,
  ratio: dimensions?.aspectRatio,
  resolution: dimensions?.resolutionTier,
}
```

Dimension fields:

- `width` / `height`: normalized width and height from the request, or mapped
  provider size when `supportedSizes` or video resolution tiers are configured.
- `fmtWidth` / `fmtHeight`: fixed 16-aligned image dimensions. Providers that
  require dimensions divisible by 16 can opt into these fields.
- `size`: string form such as `1024x1024`.
- `providerSize`: provider-facing size when the dimension config maps to a
  native supported size or resolution tier.
- `aspectRatio`: nearest supported ratio such as `1:1`, `16:9`, or `9:16`.
- `resolutionTier`: image tiers use equivalent square side
  `sqrt(width * height) / 1024` and nearest `0.5K`, `1K`, `2K`, `3K`, `4K`;
  video tiers use `480p`, `720p`, `1080p`.

Provider rules:

- If the provider accepts exact `width`/`height`, use `width` and `height`.
- If the provider requires 16-aligned image dimensions, use
  `fmtWidth`/`fmtHeight`.
- If the provider accepts a size string, use `size`.
- If the provider accepts native tiers such as `2K` or `720p`, prefer
  `providerSize` or `resolutionTier`.
- If the provider has special dimension rules, keep that logic in the provider
  facade and treat these fields as helpers.

## Capabilities Metadata

Provider plugins and model definitions expose metadata plus coarse constraints:

- `type` states the model's primary output media type.
- `async` states whether the provider normally returns a task lifecycle.
- `defaultModels` lets the generic `MediaRouter` infer provider/model defaults
  so users can call typed facades with only their prompt or media input.
- `capabilities.actions` documents provider-defined action strings and which
  standard fields each facade branch consumes.
- `capabilities.dimensions.aspectRatios` controls ratio selection. With
  `RunOptions.dimensionMode: "strict"`, unmatched ratios are rejected;
  otherwise the nearest supported ratio is selected.
- `capabilities.dimensions.image.supportedSizes` controls provider size
  mapping. In nearest mode, SDK dimensions are mapped to the nearest supported
  provider size; in strict mode, unsupported sizes are rejected.
- `capabilities.dimensions.image.resolutionTiers` and
  `capabilities.dimensions.video.resolutions` bound provider tier mapping.
- `maxWidth`, `maxHeight`, `maxPixels`, `minAspectRatio`, and
  `maxAspectRatio` are enforced before provider HTTP calls. Use
  `strategy: "clamp"` only when preserving aspect ratio and scaling down to
  provider limits is acceptable.
- `capabilities.count` states native batch limits. Use `strategy: "split"`
  only when independent single-output requests are valid and safe for that
  model.
- `maxImages`, `maxVideos`, `maxAudios`, `durations`, `fps`, and
  `supportsSeed` should be set whenever the provider documents those limits.

Capabilities do not choose provider endpoints. They support docs, UI display,
basic validation, and provider conformance tests.

## Provider Toolkit

Built-in providers use the same public helpers available to external provider
PRs. Prefer these helpers before adding provider-local plumbing:

- `requestIntent()` for a provider-friendly view of normalized prompt/text,
  action, shared options, provider options, and role-collected media.
- `isImageRequest()` and `isVideoRequest()` for branching on request type.
- `collectMediaInputs()` for role-preserving input collection across prompt
  images, reference images, masks, first/last frames, video, and audio.
- `getImageInputs()`, `firstImageInput()`, `getVideoInputs()`, and
  `getAudioInputs()` for collecting normalized media inputs.
- `getModel3DInputs()` for collecting standard model input media.
- `describeMediaInput()` for inspecting URL, base64, bytes, and file
  references before mapping them into provider-specific payloads.
- `mediaInputToInlineBase64()` for providers that accept inline base64 media.
- `providerAsset()` and `providerAssets()` for filling the current media type
  onto provider asset shorthand.
- `assetsFromImageData()` and `assetFromUrl()` for provider response shapes
  that already need custom extraction.
- `appendPromptFlags()` for providers that encode generation controls as
  prompt flags.
- `requirePrompt()` for provider branches where prompt text is mandatory.
- `getProviderOption()` for reading provider-private options without adding
  them to the shared request protocol.
- `badRequest()`, `unsupportedInput()`, `unsupportedAction()`, and
  `assertNoUnusedMediaInputs()` for explicit provider facade failures.

These helpers keep built-in and contributed providers on the same path: a new
provider should usually define models, map a create request, map create/poll
responses, and rely on `providerOptions` only for provider-specific controls
that do not belong in the shared request protocol.

## Provider File Layout

Use the same layout as the built-in providers:

```text
src/<provider>/
  definition.ts      # model definitions, status maps, provider-local response types
  provider.ts        # defineHttpProvider() call and request/response mapping
  provider.test.ts   # harness tests for create, poll, errors, and edge statuses
  index.ts           # export { <provider>Provider } from "./provider.js"
```

Then wire the provider through `src/index.ts`:

```ts
export { exampleProvider } from "./example/index.js"

import { exampleProvider } from "./example/index.js"

export const builtinProviderPlugins = {
  // existing providers...
  example: exampleProvider,
}
```

Keep provider-local helpers private unless they are clearly useful to multiple
providers. If a helper would help future provider PRs, move it to `toolkit.ts`
and use it from the built-in provider too.

## Custom Response Parsing

```ts
export const streamingJsonProvider = defineHttpProvider({
  id: "streaming-json",
  displayName: "Streaming JSON",
  baseURL: "https://api.example.com/v1",
  models,
  create: {
    request: {
      path: "/generate",
      body: (context) => ({ prompt: context.request.input.prompt }),
      parseResponse: ({ text }) =>
        text
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice("data:".length).trim()))
          .at(-1),
      parseError: ({ text }) => ({ message: text }),
    },
    output: (response, context) =>
      completed({
        context,
        assets: assetFromUrl("image", response.url),
        raw: response,
      }),
  },
})
```

## Custom Body Serialization

```ts
export const formProvider = defineHttpProvider({
  id: "form-provider",
  displayName: "Form Provider",
  baseURL: "https://api.example.com/v1",
  models,
  create: {
    request: {
      path: "/generate",
      contentType: "application/x-www-form-urlencoded",
      body: (context) => ({ prompt: context.request.input.prompt }),
      serializeBody: ({ body }) =>
        new URLSearchParams(body as Record<string, string>),
    },
    output: (response, context) =>
      completed({
        context,
        assets: assetsFromImageData(response.data, context),
        raw: response,
      }),
  },
})
```

## Status Mapping

Provider-level `statusMap` is available in output helpers:

```ts
import {
  completed,
  defineHttpProvider,
  pendingProviderJob,
  pendingStatus,
  providerError,
} from "@miragari/ai-media-router"

export const taskProvider = defineHttpProvider({
  id: "task-provider",
  displayName: "Task Provider",
  baseURL: "https://api.example.com/v1",
  models,
  statusMap: {
    done: "succeeded",
    processing: "running",
    error: "failed",
  },
  unknownStatus: "throw",
  missingStatus: "throw",
  create: {
    request: { path: "/tasks", body: (context) => context.request.input },
    output: (response, context, helpers) => {
      const status = helpers.statusFrom(response.status, { context })
      if (status === "succeeded") {
        return completed({
          context,
          assets: [{ type: "image", url: response.output_url }],
          raw: response,
        })
      }
      if (status === "failed") {
        throw providerError(response.error ?? response, context.provider, context.request.model)
      }
      return pendingProviderJob({
        context,
        providerJobId: response.id,
        status: pendingStatus(status, "running"),
      })
    },
  },
})
```

`completed()` and `polledJob()` enforce terminal-state invariants by default:
`succeeded` requires at least one consumable output asset (`url` or `base64`),
and `failed` requires a normalized error. `pendingProviderJob()` only accepts
`queued` or `running`; if a create response already contains terminal output,
return `completed()` or throw a normalized provider error instead. Use
`allowEmptyResult: true` only for providers that intentionally produce no assets,
and explain that provider behavior in the PR.

For providers whose poll lifecycle needs more than a single task id, use
`providerState` on `pendingProviderJob()` and `polledJob()`:

```ts
pendingProviderJob({
  context,
  providerJobId: response.id,
  providerState: { pollPath: response.operationUrl },
})
```

Poll requests can then read `context.job.providerState` without encoding
provider-specific state into `raw`. Keep `providerState` JSON-serializable so
jobs can be persisted and resumed. `polledJob()` shallow-merges new
`providerState` values with the previous job state.

## HTTP Error Classification

`defineHttpProvider()` classifies common HTTP failures by default:

- `401` and auth-related `403` responses -> `AUTH_ERROR`
- `404` -> `NOT_FOUND`
- `429` -> `RATE_LIMITED`
- `5xx`, `429`, and common transient statuses are retryable
- safety/content-policy messages -> `CONTENT_REJECTED`
- region/location messages -> `REGION_RESTRICTED`

## Cancellation

```ts
export const cancellableProvider = defineHttpProvider({
  id: "cancellable-provider",
  displayName: "Cancellable Provider",
  baseURL: "https://api.example.com/v1",
  models,
  create,
  poll,
  cancel: {
    request: {
      method: "DELETE",
      path: (context) => `/tasks/${context.job.providerJobId}`,
    },
  },
})
```

## Provider Tests

Provider PRs should use the shared in-repo test harness to verify request
mapping and response mapping with the same runtime shape used by built-in
providers. The harness is intentionally not exported from
`@miragari/ai-media-router`; import it by relative path from provider tests.

```ts
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
} from "../test-harness.js"

const harness = createProviderHarness({
  plugin: exampleProvider,
  provider: "exampleProxy",
  responses: [jsonResponse({ id: "task_1", status: "queued" })],
})

const output = await exampleProvider.driver.create(
  harness.createContext({
    provider: "exampleProxy",
    model: "example-video",
    type: "video",
    input: { prompt: "test" },
  }),
)

expect(harness.calls[0].url).toBe("https://api.example.com/v1/tasks")
expect(jsonBody(harness.calls[0])).toMatchObject({ prompt: "test" })
harness.expectAllResponsesUsed()
```

When using a dynamic `responses` callback, assert the expected call count:

```ts
const harness = createProviderHarness({
  plugin: exampleProvider,
  responses: (call) => jsonResponse({ ok: call.url.includes("/tasks") }),
})

// ... exercise create/poll/cancel ...

harness.expectFetchCount(2)
```

At minimum, cover create URL/body/headers, result asset mapping, async poll
mapping, terminal failure mapping, HTTP error mapping, unexpected or missing
provider status, and cancellation when the provider supports it.

## PR Checklist

- Add the provider under `src/<provider>/` with `definition.ts`, `provider.ts`,
  `provider.test.ts`, and `index.ts`.
- Export one `*Provider` plugin from the provider folder and from
  `packages/providers/src/index.ts`.
- Add the plugin to `builtinProviderPlugins` only after it uses the same public
  helper path as existing built-ins.
- Define model `type`, async behavior, `capabilities.actions`, dimensions,
  count behavior, and relevant media-input limits.
- Keep model capability declarations aligned with provider documentation; do
  not rely on provider HTTP errors for known unsupported sizes, counts,
  durations, or input media counts.
- Document each provider action by the standard fields it consumes, such as
  `input.images`, `input.mask`, `options.duration`, or `providerOptions.seed`.
- Ensure unsupported actions or unsupported standard inputs fail explicitly;
  never silently drop media inputs.
- Use the provider toolkit for common media input, asset, and request-type
  mapping before adding custom local helpers.
- Preserve provider-specific controls through `providerOptions`.
- Normalize errors with `createMediaRouterError()` or `MediaRouterException`
  from `@miragari/ai-media-router-core`; do not hand-roll error objects.
- Custom `normalizeError` results that are not branded `MediaRouterError`
  values are treated as `UNKNOWN`.
- Terminal failed jobs must set `job.error` with `createMediaRouterError()`;
  provider SDK error shapes are not preserved.
- Explain any use of `allowEmptyResult`.
- Add harness tests for request mapping, result mapping, status polling, status edge cases, and error mapping.
