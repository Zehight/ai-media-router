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
  assetsFromImageData,
  collectMediaInputs,
  describeMediaInput,
  firstDefined,
  getImageInputs,
  isVideoRequest,
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
import { volcengineModels, volcengineStatusMap } from "./definition.js"

type ArkImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
}

type ArkTaskResponse = {
  id?: string
  task_id?: string
  status?: string
  content?: {
    video_url?: string
    url?: string
  }
  output?: {
    video_url?: string
    url?: string
  }
  error?: { message?: string }
  message?: string
}

type ArkResponse = ArkImageResponse | ArkTaskResponse

type ArkContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "first_frame"; url: string }
  | { type: "last_frame"; url: string }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "audio_url"; audio_url: { url: string } }

export const volcengineProvider = defineHttpProvider<ArkResponse, ArkTaskResponse>({
  id: "volcengine",
  displayName: "Volcengine Ark",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  auth: { type: "bearer" },
  defaultModels: {
    image: "doubao-seedream-4-5-251128",
    video: "doubao-seedance-2-0-260128",
  },
  models: volcengineModels,
  statusMap: volcengineStatusMap,
  create: {
    request: {
      method: "POST",
      path: (context) =>
        isVideoRequest(context)
          ? "/contents/generations/tasks"
          : "/images/generations",
      body: (context) => {
        const dimensions = context.resolved.dimensions
        const options = context.request.options as
          | {
              duration?: number
              seed?: number
              audioEnabled?: boolean
              outputFormat?: string
            }
          | undefined
        if (
          context.request.action &&
          context.request.action !== "generate" &&
          context.request.action !== "reference"
        ) {
          unsupportedAction(context)
        }
        if (isVideoRequest(context)) {
          if (context.request.action && context.request.action !== "generate") {
            unsupportedAction(context)
          }
          const content = seedanceContent(context)

          return stripUndefined({
            model: context.request.model,
            content,
            ratio: dimensions?.aspectRatio,
            resolution: dimensions?.resolutionTier,
            duration: options?.duration,
            seed: options?.seed,
            generate_audio: options?.audioEnabled,
            ...context.request.providerOptions,
          })
        }

        const images = getImageInputs(context.request)
        if (context.request.action === "reference" && !images.length) {
          unsupportedInput(context, "input.images", "reference action requires images")
        }
        if (images.length > 1) {
          unsupportedInput(context, "input.images", "Volcengine image facade supports one reference image")
        }
        assertNoUnusedMediaInputs(context, ["referenceImage"])
        return stripUndefined({
          model: context.request.model,
          prompt: requirePrompt(context),
          image: images[0] ? arkImageValue(images[0]) : undefined,
          size: firstDefined(
            dimensions?.providerSize as string | undefined,
            dimensions?.size,
            dimensions?.resolutionTier,
          ),
          response_format: "url",
          watermark: false,
          ...context.request.providerOptions,
        })
      },
    },
    output: (response, context, helpers) => {
      if (isVideoRequest(context)) {
        const task = response as ArkTaskResponse
        return pendingProviderJob({
          context,
          providerJobId: task.id ?? task.task_id,
          status: task.status
            ? pendingStatus(helpers.statusFrom(task.status, { context }), "running")
            : "queued",
          raw: response,
          pollAfterMs: 5000,
        })
      }

      const image = response as ArkImageResponse
      return completed({
        context,
        assets: assetsFromImageData(image.data, context),
        raw: response,
      })
    },
  },
  poll: {
    request: {
      method: "GET",
      path: (context) => `/contents/generations/tasks/${context.job.providerJobId}`,
    },
    output: (response, context, helpers) => {
      const status = helpers.statusFrom(response.status, { context })
      const videoUrl =
        response.content?.video_url ??
        response.content?.url ??
        response.output?.video_url ??
        response.output?.url

      return polledJob({
        context,
        status,
        assets:
          status === "succeeded" && videoUrl
            ? assetFromUrl("video", videoUrl, "video/mp4")
            : undefined,
        error:
          status === "failed"
            ? arkJobError(response, context.job.provider, context.job.model)
            : undefined,
        raw: response,
      })
    },
  },
})

function arkImageValue(input: MediaInput): string | Record<string, string | undefined> {
  const inline = mediaInputToInlineBase64(input)
  if (inline) {
    return {
      data: inline.data,
      mime_type: inline.mimeType,
      filename: inline.filename,
    }
  }

  const described = describeMediaInput(input)
  if (described.kind === "url") return described.url
  if (described.kind === "file") {
    return {
      path: described.path,
      mime_type: described.mimeType,
    }
  }
  throw new Error(`Unsupported Volcengine image input kind: ${described.kind}`)
}

function seedanceContent(context: ProviderCreateContext): ArkContentItem[] {
  assertNoUnusedMediaInputs(context, [
    "image",
    "referenceImage",
    "firstFrame",
    "lastFrame",
    "video",
    "referenceVideo",
    "audio",
    "referenceAudio",
  ])

  const content: ArkContentItem[] = [{ type: "text", text: requirePrompt(context) }]
  const media = collectMediaInputs(context.request).filter(
    (item) => item.role !== "mask" && item.role !== "model3d",
  )
  const imageCount = media.filter((item) =>
    ["image", "referenceImage", "firstFrame", "lastFrame"].includes(item.role),
  ).length
  const videoCount = media.filter((item) =>
    ["video", "referenceVideo"].includes(item.role),
  ).length
  const audioCount = media.filter((item) =>
    ["audio", "referenceAudio"].includes(item.role),
  ).length

  if (imageCount > 9) {
    unsupportedInput(context, "input.images", "Seedance supports up to 9 image references")
  }
  if (videoCount > 3) {
    unsupportedInput(context, "input.videos", "Seedance supports up to 3 video references")
  }
  if (audioCount > 3) {
    unsupportedInput(context, "input.audios", "Seedance supports up to 3 audio references")
  }

  for (const item of media) {
    content.push(seedanceMediaContent(context, item))
  }
  return content
}

function seedanceMediaContent(
  context: ProviderCreateContext,
  item: ReturnType<typeof collectMediaInputs>[number],
): ArkContentItem {
  const { input } = item
  const inputPath = inputPathForSeedanceItem(item)
  const described = describeMediaInput(input)
  const url =
    described.kind === "url"
      ? described.url
      : described.kind === "base64"
        ? `data:${described.mimeType};base64,${described.data}`
        : described.kind === "bytes"
          ? `data:${described.mimeType};base64,${mediaInputToInlineBase64(input)?.data}`
          : undefined

  if (!url) {
    unsupportedInput(context, inputPath, "Seedance media references must be URL, base64, or bytes")
  }

  const mimeType = described.mimeType ?? ("mimeType" in input ? input.mimeType : undefined)
  if (item.role === "firstFrame" || item.role === "lastFrame") {
    if (mimeType?.startsWith("video/") || mimeType?.startsWith("audio/")) {
      unsupportedInput(context, inputPath, "frame inputs must be image references")
    }
    return item.role === "firstFrame"
      ? { type: "first_frame", url }
      : { type: "last_frame", url }
  }

  if (mimeType?.startsWith("video/")) {
    return { type: "video_url", video_url: { url } }
  }
  if (mimeType?.startsWith("audio/")) {
    return { type: "audio_url", audio_url: { url } }
  }
  if (mimeType?.startsWith("image/")) {
    return { type: "image_url", image_url: { url } }
  }

  if (inputPath.startsWith("input.video")) {
    return { type: "video_url", video_url: { url } }
  }
  if (inputPath.startsWith("input.audio")) {
    return { type: "audio_url", audio_url: { url } }
  }
  return { type: "image_url", image_url: { url } }
}

function inputPathForSeedanceItem(
  item: ReturnType<typeof collectMediaInputs>[number],
): string {
  switch (item.role) {
    case "image":
      return "input.image"
    case "referenceImage":
      return `input.images[${item.index}]`
    case "firstFrame":
      return "input.firstFrame"
    case "lastFrame":
      return "input.lastFrame"
    case "video":
      return "input.video"
    case "referenceVideo":
      return `input.videos[${item.index}]`
    case "audio":
      return "input.audio"
    case "referenceAudio":
      return `input.audios[${item.index}]`
    case "mask":
      return "input.mask"
    case "model3d":
      return "input.model"
  }
}

function arkJobError(
  response: ArkTaskResponse,
  provider: string,
  model: string,
): MediaRouterError {
  return createMediaRouterError(
    "PROVIDER_ERROR",
    response.error?.message ?? response.message ?? "Volcengine generation failed",
    {
      provider,
      model,
      raw: response,
    },
  )
}
