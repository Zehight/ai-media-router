import type {
  GenerationJob,
  GenerationRequest,
  ModelDefinition,
  ProviderCancelContext,
  ProviderCreateContext,
  ProviderInstanceConfig,
  ProviderPlugin,
  ProviderPollContext,
  ResolvedDimensions,
} from "@miragari/core"

export type ProviderFetchCall = {
  url: string
  init: RequestInit
}

export type MockResponse =
  | Response
  | {
      kind: "json"
      body: unknown
      init?: ResponseInit
    }
  | {
      kind: "text"
      body: string
      init?: ResponseInit
    }
  | {
      kind: "raw"
      body?: BodyInit | null
      init?: ResponseInit
    }

export function createProviderHarness(input: {
  plugin: ProviderPlugin
  provider?: string
  apiKey?: string
  config?: Partial<ProviderInstanceConfig>
  dimensions?: ResolvedDimensions
  responses?: MockResponse[] | ((call: ProviderFetchCall) => MockResponse | Promise<MockResponse>)
}) {
  const calls: ProviderFetchCall[] = []
  const responses = input.responses ?? []
  const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    const call = await normalizeFetchCall(url, init)
    calls.push(call)
    const response =
      typeof responses === "function"
        ? await responses(call)
        : responseAt(responses, calls.length - 1, call)
    return toResponse(response)
  }

  const provider = input.provider ?? `${input.plugin.id}Proxy`
  const config: ProviderInstanceConfig = {
    plugin: input.plugin.id,
    apiKey: input.apiKey ?? "secret",
    ...input.config,
  }
  const runtime = {
    provider,
    providerId: input.plugin.id,
    plugin: input.plugin,
    config,
    fetch: fetch as typeof globalThis.fetch,
    resolved: {
      dimensions: input.dimensions ?? defaultDimensions(),
    },
  }

  return {
    calls,
    fetch: fetch as typeof globalThis.fetch,
    runtime,
    createContext(request: GenerationRequest, model?: ModelDefinition): ProviderCreateContext {
      const resolvedModel = model ?? input.plugin.models[request.model]
      if (!resolvedModel) {
        throw new Error(
          `Provider test harness could not find model "${request.model}" on ${input.plugin.id}`,
        )
      }
      return {
        ...runtime,
        request,
        model: resolvedModel,
      } as ProviderCreateContext
    },
    pollContext(job: GenerationJob): ProviderPollContext {
      return { ...runtime, job } as ProviderPollContext
    },
    cancelContext(job: GenerationJob): ProviderCancelContext {
      return { ...runtime, job } as ProviderCancelContext
    },
    expectFetchCount(count: number) {
      if (calls.length !== count) {
        throw new Error(`Expected ${count} provider fetch calls, got ${calls.length}`)
      }
    },
    expectAllResponsesUsed() {
      if (typeof responses === "function") return
      if (calls.length !== responses.length) {
        throw new Error(
          `Expected all ${responses.length} provider responses to be used, got ${calls.length} fetch calls`,
        )
      }
    },
  }
}

export function jsonBody(call: ProviderFetchCall): unknown {
  return JSON.parse(String(call.init.body))
}

export function jsonResponse(body: unknown, init?: ResponseInit): MockResponse {
  return { kind: "json", body, init }
}

export function textResponse(body: string, init?: ResponseInit): MockResponse {
  return { kind: "text", body, init }
}

export function rawResponse(
  body?: BodyInit | null,
  init?: ResponseInit,
): MockResponse {
  return { kind: "raw", body, init }
}

async function normalizeFetchCall(
  url: URL | RequestInfo,
  init?: RequestInit,
): Promise<ProviderFetchCall> {
  if (url instanceof Request) {
    return {
      url: url.url,
      init: {
        ...init,
        method: init?.method ?? url.method,
        headers: mergeHeaders(url.headers, init?.headers),
        body: init?.body ?? (await requestBody(url)),
      },
    }
  }
  return { url: String(url), init: init ?? {} }
}

async function requestBody(request: Request): Promise<string | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined
  const text = await request.clone().text()
  return text || undefined
}

function mergeHeaders(
  requestHeaders: Headers,
  initHeaders: HeadersInit | undefined,
): HeadersInit {
  return {
    ...headersRecord(requestHeaders),
    ...headersRecord(new Headers(initHeaders)),
  }
}

function headersRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  headers.forEach((value, key) => {
    output[key] = value
  })
  return output
}

function responseAt(
  responses: MockResponse[],
  index: number,
  call: ProviderFetchCall,
): MockResponse {
  const response = responses[index]
  if (!response) {
    throw new Error(`Unexpected provider fetch call #${index + 1}: ${call.url}`)
  }
  return response
}

function toResponse(input: MockResponse): Response {
  if (input instanceof Response) return input
  if (input.kind === "json") {
    return new Response(JSON.stringify(input.body), input.init)
  }
  if (input.kind === "text") {
    return new Response(input.body, input.init)
  }
  return new Response(input.body ?? null, input.init)
}

function defaultDimensions(): ResolvedDimensions {
  return {
    width: 1024,
    height: 1024,
    aspectRatio: "1:1",
    normalizedRatio: 1,
    orientation: "square",
    resolutionTier: "1K",
    size: "1024x1024",
  }
}
