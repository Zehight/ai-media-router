import { describe, expect, it } from "vitest"
import { MediaRouterException } from "./errors.js"
import {
  nearestAspectRatio,
  ratioValue,
  resolveDimensions,
  resolveImageResolution,
  resolveVideoResolution,
} from "./dimensions.js"

const baseInput = {
  provider: "test-provider",
  model: "test-model",
} as const

describe("ratioValue", () => {
  it("resolves known ratios", () => {
    expect(ratioValue("16:9")).toBeCloseTo(16 / 9)
    expect(ratioValue("9:16")).toBeCloseTo(9 / 16)
    expect(ratioValue("1:1")).toBe(1)
  })

  it("parses custom ratio strings", () => {
    expect(ratioValue("3:2")).toBeCloseTo(1.5)
    expect(ratioValue("2.35:1")).toBeCloseTo(2.35)
  })

  it("falls back to square for invalid ratio strings", () => {
    expect(ratioValue("invalid")).toBe(1)
  })
})

describe("nearestAspectRatio", () => {
  it("selects the closest landscape ratio", () => {
    expect(nearestAspectRatio(1920, 1080, ["1:1", "16:9", "9:16"])).toBe(
      "16:9",
    )
  })

  it("selects the closest portrait ratio", () => {
    expect(nearestAspectRatio(1440, 2560, ["1:1", "16:9", "9:16"])).toBe(
      "9:16",
    )
  })

  it("uses log-distance so near ratios compare symmetrically", () => {
    expect(nearestAspectRatio(1000, 760, ["1:1", "4:3", "16:9"])).toBe("4:3")
  })
})

describe("resolution helpers", () => {
  it("maps image dimensions by pixel area", () => {
    expect(resolveImageResolution(512, 512)).toBe("0.5K")
    expect(resolveImageResolution(1024, 1024)).toBe("1K")
    expect(resolveImageResolution(2048, 2048)).toBe("2K")
    expect(resolveImageResolution(4096, 4096)).toBe("4K")
  })

  it("maps video dimensions by edge size", () => {
    expect(resolveVideoResolution(854, 480)).toBe("480p")
    expect(resolveVideoResolution(1280, 720)).toBe("720p")
    expect(resolveVideoResolution(1920, 1080)).toBe("1080p")
    expect(resolveVideoResolution(1080, 1920)).toBe("1080p")
  })
})

describe("resolveDimensions", () => {
  it("returns undefined when width and height are both absent", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
      }),
    ).toBeUndefined()
  })

  it("rejects partial dimensions", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1024,
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects non-positive dimensions", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 0,
        height: 1024,
      }),
    ).toThrow(MediaRouterException)
  })

  it("resolves square image dimensions", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1024,
        height: 1024,
      }),
    ).toMatchObject({
      width: 1024,
      height: 1024,
      aspectRatio: "1:1",
      orientation: "square",
      resolutionTier: "1K",
      size: "1024x1024",
    })
  })

  it("resolves landscape video dimensions", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "video",
        width: 1920,
        height: 1080,
      }),
    ).toMatchObject({
      aspectRatio: "16:9",
      orientation: "landscape",
      resolutionTier: "1080p",
      size: "1920x1080",
    })
  })

  it("resolves portrait video dimensions", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "video",
        width: 1440,
        height: 2560,
      }),
    ).toMatchObject({
      aspectRatio: "9:16",
      orientation: "portrait",
      resolutionTier: "1080p",
      size: "1440x2560",
    })
  })

  it("uses provider-supported aspect ratios", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1200,
        height: 900,
        capabilities: {
          aspectRatios: ["1:1", "4:3"],
        },
      }),
    ).toMatchObject({
      aspectRatio: "4:3",
    })
  })

  it("uses provider size format", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 2048,
        height: 2048,
        capabilities: {
          image: {
            sizeFormat: "*",
          },
        },
      }),
    ).toMatchObject({
      size: "2048*2048",
    })
  })

  it("allows exact strict dimensions", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "video",
        width: 1920,
        height: 1080,
        mode: "strict",
        capabilities: {
          aspectRatios: ["16:9"],
        },
      }),
    ).toMatchObject({
      aspectRatio: "16:9",
    })
  })

  it("rejects non-matching strict dimensions", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "video",
        width: 1234,
        height: 777,
        mode: "strict",
        capabilities: {
          aspectRatios: ["16:9"],
        },
      }),
    ).toThrow(MediaRouterException)
  })
})
