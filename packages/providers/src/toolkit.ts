import type {
  GenerationRequest,
  MediaAsset,
  MediaInput,
  MediaType,
  ProviderCreateContext,
} from "@media-router/core"

type PromptFlagValue = string | number | boolean | undefined

export type MediaInputRole =
  | "image"
  | "referenceImage"
  | "mask"
  | "firstFrame"
  | "lastFrame"
  | "video"
  | "referenceVideo"
  | "audio"
  | "referenceAudio"

export type CollectedMediaInput = {
  role: MediaInputRole
  input: MediaInput
  index: number
}

export type DescribedMediaInput =
  | { kind: "url"; url: string; mimeType?: string }
  | { kind: "base64"; data: string; mimeType: string }
  | { kind: "bytes"; data: Uint8Array | ArrayBuffer; mimeType: string; filename?: string }
  | { kind: "file"; path: string; mimeType?: string }

export type InlineBase64MediaInput = {
  data: string
  mimeType: string
  filename?: string
}

export function requestMediaType(context: ProviderCreateContext): MediaType {
  return context.request.type ?? context.model.type
}

export function isVideoRequest(context: ProviderCreateContext): boolean {
  return requestMediaType(context) === "video"
}

export function isImageRequest(context: ProviderCreateContext): boolean {
  return requestMediaType(context) === "image"
}

export function getPrompt(request: GenerationRequest): string {
  return request.input.prompt
}

export function getOutputMimeType(
  context: ProviderCreateContext,
  mediaType: "image" | "video",
  fallback?: string,
): string | undefined {
  const outputFormat =
    mediaType === "image"
      ? (context.request.options as { outputFormat?: string } | undefined)?.outputFormat
      : undefined
  if (outputFormat) return `${mediaType}/${outputFormat}`
  return fallback
}

export function assetsFromImageData(
  data: Array<{ url?: string; b64_json?: string; base64?: string }> | undefined,
  context: ProviderCreateContext,
): MediaAsset[] {
  const mimeType = getOutputMimeType(context, "image")
  return (
    data
      ?.map((item) => ({
        type: "image" as const,
        url: item.url,
        base64: item.b64_json ?? item.base64,
        mimeType,
      }))
      .filter((item) => item.url || item.base64) ?? []
  )
}

export function assetFromUrl(
  type: MediaType,
  url: string | undefined,
  mimeType?: string,
): MediaAsset[] {
  if (!url) return []
  return [{ type, url, mimeType }]
}

export function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined)
}

export function collectMediaInputs(request: GenerationRequest): CollectedMediaInput[] {
  const input = request.input as {
    image?: MediaInput
    firstFrame?: MediaInput
    lastFrame?: MediaInput
    images?: MediaInput[]
    mask?: MediaInput
    video?: MediaInput
    videos?: MediaInput[]
    audio?: MediaInput
    audios?: MediaInput[]
  }
  const collected: CollectedMediaInput[] = []
  if (input.image) collected.push({ role: "image", input: input.image, index: 0 })
  if (input.firstFrame) {
    collected.push({ role: "firstFrame", input: input.firstFrame, index: 0 })
  }
  for (const [index, item] of (input.images ?? []).entries()) {
    collected.push({ role: "referenceImage", input: item, index })
  }
  if (input.lastFrame) {
    collected.push({ role: "lastFrame", input: input.lastFrame, index: 0 })
  }
  if (input.mask) collected.push({ role: "mask", input: input.mask, index: 0 })
  if (input.video) collected.push({ role: "video", input: input.video, index: 0 })
  for (const [index, item] of (input.videos ?? []).entries()) {
    collected.push({ role: "referenceVideo", input: item, index })
  }
  if (input.audio) collected.push({ role: "audio", input: input.audio, index: 0 })
  for (const [index, item] of (input.audios ?? []).entries()) {
    collected.push({ role: "referenceAudio", input: item, index })
  }
  return collected
}

export function getImageInputs(request: GenerationRequest): MediaInput[] {
  return collectMediaInputs(request)
    .filter((item) =>
      ["image", "firstFrame", "referenceImage", "lastFrame"].includes(item.role),
    )
    .map((item) => item.input)
}

export function getVideoInputs(request: GenerationRequest): MediaInput[] {
  return collectMediaInputs(request)
    .filter((item) => ["video", "referenceVideo"].includes(item.role))
    .map((item) => item.input)
}

export function getAudioInputs(request: GenerationRequest): MediaInput[] {
  return collectMediaInputs(request)
    .filter((item) => ["audio", "referenceAudio"].includes(item.role))
    .map((item) => item.input)
}

export function firstMediaInput(
  request: GenerationRequest,
  roles: MediaInputRole[],
): MediaInput | undefined {
  return collectMediaInputs(request).find((item) => roles.includes(item.role))?.input
}

export function firstImageInput(request: GenerationRequest): MediaInput | undefined {
  return firstMediaInput(request, [
    "image",
    "firstFrame",
    "referenceImage",
    "lastFrame",
  ])
}

export function describeMediaInput(input: MediaInput): DescribedMediaInput {
  if ("url" in input) {
    return { kind: "url", url: input.url, mimeType: input.mimeType }
  }
  if (input.type === "base64") {
    return { kind: "base64", data: input.data, mimeType: input.mimeType }
  }
  if (input.type === "bytes") {
    return {
      kind: "bytes",
      data: input.data,
      mimeType: input.mimeType,
      filename: input.filename,
    }
  }
  return { kind: "file", path: input.path, mimeType: input.mimeType }
}

export function mediaInputToInlineBase64(
  input: MediaInput,
): InlineBase64MediaInput | undefined {
  const described = describeMediaInput(input)
  if (described.kind === "base64") {
    return { data: described.data, mimeType: described.mimeType }
  }
  if (described.kind === "bytes") {
    return {
      data: bytesToBase64(described.data),
      mimeType: described.mimeType,
      filename: described.filename,
    }
  }
  return undefined
}

export function appendPromptFlags(
  prompt: string,
  flags: Record<string, PromptFlagValue>,
): string {
  const suffix = Object.entries(flags)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `--${key} ${value}`)
    .join(" ")
  return suffix ? `${prompt} ${suffix}` : prompt
}

function bytesToBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
