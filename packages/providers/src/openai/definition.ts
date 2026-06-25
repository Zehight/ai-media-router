import type { GenerationStatus, ModelDefinition } from "@media-router/core"

export const openaiModels: Record<string, ModelDefinition> = {
  "gpt-image-1": {
    id: "gpt-image-1",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        image: {
          sizeFormat: "x",
          supportedSizes: ["1024x1024", "1536x1024", "1024x1536"],
        },
      },
      count: { supported: true, max: 4, strategy: "native" },
    },
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        image: {
          sizeFormat: "x",
          supportedSizes: ["1024x1024", "1536x1024", "1024x1536"],
        },
      },
      count: { supported: true, max: 4, strategy: "native" },
    },
  },
  "sora-2": {
    id: "sora-2",
    type: "video",
    modes: ["text-to-video", "image-to-video"],
    async: true,
    capabilities: {
      dimensions: {
        aspectRatios: ["16:9", "9:16", "1:1"],
        video: { resolutions: ["720p", "1080p"] },
      },
    },
  },
}

export const openaiStatusMap: Record<string, GenerationStatus> = {
  queued: "queued",
  in_progress: "running",
  processing: "running",
  completed: "succeeded",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
}
