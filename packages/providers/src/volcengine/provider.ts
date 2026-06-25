import {
  completed,
  defineHttpProvider,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  stripUndefined,
} from "../http.js"
import {
  appendPromptFlags,
  assetFromUrl,
  assetsFromImageData,
  describeMediaInput,
  firstDefined,
  firstImageInput,
  isVideoRequest,
  mediaInputToInlineBase64,
} from "../toolkit.js"
import {
  createMediaRouterError,
  type MediaInput,
  type MediaRouterError,
} from "@media-router/core"
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

export const volcengineProvider = defineHttpProvider<ArkResponse, ArkTaskResponse>({
  id: "volcengine",
  displayName: "Volcengine Ark",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  auth: { type: "bearer" },
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
              cameraFixed?: boolean
              outputFormat?: string
            }
          | undefined
        if (isVideoRequest(context)) {
          const text = appendPromptFlags(context.request.input.prompt, {
            ratio: dimensions?.aspectRatio,
            resolution: dimensions?.resolutionTier,
            duration: options?.duration,
            camerafixed: options?.cameraFixed,
          })

          return stripUndefined({
            model: context.request.model,
            content: [{ type: "text", text }],
            seed: options?.seed,
            generate_audio: options?.audioEnabled,
            ...context.request.providerOptions,
          })
        }

        const firstImage = firstImageInput(context.request)
        return stripUndefined({
          model: context.request.model,
          prompt: context.request.input.prompt,
          image: firstImage ? arkImageValue(firstImage) : undefined,
          size: firstDefined(dimensions?.size, dimensions?.resolutionTier),
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
