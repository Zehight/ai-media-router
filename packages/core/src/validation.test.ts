import { describe, expect, it } from "vitest"
import { MediaRouterException } from "./errors.js"
import type { ModelDefinition } from "./provider.js"
import { validateGenerationRequest } from "./validation.js"

const imageModel: ModelDefinition = {
  id: "image-model",
  type: "image",
  async: false,
  capabilities: {
    count: { supported: false, max: 1, strategy: "split" },
    maxImages: 1,
  },
}

const videoModel: ModelDefinition = {
  id: "video-model",
  type: "video",
  async: true,
  capabilities: {
    durations: [5, 10],
    fps: [24],
    maxImages: 2,
    maxVideos: 0,
    supportsSeed: false,
  },
}

describe("validateGenerationRequest", () => {
  it("rejects unknown models", () => {
    expect(() =>
      validateGenerationRequest({
        request: {
          provider: "p",
          model: "missing",
          type: "image",
          input: { prompt: "test" },
        },
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

  it("treats action as opaque provider facade input", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          action: "provider-specific-edit",
          input: { prompt: "test" },
        },
      }),
    ).not.toThrow()
  })

  it("does not reject provider facade input combinations in core", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          input: {
            prompt: "test",
            images: [{ url: "https://example.com/a.png" }],
          },
        },
      }),
    ).not.toThrow()
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

  it("rejects non-integer image counts", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          input: { prompt: "test" },
          options: { count: 1.5 },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects non-finite image counts", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          input: { prompt: "test" },
          options: { count: Number.NaN },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects non-positive width", () => {
    expect(() =>
      validateGenerationRequest({
        model: imageModel,
        request: {
          provider: "p",
          model: "image-model",
          type: "image",
          input: { prompt: "test" },
          options: { width: 0 },
        },
      }),
    ).toThrow(MediaRouterException)
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

  it("rejects unsupported video dimensions durations", () => {
    expect(() =>
      validateGenerationRequest({
        model: {
          ...videoModel,
          capabilities: {
            dimensions: {
              video: {
                durations: [5],
              },
            },
          },
        },
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

  it("rejects durations above provider maxDuration", () => {
    expect(() =>
      validateGenerationRequest({
        model: {
          ...videoModel,
          capabilities: {
            dimensions: {
              video: {
                maxDuration: 5,
              },
            },
          },
        },
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

  it("rejects non-positive video durations", () => {
    expect(() =>
      validateGenerationRequest({
        model: {
          ...videoModel,
          capabilities: {
            dimensions: {
              video: {
                maxDuration: 5,
              },
            },
          },
        },
        request: {
          provider: "p",
          model: "video-model",
          type: "video",
          input: { prompt: "test" },
          options: { duration: 0 },
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

  it("allows audio requests through basic validation", () => {
    expect(() =>
      validateGenerationRequest({
        model: {
          id: "audio-model",
          type: "audio",
          async: false,
        },
        request: {
          provider: "p",
          model: "audio-model",
          type: "audio",
          action: "voiceover",
          input: { text: "hello" },
          options: { duration: 5, sampleRate: 44100 },
        },
      }),
    ).not.toThrow()
  })

  it("allows model3d requests through basic validation", () => {
    expect(() =>
      validateGenerationRequest({
        model: {
          id: "model3d-model",
          type: "model3d",
          async: false,
        },
        request: {
          provider: "p",
          model: "model3d-model",
          type: "model3d",
          action: "text-to-3d",
          input: { prompt: "chair" },
          options: { format: "glb", texture: true },
        },
      }),
    ).not.toThrow()
  })
})
