import type {
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  GenerationStatus,
  MediaAsset,
  MediaInput,
  MediaType,
  ProviderCreateContext,
  ProviderCreateOutput,
  ProviderPollContext,
} from "@media-router/core"
import {
  createId,
  createMediaRouterError,
  mapProviderStatus,
  normalizeMediaRouterError,
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
  | "model3d"

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

export type ProviderAssetInput =
  | MediaAsset
  | string
  | (Omit<MediaAsset, "type"> & { type?: MediaType })

export type ProviderRequestIntent = {
  type: MediaType
  action?: string
  prompt?: string
  text?: string
  options: Record<string, unknown>
  providerOptions: Record<string, unknown>
  media: CollectedMediaInput[]
  images: MediaInput[]
  videos: MediaInput[]
  audios: MediaInput[]
  model3d: MediaInput[]
  firstImage?: MediaInput
  firstVideo?: MediaInput
  firstAudio?: MediaInput
  sourceModel?: MediaInput
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

export function getPrompt(request: GenerationRequest): string | undefined {
  return request.input.prompt
}

export function requirePrompt(context: ProviderCreateContext): string {
  const prompt = context.request.input.prompt
  if (typeof prompt === "string" && prompt.trim()) return prompt
  badRequest(context, "prompt is required")
}

export function requestIntent(context: ProviderCreateContext): ProviderRequestIntent {
  const media = collectMediaInputs(context.request)
  const images = mediaByRoles(media, [
    "image",
    "firstFrame",
    "referenceImage",
    "lastFrame",
  ])
  const videos = mediaByRoles(media, ["video", "referenceVideo"])
  const audios = mediaByRoles(media, ["audio", "referenceAudio"])
  const model3d = mediaByRoles(media, ["model3d"])
  return {
    type: requestMediaType(context),
    action: context.request.action,
    prompt: stringInput(context.request.input.prompt),
    text: stringInput(context.request.input.text),
    options: context.request.options ?? {},
    providerOptions: context.request.providerOptions ?? {},
    media,
    images,
    videos,
    audios,
    model3d,
    firstImage: images[0],
    firstVideo: videos[0],
    firstAudio: audios[0],
    sourceModel: model3d[0],
  }
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
    model?: MediaInput
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
  if (input.model) collected.push({ role: "model3d", input: input.model, index: 0 })
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

export function getModel3DInputs(request: GenerationRequest): MediaInput[] {
  return collectMediaInputs(request)
    .filter((item) => item.role === "model3d")
    .map((item) => item.input)
}

function mediaByRoles(
  media: CollectedMediaInput[],
  roles: MediaInputRole[],
): MediaInput[] {
  return media.filter((item) => roles.includes(item.role)).map((item) => item.input)
}

function stringInput(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
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

export function getProviderOption<T>(
  context: ProviderCreateContext,
  key: string,
  fallback?: T,
): T | undefined {
  const value = context.request.providerOptions?.[key]
  return value === undefined ? fallback : (value as T)
}

export function badRequest(
  context: ProviderCreateContext,
  message: string,
  raw?: unknown,
): never {
  throw createMediaRouterError("BAD_REQUEST", message, {
    provider: context.provider,
    model: context.request.model,
    raw,
  })
}

export function unsupportedInput(
  context: ProviderCreateContext,
  inputPath: string,
  reason?: string,
): never {
  badRequest(
    context,
    reason ? `Unsupported input ${inputPath}: ${reason}` : `Unsupported input ${inputPath}`,
  )
}

export function unsupportedAction(
  context: ProviderCreateContext,
  action = context.request.action,
): never {
  badRequest(
    context,
    action ? `Unsupported action: ${action}` : "Unsupported action",
  )
}

export function assertNoUnusedMediaInputs(
  context: ProviderCreateContext,
  consumedRoles: MediaInputRole[],
): void {
  const unused = collectMediaInputs(context.request).filter(
    (item) => !consumedRoles.includes(item.role),
  )
  if (!unused.length) return
  unsupportedInput(
    context,
    unused.map((item) => inputPathForRole(item)).join(", "),
    "provider facade did not consume this media input",
  )
}

export type UnknownStatusStrategy = "running" | "failed" | "throw"
export type MissingStatusStrategy = "running" | "throw"

export function completedResult(input: {
  context: ProviderCreateContext
  assets: ProviderAssetInput[]
  raw?: unknown
  providerRequest?: unknown
  allowEmptyResult?: boolean
}): GenerationResult {
  const assets = providerAssets(requestMediaType(input.context), input.assets)
  assertOutputAssets({
    assets,
    allowEmptyResult: input.allowEmptyResult,
    provider: input.context.provider,
    model: input.context.request.model,
    raw: input.raw,
  })
  const jobId = createId("mr_job")
  const completedAt = new Date().toISOString()
  return {
    id: createId("mr_result"),
    jobId,
    type: requestMediaType(input.context),
    provider: input.context.provider,
    providerId: input.context.providerId,
    model: input.context.request.model,
    status: "succeeded",
    asset: assets[0],
    assets,
    raw: input.raw,
    resolved: {
      dimensions: input.context.resolved.dimensions,
      providerRequest: input.providerRequest,
    },
    timings: {
      createdAt: completedAt,
      completedAt,
    },
  }
}

export function completed(input: {
  context: ProviderCreateContext
  assets: ProviderAssetInput[]
  raw?: unknown
  providerRequest?: unknown
  allowEmptyResult?: boolean
}): ProviderCreateOutput {
  return { kind: "completed", result: completedResult(input) }
}

export function pendingJob(input: {
  context: ProviderCreateContext
  providerJobId?: string
  providerState?: Record<string, unknown>
  status?: GenerationStatus
  raw?: unknown
  pollAfterMs?: number
  providerRequest?: unknown
}): ProviderCreateOutput {
  assertPendingStatus({
    status: input.status,
    provider: input.context.provider,
    model: input.context.request.model,
    raw: input.raw,
  })
  return {
    kind: "pending",
    job: {
      id: createId("mr_job"),
      type: requestMediaType(input.context),
      provider: input.context.provider,
      providerId: input.context.providerId,
      model: input.context.request.model,
      status: input.status ?? "queued",
      providerJobId: input.providerJobId,
      providerState: input.providerState,
      raw: input.raw,
      pollAfterMs: normalizePollAfterMs(input.pollAfterMs),
      createdAt: new Date().toISOString(),
      resolved: {
        dimensions: input.context.resolved.dimensions,
        providerRequest: input.providerRequest,
      },
    },
  }
}

export function pendingProviderJob(input: {
  context: ProviderCreateContext
  providerJobId: string | undefined
  providerState?: Record<string, unknown>
  status?: GenerationStatus
  raw?: unknown
  pollAfterMs?: number
  providerRequest?: unknown
}): ProviderCreateOutput {
  if (!input.providerJobId) {
    throw createMediaRouterError("PROVIDER_ERROR", "Provider did not return a job id", {
      provider: input.context.provider,
      model: input.context.request.model,
      raw: input.raw,
    })
  }
  return pendingJob({
    ...input,
    providerJobId: input.providerJobId,
  })
}

export function pendingStatus(
  status: GenerationStatus | undefined,
  fallback: "queued" | "running" = "queued",
): "queued" | "running" {
  if (!status) return fallback
  if (status === "queued" || status === "running") return status
  throw new Error(
    `Provider create returned terminal status "${status}"; return completed() or throw an error instead`,
  )
}

export function polledJob(input: {
  context: ProviderPollContext
  status: GenerationStatus
  assets?: ProviderAssetInput[]
  raw?: unknown
  error?: GenerationJob["error"]
  providerState?: Record<string, unknown>
  allowEmptyResult?: boolean
  pollAfterMs?: number
}): GenerationJob {
  const assets =
    input.assets == null
      ? emptyAssets(input.allowEmptyResult)
      : providerAssets(input.context.job.type, input.assets)

  if (input.status === "succeeded") {
    assertOutputAssets({
      assets,
      allowEmptyResult: input.allowEmptyResult,
      provider: input.context.job.provider,
      model: input.context.job.model,
      raw: input.raw,
    })
  }
  if (input.status === "failed" && !input.error) {
    throw createMediaRouterError(
      "PROVIDER_ERROR",
      "Provider reported failure without error details",
      {
        provider: input.context.job.provider,
        model: input.context.job.model,
        raw: input.raw,
      },
    )
  }
  const normalizedError =
    input.status === "failed"
      ? normalizeMediaRouterError(input.error, {
          provider: input.context.job.provider,
          model: input.context.job.model,
        })
      : undefined
  const jobError = normalizedError
    ? {
        ...normalizedError,
        provider: input.context.job.provider,
        model: input.context.job.model,
      }
    : undefined
  if (input.status === "failed" && !normalizedError) {
    throw createMediaRouterError(
      "PROVIDER_ERROR",
      "Provider reported failure with invalid error details",
      {
        provider: input.context.job.provider,
        model: input.context.job.model,
        raw: input.error,
      },
    )
  }

  const updatedAt = new Date().toISOString()
  const result =
    input.status === "succeeded" && assets
      ? {
          id: createId("mr_result"),
          jobId: input.context.job.id,
          type: input.context.job.type,
          provider: input.context.job.provider,
          providerId: input.context.job.providerId,
          model: input.context.job.model,
          status: "succeeded" as const,
          asset: assets[0],
          assets,
          raw: input.raw,
          resolved: input.context.job.resolved,
          timings: {
            createdAt: input.context.job.createdAt ?? updatedAt,
            completedAt: updatedAt,
          },
        }
      : undefined

  return {
    ...input.context.job,
    status: input.status,
    result,
    error: jobError,
    providerState: mergeProviderState(
      input.context.job.providerState,
      input.providerState,
    ),
    raw: input.raw,
    pollAfterMs:
      normalizePollAfterMs(input.pollAfterMs) ?? input.context.job.pollAfterMs,
    updatedAt,
  }
}

function emptyAssets(allowEmptyResult: boolean | undefined): MediaAsset[] | undefined {
  return allowEmptyResult ? [] : undefined
}

export function providerAsset(
  mediaType: MediaType,
  input: ProviderAssetInput,
): MediaAsset {
  if (typeof input === "string") return { type: mediaType, url: input }
  return {
    ...input,
    type: input.type ?? mediaType,
  }
}

export function providerAssets(
  mediaType: MediaType,
  inputs: ProviderAssetInput[],
): MediaAsset[] {
  return inputs.map((input) => providerAsset(mediaType, input))
}

export function statusFrom(
  providerStatus: string | undefined,
  statusMap: Record<string, GenerationStatus> | undefined,
  options?: {
    provider?: string
    model?: string
    unknownStatus?: UnknownStatusStrategy
    missingStatus?: MissingStatusStrategy
  },
): GenerationStatus {
  if (!providerStatus && statusMap) {
    const missingStatus = options?.missingStatus ?? "throw"
    if (missingStatus === "throw") {
      throw createMediaRouterError(
        "PROVIDER_ERROR",
        "Provider response is missing status",
        {
          provider: options?.provider ?? "provider",
          model: options?.model,
          raw: { statusMap },
        },
      )
    }
  }
  if (providerStatus && statusMap && !(providerStatus in statusMap)) {
    const unknownStatus = options?.unknownStatus ?? "throw"
    if (unknownStatus === "failed") return "failed"
    if (unknownStatus === "throw") {
      throw createMediaRouterError(
        "PROVIDER_ERROR",
        `Unknown provider status: ${providerStatus}`,
        {
          provider: options?.provider ?? "provider",
          model: options?.model,
          raw: { providerStatus, statusMap },
        },
      )
    }
  }
  return mapProviderStatus(providerStatus, statusMap)
}

export function providerError(error: unknown, provider: string, model?: string) {
  const normalized = normalizeMediaRouterError(error, {
    provider,
    model: model ?? "unknown",
  })
  if (normalized) return normalized
  if (error instanceof Error) {
    return createMediaRouterError("PROVIDER_ERROR", error.message, {
      provider,
      model,
      raw: error,
    })
  }
  return createMediaRouterError("UNKNOWN", "Unknown provider error", {
    provider,
    model,
    raw: error,
  })
}

export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

function inputPathForRole(item: CollectedMediaInput): string {
  switch (item.role) {
    case "image":
      return "input.image"
    case "referenceImage":
      return `input.images[${item.index}]`
    case "mask":
      return "input.mask"
    case "firstFrame":
      return "input.firstFrame"
    case "lastFrame":
      return "input.lastFrame"
    case "video":
      return "input.video"
    case "referenceVideo":
      return `input.videos[${item.index}]`
    case "audio":
      return "input.audio"
    case "referenceAudio":
      return `input.audios[${item.index}]`
    case "model3d":
      return "input.model"
  }
}

function normalizePollAfterMs(pollAfterMs: number | undefined): number | undefined {
  if (pollAfterMs == null) return undefined
  if (!Number.isFinite(pollAfterMs) || pollAfterMs < 0) return undefined
  return pollAfterMs
}

function assertPendingStatus(input: {
  status: GenerationStatus | undefined
  provider: string
  model: string
  raw: unknown
}): void {
  if (!input.status || input.status === "queued" || input.status === "running") return
  throw createMediaRouterError(
    "PROVIDER_ERROR",
    "Pending jobs must be queued or running",
    {
      provider: input.provider,
      model: input.model,
      raw: input.raw,
    },
  )
}

function mergeProviderState(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!current) return next
  if (!next) return current
  return { ...current, ...next }
}

function assertOutputAssets(input: {
  assets: MediaAsset[] | undefined
  allowEmptyResult?: boolean
  provider: string
  model?: string
  raw?: unknown
}): void {
  if (input.allowEmptyResult) return
  if (input.assets?.some(isConsumableAsset)) return
  throw createMediaRouterError(
    "PROVIDER_ERROR",
    "Provider reported success without output assets",
    {
      provider: input.provider,
      model: input.model,
      raw: input.raw,
    },
  )
}

function isConsumableAsset(asset: MediaAsset): boolean {
  return Boolean(asset.url || asset.base64)
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
