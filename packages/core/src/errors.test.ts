import { describe, expect, it } from "vitest"
import {
  createMediaRouterError,
  isMediaRouterErrorLike,
  MediaRouterException,
  normalizeMediaRouterError,
  normalizeUnknownError,
} from "./errors.js"

describe("media router errors", () => {
  it("recognizes only complete MediaRouterError-like objects", () => {
    expect(
      isMediaRouterErrorLike(
        createMediaRouterError("RATE_LIMITED", "slow down", {
          provider: "provider",
          model: "model",
          retryable: true,
        }),
      ),
    ).toBe(true)

    expect(
      isMediaRouterErrorLike({
        code: "RATE_LIMITED",
        message: "provider sdk error",
        provider: "stripe",
        retryable: true,
      }),
    ).toBe(false)

    expect(
      isMediaRouterErrorLike({
        kind: "MediaRouterError",
        code: "RATE_LIMITED",
        message: "bad status code",
        provider: "provider",
        retryable: true,
        statusCode: "429",
      }),
    ).toBe(false)
  })

  it("normalizes MediaRouterException and plain MediaRouterError details", () => {
    const fallback = { provider: "fallback", model: "fallback-model" }
    const details = createMediaRouterError("CONTENT_REJECTED", "blocked", {
      provider: "source",
      model: "source-model",
      statusCode: 400,
      raw: { reason: "policy" },
    })

    expect(normalizeMediaRouterError(new MediaRouterException(details), fallback))
      .toMatchObject(details)
    expect(normalizeMediaRouterError(details, fallback)).toMatchObject(details)
  })

  it("keeps third-party code/message errors as unknown errors", () => {
    expect(
      normalizeUnknownError(
        { code: "insufficient_quota", message: "provider sdk error" },
        { provider: "provider", model: "model" },
      ),
    ).toMatchObject({
      code: "UNKNOWN",
      provider: "provider",
      model: "model",
    })
  })
})
