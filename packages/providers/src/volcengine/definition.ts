import type { GenerationStatus, ModelDefinition } from "@miragari/core"

export const volcengineModels: Record<string, ModelDefinition> = {
  "doubao-seedream-4-5-251128": {
    id: "doubao-seedream-4-5-251128",
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text.",
          consumes: ["input.prompt", "options.width", "options.height"],
        },
        reference: {
          description: "Generate images using prompt text and one reference image.",
          consumes: ["input.prompt", "input.images", "options.width", "options.height"],
        },
      },
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
        image: { resolutionTiers: ["1K", "2K", "3K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
      maxImages: 1,
    },
  },
  "doubao-seedream-5-0-260128": {
    id: "doubao-seedream-5-0-260128",
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text.",
          consumes: ["input.prompt", "options.width", "options.height"],
        },
        reference: {
          description: "Generate images using prompt text and one reference image.",
          consumes: ["input.prompt", "input.images", "options.width", "options.height"],
        },
      },
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
        image: { resolutionTiers: ["1K", "2K", "3K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
      maxImages: 1,
    },
  },
  "doubao-seedance-2-0-260128": {
    id: "doubao-seedance-2-0-260128",
    type: "video",
    async: true,
    capabilities: {
      actions: {
        generate: {
          description: "Generate video through the provider facade from text and optional media references.",
          consumes: [
            "input.prompt",
            "input.image",
            "input.firstFrame",
            "input.lastFrame",
            "input.images",
            "input.video",
            "input.videos",
            "input.audio",
            "input.audios",
            "options.width",
            "options.height",
            "options.duration",
            "options.seed",
            "options.audioEnabled",
          ],
        },
      },
      dimensions: {
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        video: { resolutions: ["480p", "720p", "1080p"] },
      },
      durations: Array.from({ length: 12 }, (_, index) => index + 4),
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      supportsSeed: true,
    },
  },
  "doubao-seedance-2-0-fast-260128": {
    id: "doubao-seedance-2-0-fast-260128",
    type: "video",
    async: true,
    capabilities: {
      actions: {
        generate: {
          description: "Generate video through the provider facade from text and optional media references.",
          consumes: [
            "input.prompt",
            "input.image",
            "input.firstFrame",
            "input.lastFrame",
            "input.images",
            "input.video",
            "input.videos",
            "input.audio",
            "input.audios",
            "options.width",
            "options.height",
            "options.duration",
            "options.seed",
            "options.audioEnabled",
          ],
        },
      },
      dimensions: {
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        video: { resolutions: ["480p", "720p"] },
      },
      durations: Array.from({ length: 12 }, (_, index) => index + 4),
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      supportsSeed: true,
    },
  },
}

export const volcengineStatusMap: Record<string, GenerationStatus> = {
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
}
