import {
  createMediaRouterError,
  defineProvider,
  type GenerationJob,
  type MediaInput,
  type MediaRouterError,
  type ProviderCancelContext,
  type ProviderCreateContext,
  type ProviderPollContext,
} from "@miragari/core"
import {
  assetFromUrl,
  collectMediaInputs,
  describeMediaInput,
  mediaInputToInlineBase64,
  requirePrompt,
  unsupportedAction,
  unsupportedInput,
} from "../toolkit.js"
import {
  pendingProviderJob,
  polledJob,
  stripUndefined,
} from "../http.js"
import {
  assertNoUnusedMediaInputs,
  getImageInputs,
} from "../toolkit.js"
import { happyhorseModels } from "./definition.js"

type FalSubmitResponse = {
  request_id?: string
  response_url?: string
  status_url?: string
  cancel_url?: string
  queue_position?: number
}

type FalStatusResponse = {
  request_id?: string
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | string
  response_url?: string
  error?: string
  error_type?: string
}

type FalResultResponse = {
  video?: {
    url?: string
    content_type?: string
    width?: number
    height?: number
    duration?: number
  }
  seed?: number
}

type HappyHorseProviderState = {
  endpoint?: HappyHorseEndpoint
  responseUrl?: string
  statusUrl?: string
  cancelUrl?: string
}

type HappyHorseEndpoint =
  | "alibaba/happy-horse/text-to-video"
  | "alibaba/happy-horse/reference-to-video"
  | "alibaba/happy-horse/video-edit"

export const happyhorseProvider = defineProvider({
  id: "happyhorse",
  displayName: "HappyHorse",
  baseURL: "https://queue.fal.run",
  auth: { type: "none" },
  defaultModels: {
    video: "happy-horse",
  },
  models: happyhorseModels,
  driver: {
    async create(context) {
      const endpoint = resolveHappyHorseEndpoint(context)
      const response = await falJson<FalSubmitResponse>(
        context,
        falEndpointUrl(context, endpoint),
        {
          method: "POST",
          body: happyHorseBody(context, endpoint),
        },
      )
      return pendingProviderJob({
        context,
        providerJobId: response.request_id,
        providerState: {
          endpoint,
          responseUrl: response.response_url,
          statusUrl: response.status_url,
          cancelUrl: response.cancel_url,
        },
        status: "queued",
        raw: response,
        pollAfterMs: 5000,
      })
    },
    async poll(context) {
      const state = context.job.providerState as HappyHorseProviderState | undefined
      const status = await falJson<FalStatusResponse>(
        context,
        state?.statusUrl ?? falRequestUrl(context, state?.endpoint, "status"),
        { method: "GET" },
      )

      if (status.status === "COMPLETED" && status.error) {
        return polledJob({
          context,
          status: "failed",
          error: falJobError(status, context.job.provider, context.job.model),
          raw: status,
        })
      }

      if (status.status !== "COMPLETED") {
        return polledJob({
          context,
          status: status.status === "IN_PROGRESS" ? "running" : "queued",
          raw: status,
        })
      }

      const result = await falJson<FalResultResponse>(
        context,
        status.response_url ?? state?.responseUrl ?? falRequestUrl(context, state?.endpoint, "response"),
        { method: "GET" },
      )
      return polledJob({
        context,
        status: "succeeded",
        assets: falVideoAssets(result),
        raw: result,
      })
    },
    async cancel(context) {
      const state = context.job.providerState as HappyHorseProviderState | undefined
      await falJson<unknown>(
        context,
        state?.cancelUrl ?? falRequestUrl(context, state?.endpoint, "cancel"),
        { method: "PUT" },
      )
    },
    normalizeError(error, { request, job, runtime }) {
      return falError(error, runtime.provider, request?.model ?? job?.model)
    },
  },
})

function happyHorseBody(
  context: ProviderCreateContext,
  endpoint: HappyHorseEndpoint,
): Record<string, unknown> {
  switch (endpoint) {
    case "alibaba/happy-horse/text-to-video":
      return textToVideoBody(context)
    case "alibaba/happy-horse/reference-to-video":
      return referenceToVideoBody(context)
    case "alibaba/happy-horse/video-edit":
      return videoEditBody(context)
    default:
      throw createMediaRouterError("BAD_REQUEST", `Unsupported HappyHorse endpoint: ${endpoint}`, {
        provider: context.provider,
        model: context.request.model,
      })
  }
}

function resolveHappyHorseEndpoint(context: ProviderCreateContext): HappyHorseEndpoint {
  const media = collectMediaInputs(context.request)
  const hasVideo = media.some((item) => item.role === "video")
  const imageCount = getImageInputs(context.request).length

  switch (context.request.action) {
    case undefined:
    case "generate":
      if (hasVideo) return "alibaba/happy-horse/video-edit"
      if (imageCount > 0) return "alibaba/happy-horse/reference-to-video"
      return "alibaba/happy-horse/text-to-video"
    case "reference":
      if (hasVideo) {
        unsupportedInput(context, "input.video", "reference action does not consume source video")
      }
      return "alibaba/happy-horse/reference-to-video"
    case "edit":
      return "alibaba/happy-horse/video-edit"
    default:
      unsupportedAction(context)
  }
}

function textToVideoBody(context: ProviderCreateContext): Record<string, unknown> {
  assertNoUnusedMediaInputs(context, [])
  return stripUndefined({
    prompt: requirePrompt(context),
    ...commonVideoOptions(context),
  })
}

function referenceToVideoBody(context: ProviderCreateContext): Record<string, unknown> {
  const images = getImageInputs(context.request)
  if (!images.length) {
    unsupportedInput(context, "input.images", "reference action requires images")
  }
  if (images.length > 9) {
    unsupportedInput(context, "input.images", "HappyHorse reference-to-video supports up to 9 images")
  }
  assertNoUnusedMediaInputs(context, ["image", "firstFrame", "referenceImage"])
  return stripUndefined({
    prompt: requirePrompt(context),
    image_urls: images.map((image) => happyHorseImageUrl(context, image, "input.images")),
    ...commonVideoOptions(context),
  })
}

function videoEditBody(context: ProviderCreateContext): Record<string, unknown> {
  const media = collectMediaInputs(context.request)
  const video = media.find((item) => item.role === "video")?.input
  if (!video) {
    unsupportedInput(context, "input.video", "edit action requires a source video")
  }
  const images = media.filter((item) => item.role === "referenceImage").map((item) => item.input)
  if (images.length > 5) {
    unsupportedInput(context, "input.images", "HappyHorse video edit supports up to 5 reference images")
  }
  assertNoUnusedMediaInputs(context, ["video", "referenceImage"])
  return stripUndefined({
    video_url: happyHorseUrl(context, video, "input.video"),
    prompt: requirePrompt(context),
    reference_image_urls: images.length
      ? images.map((image) => happyHorseImageUrl(context, image, "input.images"))
      : undefined,
    resolution: context.resolved.dimensions?.resolutionTier,
    seed: (context.request.options as { seed?: number } | undefined)?.seed,
    ...context.request.providerOptions,
  })
}

function commonVideoOptions(
  context: ProviderCreateContext,
  options: { aspectRatio?: boolean } = {},
) {
  const requestOptions = context.request.options as
    | { duration?: number; seed?: number }
    | undefined
  return stripUndefined({
    aspect_ratio: options.aspectRatio === false
      ? undefined
      : context.resolved.dimensions?.aspectRatio,
    resolution: context.resolved.dimensions?.resolutionTier,
    duration: requestOptions?.duration,
    seed: requestOptions?.seed,
    ...context.request.providerOptions,
  })
}

function happyHorseImageUrl(
  context: ProviderCreateContext,
  input: MediaInput,
  inputPath: string,
): string {
  const inline = mediaInputToInlineBase64(input)
  if (inline) return `data:${inline.mimeType};base64,${inline.data}`
  return happyHorseUrl(context, input, inputPath)
}

function happyHorseUrl(
  context: ProviderCreateContext,
  input: MediaInput,
  inputPath: string,
): string {
  const described = describeMediaInput(input)
  if (described.kind === "url") return described.url
  unsupportedInput(context, inputPath, `unsupported media kind: ${described.kind}`)
}

function falVideoAssets(result: FalResultResponse) {
  return assetFromUrl(
    "video",
    result.video?.url,
    result.video?.content_type ?? "video/mp4",
  ).map((asset) => ({
    ...asset,
    width: result.video?.width,
    height: result.video?.height,
    duration: result.video?.duration,
    metadata: { seed: result.seed },
  }))
}

function falEndpointUrl(context: ProviderCreateContext, endpoint: string): string {
  const baseURL = context.config.baseURL ?? context.plugin.baseURL ?? "https://queue.fal.run"
  return `${baseURL.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`
}

function falRequestUrl(
  context: ProviderPollContext | ProviderCancelContext,
  endpoint: HappyHorseEndpoint | undefined,
  suffix: string,
): string {
  if (!endpoint) {
    throw createMediaRouterError("PROVIDER_ERROR", "HappyHorse job is missing endpoint state", {
      provider: context.provider,
      model: context.job.model,
      raw: context.job,
    })
  }
  const baseURL = context.config.baseURL ?? context.plugin.baseURL ?? "https://queue.fal.run"
  return `${baseURL.replace(/\/$/, "")}/${endpoint}/requests/${context.job.providerJobId}/${suffix}`
}

async function falJson<T>(
  context: ProviderCreateContext | ProviderPollContext | ProviderCancelContext,
  url: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown },
): Promise<T> {
  const response = await context.fetch(url, {
    method: init.method,
    headers: {
      ...falAuthHeaders(context),
      ...(init.body == null ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body == null ? undefined : JSON.stringify(init.body),
  })
  const text = await response.text()
  const raw = text.trim() ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = falErrorMessage(raw) ?? `Provider request failed with status ${response.status}`
    throw createMediaRouterError(response.status === 401 || response.status === 403 ? "AUTH_ERROR" : "PROVIDER_ERROR", message, {
      provider: context.provider,
      statusCode: response.status,
      raw,
      retryable: response.status === 429 || response.status >= 500,
    })
  }
  return raw as T
}

function falAuthHeaders(
  context: ProviderCreateContext | ProviderPollContext | ProviderCancelContext,
): Record<string, string> {
  return {
    ...(context.config.headers ?? {}),
    ...(context.config.apiKey ? { Authorization: `Key ${context.config.apiKey}` } : {}),
  }
}

function falJobError(
  response: FalStatusResponse,
  provider: string,
  model: string,
): MediaRouterError {
  return createMediaRouterError(
    "PROVIDER_ERROR",
    response.error ?? response.error_type ?? "HappyHorse request failed",
    { provider, model, raw: response },
  )
}

function falError(error: unknown, provider: string, model?: string): MediaRouterError {
  if (error && typeof error === "object" && "__mediaRouterError" in error) {
    return error as unknown as MediaRouterError
  }
  return createMediaRouterError("PROVIDER_ERROR", "HappyHorse provider error", {
    provider,
    model,
    raw: error,
  })
}

function falErrorMessage(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined
  if ("detail" in raw && typeof raw.detail === "string") return raw.detail
  if ("error" in raw && typeof raw.error === "string") return raw.error
  if ("message" in raw && typeof raw.message === "string") return raw.message
  return undefined
}
