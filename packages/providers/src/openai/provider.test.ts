import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
} from "../test-harness.js"
import { openaiProvider } from "./provider.js"

describe("openaiProvider", () => {
  it("maps synchronous image requests and responses", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      responses: [
        jsonResponse({ data: [{ url: "https://cdn.example.com/image.png" }] }),
      ],
    })

    const output = await openaiProvider.driver.create(
      harness.createContext({
        provider: "openaiProxy",
        model: "gpt-image-1",
        type: "image",
        input: { prompt: "a clean product shot" },
        options: { count: 2, quality: "high" },
        providerOptions: { background: "transparent" },
      }),
    )

    expect(output.kind).toBe("completed")
    if (output.kind === "completed") {
      expect(output.result.assets[0]).toMatchObject({
        type: "image",
        url: "https://cdn.example.com/image.png",
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
      response_format: "url",
    })
    harness.expectAllResponsesUsed()
  })

  it("maps async video create, poll failure, and cancellation", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      provider: "openaiProxy",
      dimensions: {
        width: 1920,
        height: 1080,
        aspectRatio: "16:9",
        normalizedRatio: 16 / 9,
        orientation: "landscape",
        resolutionTier: "1080p",
        size: "1920x1080",
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
        size: "1920x1080",
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
})
