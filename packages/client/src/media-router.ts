import {
  MediaRouterException,
  createMediaRouterError,
  normalizeMediaRouterError,
  normalizeUnknownError,
  resolveDimensions,
  resolveModelDefinition,
  validateGenerationRequest,
  type GenerationJob,
  type GenerationRequest,
  type GenerationResult,
  type MediaRouterError,
  type ModelDefinition,
  type PartialFailureMode,
  type ProviderPlugin,
  type ProviderRuntimeContext,
} from "@miragari/ai-media-router-core"
import {
  cancelBatchJob,
  createSplitImageJob,
  shouldSplitImages,
  statusBatchJob,
} from "./batch.js"
import {
  isNormalizedImageRequest,
  normalizeAudioRequest,
  normalizeGenerationRequest,
  normalizeImageRequest,
  normalizeMediaRouterDefaults,
  normalizeModel3DRequest,
  normalizeVideoRequest,
  resolveMediaRouterProfile,
  type AudioGenerationInput,
  type GenerationMediaType,
  type GenerationInput,
  type ImageGenerationInput,
  type MediaRouterDefaultSlot,
  type MediaRouterDefaults,
  type MediaRouterProfile,
  type Model3DGenerationInput,
  type NormalizedMediaRouterDefaults,
  type NormalizedGenerationRequest,
  type NormalizedImageGenerationRequest,
  type VideoGenerationInput,
} from "./normalize.js"
import {
  normalizeProviderCreateOutput,
  normalizeProviderJob,
} from "./provider-output.js"
import {
  ProviderRegistry,
  type ProviderInstanceInput,
  type ProviderRegistryEntry,
} from "./registry.js"
import { normalizeTerminalJob } from "./terminal.js"
import { waitForJob, type WaitOptions } from "./wait.js"

export type MediaRouterOptions = {
  plugins: Record<string, ProviderPlugin>
  providers: Record<string, ProviderInstanceInput>
  defaults?: MediaRouterDefaults
  fetch?: typeof fetch
}

export type RunOptions = WaitOptions & {
  dimensionMode?: "nearest" | "strict"
  profile?: string
  defaults?: MediaRouterDefaults
  provider?: MediaRouterDefaults["provider"]
  model?: MediaRouterDefaults["model"]
  profiles?: MediaRouterDefaults["profiles"]
  image?: MediaRouterDefaultSlot
  video?: MediaRouterDefaultSlot
  audio?: MediaRouterDefaultSlot
  model3d?: MediaRouterDefaultSlot
  maxConcurrency?: number
  partialFailure?: PartialFailureMode
  batch?: {
    maxConcurrency?: number
    partialFailure?: PartialFailureMode
  }
}

type PreparedRequest<T extends NormalizedGenerationRequest> = {
  request: T
  model: ModelDefinition
  runtime: ProviderRuntimeContext
}

const generationMediaTypes = ["image", "video", "audio", "model3d"] as const

export class MediaRouter {
  private readonly registry: ProviderRegistry
  private readonly defaults: NormalizedMediaRouterDefaults | undefined

  constructor(options: MediaRouterOptions) {
    this.registry = new ProviderRegistry(options)
    const explicitDefaults = normalizeMediaRouterDefaults(options.defaults)
    this.defaults = mergeMediaRouterDefaults(
      inferRegistryDefaults(this.registry, explicitDefaults),
      explicitDefaults,
    )
  }

  profile(profile: string): ProfiledMediaRouter {
    const normalizedProfile = typeof profile === "string" ? profile.trim() : ""
    if (!normalizedProfile) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", "Profile name must be a non-empty string", {
          provider: "router",
        }),
      )
    }
    const profileConfig = this.resolveProfileBinding(normalizedProfile)
    return new ProfiledMediaRouter(
      this,
      normalizedProfile,
      this.profileStringField(profileConfig),
    )
  }

  async create(input: GenerationInput, options?: RunOptions): Promise<GenerationJob> {
    return this.createMedia(input, undefined, options)
  }

  private async createMedia(
    input: GenerationInput,
    mediaType: GenerationMediaType | undefined,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createNormalized(this.normalizeInput(input, mediaType, options), options)
  }

  private async createNormalized<T extends NormalizedGenerationRequest>(
    request: T,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    this.validateRunOptions(request, options)
    const prepared = this.prepare(request, options)
    if (
      isNormalizedImageRequest(prepared.request) &&
      shouldSplitImages(prepared.request, prepared.model)
    ) {
      return this.createSplitImageJob(prepared.request, options)
    }
    return this.executePrepared(prepared)
  }

  private async executePrepared<T extends NormalizedGenerationRequest>(
    prepared: PreparedRequest<T>,
  ): Promise<GenerationJob> {
    try {
      const output = await prepared.runtime.plugin.driver.create({
        ...prepared.runtime,
        request: prepared.request,
        model: prepared.model,
      })
      return normalizeProviderCreateOutput(output, {
        provider: prepared.request.provider,
        providerId: prepared.runtime.providerId,
        model: prepared.request.model,
        type: prepared.request.type,
      })
    } catch (error) {
      throw new MediaRouterException(
        this.normalizeError(error, prepared.runtime, prepared.request),
      )
    }
  }

  async createImage(
    input: ImageGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "image", options)
  }

  async createVideo(
    input: VideoGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "video", options)
  }

  async createAudio(
    input: AudioGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "audio", options)
  }

  async createModel3D(
    input: Model3DGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "model3d", options)
  }

  async status(job: GenerationJob): Promise<GenerationJob> {
    if (job.children?.length) return this.statusBatchJob(job)
    const { runtime } = this.registry.get(job.provider)
    if (!runtime.plugin.driver.poll) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", "Provider does not support status polling", {
          provider: job.provider,
          model: job.model,
        }),
      )
    }
    try {
      const polled = await runtime.plugin.driver.poll({ ...runtime, job })
      return this.normalizeStatusJob(
        normalizeProviderJob(polled, {
          provider: job.provider,
          providerId: job.providerId,
          model: job.model,
          type: job.type,
        }),
      )
    } catch (error) {
      throw new MediaRouterException(this.normalizeError(error, runtime, undefined, job))
    }
  }

  async cancel(job: GenerationJob): Promise<void> {
    if (job.children?.length) return this.cancelBatchJob(job)
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
    if (job.children?.length) {
      return waitForJob({
        job,
        resolveProvider: (provider) => this.registry.get(provider).runtime,
        options,
      })
    }
    const { runtime } = this.registry.get(job.provider)
    return waitForJob({
      job,
      runtime,
      resolveProvider: (provider) => this.registry.get(provider).runtime,
      options,
    })
  }

  async generate(input: GenerationInput, options?: RunOptions): Promise<GenerationResult> {
    return this.generateMedia(input, undefined, options)
  }

  private async generateMedia(
    input: GenerationInput,
    mediaType: GenerationMediaType | undefined,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    const job = await this.createMedia(input, mediaType, options)
    return this.wait(job, options)
  }

  async generateImage(
    input: ImageGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "image", options)
  }

  async generateVideo(
    input: VideoGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "video", options)
  }

  async generateAudio(
    input: AudioGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "audio", options)
  }

  async generateModel3D(
    input: Model3DGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "model3d", options)
  }

  private async createSplitImageJob(
    request: NormalizedImageGenerationRequest,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return createSplitImageJob({
      request,
      options,
      resolveProvider: (provider) => this.resolveBatchProvider(provider),
      createChild: (childRequest, childOptions) =>
        this.createNormalized(childRequest, childOptions),
      normalizeError: (error, runtime, childRequest, job) =>
        this.normalizeError(error, runtime, childRequest, job),
    })
  }

  private normalizeStatusJob(job: GenerationJob): GenerationJob {
    return normalizeTerminalJob(job)
  }

  private async cancelBatchJob(job: GenerationJob): Promise<void> {
    return cancelBatchJob({
      job,
      resolveProvider: (provider) => this.resolveBatchProvider(provider),
      normalizeError: (error, runtime, request, childJob) =>
        this.normalizeError(error, runtime, request, childJob),
    })
  }

  private async statusBatchJob(job: GenerationJob): Promise<GenerationJob> {
    return statusBatchJob({
      job,
      statusChild: (child) => this.status(child),
      normalizeStatusJob: (child) => this.normalizeStatusJob(child),
      normalizeError: (error, runtime, request, childJob) =>
        this.normalizeError(error, runtime, request, childJob),
    })
  }

  private resolveBatchProvider(provider: string): {
    providerId: string
    runtime: ProviderRuntimeContext
  } {
    const { plugin, runtime } = this.registry.get(provider)
    return { providerId: plugin.id, runtime }
  }

  private normalizeInput(
    input: GenerationInput,
    mediaType: GenerationMediaType | undefined,
    options?: RunOptions,
  ): NormalizedGenerationRequest {
    const defaults = this.defaultsFor(options)
    this.validateResolvedDefaultProvider(defaults, mediaType)
    const profiledInput = this.applyRunProfile(input, defaults, mediaType, options)
    if (mediaType === "image") {
      return normalizeImageRequest(profiledInput as ImageGenerationInput, defaults)
    }
    if (mediaType === "video") {
      return normalizeVideoRequest(profiledInput as VideoGenerationInput, defaults)
    }
    if (mediaType === "audio") {
      return normalizeAudioRequest(profiledInput as AudioGenerationInput, defaults)
    }
    if (mediaType === "model3d") {
      return normalizeModel3DRequest(profiledInput as Model3DGenerationInput, defaults)
    }
    return normalizeGenerationRequest(profiledInput, defaults)
  }

  private validateResolvedDefaultProvider(
    defaults: NormalizedMediaRouterDefaults | undefined,
    mediaType: GenerationMediaType | undefined,
  ): void {
    const provider = mediaType
      ? defaults?.providers?.[mediaType] ?? defaults?.provider
      : defaults?.provider
    if (provider) this.registry.get(provider)
  }

  private defaultsFor(options: RunOptions | undefined): NormalizedMediaRouterDefaults | undefined {
    return mergeMediaRouterDefaults(
      this.defaults,
      runOptionDefaults(options),
    )
  }

  private applyRunProfile(
    input: GenerationInput,
    defaults: NormalizedMediaRouterDefaults | undefined,
    mediaType: GenerationMediaType | undefined,
    options: RunOptions | undefined,
  ): GenerationInput {
    if (!options?.profile) return input
    const profile = resolveMediaRouterProfile(defaults, options.profile)
    const stringField = mediaType === "audio" || profile?.type === "audio" ? "text" : "prompt"
    return withProfile(options.profile, input, stringField)
  }

  private prepare<T extends NormalizedGenerationRequest>(
    request: T,
    options?: RunOptions,
  ): PreparedRequest<T> {
    const { plugin, config, runtime } = this.registry.get(request.provider)
    const model = resolveModelDefinition(plugin, config, request.model)
    validateGenerationRequest({ request, model })
    const resolvedModel = model as ModelDefinition
    const withDefaults = this.applyDefaults(request, resolvedModel)
    validateGenerationRequest({ request: withDefaults, model: resolvedModel })
    const dimensionOptions = withDefaults.options as
      | { width?: number; height?: number }
      | undefined
    const resolvedDimensions = resolveDimensions({
      width: dimensionOptions?.width,
      height: dimensionOptions?.height,
      mediaType: withDefaults.type,
      capabilities: resolvedModel.capabilities?.dimensions,
      mode: options?.dimensionMode,
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

  private validateRunOptions(request: GenerationRequest, options: RunOptions | undefined): void {
    const maxConcurrency = options?.batch?.maxConcurrency ?? options?.maxConcurrency
    if (maxConcurrency != null && (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", "maxConcurrency must be a positive integer", {
          provider: request.provider,
          model: request.model,
        }),
      )
    }
  }

  private resolveProfileBinding(profile: string): MediaRouterProfile {
    return resolveMediaRouterProfile(this.defaults, profile) as MediaRouterProfile
  }

  private profileStringField(profile: MediaRouterProfile): "prompt" | "text" {
    return profile.type === "audio" ? "text" : "prompt"
  }
}

export class ProfiledMediaRouter {
  constructor(
    private readonly router: MediaRouter,
    readonly profile: string,
    private readonly stringField: "prompt" | "text",
  ) {}

  async create(input: GenerationInput, options?: RunOptions): Promise<GenerationJob> {
    return this.createMedia(input, undefined, options)
  }

  async createImage(
    input: ImageGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "image", options)
  }

  async createVideo(
    input: VideoGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "video", options)
  }

  async createAudio(
    input: AudioGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "audio", options)
  }

  async createModel3D(
    input: Model3DGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    return this.createMedia(input, "model3d", options)
  }

  async generate(
    input: GenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, undefined, options)
  }

  async generateImage(
    input: ImageGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "image", options)
  }

  async generateVideo(
    input: VideoGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "video", options)
  }

  async generateAudio(
    input: AudioGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "audio", options)
  }

  async generateModel3D(
    input: Model3DGenerationInput,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    return this.generateMedia(input, "model3d", options)
  }

  async status(job: GenerationJob): Promise<GenerationJob> {
    return this.router.status(job)
  }

  async wait(job: GenerationJob, options?: WaitOptions): Promise<GenerationResult> {
    return this.router.wait(job, options)
  }

  async cancel(job: GenerationJob): Promise<void> {
    return this.router.cancel(job)
  }

  private createMedia(
    input: GenerationInput,
    mediaType: GenerationMediaType | undefined,
    options?: RunOptions,
  ): Promise<GenerationJob> {
    const profiled = withProfile(this.profile, input, this.stringFieldFor(mediaType))
    if (mediaType === "image") {
      return this.router.createImage(profiled as ImageGenerationInput, options)
    }
    if (mediaType === "video") {
      return this.router.createVideo(profiled as VideoGenerationInput, options)
    }
    if (mediaType === "audio") {
      return this.router.createAudio(profiled as AudioGenerationInput, options)
    }
    if (mediaType === "model3d") {
      return this.router.createModel3D(profiled as Model3DGenerationInput, options)
    }
    return this.router.create(profiled, options)
  }

  private generateMedia(
    input: GenerationInput,
    mediaType: GenerationMediaType | undefined,
    options?: RunOptions,
  ): Promise<GenerationResult> {
    const profiled = withProfile(this.profile, input, this.stringFieldFor(mediaType))
    if (mediaType === "image") {
      return this.router.generateImage(profiled as ImageGenerationInput, options)
    }
    if (mediaType === "video") {
      return this.router.generateVideo(profiled as VideoGenerationInput, options)
    }
    if (mediaType === "audio") {
      return this.router.generateAudio(profiled as AudioGenerationInput, options)
    }
    if (mediaType === "model3d") {
      return this.router.generateModel3D(profiled as Model3DGenerationInput, options)
    }
    return this.router.generate(profiled, options)
  }

  private stringFieldFor(mediaType: GenerationMediaType | undefined): "prompt" | "text" {
    return mediaType === "audio" ? "text" : this.stringField
  }
}

function withProfile<T extends GenerationInput>(
  profile: string,
  input: T,
  stringField: "prompt" | "text" = "prompt",
): GenerationInput {
  if (typeof input === "string") {
    return { profile, [stringField]: input }
  }
  const existing = (input as { profile?: unknown }).profile
  if (existing != null && existing !== profile) {
    throw new MediaRouterException(
      createMediaRouterError(
        "BAD_REQUEST",
        `Profile binding ${profile} cannot be used with input profile ${String(existing)}`,
        { provider: "router" },
      ),
    )
  }
  return { ...input, profile } as GenerationInput
}

function mergeMediaRouterDefaults(
  base: NormalizedMediaRouterDefaults | undefined,
  override: NormalizedMediaRouterDefaults | undefined,
): NormalizedMediaRouterDefaults | undefined {
  if (!base) return override
  if (!override) return base
  return compactDefaults({
    ...base,
    ...override,
    providers: mergeRecord(base.providers, override.providers),
    models: mergeRecord(base.models, override.models),
    options: mergeMediaRecordMap(base.options, override.options),
    providerOptions: mergeMediaRecordMap(base.providerOptions, override.providerOptions),
    profiles: mergeProfiles(base.profiles, override.profiles),
  })
}

function runOptionDefaults(
  options: RunOptions | undefined,
): NormalizedMediaRouterDefaults | undefined {
  if (!options) return undefined
  const shortcuts = runOptionDefaultShortcuts(options)
  if (!shortcuts) return normalizeMediaRouterDefaults(options.defaults)
  return mergeMediaRouterDefaults(
    normalizeMediaRouterDefaults(shortcuts),
    normalizeMediaRouterDefaults(options.defaults),
  )
}

function runOptionDefaultShortcuts(options: RunOptions): MediaRouterDefaults | undefined {
  if (
    !options.provider &&
    !options.model &&
    !options.profiles &&
    options.image === undefined &&
    options.video === undefined &&
    options.audio === undefined &&
    options.model3d === undefined
  ) {
    return undefined
  }
  return {
    provider: options.provider,
    model: options.model,
    profiles: options.profiles,
    image: options.image,
    video: options.video,
    audio: options.audio,
    model3d: options.model3d,
  }
}

function inferRegistryDefaults(
  registry: ProviderRegistry,
  explicit: NormalizedMediaRouterDefaults | undefined,
): NormalizedMediaRouterDefaults | undefined {
  const entries = registry.entries()
  const defaults: NormalizedMediaRouterDefaults = {}
  for (const mediaType of generationMediaTypes) {
    const entry = inferredProviderEntry(entries, explicit, mediaType)
    if (!entry) continue
    const model = firstModelForMediaType(entry.plugin, mediaType)
    if (!model) continue
    if (!resolvedDefaultProvider(explicit, mediaType)) {
      defaults.providers = {
        ...defaults.providers,
        [mediaType]: entry.provider,
      }
    }
    if (!resolvedDefaultModel(explicit, mediaType)) {
      defaults.models = {
        ...defaults.models,
        [mediaType]: model,
      }
    }
  }
  return compactDefaults(defaults)
}

function inferredProviderEntry(
  entries: ProviderRegistryEntry[],
  explicit: NormalizedMediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
): ProviderRegistryEntry | undefined {
  const provider = resolvedDefaultProvider(explicit, mediaType)
  if (provider) {
    const entry = entries.find((item) => item.provider === provider)
    return entry && firstModelForMediaType(entry.plugin, mediaType) ? entry : undefined
  }
  return entries.find((entry) => firstModelForMediaType(entry.plugin, mediaType))
}

function firstModelForMediaType(
  plugin: ProviderPlugin,
  mediaType: GenerationMediaType,
): string | undefined {
  const defaultModel = plugin.defaultModels?.[mediaType]
  if (defaultModel && plugin.models[defaultModel]?.type === mediaType) return defaultModel
  return Object.values(plugin.models).find((model) => model.type === mediaType)?.id
}

function resolvedDefaultProvider(
  defaults: NormalizedMediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
): string | undefined {
  return defaults?.providers?.[mediaType] ?? defaults?.provider
}

function resolvedDefaultModel(
  defaults: NormalizedMediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
): string | undefined {
  return defaults?.models?.[mediaType] ?? defaults?.model
}

function mergeRecord<T>(
  base: Partial<Record<GenerationMediaType, T>> | undefined,
  override: Partial<Record<GenerationMediaType, T>> | undefined,
): Partial<Record<GenerationMediaType, T>> | undefined {
  if (!base) return override
  if (!override) return base
  return compactRecord({ ...base, ...override })
}

function mergeMediaRecordMap(
  base: Partial<Record<GenerationMediaType, Record<string, unknown>>> | undefined,
  override: Partial<Record<GenerationMediaType, Record<string, unknown>>> | undefined,
): Partial<Record<GenerationMediaType, Record<string, unknown>>> | undefined {
  if (!base) return override
  if (!override) return base
  const result: Partial<Record<GenerationMediaType, Record<string, unknown>>> = { ...base }
  for (const mediaType of ["image", "video", "audio", "model3d"] as const) {
    result[mediaType] = compactRecord({
      ...base[mediaType],
      ...override[mediaType],
    })
  }
  return compactRecord(result)
}

function mergeProfiles(
  base: Record<string, MediaRouterProfile> | undefined,
  override: Record<string, MediaRouterProfile> | undefined,
): Record<string, MediaRouterProfile> | undefined {
  if (!base) return override
  if (!override) return base
  const result: Record<string, MediaRouterProfile> = { ...base }
  for (const [name, profile] of Object.entries(override)) {
    result[name] = mergeProfile(result[name], profile)
  }
  return compactRecord(result)
}

function mergeProfile(
  base: MediaRouterProfile | undefined,
  override: MediaRouterProfile,
): MediaRouterProfile {
  if (!base) return override
  return compactRecord({
    ...base,
    ...override,
    options: compactRecord({
      ...base.options,
      ...override.options,
    }),
    providerOptions: compactRecord({
      ...base.providerOptions,
      ...override.providerOptions,
    }),
  }) as MediaRouterProfile
}

function compactDefaults(
  defaults: NormalizedMediaRouterDefaults,
): NormalizedMediaRouterDefaults | undefined {
  return compactRecord(defaults) as NormalizedMediaRouterDefaults
}

function compactRecord<T extends object>(record: T): T | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined)
  return entries.length ? Object.fromEntries(entries) as T : undefined
}
