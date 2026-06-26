import type { GenerationStatus, ModelDefinition } from "@media-router/core"

export const openaiModels: Record<string, ModelDefinition> = {
  "gpt-image-1": {
    id: "gpt-image-1",
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text.",
          consumes: ["input.prompt", "options.width", "options.height", "options.count"],
        },
        reference: {
          description: "Edit or generate images using prompt text and reference images.",
          consumes: ["input.prompt", "input.images", "input.mask", "options.width", "options.height", "options.count"],
        },
        edit: {
          description: "Edit images using prompt text, source images, and optional masks.",
          consumes: ["input.prompt", "input.images", "input.mask", "options.width", "options.height", "options.count"],
        },
      },
      dimensions: {
        image: {
          sizeFormat: "x",
          supportedSizes: ["1024x1024", "1536x1024", "1024x1536"],
        },
      },
      count: { supported: true, max: 4, strategy: "native" },
      maxImages: 16,
    },
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text.",
          consumes: ["input.prompt", "options.width", "options.height", "options.count"],
        },
        reference: {
          description: "Edit or generate images using prompt text and reference images.",
          consumes: ["input.prompt", "input.images", "input.mask", "options.width", "options.height", "options.count"],
        },
        edit: {
          description: "Edit images using prompt text, source images, and optional masks.",
          consumes: ["input.prompt", "input.images", "input.mask", "options.width", "options.height", "options.count"],
        },
      },
      dimensions: {
        image: {
          sizeFormat: "x",
          maxWidth: 3840,
          maxHeight: 3840,
          minPixels: 655_360,
          maxPixels: 3840 * 2160,
          minAspectRatio: 1 / 3,
          maxAspectRatio: 3,
        },
      },
      count: { supported: true, max: 4, strategy: "native" },
      maxImages: 16,
    },
  },
  "sora-2": {
    id: "sora-2",
    type: "video",
    async: true,
    capabilities: {
      actions: {
        generate: {
          description: "Generate video from prompt text.",
          consumes: ["input.prompt", "options.width", "options.height", "options.duration"],
        },
      },
      dimensions: {
        aspectRatios: ["16:9", "9:16", "1:1"],
        video: { resolutions: ["720p"], maxDuration: 20 },
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
