import { describe, expect, it } from "vitest"
import type { ProviderPlugin } from "@miragari/core"
import { builtinProviderPlugins } from "./builtin.js"
import { createMediaRouter } from "./media-router.js"
import { completed } from "./toolkit.js"

describe("createMediaRouter", () => {
  it("uses the same builtin plugin map exported by the package", () => {
    expect(Object.keys(builtinProviderPlugins).sort()).toEqual([
      "google",
      "happyhorse",
      "openai",
      "qwen",
      "volcengine",
    ])
  })

  it("keeps builtin default model preferences explicit on provider plugins", () => {
    expect(builtinProviderPlugins.openai.defaultModels).toMatchObject({
      image: "gpt-image-1",
      video: "sora-2",
    })
    expect(builtinProviderPlugins.qwen.defaultModels).toMatchObject({
      image: "qwen-image-2.0-pro",
      video: "wan2.7",
    })
    expect(builtinProviderPlugins.google.defaultModels).toMatchObject({
      image: "gemini-2.5-flash-image",
    })
    expect(builtinProviderPlugins.happyhorse.defaultModels).toMatchObject({
      video: "happy-horse",
    })
    expect(builtinProviderPlugins.volcengine.defaultModels).toMatchObject({
      image: "doubao-seedream-4-5-251128",
      video: "doubao-seedance-2-0-260128",
    })
  })

  it("preinstalls builtin providers and defaults so callers pass only API keys", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createMediaRouter({
      providers: {
        openai: "secret",
      },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      type: "image",
      provider: "openai",
      providerId: "openai",
      model: "gpt-image-1",
      assets: [{ type: "image", url: "https://example.com/image.png" }],
    })
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/images/generations",
    })
  })

  it("accepts builtin provider configs at the top level", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createMediaRouter({
      openai: "secret",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      type: "image",
      provider: "openai",
      providerId: "openai",
      model: "gpt-image-1",
      asset: { type: "image", url: "https://example.com/image.png" },
    })
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/images/generations",
    })
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret",
    )
  })

  it("keeps explicit providers ahead of top-level builtin provider configs", async () => {
    const calls: Array<{ init: RequestInit }> = []
    const client = createMediaRouter({
      openai: "top-level-secret",
      providers: {
        openai: "provider-secret",
      },
      fetch: async (_url, init) => {
        calls.push({ init: init ?? {} })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await client.generateImage("a clean product shot")
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer provider-secret",
    )
  })

  it("does not ignore present top-level builtin provider configs with undefined values", async () => {
    await withProviderEnv({ GOOGLE_API_KEY: "google-secret" }, async () => {
      const calls: Array<{ url: string }> = []
      const client = createMediaRouter({
        openai: undefined,
        fetch: async (url) => {
          calls.push({ url: String(url) })
          return new Response(
            JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
            { status: 200 },
          )
        },
      })

      await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
        provider: "openai",
        providerId: "openai",
        model: "gpt-image-1",
      })
      expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations")
    })
  })

  it("preserves top-level builtin provider config order for default inference", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createMediaRouter({
      qwen: "dashscope-secret",
      openai: "openai-secret",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(
          JSON.stringify({
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: "https://example.com/image.png" }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        )
      },
    })

    await expect(client.createImage("a clean product shot")).resolves.toMatchObject({
      provider: "qwen",
      providerId: "qwen",
      model: "qwen-image-2.0-pro",
    })
    expect(calls[0]?.url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    )
  })

  it("discovers builtin providers from common environment variables", async () => {
    await withProviderEnv({ OPENAI_API_KEY: "secret" }, async () => {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const client = createMediaRouter({
        fetch: async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} })
          return new Response(
            JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
            { status: 200 },
          )
        },
      })

      await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
        provider: "openai",
        providerId: "openai",
        model: "gpt-image-1",
      })
      expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
        "Bearer secret",
      )
    })
  })

  it("accepts builtin provider arrays as an enabled-providers shortcut", async () => {
    await withProviderEnv(
      {
        OPENAI_API_KEY: "secret",
        DASHSCOPE_API_KEY: "dashscope-secret",
      },
      async () => {
        const calls: Array<{ url: string; init: RequestInit }> = []
        const previousFetch = globalThis.fetch
        globalThis.fetch = async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} })
          return new Response(
            JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
            { status: 200 },
          )
        }
        try {
          const client = createMediaRouter(["openai"])

          await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
            provider: "openai",
            providerId: "openai",
            model: "gpt-image-1",
          })
          expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations")
        } finally {
          globalThis.fetch = previousFetch
        }
      },
    )
  })

  it("keeps object providers arrays supported", async () => {
    await withProviderEnv(
      {
        OPENAI_API_KEY: "secret",
        DASHSCOPE_API_KEY: "dashscope-secret",
      },
      async () => {
        const calls: Array<{ url: string; init: RequestInit }> = []
        const client = createMediaRouter({
          providers: ["openai"],
          fetch: async (url, init) => {
            calls.push({ url: String(url), init: init ?? {} })
            return new Response(
              JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
              { status: 200 },
            )
          },
        })

        await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
          provider: "openai",
          providerId: "openai",
          model: "gpt-image-1",
        })
        expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations")
      },
    )
  })

  it("rejects selected builtin providers when the matching environment key is missing", async () => {
    await withProviderEnv({}, async () => {
      expect(() => createMediaRouter(["openai"])).toThrow("Missing API key for openai")
      expect(() => createMediaRouter({ providers: ["openai"] })).toThrow(
        "Missing API key for openai",
      )
    })
  })

  it("rejects ambiguous zero-config discovery when multiple providers are configured", async () => {
    await withProviderEnv(
      {
        OPENAI_API_KEY: "secret",
        DASHSCOPE_API_KEY: "dashscope-secret",
      },
      async () => {
        expect(() => createMediaRouter()).toThrow(
          "Multiple provider environment variables were found",
        )
      },
    )
  })

  it("uses top-level builtin provider as the selected env provider", async () => {
    await withProviderEnv(
      {
        OPENAI_API_KEY: "secret",
        DASHSCOPE_API_KEY: "dashscope-secret",
      },
      async () => {
        const calls: Array<{ url: string; init: RequestInit }> = []
        const client = createMediaRouter({
          provider: "openai",
          fetch: async (url, init) => {
            calls.push({ url: String(url), init: init ?? {} })
            return new Response(
              JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
              { status: 200 },
            )
          },
        })

        await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
          provider: "openai",
          providerId: "openai",
          model: "gpt-image-1",
        })
        expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations")
      },
    )
  })

  it("accepts top-level apiKey with a selected builtin provider", async () => {
    await withProviderEnv({}, async () => {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const client = createMediaRouter({
        provider: "openai",
        apiKey: "explicit-secret",
        fetch: async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} })
          return new Response(
            JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
            { status: 200 },
          )
        },
      })

      await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
        provider: "openai",
        providerId: "openai",
        model: "gpt-image-1",
      })
      expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
        "Bearer explicit-secret",
      )
    })
  })

  it("keeps explicit providers ahead of top-level apiKey shortcuts", async () => {
    await withProviderEnv({}, async () => {
      const calls: Array<{ init: RequestInit }> = []
      const client = createMediaRouter({
        provider: "openai",
        apiKey: "top-level-secret",
        providers: {
          openai: "provider-secret",
        },
        fetch: async (_url, init) => {
          calls.push({ init: init ?? {} })
          return new Response(
            JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
            { status: 200 },
          )
        },
      })

      await client.generateImage("a clean product shot")
      expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
        "Bearer provider-secret",
      )
    })
  })

  it("accepts a builtin provider name as the shortest router config", async () => {
    await withProviderEnv({ OPENAI_API_KEY: "secret" }, async () => {
      const previousFetch = globalThis.fetch
      const calls: Array<{ url: string; init: RequestInit }> = []
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      }
      try {
        const client = createMediaRouter("openai")

        await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
          provider: "openai",
          providerId: "openai",
          model: "gpt-image-1",
        })
        expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations")
      } finally {
        globalThis.fetch = previousFetch
      }
    })
  })

  it("rejects a builtin provider name shortcut when its environment key is missing", async () => {
    await withProviderEnv({ DASHSCOPE_API_KEY: "dashscope-secret" }, async () => {
      expect(() => createMediaRouter("openai")).toThrow("Missing API key for openai")
    })
  })

  it("rejects top-level builtin provider when its environment key is missing", async () => {
    await withProviderEnv({ DASHSCOPE_API_KEY: "dashscope-secret" }, async () => {
      expect(() => createMediaRouter({ provider: "openai" })).toThrow(
        "Missing API key for openai",
      )
    })
  })

  it("uses explicit defaults.provider before top-level provider when selecting env providers", async () => {
    await withProviderEnv({ DASHSCOPE_API_KEY: "dashscope-secret" }, async () => {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const client = createMediaRouter({
        provider: "openai",
        defaults: {
          provider: "qwen",
        },
        fetch: async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} })
          return new Response(
            JSON.stringify({
              output: {
                choices: [
                  {
                    message: {
                      content: [{ image: "https://example.com/image.png" }],
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          )
        },
      })

      await expect(client.createImage("a clean product shot")).resolves.toMatchObject({
        provider: "qwen",
        providerId: "qwen",
        model: "qwen-image-2.0-pro",
      })
      expect(calls[0]?.url).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      )
    })
  })

  it("does not rebind top-level apiKey when defaults.provider overrides the selected provider", async () => {
    await withProviderEnv({ DASHSCOPE_API_KEY: "dashscope-secret" }, async () => {
      const calls: Array<{ init: RequestInit }> = []
      const client = createMediaRouter({
        provider: "openai",
        apiKey: "openai-secret",
        defaults: {
          provider: "qwen",
        },
        fetch: async (_url, init) => {
          calls.push({ init: init ?? {} })
          return new Response(
            JSON.stringify({
              output: {
                choices: [
                  {
                    message: {
                      content: [{ image: "https://example.com/image.png" }],
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          )
        },
      })

      await expect(client.createImage("a clean product shot")).resolves.toMatchObject({
        provider: "qwen",
        providerId: "qwen",
        model: "qwen-image-2.0-pro",
      })
      expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
        "Bearer dashscope-secret",
      )
    })
  })

  it("does not treat prototype property names as builtin providers", async () => {
    await withProviderEnv({ OPENAI_API_KEY: "secret" }, async () => {
      const client = createMediaRouter({ provider: "toString" })

      await expect(client.generateImage("a clean product shot")).rejects.toMatchObject({
        details: {
          code: "BAD_REQUEST",
          message: "Unknown provider: toString",
        },
      })
    })
  })

  it("does not let non-builtin providers suppress zero-config ambiguity", async () => {
    await withProviderEnv(
      {
        OPENAI_API_KEY: "secret",
        DASHSCOPE_API_KEY: "dashscope-secret",
      },
      async () => {
        expect(() => createMediaRouter({ provider: "toString" })).toThrow(
          "Multiple provider environment variables were found",
        )
      },
    )
  })

  it("does not let non-builtin providers with apiKey suppress zero-config ambiguity", async () => {
    await withProviderEnv(
      {
        OPENAI_API_KEY: "secret",
        DASHSCOPE_API_KEY: "dashscope-secret",
      },
      async () => {
        expect(() =>
          createMediaRouter({ provider: "toString", apiKey: "explicit-secret" }),
        ).toThrow("Multiple provider environment variables were found")
      },
    )
  })

  it("infers builtin defaults for aliased providers without overriding explicit defaults", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      defaults: {
        provider: "openaiProxy",
        models: {
          image: "gpt-image-2",
        },
      },
      providers: {
        openaiProxy: {
          plugin: "openai",
          apiKey: "secret",
        },
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "openaiProxy",
      providerId: "openai",
      model: "gpt-image-2",
    })
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-image-2",
    })
  })

  it("accepts top-level provider and model as defaults shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      provider: "openaiProxy",
      model: "gpt-image-2",
      providers: {
        openaiProxy: {
          plugin: "openai",
          apiKey: "secret",
        },
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "openaiProxy",
      providerId: "openai",
      model: "gpt-image-2",
    })
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-image-2",
    })
  })

  it("lets explicit defaults override top-level provider and model shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      provider: "openai",
      model: "gpt-image-1",
      defaults: {
        provider: "openaiProxy",
        model: "gpt-image-2",
      },
      providers: {
        openai: "secret",
        openaiProxy: {
          plugin: "openai",
          apiKey: "proxy-secret",
        },
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "openaiProxy",
      providerId: "openai",
      model: "gpt-image-2",
    })
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-image-2",
    })
  })

  it("keeps explicit slot options while filling missing builtin provider and model", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      defaults: {
        image: {
          options: { quality: "high" },
        },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
    })
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-image-1",
      quality: "high",
    })
  })

  it("accepts top-level media slots as defaults shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      image: {
        quality: "high",
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
    })
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-image-1",
      quality: "high",
    })
  })

  it("lets explicit defaults slots override top-level media slot shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      image: {
        quality: "low",
      },
      defaults: {
        image: {
          options: { quality: "high" },
        },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await client.generateImage("a clean product shot")
    expect(calls[0]?.body).toMatchObject({
      quality: "high",
    })
  })

  it("lets explicit slot options override top-level option shorthand fields", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      image: {
        quality: "low",
        options: { quality: "high" },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await client.generateImage("a clean product shot")
    expect(calls[0]?.body).toMatchObject({
      quality: "high",
    })
  })

  it("merges explicit defaults slots over top-level media slot fields", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      image: {
        quality: "high",
        providerOptions: { moderation: "strict" },
      },
      defaults: {
        image: {
          provider: "openai",
        },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
    })
    expect(calls[0]?.body).toMatchObject({
      quality: "high",
      moderation: "strict",
    })
  })

  it("accepts non-image top-level media slots as defaults shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      video: {
        provider: "qwen",
        duration: 5,
      },
      providers: {
        qwen: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ output: { task_id: "task_1", task_status: "PENDING" } }),
          { status: 200 },
        )
      },
    })

    await expect(client.createVideo("a slow orbit shot")).resolves.toMatchObject({
      provider: "qwen",
      providerId: "qwen",
      model: "wan2.7",
    })
    expect(calls[0]?.body).toMatchObject({
      parameters: { duration: 5 },
    })
  })

  it("accepts audio top-level media slot option shorthand", async () => {
    const seen: Array<Record<string, unknown>> = []
    const client = createMediaRouter({
      plugins: {
        custom: audioPlugin(seen),
      },
      providers: {
        custom: undefined,
      },
      provider: "custom",
      model: "voice",
      audio: {
        voice: "narrator",
      },
    })

    await client.generateAudio("hello world")
    expect(seen).toMatchObject([
      {
        type: "audio",
        options: { voice: "narrator" },
      },
    ])
  })

  it("accepts top-level profiles as a defaults.profiles shortcut", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      profiles: {
        hdImage: {
          type: "image",
          quality: "high",
        },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(
      client.profile("hdImage").generateImage("a clean product shot"),
    ).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
    })
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-image-1",
      quality: "high",
    })
  })

  it("accepts media type strings as profile shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      profiles: {
        hdImage: "image",
      },
      image: {
        options: { quality: "high" },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await expect(
      client.profile("hdImage").generate("a clean product shot"),
    ).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
    })
    expect(calls[0]?.body).toMatchObject({
      quality: "high",
    })
  })

  it("binds audio profile string shortcuts to text inputs", async () => {
    const seen: Array<Record<string, unknown>> = []
    const client = createMediaRouter({
      plugins: {
        custom: audioPlugin(seen),
      },
      providers: {
        custom: undefined,
      },
      provider: "custom",
      model: "voice",
      profiles: {
        voiceover: "audio",
      },
    })

    await expect(
      client.profile("voiceover").generate("hello world"),
    ).resolves.toMatchObject({
      provider: "custom",
      providerId: "custom",
      model: "voice",
    })
    expect(seen).toMatchObject([
      {
        type: "audio",
        input: { text: "hello world" },
      },
    ])
  })

  it("rejects unsupported profile string shortcuts", () => {
    expect(() =>
      createMediaRouter({
        profiles: {
          bad: "file" as never,
        },
        providers: {
          openai: "secret",
        },
      }),
    ).toThrow("Profile bad uses unsupported media type: file")
  })

  it("lets explicit defaults.profiles override top-level profile shortcuts", async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createMediaRouter({
      profiles: {
        hdImage: "image",
      },
      defaults: {
        profiles: {
          hdImage: {
            type: "image",
            options: { quality: "high" },
          },
        },
      },
      providers: {
        openai: "secret",
      },
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return new Response(
          JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }),
          { status: 200 },
        )
      },
    })

    await client.profile("hdImage").generateImage("a clean product shot")
    expect(calls[0]?.body).toMatchObject({
      quality: "high",
    })
  })

  it("accepts top-level media slot strings as model shortcuts", async () => {
    const selectedModels: string[] = []
    const client = createMediaRouter({
      plugins: {
        custom: customDefaultModelPlugin((model) => selectedModels.push(model)),
      },
      providers: {
        customProvider: { plugin: "custom" },
      },
      provider: "customProvider",
      image: "fallback-image",
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "customProvider",
      providerId: "custom",
      model: "fallback-image",
    })
    expect(selectedModels).toEqual(["fallback-image"])
  })

  it("lets explicit defaults media slots override top-level media slot strings", async () => {
    const selectedModels: string[] = []
    const client = createMediaRouter({
      plugins: {
        custom: customDefaultModelPlugin((model) => selectedModels.push(model)),
      },
      providers: {
        customProvider: { plugin: "custom" },
      },
      provider: "customProvider",
      image: "preferred-image",
      defaults: {
        image: "fallback-image",
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "customProvider",
      providerId: "custom",
      model: "fallback-image",
    })
    expect(selectedModels).toEqual(["fallback-image"])
  })

  it("prefers provider-declared default models when inferring router defaults", async () => {
    const selectedModels: string[] = []
    const client = createMediaRouter({
      plugins: {
        custom: customDefaultModelPlugin((model) => selectedModels.push(model)),
      },
      providers: {
        customProvider: { plugin: "custom" },
      },
    })

    await expect(client.generateImage("a clean product shot")).resolves.toMatchObject({
      provider: "customProvider",
      providerId: "custom",
      model: "preferred-image",
    })
    expect(selectedModels).toEqual(["preferred-image"])
  })
})

function customDefaultModelPlugin(onCreate: (model: string) => void): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    defaultModels: {
      image: "preferred-image",
    },
    models: {
      "fallback-image": {
        id: "fallback-image",
        type: "image",
        async: false,
      },
      "preferred-image": {
        id: "preferred-image",
        type: "image",
        async: false,
      },
    },
    driver: {
      async create(context) {
        onCreate(context.request.model)
        return completed({
          context,
          assets: [{ type: "image", url: "https://example.com/image.png" }],
        })
      },
    },
  }
}

function audioPlugin(seen: Array<Record<string, unknown>>): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: {
      voice: {
        id: "voice",
        type: "audio",
        async: false,
      },
    },
    driver: {
      async create(context) {
        seen.push(context.request as unknown as Record<string, unknown>)
        return completed({
          context,
          assets: [{ type: "audio", url: "https://example.com/audio.mp3" }],
        })
      },
    },
  }
}

const providerEnvKeys = [
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "DASHSCOPE_API_KEY",
  "QWEN_API_KEY",
  "FAL_KEY",
  "FAL_API_KEY",
  "ARK_API_KEY",
  "VOLCENGINE_API_KEY",
]

async function withProviderEnv(
  env: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    providerEnvKeys.map((key) => [key, process.env[key]]),
  )
  for (const key of providerEnvKeys) delete process.env[key]
  Object.assign(process.env, env)
  try {
    await run()
  } finally {
    for (const key of providerEnvKeys) {
      const value = previous[key]
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
}
