import {
  createMediaRouterError,
  type MediaRouterError,
  type MediaInput,
  type ProviderCreateContext,
  type ProviderPollContext,
} from "@media-router/core"
import {
  authHeaders,
  completed,
  defineHttpProvider,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  providerUrl,
  stripUndefined,
} from "../http.js"
import {
  assertNoUnusedMediaInputs,
  assetFromUrl,
  assetsFromImageData,
  collectMediaInputs,
  describeMediaInput,
  isVideoRequest,
  mediaInputToInlineBase64,
  requirePrompt,
  unsupportedAction,
  unsupportedInput,
} from "../toolkit.js"
import { openaiModels, openaiStatusMap } from "./definition.js"

type OpenAIImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
}

type OpenAIVideoResponse = {
  id: string
  status: string
  output?: { video_url?: string; url?: string }
  error?: { message?: string }
}

type OpenAIResponse = OpenAIImageResponse | OpenAIVideoResponse

export const openaiProvider = defineHttpProvider<OpenAIResponse, OpenAIVideoResponse>({
  id: "openai",
  displayName: "OpenAI",
  baseURL: "https://api.openai.com/v1",
  auth: { type: "bearer" },
  defaultModels: {
    image: "gpt-image-1",
    video: "sora-2",
  },
  models: openaiModels,
  statusMap: openaiStatusMap,
  create: {
    request: {
      method: "POST",
      path: (context) => {
        if (isVideoRequest(context)) return "/videos"
        return hasImageEditInputs(context) ? "/images/edits" : "/images/generations"
      },
      body: (context) => {
        const dimensions = context.resolved.dimensions
        const options = context.request.options as
          | {
              count?: number
              duration?: number
              quality?: string
              outputFormat?: string
            }
          | undefined
        if (
          context.request.action &&
          context.request.action !== "generate" &&
          context.request.action !== "reference" &&
          context.request.action !== "edit"
        ) {
          unsupportedAction(context)
        }
        if (isVideoRequest(context)) {
          if (context.request.action === "reference" || context.request.action === "edit") {
            unsupportedAction(context)
          }
          assertNoUnusedMediaInputs(context, [])
          return stripUndefined({
            model: context.request.model,
            prompt: requirePrompt(context),
            size: dimensions?.size,
            seconds: options?.duration,
            ...context.request.providerOptions,
          })
        }
        if (hasImageEditInputs(context)) {
          return openaiImageEditBody(context)
        }
        if (context.request.action === "reference" || context.request.action === "edit") {
          unsupportedInput(context, "input.images", `${context.request.action} action requires images`)
        }
        assertNoUnusedMediaInputs(context, [])
        return stripUndefined({
          model: context.request.model,
          prompt: requirePrompt(context),
          n: options?.count ?? 1,
          size: dimensions?.size,
          quality: options?.quality,
          output_format: options?.outputFormat,
          ...context.request.providerOptions,
        })
      },
    },
    output: (response, context, helpers) => {
      if (isVideoRequest(context)) {
        const video = response as OpenAIVideoResponse
        return pendingProviderJob({
          context,
          providerJobId: video.id,
          status: video.status
            ? pendingStatus(helpers.statusFrom(video.status, { context }), "running")
            : "queued",
          raw: response,
          pollAfterMs: 5000,
        })
      }

      const image = response as OpenAIImageResponse
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
      path: (context) => `/videos/${context.job.providerJobId}`,
    },
    output: async (response, context, helpers) => {
      const status = helpers.statusFrom(response.status, { context })
      const videoUrl = response.output?.video_url ?? response.output?.url
      const downloadedVideo =
        status === "succeeded" && !videoUrl
          ? await downloadVideoContent(context)
          : undefined
      return polledJob({
        context,
        status,
        assets:
          status === "succeeded" && videoUrl
            ? assetFromUrl("video", videoUrl, "video/mp4")
            : downloadedVideo,
        error:
          status === "failed"
            ? openaiJobError(response, context.job.provider, context.job.model)
            : undefined,
        raw: response,
      })
    },
  },
  cancel: {
    request: {
      method: "POST",
      path: (context) => `/videos/${context.job.providerJobId}/cancel`,
    },
  },
})

function openaiImageEditBody(context: ProviderCreateContext) {
  const options = context.request.options as
    | {
        count?: number
        quality?: string
        outputFormat?: string
      }
    | undefined
  const media = collectMediaInputs(context.request)
  const images = media.filter((item) => item.role === "referenceImage")
  const mask = media.find((item) => item.role === "mask")
  if (!images.length) {
    unsupportedInput(context, "input.images", "image edit requires at least one source image")
  }
  if (images.length > 16) {
    unsupportedInput(context, "input.images", "OpenAI image edits support up to 16 source images")
  }
  assertNoUnusedMediaInputs(context, ["referenceImage", "mask"])
  return stripUndefined({
    model: context.request.model,
    prompt: requirePrompt(context),
    images: images.map((item) => openaiImageReference(context, item.input, "input.images")),
    mask: mask ? openaiImageReference(context, mask.input, "input.mask") : undefined,
    n: options?.count ?? 1,
    size: context.resolved.dimensions?.size,
    quality: options?.quality,
    output_format: options?.outputFormat,
    ...context.request.providerOptions,
  })
}

function openaiImageReference(
  context: ProviderCreateContext,
  input: MediaInput,
  inputPath: string,
) {
  const inline = mediaInputToInlineBase64(input)
  if (inline) return { image_url: `data:${inline.mimeType};base64,${inline.data}` }
  const described = describeMediaInput(input)
  if (described.kind === "url") return { image_url: described.url }
  unsupportedInput(context, inputPath, `unsupported media kind: ${described.kind}`)
}

function hasImageEditInputs(context: ProviderCreateContext): boolean {
  if (isVideoRequest(context)) return false
  const media = collectMediaInputs(context.request)
  return media.some((item) => item.role === "referenceImage" || item.role === "mask")
}

async function downloadVideoContent(context: ProviderPollContext) {
  const url = providerUrl(context, `/videos/${context.job.providerJobId}/content`)
  const response = await context.fetch(url, {
    method: "GET",
    headers: authHeaders(context),
  })
  if (!response.ok) return undefined
  const contentType = response.headers.get("content-type") ?? "video/mp4"
  return [
    {
      type: "video" as const,
      base64: arrayBufferToBase64(await response.arrayBuffer()),
      mimeType: contentType,
    },
  ]
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function openaiJobError(
  response: OpenAIVideoResponse,
  provider: string,
  model: string,
): MediaRouterError {
  return createMediaRouterError(
    "PROVIDER_ERROR",
    response.error?.message ?? "OpenAI generation failed",
    {
      provider,
      model,
      raw: response,
    },
  )
}
