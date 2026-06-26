import type { ModelDefinition } from "@miragari/ai-media-router-core"

export const googleModels: Record<string, ModelDefinition> = {
  "gemini-2.5-flash-image": {
    id: "gemini-2.5-flash-image",
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text through generateContent.",
          consumes: ["input.prompt", "options.width", "options.height"],
        },
        reference: {
          description: "Generate images using prompt text and reference images.",
          consumes: ["input.prompt", "input.images", "options.width", "options.height"],
        },
      },
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
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text through generateContent.",
          consumes: ["input.prompt", "options.width", "options.height"],
        },
        reference: {
          description: "Generate images using prompt text and reference images.",
          consumes: ["input.prompt", "input.images", "options.width", "options.height"],
        },
      },
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
    async: false,
    capabilities: {
      actions: {
        generate: {
          description: "Generate images from prompt text through generateContent.",
          consumes: ["input.prompt", "options.width", "options.height"],
        },
        reference: {
          description: "Generate images using prompt text and reference images.",
          consumes: ["input.prompt", "input.images", "options.width", "options.height"],
        },
      },
      dimensions: {
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        image: { resolutionTiers: ["1K", "2K", "4K"] },
      },
      count: { supported: false, max: 1, strategy: "split" },
    },
  },
}
