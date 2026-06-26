import {
  createMediaRouterError,
  defineProvider,
  type GenerationJob,
  type GenerationStatus,
  type MediaRouterErrorCode,
  type ModelDefinition,
  type ProviderCancelContext,
  type ProviderCreateContext,
  type ProviderCreateOutput,
  type ProviderPlugin,
  type ProviderPollContext,
  type ProviderRuntimeContext,
} from "@miragari/core"
import {
  providerError,
  statusFrom,
  type MissingStatusStrategy,
  type UnknownStatusStrategy,
} from "./toolkit.js"

export {
  completed,
  completedResult,
  pendingJob,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  providerError,
  statusFrom,
  stripUndefined,
} from "./toolkit.js"
export type { MissingStatusStrategy, UnknownStatusStrategy } from "./toolkit.js"

export type BodySerializationInput<TContext> = {
  body: unknown
  context: TContext
}

type HttpRuntimeContext =
  | ProviderCreateContext
  | ProviderPollContext
  | ProviderCancelContext

export type HttpRequestSpec<TContext> = {
  method?: "GET" | "POST" | "DELETE"
  path: string | ((context: TContext) => string)
  body?: (context: TContext) => unknown
  query?: (context: TContext) => Record<string, string | number | boolean | undefined>
  headers?: (context: TContext) => Record<string, string | undefined>
  contentType?: string | false
  serializeBody?: (
    input: BodySerializationInput<TContext>,
  ) => BodyInit | undefined | Promise<BodyInit | undefined>
  parseResponse?: (
    input: HttpResponseParseInput<TContext>,
  ) => unknown | Promise<unknown>
  parseError?: (
    input: HttpResponseParseInput<TContext>,
  ) => unknown | Promise<unknown>
}

export type HttpCreateRequestSpec = HttpRequestSpec<ProviderCreateContext>
export type HttpPollRequestSpec = HttpRequestSpec<ProviderPollContext>
export type HttpCancelRequestSpec = HttpRequestSpec<ProviderCancelContext>

export type HttpResponseParseInput<TContext> = {
  response: Response
  text: string
  context: TContext
}

export type HttpOutputHelpers = {
  statusFrom: (
    providerStatus: string | undefined,
    options?: {
      context?: ProviderCreateContext | ProviderPollContext | ProviderCancelContext
      unknownStatus?: UnknownStatusStrategy
      missingStatus?: MissingStatusStrategy
    },
  ) => GenerationStatus
}

export type HttpProviderDefinition<
  TCreateResponse,
  TPollResponse = TCreateResponse,
  TCancelResponse = unknown,
> = {
  id: string
  displayName: string
  baseURL?: string
  auth?: ProviderPlugin["auth"]
  defaultModels?: ProviderPlugin["defaultModels"]
  models: Record<string, ModelDefinition>
  statusMap?: Record<string, GenerationStatus>
  unknownStatus?: UnknownStatusStrategy
  missingStatus?: MissingStatusStrategy
  create: {
    request: HttpCreateRequestSpec
    output: (
      response: TCreateResponse,
      context: ProviderCreateContext,
      helpers: HttpOutputHelpers,
    ) => ProviderCreateOutput
  }
  poll?: {
    request: HttpPollRequestSpec
    output: (
      response: TPollResponse,
      context: ProviderPollContext,
      helpers: HttpOutputHelpers,
    ) => GenerationJob | Promise<GenerationJob>
  }
  cancel?: {
    request: HttpCancelRequestSpec
    output?: (
      response: TCancelResponse,
      context: ProviderCancelContext,
      helpers: HttpOutputHelpers,
    ) => void | Promise<void>
  }
}

export function defineHttpProvider<
  TCreateResponse,
  TPollResponse = TCreateResponse,
  TCancelResponse = unknown,
>(
  definition: HttpProviderDefinition<TCreateResponse, TPollResponse, TCancelResponse>,
): ProviderPlugin {
  const helpers = outputHelpers(definition)
  const poll = definition.poll
  const cancel = definition.cancel
  return defineProvider({
    id: definition.id,
    displayName: definition.displayName,
    baseURL: definition.baseURL,
    auth: definition.auth,
    defaultModels: definition.defaultModels,
    models: definition.models,
    driver: {
      async create(context) {
        const response = await request<TCreateResponse, ProviderCreateContext>(
          context,
          definition.create.request,
        )
        return definition.create.output(response, context, helpers)
      },
      poll: poll
        ? async (context) => {
            const response = await request<TPollResponse, ProviderPollContext>(
              context,
              poll.request,
            )
            return poll.output(response, context, helpers)
          }
        : undefined,
      cancel: cancel
        ? async (context) => {
            const response = await request<TCancelResponse, ProviderCancelContext>(
              context,
              cancel.request,
            )
            await cancel.output?.(response, context, helpers)
          }
        : undefined,
      normalizeError(error, { request, job, runtime }) {
        return providerError(
          error,
          runtime.provider,
          request?.model ?? job?.model,
        )
      },
    },
  })
}

function outputHelpers(
  definition: Pick<
    HttpProviderDefinition<unknown, unknown>,
    "id" | "statusMap" | "unknownStatus" | "missingStatus"
  >,
): HttpOutputHelpers {
  return {
    statusFrom(providerStatus, options) {
      return statusFrom(providerStatus, definition.statusMap, {
        provider: options?.context?.provider ?? definition.id,
        model: contextModel(options?.context),
        unknownStatus: options?.unknownStatus ?? definition.unknownStatus,
        missingStatus: options?.missingStatus ?? definition.missingStatus,
      })
    },
  }
}

function contextModel(
  context:
    | ProviderCreateContext
    | ProviderPollContext
    | ProviderCancelContext
    | undefined,
): string | undefined {
  if (!context) return undefined
  return "request" in context ? context.request.model : context.job.model
}

export function providerUrl(context: ProviderRuntimeContext, path: string): URL {
  const base = context.config.baseURL || context.plugin.baseURL
  if (!base) {
    throw new Error(`Provider ${context.provider} is missing baseURL`)
  }
  return new URL(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`)
}

export function authHeaders(context: ProviderRuntimeContext): Record<string, string> {
  const headers: Record<string, string> = {
    ...(context.config.headers ?? {}),
  }
  const auth = context.config.auth ?? context.plugin.auth ?? { type: "bearer" as const }
  if (auth.type === "bearer" && context.config.apiKey) {
    headers[auth.header ?? "Authorization"] = `Bearer ${context.config.apiKey}`
  }
  if (auth.type === "api-key" && auth.in !== "query" && context.config.apiKey) {
    headers[auth.header] = context.config.apiKey
  }
  return headers
}

export function applyAuthToUrl(context: ProviderRuntimeContext, url: URL): URL {
  const auth = context.config.auth ?? context.plugin.auth ?? { type: "bearer" as const }
  if (auth.type === "api-key" && auth.in === "query" && context.config.apiKey) {
    url.searchParams.set(auth.query, context.config.apiKey)
  }
  return url
}

export async function requestJson<
  T,
  TContext extends HttpRuntimeContext = HttpRuntimeContext,
>(
  context: TContext,
  spec: HttpRequestSpec<TContext>,
): Promise<T> {
  return request<T, TContext>(context, spec)
}

export async function request<
  T,
  TContext extends HttpRuntimeContext = HttpRuntimeContext,
>(
  context: TContext,
  spec: HttpRequestSpec<TContext>,
): Promise<T> {
  const path = typeof spec.path === "function" ? spec.path(context) : spec.path
  const url = applyAuthToUrl(context, providerUrl(context, path))
  const query = spec.query?.(context)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null) url.searchParams.set(key, String(value))
  }

  const body = spec.body?.(context)
  const method = spec.method ?? (body == null ? "GET" : "POST")
  const serializedBody = await serializeRequestBody({ body, context }, spec)
  const contentType =
    spec.contentType === undefined
      ? inferContentType(body, serializedBody)
      : spec.contentType
  const response = await context.fetch(url, {
    method,
    headers: {
      ...authHeaders(context),
      ...(serializedBody == null || !contentType ? {} : { "Content-Type": contentType }),
      ...definedHeaders(spec.headers?.(context)),
    },
    body: serializedBody,
  })
  return parseHttpResponse<T, TContext>(response, context, spec)
}

async function parseHttpResponse<
  T,
  TContext extends HttpRuntimeContext = HttpRuntimeContext,
>(
  response: Response,
  context: TContext,
  spec: HttpRequestSpec<TContext>,
): Promise<T> {
  const text = await response.text()
  const input = { response, text, context }
  if (!response.ok) {
    const raw = spec.parseError
      ? await parseWithFallback(() => spec.parseError?.(input), text)
      : parseJsonTextSafe(text)
    const message =
      errorMessageFromRaw(raw) ??
      `Provider request failed with status ${response.status}`
    throw createMediaRouterError(errorCodeFromStatus(response.status, raw), message, {
      provider: context.provider,
      retryable: retryableFromStatus(response.status),
      statusCode: response.status,
      raw,
    })
  }
  if (spec.parseResponse) {
    return spec.parseResponse(input) as T | Promise<T>
  }
  return parseJsonText(text) as T
}

async function serializeRequestBody<
  TContext extends HttpRuntimeContext,
>(
  input: BodySerializationInput<TContext>,
  spec: HttpRequestSpec<TContext>,
): Promise<BodyInit | undefined> {
  if (input.body == null) return undefined
  if (spec.serializeBody) return spec.serializeBody(input)
  if (isBodyInit(input.body)) return input.body
  return JSON.stringify(input.body)
}

function inferContentType(
  originalBody: unknown,
  serializedBody: BodyInit | undefined,
): string | false {
  if (serializedBody == null) return false
  if (serializedBody instanceof URLSearchParams) {
    return "application/x-www-form-urlencoded;charset=UTF-8"
  }
  if (
    typeof FormData !== "undefined" &&
    serializedBody instanceof FormData
  ) {
    return false
  }
  if (typeof Blob !== "undefined" && serializedBody instanceof Blob) {
    return serializedBody.type || false
  }
  if (
    serializedBody instanceof ArrayBuffer ||
    ArrayBuffer.isView(serializedBody)
  ) {
    return false
  }
  if (
    typeof serializedBody === "string" &&
    typeof originalBody === "string"
  ) {
    return "text/plain;charset=UTF-8"
  }
  return "application/json"
}

function isBodyInit(value: unknown): value is BodyInit {
  if (typeof value === "string") return true
  if (value instanceof URLSearchParams) return true
  if (value instanceof ArrayBuffer) return true
  if (ArrayBuffer.isView(value)) return true
  if (typeof FormData !== "undefined" && value instanceof FormData) return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true
  return false
}

export function parseJsonText(text: string): unknown {
  return text.trim() ? JSON.parse(text) : {}
}

function parseJsonTextSafe(text: string): unknown {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

async function parseWithFallback(
  parse: () => unknown | Promise<unknown>,
  text: string,
): Promise<unknown> {
  try {
    return await parse()
  } catch {
    return parseJsonTextSafe(text)
  }
}

function errorMessageFromRaw(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const error = "error" in raw ? raw.error : undefined
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message
    if (typeof message === "string") return message
  }
  if ("message" in raw && typeof raw.message === "string") return raw.message
  return undefined
}

function errorCodeFromStatus(
  status: number,
  raw: unknown,
): MediaRouterErrorCode {
  const message = errorMessageFromRaw(raw)?.toLowerCase() ?? ""
  if (
    message.includes("content policy") ||
    message.includes("safety") ||
    message.includes("moderation")
  ) {
    return "CONTENT_REJECTED"
  }
  if (message.includes("region") || message.includes("location")) {
    return "REGION_RESTRICTED"
  }
  if (status === 401 || status === 403) return "AUTH_ERROR"
  if (status === 404) return "NOT_FOUND"
  if (status === 429) return "RATE_LIMITED"
  return "PROVIDER_ERROR"
}

function retryableFromStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function definedHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([, value]) => value !== undefined),
  ) as Record<string, string>
}
