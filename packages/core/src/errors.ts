import type {
  GenerationRequest,
  MediaRouterError,
  MediaRouterErrorCode,
} from "./types.js"

const MEDIA_ROUTER_ERROR_CODES: readonly MediaRouterErrorCode[] = [
  "BAD_REQUEST",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "REGION_RESTRICTED",
  "CONTENT_REJECTED",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "NOT_FOUND",
  "UNKNOWN",
]

export class MediaRouterException extends Error {
  readonly details: MediaRouterError

  constructor(details: MediaRouterError) {
    super(details.message)
    this.name = "MediaRouterException"
    this.details = details
  }
}

export function createMediaRouterError(
  code: MediaRouterErrorCode,
  message: string,
  input: {
    provider: string
    model?: string
    retryable?: boolean
    statusCode?: number
    raw?: unknown
  },
): MediaRouterError {
  return {
    kind: "MediaRouterError",
    code,
    message,
    provider: input.provider,
    model: input.model,
    retryable: input.retryable ?? false,
    statusCode: input.statusCode,
    raw: input.raw,
  }
}

export function throwMediaRouterError(
  code: MediaRouterErrorCode,
  message: string,
  input: {
    provider: string
    model?: string
    retryable?: boolean
    statusCode?: number
    raw?: unknown
  },
): never {
  throw new MediaRouterException(createMediaRouterError(code, message, input))
}

export function normalizeUnknownError(
  error: unknown,
  request: Pick<GenerationRequest, "provider" | "model">,
): MediaRouterError {
  const normalized = normalizeMediaRouterError(error, request)
  if (normalized) return normalized
  if (error instanceof Error) {
    return createMediaRouterError("UNKNOWN", error.message, {
      provider: request.provider,
      model: request.model,
      raw: error,
    })
  }
  return createMediaRouterError("UNKNOWN", "Unknown provider error", {
    provider: request.provider,
    model: request.model,
    raw: error,
  })
}

export function normalizeMediaRouterError(
  error: unknown,
  fallback: Pick<GenerationRequest, "provider" | "model">,
): MediaRouterError | undefined {
  if (error instanceof MediaRouterException) {
    return withFallbackErrorContext(error.details, fallback)
  }
  if (isMediaRouterErrorLike(error)) {
    return withFallbackErrorContext(error, fallback)
  }
  return undefined
}

export function isMediaRouterErrorLike(error: unknown): error is MediaRouterError {
  if (!error || typeof error !== "object") return false
  const value = error as Partial<MediaRouterError>
  return (
    value.kind === "MediaRouterError" &&
    typeof value.message === "string" &&
    typeof value.provider === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.code === "string" &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.statusCode === undefined || typeof value.statusCode === "number") &&
    (MEDIA_ROUTER_ERROR_CODES as readonly string[]).includes(value.code)
  )
}

function withFallbackErrorContext(
  error: MediaRouterError,
  fallback: Pick<GenerationRequest, "provider" | "model">,
): MediaRouterError {
  return {
    ...error,
    provider: error.provider ?? fallback.provider,
    model: error.model ?? fallback.model,
  }
}
