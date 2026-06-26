export type MediaType = "image" | "video" | "audio" | "model3d" | "file"

export type GenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"

export type DimensionMode = "nearest" | "strict"
export type PartialFailureMode = "fail" | "return-successful"

export type MediaInput =
  | { type?: "url"; url: string; mimeType?: string }
  | { type: "base64"; data: string; mimeType: string }
  | {
      type: "bytes"
      data: Uint8Array | ArrayBuffer
      mimeType: string
      filename?: string
    }
  | { type: "file"; path: string; mimeType?: string }

export type BaseGenerationRequest<TType extends MediaType, TInput, TOptions> = {
  type: TType
  provider: string
  model: string
  action?: string
  input: TInput
  options?: TOptions
  providerOptions?: Record<string, unknown>
}

export type ImageGenerationRequest = BaseGenerationRequest<
  "image",
  {
    prompt: string
    negativePrompt?: string
    images?: MediaInput[]
    mask?: MediaInput
  },
  {
    width?: number
    height?: number
    count?: number
    seed?: number
    quality?: "low" | "medium" | "high" | "auto" | string
    outputFormat?: "png" | "jpeg" | "webp" | string
  }
>

export type VideoGenerationRequest = BaseGenerationRequest<
  "video",
  {
    prompt: string
    negativePrompt?: string
    image?: MediaInput
    firstFrame?: MediaInput
    lastFrame?: MediaInput
    images?: MediaInput[]
    video?: MediaInput
    videos?: MediaInput[]
    audio?: MediaInput
    audios?: MediaInput[]
  },
  {
    width?: number
    height?: number
    duration?: number
    fps?: number
    seed?: number
    mode?: "standard" | "pro" | "fast" | "turbo" | string
    quality?: "low" | "medium" | "high" | "auto" | string
    audioEnabled?: boolean
  }
>

export type AudioGenerationRequest = BaseGenerationRequest<
  "audio",
  {
    prompt?: string
    text?: string
    audio?: MediaInput
    audios?: MediaInput[]
  },
  {
    duration?: number
    seed?: number
    voice?: string
    format?: string
    sampleRate?: number
  }
>

export type Model3DGenerationRequest = BaseGenerationRequest<
  "model3d",
  {
    prompt?: string
    images?: MediaInput[]
    model?: MediaInput
  },
  {
    format?: string
    quality?: string
    texture?: boolean
    seed?: number
  }
>

export type GenerationRequest =
  | ImageGenerationRequest
  | VideoGenerationRequest
  | AudioGenerationRequest
  | Model3DGenerationRequest

export type MediaAsset = {
  type: MediaType
  url?: string
  base64?: string
  mimeType?: string
  width?: number
  height?: number
  duration?: number
  metadata?: Record<string, unknown>
}

export type ResolvedDimensions = {
  width: number
  height: number
  fmtWidth?: number
  fmtHeight?: number
  aspectRatio: string
  normalizedRatio: number
  orientation: "square" | "landscape" | "portrait"
  resolutionTier?: string
  size?: string
  providerSize?: unknown
}

export type GenerationResult = {
  id: string
  jobId: string
  type: MediaType
  provider: string
  providerId: string
  model: string
  status: "succeeded"
  asset?: MediaAsset
  assets: MediaAsset[]
  usage?: {
    unit?: "token" | "credit" | "second" | "image" | "request"
    amount?: number
    cost?: number
    currency?: string
    raw?: unknown
  }
  timings?: {
    createdAt?: string
    startedAt?: string
    completedAt?: string
  }
  warnings?: MediaRouterError[]
  children?: Array<{
    jobId: string
    providerJobId?: string
    status: GenerationStatus
    error?: MediaRouterError
  }>
  raw?: unknown
  resolved?: {
    dimensions?: ResolvedDimensions
    providerRequest?: unknown
  }
}

export type GenerationJob = {
  id: string
  type: MediaType
  provider: string
  providerId: string
  model: string
  status: GenerationStatus
  providerJobId?: string
  providerState?: Record<string, unknown>
  children?: GenerationJob[]
  result?: GenerationResult
  error?: MediaRouterError
  raw?: unknown
  createdAt?: string
  updatedAt?: string
  pollAfterMs?: number
  resolved?: {
    dimensions?: ResolvedDimensions
    providerRequest?: unknown
  }
}

export type MediaRouterErrorCode =
  | "BAD_REQUEST"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "REGION_RESTRICTED"
  | "CONTENT_REJECTED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "UNKNOWN"

export type MediaRouterError = {
  kind: "MediaRouterError"
  code: MediaRouterErrorCode
  message: string
  provider: string
  model?: string
  retryable: boolean
  statusCode?: number
  raw?: unknown
}
