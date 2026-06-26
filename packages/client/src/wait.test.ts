import { describe, expect, it } from "vitest"
import {
  createMediaRouterError,
  type GenerationJob,
  type ProviderPlugin,
  type ProviderRuntimeContext,
} from "@miragari/core"
import { waitForJob } from "./wait.js"

const baseJob: GenerationJob = {
  id: "job_1",
  type: "image",
  provider: "customProxy",
  providerId: "custom",
  model: "image",
  status: "running",
}

describe("waitForJob error normalization", () => {
  it("does not sleep past timeout for large provider poll delay hints", async () => {
    const started = Date.now()

    await expect(
      waitForJob({
        job: baseJob,
        runtime: runtime({
          poll: async () => ({
            ...baseJob,
            status: "running",
            pollAfterMs: 60_000,
          }),
        }),
        options: { timeoutMs: 5, intervalMs: 1 },
      }),
    ).rejects.toMatchObject({
      details: {
        code: "TIMEOUT",
      },
    })

    expect(Date.now() - started).toBeLessThan(500)
  })

  it("times out when a single poll exceeds timeout", async () => {
    await expect(
      waitForJob({
        job: baseJob,
        runtime: runtime({
          poll: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return {
              ...baseJob,
              status: "succeeded",
              result: completedChild("job_1", "provider_job_1").result,
            }
          },
        }),
        options: { timeoutMs: 1, intervalMs: 1 },
      }),
    ).rejects.toMatchObject({
      details: {
        code: "TIMEOUT",
      },
    })
  })

  it("fails succeeded jobs without results instead of timing out", async () => {
    await expect(
      waitForJob({
        job: baseJob,
        runtime: runtime({
          poll: async () => ({
            ...baseJob,
            status: "succeeded",
          }),
        }),
        options: { timeoutMs: 100, intervalMs: 1 },
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "Succeeded job is missing result",
      },
    })
  })

  it("adds a primary asset when waiting an already completed job", async () => {
    const result = await waitForJob({
      job: completedChild("job_1", "provider_job_1"),
      runtime: runtime({}),
    })

    expect(result.asset).toMatchObject({
      type: "image",
      url: "https://cdn.example.com/job_1.png",
    })
  })

  it("keeps batch child provider job ids and result timings", async () => {
    const result = await waitForJob({
      job: {
        ...baseJob,
        id: "batch_1",
        children: [
          completedChild("child_1", "provider_child_1"),
          completedChild("child_2", "provider_child_2"),
        ],
      },
      runtime: runtime({}),
    })

    expect(result.children).toMatchObject([
      { jobId: "child_1", providerJobId: "provider_child_1", status: "succeeded" },
      { jobId: "child_2", providerJobId: "provider_child_2", status: "succeeded" },
    ])
    expect(result.timings?.createdAt).toBeTruthy()
    expect(result.timings?.completedAt).toBeTruthy()
  })

  it("waits batch children with their own provider runtime", async () => {
    const polledProviders: string[] = []
    const batchJob: GenerationJob = {
      ...baseJob,
      id: "batch_1",
      children: [
        { ...baseJob, id: "child_1", status: "running" },
        {
          ...baseJob,
          id: "child_2",
          provider: "otherProxy",
          providerId: "other",
          status: "running",
        },
      ],
    }

    const result = await waitForJob({
      job: batchJob,
      runtime: runtime({
        poll: async () => {
          throw new Error("parent runtime should not poll batch children")
        },
      }),
      resolveProvider: (provider) =>
        runtime(
          {
            poll: async (context) => {
              polledProviders.push(context.provider)
              return succeededJob(context.job, context.provider, context.providerId)
            },
          },
          provider,
          provider === "otherProxy" ? "other" : "custom",
        ),
    })

    expect(polledProviders.sort()).toEqual(["customProxy", "otherProxy"])
    expect(result.children).toMatchObject([
      { jobId: "child_1", status: "succeeded" },
      { jobId: "child_2", status: "succeeded" },
    ])
  })

  it("preserves batch child resolver error messages in partial failure mode", async () => {
    const result = await waitForJob({
      job: {
        ...baseJob,
        id: "batch_1",
        providerState: { partialFailure: "return-successful" },
        children: [
          completedChild("child_1", "provider_child_1"),
          {
            ...baseJob,
            id: "child_2",
            provider: "missingProxy",
            status: "running",
          },
        ],
      },
      runtime: runtime({}),
      resolveProvider: (provider) => {
        throw new Error(`Unknown provider: ${provider}`)
      },
    })

    expect(result.children).toMatchObject([
      { jobId: "child_1", status: "succeeded" },
      {
        jobId: "child_2",
        status: "failed",
        error: {
          code: "UNKNOWN",
          message: "Unknown provider: missingProxy",
          provider: "missingProxy",
        },
      },
    ])
  })

  it("returns successful batch assets with failed children in partial failure mode", async () => {
    const failedError = createMediaRouterError("PROVIDER_ERROR", "child failed", {
      provider: "customProxy",
      model: "image",
    })
    const result = await waitForJob({
      job: {
        ...baseJob,
        id: "batch_1",
        providerState: { partialFailure: "return-successful" },
        children: [
          completedChild("child_1", "provider_child_1"),
          {
            ...baseJob,
            id: "child_2",
            providerJobId: "provider_child_2",
            status: "failed",
            error: failedError,
          },
        ],
      },
      runtime: runtime({}),
    })

    expect(result.assets).toHaveLength(1)
    expect(result.asset).toMatchObject({
      type: "image",
      url: "https://cdn.example.com/child_1.png",
    })
    expect(result.children).toMatchObject([
      { jobId: "child_1", status: "succeeded" },
      { jobId: "child_2", status: "failed", error: failedError },
    ])
  })

  it("fails partial failure batches when every child fails", async () => {
    await expect(
      waitForJob({
        job: {
          ...baseJob,
          id: "batch_1",
          providerState: { partialFailure: "return-successful" },
          children: [
            {
              ...baseJob,
              id: "child_1",
              status: "failed",
              error: createMediaRouterError("PROVIDER_ERROR", "child failed", {
                provider: "customProxy",
                model: "image",
              }),
            },
          ],
        },
        runtime: runtime({}),
      }),
    ).rejects.toMatchObject({
      details: {
        code: "PROVIDER_ERROR",
        message: "All batch children failed",
      },
    })
  })

  it("preserves branded poll errors", async () => {
    await expect(
      waitForJob({
        job: baseJob,
        runtime: runtime({
          poll: async () => {
            throw createMediaRouterError("RATE_LIMITED", "slow down", {
              provider: "customProxy",
              model: "image",
              retryable: true,
              statusCode: 429,
            })
          },
        }),
        options: { timeoutMs: 100, intervalMs: 1 },
      }),
    ).rejects.toMatchObject({
      details: {
        kind: "MediaRouterError",
        code: "RATE_LIMITED",
        retryable: true,
        statusCode: 429,
      },
    })
  })

  it("downgrades unbranded failed job errors", async () => {
    await expect(
      waitForJob({
        job: baseJob,
        runtime: runtime({
          poll: async () => ({
            ...baseJob,
            status: "failed",
            error: {
              code: "RATE_LIMITED",
              message: "third-party shape",
              provider: "customProxy",
              retryable: true,
            } as never,
          }),
        }),
        options: { timeoutMs: 100, intervalMs: 1 },
      }),
    ).rejects.toMatchObject({
      details: {
        kind: "MediaRouterError",
        code: "UNKNOWN",
        provider: "customProxy",
        model: "image",
      },
    })
  })

  it("preserves branded failed job errors", async () => {
    await expect(
      waitForJob({
        job: baseJob,
        runtime: runtime({
          poll: async () => ({
            ...baseJob,
            status: "failed",
            error: createMediaRouterError("CONTENT_REJECTED", "blocked", {
              provider: "customProxy",
              model: "image",
              statusCode: 400,
              raw: { reason: "policy" },
            }),
          }),
        }),
        options: { timeoutMs: 100, intervalMs: 1 },
      }),
    ).rejects.toMatchObject({
      details: {
        kind: "MediaRouterError",
        code: "CONTENT_REJECTED",
        provider: "customProxy",
        model: "image",
        statusCode: 400,
        raw: { reason: "policy" },
      },
    })
  })
})

function completedChild(id: string, providerJobId: string): GenerationJob {
  return {
    ...baseJob,
    id,
    providerJobId,
    status: "succeeded",
    result: {
      id: `${id}_result`,
      jobId: id,
      type: "image",
      provider: baseJob.provider,
      providerId: baseJob.providerId,
      model: baseJob.model,
      status: "succeeded",
      assets: [{ type: "image", url: `https://cdn.example.com/${id}.png` }],
      timings: {
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    },
  }
}

function succeededJob(
  job: GenerationJob,
  provider: string,
  providerId: string,
): GenerationJob {
  return {
    ...job,
    provider,
    providerId,
    status: "succeeded",
    result: {
      id: `${job.id}_result`,
      jobId: job.id,
      type: job.type,
      provider,
      providerId,
      model: job.model,
      status: "succeeded",
      assets: [{ type: job.type, url: `https://cdn.example.com/${job.id}` }],
    },
  }
}

function runtime(
  driver: Partial<ProviderPlugin["driver"]>,
  provider = "customProxy",
  providerId = "custom",
): ProviderRuntimeContext {
  const plugin: ProviderPlugin = {
    id: providerId,
    displayName: "Custom",
    models: {
      image: {
        id: "image",
        type: "image",
        async: true,
      },
    },
    driver: {
      async create() {
        throw new Error("unused")
      },
      ...driver,
    },
  }
  return {
    provider,
    providerId,
    plugin,
    config: { plugin: providerId },
    fetch: globalThis.fetch,
    resolved: {},
  }
}
