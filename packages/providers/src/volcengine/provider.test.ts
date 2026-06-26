import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
} from "../test-harness.js"
import { volcengineModels } from "./definition.js"
import { volcengineProvider } from "./provider.js"

describe("volcengineProvider", () => {
  it("documents provider facade actions without SDK routing modes", () => {
    expect(
      volcengineModels["doubao-seedance-2-0-260128"]?.capabilities?.actions,
    ).toMatchObject({
      generate: {
        consumes: expect.arrayContaining([
          "input.prompt",
          "input.images",
          "input.video",
          "input.audio",
          "options.duration",
        ]),
      },
    })
    expect(
      volcengineModels["doubao-seedance-2-0-260128"]?.capabilities?.actions,
    ).not.toHaveProperty("reference")
    expect(
      volcengineModels["doubao-seedream-4-5-251128"]?.capabilities?.actions,
    ).toMatchObject({
      generate: { consumes: expect.arrayContaining(["input.prompt"]) },
      reference: { consumes: expect.arrayContaining(["input.prompt", "input.images"]) },
    })
    expect(
      volcengineModels["doubao-seedream-4-5-251128"]?.capabilities?.dimensions?.image
        ?.resolutionTiers,
    ).toEqual(["1K", "2K", "3K", "4K"])
  })

  it("maps text image requests with provider resolution tiers", async () => {
    const harness = createProviderHarness({
      plugin: volcengineProvider,
      provider: "volcProxy",
      dimensions: {
        width: 2048,
        height: 2048,
        aspectRatio: "1:1",
        normalizedRatio: 1,
        orientation: "square",
        resolutionTier: "2K",
        size: "2048x2048",
        providerSize: "2K",
      },
      responses: [
        jsonResponse({ data: [{ url: "https://cdn.example.com/image.png" }] }),
      ],
    })

    const output = await volcengineProvider.driver.create(
      harness.createContext({
        provider: "volcProxy",
        model: "doubao-seedream-4-5-251128",
        type: "image",
        input: {
          prompt: "architectural render",
        },
        providerOptions: { guidance_scale: 7 },
      }),
    )

    expect(output.kind).toBe("completed")
    if (output.kind === "completed") {
      expect(output.result.assets[0]).toMatchObject({
        type: "image",
        url: "https://cdn.example.com/image.png",
      })
    }
    expect(harness.calls[0]?.url).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    )
    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "doubao-seedream-4-5-251128",
      prompt: "architectural render",
      size: "2K",
      response_format: "url",
      watermark: false,
      guidance_scale: 7,
    })
    harness.expectAllResponsesUsed()
  })

  it("maps reference image requests and 3K provider tiers", async () => {
    const harness = createProviderHarness({
      plugin: volcengineProvider,
      provider: "volcProxy",
      dimensions: {
        width: 2304,
        height: 4096,
        fmtWidth: 2304,
        fmtHeight: 4096,
        aspectRatio: "9:16",
        normalizedRatio: 9 / 16,
        orientation: "portrait",
        resolutionTier: "3K",
        size: "2304x4096",
        providerSize: "3K",
      },
      responses: [
        jsonResponse({ data: [{ url: "https://cdn.example.com/reference.png" }] }),
      ],
    })

    const output = await volcengineProvider.driver.create(
      harness.createContext({
        provider: "volcProxy",
        model: "doubao-seedream-4-5-251128",
        type: "image",
        input: {
          prompt: "use this reference",
          images: [{ url: "https://example.com/ref.png" }],
        },
      }),
    )

    expect(output.kind).toBe("completed")
    expect(jsonBody(harness.calls[0])).toMatchObject({
      prompt: "use this reference",
      image: "https://example.com/ref.png",
      size: "3K",
    })
    harness.expectAllResponsesUsed()
  })

  it("rejects unsupported image inputs explicitly", async () => {
    const harness = createProviderHarness({
      plugin: volcengineProvider,
      provider: "volcProxy",
      responses: [],
    })

    await expect(
      volcengineProvider.driver.create(
        harness.createContext({
          provider: "volcProxy",
          model: "doubao-seedream-4-5-251128",
          type: "image",
          input: {
            prompt: "masked edit",
            mask: { url: "https://example.com/mask.png" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("input.mask"),
    })

    await expect(
      volcengineProvider.driver.create(
        harness.createContext({
          provider: "volcProxy",
          model: "doubao-seedream-4-5-251128",
          type: "image",
          action: "reference",
          input: {
            prompt: "two refs",
            images: [
              { url: "https://example.com/a.png" },
              { url: "https://example.com/b.png" },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("supports one reference image"),
    })
    harness.expectFetchCount(0)
  })

  it("maps async video task create and successful polling", async () => {
    const harness = createProviderHarness({
      plugin: volcengineProvider,
      provider: "volcProxy",
      dimensions: {
        width: 1280,
        height: 720,
        aspectRatio: "16:9",
        normalizedRatio: 16 / 9,
        orientation: "landscape",
        resolutionTier: "720p",
        size: "1280x720",
      },
      responses: [
        jsonResponse({ task_id: "task_1", status: "queued" }),
        jsonResponse({
          status: "succeeded",
          content: { video_url: "https://cdn.example.com/video.mp4" },
        }),
      ],
    })

    const create = await volcengineProvider.driver.create(
      harness.createContext({
        provider: "volcProxy",
        model: "doubao-seedance-2-0-260128",
        type: "video",
        input: { prompt: "a train passing a mountain" },
        options: {
          duration: 5,
          audioEnabled: true,
        },
        providerOptions: { watermark: false, cameraFixed: true },
      }),
    )

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      expect(create.job.providerJobId).toBe("task_1")
      expect(create.job.status).toBe("queued")
      expect(jsonBody(harness.calls[0])).toMatchObject({
        model: "doubao-seedance-2-0-260128",
        content: [
          {
            type: "text",
            text: "a train passing a mountain",
          },
        ],
        ratio: "16:9",
        resolution: "720p",
        duration: 5,
        generate_audio: true,
        watermark: false,
        cameraFixed: true,
      })

      const polled = await volcengineProvider.driver.poll?.(harness.pollContext(create.job))
      expect(harness.calls[1]?.url).toBe(
        "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task_1",
      )
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets[0]).toMatchObject({
        type: "video",
        url: "https://cdn.example.com/video.mp4",
        mimeType: "video/mp4",
      })
      harness.expectAllResponsesUsed()
    }
  })

  it("maps Seedance multimodal references without action-specific usage", async () => {
    const harness = createProviderHarness({
      plugin: volcengineProvider,
      provider: "volcProxy",
      dimensions: {
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        normalizedRatio: 9 / 16,
        orientation: "portrait",
        resolutionTier: "1080p",
        size: "1080x1920",
      },
      responses: [jsonResponse({ task_id: "task_refs", status: "queued" })],
    })

    const create = await volcengineProvider.driver.create(
      harness.createContext({
        provider: "volcProxy",
        model: "doubao-seedance-2-0-260128",
        type: "video",
        input: {
          prompt: "make a product launch clip",
          firstFrame: { url: "https://example.com/start.png", mimeType: "image/png" },
          lastFrame: { type: "base64", data: "ZW5k", mimeType: "image/png" },
          images: [
            { url: "https://example.com/product.png", mimeType: "image/png" },
            { type: "base64", data: "aW1hZ2U=", mimeType: "image/png" },
          ],
          video: { url: "https://example.com/reference.mp4", mimeType: "video/mp4" },
          audio: { url: "https://example.com/music.mp3", mimeType: "audio/mpeg" },
        },
        options: {
          duration: 8,
        },
      }),
    )

    expect(create.kind).toBe("pending")
    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "doubao-seedance-2-0-260128",
      content: [
        { type: "text", text: "make a product launch clip" },
        { type: "first_frame", url: "https://example.com/start.png" },
        { type: "image_url", image_url: { url: "https://example.com/product.png" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
        { type: "last_frame", url: "data:image/png;base64,ZW5k" },
        { type: "video_url", video_url: { url: "https://example.com/reference.mp4" } },
        { type: "audio_url", audio_url: { url: "https://example.com/music.mp3" } },
      ],
      duration: 8,
    })
    harness.expectAllResponsesUsed()
  })

  it("rejects unsupported Seedance media inputs explicitly", async () => {
    const harness = createProviderHarness({
      plugin: volcengineProvider,
      provider: "volcProxy",
      responses: [],
    })

    await expect(
      volcengineProvider.driver.create(
        harness.createContext({
          provider: "volcProxy",
          model: "doubao-seedance-2-0-260128",
          type: "video",
          input: {
            prompt: "animate",
            videos: [
              { url: "https://example.com/a.mp4" },
              { url: "https://example.com/b.mp4" },
              { url: "https://example.com/c.mp4" },
              { url: "https://example.com/d.mp4" },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("input.videos"),
    })
    harness.expectFetchCount(0)
  })
})
