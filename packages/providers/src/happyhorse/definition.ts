import type { DimensionCapabilities, ModelDefinition } from "@miragari/core"

const videoDimensions: DimensionCapabilities = {
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  video: { resolutions: ["720p", "1080p"] },
}

export const happyhorseModels: Record<string, ModelDefinition> = {
  "happy-horse": {
    id: "happy-horse",
    type: "video",
    async: true,
    capabilities: {
      actions: {
        generate: {
          description: "Generate HappyHorse video from prompt text, or from media when inputs are provided.",
          consumes: [
            "input.prompt",
            "input.image",
            "input.firstFrame",
            "input.images",
            "input.video",
            "options.duration",
            "options.seed",
            "providerOptions.enable_safety_checker",
          ],
        },
        reference: {
          description: "Generate HappyHorse video from one or more reference images.",
          consumes: [
            "input.prompt",
            "input.image",
            "input.firstFrame",
            "input.images",
            "options.duration",
            "options.seed",
            "providerOptions.enable_safety_checker",
          ],
        },
        edit: {
          description: "Edit HappyHorse video with natural-language instructions.",
          consumes: [
            "input.prompt",
            "input.video",
            "input.images",
            "options.seed",
            "providerOptions.audio_setting",
            "providerOptions.enable_safety_checker",
          ],
        },
      },
      dimensions: videoDimensions,
      durations: Array.from({ length: 13 }, (_, index) => index + 3),
      maxImages: 9,
      maxVideos: 1,
      supportsSeed: true,
    },
  },
}
