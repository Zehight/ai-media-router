import {
  createMediaRouterError,
  MediaRouterException,
  normalizeMediaRouterError,
  type GenerationJob,
  type GenerationResult,
  type MediaRouterError,
} from "@miragari/core"

export function normalizeTerminalJob(job: GenerationJob): GenerationJob {
  if (job.status === "succeeded" && !job.result) {
    return {
      ...job,
      status: "failed",
      error: createMediaRouterError("PROVIDER_ERROR", "Succeeded job is missing result", {
        provider: job.provider,
        model: job.model,
        raw: job,
      }),
      updatedAt: new Date().toISOString(),
    }
  }
  if (job.status !== "failed") return job
  return {
    ...job,
    error: normalizeFailedJobError(job),
  }
}

export function resolveTerminalResult(job: GenerationJob): GenerationResult | undefined {
  const normalized = normalizeTerminalJob(job)
  if (normalized.status === "succeeded" && normalized.result) {
    return withPrimaryAsset(normalized.result)
  }
  if (normalized.status === "failed") {
    throw new MediaRouterException(normalizeFailedJobError(normalized))
  }
  if (normalized.status === "cancelled") {
    throw new MediaRouterException(
      createMediaRouterError("PROVIDER_ERROR", "Generation was cancelled", {
        provider: normalized.provider,
        model: normalized.model,
        raw: normalized.raw,
      }),
    )
  }
  return undefined
}

function withPrimaryAsset(result: GenerationResult): GenerationResult {
  return {
    ...result,
    asset: result.assets[0],
  }
}

export function normalizeFailedJobError(job: GenerationJob): MediaRouterError {
  if (!job.error) {
    return createMediaRouterError("PROVIDER_ERROR", "Generation failed", {
      provider: job.provider,
      model: job.model,
      raw: job.raw,
    })
  }
  const normalized = normalizeMediaRouterError(job.error, {
    provider: job.provider,
    model: job.model,
  })
  if (normalized) {
    return {
      ...normalized,
      provider: job.provider,
      model: job.model,
    }
  }
  return createMediaRouterError("UNKNOWN", "Unknown provider error", {
    provider: job.provider,
    model: job.model,
    raw: job.error,
  })
}
