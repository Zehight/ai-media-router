import type {
  DimensionCapabilities,
  GenerationStatus,
  ModelDefinition,
} from "@miragari/ai-media-router-core"

const qwenImage20Dimensions: DimensionCapabilities = {
  image: {
    sizeFormat: "*",
    minPixels: 512 * 512,
    maxPixels: 2048 * 2048,
  },
}

const qwenImagePresetDimensions: DimensionCapabilities = {
  aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
  image: {
    sizeFormat: "*",
    supportedSizes: ["1664*928", "1472*1104", "1328*1328", "1104*1472", "928*1664"],
  },
}

const qwenEditableDimensions: DimensionCapabilities = {
  image: {
    sizeFormat: "*",
    minPixels: 512 * 512,
    maxWidth: 2048,
    maxHeight: 2048,
  },
}

const qwenVideoDimensions: DimensionCapabilities = {
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
  video: { resolutions: ["720p", "1080p"] },
}

const generateAction = {
  description: "Generate images from prompt text.",
  consumes: [
    "input.prompt",
    "input.negativePrompt",
    "options.width",
    "options.height",
    "options.count",
    "options.seed",
    "providerOptions.prompt_extend",
    "providerOptions.watermark",
  ],
}

const videoGenerateAction = {
  description: "Generate videos from prompt text.",
  consumes: [
    "input.prompt",
    "input.negativePrompt",
    "options.width",
    "options.height",
    "options.duration",
    "options.seed",
    "providerOptions.prompt_extend",
    "providerOptions.watermark",
  ],
}

const imageToVideoAction = {
  description: "Generate videos from images, audio, or an initial video clip.",
  consumes: [
    "input.prompt",
    "input.negativePrompt",
    "input.image",
    "input.firstFrame",
    "input.lastFrame",
    "input.images",
    "input.video",
    "input.audio",
    "options.duration",
    "options.seed",
    "providerOptions.prompt_extend",
    "providerOptions.watermark",
  ],
}

const referenceAction = {
  description: "Generate or edit images from prompt text and reference images.",
  consumes: [
    "input.prompt",
    "input.images",
    "input.negativePrompt",
    "options.width",
    "options.height",
    "options.count",
    "options.seed",
    "providerOptions.prompt_extend",
    "providerOptions.watermark",
  ],
}

const editAction = {
  description: "Edit images with natural-language instructions and reference images.",
  consumes: [
    "input.prompt",
    "input.images",
    "input.negativePrompt",
    "options.width",
    "options.height",
    "options.count",
    "options.seed",
    "providerOptions.prompt_extend",
    "providerOptions.watermark",
  ],
}

function qwenImage20Model(id: string): ModelDefinition {
  return {
    id,
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: generateAction,
        reference: referenceAction,
        edit: editAction,
      },
      dimensions: qwenImage20Dimensions,
      count: { supported: true, max: 6, strategy: "native" },
      maxImages: 3,
      supportsSeed: true,
    },
  }
}

function qwenImageMaxModel(id: string): ModelDefinition {
  return {
    id,
    type: "image",
    async: false,
    capabilities: {
      actions: {
        generate: generateAction,
      },
      dimensions: qwenImagePresetDimensions,
      count: { supported: true, max: 1, strategy: "native" },
      supportsSeed: true,
    },
  }
}

function qwenAsyncImageModel(id: string): ModelDefinition {
  return {
    id,
    type: "image",
    async: true,
    capabilities: {
      actions: {
        generate: generateAction,
      },
      dimensions: qwenImagePresetDimensions,
      count: { supported: true, max: 1, strategy: "native" },
      supportsSeed: true,
    },
  }
}

function qwenEditModel(
  id: string,
  countMax: number,
  dimensions: DimensionCapabilities = qwenEditableDimensions,
): ModelDefinition {
  return {
    id,
    type: "image",
    async: false,
    capabilities: {
      actions: {
        reference: referenceAction,
        edit: editAction,
      },
      dimensions,
      count: { supported: true, max: countMax, strategy: "native" },
      maxImages: 3,
      supportsSeed: true,
    },
  }
}

function wanVideoModel(id: string): ModelDefinition {
  return {
    id,
    type: "video",
    async: true,
    capabilities: {
      actions: {
        generate: videoGenerateAction,
        reference: imageToVideoAction,
        continue: imageToVideoAction,
      },
      dimensions: qwenVideoDimensions,
      maxImages: 2,
      maxVideos: 1,
      maxAudios: 1,
      supportsSeed: true,
    },
  }
}

export const qwenModels: Record<string, ModelDefinition> = {
  "wan2.7": wanVideoModel("wan2.7"),
  "qwen-image-2.0-pro": qwenImage20Model("qwen-image-2.0-pro"),
  "qwen-image-2.0-pro-2026-04-22": qwenImage20Model("qwen-image-2.0-pro-2026-04-22"),
  "qwen-image-2.0-pro-2026-03-03": qwenImage20Model("qwen-image-2.0-pro-2026-03-03"),
  "qwen-image-2.0": qwenImage20Model("qwen-image-2.0"),
  "qwen-image-2.0-2026-03-03": qwenImage20Model("qwen-image-2.0-2026-03-03"),
  "qwen-image-max": qwenImageMaxModel("qwen-image-max"),
  "qwen-image-max-2025-12-30": qwenImageMaxModel("qwen-image-max-2025-12-30"),
  "qwen-image-plus": qwenAsyncImageModel("qwen-image-plus"),
  "qwen-image-plus-2026-01-09": qwenAsyncImageModel("qwen-image-plus-2026-01-09"),
  "qwen-image": qwenAsyncImageModel("qwen-image"),
  "qwen-image-edit-max": qwenEditModel("qwen-image-edit-max", 6),
  "qwen-image-edit-max-2026-01-16": qwenEditModel("qwen-image-edit-max-2026-01-16", 6),
  "qwen-image-edit-plus": qwenEditModel("qwen-image-edit-plus", 6),
  "qwen-image-edit-plus-2025-12-15": qwenEditModel("qwen-image-edit-plus-2025-12-15", 6),
  "qwen-image-edit-plus-2025-10-30": qwenEditModel("qwen-image-edit-plus-2025-10-30", 6),
  "qwen-image-edit": qwenEditModel("qwen-image-edit", 1, {
    image: { sizeFormat: "*" },
  }),
}

export const qwenStatusMap: Record<string, GenerationStatus> = {
  PENDING: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "cancelled",
}
