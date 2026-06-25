# Adding a Provider

MediaRouter providers are contributed as provider plugins.

Use `defineHttpProvider()` when the provider is a JSON HTTP API with a create
endpoint and optional polling endpoint. Use request-level `parseResponse`,
`parseError`, `contentType`, and `serializeBody` hooks when the provider
returns SSE, text, non-standard error bodies, form requests, multipart, or
binary payloads. Implement a custom `ProviderPlugin` driver only when the
provider needs custom signing or a non-standard task lifecycle.

By default, plain objects are sent as JSON. `URLSearchParams`, `FormData`,
`Blob`, `ArrayBuffer`, typed arrays, and strings are sent as-is with a matching
content type when one is safe to infer.

## Minimal HTTP Provider

```ts
import {
  assetFromUrl,
  assetsFromImageData,
  completed,
  defineHttpProvider,
} from "@media-router/providers"

export const exampleProvider = defineHttpProvider({
  id: "example",
  displayName: "Example",
  baseURL: "https://api.example.com/v1",
  auth: { type: "bearer" },
  models: {
    "example-image": {
      id: "example-image",
      type: "image",
      modes: ["text-to-image"],
      async: false,
      capabilities: {
        count: { supported: true, max: 4, strategy: "native" },
      },
    },
  },
  create: {
    request: {
      method: "POST",
      path: "/images",
      body: (context) => ({
        model: context.request.model,
        prompt: context.request.input.prompt,
        ...context.request.providerOptions,
      }),
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

## Provider Toolkit

Built-in providers use the same public helpers available to external provider
PRs. Prefer these helpers before adding provider-local plumbing:

- `isImageRequest()` and `isVideoRequest()` for branching on request type.
- `collectMediaInputs()` for role-preserving input collection across prompt
  images, reference images, masks, first/last frames, video, and audio.
- `getImageInputs()`, `firstImageInput()`, `getVideoInputs()`, and
  `getAudioInputs()` for collecting normalized media inputs.
- `describeMediaInput()` for inspecting URL, base64, bytes, and file
  references before mapping them into provider-specific payloads.
- `mediaInputToInlineBase64()` for providers that accept inline base64 media.
- `assetsFromImageData()` and `assetFromUrl()` for normalized result assets.
- `appendPromptFlags()` for providers that encode generation controls as
  prompt flags.

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
} from "@media-router/providers"

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
`@media-router/providers`; import it by relative path from provider tests.

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
- Define model `type`, `modes`, async behavior, dimensions, count behavior, and
  relevant media-input capabilities.
- Use the provider toolkit for common media input, asset, and request-type
  mapping before adding custom local helpers.
- Preserve provider-specific controls through `providerOptions`.
- Normalize errors with `createMediaRouterError()` or `MediaRouterException` from `@media-router/core`; do not hand-roll error objects.
- Custom `normalizeError` results that are not branded `MediaRouterError` values are treated as `UNKNOWN`.
- Terminal failed jobs must set `job.error` with `createMediaRouterError()`; provider SDK error shapes are not preserved.
- Explain any use of `allowEmptyResult`.
- Add harness tests for request mapping, result mapping, status polling, status edge cases, and error mapping.
