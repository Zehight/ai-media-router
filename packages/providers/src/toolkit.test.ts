import { describe, expect, it } from "vitest"
import type { ProviderCreateContext } from "@media-router/core"
import {
  appendPromptFlags,
  assetsFromImageData,
  collectMediaInputs,
  describeMediaInput,
  firstImageInput,
  getImageInputs,
  mediaInputToInlineBase64,
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
})

function baseContext(options?: { outputFormat?: string }): ProviderCreateContext {
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
    },
    model: {
      id: "image",
      type: "image",
      modes: ["text-to-image"],
      async: false,
    },
  }
}
