import { throwMediaRouterError } from "./errors.js"
import type { ModelDefinition, ModelMode } from "./provider.js"
import type { GenerationRequest, MediaInput } from "./types.js"

export type RequestValidationInput = {
  request: GenerationRequest
  model?: ModelDefinition
}

export function inferModelMode(request: GenerationRequest): ModelMode {
  const input = request.input as {
    images?: MediaInput[]
    mask?: MediaInput
    image?: MediaInput
    firstFrame?: MediaInput
    lastFrame?: MediaInput
    video?: MediaInput
    videos?: MediaInput[]
    audio?: MediaInput
    audios?: MediaInput[]
  }
  if ((request.type ?? "image") === "image") {
    return input.images?.length || input.mask
      ? "image-to-image"
      : "text-to-image"
  }

  if (input.audio || input.audios?.length) return "audio-to-video"
  if (input.video || input.videos?.length) return "video-to-video"
  if (
    input.image ||
    input.images?.length ||
    input.firstFrame ||
    input.lastFrame
  ) {
    return "image-to-video"
  }
  return "text-to-video"
}

export function validateGenerationRequest(input: RequestValidationInput): void {
  const { request, model } = input
  if (!model) {
    throwMediaRouterError("BAD_REQUEST", `Unknown model: ${request.model}`, {
      provider: request.provider,
      model: request.model,
    })
  }

  const requestType = request.type ?? model.type
  if (requestType !== model.type) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} generates ${model.type}, not ${requestType}`,
      { provider: request.provider, model: request.model },
    )
  }

  const mode = inferModelMode({ ...request, type: requestType } as GenerationRequest)
  if (!model.modes.includes(mode)) {
    throwMediaRouterError("BAD_REQUEST", `Model ${model.id} does not support ${mode}`, {
      provider: request.provider,
      model: request.model,
    })
  }

  validateCommonCapabilities(request, model)
  if (requestType === "image") validateImageCapabilities(request, model)
  if (requestType === "video") validateVideoCapabilities(request, model)
}

function validateCommonCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  if (request.options?.seed != null && model.capabilities?.supportsSeed === false) {
    throwMediaRouterError("BAD_REQUEST", `Model ${model.id} does not support seed`, {
      provider: request.provider,
      model: request.model,
    })
  }
  if (
    request.options?.webhookUrl &&
    model.capabilities?.supportsWebhook === false
  ) {
    throwMediaRouterError("BAD_REQUEST", `Model ${model.id} does not support webhook`, {
      provider: request.provider,
      model: request.model,
    })
  }
}

function validateImageCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  const count = "count" in (request.options ?? {}) ? request.options?.count ?? 1 : 1
  const countCapability = model.capabilities?.count
  const maxCount = countCapability?.max ?? 1
  if (count < 1) {
    throwMediaRouterError("BAD_REQUEST", "Image count must be at least 1", {
      provider: request.provider,
      model: request.model,
    })
  }
  if (count > maxCount && countCapability?.strategy !== "split") {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} supports at most ${maxCount} image(s)`,
      { provider: request.provider, model: request.model },
    )
  }

  const maxImages = model.capabilities?.maxImages
  if (maxImages != null && countMediaInputs(request.input.images) > maxImages) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} supports at most ${maxImages} input image(s)`,
      { provider: request.provider, model: request.model },
    )
  }
}

function validateVideoCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  const input = request.input as {
    images?: MediaInput[]
    image?: MediaInput
    firstFrame?: MediaInput
    lastFrame?: MediaInput
    video?: MediaInput
    videos?: MediaInput[]
  }
  const duration = request.options?.duration
  if (
    duration != null &&
    model.capabilities?.durations?.length &&
    !model.capabilities.durations.includes(duration)
  ) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} does not support ${duration}s duration`,
      { provider: request.provider, model: request.model },
    )
  }

  const fps = request.options?.fps
  if (
    fps != null &&
    model.capabilities?.fps?.length &&
    !model.capabilities.fps.includes(fps)
  ) {
    throwMediaRouterError("BAD_REQUEST", `Model ${model.id} does not support ${fps} fps`, {
      provider: request.provider,
      model: request.model,
    })
  }

  const maxImages = model.capabilities?.maxImages
  if (maxImages != null) {
    const inputCount =
      countMediaInputs(input.images) +
      countMediaInputs([
        input.image,
        input.firstFrame,
        input.lastFrame,
      ])
    if (inputCount > maxImages) {
      throwMediaRouterError(
        "BAD_REQUEST",
        `Model ${model.id} supports at most ${maxImages} input image(s)`,
        { provider: request.provider, model: request.model },
      )
    }
  }

  const maxVideos = model.capabilities?.maxVideos
  if (
    maxVideos != null &&
    countMediaInputs(input.videos) + countMediaInputs([input.video]) >
      maxVideos
  ) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} supports at most ${maxVideos} input video(s)`,
      { provider: request.provider, model: request.model },
    )
  }
}

function countMediaInputs(inputs: Array<MediaInput | undefined> | undefined): number {
  return inputs?.filter(Boolean).length ?? 0
}
