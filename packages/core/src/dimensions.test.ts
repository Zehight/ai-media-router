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
  it("maps image dimensions by equivalent square side", () => {
    expect(resolveImageResolution(512, 512)).toBe("0.5K")
    expect(resolveImageResolution(1024, 1024)).toBe("1K")
    expect(resolveImageResolution(2048, 2048)).toBe("2K")
    expect(resolveImageResolution(2304, 4096)).toBe("3K")
    expect(resolveImageResolution(3040, 5504)).toBe("4K")
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

  it("maps video dimensions to supported provider resolution tiers", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "video",
        width: 1920,
        height: 1080,
        capabilities: {
          video: {
            resolutions: ["720p"],
          },
        },
      }),
    ).toMatchObject({
      width: 1280,
      height: 720,
      resolutionTier: "720p",
      size: "1280x720",
      providerSize: "720p",
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

  it("maps image dimensions to the nearest provider-supported size", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1000,
        height: 1000,
        capabilities: {
          image: {
            supportedSizes: ["1024x1024", "1536x1024", "1024x1536"],
          },
        },
      }),
    ).toMatchObject({
      width: 1024,
      height: 1024,
      size: "1024x1024",
      providerSize: "1024x1024",
    })
  })

  it("rejects unsupported provider image sizes in strict mode", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1000,
        height: 1000,
        mode: "strict",
        capabilities: {
          image: {
            supportedSizes: ["1024x1024"],
          },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("maps image resolution tiers to supported provider tiers", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 4096,
        height: 4096,
        capabilities: {
          image: {
            resolutionTiers: ["1K", "2K"],
          },
        },
      }),
    ).toMatchObject({
      resolutionTier: "2K",
      providerSize: "2K",
    })
  })

  it("rejects image dimensions above provider limits by default", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 4096,
        height: 2048,
        capabilities: {
          image: {
            maxWidth: 2048,
            maxHeight: 2048,
          },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("clamps image dimensions when provider strategy is clamp", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 4096,
        height: 2048,
        capabilities: {
          strategy: "clamp",
          image: {
            maxWidth: 2048,
            maxHeight: 2048,
          },
        },
      }),
    ).toMatchObject({
      width: 2048,
      height: 1024,
      size: "2048x1024",
    })
  })

  it("returns fixed 16-aligned formatted image dimensions without changing width and height", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1537,
        height: 864,
      }),
    ).toMatchObject({
      width: 1537,
      height: 864,
      fmtWidth: 1536,
      fmtHeight: 864,
      size: "1537x864",
    })
  })

  it("still returns fixed 16-aligned formatted image dimensions in strict mode", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 1537,
        height: 864,
        mode: "strict",
      }),
    ).toMatchObject({
      width: 1537,
      height: 864,
      fmtWidth: 1536,
      fmtHeight: 864,
    })
  })

  it("rejects image dimensions outside provider aspect ratio limits", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 4096,
        height: 1024,
        capabilities: {
          image: {
            minAspectRatio: 1 / 3,
            maxAspectRatio: 3,
          },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects image dimensions above provider pixel limits", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 4096,
        height: 4096,
        capabilities: {
          image: {
            maxPixels: 3840 * 2160,
          },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("rejects image dimensions below provider pixel limits", () => {
    expect(() =>
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 512,
        height: 512,
        capabilities: {
          image: {
            minPixels: 655_360,
          },
        },
      }),
    ).toThrow(MediaRouterException)
  })

  it("clamps image dimensions and returns fixed 16-aligned formatted image dimensions", () => {
    expect(
      resolveDimensions({
        ...baseInput,
        mediaType: "image",
        width: 4097,
        height: 2049,
        capabilities: {
          strategy: "clamp",
          image: {
            maxWidth: 2048,
            maxHeight: 2048,
          },
        },
      }),
    ).toMatchObject({
      width: 2048,
      height: 1024,
      fmtWidth: 2048,
      fmtHeight: 1024,
      size: "2048x1024",
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
