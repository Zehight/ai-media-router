import { throwMediaRouterError } from "./errors.js"
import type { DimensionMode, MediaType, ResolvedDimensions } from "./types.js"

export type DimensionCapabilities = {
  aspectRatios?: string[]
  image?: {
    sizeFormat?: "x" | "*"
    supportedSizes?: string[]
    resolutionTiers?: string[]
    maxWidth?: number
    maxHeight?: number
  }
  video?: {
    resolutions?: string[]
    maxDuration?: number
    durations?: number[]
  }
  strategy?: DimensionMode | "clamp"
}

export type ResolveDimensionsInput = {
  width?: number
  height?: number
  mediaType: MediaType
  capabilities?: DimensionCapabilities
  mode?: DimensionMode
  provider: string
  model: string
}

const COMMON_RATIOS: Record<string, number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "21:9": 21 / 9,
  "9:21": 9 / 21,
}

export function ratioValue(name: string): number {
  const known = COMMON_RATIOS[name]
  if (known) return known
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(name)
  if (!match) return 1
  return Number(match[1]) / Number(match[2])
}

export function nearestAspectRatio(
  width: number,
  height: number,
  supported: string[] = Object.keys(COMMON_RATIOS),
): string {
  const ratio = width / height
  return supported
    .map((name) => ({
      name,
      delta: Math.abs(Math.log(ratio / ratioValue(name))),
    }))
    .sort((a, b) => a.delta - b.delta)[0]?.name ?? "1:1"
}

export function resolveImageResolution(width: number, height: number): string {
  const pixels = width * height
  if (pixels >= 3000 * 3000) return "4K"
  if (pixels >= 1600 * 1600) return "2K"
  if (pixels >= 900 * 900) return "1K"
  return "0.5K"
}

export function resolveVideoResolution(width: number, height: number): string {
  const maxSide = Math.max(width, height)
  const minSide = Math.min(width, height)
  if (maxSide >= 1920 || minSide >= 1080) return "1080p"
  if (maxSide >= 1280 || minSide >= 720) return "720p"
  return "480p"
}

export function resolveDimensions(
  input: ResolveDimensionsInput,
): ResolvedDimensions | undefined {
  if (input.width == null && input.height == null) return undefined
  if (!input.width || !input.height || input.width <= 0 || input.height <= 0) {
    throwMediaRouterError("BAD_REQUEST", "width and height must be positive", {
      provider: input.provider,
      model: input.model,
    })
  }

  const mode = input.mode ?? "nearest"
  const supportedRatios =
    input.capabilities?.aspectRatios ?? Object.keys(COMMON_RATIOS)
  const aspectRatio = nearestAspectRatio(input.width, input.height, supportedRatios)

  if (mode === "strict") {
    const exact = Math.abs(Math.log(input.width / input.height / ratioValue(aspectRatio)))
    if (exact > 0.01) {
      throwMediaRouterError(
        "BAD_REQUEST",
        `Requested dimensions do not match a supported aspect ratio: ${input.width}x${input.height}`,
        { provider: input.provider, model: input.model },
      )
    }
  }

  const orientation =
    input.width === input.height
      ? "square"
      : input.width > input.height
        ? "landscape"
        : "portrait"

  const resolutionTier =
    input.mediaType === "video"
      ? resolveVideoResolution(input.width, input.height)
      : resolveImageResolution(input.width, input.height)

  const sizeFormat = input.capabilities?.image?.sizeFormat ?? "x"
  const size = `${input.width}${sizeFormat}${input.height}`

  return {
    width: input.width,
    height: input.height,
    aspectRatio,
    normalizedRatio: input.width / input.height,
    orientation,
    resolutionTier,
    size,
  }
}
