import {
  completed,
  defineHttpProvider,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  stripUndefined,
} from "../http.js"
import {
  assertNoUnusedMediaInputs,
  assetFromUrl,
  collectMediaInputs,
  type CollectedMediaInput,
  describeMediaInput,
  getImageInputs,
  mediaInputToInlineBase64,
  requirePrompt,
  unsupportedAction,
  unsupportedInput,
} from "../toolkit.js"
import {
  createMediaRouterError,
  type MediaInput,
  type MediaRouterError,
  type ProviderCreateContext,
} from "@miragari/ai-media-router-core"
import { qwenModels, qwenStatusMap } from "./definition.js"

type QwenContentItem = { text: string } | { image: string }

type QwenResponse = {
  output?: {
    task_id?: string
    task_status?: string
    video_url?: string
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string
        }>
      }
    }>
    results?: Array<{
      url?: string
      image?: string
    }>
  }
  code?: string
  message?: string
  request_id?: string
}

type QwenProviderOptions = Record<string, unknown>

export const qwenProvider = defineHttpProvider<QwenResponse>({
  id: "qwen",
  displayName: "Qwen and Wan",
  baseURL: "https://dashscope.aliyuncs.com/api/v1",
  auth: { type: "bearer" },
  defaultModels: {
    image: "qwen-image-2.0-pro",
    video: "wan2.7",
  },
  models: qwenModels,
  statusMap: qwenStatusMap,
  create: {
    request: {
      method: "POST",
      path: (context) =>
        context.request.type === "video"
          ? "/services/aigc/video-generation/video-synthesis"
          : context.model.async
          ? "/services/aigc/text2image/image-synthesis"
          : "/services/aigc/multimodal-generation/generation",
      headers: (context) =>
        context.model.async || context.request.type === "video"
          ? { "X-DashScope-Async": "enable" }
          : {},
      body: (context) =>
        context.request.type === "video"
          ? videoBody(context)
          : context.model.async
            ? asyncImageBody(context)
            : syncImageBody(context),
    },
    output: (response, context, helpers) => {
      if (context.model.async || context.request.type === "video") {
        return pendingProviderJob({
          context,
          providerJobId: response.output?.task_id,
          status: response.output?.task_status
            ? pendingStatus(
                helpers.statusFrom(response.output.task_status, { context }),
                "queued",
              )
            : "queued",
          raw: response,
          pollAfterMs: 10_000,
        })
      }

      return completed({
        context,
        assets: qwenAssets(response, "image"),
        raw: response,
      })
    },
  },
  poll: {
    request: {
      method: "GET",
      path: (context) => `/tasks/${context.job.providerJobId}`,
    },
    output: (response, context, helpers) => {
      const status = helpers.statusFrom(response.output?.task_status, { context })
      return polledJob({
        context,
        status,
        assets:
          status === "succeeded"
            ? qwenAssets(response, context.job.type === "video" ? "video" : "image")
            : undefined,
        error:
          status === "failed"
            ? qwenJobError(response, context.job.provider, context.job.model)
            : undefined,
        raw: response,
      })
    },
  },
})

function syncImageBody(context: ProviderCreateContext) {
  const images = getImageInputs(context.request)
  const action = context.request.action
  if (action && action !== "generate" && action !== "reference" && action !== "edit") {
    unsupportedAction(context)
  }
  if ((action === "reference" || action === "edit") && !images.length) {
    unsupportedInput(context, "input.images", `${action} action requires images`)
  }
  if (!supportsImageInputs(context.request.model) && images.length) {
    unsupportedInput(context, "input.images", "model does not support reference images")
  }
  assertNoUnusedMediaInputs(context, images.length ? ["referenceImage"] : [])

  const content: QwenContentItem[] = [
    ...images.map((image) => ({ image: qwenImageInput(context, image) })),
    { text: requirePrompt(context) },
  ]

  return {
    model: context.request.model,
    input: {
      messages: [
        {
          role: "user",
          content,
        },
      ],
    },
    parameters: qwenParameters(context),
  }
}

function videoBody(context: ProviderCreateContext) {
  const action = context.request.action
  if (action && action !== "generate" && action !== "reference" && action !== "continue") {
    unsupportedAction(context)
  }
  const media = qwenVideoMedia(context)
  if ((action === "reference" || action === "continue") && !media.length) {
    unsupportedInput(context, "input.image", `${action} action requires media input`)
  }
  assertNoUnusedMediaInputs(context, media.map((item) => item.role))
  const providerModel = media.length ? "wan2.7-i2v" : "wan2.7-t2v"

  const input = context.request.input as {
    negativePrompt?: string
  }
  return {
    model: providerModel,
    input: stripUndefined({
      prompt: requirePrompt(context),
      negative_prompt: input.negativePrompt,
      media: media.length
        ? media.map((item) => ({
            type: qwenVideoMediaType(item),
            url: qwenVideoMediaUrl(context, item),
          }))
        : undefined,
    }),
    parameters: qwenVideoParameters(context),
  }
}

function asyncImageBody(context: ProviderCreateContext) {
  if (context.request.action && context.request.action !== "generate") {
    unsupportedAction(context)
  }
  assertNoUnusedMediaInputs(context, [])
  return {
    model: context.request.model,
    input: {
      prompt: requirePrompt(context),
    },
    parameters: qwenParameters(context),
  }
}

function qwenParameters(context: ProviderCreateContext) {
  const dimensions = context.resolved.dimensions
  const options = context.request.options as
    | {
        count?: number
        seed?: number
      }
    | undefined
  const input = context.request.input as {
    negativePrompt?: string
  }
  const providerOptions = (context.request.providerOptions ?? {}) as QwenProviderOptions
  const width = dimensions?.fmtWidth ?? dimensions?.width
  const height = dimensions?.fmtHeight ?? dimensions?.height

  return stripUndefined({
    n: options?.count,
    negative_prompt: input.negativePrompt,
    size: width && height ? `${width}*${height}` : dimensions?.providerSize,
    seed: options?.seed,
    ...providerOptions,
  })
}

function qwenVideoParameters(context: ProviderCreateContext) {
  const dimensions = context.resolved.dimensions
  const options = context.request.options as
    | {
        duration?: number
        seed?: number
      }
    | undefined
  return stripUndefined({
    resolution: dimensions?.resolutionTier?.toUpperCase(),
    duration: options?.duration,
    seed: options?.seed,
    ...context.request.providerOptions,
  })
}

function qwenImageInput(
  context: ProviderCreateContext,
  input: MediaInput,
): string {
  const inline = mediaInputToInlineBase64(input)
  if (inline) return `data:${inline.mimeType};base64,${inline.data}`

  const described = describeMediaInput(input)
  if (described.kind === "url") return described.url
  unsupportedInput(context, "input.images", `unsupported media kind: ${described.kind}`)
}

function qwenAssets(response: QwenResponse, type: "image" | "video") {
  if (type === "video") {
    return assetFromUrl("video", response.output?.video_url, "video/mp4")
  }
  const choiceImages =
    response.output?.choices?.flatMap((choice) =>
      choice.message?.content?.flatMap((item) => (item.image ? [item.image] : [])) ?? [],
    ) ?? []
  const resultImages =
    response.output?.results?.flatMap((item) => item.url ?? item.image ?? []) ?? []
  return [...choiceImages, ...resultImages].flatMap((url) =>
    assetFromUrl("image", url, "image/png"),
  )
}

function qwenVideoMedia(context: ProviderCreateContext): CollectedMediaInput[] {
  const media = collectMediaInputs(context.request).filter((item) =>
    ["image", "firstFrame", "lastFrame", "referenceImage", "video", "audio"].includes(item.role),
  )
  const normalized: CollectedMediaInput[] = []
  const firstImage = media.find((item) => item.role === "image" || item.role === "firstFrame")
    ?? media.find((item) => item.role === "referenceImage" && item.index === 0)
  const lastImage = media.find((item) => item.role === "lastFrame")
    ?? media.find((item) => item.role === "referenceImage" && item.index === 1)
  const video = media.find((item) => item.role === "video")
  const audio = media.find((item) => item.role === "audio")

  if (video && firstImage) {
    unsupportedInput(context, "input.video", "cannot combine input.video with first-frame images")
  }
  if (video) normalized.push(video)
  if (firstImage) normalized.push(firstImage)
  if (lastImage) normalized.push(lastImage)
  if (audio) normalized.push(audio)

  const unsupported = media.filter((item) => !normalized.includes(item))
  if (unsupported.length) {
    unsupportedInput(
      context,
      unsupported.map((item) => `input.${item.role}`).join(", "),
      "unsupported video media combination",
    )
  }
  return normalized
}

function qwenVideoMediaType(item: CollectedMediaInput): string {
  if (item.role === "video") return "first_clip"
  if (item.role === "audio") return "driving_audio"
  if (item.role === "lastFrame" || (item.role === "referenceImage" && item.index === 1)) {
    return "last_frame"
  }
  return "first_frame"
}

function qwenVideoMediaUrl(
  context: ProviderCreateContext,
  item: CollectedMediaInput,
): string {
  if (item.role === "image" || item.role === "firstFrame" || item.role === "lastFrame" || item.role === "referenceImage") {
    return qwenImageInput(context, item.input)
  }
  const described = describeMediaInput(item.input)
  if (described.kind === "url") return described.url
  unsupportedInput(context, `input.${item.role}`, `unsupported media kind: ${described.kind}`)
}

function qwenJobError(
  response: QwenResponse,
  provider: string,
  model: string,
): MediaRouterError {
  return createMediaRouterError(
    "PROVIDER_ERROR",
    response.message ?? response.code ?? "Qwen image task failed",
    { provider, model, raw: response },
  )
}

function supportsImageInputs(model: string): boolean {
  return (
    model.startsWith("qwen-image-2.0") ||
    model.startsWith("qwen-image-edit")
  )
}
