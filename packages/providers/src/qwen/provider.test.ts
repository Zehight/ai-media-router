import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  jsonResponse,
} from "../test-harness.js"
import { qwenModels } from "./definition.js"
import { qwenProvider } from "./provider.js"

describe("qwenProvider", () => {
  it("documents generation and editing facade actions", () => {
    expect(qwenModels["qwen-image-2.0-pro"]?.capabilities?.actions).toMatchObject({
      generate: { consumes: expect.arrayContaining(["input.prompt"]) },
      reference: { consumes: expect.arrayContaining(["input.images"]) },
      edit: { consumes: expect.arrayContaining(["input.images"]) },
    })
    expect(qwenModels["qwen-image-plus"]?.async).toBe(true)
    expect(qwenModels["qwen-image-plus"]?.capabilities?.actions).toMatchObject({
      generate: { consumes: expect.arrayContaining(["input.prompt"]) },
    })
  })

  it("maps synchronous text-to-image requests and response assets", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      config: {
        baseURL: "https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1",
      },
      dimensions: {
        width: 1033,
        height: 1032,
        fmtWidth: 1040,
        fmtHeight: 1024,
        aspectRatio: "1:1",
        normalizedRatio: 1033 / 1032,
        orientation: "landscape",
        resolutionTier: "1K",
        size: "1033*1032",
      },
      responses: [
        jsonResponse({
          output: {
            choices: [
              {
                message: {
                  content: [
                    {
                      image: "https://dashscope-result.example.com/image.png",
                    },
                  ],
                },
              },
            ],
          },
          usage: { width: 1040, height: 1024, image_count: 1 },
        }),
      ],
    })

    const output = await qwenProvider.driver.create(
      harness.createContext({
        provider: "qwenProxy",
        model: "qwen-image-2.0-pro",
        type: "image",
        input: {
          prompt: "poster with readable text",
          negativePrompt: "blur",
        },
        options: { count: 2, seed: 12 },
        providerOptions: { prompt_extend: false, watermark: false },
      }),
    )

    expect(output.kind).toBe("completed")
    if (output.kind === "completed") {
      expect(output.result.assets[0]).toMatchObject({
        type: "image",
        url: "https://dashscope-result.example.com/image.png",
        mimeType: "image/png",
      })
    }
    expect(harness.calls[0]?.url).toBe(
      "https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    )
    expect(harness.calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
    })
    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "qwen-image-2.0-pro",
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: "poster with readable text" }],
          },
        ],
      },
      parameters: {
        n: 2,
        negative_prompt: "blur",
        size: "1040*1024",
        seed: 12,
        prompt_extend: false,
        watermark: false,
      },
    })
    harness.expectAllResponsesUsed()
  })

  it("maps image reference requests through multimodal content without action", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      responses: [
        jsonResponse({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://dashscope-result.example.com/edit.png" }],
                },
              },
            ],
          },
        }),
      ],
    })

    await qwenProvider.driver.create(
      harness.createContext({
        provider: "qwenProxy",
        model: "qwen-image-2.0-pro",
        type: "image",
        input: {
          prompt: "replace the logo text",
          images: [
            { url: "https://example.com/source.png" },
            { type: "base64", data: "cmVm", mimeType: "image/png" },
          ],
        },
      }),
    )

    expect(jsonBody(harness.calls[0])).toMatchObject({
      input: {
        messages: [
          {
            content: [
              { image: "https://example.com/source.png" },
              { image: "data:image/png;base64,cmVm" },
              { text: "replace the logo text" },
            ],
          },
        ],
      },
    })
    harness.expectAllResponsesUsed()
  })

  it("maps edit model image inputs without action", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      responses: [
        jsonResponse({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://dashscope-result.example.com/edit-plus.png" }],
                },
              },
            ],
          },
        }),
      ],
    })

    await qwenProvider.driver.create(
      harness.createContext({
        provider: "qwenProxy",
        model: "qwen-image-edit-plus",
        type: "image",
        input: {
          prompt: "remove the logo",
          images: [{ url: "https://example.com/source.png" }],
        },
      }),
    )

    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "qwen-image-edit-plus",
      input: {
        messages: [
          {
            content: [
              { image: "https://example.com/source.png" },
              { text: "remove the logo" },
            ],
          },
        ],
      },
    })
    harness.expectAllResponsesUsed()
  })

  it("rejects unsupported actions and unsupported standard inputs", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      responses: [],
    })

    await expect(
      qwenProvider.driver.create(
        harness.createContext({
          provider: "qwenProxy",
          model: "qwen-image-max",
          type: "image",
          action: "reference",
          input: {
            prompt: "use image",
            images: [{ url: "https://example.com/ref.png" }],
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("model does not support reference images"),
    })

    await expect(
      qwenProvider.driver.create(
        harness.createContext({
          provider: "qwenProxy",
          model: "qwen-image-2.0-pro",
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
      qwenProvider.driver.create(
        harness.createContext({
          provider: "qwenProxy",
          model: "qwen-image-2.0-pro",
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
      message: expect.stringContaining("edit action requires images"),
    })
    harness.expectFetchCount(0)
  })

  it("maps asynchronous qwen-image task create and polling", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      responses: [
        jsonResponse({
          output: {
            task_id: "task_1",
            task_status: "PENDING",
          },
        }),
        jsonResponse({
          output: {
            task_id: "task_1",
            task_status: "SUCCEEDED",
            results: [{ url: "https://dashscope-result.example.com/async.png" }],
          },
        }),
      ],
    })

    const create = await qwenProvider.driver.create(
      harness.createContext({
        provider: "qwenProxy",
        model: "qwen-image-plus",
        type: "image",
        input: { prompt: "async image" },
        providerOptions: { watermark: false },
      }),
    )

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      expect(create.job.providerJobId).toBe("task_1")
      expect(create.job.status).toBe("queued")
      expect(harness.calls[0]?.url).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
      )
      expect(harness.calls[0]?.init.headers).toMatchObject({
        "X-DashScope-Async": "enable",
      })
      expect(jsonBody(harness.calls[0])).toMatchObject({
        model: "qwen-image-plus",
        input: { prompt: "async image" },
        parameters: { watermark: false },
      })

      const polled = await qwenProvider.driver.poll?.(harness.pollContext(create.job))
      expect(harness.calls[1]?.url).toBe(
        "https://dashscope.aliyuncs.com/api/v1/tasks/task_1",
      )
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets[0]).toMatchObject({
        type: "image",
        url: "https://dashscope-result.example.com/async.png",
      })
      harness.expectAllResponsesUsed()
    }
  })

  it("maps Wan text-to-video task create and polling", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      dimensions: {
        width: 1280,
        height: 720,
        aspectRatio: "16:9",
        normalizedRatio: 16 / 9,
        orientation: "landscape",
        resolutionTier: "720p",
        size: "1280*720",
      },
      responses: [
        jsonResponse({
          output: {
            task_id: "video_task_1",
            task_status: "PENDING",
          },
        }),
        jsonResponse({
          output: {
            task_id: "video_task_1",
            task_status: "SUCCEEDED",
            video_url: "https://dashscope-result.example.com/video.mp4",
          },
        }),
      ],
    })

    const create = await qwenProvider.driver.create(
      harness.createContext({
        provider: "qwenProxy",
        model: "wan2.7",
        type: "video",
        input: {
          prompt: "a cinematic product reveal",
          negativePrompt: "low quality",
        },
        options: { duration: 10, seed: 42 },
        providerOptions: { prompt_extend: true, watermark: false },
      }),
    )

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      expect(harness.calls[0]?.url).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
      )
      expect(harness.calls[0]?.init.headers).toMatchObject({
        "X-DashScope-Async": "enable",
      })
      expect(jsonBody(harness.calls[0])).toMatchObject({
        model: "wan2.7-t2v",
        input: {
          prompt: "a cinematic product reveal",
          negative_prompt: "low quality",
        },
        parameters: {
          resolution: "720P",
          duration: 10,
          seed: 42,
          prompt_extend: true,
          watermark: false,
        },
      })

      const polled = await qwenProvider.driver.poll?.(harness.pollContext(create.job))
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets[0]).toMatchObject({
        type: "video",
        url: "https://dashscope-result.example.com/video.mp4",
        mimeType: "video/mp4",
      })
      harness.expectAllResponsesUsed()
    }
  })

  it("maps Wan media inputs without action", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      responses: [
        jsonResponse({
          output: {
            task_id: "i2v_task_1",
            task_status: "PENDING",
          },
        }),
      ],
    })

    await qwenProvider.driver.create(
      harness.createContext({
        provider: "qwenProxy",
        model: "wan2.7",
        type: "video",
        input: {
          prompt: "animate these frames",
          images: [
            { url: "https://example.com/first.png" },
            { type: "base64", data: "bGFzdA==", mimeType: "image/png" },
          ],
          audio: { url: "https://example.com/music.mp3" },
        },
        options: { duration: 5 },
      }),
    )

    expect(jsonBody(harness.calls[0])).toMatchObject({
      model: "wan2.7-i2v",
      input: {
        prompt: "animate these frames",
        media: [
          { type: "first_frame", url: "https://example.com/first.png" },
          { type: "last_frame", url: "data:image/png;base64,bGFzdA==" },
          { type: "driving_audio", url: "https://example.com/music.mp3" },
        ],
      },
      parameters: { duration: 5 },
    })
    harness.expectAllResponsesUsed()
  })

  it("rejects invalid Wan video input combinations", async () => {
    const harness = createProviderHarness({
      plugin: qwenProvider,
      provider: "qwenProxy",
      responses: [],
    })

    await expect(
      qwenProvider.driver.create(
        harness.createContext({
          provider: "qwenProxy",
          model: "wan2.7",
          type: "video",
          input: {
            prompt: "mixed media",
            video: { url: "https://example.com/source.mp4" },
            firstFrame: { url: "https://example.com/frame.png" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("cannot combine input.video"),
    })

    await expect(
      qwenProvider.driver.create(
        harness.createContext({
          provider: "qwenProxy",
          model: "wan2.7",
          type: "video",
          action: "reference",
          input: { prompt: "missing media" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reference action requires media input"),
    })
    harness.expectFetchCount(0)
  })
})
