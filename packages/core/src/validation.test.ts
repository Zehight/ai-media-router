import { describe, expect, it } from "vitest"
import { MediaRouterException } from "./errors.js"
import type { ModelDefinition } from "./provider.js"
import { inferModelMode, validateGenerationRequest } from "./validation.js"

const imageModel: ModelDefinition = {
  id: "image-model",
  type: "image",
  modes: ["text-to-image", "image-to-image"],
  async: false,
  capabilities: {
    count: { supported: false, max: 1, strategy: "split" },
    maxImages: 1,
  },
}

const videoModel: ModelDefinition = {
  id: "video-model",
  type: "video",
  modes: ["text-to-video", "image-to-video"],
  async: true,
  capabilities: {
    durations: [5, 10],
    fps: [24],
    maxImages: 2,
    maxVideos: 0,
    supportsSeed: false,
    supportsWebhook: false,
  },
}

describe("inferModelMode", () => {
  it("infers text-to-image", () => {
    expect(
      inferModelMode({
        provider: "p",
        model: "m",
        type: "image",
        input: { prompt: "test" },
      }),
    ).toBe("text-to-image")
  })

  it("infers image-to-video from first frame", () => {
    expect(
      inferModelMode({
        provider: "p",
        model: "m",
        type: "video",
        input: {
          prompt: "test",
          firstFrame: { url: "https://example.com/a.png" },
        },
      }),
    ).toBe("image-to-video")
  })
})

describe("validateGenerationRequest", () => {
  it("rejects unknown models", () => {
    expect(() =>
      validateGenerationRequest({
        request: { provider: "p", model: "missing", input: { prompt: "test" } },
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects unsupported media type", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "video",
          input: { prompt: "test" },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("allows split image counts above native max", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          input: { prompt: "test" },
          options: { count: 3 },
        },
      }),
    ).not.toThrow()
  })

  it("rejects unsupported video options", () => {
    expect(() =>
      validateGenerationRequest({
        model: videoModel,
        request: {
          provider: "p",
          model: "video-model",
          type: "video",
          input: { prompt: "test" },
          options: { duration: 6 },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects too many input images", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          input: {
            prompt: "test",
            images: [
              { url: "https://example.com/a.png" },
              { url: "https://example.com/b.png" },
            ],
          },
        },
      }),
    ).toThrow(MediaRouterException)
  })
})
