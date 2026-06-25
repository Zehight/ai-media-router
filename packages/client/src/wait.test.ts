import { describe, expect, it } from "vitest"
import {
  createMediaRouterError,
  type GenerationJob,
  type ProviderPlugin,
  type ProviderRuntimeContext,
} from "@media-router/core"
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
        options: { timeoutMs: 1, intervalMs: 1 },
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
        options: { timeoutMs: 1, intervalMs: 1 },
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
        options: { timeoutMs: 1, intervalMs: 1 },
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

function runtime(driver: Partial<ProviderPlugin["driver"]>): ProviderRuntimeContext {
  const plugin: ProviderPlugin = {
    id: "custom",
    displayName: "Custom",
    models: {
      image: {
        id: "image",
        type: "image",
        modes: ["text-to-image"],
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
    provider: "customProxy",
    providerId: "custom",
    plugin,
    config: { plugin: "custom" },
    fetch: globalThis.fetch,
    resolved: {},
  }
}
