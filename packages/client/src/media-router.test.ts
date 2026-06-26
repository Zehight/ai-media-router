import { describe, expect, it } from "vitest"
import {
  createMediaRouterError,
  type ProviderPlugin,
} from "@media-router/core"
import { MediaRouter } from "./media-router.js"

const model = {
  id: "image",
  type: "image" as const,
  async: false,
}

describe("MediaRouter error normalization", () => {
  it("adds job timestamps for completed provider outputs", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: completedPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create(request())

    expect(job.status).toBe("succeeded")
    expect(job.result?.asset).toMatchObject({
      type: "image",
      url: "https://cdn.example.com/a.png",
    })
    expect(job.createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(job.updatedAt).toBe("2026-01-01T00:00:01.000Z")
  })

  it("infers defaults from provider default models", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          defaultModels: { image: "preferred-image" },
          models: {
            fallback: { id: "fallback", type: "image", async: false },
            "preferred-image": {
              id: "preferred-image",
              type: "image",
              async: false,
            },
          },
          driver: {
            async create(context) {
              seen.push(context.request as unknown as Record<string, unknown>)
              return {
                kind: "completed",
                result: {
                  id: "result_1",
                  jobId: "job_1",
                  type: "image",
                  provider: context.provider,
                  providerId: context.providerId,
                  model: context.request.model,
                  status: "succeeded",
                  assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
                },
              }
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.generateImage("a clean product render")).resolves.toMatchObject({
      provider: "customProxy",
      model: "preferred-image",
    })
    expect(seen[0]).toMatchObject({
      provider: "customProxy",
      model: "preferred-image",
      input: { prompt: "a clean product render" },
    })
  })

  it("normalizes profile intents before provider create", async () => {
    let providerRequest: unknown
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          models: { image: model },
          driver: {
            async create(context) {
              providerRequest = context.request
              return {
                kind: "completed",
                result: {
                  id: "result_1",
                  jobId: "job_1",
                  type: "image",
                  provider: context.provider,
                  providerId: context.providerId,
                  model: context.request.model,
                  status: "succeeded",
                  assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
                },
              }
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
        profiles: {
          hdImage: {
            options: { width: 2048, height: 2048 },
          },
        },
      },
    })

    await router.createImage({ profile: "hdImage", prompt: "test" })

    expect(providerRequest).toMatchObject({
      type: "image",
      provider: "customProxy",
      model: "image",
      input: { prompt: "test" },
      options: { width: 2048, height: 2048 },
    })
    expect("profile" in (providerRequest as Record<string, unknown>)).toBe(false)
  })

  it("applies per-call default shortcuts above router defaults", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin(seen),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
        image: {
          options: { width: 512, height: 512, count: 1 },
          providerOptions: { watermark: false },
        },
      },
    })

    await router.createImage(
      {
        prompt: "test",
        height: 768,
      },
      {
        image: {
          width: 2048,
          quality: "draft",
          providerOptions: { region: "eu" },
        },
      },
    )

    expect(seen[0]).toMatchObject({
      options: {
        width: 2048,
        height: 768,
        count: 1,
        quality: "draft",
      },
      providerOptions: {
        watermark: false,
        region: "eu",
      },
    })
  })

  it("lets per-call nested defaults override per-call default shortcuts", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin(seen),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
      },
    })

    await router.createImage(
      {
        prompt: "test",
      },
      {
        image: {
          quality: "draft",
        },
        defaults: {
          image: {
            quality: "high",
          },
        },
      },
    )

    expect(seen[0]).toMatchObject({
      options: {
        quality: "high",
      },
    })
  })

  it("accepts per-call media slot strings as model shortcuts", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin(seen),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
      },
    })

    await router.createImage("test", { image: "image-alt" })

    expect(seen[0]).toMatchObject({
      provider: "customProxy",
      model: "image-alt",
      input: { prompt: "test" },
    })
  })

  it("accepts per-call provider and model shortcuts", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin(seen),
      },
      providers: {
        defaultProxy: { plugin: "custom" },
        otherProxy: { plugin: "custom" },
      },
      defaults: {
        provider: "defaultProxy",
        models: { image: "image" },
      },
    })

    await router.createImage(
      "test",
      {
        provider: "otherProxy",
        model: "image",
      },
    )

    expect(seen[0]).toMatchObject({
      provider: "otherProxy",
      model: "image",
      input: { prompt: "test" },
    })
  })

  it("merges per-call profile defaults with router profiles", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin(seen),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
        profiles: {
          hdImage: {
            type: "image",
            options: { width: 1024, height: 1024 },
            providerOptions: { watermark: false },
          },
        },
      },
    })

    await router.createImage(
      {
        profile: "hdImage",
        prompt: "test",
      },
      {
        defaults: {
          profiles: {
            hdImage: {
              options: { quality: "high" },
              providerOptions: { watermark: true, region: "us" },
            },
          },
        },
      },
    )

    expect(seen[0]).toMatchObject({
      type: "image",
      options: { width: 1024, height: 1024, quality: "high" },
      providerOptions: { watermark: true, region: "us" },
    })
  })

  it("binds profiles to shorthand facade inputs", async () => {
    const seen: Array<Record<string, unknown>> = []
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin(seen),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: {
          image: "image",
          video: "video",
          audio: "audio",
        },
        profiles: {
          hdImage: {
            type: "image",
            options: { width: 2048, height: 2048 },
          },
          shortVideo: {
            type: "video",
            options: { duration: 4 },
          },
          voiceover: {
            type: "audio",
            options: { voice: "narrator" },
          },
        },
      },
    })

    await router.profile("hdImage").generateImage("a clean product render")
    await router.profile("shortVideo").generate("a slow orbit shot")
    await router.profile("voiceover").generateAudio("hello")
    await router.profile("voiceover").create("hello generic create")
    await router.profile("voiceover").generate("hello generic generate")
    await router.generateImage("one shot image", { profile: "hdImage" })
    await router.generate("one shot audio", { profile: "voiceover" })

    expect(seen).toMatchObject([
      {
        type: "image",
        input: { prompt: "a clean product render" },
        options: { width: 2048, height: 2048 },
      },
      {
        type: "video",
        input: { prompt: "a slow orbit shot" },
        options: { duration: 4 },
      },
      {
        type: "audio",
        input: { text: "hello" },
        options: { voice: "narrator" },
      },
      {
        type: "audio",
        input: { text: "hello generic create" },
        options: { voice: "narrator" },
      },
      {
        type: "audio",
        input: { text: "hello generic generate" },
        options: { voice: "narrator" },
      },
      {
        type: "image",
        input: { prompt: "one shot image" },
        options: { width: 2048, height: 2048 },
      },
      {
        type: "audio",
        input: { text: "one shot audio" },
        options: { voice: "narrator" },
      },
    ])
    expect(seen.every((request) => !("profile" in request))).toBe(true)
  })

  it("rejects conflicting per-call profile bindings", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
        profiles: {
          hdImage: { type: "image" },
          thumbnail: { type: "image" },
        },
      },
    })

    await expect(
      router.generateImage(
        {
          profile: "thumbnail",
          prompt: "a clean product render",
        },
        { profile: "hdImage" },
      ),
    ).rejects.toMatchObject({
      details: {
        code: "BAD_REQUEST",
        message: "Profile binding hdImage cannot be used with input profile thumbnail",
      },
    })
  })

  it("rejects conflicting profiles on profile-bound inputs", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: { image: "image" },
        profiles: {
          hdImage: { type: "image" },
          thumbnail: { type: "image" },
        },
      },
    })

    await expect(
      router.profile("hdImage").generateImage({
        profile: "thumbnail",
        prompt: "a clean product render",
      }),
    ).rejects.toMatchObject({
      details: {
        code: "BAD_REQUEST",
        message: "Profile binding hdImage cannot be used with input profile thumbnail",
      },
    })
  })

  it("keeps profile-bound typed facades constrained to their media type", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: {
          image: "image",
          video: "video",
        },
        profiles: {
          hdImage: { type: "image" },
        },
      },
    })

    await expect(
      router.profile("hdImage").generateVideo("a slow orbit shot"),
    ).rejects.toMatchObject({
      details: {
        code: "BAD_REQUEST",
        message: "Profile hdImage resolves to image, not video",
      },
    })
  })

  it("keeps per-call profile bindings constrained to typed facades", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: {
          image: "image",
          audio: "audio",
        },
        profiles: {
          voiceover: { type: "audio" },
        },
      },
    })

    await expect(
      router.generateImage("hello", { profile: "voiceover" }),
    ).rejects.toMatchObject({
      details: {
        code: "BAD_REQUEST",
        message: "Profile voiceover resolves to audio, not image",
      },
    })
  })

  it("rejects empty profile bindings", () => {
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    expect(() => router.profile("")).toThrow("Profile name must be a non-empty string")
    expect(() => router.profile("  ")).toThrow("Profile name must be a non-empty string")
  })

  it("rejects unknown profile bindings", () => {
    const router = new MediaRouter({
      plugins: {
        custom: profileFacadePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        profiles: {
          hdImage: { type: "image" },
        },
      },
    })

    expect(() => router.profile("missing")).toThrow("Unknown profile: missing")
    expect(() => router.profile("toString")).toThrow("Unknown profile: toString")
  })

  it("rejects malformed provider create output", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          models: { image: model },
          driver: {
            async create() {
              return { kind: "started" } as never
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider returned invalid create output",
      },
    })
  })

  it("rejects provider outputs that do not match the request context", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          models: { image: model },
          driver: {
            async create(context) {
              return {
                kind: "completed",
                result: {
                  id: "result_1",
                  jobId: "job_1",
                  type: "image",
                  provider: "otherProxy",
                  providerId: context.providerId,
                  model: context.request.model,
                  status: "succeeded",
                  assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
                },
              }
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider result provider does not match request provider",
      },
    })
  })

  it("rejects provider results with malformed assets", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          models: { image: model },
          driver: {
            async create(context) {
              return {
                kind: "completed",
                result: {
                  id: "result_1",
                  jobId: "job_1",
                  type: "image",
                  provider: context.provider,
                  providerId: context.providerId,
                  model: context.request.model,
                  status: "succeeded",
                  assets: [{ type: "bogus", url: "https://cdn.example.com/a.png" }],
                },
              } as never
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider output field assets[0].type must be a media type",
      },
    })
  })

  it("normalizes malformed pending provider jobs", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          models: { image: model },
          driver: {
            async create(context) {
              return {
                kind: "pending",
                job: {
                  id: "job_1",
                  type: "image",
                  provider: context.provider,
                  providerId: context.providerId,
                  model: context.request.model,
                  status: "succeeded",
                },
              }
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "PROVIDER_ERROR",
        message: "Succeeded job is missing result",
      },
    })
  })

  it("rejects pending provider jobs with invalid status", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: {
          id: "custom",
          displayName: "Custom",
          models: { image: model },
          driver: {
            async create(context) {
              return {
                kind: "pending",
                job: {
                  id: "job_1",
                  type: "image",
                  provider: context.provider,
                  providerId: context.providerId,
                  model: context.request.model,
                  status: "started",
                },
              } as never
            },
          },
        },
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider returned invalid job status",
      },
    })
  })

  it("preserves branded custom provider errors", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: customPlugin({
          normalizeError: () =>
            createMediaRouterError("RATE_LIMITED", "slow down", {
              provider: "customProxy",
              model: "image",
              retryable: true,
              statusCode: 429,
            }),
        }),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).rejects.toMatchObject({
      details: {
        kind: "MediaRouterError",
        code: "RATE_LIMITED",
        provider: "customProxy",
        model: "image",
        retryable: true,
        statusCode: 429,
      },
    })
  })

  it("downgrades unbranded custom provider errors", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: customPlugin({
          normalizeError: () =>
            ({
              code: "RATE_LIMITED",
              message: "third-party shape",
              provider: "customProxy",
              retryable: true,
            }) as never,
        }),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(router.create(request())).rejects.toMatchObject({
      details: {
        kind: "MediaRouterError",
        code: "UNKNOWN",
        provider: "customProxy",
        model: "image",
      },
    })
  })

  it("normalizes failed status job errors from custom providers", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: statusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "job_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
    })

    expect(job.error).toMatchObject({
      kind: "MediaRouterError",
      code: "UNKNOWN",
      provider: "customProxy",
      model: "image",
    })
  })

  it("rejects malformed status polling jobs", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: malformedStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.status({
        id: "job_1",
        type: "image",
        provider: "customProxy",
        providerId: "custom",
        model: "image",
        status: "running",
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider returned invalid job status",
      },
    })
  })

  it("rejects malformed status polling results", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: mismatchedStatusResultPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.status({
        id: "job_1",
        type: "image",
        provider: "customProxy",
        providerId: "custom",
        model: "image",
        status: "running",
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider result provider does not match request provider",
      },
    })
  })

  it("rejects status polling results whose job ids do not match", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: mismatchedStatusJobIdPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.status({
        id: "job_1",
        type: "image",
        provider: "customProxy",
        providerId: "custom",
        model: "image",
        status: "running",
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Provider job result jobId does not match job id",
      },
    })
  })

  it("normalizes succeeded status jobs without results", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: missingResultStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "job_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
    })

    expect(job).toMatchObject({
      status: "failed",
      error: {
        code: "PROVIDER_ERROR",
        message: "Succeeded job is missing result",
      },
    })
  })

  it("keeps split image child failures in partial failure mode", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: splitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create(
      {
        ...request(),
        options: {
          count: 2,
        },
      },
      { batch: { partialFailure: "return-successful" } },
    )

    expect(job.status).toBe("succeeded")
    expect(job.result?.asset).toMatchObject({
      type: "image",
      url: "https://cdn.example.com/a.png",
    })
    expect(job.result?.assets).toHaveLength(1)
    expect(job.result?.children).toMatchObject([
      { status: "succeeded" },
      { status: "failed" },
    ])
    expect(job.children?.map((child) => child.status)).toEqual(["succeeded", "failed"])
    expect(job.children?.[1]?.error).toMatchObject({
      kind: "MediaRouterError",
      code: "UNKNOWN",
      provider: "customProxy",
      model: "image",
    })
  })

  it("accepts top-level partialFailure as a batch shortcut", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: splitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create(
      {
        ...request(),
        options: {
          count: 2,
        },
      },
      { partialFailure: "return-successful" },
    )

    expect(job.status).toBe("succeeded")
    expect(job.result?.assets).toHaveLength(1)
    expect(job.children?.map((child) => child.status)).toEqual(["succeeded", "failed"])
  })

  it("lets nested batch options override top-level batch shortcuts", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: splitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.create(
        {
          ...request(),
          options: {
            count: 2,
          },
        },
        {
          partialFailure: "return-successful",
          batch: { partialFailure: "fail" },
        },
      ),
    ).rejects.toThrow("split failed")
  })

  it("validates top-level maxConcurrency batch shortcut", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: splitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.create(
        {
          ...request(),
          options: {
            count: 2,
          },
        },
        { maxConcurrency: 0 },
      ),
    ).rejects.toMatchObject({
      details: {
        code: "BAD_REQUEST",
        message: "maxConcurrency must be a positive integer",
      },
    })
  })

  it("marks split image batches failed when every child fails", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: allFailSplitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create(
      {
        ...request(),
        options: {
          count: 2,
        },
      },
      { batch: { partialFailure: "return-successful" } },
    )

    expect(job.status).toBe("failed")
    expect(job.result).toBeUndefined()
    expect(job.error).toMatchObject({
      kind: "MediaRouterError",
      code: "PROVIDER_ERROR",
      message: "Batch generation failed",
    })
  })

  it("normalizes split create children that succeed without results", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: missingResultSplitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create({
      ...request(),
      options: {
        count: 2,
      },
    })

    expect(job.status).toBe("failed")
    expect(job.result).toBeUndefined()
    expect(job.children?.map((child) => child.status)).toEqual(["failed", "failed"])
    expect(job.children?.[0]?.error).toMatchObject({
      message: "Succeeded job is missing result",
    })
  })

  it("aggregates status for split batch jobs", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: batchStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "batch_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
      children: [
        {
          id: "child_1",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "running",
          providerJobId: "provider_child_1",
        },
      ],
    })

    expect(job.status).toBe("succeeded")
    expect(job.children?.[0]?.status).toBe("succeeded")
    expect(job.result?.assets).toHaveLength(1)
  })

  it("keeps partial batch status successful when a child status throws", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: throwingStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "batch_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
      providerState: { partialFailure: "return-successful" },
      children: [
        completedJob("child_1"),
        {
          id: "child_2",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "running",
          providerJobId: "provider_child_2",
        },
      ],
    })

    expect(job.status).toBe("succeeded")
    expect(job.children?.map((child) => child.status)).toEqual(["succeeded", "failed"])
    expect(job.result?.assets).toHaveLength(1)
  })

  it("normalizes batch status child provider resolution failures in partial failure mode", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: batchStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "batch_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
      providerState: { partialFailure: "return-successful" },
      children: [
        completedJob("child_1"),
        {
          id: "child_2",
          type: "image",
          provider: "missingProxy",
          providerId: "missing",
          model: "image",
          status: "running",
        },
      ],
    })

    expect(job.status).toBe("succeeded")
    expect(job.children?.[1]).toMatchObject({
      status: "failed",
      error: {
        code: "BAD_REQUEST",
        message: "Unknown provider: missingProxy",
        provider: "missingProxy",
      },
    })
    expect(job.result?.assets).toHaveLength(1)
  })

  it("does not resolve missing batch parent provider during status", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: batchStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "batch_1",
      type: "image",
      provider: "missingParent",
      providerId: "missing",
      model: "image",
      status: "running",
      children: [
        {
          id: "child_1",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "running",
          providerJobId: "provider_child_1",
        },
      ],
    })

    expect(job.status).toBe("succeeded")
    expect(job.children?.[0]?.status).toBe("succeeded")
  })

  it("does not resolve missing batch parent provider during wait", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: batchStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const result = await router.wait(
      {
        id: "batch_1",
        type: "image",
        provider: "missingParent",
        providerId: "missing",
        model: "image",
        status: "running",
        children: [
          {
            id: "child_1",
            type: "image",
            provider: "customProxy",
            providerId: "custom",
            model: "image",
            status: "running",
            providerJobId: "provider_child_1",
          },
        ],
      },
      { timeoutMs: 100, intervalMs: 1 },
    )

    expect(result.children).toMatchObject([
      { jobId: "child_1", status: "succeeded" },
    ])
  })

  it("treats succeeded batch children without results as failed", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: missingResultStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "batch_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
      children: [
        {
          id: "child_1",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "running",
          providerJobId: "provider_child_1",
        },
      ],
    })

    expect(job.status).toBe("failed")
    expect(job.children?.[0]?.error).toMatchObject({
      message: "Succeeded job is missing result",
    })
  })

  it("treats cancelled batch children as failed terminal status", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: batchStatusPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.status({
      id: "batch_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
      children: [
        {
          id: "child_1",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "cancelled",
        },
      ],
    })

    expect(job.status).toBe("failed")
    expect(job.result).toBeUndefined()
    expect(job.error).toMatchObject({
      message: "Batch generation failed",
    })
  })

  it("cancels only cancellable batch children", async () => {
    const cancelled: Array<string | undefined> = []
    const router = new MediaRouter({
      plugins: {
        custom: cancellablePlugin(cancelled),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await router.cancel({
      id: "batch_1",
      type: "image",
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "running",
      children: [
        {
          id: "child_1",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "running",
          providerJobId: "provider_child_1",
        },
        {
          id: "child_2",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "queued",
          providerJobId: "provider_child_2",
        },
        completedJob("child_3"),
        {
          id: "child_4",
          type: "image",
          provider: "customProxy",
          providerId: "custom",
          model: "image",
          status: "failed",
        },
      ],
    })

    expect(cancelled).toEqual(["provider_child_1", "provider_child_2"])
  })

  it("fails batch cancellation when a cancellable child has no provider job id", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: cancellablePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.cancel({
        id: "batch_1",
        type: "image",
        provider: "customProxy",
        providerId: "custom",
        model: "image",
        status: "running",
        children: [
          {
            id: "child_1",
            type: "image",
            provider: "customProxy",
            providerId: "custom",
            model: "image",
            status: "running",
          },
        ],
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Failed to cancel batch children",
      },
    })
  })

  it("normalizes batch cancellation child provider resolution failures", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: cancellablePlugin([]),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    await expect(
      router.cancel({
        id: "batch_1",
        type: "image",
        provider: "customProxy",
        providerId: "custom",
        model: "image",
        status: "running",
        children: [
          {
            id: "child_1",
            type: "image",
            provider: "missingProxy",
            providerId: "missing",
            model: "image",
            status: "running",
            providerJobId: "provider_child_1",
          },
        ],
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Failed to cancel batch children",
        raw: [
          {
            code: "BAD_REQUEST",
            message: "Unknown provider: missingProxy",
            provider: "missingProxy",
          },
        ],
      },
    })
  })

  it("passes non-image strings through provider facade entrypoints", async () => {
    const seen: string[] = []
    const router = new MediaRouter({
      plugins: {
        custom: multiMediaPlugin(seen),
      },
      providers: { customProxy: { plugin: "custom" } },
      defaults: {
        provider: "customProxy",
        models: {
          video: "video",
          audio: "audio",
          model3d: "model3d",
        },
      },
    })

    const video = await router.createVideo("a slow orbit shot")
    const audioText = await router.createAudio("hello")
    const model3dPrompt = await router.createModel3D("chair")
    const audioAction = await router.createAudio({
      action: "voiceover",
      text: "hello",
    })
    const model3dAction = await router.createModel3D({
      action: "text-to-3d",
      prompt: "chair",
    })

    expect(seen).toEqual([
      "video:a slow orbit shot",
      "audio:hello",
      "model3d:chair",
      "audio:voiceover",
      "model3d:text-to-3d",
    ])
    expect(video.type).toBe("video")
    expect(audioText.type).toBe("audio")
    expect(model3dPrompt.type).toBe("model3d")
    expect(audioAction.type).toBe("audio")
    expect(model3dAction.type).toBe("model3d")
  })
})

function customPlugin(input: {
  normalizeError: ProviderPlugin["driver"]["normalizeError"]
}): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("boom")
      },
      normalizeError: input.normalizeError,
    },
  }
}

function completedPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create(context) {
        return {
          kind: "completed",
          result: {
            id: "result_1",
            jobId: "job_1",
            type: "image",
            provider: context.provider,
            providerId: context.providerId,
            model: context.request.model,
            status: "succeeded",
            assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
            timings: {
              createdAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:00:01.000Z",
            },
          },
        }
      },
    },
  }
}

function profileFacadePlugin(seen: Array<Record<string, unknown>>): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: {
      image: {
        id: "image",
        type: "image",
        async: false,
      },
      "image-alt": {
        id: "image-alt",
        type: "image",
        async: false,
      },
      video: {
        id: "video",
        type: "video",
        async: false,
      },
      audio: {
        id: "audio",
        type: "audio",
        async: false,
      },
    },
    driver: {
      async create(context) {
        seen.push(context.request as unknown as Record<string, unknown>)
        return {
          kind: "completed",
          result: {
            id: `${context.request.type}_result`,
            jobId: `${context.request.type}_job`,
            type: context.request.type,
            provider: context.provider,
            providerId: context.providerId,
            model: context.request.model,
            status: "succeeded",
            assets: [
              {
                type: context.request.type,
                url: `https://cdn.example.com/${context.request.type}`,
              },
            ],
          },
        }
      },
    },
  }
}

function statusPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll(jobContext) {
        return {
          ...jobContext.job,
          status: "failed",
          error: {
            code: "RATE_LIMITED",
            message: "third-party shape",
            provider: "customProxy",
            retryable: true,
          } as never,
        }
      },
    },
  }
}

function splitPlugin(): ProviderPlugin {
  let calls = 0
  return {
    id: "custom",
    displayName: "Custom",
    models: {
      image: {
        ...model,
        capabilities: {
          count: { supported: true, max: 1, strategy: "split" },
        },
      },
    },
    driver: {
      async create(context) {
        calls += 1
        if (calls === 2) throw new Error("split failed")
        return {
          kind: "completed",
          result: {
            id: "result_1",
            jobId: "job_1",
            type: "image",
            provider: context.provider,
            providerId: context.providerId,
            model: context.request.model,
            status: "succeeded",
            assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
          },
        }
      },
    },
  }
}

function allFailSplitPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: {
      image: {
        ...model,
        capabilities: {
          count: { supported: true, max: 1, strategy: "split" },
        },
      },
    },
    driver: {
      async create() {
        throw new Error("split failed")
      },
    },
  }
}

function missingResultSplitPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: {
      image: {
        ...model,
        capabilities: {
          count: { supported: true, max: 1, strategy: "split" },
        },
      },
    },
    driver: {
      async create(context) {
        return {
          kind: "pending",
          job: {
            id: `job_${context.request.options?.seed ?? 0}`,
            type: "image",
            provider: context.provider,
            providerId: context.providerId,
            model: context.request.model,
            status: "succeeded",
          },
        }
      },
    },
  }
}

function batchStatusPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll(context) {
        return {
          ...context.job,
          status: "succeeded",
          result: {
            id: `${context.job.id}_result`,
            jobId: context.job.id,
            type: "image",
            provider: context.job.provider,
            providerId: context.job.providerId,
            model: context.job.model,
            status: "succeeded",
            assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
          },
        }
      },
    },
  }
}

function throwingStatusPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll() {
        throw new Error("status failed")
      },
    },
  }
}

function missingResultStatusPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll(context) {
        return {
          ...context.job,
          status: "succeeded",
        }
      },
    },
  }
}

function malformedStatusPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll(context) {
        return {
          ...context.job,
          status: "started",
        } as never
      },
    },
  }
}

function mismatchedStatusResultPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll(context) {
        return {
          ...context.job,
          status: "succeeded",
          result: {
            id: "result_1",
            jobId: context.job.id,
            type: "image",
            provider: "otherProxy",
            providerId: context.job.providerId,
            model: context.job.model,
            status: "succeeded",
            assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
          },
        }
      },
    },
  }
}

function mismatchedStatusJobIdPlugin(): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async poll(context) {
        return {
          ...context.job,
          status: "succeeded",
          result: {
            id: "result_1",
            jobId: "other_job",
            type: "image",
            provider: context.job.provider,
            providerId: context.job.providerId,
            model: context.job.model,
            status: "succeeded",
            assets: [{ type: "image", url: "https://cdn.example.com/a.png" }],
          },
        }
      },
    },
  }
}

function cancellablePlugin(cancelled: Array<string | undefined>): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: { image: model },
    driver: {
      async create() {
        throw new Error("unused")
      },
      async cancel(context) {
        cancelled.push(context.job.providerJobId)
      },
    },
  }
}

function multiMediaPlugin(seen: string[]): ProviderPlugin {
  return {
    id: "custom",
    displayName: "Custom",
    models: {
      video: {
        id: "video",
        type: "video",
        async: false,
      },
      audio: {
        id: "audio",
        type: "audio",
        async: false,
      },
      model3d: {
        id: "model3d",
        type: "model3d",
        async: false,
      },
    },
    driver: {
      async create(context) {
        const input = context.request.input as {
          prompt?: string
          text?: string
        }
        seen.push(
          `${context.request.type}:${context.request.action ?? input.prompt ?? input.text}`,
        )
        return {
          kind: "completed",
          result: {
            id: "result_1",
            jobId: "job_1",
            type: context.request.type,
            provider: context.provider,
            providerId: context.providerId,
            model: context.request.model,
            status: "succeeded",
            assets: [
              {
                type: context.request.type,
                url: `https://cdn.example.com/${context.request.type}`,
              },
            ],
          },
        }
      },
    },
  }
}

function completedJob(id: string) {
  return {
    id,
    type: "image" as const,
    provider: "customProxy",
    providerId: "custom",
    model: "image",
    status: "succeeded" as const,
    result: {
      id: `${id}_result`,
      jobId: id,
      type: "image" as const,
      provider: "customProxy",
      providerId: "custom",
      model: "image",
      status: "succeeded" as const,
      assets: [{ type: "image" as const, url: "https://cdn.example.com/a.png" }],
    },
  }
}

function request() {
  return {
    provider: "customProxy",
    model: "image",
    type: "image" as const,
    input: { prompt: "test" },
  }
}
