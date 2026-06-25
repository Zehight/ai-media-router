import {
  createMediaRouterError,
  MediaRouterException,
  type ProviderInstanceConfig,
  type ProviderPlugin,
  type ProviderRuntimeContext,
} from "@media-router/core"

export type ProviderRegistryInput = {
  plugins: Record<string, ProviderPlugin>
  providers: Record<string, ProviderInstanceConfig>
  fetch?: typeof fetch
}

export class ProviderRegistry {
  private readonly plugins: Record<string, ProviderPlugin>
  private readonly providers: Record<string, ProviderInstanceConfig>
  private readonly fetchImpl: typeof fetch

  constructor(input: ProviderRegistryInput) {
    this.plugins = input.plugins
    this.providers = input.providers
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
    const config = this.providers[providerName]
    if (!config) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", `Unknown provider: ${providerName}`, {
          provider: providerName,
        }),
      )
    }

    const plugin = this.plugins[config.plugin]
    if (!plugin) {
      throw new MediaRouterException(
        createMediaRouterError("BAD_REQUEST", `Unknown plugin: ${config.plugin}`, {
          provider: providerName,
        }),
      )
    }

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
}
