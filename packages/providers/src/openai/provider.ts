import {
  createMediaRouterError,
  type MediaRouterError,
} from "@media-router/core"
import {
  completed,
  defineHttpProvider,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  stripUndefined,
} from "../http.js"
import {
  assetFromUrl,
  assetsFromImageData,
  isVideoRequest,
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
  models: openaiModels,
  statusMap: openaiStatusMap,
  create: {
    request: {
      method: "POST",
      path: (context) =>
        isVideoRequest(context)
          ? "/videos"
          : "/images/generations",
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
        if (isVideoRequest(context)) {
          return stripUndefined({
            model: context.request.model,
            prompt: context.request.input.prompt,
            size: dimensions?.size,
            seconds: options?.duration,
            ...context.request.providerOptions,
          })
        }
        return stripUndefined({
          model: context.request.model,
          prompt: context.request.input.prompt,
          n: options?.count ?? 1,
          size: dimensions?.size,
          quality: options?.quality,
          response_format: "url",
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
    output: (response, context, helpers) => {
      const status = helpers.statusFrom(response.status, { context })
      const videoUrl = response.output?.video_url ?? response.output?.url
      return polledJob({
        context,
        status,
        assets:
          status === "succeeded" && videoUrl
            ? assetFromUrl("video", videoUrl, "video/mp4")
            : undefined,
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
