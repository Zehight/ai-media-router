import type { GenerationStatus, ModelDefinition } from "@media-router/core"

export const volcengineModels: Record<string, ModelDefinition> = {
  "doubao-seedream-4-5-251128": {
    id: "doubao-seedream-4-5-251128",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
        image: { resolutionTiers: ["1K", "2K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
    },
  },
  "doubao-seedream-5-0-260128": {
    id: "doubao-seedream-5-0-260128",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
        image: { resolutionTiers: ["1K", "2K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
    },
  },
  "doubao-seedance-2-0-260128": {
    id: "doubao-seedance-2-0-260128",
    type: "video",
    modes: ["text-to-video", "image-to-video"],
    async: true,
    capabilities: {
      dimensions: {
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        video: { resolutions: ["480p", "720p", "1080p"] },
      },
    },
  },
  "doubao-seedance-2-0-fast-260128": {
    id: "doubao-seedance-2-0-fast-260128",
    type: "video",
    modes: ["text-to-video", "image-to-video"],
    async: true,
    capabilities: {
      dimensions: {
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        video: { resolutions: ["480p", "720p", "1080p"] },
      },
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
