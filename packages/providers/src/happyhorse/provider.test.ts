import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
} from "../test-harness.js"
import { happyhorseModels } from "./definition.js"
import { happyhorseProvider } from "./provider.js"

describe("happyhorseProvider", () => {
  it("documents HappyHorse video facade actions", () => {
    expect(happyhorseModels["happy-horse"]?.capabilities).toMatchObject({
      maxImages: 9,
      maxVideos: 1,
      actions: {
        generate: { consumes: expect.arrayContaining(["input.prompt", "options.duration"]) },
        reference: { consumes: expect.arrayContaining(["input.images"]) },
        edit: { consumes: expect.arrayContaining(["input.video"]) },
      },
    })
  })

  it("maps text-to-video create, poll result, and cancel", async () => {
    const harness = createProviderHarness({
      plugin: happyhorseProvider,
      provider: "happyProxy",
      apiKey: "fal-secret",
      dimensions: {
        width: 1280,
        height: 720,
        aspectRatio: "16:9",
        normalizedRatio: 16 / 9,
        orientation: "landscape",
        resolutionTier: "1080p",
        size: "1280x720",
      },
      responses: [
        jsonResponse({
          request_id: "req_1",
          status_url: "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/status",
          response_url: "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/response",
          cancel_url: "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/cancel",
        }),
        jsonResponse({
          status: "COMPLETED",
          response_url: "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/response",
        }),
        jsonResponse({
          video: {
            url: "https://v3.fal.media/files/video.mp4",
            content_type: "video/mp4",
            width: 1920,
            height: 1080,
            duration: 5,
          },
          seed: 123,
        }),
        jsonResponse({ status: "CANCELLATION_REQUESTED" }),
      ],
    })

    const create = await happyhorseProvider.driver.create(
      harness.createContext({
        provider: "happyProxy",
        model: "happy-horse",
        type: "video",
        input: { prompt: "a cinematic market street" },
        options: { duration: 5, seed: 123 },
        providerOptions: { enable_safety_checker: true },
      }),
    )

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      expect(create.job.providerJobId).toBe("req_1")
      expect(harness.calls[0]?.url).toBe(
        "https://queue.fal.run/alibaba/happy-horse/text-to-video",
      )
      expect(harness.calls[0]?.init.headers).toMatchObject({
        Authorization: "Key fal-secret",
        "Content-Type": "application/json",
      })
      expect(jsonBody(harness.calls[0])).toMatchObject({
        prompt: "a cinematic market street",
        aspect_ratio: "16:9",
        resolution: "1080p",
        duration: 5,
        seed: 123,
        enable_safety_checker: true,
      })

      const polled = await happyhorseProvider.driver.poll?.(harness.pollContext(create.job))
      expect(harness.calls[1]?.url).toBe(
        "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/status",
      )
      expect(harness.calls[2]?.url).toBe(
        "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/response",
      )
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets[0]).toMatchObject({
        type: "video",
        url: "https://v3.fal.media/files/video.mp4",
        mimeType: "video/mp4",
        width: 1920,
        height: 1080,
        duration: 5,
      })

      await happyhorseProvider.driver.cancel?.(harness.cancelContext(create.job))
      expect(harness.calls[3]?.init.method).toBe("PUT")
      expect(harness.calls[3]?.url).toBe(
        "https://queue.fal.run/alibaba/happy-horse/text-to-video/requests/req_1/cancel",
      )
      harness.expectAllResponsesUsed()
    }
  })

  it("maps single and multiple images through reference-to-video", async () => {
    const imageHarness = createProviderHarness({
      plugin: happyhorseProvider,
      provider: "happyProxy",
      responses: [jsonResponse({ request_id: "i2v_1" })],
    })

    await happyhorseProvider.driver.create(
      imageHarness.createContext({
        provider: "happyProxy",
        model: "happy-horse",
        type: "video",
        input: {
          prompt: "animate this image",
          firstFrame: { type: "base64", data: "ZnJhbWU=", mimeType: "image/png" },
        },
        options: { duration: 7 },
      }),
    )

    expect(jsonBody(imageHarness.calls[0])).toMatchObject({
      image_urls: ["data:image/png;base64,ZnJhbWU="],
      prompt: "animate this image",
      aspect_ratio: "1:1",
      resolution: "1K",
      duration: 7,
    })
    expect(imageHarness.calls[0]?.url).toBe(
      "https://queue.fal.run/alibaba/happy-horse/reference-to-video",
    )

    const referenceHarness = createProviderHarness({
      plugin: happyhorseProvider,
      provider: "happyProxy",
      responses: [jsonResponse({ request_id: "r2v_1" })],
    })

    await happyhorseProvider.driver.create(
      referenceHarness.createContext({
        provider: "happyProxy",
        model: "happy-horse",
        type: "video",
        input: {
          prompt: "character1 and character2 dancing",
          images: [
            { url: "https://example.com/a.png" },
            { url: "https://example.com/b.png" },
          ],
        },
      }),
    )

    expect(jsonBody(referenceHarness.calls[0])).toMatchObject({
      prompt: "character1 and character2 dancing",
      image_urls: ["https://example.com/a.png", "https://example.com/b.png"],
      aspect_ratio: "1:1",
      resolution: "1K",
    })
  })

  it("maps video-edit source video and reference images", async () => {
    const harness = createProviderHarness({
      plugin: happyhorseProvider,
      provider: "happyProxy",
      responses: [jsonResponse({ request_id: "edit_1" })],
    })

    await happyhorseProvider.driver.create(
      harness.createContext({
        provider: "happyProxy",
        model: "happy-horse",
        type: "video",
        input: {
          prompt: "make the sky purple",
          video: { url: "https://example.com/source.mp4" },
          images: [{ url: "https://example.com/style.png" }],
        },
        providerOptions: { audio_setting: "origin" },
      }),
    )

    expect(jsonBody(harness.calls[0])).toMatchObject({
      video_url: "https://example.com/source.mp4",
      prompt: "make the sky purple",
      reference_image_urls: ["https://example.com/style.png"],
      resolution: "1K",
      audio_setting: "origin",
    })
    harness.expectAllResponsesUsed()
  })

  it("rejects unsupported HappyHorse input combinations", async () => {
    const harness = createProviderHarness({
      plugin: happyhorseProvider,
      provider: "happyProxy",
      responses: [],
    })

    await expect(
      happyhorseProvider.driver.create(
        harness.createContext({
          provider: "happyProxy",
          model: "happy-horse",
          type: "video",
          action: "reference",
          input: {
            prompt: "text only",
            video: { url: "https://example.com/source.mp4" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reference action does not consume source video"),
    })

    await expect(
      happyhorseProvider.driver.create(
        harness.createContext({
          provider: "happyProxy",
          model: "happy-horse",
          type: "video",
          action: "edit",
          input: {
            prompt: "edit",
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("edit action requires a source video"),
    })
    harness.expectFetchCount(0)
  })
})
