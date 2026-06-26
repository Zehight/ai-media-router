import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
  rawResponse,
} from "../test-harness.js"
import { openaiModels } from "./definition.js"
import { openaiProvider } from "./provider.js"

describe("openaiProvider", () => {
  it("documents provider facade actions without SDK routing modes", () => {
    expect(openaiModels["gpt-image-1"]?.capabilities?.actions).toMatchObject({
      generate: { consumes: expect.arrayContaining(["input.prompt"]) },
      reference: { consumes: expect.arrayContaining(["input.images"]) },
      edit: { consumes: expect.arrayContaining(["input.mask"]) },
    })
    expect(openaiModels["gpt-image-2"]?.capabilities?.actions).toMatchObject({
      generate: { consumes: expect.arrayContaining(["input.prompt"]) },
      reference: { consumes: expect.arrayContaining(["input.images"]) },
      edit: { consumes: expect.arrayContaining(["input.mask"]) },
    })
  })

  it("preserves gpt-image-2 custom image sizes for the router", () => {
    expect(
      openaiModels["gpt-image-2"]?.capabilities?.dimensions?.image?.supportedSizes,
    ).toBeUndefined()
    expect(openaiModels["gpt-image-2"]?.capabilities?.dimensions?.image).toMatchObject({
      maxWidth: 3840,
      maxHeight: 3840,
      minPixels: 655_360,
      minAspectRatio: 1 / 3,
      maxAspectRatio: 3,
    })
  })

  it("documents Sora facade actions and dimensions", () => {
    expect(openaiModels["sora-2"]?.capabilities?.actions).toMatchObject({
      generate: { consumes: expect.arrayContaining(["input.prompt", "options.duration"]) },
    })
    expect(openaiModels["sora-2"]?.capabilities?.dimensions?.video).toMatchObject({
      resolutions: ["720p"],
      maxDuration: 20,
    })
  })

  it("maps synchronous image requests and responses", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      responses: [
        jsonResponse({ data: [{ b64_json: "aW1hZ2U=" }] }),
      ],
    })

    const output = await openaiProvider.driver.create(
      harness.createContext({
        provider: "openaiProxy",
        model: "gpt-image-1",
        type: "image",
        input: { prompt: "a clean product shot" },
        options: { count: 2, quality: "high", outputFormat: "webp" },
        providerOptions: { background: "transparent" },
      }),
    )

    expect(output.kind).toBe("completed")
    if (output.kind === "completed") {
      expect(output.result.assets[0]).toMatchObject({
        type: "image",
        base64: "aW1hZ2U=",
        mimeType: "image/webp",
      })
    }
    expect(harness.calls[0]?.url).toBe("https://api.openai.com/v1/images/generations")
    expect(harness.calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
    })
    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "gpt-image-1",
      prompt: "a clean product shot",
      n: 2,
      quality: "high",
      background: "transparent",
      output_format: "webp",
    })
    expect(jsonBody(harness.calls[0])).not.toHaveProperty("response_format")
    harness.expectAllResponsesUsed()
  })

  it("maps image edit inputs without action", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      responses: [
        jsonResponse({ data: [{ b64_json: "ZWRpdA==" }] }),
      ],
    })

    const output = await openaiProvider.driver.create(
      harness.createContext({
        provider: "openaiProxy",
        model: "gpt-image-1",
        type: "image",
        input: {
          prompt: "change the label",
          images: [
            { url: "https://example.com/source.png" },
            { type: "base64", data: "cmVm", mimeType: "image/png" },
          ],
          mask: { url: "https://example.com/mask.png" },
        },
        options: { count: 1, outputFormat: "png" },
      }),
    )

    expect(output.kind).toBe("completed")
    expect(harness.calls[0]?.url).toBe("https://api.openai.com/v1/images/edits")
    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "gpt-image-1",
      prompt: "change the label",
      images: [
        { image_url: "https://example.com/source.png" },
        { image_url: "data:image/png;base64,cmVm" },
      ],
      mask: { image_url: "https://example.com/mask.png" },
      n: 1,
      output_format: "png",
    })
    harness.expectAllResponsesUsed()
  })

  it("rejects unsupported image facade actions and invalid edit inputs", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      responses: [],
    })

    await expect(
      openaiProvider.driver.create(
        harness.createContext({
          provider: "openaiProxy",
          model: "gpt-image-1",
          type: "image",
          action: "inpaint",
          input: { prompt: "test" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unsupported action: inpaint",
    })

    await expect(
      openaiProvider.driver.create(
        harness.createContext({
          provider: "openaiProxy",
          model: "gpt-image-1",
          type: "image",
          action: "edit",
          input: {
            prompt: "masked edit",
            mask: { url: "https://example.com/mask.png" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("image edit requires at least one source image"),
    })
    harness.expectFetchCount(0)
  })

  it("maps async video create, poll failure, and cancellation", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
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
        jsonResponse({ id: "vid_1", status: "queued" }),
        jsonResponse({
          id: "vid_1",
          status: "failed",
          error: { message: "video rejected" },
        }),
        jsonResponse({ id: "vid_1", status: "cancelled" }),
      ],
    })

    const create = await openaiProvider.driver.create(
      harness.createContext({
        provider: "openaiProxy",
        model: "sora-2",
        type: "video",
        input: { prompt: "a cinematic camera move" },
        options: { duration: 8 },
      }),
    )

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      expect(create.job.providerJobId).toBe("vid_1")
      expect(create.job.status).toBe("queued")
      expect(jsonBody(harness.calls[0])).toMatchObject({
        model: "sora-2",
        prompt: "a cinematic camera move",
        seconds: 8,
        size: "1280x720",
      })

      const polled = await openaiProvider.driver.poll?.(harness.pollContext(create.job))
      expect(harness.calls[1]?.url).toBe("https://api.openai.com/v1/videos/vid_1")
      expect(polled?.status).toBe("failed")
      expect(polled?.error?.message).toBe("video rejected")

      await openaiProvider.driver.cancel?.(harness.cancelContext(create.job))
      expect(harness.calls[2]?.url).toBe(
        "https://api.openai.com/v1/videos/vid_1/cancel",
      )
      expect(harness.calls[2]?.init.method).toBe("POST")
      harness.expectAllResponsesUsed()
    }
  })

  it("rejects unsupported Sora media inputs", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      responses: [],
    })

    await expect(
      openaiProvider.driver.create(
        harness.createContext({
          provider: "openaiProxy",
          model: "sora-2",
          type: "video",
          input: {
            prompt: "animate this",
            image: { url: "https://example.com/frame.png" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("input.image"),
    })
    harness.expectFetchCount(0)
  })

  it("downloads completed video content when polling succeeds without a url", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      responses: [
        jsonResponse({ id: "vid_1", status: "queued" }),
        jsonResponse({ id: "vid_1", status: "completed" }),
        rawResponse("mp4", { headers: { "content-type": "video/mp4" } }),
      ],
    })

    const create = await openaiProvider.driver.create(
      harness.createContext({
        provider: "openaiProxy",
        model: "sora-2",
        type: "video",
        input: { prompt: "a cinematic camera move" },
      }),
    )

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      const polled = await openaiProvider.driver.poll?.(harness.pollContext(create.job))
      expect(harness.calls[1]?.url).toBe("https://api.openai.com/v1/videos/vid_1")
      expect(harness.calls[2]?.url).toBe(
        "https://api.openai.com/v1/videos/vid_1/content",
      )
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets[0]).toMatchObject({
        type: "video",
        base64: "bXA0",
        mimeType: "video/mp4",
      })
      harness.expectAllResponsesUsed()
    }
  })
})
