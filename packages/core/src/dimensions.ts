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
    minPixels?: number
    maxPixels?: number
    minAspectRatio?: number
    maxAspectRatio?: number
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

const VIDEO_TIER_SHORT_SIDE: Record<string, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
}

const IMAGE_RESOLUTION_TIERS = ["0.5K", "1K", "2K", "3K", "4K"] as const

type SizeCandidate = {
  value: string
  width: number
  height: number
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
  const effectiveK = Math.sqrt(width * height) / 1024
  return nearestSupportedTier(`${effectiveK}K`, [...IMAGE_RESOLUTION_TIERS])
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
  if (
    !isPositiveFiniteNumber(input.width) ||
    !isPositiveFiniteNumber(input.height)
  ) {
    throwMediaRouterError("BAD_REQUEST", "width and height must be positive", {
      provider: input.provider,
      model: input.model,
    })
  }

  const mode = input.mode ?? "nearest"
  const supportedRatios =
    input.capabilities?.aspectRatios ?? Object.keys(COMMON_RATIOS)
  const imageCapabilities = input.capabilities?.image
  const videoCapabilities = input.capabilities?.video
  const supportedImageSizes = parseSupportedSizes(
    imageCapabilities?.supportedSizes,
    imageCapabilities?.sizeFormat,
  )
  const providerImageSize =
    input.mediaType === "image" && supportedImageSizes.length
      ? resolveSupportedImageSize(input.width, input.height, supportedImageSizes, {
          mode,
          provider: input.provider,
          model: input.model,
        })
      : undefined

  const boundedDimensions =
    input.mediaType === "image" && !providerImageSize
      ? resolveImageBounds(input.width, input.height, {
          maxWidth: imageCapabilities?.maxWidth,
          maxHeight: imageCapabilities?.maxHeight,
          minPixels: imageCapabilities?.minPixels,
          maxPixels: imageCapabilities?.maxPixels,
          minAspectRatio: imageCapabilities?.minAspectRatio,
          maxAspectRatio: imageCapabilities?.maxAspectRatio,
          strategy: input.capabilities?.strategy,
          provider: input.provider,
          model: input.model,
        })
      : undefined
  const resolvedWidth = providerImageSize?.width ?? boundedDimensions?.width ?? input.width
  const resolvedHeight = providerImageSize?.height ?? boundedDimensions?.height ?? input.height
  const formattedDimensions =
    input.mediaType === "image" && !providerImageSize
      ? resolveFormattedDimensions(resolvedWidth, resolvedHeight, {
          maxWidth: imageCapabilities?.maxWidth,
          maxHeight: imageCapabilities?.maxHeight,
        })
      : undefined
  const aspectRatio = nearestAspectRatio(resolvedWidth, resolvedHeight, supportedRatios)

  if (mode === "strict") {
    const exact = Math.abs(Math.log(resolvedWidth / resolvedHeight / ratioValue(aspectRatio)))
    if (exact > 0.01) {
      throwMediaRouterError(
        "BAD_REQUEST",
        `Requested dimensions do not match a supported aspect ratio: ${input.width}x${input.height}`,
        { provider: input.provider, model: input.model },
      )
    }
  }

  const orientation =
    resolvedWidth === resolvedHeight
      ? "square"
      : resolvedWidth > resolvedHeight
        ? "landscape"
        : "portrait"

  const rawResolutionTier =
    input.mediaType === "video"
      ? resolveVideoResolution(resolvedWidth, resolvedHeight)
      : resolveImageResolution(resolvedWidth, resolvedHeight)
  const hasProviderResolutionSet =
    input.mediaType === "video"
      ? Boolean(videoCapabilities?.resolutions?.length)
      : Boolean(imageCapabilities?.resolutionTiers?.length)
  const resolutionTier =
    input.mediaType === "video"
      ? resolveSupportedValue(rawResolutionTier, videoCapabilities?.resolutions, {
          mode,
          provider: input.provider,
          model: input.model,
          capability: "resolution",
        })
      : resolveSupportedValue(rawResolutionTier, imageCapabilities?.resolutionTiers, {
          mode,
          provider: input.provider,
          model: input.model,
          capability: "resolution tier",
        })

  const sizeFormat = imageCapabilities?.sizeFormat ?? "x"
  const providerVideoDimensions =
    input.mediaType === "video" && hasProviderResolutionSet
      ? resolveVideoTierDimensions(resolvedWidth, resolvedHeight, resolutionTier)
      : undefined
  const outputWidth = providerVideoDimensions?.width ?? resolvedWidth
  const outputHeight = providerVideoDimensions?.height ?? resolvedHeight
  const size = providerImageSize?.value ?? `${outputWidth}${sizeFormat}${outputHeight}`

  return {
    width: outputWidth,
    height: outputHeight,
    fmtWidth: formattedDimensions?.fmtWidth,
    fmtHeight: formattedDimensions?.fmtHeight,
    aspectRatio,
    normalizedRatio: outputWidth / outputHeight,
    orientation,
    resolutionTier,
    size,
    providerSize:
      providerImageSize?.value ??
      (hasProviderResolutionSet ? resolutionTier : undefined),
  }
}

function resolveVideoTierDimensions(
  width: number,
  height: number,
  resolutionTier: string,
): { width: number; height: number } | undefined {
  const shortSide = VIDEO_TIER_SHORT_SIDE[resolutionTier]
  if (!shortSide) return undefined
  const currentShortSide = Math.min(width, height)
  if (currentShortSide <= shortSide) return undefined
  const scale = shortSide / currentShortSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function isPositiveFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function parseSupportedSizes(
  sizes: string[] | undefined,
  sizeFormat = "x",
): SizeCandidate[] {
  return (
    sizes
      ?.map((value) => {
        const escaped = escapeRegExp(sizeFormat)
        const match = new RegExp(`^(\\d+)${escaped}(\\d+)$`).exec(value)
        if (!match) return undefined
        return {
          value,
          width: Number(match[1]),
          height: Number(match[2]),
        }
      })
      .filter((value): value is SizeCandidate => Boolean(value)) ?? []
  )
}

function resolveSupportedImageSize(
  width: number,
  height: number,
  supportedSizes: SizeCandidate[],
  options: {
    mode: DimensionMode
    provider: string
    model: string
  },
): SizeCandidate {
  const exact = supportedSizes.find(
    (candidate) => candidate.width === width && candidate.height === height,
  )
  if (exact) return exact
  if (options.mode === "strict") {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Requested image size is not supported: ${width}x${height}`,
      { provider: options.provider, model: options.model },
    )
  }
  return supportedSizes
    .map((candidate) => ({
      candidate,
      delta:
        Math.abs(Math.log(width / candidate.width)) +
        Math.abs(Math.log(height / candidate.height)),
    }))
    .sort((a, b) => a.delta - b.delta)[0]?.candidate as SizeCandidate
}

function resolveImageBounds(
  width: number,
  height: number,
  options: {
    maxWidth?: number
    maxHeight?: number
    minPixels?: number
    maxPixels?: number
    minAspectRatio?: number
    maxAspectRatio?: number
    strategy?: DimensionCapabilities["strategy"]
    provider: string
    model: string
  },
): { width: number; height: number } | undefined {
  const widthOverflow = options.maxWidth != null && width > options.maxWidth
  const heightOverflow = options.maxHeight != null && height > options.maxHeight
  const pixelsUnderflow = options.minPixels != null && width * height < options.minPixels
  const pixelsOverflow = options.maxPixels != null && width * height > options.maxPixels
  const aspectRatio = width / height
  const aspectRatioTooSmall =
    options.minAspectRatio != null && aspectRatio < options.minAspectRatio
  const aspectRatioTooLarge =
    options.maxAspectRatio != null && aspectRatio > options.maxAspectRatio
  const unsupported =
    widthOverflow ||
    heightOverflow ||
    pixelsUnderflow ||
    pixelsOverflow ||
    aspectRatioTooSmall ||
    aspectRatioTooLarge
  if (!unsupported) return undefined
  if (
    options.strategy !== "clamp" ||
    pixelsUnderflow ||
    aspectRatioTooSmall ||
    aspectRatioTooLarge
  ) {
    throwUnsupportedImageDimensions(width, height, options)
  }
  const widthScale = options.maxWidth == null ? 1 : options.maxWidth / width
  const heightScale = options.maxHeight == null ? 1 : options.maxHeight / height
  const pixelScale =
    options.maxPixels == null ? 1 : Math.sqrt(options.maxPixels / (width * height))
  const scale = Math.min(widthScale, heightScale, pixelScale, 1)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function throwUnsupportedImageDimensions(
  width: number,
  height: number,
  options: {
    provider: string
    model: string
  },
): never {
  throwMediaRouterError(
    "BAD_REQUEST",
    `Requested image dimensions exceed provider limits: ${width}x${height}`,
    { provider: options.provider, model: options.model },
  )
}

function alignToMultiple(
  value: number,
  multiple: number,
  maxValue: number | undefined,
): number {
  const lower = Math.max(multiple, Math.floor(value / multiple) * multiple)
  const upper = Math.max(multiple, Math.ceil(value / multiple) * multiple)
  const candidates = [lower, upper].filter(
    (candidate, index, values) =>
      values.indexOf(candidate) === index &&
      (maxValue == null || candidate <= maxValue),
  )
  return (
    candidates
      .map((candidate) => ({ candidate, delta: Math.abs(candidate - value) }))
      .sort((a, b) => a.delta - b.delta || b.candidate - a.candidate)[0]?.candidate ??
    lower
  )
}

function resolveFormattedDimensions(
  width: number,
  height: number,
  options: {
    maxWidth?: number
    maxHeight?: number
  },
): { fmtWidth?: number; fmtHeight?: number } | undefined {
  const fmtWidth = alignToMultiple(width, 16, options.maxWidth)
  const fmtHeight = alignToMultiple(height, 16, options.maxHeight)
  return { fmtWidth, fmtHeight }
}

function resolveSupportedValue(
  value: string,
  supported: string[] | undefined,
  options: {
    mode: DimensionMode
    provider: string
    model: string
    capability: string
  },
): string {
  if (!supported?.length || supported.includes(value)) return value
  if (options.mode === "strict") {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Requested ${options.capability} is not supported: ${value}`,
      { provider: options.provider, model: options.model },
    )
  }
  return nearestSupportedTier(value, supported)
}

function nearestSupportedTier(value: string, supported: string[]): string {
  const requested = tierRank(value)
  return (
    supported
      .map((item) => ({ item, delta: Math.abs(tierRank(item) - requested) }))
      .sort((a, b) => a.delta - b.delta)[0]?.item ?? (supported[0] as string)
  )
}

function tierRank(value: string): number {
  const image = /^(\d+(?:\.\d+)?)K$/.exec(value)
  if (image) return Number(image[1]) * 1000
  const video = /^(\d+)p$/.exec(value)
  if (video) return Number(video[1])
  return Number.MAX_SAFE_INTEGER
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
