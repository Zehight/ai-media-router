import {
  MediaRouterException,
  createMediaRouterError,
  type AudioGenerationRequest,
  type GenerationRequest,
  type ImageGenerationRequest,
  type MediaInput,
  type MediaType,
  type Model3DGenerationRequest,
  type VideoGenerationRequest,
} from "@miragari/ai-media-router-core"

export type GenerationMediaType = Exclude<MediaType, "file">
type ModelDefaults = Partial<Record<GenerationMediaType, string>>
type ProviderDefaults = Partial<Record<GenerationMediaType, string>>
type MediaDefaultMap = Partial<Record<GenerationMediaType, Record<string, unknown>>>
export type MediaIntentItem = MediaInput | string
export type MediaIntentInput = MediaIntentItem | MediaIntentItem[]

export type MediaRouterDefaultSlotObject = {
  provider?: string
  model?: string
  options?: Record<string, unknown>
  providerOptions?: Record<string, unknown>
} & Record<string, unknown>

export type MediaRouterDefaultSlot = MediaRouterDefaultSlotObject | string

export type MediaRouterDefaults = {
  provider?: string
  providers?: ProviderDefaults
  model?: string
  models?: ModelDefaults
  options?: MediaDefaultMap
  providerOptions?: MediaDefaultMap
  profiles?: Record<string, MediaRouterProfile>
  image?: MediaRouterDefaultSlot
  video?: MediaRouterDefaultSlot
  audio?: MediaRouterDefaultSlot
  model3d?: MediaRouterDefaultSlot
}

export type NormalizedMediaRouterDefaults = Omit<
  MediaRouterDefaults,
  | "providers"
  | "models"
  | "options"
  | "providerOptions"
  | "image"
  | "video"
  | "audio"
  | "model3d"
> & {
  providers?: ProviderDefaults
  models?: ModelDefaults
  options?: MediaDefaultMap
  providerOptions?: MediaDefaultMap
}

export type MediaFieldInput = MediaInput | string
export type MediaRouterProfile = {
  type?: GenerationMediaType
  provider?: string
  model?: string
  action?: string
  options?: Record<string, unknown>
  providerOptions?: Record<string, unknown>
} & Record<string, unknown>

type BaseGenerationIntent<TType extends GenerationMediaType> = {
  type?: TType
  profile?: string
  provider?: string
  model?: string
  action?: string
  providerOptions?: Record<string, unknown>
}

export type ImageGenerationIntent = BaseGenerationIntent<"image"> & {
  prompt: string
  negativePrompt?: string
  media?: MediaIntentInput
  image?: MediaFieldInput
  images?: MediaFieldInput[]
  mask?: MediaFieldInput
  width?: number
  height?: number
  count?: number
  seed?: number
  quality?: string
  outputFormat?: string
  options?: ImageGenerationRequest["options"]
}

export type VideoGenerationIntent = BaseGenerationIntent<"video"> & {
  prompt: string
  negativePrompt?: string
  media?: MediaIntentInput
  image?: MediaFieldInput
  firstFrame?: MediaFieldInput
  lastFrame?: MediaFieldInput
  images?: MediaFieldInput[]
  video?: MediaFieldInput
  videos?: MediaFieldInput[]
  audio?: MediaFieldInput
  audios?: MediaFieldInput[]
  width?: number
  height?: number
  duration?: number
  fps?: number
  seed?: number
  mode?: string
  quality?: string
  audioEnabled?: boolean
  options?: VideoGenerationRequest["options"]
}

export type AudioGenerationIntent = BaseGenerationIntent<"audio"> & {
  prompt?: string
  text?: string
  media?: MediaIntentInput
  audio?: MediaFieldInput
  audios?: MediaFieldInput[]
  duration?: number
  seed?: number
  voice?: string
  format?: string
  sampleRate?: number
  options?: AudioGenerationRequest["options"]
}

export type Model3DGenerationIntent = BaseGenerationIntent<"model3d"> & {
  prompt?: string
  media?: MediaIntentInput
  images?: MediaFieldInput[]
  sourceModel?: MediaFieldInput
  format?: string
  quality?: string
  texture?: boolean
  seed?: number
  options?: Model3DGenerationRequest["options"]
}

export type ImageGenerationInput = ImageGenerationRequest | ImageGenerationIntent | string
export type VideoGenerationInput = VideoGenerationRequest | VideoGenerationIntent | string
export type AudioGenerationInput = AudioGenerationRequest | AudioGenerationIntent | string
export type Model3DGenerationInput =
  | Model3DGenerationRequest
  | Model3DGenerationIntent
  | string
type StructuredRequestInput<TRequest extends GenerationRequest> = Omit<
  TRequest,
  "type"
> & {
  type?: TRequest["type"]
  profile?: string
}
export type StructuredGenerationInput =
  | StructuredRequestInput<ImageGenerationRequest>
  | StructuredRequestInput<VideoGenerationRequest>
  | StructuredRequestInput<AudioGenerationRequest>
  | StructuredRequestInput<Model3DGenerationRequest>
export type NormalizedGenerationRequest = GenerationRequest & { profile?: never }
export type NormalizedImageGenerationRequest = ImageGenerationRequest & {
  profile?: never
}
export type NormalizedVideoGenerationRequest = VideoGenerationRequest & {
  profile?: never
}
export type NormalizedAudioGenerationRequest = AudioGenerationRequest & {
  profile?: never
}
export type NormalizedModel3DGenerationRequest = Model3DGenerationRequest & {
  profile?: never
}
export type GenerationInput =
  | StructuredGenerationInput
  | ImageGenerationIntent
  | VideoGenerationIntent
  | AudioGenerationIntent
  | Model3DGenerationIntent
  | string

export function normalizeGenerationRequest(
  input: GenerationInput,
  defaults: MediaRouterDefaults | undefined,
  mediaType?: GenerationMediaType,
): NormalizedGenerationRequest {
  if (typeof input === "string") {
    if (mediaType === "video") return normalizeVideoRequest(input, defaults)
    if (mediaType === "audio") return normalizeAudioRequest(input, defaults)
    if (mediaType === "model3d") return normalizeModel3DRequest(input, defaults)
    return normalizeImageRequest({ prompt: input }, defaults)
  }

  if (hasRequestInput(input)) {
    const profile = profileDefaults(defaults, profileName(input))
    const type = input.type ?? mediaType ?? profile?.type ?? "image"
    assertProfileMatchesType(profile, type, profileName(input))
    const request = omitIntentFields(input)
    return applyRequestDefaults(
      { ...request, type } as GenerationRequest,
      defaults,
      profile,
    )
  }

  const profile = profileDefaults(defaults, input.profile)
  const type = input.type ?? mediaType ?? profile?.type ?? "image"
  assertProfileMatchesType(profile, type, input.profile)
  if (type === "image") return normalizeImageRequest(input as ImageGenerationInput, defaults)
  if (type === "video") return normalizeVideoRequest(input as VideoGenerationInput, defaults)
  if (type === "audio") return normalizeAudioRequest(input as AudioGenerationInput, defaults)
  return normalizeModel3DRequest(input as Model3DGenerationInput, defaults)
}

export function normalizeImageRequest(
  input: ImageGenerationInput,
  defaults: MediaRouterDefaults | undefined,
): NormalizedImageGenerationRequest {
  if (typeof input === "string") {
    return normalizeImageRequest({ prompt: input }, defaults)
  }
  const profile = profileDefaults(defaults, profileName(input))
  assertProfileMatchesType(profile, "image", profileName(input))
  if (hasRequestInput(input)) {
    assertInputMatchesType(input, "image")
    const request = omitIntentFields(input)
    return applyRequestDefaults(
      { ...request, type: "image" } as ImageGenerationRequest,
      defaults,
      profile,
    ) as NormalizedImageGenerationRequest
  }
  const intent = input as ImageGenerationIntent

  const options = mergeDefinedRecords(
    resolvedOptions(defaults, "image", profile),
    {
      width: intent.width,
      height: intent.height,
      count: intent.count,
      seed: intent.seed,
      quality: intent.quality,
      outputFormat: intent.outputFormat,
    },
    intent.options,
  )
  const providerOptions = mergeDefinedRecords(
    resolvedProviderOptions(defaults, "image", profile),
    intent.providerOptions,
  )

  return stripUndefined({
    type: "image",
    provider: requiredProvider(intent.provider, defaults, "image", profile),
    model: requiredModel(intent.model, defaults, "image", profile),
    action: intent.action ?? profile?.action,
    input: stripUndefined({
      prompt: intent.prompt,
      negativePrompt: intent.negativePrompt,
      images: mergeMediaInputGroups(
        mediaFieldList(intent.image),
        mediaFields(intent.images),
        mediaInputs(intent.media),
      ),
      mask: mediaField(intent.mask),
    }),
    options,
    providerOptions,
  }) as NormalizedImageGenerationRequest
}

export function normalizeVideoRequest(
  input: VideoGenerationInput,
  defaults: MediaRouterDefaults | undefined,
): NormalizedVideoGenerationRequest {
  if (typeof input === "string") {
    return normalizeVideoRequest({ prompt: input }, defaults)
  }
  const profile = profileDefaults(defaults, profileName(input))
  assertProfileMatchesType(profile, "video", profileName(input))
  if (hasRequestInput(input)) {
    assertInputMatchesType(input, "video")
    const request = omitIntentFields(input)
    return applyRequestDefaults(
      { ...request, type: "video" } as VideoGenerationRequest,
      defaults,
      profile,
    ) as NormalizedVideoGenerationRequest
  }
  const intent = input as VideoGenerationIntent

  const options = mergeDefinedRecords(
    resolvedOptions(defaults, "video", profile),
    {
      width: intent.width,
      height: intent.height,
      duration: intent.duration,
      fps: intent.fps,
      seed: intent.seed,
      mode: intent.mode,
      quality: intent.quality,
      audioEnabled: intent.audioEnabled,
    },
    intent.options,
  )
  const providerOptions = mergeDefinedRecords(
    resolvedProviderOptions(defaults, "video", profile),
    intent.providerOptions,
  )
  const imageMedia = mediaInputsByKind(intent.media, "image")
  const videoMedia = mediaInputsByKind(intent.media, "video")
  const audioMedia = mediaInputsByKind(intent.media, "audio")

  return stripUndefined({
    type: "video",
    provider: requiredProvider(intent.provider, defaults, "video", profile),
    model: requiredModel(intent.model, defaults, "video", profile),
    action: intent.action ?? profile?.action,
    input: stripUndefined({
      prompt: intent.prompt,
      negativePrompt: intent.negativePrompt,
      image: mediaField(intent.image),
      firstFrame: mediaField(intent.firstFrame),
      lastFrame: mediaField(intent.lastFrame),
      images: mergeMediaInputs(mediaFields(intent.images), imageMedia),
      video: mediaField(intent.video) ?? videoMedia?.[0],
      videos: mergeMediaInputs(
        mediaFields(intent.videos),
        intent.video ? videoMedia : mediaTail(videoMedia),
      ),
      audio: mediaField(intent.audio),
      audios: mergeMediaInputs(mediaFields(intent.audios), audioMedia),
    }),
    options,
    providerOptions,
  }) as NormalizedVideoGenerationRequest
}

export function normalizeAudioRequest(
  input: AudioGenerationInput,
  defaults: MediaRouterDefaults | undefined,
): NormalizedAudioGenerationRequest {
  if (typeof input === "string") {
    return normalizeAudioRequest({ text: input }, defaults)
  }
  const profile = profileDefaults(defaults, profileName(input))
  assertProfileMatchesType(profile, "audio", profileName(input))
  if (hasRequestInput(input)) {
    assertInputMatchesType(input, "audio")
    const request = omitIntentFields(input)
    return applyRequestDefaults(
      { ...request, type: "audio" } as AudioGenerationRequest,
      defaults,
      profile,
    ) as NormalizedAudioGenerationRequest
  }
  const intent = input as AudioGenerationIntent

  const options = mergeDefinedRecords(
    resolvedOptions(defaults, "audio", profile),
    {
      duration: intent.duration,
      seed: intent.seed,
      voice: intent.voice,
      format: intent.format,
      sampleRate: intent.sampleRate,
    },
    intent.options,
  )
  const providerOptions = mergeDefinedRecords(
    resolvedProviderOptions(defaults, "audio", profile),
    intent.providerOptions,
  )

  return stripUndefined({
    type: "audio",
    provider: requiredProvider(intent.provider, defaults, "audio", profile),
    model: requiredModel(intent.model, defaults, "audio", profile),
    action: intent.action ?? profile?.action,
    input: stripUndefined({
      prompt: intent.prompt,
      text: intent.text,
      audio: mediaField(intent.audio),
      audios: mergeMediaInputs(mediaFields(intent.audios), mediaInputs(intent.media)),
    }),
    options,
    providerOptions,
  }) as NormalizedAudioGenerationRequest
}

export function normalizeModel3DRequest(
  input: Model3DGenerationInput,
  defaults: MediaRouterDefaults | undefined,
): NormalizedModel3DGenerationRequest {
  if (typeof input === "string") {
    return normalizeModel3DRequest({ prompt: input }, defaults)
  }
  const profile = profileDefaults(defaults, profileName(input))
  assertProfileMatchesType(profile, "model3d", profileName(input))
  if (hasRequestInput(input)) {
    assertInputMatchesType(input, "model3d")
    const request = omitIntentFields(input)
    return applyRequestDefaults(
      { ...request, type: "model3d" } as Model3DGenerationRequest,
      defaults,
      profile,
    ) as NormalizedModel3DGenerationRequest
  }
  const intent = input as Model3DGenerationIntent

  const options = mergeDefinedRecords(
    resolvedOptions(defaults, "model3d", profile),
    {
      format: intent.format,
      quality: intent.quality,
      texture: intent.texture,
      seed: intent.seed,
    },
    intent.options,
  )
  const providerOptions = mergeDefinedRecords(
    resolvedProviderOptions(defaults, "model3d", profile),
    intent.providerOptions,
  )

  return stripUndefined({
    type: "model3d",
    provider: requiredProvider(intent.provider, defaults, "model3d", profile),
    model: requiredModel(intent.model, defaults, "model3d", profile),
    action: intent.action ?? profile?.action,
    input: stripUndefined({
      prompt: intent.prompt,
      images: mergeMediaInputs(mediaFields(intent.images), mediaInputs(intent.media)),
      model: mediaField(intent.sourceModel),
    }),
    options,
    providerOptions,
  }) as NormalizedModel3DGenerationRequest
}

export function isNormalizedImageRequest(
  request: NormalizedGenerationRequest,
): request is NormalizedImageGenerationRequest {
  return request.type === "image"
}

export function normalizeMediaRouterDefaults(
  defaults: MediaRouterDefaults | undefined,
): NormalizedMediaRouterDefaults | undefined {
  if (!defaults) return undefined
  const providers = normalizeDefaultValueMap(defaults, "provider", defaults.providers)
  const models = normalizeDefaultValueMap(defaults, "model", defaults.models)
  const options = normalizeDefaultRecordMap(defaults, "options", defaults.options)
  const providerOptions = normalizeDefaultRecordMap(
    defaults,
    "providerOptions",
    defaults.providerOptions,
  )
  const {
    profiles: _profiles,
    image: _image,
    video: _video,
    audio: _audio,
    model3d: _model3d,
    ...rest
  } = defaults

  return stripUndefined({
    ...rest,
    providers: nonEmptyMap(providers),
    models: nonEmptyMap(models),
    options: nonEmptyMap(options),
    providerOptions: nonEmptyMap(providerOptions),
    profiles: normalizeProfileMap(defaults.profiles),
  }) as NormalizedMediaRouterDefaults
}

export function resolveMediaRouterProfile(
  defaults: MediaRouterDefaults | undefined,
  profile: string | undefined,
): MediaRouterProfile | undefined {
  if (!profile) return undefined
  const profiles = defaults?.profiles
  if (profiles && Object.prototype.hasOwnProperty.call(profiles, profile)) {
    return normalizeMediaRouterProfile(profiles[profile])
  }
  throwBadRequest(`Unknown profile: ${profile}`)
}

function applyRequestDefaults<T extends GenerationRequest>(
  request: T,
  defaults: MediaRouterDefaults | undefined,
  profile: MediaRouterProfile | undefined,
): T & { profile?: never } {
  const type = request.type
  const provider = requiredProvider(request.provider, defaults, type, profile)
  const model = requiredModel(request.model, defaults, type, profile)
  return stripUndefined({
    ...request,
    provider,
    model,
    action: request.action ?? profile?.action,
    options: mergeDefinedRecords(
      resolvedOptions(defaults, type, profile),
      request.options,
    ),
    providerOptions: mergeDefinedRecords(
      resolvedProviderOptions(defaults, type, profile),
      request.providerOptions,
    ),
  }) as T & { profile?: never }
}

function hasRequestInput(
  input: Exclude<GenerationInput, string>,
): input is StructuredGenerationInput & { input: unknown } {
  return "input" in input
}

function profileName(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  if (!("profile" in input)) return undefined
  return typeof input.profile === "string" ? input.profile : undefined
}

function profileDefaults(
  defaults: MediaRouterDefaults | undefined,
  profile: string | undefined,
): MediaRouterProfile | undefined {
  return resolveMediaRouterProfile(defaults, profile)
}

function normalizeProfileMap(
  profiles: Record<string, MediaRouterProfile> | undefined,
): Record<string, MediaRouterProfile> | undefined {
  if (!profiles) return undefined
  return nonEmptyObject(
    Object.fromEntries(
      Object.entries(profiles).map(([name, profile]) => [
        name,
        normalizeMediaRouterProfile(profile),
      ]),
    ),
  )
}

function normalizeMediaRouterProfile(profile: MediaRouterProfile): MediaRouterProfile {
  const {
    type,
    provider,
    model,
    action,
    options,
    providerOptions,
    ...optionShorthand
  } = profile
  return stripUndefined({
    type,
    provider,
    model,
    action,
    options: mergeDefinedRecords(optionShorthand, options),
    providerOptions: cleanRecord(providerOptions),
  }) as MediaRouterProfile
}

function assertProfileMatchesType(
  profile: MediaRouterProfile | undefined,
  mediaType: GenerationMediaType,
  profileNameValue: string | undefined,
): void {
  if (!profile?.type || profile.type === mediaType) return
  throwBadRequest(
    `Profile ${profileNameValue ?? "(inline)"} resolves to ${profile.type}, not ${mediaType}`,
  )
}

function assertInputMatchesType(
  input: Partial<GenerationRequest>,
  mediaType: GenerationMediaType,
): void {
  if (!input.type || input.type === mediaType) return
  throwBadRequest(`Request type ${input.type} cannot be used with ${mediaType} facade`)
}

function omitIntentFields<T extends object>(input: T): Omit<T, "profile"> {
  const { profile: _profile, ...request } = input as T & { profile?: unknown }
  return request
}

function mediaInputs(input: MediaIntentInput | undefined): MediaInput[] | undefined {
  if (!input) return undefined
  return (Array.isArray(input) ? input : [input]).map(mediaIntentItem)
}

function mediaInputsByKind(
  input: MediaIntentInput | undefined,
  kind: "image" | "video" | "audio",
): MediaInput[] | undefined {
  const media = mediaInputs(input)
  if (!media?.length) return undefined
  const matches = media.filter((item) => mediaInputKind(item, kind) === kind)
  return matches.length ? matches : undefined
}

function mediaInputKind(
  input: MediaInput,
  fallback: "image" | "video" | "audio",
): "image" | "video" | "audio" {
  const mimeType = input.mimeType?.toLowerCase()
  if (mimeType?.startsWith("video/")) return "video"
  if (mimeType?.startsWith("audio/")) return "audio"
  if (mimeType?.startsWith("image/")) return "image"
  return fallback
}

function mediaIntentItem(input: MediaIntentItem): MediaInput {
  if (typeof input !== "string") return input
  if (isUrlLike(input)) {
    return stripUndefined({
      url: input,
      mimeType: mimeTypeFromUrl(input),
    }) as MediaInput
  }
  return stripUndefined({
    type: "file",
    path: input,
    mimeType: mimeTypeFromUrl(input),
  }) as MediaInput
}

function mediaField(input: MediaFieldInput | undefined): MediaInput | undefined {
  if (input === undefined) return undefined
  return mediaIntentItem(input)
}

function mediaFields(input: MediaFieldInput[] | undefined): MediaInput[] | undefined {
  if (!input?.length) return undefined
  return input.map(mediaIntentItem)
}

function mediaFieldList(input: MediaFieldInput | undefined): MediaInput[] | undefined {
  const media = mediaField(input)
  return media ? [media] : undefined
}

function isUrlLike(value: string): boolean {
  if (/^[a-z]:[\\/]/i.test(value)) return false
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")
}

function mimeTypeFromUrl(url: string): string | undefined {
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? ""
  const extension = path.match(/\.([a-z0-9]+)$/)?.[1]
  if (!extension) return undefined
  return mimeTypesByExtension[extension]
}

const mimeTypesByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
}

function mediaTail(inputs: MediaInput[] | undefined): MediaInput[] | undefined {
  const tail = inputs?.slice(1)
  return tail?.length ? tail : undefined
}

function mergeMediaInputs(
  explicit: MediaInput[] | undefined,
  shorthand: MediaInput[] | undefined,
): MediaInput[] | undefined {
  if (!explicit?.length) return shorthand?.length ? shorthand : undefined
  if (!shorthand?.length) return explicit
  return [...explicit, ...shorthand]
}

function mergeMediaInputGroups(
  ...groups: Array<MediaInput[] | undefined>
): MediaInput[] | undefined {
  const merged = groups.flatMap((group) => group ?? [])
  return merged.length ? merged : undefined
}

function resolvedProvider(
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
  profile: MediaRouterProfile | undefined,
): string | undefined {
  return (
    profile?.provider ??
    mediaDefaultSlot(defaults, mediaType)?.provider ??
    defaults?.providers?.[mediaType] ??
    defaults?.provider
  )
}

function requiredProvider(
  explicit: string | undefined,
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
  profile: MediaRouterProfile | undefined,
): string {
  const provider = explicit ?? resolvedProvider(defaults, mediaType, profile)
  if (provider) return provider
  throwBadRequest(`Missing provider for ${mediaType} request`)
}

function resolvedModel(
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
  profile: MediaRouterProfile | undefined,
): string | undefined {
  return (
    profile?.model ??
    mediaDefaultSlot(defaults, mediaType)?.model ??
    defaults?.models?.[mediaType] ??
    defaults?.model
  )
}

function requiredModel(
  explicit: string | undefined,
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
  profile: MediaRouterProfile | undefined,
): string {
  const model = explicit ?? resolvedModel(defaults, mediaType, profile)
  if (model) return model
  throwBadRequest(`Missing model for ${mediaType} request`)
}

function resolvedOptions(
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
  profile: MediaRouterProfile | undefined,
): Record<string, unknown> | undefined {
  return mergeDefinedRecords(
    mediaDefaults(defaults?.options, mediaType),
    mediaDefaultSlotOptions(defaults, mediaType),
    profile?.options,
  )
}

function resolvedProviderOptions(
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
  profile: MediaRouterProfile | undefined,
): Record<string, unknown> | undefined {
  return mergeDefinedRecords(
    mediaDefaults(defaults?.providerOptions, mediaType),
    mediaDefaultSlot(defaults, mediaType)?.providerOptions,
    profile?.providerOptions,
  )
}

function normalizeDefaultValueMap<TSlotKey extends "provider" | "model">(
  defaults: MediaRouterDefaults,
  slotKey: TSlotKey,
  legacyMap:
    | Partial<Record<GenerationMediaType, MediaRouterDefaultSlotObject[TSlotKey]>>
    | undefined,
): Partial<Record<GenerationMediaType, MediaRouterDefaultSlotObject[TSlotKey]>> {
  return Object.fromEntries(
    (["image", "video", "audio", "model3d"] as GenerationMediaType[])
      .map((mediaType) => [
        mediaType,
        mediaDefaultSlot(defaults, mediaType)?.[slotKey] ?? legacyMap?.[mediaType],
      ])
      .filter(([, value]) => value !== undefined),
  ) as Partial<Record<GenerationMediaType, MediaRouterDefaultSlotObject[TSlotKey]>>
}

function normalizeDefaultRecordMap<TSlotKey extends "options" | "providerOptions">(
  defaults: MediaRouterDefaults,
  slotKey: TSlotKey,
  legacyMap: Partial<Record<GenerationMediaType, Record<string, unknown>>> | undefined,
): Partial<Record<GenerationMediaType, Record<string, unknown>>> {
  return Object.fromEntries(
    (["image", "video", "audio", "model3d"] as GenerationMediaType[])
      .map((mediaType) => [
        mediaType,
        normalizeDefaultSlotRecord(defaults, mediaType, slotKey, legacyMap),
      ])
      .filter(([, value]) => value !== undefined),
  ) as Partial<Record<GenerationMediaType, Record<string, unknown>>>
}

function normalizeDefaultSlotRecord<TSlotKey extends "options" | "providerOptions">(
  defaults: MediaRouterDefaults,
  mediaType: GenerationMediaType,
  slotKey: TSlotKey,
  legacyMap: Partial<Record<GenerationMediaType, Record<string, unknown>>> | undefined,
): Record<string, unknown> | undefined {
  const slotValue =
    slotKey === "options"
      ? mediaDefaultSlotOptions(defaults, mediaType)
      : mediaDefaultSlot(defaults, mediaType)?.providerOptions
  return mergeDefinedRecords(legacyMap?.[mediaType], slotValue)
}

function mediaDefaults<T>(
  defaults: Partial<Record<GenerationMediaType, T>> | undefined,
  mediaType: GenerationMediaType,
): T | undefined {
  return defaults?.[mediaType]
}

function mediaDefaultSlot(
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
): MediaRouterDefaultSlotObject | undefined {
  const slot = defaults?.[mediaType]
  if (slot === undefined) return undefined
  return typeof slot === "string" ? { model: slot } : slot
}

function mediaDefaultSlotOptions(
  defaults: MediaRouterDefaults | undefined,
  mediaType: GenerationMediaType,
): Record<string, unknown> | undefined {
  const slot = mediaDefaultSlot(defaults, mediaType)
  if (!slot) return undefined
  const {
    provider: _provider,
    model: _model,
    options,
    providerOptions: _providerOptions,
    ...optionShorthand
  } = slot
  return mergeDefinedRecords(optionShorthand, options)
}

function mergeDefinedRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged = Object.assign(
    {},
    ...records.map((record) => cleanRecord(record) ?? {}),
  )
  return nonEmptyObject(merged)
}

function cleanRecord(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return record ? nonEmptyObject(record) : undefined
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

function nonEmptyObject<T extends Record<string, unknown>>(value: T): T | undefined {
  const stripped = stripUndefined(value)
  return Object.keys(stripped).length ? stripped : undefined
}

function nonEmptyMap<T extends object>(value: T): T | undefined {
  return Object.keys(value).length ? value : undefined
}

function throwBadRequest(message: string): never {
  throw new MediaRouterException(
    createMediaRouterError("BAD_REQUEST", message, {
      provider: "router",
    }),
  )
}
