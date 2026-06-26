import {
  MediaRouter,
  type GenerationMediaType,
  type MediaRouterDefaultSlot,
  type MediaRouterDefaultSlotObject,
  type MediaRouterDefaults,
  type MediaRouterOptions,
  type MediaRouterProfile,
} from "@miragari/client"
import {
  MediaRouterException,
  createMediaRouterError,
  type ProviderPlugin,
} from "@miragari/core"
import { builtinProviderPlugins } from "./builtin.js"

const builtinProviderEnvKeys = {
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  qwen: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
  happyhorse: ["FAL_KEY", "FAL_API_KEY"],
  volcengine: ["ARK_API_KEY", "VOLCENGINE_API_KEY"],
} as const

const generationMediaTypes = ["image", "video", "audio", "model3d"] as const

export type BuiltinProviderName = keyof typeof builtinProviderEnvKeys
type BuiltinProviderList = readonly BuiltinProviderName[]
type BuiltinProviderInput = MediaRouterOptions["providers"] | BuiltinProviderList
type BuiltinProviderTopLevelConfigs = Partial<
  Record<BuiltinProviderName, MediaRouterOptions["providers"][string]>
>
export type BuiltinMediaRouterProfileInput = MediaRouterProfile | GenerationMediaType
export type BuiltinMediaRouterProfiles = Record<string, BuiltinMediaRouterProfileInput>
/**
 * Built-in router media slot defaults. Unknown keys are treated as
 * `options` shorthand by `createMediaRouter`.
 */
export type BuiltinMediaRouterDefaultSlot = MediaRouterDefaultSlot
export type BuiltinMediaRouterInput =
  | BuiltinMediaRouterOptions
  | BuiltinProviderName
  | BuiltinProviderList

export type BuiltinMediaRouterOptions = Omit<
  MediaRouterOptions,
  "plugins" | "providers"
> &
  BuiltinProviderTopLevelConfigs & {
  plugins?: MediaRouterOptions["plugins"]
  providers?: BuiltinProviderInput
  provider?: MediaRouterDefaults["provider"]
  model?: MediaRouterDefaults["model"]
  apiKey?: string
  profiles?: BuiltinMediaRouterProfiles
  image?: BuiltinMediaRouterDefaultSlot
  video?: BuiltinMediaRouterDefaultSlot
  audio?: BuiltinMediaRouterDefaultSlot
  model3d?: BuiltinMediaRouterDefaultSlot
}

export function createMediaRouter(input: BuiltinMediaRouterInput = {}): MediaRouter {
  const options = builtinMediaRouterOptions(input)
  const plugins = providerPlugins(options)
  const providers = providerInstances(options)
  const defaults = optionDefaults(options)
  const {
    provider: _provider,
    model: _model,
    apiKey: _apiKey,
    profiles: _profiles,
    image: _image,
    video: _video,
    audio: _audio,
    model3d: _model3d,
    ...restOptions
  } = options
  return new MediaRouter({
    ...stripTopLevelProviderConfigs(restOptions),
    providers,
    plugins,
    defaults,
  })
}

function builtinMediaRouterOptions(input: BuiltinMediaRouterInput): BuiltinMediaRouterOptions {
  if (Array.isArray(input)) return { providers: input }
  if (typeof input === "string") return { provider: input }
  return input as BuiltinMediaRouterOptions
}

function optionDefaults(options: BuiltinMediaRouterOptions): MediaRouterDefaults | undefined {
  if (
    !options.provider &&
    !options.model &&
    !options.profiles &&
    options.image === undefined &&
    options.video === undefined &&
    options.audio === undefined &&
    options.model3d === undefined
  ) {
    return options.defaults
  }
  const defaults = {
    provider: options.provider,
    model: options.model,
    ...options.defaults,
    image: mergeSlot(normalizeSlot(options.image), options.defaults?.image),
    video: mergeSlot(normalizeSlot(options.video), options.defaults?.video),
    audio: mergeSlot(normalizeSlot(options.audio), options.defaults?.audio),
    model3d: mergeSlot(normalizeSlot(options.model3d), options.defaults?.model3d),
  }
  if (!options.profiles) return defaults
  return {
    ...defaults,
    profiles: normalizeProfiles({
      ...options.profiles,
      ...options.defaults?.profiles,
    }),
  }
}

function normalizeProfiles(
  profiles: BuiltinMediaRouterProfiles | undefined,
): MediaRouterDefaults["profiles"] | undefined {
  if (!profiles) return undefined
  return Object.fromEntries(
    Object.entries(profiles).map(([name, profile]) => [
      name,
      typeof profile === "string" ? profileFromType(name, profile) : profile,
    ]),
  )
}

function normalizeSlot(
  slot: BuiltinMediaRouterDefaultSlot | undefined,
): MediaRouterDefaultSlotObject | undefined {
  if (slot === undefined) return undefined
  if (typeof slot === "string") return { model: slot }
  const {
    provider,
    model,
    options,
    providerOptions,
    ...optionShorthand
  } = slot
  return {
    provider,
    model,
    options: mergeRecord(nonEmptyRecord(optionShorthand), options),
    providerOptions,
  }
}

function mergeRecord(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base) return override
  if (!override) return base
  return {
    ...base,
    ...override,
  }
}

function nonEmptyRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function profileFromType(name: string, type: string): MediaRouterProfile {
  if (isGenerationMediaType(type)) return { type }
  throw new MediaRouterException(
    createMediaRouterError(
      "BAD_REQUEST",
      `Profile ${name} uses unsupported media type: ${type}`,
      { provider: "router" },
    ),
  )
}

function isGenerationMediaType(type: string): type is GenerationMediaType {
  return (generationMediaTypes as readonly string[]).includes(type)
}

function providerPlugins(options: BuiltinMediaRouterOptions): Record<string, ProviderPlugin> {
  return {
    ...builtinProviderPlugins,
    ...options.plugins,
  }
}

function providerInstances(options: BuiltinMediaRouterOptions): MediaRouterOptions["providers"] {
  const { providers } = options
  if (!providers) {
    const topLevelProviders = topLevelProviderInstances(options)
    if (topLevelProviders) return topLevelProviders
    const provider = effectiveDefaultProvider(options)
    if (isBuiltinProviderName(provider)) {
      return { [provider]: topLevelApiKey(options, provider) ?? requiredEnvApiKey(provider) }
    }
    return envProviders(options)
  }
  if (Array.isArray(providers)) {
    return Object.fromEntries(
      providers.map((provider) => [provider, requiredEnvApiKey(provider)]),
    )
  }
  return providers as MediaRouterOptions["providers"]
}

function topLevelProviderInstances(
  options: BuiltinMediaRouterOptions,
): MediaRouterOptions["providers"] | undefined {
  const entries = (Object.keys(builtinProviderEnvKeys) as BuiltinProviderName[])
    .map((provider) => [provider, options[provider]] as const)
    .filter(([, value]) => value !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function stripTopLevelProviderConfigs<T extends Record<string, unknown>>(
  options: T,
): Omit<T, BuiltinProviderName> {
  const stripped = { ...options }
  for (const provider of Object.keys(builtinProviderEnvKeys) as BuiltinProviderName[]) {
    delete stripped[provider]
  }
  return stripped
}

function isBuiltinProviderName(provider: unknown): provider is BuiltinProviderName {
  return (
    typeof provider === "string" &&
    Object.prototype.hasOwnProperty.call(builtinProviderEnvKeys, provider)
  )
}

function effectiveDefaultProvider(options: BuiltinMediaRouterOptions): string | undefined {
  return optionDefaults(options)?.provider
}

function topLevelApiKey(
  options: BuiltinMediaRouterOptions,
  provider: BuiltinProviderName,
): string | undefined {
  return options.provider === provider ? options.apiKey : undefined
}

function envProviders(options: BuiltinMediaRouterOptions): MediaRouterOptions["providers"] {
  const discovered = Object.fromEntries(
    (Object.keys(builtinProviderEnvKeys) as BuiltinProviderName[])
      .map((provider) => [provider, envApiKey(provider)] as const)
      .filter(([, apiKey]) => apiKey),
  )
  const providerNames = Object.keys(discovered)
  if (providerNames.length > 1) {
    throw new MediaRouterException(
      createMediaRouterError(
        "BAD_REQUEST",
        `Multiple provider environment variables were found (${providerNames.join(", ")}). Pass provider, providers: [...], or defaults.provider to choose one.`,
        { provider: "router", raw: { providers: providerNames } },
      ),
    )
  }
  return discovered
}

function requiredEnvApiKey(provider: BuiltinProviderName): string {
  const apiKey = envApiKey(provider)
  if (apiKey) return apiKey
  throw new MediaRouterException(
    createMediaRouterError(
      "AUTH_ERROR",
      `Missing API key for ${provider}. Set ${envKeyLabel(provider)} or pass an explicit provider config.`,
      { provider },
    ),
  )
}

function envApiKey(provider: BuiltinProviderName): string | undefined {
  const env = runtimeEnv()
  for (const key of builtinProviderEnvKeys[provider]) {
    const value = env[key]
    if (value) return value
  }
  return undefined
}

function runtimeEnv(): Record<string, string | undefined> {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {}
  )
}

function envKeyLabel(provider: BuiltinProviderName): string {
  return builtinProviderEnvKeys[provider].join(" or ")
}

function mergeSlot(
  inferred: MediaRouterDefaultSlot | undefined,
  explicit: MediaRouterDefaultSlot | undefined,
): MediaRouterDefaultSlotObject | undefined {
  const inferredSlot = normalizeSlot(inferred)
  const explicitSlot = normalizeSlot(explicit)
  if (!inferredSlot) return explicitSlot
  if (!explicitSlot) return inferredSlot
  return {
    ...inferredSlot,
    ...explicitSlot,
    options: {
      ...inferredSlot.options,
      ...explicitSlot.options,
    },
    providerOptions: {
      ...inferredSlot.providerOptions,
      ...explicitSlot.providerOptions,
    },
  }
}
