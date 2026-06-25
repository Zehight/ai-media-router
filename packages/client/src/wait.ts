import {
  createMediaRouterError,
  MediaRouterException,
  normalizeMediaRouterError,
  type GenerationJob,
  type GenerationResult,
  type MediaRouterError,
  type PartialFailureMode,
  type ProviderRuntimeContext,
} from "@media-router/core"

export type WaitOptions = {
  timeoutMs?: number
  intervalMs?: number
  onProgress?: (job: GenerationJob) => void
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_INTERVAL_MS = 5 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeDelayMs(delayMs: number | undefined, fallbackMs: number): number {
  if (delayMs == null) return fallbackMs
  if (!Number.isFinite(delayMs) || delayMs < 0) return fallbackMs
  return delayMs
}

export async function waitForJob(input: {
  job: GenerationJob
  runtime: ProviderRuntimeContext
  options?: WaitOptions
}): Promise<GenerationResult> {
  const timeoutMs = input.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = normalizeDelayMs(input.options?.intervalMs, DEFAULT_INTERVAL_MS)
  const started = Date.now()
  let job = input.job

  if (job.status === "succeeded" && job.result) return job.result
  if (job.status === "failed") {
    throw new MediaRouterException(normalizeFailedJobError(job))
  }
  if (job.status === "cancelled") {
    throw new MediaRouterException(
      createMediaRouterError("PROVIDER_ERROR", "Generation was cancelled", {
        provider: job.provider,
        model: job.model,
        raw: job.raw,
      }),
    )
  }
  if (job.children?.length) return waitForBatchJob({ ...input, job })
  if (!input.runtime.plugin.driver.poll) {
    throw new MediaRouterException(
      createMediaRouterError("BAD_REQUEST", "Provider does not support status polling", {
        provider: job.provider,
        model: job.model,
      }),
    )
  }

  while (Date.now() - started < timeoutMs) {
    try {
      job = await input.runtime.plugin.driver.poll({ ...input.runtime, job })
    } catch (error) {
      if (Date.now() - started >= timeoutMs) break
      throw new MediaRouterException(normalizePollError(error, input.runtime, job))
    }
    if (Date.now() - started >= timeoutMs) break
    input.options?.onProgress?.(job)

    if (job.status === "succeeded" && job.result) return job.result
    if (job.status === "failed") {
      throw new MediaRouterException(normalizeFailedJobError(job))
    }
    if (job.status === "cancelled") {
      throw new MediaRouterException(
        createMediaRouterError("PROVIDER_ERROR", "Generation was cancelled", {
          provider: job.provider,
          model: job.model,
          raw: job.raw,
        }),
      )
    }

    const remainingMs = timeoutMs - (Date.now() - started)
    if (remainingMs <= 0) break
    await sleep(Math.min(normalizeDelayMs(job.pollAfterMs, intervalMs), remainingMs))
  }

  throw new MediaRouterException(
    createMediaRouterError("TIMEOUT", "Timed out waiting for generation result", {
      provider: job.provider,
      model: job.model,
      retryable: true,
    }),
  )
}

function normalizeFailedJobError(job: GenerationJob): MediaRouterError {
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

function normalizePollError(
  error: unknown,
  runtime: ProviderRuntimeContext,
  job: GenerationJob,
): MediaRouterError {
  const fallback = { provider: job.provider, model: job.model }
  const normalized = normalizeMediaRouterError(error, fallback)
  if (normalized) return normalized
  const custom = runtime.plugin.driver.normalizeError?.(error, { job, runtime })
  const normalizedCustom = normalizeMediaRouterError(custom, fallback)
  if (normalizedCustom) return normalizedCustom
  if (custom) return normalizeFallbackError(custom, fallback)
  return createMediaRouterError("UNKNOWN", errorMessage(error), {
    provider: fallback.provider,
    model: fallback.model,
    raw: error,
  })
}

function normalizeFallbackError(
  error: unknown,
  fallback: { provider: string; model: string },
): MediaRouterError {
  return createMediaRouterError("UNKNOWN", errorMessage(error), {
    provider: fallback.provider,
    model: fallback.model,
    raw: error,
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return "Unknown provider error"
}

async function waitForBatchJob(input: {
  job: GenerationJob
  runtime: ProviderRuntimeContext
  options?: WaitOptions
}): Promise<GenerationResult> {
  const children = input.job.children ?? []
  const partialFailure = partialFailureMode(input.job)
  const settled = await Promise.all(
    children.map((child) =>
      waitForJob({ job: child, runtime: input.runtime, options: input.options })
        .then((result) => ({ child, result }))
        .catch((error) => {
          const normalized = normalizeMediaRouterError(error, {
            provider: child.provider,
            model: child.model,
          }) ?? normalizeFailedJobError({
            ...child,
            status: "failed",
            error: child.error,
            raw: error,
          })
          if (partialFailure === "fail") throw new MediaRouterException(normalized)
          return { child, error: normalized }
        }),
    ),
  )
  const successful = settled.filter(
    (item): item is { child: GenerationJob; result: GenerationResult } =>
      "result" in item,
  )
  if (partialFailure === "return-successful" && successful.length === 0) {
    throw new MediaRouterException(
      createMediaRouterError("PROVIDER_ERROR", "All batch children failed", {
        provider: input.job.provider,
        model: input.job.model,
        raw: settled,
      }),
    )
  }
  const completedAt = new Date().toISOString()
  return {
    id: `${input.job.id}_result`,
    jobId: input.job.id,
    type: input.job.type,
    provider: input.job.provider,
    providerId: input.job.providerId,
    model: input.job.model,
    status: "succeeded",
    assets: successful.flatMap((item) => item.result.assets),
    children: settled.map((item) => ({
      jobId: item.child.id,
      providerJobId: item.child.providerJobId,
      status: "result" in item ? "succeeded" : "failed",
      error: "error" in item ? item.error : undefined,
    })),
    timings: {
      createdAt: input.job.createdAt ?? completedAt,
      completedAt,
    },
  }
}

function partialFailureMode(job: GenerationJob): PartialFailureMode {
  return job.providerState?.partialFailure === "return-successful"
    ? "return-successful"
    : "fail"
}
