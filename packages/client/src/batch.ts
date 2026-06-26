import {
  MediaRouterException,
  createId,
  createMediaRouterError,
  normalizeMediaRouterError,
  type GenerationJob,
  type GenerationRequest,
  type GenerationResult,
  type MediaRouterError,
  type ModelDefinition,
  type PartialFailureMode,
  type ProviderRuntimeContext,
} from "@miragari/ai-media-router-core"
import { mapWithConcurrency } from "./concurrency.js"
import type { NormalizedImageGenerationRequest } from "./normalize.js"
import { normalizeTerminalJob } from "./terminal.js"

export type BatchRunOptions = {
  maxConcurrency?: number
  partialFailure?: PartialFailureMode
  batch?: {
    maxConcurrency?: number
    partialFailure?: PartialFailureMode
  }
}

export type NormalizeRouterError = (
  error: unknown,
  runtime: ProviderRuntimeContext,
  request?: GenerationRequest,
  job?: GenerationJob,
) => MediaRouterError

export type BatchProviderRuntime = {
  providerId: string
  runtime: ProviderRuntimeContext
}

export type ResolveBatchProvider = (provider: string) => BatchProviderRuntime

export function shouldSplitImages(
  request: NormalizedImageGenerationRequest,
  model: ModelDefinition,
): boolean {
  const count = request.options?.count ?? 1
  const countCapability = model.capabilities?.count
  const nativeMax = countCapability?.max ?? 1
  return count > nativeMax && countCapability?.strategy === "split"
}

export async function createSplitImageJob(input: {
  request: NormalizedImageGenerationRequest
  options?: BatchRunOptions
  resolveProvider: ResolveBatchProvider
  createChild: (
    request: NormalizedImageGenerationRequest,
    options?: BatchRunOptions,
  ) => Promise<GenerationJob>
  normalizeError: NormalizeRouterError
}): Promise<GenerationJob> {
  const { request, options, resolveProvider, createChild, normalizeError } = input
  const count = request.options?.count ?? 1
  const maxConcurrency = Math.min(batchMaxConcurrency(options) ?? count, count)
  const partialFailure = batchPartialFailure(options)
  const attempts = Array.from({ length: count }, (_, index) => index)
  const { providerId, runtime } = resolveProvider(request.provider)

  const children = await mapWithConcurrency(attempts, maxConcurrency, async (index) => {
    const seed = request.options?.seed == null ? undefined : request.options.seed + index
    const childRequest: NormalizedImageGenerationRequest = {
      ...request,
      type: "image",
      options: {
        ...request.options,
        count: 1,
        seed,
      },
    }

    try {
      return await createChild(childRequest, options)
    } catch (error) {
      if (partialFailure !== "return-successful") throw error
      return {
        id: createId("mr_job"),
        type: "image",
        provider: request.provider,
        providerId,
        model: request.model,
        status: "failed",
        error: normalizeError(error, runtime, childRequest),
        createdAt: new Date().toISOString(),
      } satisfies GenerationJob
    }
  })

  const batch: GenerationJob = {
    id: createId("mr_batch"),
    type: "image",
    provider: request.provider,
    providerId,
    model: request.model,
    status: "running",
    children,
    providerState: { partialFailure },
    createdAt: new Date().toISOString(),
  }
  return reduceBatchTerminalJob({
    job: batch,
    children,
    partialFailure,
  })
}

function batchMaxConcurrency(options: BatchRunOptions | undefined): number | undefined {
  return options?.batch?.maxConcurrency ?? options?.maxConcurrency
}

function batchPartialFailure(options: BatchRunOptions | undefined): PartialFailureMode {
  return options?.batch?.partialFailure ?? options?.partialFailure ?? "fail"
}

export async function cancelBatchJob(input: {
  job: GenerationJob
  resolveProvider: ResolveBatchProvider
  normalizeError: NormalizeRouterError
}): Promise<void> {
  const { job, resolveProvider, normalizeError } = input
  const cancellable = (job.children ?? []).filter(
    (child) => child.status === "queued" || child.status === "running",
  )
  const settled = await Promise.all(
    cancellable.map(async (child) => {
      if (!child.providerJobId) {
        return createMediaRouterError(
          "PROVIDER_ERROR",
          "Batch child is missing providerJobId for cancellation",
          {
            provider: child.provider,
            model: child.model,
            raw: child,
          },
        )
      }
      let runtime: ProviderRuntimeContext | undefined
      try {
        runtime = resolveProvider(child.provider).runtime
        if (!runtime.plugin.driver.cancel) {
          return createMediaRouterError("BAD_REQUEST", "Provider does not support cancellation", {
            provider: child.provider,
            model: child.model,
            raw: child,
          })
        }
        await runtime.plugin.driver.cancel({ ...runtime, job: child })
        return undefined
      } catch (error) {
        return normalizeBatchChildError(error, child, runtime, normalizeError)
      }
    }),
  )
  const failures = settled.filter((error): error is MediaRouterError => Boolean(error))
  if (failures.length) {
    throw new MediaRouterException(
      createMediaRouterError("PROVIDER_ERROR", "Failed to cancel batch children", {
        provider: job.provider,
        model: job.model,
        raw: failures,
      }),
    )
  }
}

export async function statusBatchJob(input: {
  job: GenerationJob
  statusChild: (job: GenerationJob) => Promise<GenerationJob>
  normalizeStatusJob: (job: GenerationJob) => GenerationJob
  normalizeError: NormalizeRouterError
}): Promise<GenerationJob> {
  const { job, statusChild, normalizeStatusJob } = input
  const partialFailure = job.providerState?.partialFailure === "return-successful"
  const children = await Promise.all(
    (job.children ?? []).map((child) =>
      child.status === "running" || child.status === "queued"
        ? statusChild(child).catch((error) => {
            const normalized = normalizeBatchChildError(
              error,
              child,
              undefined,
              input.normalizeError,
            )
            if (!partialFailure) throw new MediaRouterException(normalized)
            return {
              ...child,
              status: "failed",
              error: normalized,
              updatedAt: new Date().toISOString(),
            } satisfies GenerationJob
          })
        : Promise.resolve(normalizeStatusJob(child)),
    ),
  )
  return reduceBatchTerminalJob({
    job,
    children,
    partialFailure: partialFailure ? "return-successful" : "fail",
  })
}

export function withBatchResult(job: GenerationJob): GenerationJob {
  const result = createBatchResult({
    job,
    children: job.children ?? [],
    completedAt: job.updatedAt,
  })
  if (!result) return job
  return { ...job, result }
}

export function reduceBatchTerminalJob(input: {
  job: GenerationJob
  children: GenerationJob[]
  partialFailure: PartialFailureMode
  completedAt?: string
  failureMessage?: string
}): GenerationJob {
  const normalizedChildren = input.children.map((child) => normalizeTerminalJob(child))
  const hasRunning = normalizedChildren.some(
    (child) => child.status === "running" || child.status === "queued",
  )
  const hasSucceeded = normalizedChildren.some(hasBatchResult)
  const hasFailed = normalizedChildren.some(
    (child) => child.status === "failed" || child.status === "cancelled",
  )
  const status: GenerationJob["status"] = hasRunning
    ? "running"
    : hasSucceeded && (input.partialFailure === "return-successful" || !hasFailed)
      ? "succeeded"
      : "failed"
  const updatedAt = input.completedAt ?? new Date().toISOString()
  const nextJob = {
    ...input.job,
    status,
    children: normalizedChildren,
    error:
      status === "failed"
        ? createMediaRouterError(
            "PROVIDER_ERROR",
            input.failureMessage ?? "Batch generation failed",
            {
              provider: input.job.provider,
              model: input.job.model,
              raw: normalizedChildren,
            },
          )
        : undefined,
    updatedAt,
  }
  return status === "succeeded" ? withBatchResult(nextJob) : nextJob
}

export function createBatchResult(input: {
  job: GenerationJob
  children: GenerationJob[]
  completedAt?: string
}): GenerationResult | undefined {
  const successful = input.children.filter(hasBatchResult)
  if (successful.length === 0) return undefined
  const completedAt = input.completedAt ?? new Date().toISOString()
  const { job } = input
  const assets = successful.flatMap((child) => child.result?.assets ?? [])
  return {
    id: `${job.id}_result`,
    jobId: job.id,
    type: job.type,
    provider: job.provider,
    providerId: job.providerId,
    model: job.model,
    status: "succeeded",
    asset: assets[0],
    assets,
    children: input.children.map((child) => ({
      jobId: child.id,
      providerJobId: child.providerJobId,
      status: child.status,
      error: child.error,
    })),
    timings: {
      createdAt: job.createdAt ?? completedAt,
      completedAt,
    },
  }
}

function hasBatchResult(job: GenerationJob): boolean {
  return job.status === "succeeded" && Boolean(job.result)
}

function normalizeBatchChildError(
  error: unknown,
  child: GenerationJob,
  runtime?: ProviderRuntimeContext,
  normalizeError?: NormalizeRouterError,
): MediaRouterError {
  const fallback = { provider: child.provider, model: child.model }
  const normalized = normalizeMediaRouterError(error, fallback)
  if (normalized) return normalized
  if (runtime && normalizeError) return normalizeError(error, runtime, undefined, child)
  return createMediaRouterError("UNKNOWN", errorMessage(error), {
    ...fallback,
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
