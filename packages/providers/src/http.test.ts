import { describe, expect, it } from "vitest"
import {
  createMediaRouterError,
  MediaRouterException,
  type ProviderCancelContext,
  type ProviderCreateContext,
  type ProviderPollContext,
} from "@media-router/core"
import {
  completed,
  defineHttpProvider,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  providerError,
} from "./http.js"

const provider = defineHttpProvider<
  { data?: Array<{ url: string }>; id?: string; status?: string },
  { status: string; output?: { url?: string } }
>({
  id: "example",
  displayName: "Example",
  baseURL: "https://api.example.com/v1",
  auth: { type: "bearer" },
  statusMap: {
    done: "succeeded",
    working: "running",
  },
  models: {
    image: {
      id: "image",
      type: "image",
      modes: ["text-to-image"],
      async: false,
      capabilities: { count: { supported: true, max: 2, strategy: "native" } },
    },
    video: {
      id: "video",
      type: "video",
      modes: ["text-to-video"],
      async: true,
    },
  },
  create: {
    request: {
      path: (context) =>
        context.request.type === "video"
          ? "/videos"
          : "/images",
      body: (context) => {
        return {
          prompt: context.request.input.prompt,
          size: context.resolved.dimensions?.size,
          ...context.request.providerOptions,
        }
      },
    },
    output: (response, context) =>
      context.request.type === "video"
        ? pendingProviderJob({
            context,
            providerJobId: response.id,
            raw: response,
            pollAfterMs: 100,
          })
        : completed({
            context,
            assets: response.data?.map((item) => ({ type: "image", url: item.url })) ?? [],
            raw: response,
          }),
  },
  poll: {
    request: {
      path: (context) => `/videos/${context.job.providerJobId}`,
    },
    output: (response, context, helpers) =>
      polledJob({
        context,
        status: helpers.statusFrom(response.status),
        assets: response.output?.url
          ? [{ type: "video", url: response.output.url }]
          : undefined,
        raw: response,
      }),
  },
})

describe("defineHttpProvider", () => {
  it("maps a synchronous image response", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/a.png" }] }))
    }
    const output = await provider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "image",
        type: "image",
        input: { prompt: "test" },
        providerOptions: { style: "clean" },
      },
      model: provider.models.image,
    } as ProviderCreateContext)

    expect(output.kind).toBe("completed")
    if (output.kind === "completed") {
      expect(output.result.provider).toBe("exampleProxy")
      expect(output.result.providerId).toBe("example")
      expect(output.result.assets[0]?.url).toBe("https://cdn.example.com/a.png")
      expect(output.result.timings?.createdAt).toBeTruthy()
      expect(output.result.timings?.completedAt).toBe(output.result.timings?.createdAt)
    }
    expect(calls[0]?.url).toBe("https://api.example.com/v1/images")
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret",
    )
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      prompt: "test",
      size: "1024x1024",
      style: "clean",
    })
  })

  it("rejects completed provider responses without assets", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ data: [] }))) as typeof globalThis.fetch

    await expect(
      provider.driver.create({
        ...baseContext(fetch),
        request: {
          provider: "exampleProxy",
          model: "image",
          type: "image",
          input: { prompt: "test" },
        },
        model: provider.models.image,
      } as ProviderCreateContext),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Provider reported success without output assets",
    })
  })

  it("rejects completed provider responses without consumable assets", () => {
    expect(() =>
      completed({
        context: {
          ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
          request: {
            provider: "exampleProxy",
            model: "image",
            type: "image",
            input: { prompt: "test" },
          },
          model: provider.models.image,
        } as ProviderCreateContext,
        assets: [{ type: "image" }],
      }),
    ).toThrow("Provider reported success without output assets")
  })

  it("keeps valid assets when mixed with empty provider asset items", () => {
    expect(() =>
      completed({
        context: {
          ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
          request: {
            provider: "exampleProxy",
            model: "image",
            type: "image",
            input: { prompt: "test" },
          },
          model: provider.models.image,
        } as ProviderCreateContext,
        assets: [{ type: "image" }, { type: "image", url: "https://cdn.example.com/a.png" }],
      }),
    ).not.toThrow()
  })

  it("allows explicit empty completed provider responses", () => {
    expect(() =>
      completed({
        context: {
          ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
          request: {
            provider: "exampleProxy",
            model: "image",
            type: "image",
            input: { prompt: "test" },
          },
          model: provider.models.image,
        } as ProviderCreateContext,
        assets: [],
        allowEmptyResult: true,
      }),
    ).not.toThrow()
  })

  it("maps an asynchronous video poll response", async () => {
    const fetch = async (url: URL | RequestInfo) => {
      const text = String(url).endsWith("/videos/job_1")
        ? { status: "done", output: { url: "https://cdn.example.com/a.mp4" } }
        : { id: "job_1" }
      return new Response(JSON.stringify(text))
    }

    const create = await provider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: provider.models.video,
    } as ProviderCreateContext)
    expect(create.kind).toBe("pending")

    if (create.kind === "pending") {
      const polled = await provider.driver.poll?.({
        ...baseContext(fetch as typeof globalThis.fetch),
        job: create.job,
      } as ProviderPollContext)
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets[0]?.url).toBe("https://cdn.example.com/a.mp4")
      expect(polled?.result?.timings?.createdAt).toBe(create.job.createdAt)
      expect(polled?.result?.timings?.completedAt).toBe(polled?.updatedAt)
    }
  })

  it("normalizes provider poll delay hints", () => {
    const context = {
      ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: provider.models.video,
    } as ProviderCreateContext

    const create = pendingProviderJob({
      context,
      providerJobId: "job_1",
      pollAfterMs: Number.POSITIVE_INFINITY,
    })

    expect(create.kind).toBe("pending")
    if (create.kind === "pending") {
      expect(create.job.pollAfterMs).toBeUndefined()
      const polled = polledJob({
        context: {
          ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
          job: create.job,
        } as ProviderPollContext,
        status: "running",
        pollAfterMs: 2500,
      })
      expect(polled.pollAfterMs).toBe(2500)
    }
  })

  it("rejects terminal create statuses in pending status helpers", () => {
    expect(() => pendingStatus("succeeded", "running")).toThrow(
      'Provider create returned terminal status "succeeded"',
    )
    expect(pendingStatus("queued", "running")).toBe("queued")
    expect(pendingStatus(undefined, "running")).toBe("running")
  })

  it("rejects terminal statuses for pending jobs", () => {
    const context = {
      ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: provider.models.video,
    } as ProviderCreateContext

    expect(() =>
      pendingProviderJob({
        context,
        providerJobId: "job_1",
        status: "succeeded",
      }),
    ).toThrow("Pending jobs must be queued or running")
  })

  it("rejects failed poll responses with unbranded errors", () => {
    expect(() =>
      polledJob({
        context: {
          ...baseContext((async () => new Response("{}")) as typeof globalThis.fetch),
          job: {
            id: "job_1",
            type: "video",
            provider: "exampleProxy",
            providerId: "example",
            model: "video",
            status: "running",
          },
        } as ProviderPollContext,
        status: "failed",
        error: {
          code: "PROVIDER_ERROR",
          message: "third-party shape",
          provider: "exampleProxy",
          retryable: false,
        } as never,
      }),
    ).toThrow("Provider reported failure with invalid error details")
  })

  it("preserves provider state across pending and polled jobs", async () => {
    const statefulProvider = defineHttpProvider<
      { id?: string },
      { status: string; output?: { url?: string }; nextToken?: string }
    >({
      id: "stateful",
      displayName: "Stateful",
      baseURL: "https://api.example.com/v1",
      statusMap: { done: "succeeded", working: "running" },
      models: {
        video: {
          id: "video",
          type: "video",
          modes: ["text-to-video"],
          async: true,
        },
      },
      create: {
        request: { path: "/videos", body: () => ({}) },
        output: (response, context) =>
          pendingProviderJob({
            context,
            providerJobId: response.id,
            providerState: { pollPath: `/operations/${response.id}` },
          }),
      },
      poll: {
        request: {
          path: (context) => String(context.job.providerState?.pollPath),
        },
        output: (response, context, helpers) =>
          polledJob({
            context,
            status: helpers.statusFrom(response.status, { context }),
            providerState: { nextToken: response.nextToken },
            assets: response.output?.url
              ? [{ type: "video", url: response.output.url }]
              : undefined,
            raw: response,
          }),
      },
    })
    const calls: string[] = []
    const fetch = async (url: URL | RequestInfo) => {
      calls.push(String(url))
      const text = String(url).endsWith("/operations/job_1")
        ? {
            status: "done",
            nextToken: "next_1",
            output: { url: "https://cdn.example.com/a.mp4" },
          }
        : { id: "job_1" }
      return new Response(JSON.stringify(text))
    }

    const create = await statefulProvider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "statefulProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: statefulProvider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      expect(create.job.providerState?.pollPath).toBe("/operations/job_1")
      const polled = await statefulProvider.driver.poll?.({
        ...baseContext(fetch as typeof globalThis.fetch),
        job: create.job,
      } as ProviderPollContext)
      expect(calls[1]).toBe("https://api.example.com/v1/operations/job_1")
      expect(polled?.providerState?.pollPath).toBe("/operations/job_1")
      expect(polled?.providerState?.nextToken).toBe("next_1")
    }
  })

  it("rejects pending provider jobs without a provider job id", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ status: "working" }))) as typeof globalThis.fetch

    await expect(
      provider.driver.create({
        ...baseContext(fetch),
        request: {
          provider: "exampleProxy",
          model: "video",
          type: "video",
          input: { prompt: "test" },
        },
        model: provider.models.video,
      } as ProviderCreateContext),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Provider did not return a job id",
    })
  })

  it("rejects unknown mapped provider statuses by default", async () => {
    const fetch = async (url: URL | RequestInfo) => {
      const text = String(url).endsWith("/videos/job_1")
        ? { status: "mystery" }
        : { id: "job_1", status: "working" }
      return new Response(JSON.stringify(text))
    }

    const create = await provider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: provider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      await expect(
        provider.driver.poll?.({
          ...baseContext(fetch as typeof globalThis.fetch),
          job: create.job,
        } as ProviderPollContext),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        message: "Unknown provider status: mystery",
      })
    }
  })

  it("rejects missing mapped provider statuses by default", async () => {
    const fetch = async (url: URL | RequestInfo) => {
      const text = String(url).endsWith("/videos/job_1")
        ? { output: { url: "https://cdn.example.com/a.mp4" } }
        : { id: "job_1", status: "working" }
      return new Response(JSON.stringify(text))
    }

    const create = await provider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: provider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      await expect(
        provider.driver.poll?.({
          ...baseContext(fetch as typeof globalThis.fetch),
          job: create.job,
        } as ProviderPollContext),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        message: "Provider response is missing status",
      })
    }
  })

  it("rejects succeeded poll responses without assets", async () => {
    const fetch = async (url: URL | RequestInfo) => {
      const text = String(url).endsWith("/videos/job_1")
        ? { status: "done" }
        : { id: "job_1", status: "working" }
      return new Response(JSON.stringify(text))
    }

    const create = await provider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "exampleProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: provider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      await expect(
        provider.driver.poll?.({
          ...baseContext(fetch as typeof globalThis.fetch),
          job: create.job,
        } as ProviderPollContext),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        message: "Provider reported success without output assets",
      })
    }
  })

  it("allows explicit empty successful poll results", async () => {
    const emptyProvider = defineHttpProvider<
      { id?: string; status?: string },
      { status: string }
    >({
      id: "empty",
      displayName: "Empty",
      baseURL: "https://api.example.com/v1",
      statusMap: { done: "succeeded", working: "running" },
      models: {
        video: {
          id: "video",
          type: "video",
          modes: ["text-to-video"],
          async: true,
        },
      },
      create: {
        request: { path: "/videos", body: () => ({}) },
        output: (response, context) =>
          pendingProviderJob({
            context,
            providerJobId: response.id,
            status: "running",
          }),
      },
      poll: {
        request: { path: (context) => `/videos/${context.job.providerJobId}` },
        output: (response, context, helpers) =>
          polledJob({
            context,
            status: helpers.statusFrom(response.status, { context }),
            allowEmptyResult: true,
          }),
      },
    })
    const fetch = async (url: URL | RequestInfo) => {
      const text = String(url).endsWith("/videos/job_1")
        ? { status: "done" }
        : { id: "job_1", status: "working" }
      return new Response(JSON.stringify(text))
    }

    const create = await emptyProvider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "emptyProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: emptyProvider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      const polled = await emptyProvider.driver.poll?.({
        ...baseContext(fetch as typeof globalThis.fetch),
        job: create.job,
      } as ProviderPollContext)
      expect(polled?.status).toBe("succeeded")
      expect(polled?.result?.assets).toEqual([])
    }
  })

  it("rejects failed poll responses without error details", async () => {
    const failedProvider = defineHttpProvider<
      { id?: string; status?: string },
      { status: string }
    >({
      id: "failed",
      displayName: "Failed",
      baseURL: "https://api.example.com/v1",
      statusMap: { failed: "failed", working: "running" },
      models: {
        video: {
          id: "video",
          type: "video",
          modes: ["text-to-video"],
          async: true,
        },
      },
      create: {
        request: { path: "/videos", body: () => ({}) },
        output: (response, context) =>
          pendingProviderJob({
            context,
            providerJobId: response.id,
            status: "running",
          }),
      },
      poll: {
        request: { path: (context) => `/videos/${context.job.providerJobId}` },
        output: (response, context, helpers) =>
          polledJob({
            context,
            status: helpers.statusFrom(response.status, { context }),
          }),
      },
    })
    const fetch = async (url: URL | RequestInfo) => {
      const text = String(url).endsWith("/videos/job_1")
        ? { status: "failed" }
        : { id: "job_1", status: "working" }
      return new Response(JSON.stringify(text))
    }

    const create = await failedProvider.driver.create({
      ...baseContext(fetch as typeof globalThis.fetch),
      request: {
        provider: "failedProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: failedProvider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      await expect(
        failedProvider.driver.poll?.({
          ...baseContext(fetch as typeof globalThis.fetch),
          job: create.job,
        } as ProviderPollContext),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        message: "Provider reported failure without error details",
      })
    }
  })

  it("supports custom response and error parsers", async () => {
    const textProvider = defineHttpProvider<{ ok: true }>({
      id: "text",
      displayName: "Text",
      baseURL: "https://api.example.com/v1",
      models: {
        image: {
          id: "image",
          type: "image",
          modes: ["text-to-image"],
          async: false,
        },
      },
      create: {
        request: {
          path: "/text",
          parseResponse: ({ text }) => ({ ok: text === "done" }),
          parseError: ({ text }) => ({ message: text }),
        },
        output: (response, context) =>
          completed({
            context,
            assets: response.ok ? [{ type: "image", url: "https://cdn.example.com/a.png" }] : [],
          }),
      },
    })

    const fetchOk = (async () => new Response("done")) as typeof globalThis.fetch
    const fetchFailure = (async () =>
      new Response("plain failure", { status: 500 })) as typeof globalThis.fetch

    const ok = await textProvider.driver.create({
      ...baseContext(fetchOk),
      request: {
        provider: "textProxy",
        model: "image",
        type: "image",
        input: { prompt: "test" },
      },
      model: textProvider.models.image,
    } as ProviderCreateContext)
    expect(ok.kind).toBe("completed")

    await expect(
      textProvider.driver.create({
        ...baseContext(fetchFailure),
        request: {
          provider: "textProxy",
          model: "image",
          type: "image",
          input: { prompt: "test" },
        },
        model: textProvider.models.image,
      } as ProviderCreateContext),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "plain failure",
      retryable: true,
    })
  })

  it("classifies common HTTP error statuses", async () => {
    const errorProvider = defineHttpProvider<{ ok: true }>({
      id: "errors",
      displayName: "Errors",
      baseURL: "https://api.example.com/v1",
      models: {
        image: {
          id: "image",
          type: "image",
          modes: ["text-to-image"],
          async: false,
        },
      },
      create: {
        request: { path: "/images", body: () => ({}) },
        output: (response, context) =>
          completed({
            context,
            assets: response.ok ? [{ type: "image", url: "https://cdn.example.com/a.png" }] : [],
          }),
      },
    })
    const createContext = (fetch: typeof globalThis.fetch) =>
      ({
        ...baseContext(fetch),
        request: {
          provider: "errorsProxy",
          model: "image",
          type: "image",
          input: { prompt: "test" },
        },
        model: errorProvider.models.image,
      }) as ProviderCreateContext

    await expect(
      errorProvider.driver.create(
        createContext(
          (async () =>
            new Response(JSON.stringify({ message: "missing api key" }), {
              status: 401,
            })) as typeof globalThis.fetch,
        ),
      ),
    ).rejects.toMatchObject({
      code: "AUTH_ERROR",
      retryable: false,
    })

    await expect(
      errorProvider.driver.create(
        createContext(
          (async () =>
            new Response(JSON.stringify({ message: "slow down" }), {
              status: 429,
            })) as typeof globalThis.fetch,
        ),
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    })

    await expect(
      errorProvider.driver.create(
        createContext(
          (async () =>
            new Response(JSON.stringify({ message: "blocked by safety policy" }), {
              status: 403,
            })) as typeof globalThis.fetch,
        ),
      ),
    ).rejects.toMatchObject({
      code: "CONTENT_REJECTED",
      retryable: false,
    })
  })

  it("preserves MediaRouterException details in provider errors", () => {
    const error = new MediaRouterException(
      createMediaRouterError("RATE_LIMITED", "too many requests", {
        provider: "sourceProvider",
        model: "sourceModel",
        retryable: true,
        statusCode: 429,
      }),
    )

    expect(providerError(error, "fallbackProvider", "fallbackModel")).toMatchObject({
      code: "RATE_LIMITED",
      message: "too many requests",
      provider: "sourceProvider",
      model: "sourceModel",
      retryable: true,
      statusCode: 429,
    })
  })

  it("preserves plain MediaRouterError details in provider errors", () => {
    const error = createMediaRouterError("CONTENT_REJECTED", "blocked", {
      provider: "sourceProvider",
      model: "sourceModel",
      statusCode: 400,
      raw: { reason: "policy" },
    })

    expect(providerError(error, "fallbackProvider", "fallbackModel")).toMatchObject({
      code: "CONTENT_REJECTED",
      message: "blocked",
      provider: "sourceProvider",
      model: "sourceModel",
      statusCode: 400,
      raw: { reason: "policy" },
    })
  })

  it("does not treat provider SDK code/message objects as MediaRouterError", () => {
    expect(
      providerError(
        {
          code: "RATE_LIMITED",
          message: "provider quota error",
          provider: "stripe",
          retryable: true,
        },
        "fallbackProvider",
        "fallbackModel",
      ),
    ).toMatchObject({
      code: "UNKNOWN",
      message: "Unknown provider error",
      provider: "fallbackProvider",
      model: "fallbackModel",
    })
  })

  it("supports custom body serialization", async () => {
    const calls: Array<{ init: RequestInit }> = []
    const formProvider = defineHttpProvider<{ data?: Array<{ url: string }> }>({
      id: "form",
      displayName: "Form",
      baseURL: "https://api.example.com/v1",
      models: {
        image: {
          id: "image",
          type: "image",
          modes: ["text-to-image"],
          async: false,
        },
      },
      create: {
        request: {
          path: "/form",
          contentType: "application/x-www-form-urlencoded",
          body: (context) => ({
            prompt: context.request.input.prompt,
          }),
          serializeBody: ({ body }) => {
            const fields = body as Record<string, string>
            return new URLSearchParams(fields)
          },
        },
        output: (response, context) =>
          completed({
            context,
            assets: response.data?.map((item) => ({ type: "image", url: item.url })) ?? [],
          }),
      },
    })
    const fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ init: init ?? {} })
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/a.png" }] }))
    }) as typeof globalThis.fetch

    await formProvider.driver.create({
      ...baseContext(fetch),
      request: {
        provider: "formProxy",
        model: "image",
        type: "image",
        input: { prompt: "test" },
      },
      model: formProvider.models.image,
    } as ProviderCreateContext)

    expect((calls[0]?.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    )
    expect(String(calls[0]?.init.body)).toBe("prompt=test")
  })

  it("infers content type for URLSearchParams bodies", async () => {
    const calls: Array<{ init: RequestInit }> = []
    const formProvider = defineHttpProvider<{ data?: Array<{ url: string }> }>({
      id: "form-auto",
      displayName: "Form Auto",
      baseURL: "https://api.example.com/v1",
      models: {
        image: {
          id: "image",
          type: "image",
          modes: ["text-to-image"],
          async: false,
        },
      },
      create: {
        request: {
          path: "/form",
          body: (context) =>
            new URLSearchParams({ prompt: context.request.input.prompt }),
        },
        output: (response, context) =>
          completed({
            context,
            assets: response.data?.map((item) => ({ type: "image", url: item.url })) ?? [],
          }),
      },
    })
    const fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ init: init ?? {} })
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/a.png" }] }))
    }) as typeof globalThis.fetch

    await formProvider.driver.create({
      ...baseContext(fetch),
      request: {
        provider: "formProxy",
        model: "image",
        type: "image",
        input: { prompt: "test" },
      },
      model: formProvider.models.image,
    } as ProviderCreateContext)

    expect((calls[0]?.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    )
    expect(String(calls[0]?.init.body)).toBe("prompt=test")
  })

  it("supports HTTP cancellation", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const cancelProvider = defineHttpProvider<{ id?: string }>({
      id: "cancel",
      displayName: "Cancel",
      baseURL: "https://api.example.com/v1",
      models: {
        video: {
          id: "video",
          type: "video",
          modes: ["text-to-video"],
          async: true,
        },
      },
      create: {
        request: { path: "/videos", body: () => ({}) },
        output: (response, context) =>
          pendingProviderJob({
            context,
            providerJobId: response.id,
          }),
      },
      cancel: {
        request: {
          method: "DELETE",
          path: (context) => `/videos/${context.job.providerJobId}`,
        },
      },
    })
    const fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ id: "job_1" }))
    }) as typeof globalThis.fetch

    const create = await cancelProvider.driver.create({
      ...baseContext(fetch),
      request: {
        provider: "cancelProxy",
        model: "video",
        type: "video",
        input: { prompt: "test" },
      },
      model: cancelProvider.models.video,
    } as ProviderCreateContext)

    if (create.kind === "pending") {
      await cancelProvider.driver.cancel?.({
        ...baseContext(fetch),
        job: create.job,
      } as ProviderCancelContext)
    }

    expect(calls[1]?.url).toBe("https://api.example.com/v1/videos/job_1")
    expect(calls[1]?.init.method).toBe("DELETE")
  })
})

function baseContext(fetch: typeof globalThis.fetch) {
  return {
    provider: "exampleProxy",
    providerId: "example",
    plugin: provider,
    config: { plugin: "example", apiKey: "secret" },
    fetch,
    resolved: {
      dimensions: {
        width: 1024,
        height: 1024,
        aspectRatio: "1:1",
        normalizedRatio: 1,
        orientation: "square" as const,
        size: "1024x1024",
      },
    },
  }
}
