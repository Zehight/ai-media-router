import {
  createMediaRouterError,
  MediaRouterException,
  type GenerationJob,
  type GenerationResult,
  type MediaAsset,
  type MediaType,
} from "@miragari/ai-media-router-core"
import { normalizeTerminalJob } from "./terminal.js"

const JOB_STATUSES = new Set(["queued", "running", "succeeded", "failed", "cancelled"])
const MEDIA_TYPES = new Set(["image", "video", "audio", "model3d", "file"])

export type ProviderOutputContext = {
  provider: string
  providerId?: string
  model: string
  type?: MediaType
  raw?: unknown
}

export function normalizeProviderCreateOutput(
  output: unknown,
  context: ProviderOutputContext,
): GenerationJob {
  if (!isRecord(output)) {
    throw providerContractError("Provider returned invalid create output", context, output)
  }
  if (output.kind === "completed") {
    if (!("result" in output)) {
      throw providerContractError(
        "Provider completed output is missing result",
        context,
        output,
      )
    }
    const result = normalizeProviderResult(output.result, context)
    const completedAt = result.timings?.completedAt ?? new Date().toISOString()
    return {
      id: result.jobId,
      type: result.type,
      provider: result.provider,
      providerId: result.providerId,
      model: result.model,
      status: "succeeded",
      result,
      resolved: result.resolved,
      createdAt: result.timings?.createdAt ?? completedAt,
      updatedAt: completedAt,
    }
  }
  if (output.kind === "pending") {
    if (!("job" in output)) {
      throw providerContractError("Provider pending output is missing job", context, output)
    }
    return normalizeProviderJob(output.job, context)
  }
  throw providerContractError("Provider returned invalid create output", context, output)
}

export function normalizeProviderJob(
  job: unknown,
  context: ProviderOutputContext,
): GenerationJob {
  if (!isRecord(job)) {
    throw providerContractError("Provider returned invalid job", context, job)
  }
  const status = job.status
  if (typeof status !== "string" || !JOB_STATUSES.has(status)) {
    throw providerContractError("Provider returned invalid job status", context, job)
  }
  assertString(job.id, "id", job, context)
  assertMediaType(job.type, "type", job, context)
  assertString(job.provider, "provider", job, context)
  assertString(job.providerId, "providerId", job, context)
  assertString(job.model, "model", job, context)
  const validatedJob = job as Record<string, unknown> & {
    type: MediaType
    provider: string
    providerId: string
    model: string
  }
  assertMatchesContext(validatedJob, context, "job")
  if (status === "succeeded" && "result" in job && job.result != null) {
    const result = normalizeProviderResult(job.result, context)
    if (result.jobId !== job.id) {
      throw providerContractError(
        "Provider job result jobId does not match job id",
        context,
        job,
      )
    }
    return normalizeTerminalJob({
      ...job,
      result,
    } as GenerationJob)
  }
  if (status !== "succeeded" && "result" in job && job.result != null) {
    throw providerContractError(
      "Provider job result is only allowed for succeeded jobs",
      context,
      job,
    )
  }
  return normalizeTerminalJob(job as GenerationJob)
}

export function normalizeProviderResult(
  result: unknown,
  context: ProviderOutputContext,
): GenerationResult {
  if (!isRecord(result)) {
    throw providerContractError("Provider returned invalid result", context, result)
  }
  assertString(result.id, "id", result, context)
  assertString(result.jobId, "jobId", result, context)
  assertMediaType(result.type, "type", result, context)
  assertString(result.provider, "provider", result, context)
  assertString(result.providerId, "providerId", result, context)
  assertString(result.model, "model", result, context)
  const validatedResult = result as Record<string, unknown> & {
    type: MediaType
    provider: string
    providerId: string
    model: string
  }
  assertMatchesContext(validatedResult, context, "result")
  if (result.status !== "succeeded") {
    throw providerContractError("Provider returned invalid result status", context, result)
  }
  if (!Array.isArray(result.assets)) {
    throw providerContractError("Provider result assets must be an array", context, result)
  }
  result.assets.forEach((asset, index) => assertMediaAsset(asset, index, result, context))
  return withPrimaryAsset(result as GenerationResult)
}

export function withPrimaryAsset(result: GenerationResult): GenerationResult {
  return {
    ...result,
    asset: result.assets[0],
  }
}

function assertString(
  value: unknown,
  field: string,
  raw: unknown,
  context: ProviderOutputContext,
): asserts value is string {
  if (typeof value === "string" && value.length > 0) return
  throw providerContractError(`Provider output field ${field} must be a string`, context, raw)
}

function assertMediaType(
  value: unknown,
  field: string,
  raw: unknown,
  context: ProviderOutputContext,
): asserts value is MediaType {
  if (typeof value === "string" && MEDIA_TYPES.has(value)) return
  throw providerContractError(`Provider output field ${field} must be a media type`, context, raw)
}

function assertMediaAsset(
  value: unknown,
  index: number,
  raw: unknown,
  context: ProviderOutputContext,
): asserts value is MediaAsset {
  if (!isRecord(value)) {
    throw providerContractError(`Provider result asset ${index} must be an object`, context, raw)
  }
  assertMediaType(value.type, `assets[${index}].type`, raw, context)
  assertOptionalString(value.url, `assets[${index}].url`, raw, context)
  assertOptionalString(value.base64, `assets[${index}].base64`, raw, context)
  assertOptionalString(value.mimeType, `assets[${index}].mimeType`, raw, context)
  assertOptionalNumber(value.width, `assets[${index}].width`, raw, context)
  assertOptionalNumber(value.height, `assets[${index}].height`, raw, context)
  assertOptionalNumber(value.duration, `assets[${index}].duration`, raw, context)
  if (value.metadata != null && !isRecord(value.metadata)) {
    throw providerContractError(
      `Provider result asset ${index} metadata must be an object`,
      context,
      raw,
    )
  }
}

function assertOptionalString(
  value: unknown,
  field: string,
  raw: unknown,
  context: ProviderOutputContext,
): asserts value is string | undefined {
  if (value == null || typeof value === "string") return
  throw providerContractError(`Provider output field ${field} must be a string`, context, raw)
}

function assertOptionalNumber(
  value: unknown,
  field: string,
  raw: unknown,
  context: ProviderOutputContext,
): asserts value is number | undefined {
  if (value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return
  }
  throw providerContractError(
    `Provider output field ${field} must be a non-negative number`,
    context,
    raw,
  )
}

function assertMatchesContext(
  output: {
    type: MediaType
    provider: string
    providerId: string
    model: string
  },
  context: ProviderOutputContext,
  kind: "job" | "result",
): void {
  if (output.provider !== context.provider) {
    throw providerContractError(
      `Provider ${kind} provider does not match request provider`,
      context,
      output,
    )
  }
  if (context.providerId && output.providerId !== context.providerId) {
    throw providerContractError(
      `Provider ${kind} providerId does not match runtime providerId`,
      context,
      output,
    )
  }
  if (output.model !== context.model) {
    throw providerContractError(
      `Provider ${kind} model does not match request model`,
      context,
      output,
    )
  }
  if (context.type && output.type !== context.type) {
    throw providerContractError(
      `Provider ${kind} type does not match request type`,
      context,
      output,
    )
  }
}

function providerContractError(
  message: string,
  context: ProviderOutputContext,
  raw: unknown,
): MediaRouterException {
  return new MediaRouterException(
    createMediaRouterError("PROVIDER_ERROR", message, {
      provider: context.provider,
      model: context.model,
      raw,
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object")
}
