import {
  createMediaRouterError,
  MediaRouterException,
  type ProviderInstanceConfig,
  type ProviderPlugin,
  type ProviderRuntimeContext,
} from "@media-router/core"

export type ProviderInstanceInput =
  | string
  | undefined
  | ProviderInstanceConfig
  | (Omit<ProviderInstanceConfig, "plugin"> & { plugin?: string })

export type ProviderRegistryInput = {
  plugins: Record<string, ProviderPlugin>
  providers: Record<string, ProviderInstanceInput>
  fetch?: typeof fetch
}

export type ProviderRegistryEntry = {
  provider: string
  plugin: ProviderPlugin
  config: ProviderInstanceConfig
}

export class ProviderRegistry {
  private readonly plugins: Record<string, ProviderPlugin>
  private readonly providers: Record<string, ProviderInstanceConfig>
  private readonly fetchImpl: typeof fetch

  constructor(input: ProviderRegistryInput) {
    this.plugins = input.plugins
    this.providers = normalizeProviders(input.providers)
    this.fetchImpl = input.fetch ?? globalThis.fetch
    if (!this.fetchImpl) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", "fetch implementation is required", {
          provider: "registry",
        }),
      )
    }
  }

  get(providerName: string): {
    plugin: ProviderPlugin
    config: ProviderInstanceConfig
    runtime: ProviderRuntimeContext
  } {
    if (!Object.prototype.hasOwnProperty.call(this.providers, providerName)) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", `Unknown provider: ${providerName}`, {
          provider: providerName,
        }),
      )
    }
    const config = this.providers[providerName] as ProviderInstanceConfig

    const plugin = this.requirePlugin(providerName, config.plugin)

    return {
      plugin,
      config,
      runtime: {
        provider: providerName,
        providerId: plugin.id,
        plugin,
        config,
        fetch: this.fetchImpl,
        resolved: {},
      },
    }
  }

  entries(): ProviderRegistryEntry[] {
    return Object.entries(this.providers).map(([provider, config]) => ({
      provider,
      config,
      plugin: this.requirePlugin(provider, config.plugin),
    }))
  }

  private requirePlugin(provider: string, pluginName: string): ProviderPlugin {
    const plugin = this.plugins[pluginName]
    if (!plugin) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", `Unknown plugin: ${pluginName}`, {
          provider,
        }),
      )
    }
    return plugin
  }
}

function normalizeProviders(
  providers: Record<string, ProviderInstanceInput>,
): Record<string, ProviderInstanceConfig> {
  return Object.fromEntries(
    Object.entries(providers).map(([name, config]) => [
      name,
      normalizeProviderConfig(name, config),
    ]),
  )
}

function normalizeProviderConfig(
  name: string,
  config: ProviderInstanceInput,
): ProviderInstanceConfig {
  if (config == null) {
    return {
      plugin: name,
    }
  }
  if (typeof config === "string") {
    return {
      plugin: name,
      apiKey: config,
    }
  }
  return {
    ...config,
    plugin: config.plugin ?? name,
  }
}
