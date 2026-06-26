import { describe, expect, it } from "vitest"
import {
  createProviderHarness,
  jsonBody,
  textResponse,
} from "../test-harness.js"
import { googleProvider } from "./provider.js"

describe("googleProvider", () => {
  it("maps image inputs and parses SSE image responses through defineHttpProvider", async () => {
    const harness = createProviderHarness({
      plugin: googleProvider,
      provider: "googleProxy",
      responses: [
        textResponse(
          [
            'data: {"candidates":[{"content":{"parts":[{"text":"working"}]}}]}',
            'data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"YWJj"}}]}}]}',
            "",
          ].join("\n"),
        ),
      ],
    })

    const output = await googleProvider.driver.create(
      harness.createContext({
        provider: "googleProxy",
        model: "gemini-2.5-flash-image",
        type: "image",
        input: {
          prompt: "test",
          images: [
            {
              type: "base64",
              data: "cmVm",
              mimeType: "image/png",
            },
          ],
        },
      }),
    )

    expect(output.kind).toBe("completed")
    if (output.kind === "completed") {
      expect(output.result.assets[0]).toMatchObject({
        type: "image",
        base64: "YWJj",
        mimeType: "image/png",
      })
    }

    expect(harness.calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=secret",
    )
    expect(jsonBody(harness.calls[0])).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [
            { text: "test" },
            {
              inlineData: {
                data: "cmVm",
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
    })
    harness.expectAllResponsesUsed()
  })

  it("requires images for reference action and rejects masks", async () => {
    const harness = createProviderHarness({
      plugin: googleProvider,
      provider: "googleProxy",
      responses: [],
    })

    await expect(
      googleProvider.driver.create(
        harness.createContext({
          provider: "googleProxy",
          model: "gemini-2.5-flash-image",
          type: "image",
          action: "reference",
          input: { prompt: "test" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reference action requires images"),
    })

    await expect(
      googleProvider.driver.create(
        harness.createContext({
          provider: "googleProxy",
          model: "gemini-2.5-flash-image",
          type: "image",
          input: {
            prompt: "test",
            mask: { url: "https://example.com/mask.png" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("input.mask"),
    })
    harness.expectFetchCount(0)
  })

  it("rejects unsupported image actions", async () => {
    const harness = createProviderHarness({
      plugin: googleProvider,
      provider: "googleProxy",
      responses: [],
    })

    await expect(
      googleProvider.driver.create(
        harness.createContext({
          provider: "googleProxy",
          model: "gemini-2.5-flash-image",
          type: "image",
          action: "edit",
          input: { prompt: "test" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unsupported action: edit",
    })
    harness.expectFetchCount(0)
  })
})
