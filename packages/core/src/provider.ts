import type { DimensionCapabilities } from "./dimensions.js"
import type {
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  GenerationStatus,
  MediaRouterError,
  MediaType,
  ResolvedDimensions,
} from "./types.js"

export type AuthDefinition =
  | { type: "bearer"; header?: string }
  | { type: "api-key"; in?: "header"; header: string }
  | { type: "api-key"; in: "query"; query: string }
  | { type: "none" }

export type ModelMode =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "audio-to-video"

export type CountCapability = {
  supported: boolean
  max?: number
  strategy?: "native" | "split"
}

export type ModelDefinition = {
  id: string
  type: MediaType
  modes: ModelMode[]
  async: boolean
  defaults?: {
    options?: Record<string, unknown>
    providerOptions?: Record<string, unknown>
  }
  capabilities?: {
    dimensions?: DimensionCapabilities
    count?: CountCapability
    maxImages?: number
    maxVideos?: number
    maxAudios?: number
    durations?: number[]
    fps?: number[]
    supportsSeed?: boolean
    supportsWebhook?: boolean
  }
}

export type ProviderInstanceConfig = {
  plugin: string
  baseURL?: string
  apiKey?: string
  auth?: AuthDefinition
  headers?: Record<string, string>
  models?: Record<string, Partial<ModelDefinition>>
  options?: Record<string, unknown>
}

export type ProviderRuntimeContext = {
  provider: string
  providerId: string
  plugin: ProviderPlugin
  config: ProviderInstanceConfig
  fetch: typeof fetch
  resolved: {
    dimensions?: ResolvedDimensions
  }
}

export type ProviderCreateContext = ProviderRuntimeContext & {
  request: GenerationRequest
  model: ModelDefinition
}

export type ProviderPollContext = ProviderRuntimeContext & {
  job: GenerationJob
}

export type ProviderCancelContext = ProviderRuntimeContext & {
  job: GenerationJob
}

export type ProviderCreateOutput =
  | { kind: "completed"; result: GenerationResult }
  | { kind: "pending"; job: GenerationJob }

export type ProviderDriver = {
  create: (context: ProviderCreateContext) => Promise<ProviderCreateOutput>
  poll?: (context: ProviderPollContext) => Promise<GenerationJob>
  cancel?: (context: ProviderCancelContext) => Promise<void>
  normalizeError?: (
    error: unknown,
    context: {
      request?: GenerationRequest
      job?: GenerationJob
      runtime: ProviderRuntimeContext
    },
  ) => MediaRouterError
}

export type ProviderPlugin = {
  id: string
  displayName: string
  baseURL?: string
  auth?: AuthDefinition
  models: Record<string, ModelDefinition>
  driver: ProviderDriver
}

export function defineProvider(plugin: ProviderPlugin): ProviderPlugin {
  return plugin
}

export function resolveModelDefinition(
  plugin: ProviderPlugin,
  config: ProviderInstanceConfig,
  modelId: string,
): ModelDefinition | undefined {
  const base = plugin.models[modelId]
  if (!base) return undefined
  const override = config.models?.[modelId]
  if (!override) return base
  return {
    ...base,
    ...override,
    defaults: {
      ...base.defaults,
      ...override.defaults,
    },
    capabilities: {
      ...base.capabilities,
      ...override.capabilities,
    },
  }
}

export function mapProviderStatus(
  status: string | undefined,
  statusMap: Record<string, GenerationStatus> | undefined,
): GenerationStatus {
  if (!status) return "running"
  return statusMap?.[status] ?? "running"
}
