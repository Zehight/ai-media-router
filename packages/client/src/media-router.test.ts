import { describe, expect, it } from "vitest"
import {
  createMediaRouterError,
  type ProviderPlugin,
} from "@media-router/core"
import { MediaRouter } from "./media-router.js"

const model = {
  id: "image",
  type: "image" as const,
  modes: ["text-to-image" as const],
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
    expect(job.createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(job.updatedAt).toBe("2026-01-01T00:00:01.000Z")
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

  it("keeps split image child failures in partial failure mode", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: splitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create({
      ...request(),
      options: {
        count: 2,
        partialFailure: "return-successful",
      },
    })

    expect(job.status).toBe("succeeded")
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

  it("marks split image batches failed when every child fails", async () => {
    const router = new MediaRouter({
      plugins: {
        custom: allFailSplitPlugin(),
      },
      providers: { customProxy: { plugin: "custom" } },
    })

    const job = await router.create({
      ...request(),
      options: {
        count: 2,
        partialFailure: "return-successful",
      },
    })

    expect(job.status).toBe("failed")
    expect(job.result).toBeUndefined()
    expect(job.error).toMatchObject({
      kind: "MediaRouterError",
      code: "PROVIDER_ERROR",
      message: "Batch generation failed",
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
      message: "Succeeded batch child is missing result",
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
