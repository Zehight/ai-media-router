import { describe, expect, it } from "vitest"
import { openaiProvider } from "./openai/provider.js"
import {
  createProviderHarness,
  jsonResponse,
  rawResponse,
  textResponse,
} from "./test-harness.js"

describe("provider test harness", () => {
  it("treats provider payload status fields as JSON body data", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      responses: [jsonResponse({ status: 200, id: "job_1" })],
    })

    const response = await harness.fetch("https://api.example.com/test")

    await expect(response.json()).resolves.toMatchObject({
      status: 200,
      id: "job_1",
    })
  })

  it("supports text and raw response bodies", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      responses: [
        textResponse("data: done"),
        rawResponse(new URLSearchParams({ ok: "true" })),
      ],
    })

    await expect(harness.fetch("https://api.example.com/text").then((item) => item.text()))
      .resolves.toBe("data: done")
    await expect(harness.fetch("https://api.example.com/raw").then((item) => item.text()))
      .resolves.toBe("ok=true")
    expect(() => harness.expectAllResponsesUsed()).not.toThrow()
  })

  it("records Request object method, headers, and body", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      responses: [jsonResponse({ ok: true })],
    })

    await harness.fetch(
      new Request("https://api.example.com/request", {
        method: "POST",
        headers: { "x-test": "yes" },
        body: "payload",
      }),
    )

    expect(harness.calls[0]).toMatchObject({
      url: "https://api.example.com/request",
      init: {
        method: "POST",
        body: "payload",
      },
    })
    expect(harness.calls[0].init.headers).toMatchObject({
      "x-test": "yes",
    })
    harness.expectAllResponsesUsed()
  })

  it("fails on unexpected fetch calls", async () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      responses: [],
    })

    await expect(harness.fetch("https://api.example.com/missing")).rejects.toThrow(
      "Unexpected provider fetch call #1",
    )
  })

  it("fails when queued responses are not consumed", () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      responses: [jsonResponse({ ok: true })],
    })

    expect(() => harness.expectAllResponsesUsed()).toThrow(
      "Expected all 1 provider responses to be used, got 0 fetch calls",
    )
    expect(() => harness.expectFetchCount(1)).toThrow(
      "Expected 1 provider fetch calls, got 0",
    )
  })

  it("fails when the request model is not on the provider", () => {
    const harness = createProviderHarness({
      plugin: openaiProvider,
      responses: [],
    })

    expect(() =>
      harness.createContext({
        provider: "openaiProxy",
        model: "missing-model",
        type: "image",
        input: { prompt: "test" },
      }),
    ).toThrow('Provider test harness could not find model "missing-model"')
  })
})
