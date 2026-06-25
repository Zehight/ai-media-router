import {
  MediaRouterException,
  createId,
  createMediaRouterError,
  normalizeMediaRouterError,
  normalizeUnknownError,
  resolveDimensions,
  resolveModelDefinition,
  validateGenerationRequest,
  type GenerationJob,
  type GenerationRequest,
  type GenerationResult,
  type ImageGenerationRequest,
  type MediaRouterError,
  type ModelDefinition,
  type ProviderInstanceConfig,
  type ProviderPlugin,
  type ProviderRuntimeContext,
  type VideoGenerationRequest,
} from "@media-router/core"
import { mapWithConcurrency } from "./concurrency.js"
import { ProviderRegistry } from "./registry.js"
import { waitForJob, type WaitOptions } from "./wait.js"

export type MediaRouterOptions = {
  plugins: Record<string, ProviderPlugin>
  providers: Record<string, ProviderInstanceConfig>
  fetch?: typeof fetch
}

export class MediaRouter {
  private readonly registry: ProviderRegistry

  constructor(options: MediaRouterOptions) {
    this.registry = new ProviderRegistry(options)
  }

  async create(request: GenerationRequest): Promise<GenerationJob> {
    const prepared = this.prepare(request)
    if (
      (prepared.request.type ?? prepared.model.type) === "image" &&
      this.shouldSplitImages(prepared.request, prepared.model)
    ) {
      return this.createSplitImageJob(prepared.request as ImageGenerationRequest)
    }
    try {
      const output = await prepared.runtime.plugin.driver.create({
        ...prepared.runtime,
        request: prepared.request,
        model: prepared.model,
      })
      if (output.kind === "completed") {
        const completedAt = output.result.timings?.completedAt ?? new Date().toISOString()
        return {
          id: output.result.jobId,
          type: output.result.type,
          provider: output.result.provider,
          providerId: output.result.providerId,
          model: output.result.model,
          status: "succeeded",
          result: output.result,
          resolved: output.result.resolved,
          createdAt: output.result.timings?.createdAt ?? completedAt,
          updatedAt: completedAt,
        }
      }
      return output.job
    } catch (error) {
      throw new MediaRouterException(
        this.normalizeError(error, prepared.runtime, prepared.request),
      )
    }
  }

  async createImage(request: ImageGenerationRequest): Promise<GenerationJob> {
    const prepared = this.prepare({ ...request, type: "image" })
    if (!this.shouldSplitImages(prepared.request, prepared.model)) {
      return this.create(prepared.request)
    }
    return this.createSplitImageJob(prepared.request as ImageGenerationRequest)
  }

  createVideo(request: VideoGenerationRequest): Promise<GenerationJob> {
    return this.create({ ...request, type: "video" })
  }

  async status(job: GenerationJob): Promise<GenerationJob> {
    const { runtime } = this.registry.get(job.provider)
    if (job.children?.length) return this.statusBatchJob(job)
    if (!runtime.plugin.driver.poll) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", "Provider does not support status polling", {
          provider: job.provider,
          model: job.model,
        }),
      )
    }
    try {
      return this.normalizeStatusJob(
        await runtime.plugin.driver.poll({ ...runtime, job }),
      )
    } catch (error) {
      throw new MediaRouterException(this.normalizeError(error, runtime, undefined, job))
    }
  }

  async cancel(job: GenerationJob): Promise<void> {
    const { runtime } = this.registry.get(job.provider)
    if (!runtime.plugin.driver.cancel) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", "Provider does not support cancellation", {
          provider: job.provider,
          model: job.model,
        }),
      )
    }
    try {
      await runtime.plugin.driver.cancel({ ...runtime, job })
    } catch (error) {
      throw new MediaRouterException(this.normalizeError(error, runtime, undefined, job))
    }
  }

  async wait(job: GenerationJob, options?: WaitOptions): Promise<GenerationResult> {
    const { runtime } = this.registry.get(job.provider)
    return waitForJob({ job, runtime, options })
  }

  async generate(request: GenerationRequest, options?: WaitOptions): Promise<GenerationResult> {
    if ((request.type ?? "image") === "image") {
      return this.generateImage(request as ImageGenerationRequest, options)
    }
    const job = await this.create(request)
    return this.wait(job, options)
  }

  async generateImage(
    request: ImageGenerationRequest,
    options?: WaitOptions,
  ): Promise<GenerationResult> {
    const prepared = this.prepare({ ...request, type: "image" })
    const job = this.shouldSplitImages(prepared.request, prepared.model)
      ? await this.createSplitImageJob(prepared.request as ImageGenerationRequest)
      : await this.create(prepared.request)
    return this.wait(job, options)
  }

  generateVideo(
    request: VideoGenerationRequest,
    options?: WaitOptions,
  ): Promise<GenerationResult> {
    return this.generate({ ...request, type: "video" }, options)
  }

  private shouldSplitImages(
    request: GenerationRequest,
    model: ModelDefinition,
  ): boolean {
    const count = request.options?.count ?? 1
    const countCapability = model.capabilities?.count
    const nativeMax = countCapability?.max ?? 1
    return count > nativeMax && countCapability?.strategy === "split"
  }

  private async createSplitImageJob(
    request: ImageGenerationRequest,
  ): Promise<GenerationJob> {
    const count = request.options?.count ?? 1
    const maxConcurrency = Math.min(request.options?.maxConcurrency ?? count, count)
    const partialFailure = request.options?.partialFailure ?? "fail"
    const attempts = Array.from({ length: count }, (_, index) => index)
    const { plugin, runtime } = this.registry.get(request.provider)

    const children = await mapWithConcurrency(attempts, maxConcurrency, async (index) => {
      const seed =
        request.options?.seed == null ? undefined : request.options.seed + index
      const childRequest: ImageGenerationRequest = {
        ...request,
        type: "image",
        options: {
          ...request.options,
          count: 1,
          seed,
        },
      }

      try {
        return await this.create(childRequest)
      } catch (error) {
        if (partialFailure !== "return-successful") throw error
        return {
          id: createId("mr_job"),
          type: "image",
          provider: request.provider,
          providerId: plugin.id,
          model: request.model,
          status: "failed",
          error: this.normalizeError(error, runtime, childRequest),
          createdAt: new Date().toISOString(),
        } satisfies GenerationJob
      }
    })

    const failedCount = children.filter((child) => child.status === "failed").length
    const successfulCount = children.filter((child) => this.hasBatchResult(child)).length
    const status =
      failedCount === children.length
        ? "failed"
        : children.every((child) => this.hasBatchResult(child))
          ? "succeeded"
          : failedCount > 0 &&
              partialFailure === "return-successful" &&
              successfulCount > 0
            ? "succeeded"
            : "running"
    const batch: GenerationJob = {
      id: createId("mr_batch"),
      type: "image",
      provider: request.provider,
      providerId: plugin.id,
      model: request.model,
      status,
      children,
      error:
        status === "failed"
          ? createMediaRouterError("PROVIDER_ERROR", "Batch generation failed", {
              provider: request.provider,
              model: request.model,
              raw: children,
            })
          : undefined,
      providerState: { partialFailure },
      createdAt: new Date().toISOString(),
    }
    return status === "succeeded" ? this.withBatchResult(batch) : batch
  }

  private normalizeStatusJob(job: GenerationJob): GenerationJob {
    if (job.status !== "failed") return job
    if (!job.error) {
      return {
        ...job,
        error: createMediaRouterError("PROVIDER_ERROR", "Generation failed", {
          provider: job.provider,
          model: job.model,
          raw: job.raw,
        }),
      }
    }
    const normalized = normalizeMediaRouterError(job.error, {
      provider: job.provider,
      model: job.model,
    })
    if (normalized) {
      return {
        ...job,
        error: {
          ...normalized,
          provider: job.provider,
          model: job.model,
        },
      }
    }
    return {
      ...job,
      error: createMediaRouterError("UNKNOWN", "Unknown provider error", {
        provider: job.provider,
        model: job.model,
        raw: job.error,
      }),
    }
  }

  private async statusBatchJob(job: GenerationJob): Promise<GenerationJob> {
    const partialFailure = job.providerState?.partialFailure === "return-successful"
    const children = await Promise.all(
      (job.children ?? []).map((child) =>
        child.status === "running" || child.status === "queued"
          ? this.status(child).catch((error) => {
              if (!partialFailure) throw error
              const { runtime } = this.registry.get(child.provider)
              return {
                ...child,
                status: "failed",
                error: this.normalizeError(error, runtime, undefined, child),
                updatedAt: new Date().toISOString(),
              } satisfies GenerationJob
            })
          : Promise.resolve(this.normalizeStatusJob(child)),
      ),
    )
    const normalizedChildren = children.map((child) =>
      child.status === "succeeded" && !child.result
        ? {
            ...child,
            status: "failed" as const,
            error: createMediaRouterError(
              "PROVIDER_ERROR",
              "Succeeded batch child is missing result",
              {
                provider: child.provider,
                model: child.model,
                raw: child,
              },
            ),
            updatedAt: new Date().toISOString(),
          }
        : child,
    )
    const hasRunning = children.some(
      (child) => child.status === "running" || child.status === "queued",
    )
    const hasSucceeded = normalizedChildren.some((child) => this.hasBatchResult(child))
    const hasFailed = normalizedChildren.some(
      (child) => child.status === "failed" || child.status === "cancelled",
    )
    const status = hasRunning
      ? "running"
      : hasFailed && (!partialFailure || !hasSucceeded)
        ? "failed"
        : "succeeded"
    const nextJob = {
      ...job,
      status,
      children: normalizedChildren,
      error:
        status === "failed"
          ? createMediaRouterError("PROVIDER_ERROR", "Batch generation failed", {
              provider: job.provider,
              model: job.model,
              raw: normalizedChildren,
            })
          : undefined,
      updatedAt: new Date().toISOString(),
    }
    return status === "succeeded" ? this.withBatchResult(nextJob) : nextJob
  }

  private withBatchResult(job: GenerationJob): GenerationJob {
    const successful = (job.children ?? []).filter(
      (child) => this.hasBatchResult(child),
    )
    if (successful.length === 0) return job
    const completedAt = job.updatedAt ?? new Date().toISOString()
    return {
      ...job,
      result: {
        id: `${job.id}_result`,
        jobId: job.id,
        type: job.type,
        provider: job.provider,
        providerId: job.providerId,
        model: job.model,
        status: "succeeded",
        assets: successful.flatMap((child) => child.result?.assets ?? []),
        children: (job.children ?? []).map((child) => ({
          jobId: child.id,
          providerJobId: child.providerJobId,
          status: child.status,
          error: child.error,
        })),
        timings: {
          createdAt: job.createdAt ?? completedAt,
          completedAt,
        },
      },
    }
  }

  private hasBatchResult(job: GenerationJob): boolean {
    return job.status === "succeeded" && Boolean(job.result)
  }

  private prepare<T extends GenerationRequest>(request: T): {
    request: T
    model: ModelDefinition
    runtime: ProviderRuntimeContext
  } {
    const { plugin, config, runtime } = this.registry.get(request.provider)
    const model = resolveModelDefinition(plugin, config, request.model)
    validateGenerationRequest({ request, model })
    const resolvedModel = model as ModelDefinition
    const withDefaults = this.applyDefaults(request, resolvedModel)
    validateGenerationRequest({ request: withDefaults, model: resolvedModel })
    const resolvedDimensions = resolveDimensions({
      width: withDefaults.options?.width,
      height: withDefaults.options?.height,
      mediaType: withDefaults.type ?? resolvedModel.type,
      capabilities: resolvedModel.capabilities?.dimensions,
      mode: withDefaults.options?.dimensionMode,
      provider: withDefaults.provider,
      model: withDefaults.model,
    })

    return {
      request: withDefaults,
      model: resolvedModel,
      runtime: {
        ...runtime,
        resolved: {
          dimensions: resolvedDimensions,
        },
      },
    }
  }

  private applyDefaults<T extends GenerationRequest>(
    request: T,
    model: ModelDefinition,
  ): T {
    if (!model.defaults) return request
    return {
      ...request,
      options: {
        ...model.defaults.options,
        ...request.options,
      },
      providerOptions: {
        ...model.defaults.providerOptions,
        ...request.providerOptions,
      },
    } as T
  }

  private normalizeError(
    error: unknown,
    runtime: ProviderRuntimeContext,
    request?: GenerationRequest,
    job?: GenerationJob,
  ): MediaRouterError {
    const fallback = {
      provider: request?.provider ?? job?.provider ?? runtime.provider,
      model: request?.model ?? job?.model ?? "unknown",
    }
    const normalized = normalizeMediaRouterError(error, fallback)
    if (normalized) return normalized
    const custom = runtime.plugin.driver.normalizeError?.(error, { request, job, runtime })
    const normalizedCustom = normalizeMediaRouterError(custom, fallback)
    if (normalizedCustom) return normalizedCustom
    if (custom) return normalizeUnknownError(custom, fallback)
    return normalizeUnknownError(error, fallback)
  }
}
