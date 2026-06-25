import type { ModelDefinition } from "@media-router/core"

export const googleModels: Record<string, ModelDefinition> = {
  "gemini-2.5-flash-image": {
    id: "gemini-2.5-flash-image",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        image: { resolutionTiers: ["1K", "2K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
    },
  },
  "gemini-3-pro-image": {
    id: "gemini-3-pro-image",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        image: { resolutionTiers: ["1K", "2K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
    },
  },
  "gemini-3.1-flash-image": {
    id: "gemini-3.1-flash-image",
    type: "image",
    modes: ["text-to-image", "image-to-image"],
    async: false,
    capabilities: {
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        image: { resolutionTiers: ["1K", "2K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
    },
  },
}
