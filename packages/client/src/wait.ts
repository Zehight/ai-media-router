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
import { reduceBatchTerminalJob } from "./batch.js"
import { normalizeProviderJob } from "./provider-output.js"
import { normalizeFailedJobError, resolveTerminalResult } from "./terminal.js"

export type WaitOptions = {
  timeoutMs?: number
  intervalMs?: number
  onProgress?: (job: GenerationJob) => void
}

export type WaitRuntimeResolver = (provider: string) => ProviderRuntimeContext

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
  runtime?: ProviderRuntimeContext
  resolveProvider?: WaitRuntimeResolver
  options?: WaitOptions
}): Promise<GenerationResult> {
  const timeoutMs = input.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = normalizeDelayMs(input.options?.intervalMs, DEFAULT_INTERVAL_MS)
  const started = Date.now()
  let job = input.job

  if (job.status === "failed" || job.status === "cancelled") {
    resolveTerminalResult(job)
  }
  if (job.children?.length) return waitForBatchJob({ ...input, job })
  const initialResult = resolveTerminalResult(job)
  if (initialResult) return initialResult
  if (!input.runtime) {
    throw new MediaRouterException(
      createMediaRouterError("BAD_REQUEST", "Provider runtime is required", {
        provider: job.provider,
        model: job.model,
      }),
    )
  }
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
      job = normalizeProviderJob(
        await input.runtime.plugin.driver.poll({ ...input.runtime, job }),
        {
          provider: job.provider,
          providerId: job.providerId,
          model: job.model,
          type: job.type,
        },
      )
    } catch (error) {
      if (Date.now() - started >= timeoutMs) break
      throw new MediaRouterException(normalizePollError(error, input.runtime, job))
    }
    if (Date.now() - started >= timeoutMs) break
    input.options?.onProgress?.(job)

    const result = resolveTerminalResult(job)
    if (result) return result

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
  runtime?: ProviderRuntimeContext
  resolveProvider?: WaitRuntimeResolver
  options?: WaitOptions
}): Promise<GenerationResult> {
  const children = input.job.children ?? []
  const partialFailure = partialFailureMode(input.job)
  const settled = await Promise.all(
    children.map(async (child) => {
      try {
        const runtime =
          child.status === "queued" || child.status === "running"
            ? input.resolveProvider?.(child.provider) ?? input.runtime
            : input.runtime
        const result = await waitForJob({
          job: child,
          runtime,
          resolveProvider: input.resolveProvider,
          options: input.options,
        })
        return { child, result }
      } catch (error) {
        const normalized = normalizeBatchChildError(error, child)
        if (partialFailure === "fail") throw new MediaRouterException(normalized)
        return { child, error: normalized }
      }
    }),
  )
  const completedAt = new Date().toISOString()
  const reduced = reduceBatchTerminalJob({
    job: input.job,
    children: settled.map((item) =>
      "result" in item
        ? { ...item.child, status: "succeeded", result: item.result }
        : { ...item.child, status: "failed", error: item.error },
    ),
    completedAt,
    partialFailure,
    failureMessage:
      partialFailure === "return-successful"
        ? "All batch children failed"
        : "Batch completed without successful assets",
  })
  if (reduced.status === "succeeded" && reduced.result) return reduced.result
  throw new MediaRouterException(
    reduced.error ??
      createMediaRouterError("PROVIDER_ERROR", "Batch completed without successful assets", {
        provider: input.job.provider,
        model: input.job.model,
        raw: settled,
      }),
  )
}

function partialFailureMode(job: GenerationJob): PartialFailureMode {
  return job.providerState?.partialFailure === "return-successful"
    ? "return-successful"
    : "fail"
}

function normalizeBatchChildError(error: unknown, child: GenerationJob): MediaRouterError {
  const fallback = { provider: child.provider, model: child.model }
  const normalized = normalizeMediaRouterError(error, fallback)
  if (normalized) return normalized
  if (child.error) return normalizeFailedJobError({ ...child, status: "failed" })
  return createMediaRouterError("UNKNOWN", errorMessage(error), {
    provider: child.provider,
    model: child.model,
    raw: error,
  })
}
