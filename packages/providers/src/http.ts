import {
  createId,
  createMediaRouterError,
  defineProvider,
  normalizeMediaRouterError,
  mapProviderStatus,
  type GenerationJob,
  type GenerationRequest,
  type GenerationResult,
  type GenerationStatus,
  type MediaRouterErrorCode,
  type MediaAsset,
  type ModelDefinition,
  type ProviderCancelContext,
  type ProviderCreateContext,
  type ProviderCreateOutput,
  type ProviderPlugin,
  type ProviderPollContext,
  type ProviderRuntimeContext,
} from "@media-router/core"

export type BodySerializationInput<TContext> = {
  body: unknown
  context: TContext
}

type HttpRuntimeContext =
  | ProviderCreateContext
  | ProviderPollContext
  | ProviderCancelContext

export type UnknownStatusStrategy = "running" | "failed" | "throw"
export type MissingStatusStrategy = "running" | "throw"

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
    ) => GenerationJob
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

export function completedResult(input: {
  context: ProviderCreateContext
  assets: MediaAsset[]
  raw?: unknown
  providerRequest?: unknown
  allowEmptyResult?: boolean
}): GenerationResult {
  assertOutputAssets({
    assets: input.assets,
    allowEmptyResult: input.allowEmptyResult,
    provider: input.context.provider,
    model: input.context.request.model,
    raw: input.raw,
  })
  const jobId = createId("mr_job")
  const completedAt = new Date().toISOString()
  return {
    id: createId("mr_result"),
    jobId,
    type: input.context.request.type ?? input.context.model.type,
    provider: input.context.provider,
    providerId: input.context.providerId,
    model: input.context.request.model,
    status: "succeeded",
    assets: input.assets,
    raw: input.raw,
    resolved: {
      dimensions: input.context.resolved.dimensions,
      providerRequest: input.providerRequest,
    },
    timings: {
      createdAt: completedAt,
      completedAt,
    },
  }
}

export function completed(input: {
  context: ProviderCreateContext
  assets: MediaAsset[]
  raw?: unknown
  providerRequest?: unknown
  allowEmptyResult?: boolean
}): ProviderCreateOutput {
  return { kind: "completed", result: completedResult(input) }
}

export function pendingJob(input: {
  context: ProviderCreateContext
  providerJobId?: string
  providerState?: Record<string, unknown>
  status?: GenerationStatus
  raw?: unknown
  pollAfterMs?: number
  providerRequest?: unknown
}): ProviderCreateOutput {
  assertPendingStatus({
    status: input.status,
    provider: input.context.provider,
    model: input.context.request.model,
    raw: input.raw,
  })
  return {
    kind: "pending",
    job: {
      id: createId("mr_job"),
      type: input.context.request.type ?? input.context.model.type,
      provider: input.context.provider,
      providerId: input.context.providerId,
      model: input.context.request.model,
      status: input.status ?? "queued",
      providerJobId: input.providerJobId,
      providerState: input.providerState,
      raw: input.raw,
      pollAfterMs: normalizePollAfterMs(input.pollAfterMs),
      createdAt: new Date().toISOString(),
      resolved: {
        dimensions: input.context.resolved.dimensions,
        providerRequest: input.providerRequest,
      },
    },
  }
}

export function pendingProviderJob(input: {
  context: ProviderCreateContext
  providerJobId: string | undefined
  providerState?: Record<string, unknown>
  status?: GenerationStatus
  raw?: unknown
  pollAfterMs?: number
  providerRequest?: unknown
}): ProviderCreateOutput {
  if (!input.providerJobId) {
    throw createMediaRouterError("PROVIDER_ERROR", "Provider did not return a job id", {
      provider: input.context.provider,
      model: input.context.request.model,
      raw: input.raw,
    })
  }
  return pendingJob({
    ...input,
    providerJobId: input.providerJobId,
  })
}

export function pendingStatus(
  status: GenerationStatus | undefined,
  fallback: "queued" | "running" = "queued",
): "queued" | "running" {
  if (!status) return fallback
  if (status === "queued" || status === "running") return status
  throw new Error(
    `Provider create returned terminal status "${status}"; return completed() or throw an error instead`,
  )
}

export function polledJob(input: {
  context: ProviderPollContext
  status: GenerationStatus
  assets?: MediaAsset[]
  raw?: unknown
  error?: GenerationJob["error"]
  providerState?: Record<string, unknown>
  allowEmptyResult?: boolean
  pollAfterMs?: number
}): GenerationJob {
  const assets = input.assets ?? (input.allowEmptyResult ? [] : undefined)

  if (input.status === "succeeded") {
    assertOutputAssets({
      assets,
      allowEmptyResult: input.allowEmptyResult,
      provider: input.context.job.provider,
      model: input.context.job.model,
      raw: input.raw,
    })
  }
  if (input.status === "failed" && !input.error) {
    throw createMediaRouterError(
      "PROVIDER_ERROR",
      "Provider reported failure without error details",
      {
        provider: input.context.job.provider,
        model: input.context.job.model,
        raw: input.raw,
      },
    )
  }
  const normalizedError =
    input.status === "failed"
      ? normalizeMediaRouterError(input.error, {
          provider: input.context.job.provider,
          model: input.context.job.model,
        })
      : undefined
  const jobError = normalizedError
    ? {
        ...normalizedError,
        provider: input.context.job.provider,
        model: input.context.job.model,
      }
    : undefined
  if (input.status === "failed" && !normalizedError) {
    throw createMediaRouterError(
      "PROVIDER_ERROR",
      "Provider reported failure with invalid error details",
      {
        provider: input.context.job.provider,
        model: input.context.job.model,
        raw: input.error,
      },
    )
  }

  const updatedAt = new Date().toISOString()
  const result =
    input.status === "succeeded" && assets
      ? {
          id: createId("mr_result"),
          jobId: input.context.job.id,
          type: input.context.job.type,
          provider: input.context.job.provider,
          providerId: input.context.job.providerId,
          model: input.context.job.model,
          status: "succeeded" as const,
          assets,
          raw: input.raw,
          resolved: input.context.job.resolved,
          timings: {
            createdAt: input.context.job.createdAt ?? updatedAt,
            completedAt: updatedAt,
          },
        }
      : undefined

  return {
    ...input.context.job,
    status: input.status,
    result,
    error: jobError,
    providerState: mergeProviderState(
      input.context.job.providerState,
      input.providerState,
    ),
    raw: input.raw,
    pollAfterMs:
      normalizePollAfterMs(input.pollAfterMs) ?? input.context.job.pollAfterMs,
    updatedAt,
  }
}

function normalizePollAfterMs(pollAfterMs: number | undefined): number | undefined {
  if (pollAfterMs == null) return undefined
  if (!Number.isFinite(pollAfterMs) || pollAfterMs < 0) return undefined
  return pollAfterMs
}

function assertPendingStatus(input: {
  status: GenerationStatus | undefined
  provider: string
  model: string
  raw: unknown
}): void {
  if (!input.status || input.status === "queued" || input.status === "running") return
  throw createMediaRouterError(
    "PROVIDER_ERROR",
    "Pending jobs must be queued or running",
    {
      provider: input.provider,
      model: input.model,
      raw: input.raw,
    },
  )
}

function mergeProviderState(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!current) return next
  if (!next) return current
  return { ...current, ...next }
}

export function statusFrom(
  providerStatus: string | undefined,
  statusMap: Record<string, GenerationStatus> | undefined,
  options?: {
    provider?: string
    model?: string
    unknownStatus?: UnknownStatusStrategy
    missingStatus?: MissingStatusStrategy
  },
): GenerationStatus {
  if (!providerStatus && statusMap) {
    const missingStatus = options?.missingStatus ?? "throw"
    if (missingStatus === "throw") {
      throw createMediaRouterError(
        "PROVIDER_ERROR",
        "Provider response is missing status",
        {
          provider: options?.provider ?? "provider",
          model: options?.model,
          raw: { statusMap },
        },
      )
    }
  }
  if (providerStatus && statusMap && !(providerStatus in statusMap)) {
    const unknownStatus = options?.unknownStatus ?? "throw"
    if (unknownStatus === "failed") return "failed"
    if (unknownStatus === "throw") {
      throw createMediaRouterError(
        "PROVIDER_ERROR",
        `Unknown provider status: ${providerStatus}`,
        {
          provider: options?.provider ?? "provider",
          model: options?.model,
          raw: { providerStatus, statusMap },
        },
      )
    }
  }
  return mapProviderStatus(providerStatus, statusMap)
}

export function providerError(error: unknown, provider: string, model?: string) {
  const normalized = normalizeMediaRouterError(error, { provider, model: model ?? "unknown" })
  if (normalized) return normalized
  if (error instanceof Error) {
    return createMediaRouterError("PROVIDER_ERROR", error.message, {
      provider,
      model,
      raw: error,
    })
  }
  return createMediaRouterError("UNKNOWN", "Unknown provider error", {
    provider,
    model,
    raw: error,
  })
}

function assertOutputAssets(input: {
  assets: MediaAsset[] | undefined
  allowEmptyResult?: boolean
  provider: string
  model?: string
  raw?: unknown
}): void {
  if (input.allowEmptyResult) return
  if (input.assets?.some(isConsumableAsset)) return
  throw createMediaRouterError(
    "PROVIDER_ERROR",
    "Provider reported success without output assets",
    {
      provider: input.provider,
      model: input.model,
      raw: input.raw,
    },
  )
}

function isConsumableAsset(asset: MediaAsset): boolean {
  return Boolean(asset.url || asset.base64)
}

export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

function definedHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([, value]) => value !== undefined),
  ) as Record<string, string>
}
