import { describe, expect, it } from "vitest"
import type { ProviderCreateContext } from "@media-router/core"
import {
  appendPromptFlags,
  assertNoUnusedMediaInputs,
  assetsFromImageData,
  badRequest,
  collectMediaInputs,
  completed,
  describeMediaInput,
  firstImageInput,
  getImageInputs,
  getModel3DInputs,
  getProviderOption,
  mediaInputToInlineBase64,
  pendingProviderJob,
  polledJob,
  providerAsset,
  providerAssets,
  requirePrompt,
  requestIntent,
} from "./toolkit.js"

describe("provider toolkit", () => {
  it("collects image inputs in provider-friendly order", () => {
    const request = {
      provider: "p",
      model: "m",
      type: "video" as const,
      input: {
        prompt: "test",
        image: { url: "https://example.com/main.png" },
        firstFrame: { url: "https://example.com/first.png" },
        images: [{ url: "https://example.com/ref.png" }],
        lastFrame: { url: "https://example.com/last.png" },
      },
    }

    expect(getImageInputs(request).map((input) => "url" in input && input.url)).toEqual([
      "https://example.com/main.png",
      "https://example.com/first.png",
      "https://example.com/ref.png",
      "https://example.com/last.png",
    ])
    expect(firstImageInput(request)).toMatchObject({
      url: "https://example.com/main.png",
    })
    expect(collectMediaInputs(request).map((item) => item.role)).toEqual([
      "image",
      "firstFrame",
      "referenceImage",
      "lastFrame",
    ])
  })

  it("collects model3d inputs without changing provider routing", () => {
    const request = {
      provider: "p",
      model: "m",
      type: "model3d" as const,
      input: {
        prompt: "chair",
        images: [{ url: "https://example.com/ref.png" }],
        model: { url: "https://example.com/base.glb" },
      },
    }

    expect(getModel3DInputs(request).map((input) => "url" in input && input.url)).toEqual([
      "https://example.com/base.glb",
    ])
    expect(collectMediaInputs(request).map((item) => item.role)).toEqual([
      "referenceImage",
      "model3d",
    ])
  })

  it("builds a provider request intent view from normalized input", () => {
    const context = {
      ...baseContext(),
      request: {
        provider: "proxy",
        model: "video",
        type: "video" as const,
        action: "reference",
        input: {
          prompt: "animate this product",
          text: "voiceover text",
          image: { url: "https://example.com/main.png" },
          video: { url: "https://example.com/source.mp4" },
          audios: [{ url: "https://example.com/music.mp3" }],
        },
        options: { duration: 4 },
        providerOptions: { watermark: false },
      },
      model: {
        id: "video",
        type: "video" as const,
        async: true,
      },
    }

    expect(requestIntent(context)).toMatchObject({
      type: "video",
      action: "reference",
      prompt: "animate this product",
      text: "voiceover text",
      options: { duration: 4 },
      providerOptions: { watermark: false },
      images: [{ url: "https://example.com/main.png" }],
      videos: [{ url: "https://example.com/source.mp4" }],
      audios: [{ url: "https://example.com/music.mp3" }],
      firstImage: { url: "https://example.com/main.png" },
      firstVideo: { url: "https://example.com/source.mp4" },
      firstAudio: { url: "https://example.com/music.mp3" },
    })
    expect(requestIntent(context).media.map((item) => item.role)).toEqual([
      "image",
      "video",
      "referenceAudio",
    ])
  })

  it("describes media inputs without provider-specific payload decisions", () => {
    expect(describeMediaInput({ url: "https://example.com/a.png" })).toEqual({
      kind: "url",
      url: "https://example.com/a.png",
      mimeType: undefined,
    })
    expect(
      describeMediaInput({
        type: "file",
        path: "/tmp/a.png",
        mimeType: "image/png",
      }),
    ).toEqual({
      kind: "file",
      path: "/tmp/a.png",
      mimeType: "image/png",
    })
  })

  it("converts inline-capable inputs to base64 payloads", () => {
    expect(
      mediaInputToInlineBase64({
        type: "base64",
        data: "YWJj",
        mimeType: "image/png",
      }),
    ).toEqual({ data: "YWJj", mimeType: "image/png" })
    expect(
      mediaInputToInlineBase64({
        type: "bytes",
        data: new Uint8Array([97, 98, 99]),
        mimeType: "text/plain",
      }),
    ).toEqual({ data: "YWJj", mimeType: "text/plain", filename: undefined })
  })

  it("maps common image response data to normalized assets", () => {
    expect(
      assetsFromImageData(
        [
          { url: "https://example.com/a.png" },
          {},
          { b64_json: "YWJj" },
        ],
        baseContext({ outputFormat: "png" }),
      ),
    ).toEqual([
      {
        type: "image",
        url: "https://example.com/a.png",
        base64: undefined,
        mimeType: "image/png",
      },
      {
        type: "image",
        url: undefined,
        base64: "YWJj",
        mimeType: "image/png",
      },
    ])
  })

  it("normalizes provider asset shorthand", () => {
    expect(providerAsset("image", "https://example.com/a.png")).toEqual({
      type: "image",
      url: "https://example.com/a.png",
    })
    expect(
      providerAssets("video", [
        { url: "https://example.com/a.mp4" },
        { type: "image", url: "https://example.com/poster.png" },
      ]),
    ).toEqual([
      { type: "video", url: "https://example.com/a.mp4" },
      { type: "image", url: "https://example.com/poster.png" },
    ])
  })

  it("appends only defined prompt flags", () => {
    expect(
      appendPromptFlags("generate", {
        ratio: "16:9",
        duration: 5,
        seed: undefined,
        camerafixed: false,
      }),
    ).toBe("generate --ratio 16:9 --duration 5 --camerafixed false")
  })

  it("reads provider options without defining provider-specific schema", () => {
    const context = baseContext(undefined, { enhancePrompt: true })
    expect(getProviderOption<boolean>(context, "enhancePrompt")).toBe(true)
    expect(getProviderOption<string>(context, "missing", "fallback")).toBe("fallback")
  })

  it("throws standardized bad request errors from provider helpers", () => {
    expect(() => badRequest(baseContext(), "invalid input")).toThrowError(
      /invalid input/,
    )
  })

  it("requires prompt when a provider facade needs text", () => {
    expect(requirePrompt(baseContext())).toBe("test")
    expect(() =>
      requirePrompt({
        ...baseContext(),
        request: {
          provider: "proxy",
          model: "audio",
          type: "audio",
          input: { text: "spoken text" },
        },
      }),
    ).toThrowError(/prompt is required/)
  })

  it("can assert provider facade consumed media inputs", () => {
    const context = {
      ...baseContext(),
      request: {
        provider: "proxy",
        model: "image",
        type: "image" as const,
        input: {
          prompt: "test",
          images: [{ url: "https://example.com/ref.png" }],
          mask: { url: "https://example.com/mask.png" },
        },
      },
    }

    expect(() => assertNoUnusedMediaInputs(context, ["referenceImage"])).toThrowError(
      /input.mask/,
    )
  })

  it("builds normalized provider outputs without the HTTP facade", () => {
    const context = baseContext({ outputFormat: "png" })
    const done = completed({
      context,
      assets: ["https://example.com/a.png"],
      providerRequest: { prompt: "test" },
    })

    expect(done).toMatchObject({
      kind: "completed",
      result: {
        type: "image",
        provider: "proxy",
        providerId: "example",
        model: "image",
        status: "succeeded",
        asset: { type: "image", url: "https://example.com/a.png" },
        assets: [{ type: "image", url: "https://example.com/a.png" }],
        resolved: { providerRequest: { prompt: "test" } },
      },
    })

    const pending = pendingProviderJob({
      context,
      providerJobId: "provider_job_1",
      providerState: { cursor: "next" },
    })
    expect(pending).toMatchObject({
      kind: "pending",
      job: {
        type: "image",
        provider: "proxy",
        providerId: "example",
        model: "image",
        status: "queued",
        providerJobId: "provider_job_1",
        providerState: { cursor: "next" },
      },
    })

    if (pending.kind !== "pending") throw new Error("expected pending job")
    expect(
      polledJob({
        context: {
          ...context,
          job: pending.job,
        },
        status: "succeeded",
        assets: [{ base64: "YWJj" }],
      }),
    ).toMatchObject({
      status: "succeeded",
      result: {
        type: "image",
        provider: "proxy",
        providerId: "example",
        model: "image",
        asset: { type: "image", base64: "YWJj" },
        assets: [{ type: "image", base64: "YWJj" }],
      },
    })
  })
})

function baseContext(
  options?: { outputFormat?: string },
  providerOptions?: Record<string, unknown>,
): ProviderCreateContext {
  return {
    provider: "proxy",
    providerId: "example",
    plugin: {
      id: "example",
      displayName: "Example",
      models: {},
      driver: {
        async create() {
          throw new Error("unused")
        },
      },
    },
    config: { plugin: "example" },
    fetch: globalThis.fetch,
    resolved: {},
    request: {
      provider: "proxy",
      model: "image",
      type: "image",
      input: { prompt: "test" },
      options,
      providerOptions,
    },
    model: {
      id: "image",
      type: "image",
      async: false,
    },
  }
}
