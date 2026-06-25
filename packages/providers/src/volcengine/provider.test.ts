import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
} from "../test-harness.js"
import { volcengineProvider } from "./provider.js"

describe("volcengineProvider", () => {
  it("maps image requests with prompt flags and reference image", async () => {
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
          images: [
            {
              type: "base64",
              data: "cmVm",
              mimeType: "image/png",
            },
          ],
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
      image: {
        data: "cmVm",
        mime_type: "image/png",
      },
      size: "2048x2048",
      response_format: "url",
      watermark: false,
      guidance_scale: 7,
    })
    harness.expectAllResponsesUsed()
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
          cameraFixed: true,
          audioEnabled: true,
        },
        providerOptions: { watermark: false },
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
            text: "a train passing a mountain --ratio 16:9 --resolution 720p --duration 5 --camerafixed true",
          },
        ],
        generate_audio: true,
        watermark: false,
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
})
