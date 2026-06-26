import { throwMediaRouterError } from "./errors.js"
import type { ModelDefinition } from "./provider.js"
import type { GenerationRequest, MediaInput } from "./types.js"

export type RequestValidationInput = {
  request: GenerationRequest
  model?: ModelDefinition
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

  validateCommonCapabilities(request, model)
  if (requestType === "image") validateImageCapabilities(request, model)
  if (requestType === "video") validateVideoCapabilities(request, model)
  if (requestType === "audio") validateAudioCapabilities(request, model)
  if (requestType === "model3d") validateModel3DCapabilities(request, model)
}

function validateCommonCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  const options = request.options as
    | {
        width?: number
        height?: number
        seed?: number
      }
    | undefined
  validatePositiveFiniteOption(request, "width", options?.width)
  validatePositiveFiniteOption(request, "height", options?.height)
  validateFiniteOption(request, "seed", options?.seed)
  if (request.options?.seed != null && model.capabilities?.supportsSeed === false) {
    throwMediaRouterError("BAD_REQUEST", `Model ${model.id} does not support seed`, {
      provider: request.provider,
      model: request.model,
    })
  }
}

function validateImageCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  const input = request.input as { images?: MediaInput[] }
  const options = request.options as { count?: number } | undefined
  const count = "count" in (options ?? {}) ? options?.count ?? 1 : 1
  const countCapability = model.capabilities?.count
  const maxCount = countCapability?.max ?? 1
  if (!isPositiveInteger(count)) {
    throwMediaRouterError("BAD_REQUEST", "Image count must be a positive integer", {
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
  if (maxImages != null && countMediaInputs(input.images) > maxImages) {
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
  const options = request.options as
    | {
        duration?: number
        fps?: number
      }
    | undefined
  const duration = options?.duration
  if (duration != null && !isPositiveFiniteNumber(duration)) {
    throwMediaRouterError("BAD_REQUEST", "Video duration must be positive", {
      provider: request.provider,
      model: request.model,
    })
  }
  const maxDuration = model.capabilities?.dimensions?.video?.maxDuration
  if (duration != null && maxDuration != null && duration > maxDuration) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} supports at most ${maxDuration}s duration`,
      { provider: request.provider, model: request.model },
    )
  }
  const durations =
    model.capabilities?.durations ?? model.capabilities?.dimensions?.video?.durations
  if (duration != null && durations?.length && !durations.includes(duration)) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} does not support ${duration}s duration`,
      { provider: request.provider, model: request.model },
    )
  }

  const fps = options?.fps
  if (fps != null && !isPositiveFiniteNumber(fps)) {
    throwMediaRouterError("BAD_REQUEST", "Video fps must be positive", {
      provider: request.provider,
      model: request.model,
    })
  }
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

function validateAudioCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  const input = request.input as {
    audio?: MediaInput
    audios?: MediaInput[]
  }
  const options = request.options as
    | {
        duration?: number
        sampleRate?: number
      }
    | undefined
  validatePositiveFiniteOption(request, "Audio duration", options?.duration)
  validatePositiveFiniteOption(request, "Audio sampleRate", options?.sampleRate)

  const maxAudios = model.capabilities?.maxAudios
  if (
    maxAudios != null &&
    countMediaInputs(input.audios) + countMediaInputs([input.audio]) > maxAudios
  ) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} supports at most ${maxAudios} input audio(s)`,
      { provider: request.provider, model: request.model },
    )
  }
}

function validateModel3DCapabilities(
  request: GenerationRequest,
  model: ModelDefinition,
): void {
  const input = request.input as {
    images?: MediaInput[]
  }
  const maxImages = model.capabilities?.maxImages
  if (maxImages != null && countMediaInputs(input.images) > maxImages) {
    throwMediaRouterError(
      "BAD_REQUEST",
      `Model ${model.id} supports at most ${maxImages} input image(s)`,
      { provider: request.provider, model: request.model },
    )
  }
}

function countMediaInputs(inputs: Array<MediaInput | undefined> | undefined): number {
  return inputs?.filter(Boolean).length ?? 0
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1
}

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function validatePositiveFiniteOption(
  request: GenerationRequest,
  name: string,
  value: number | undefined,
): void {
  if (value == null) return
  if (isPositiveFiniteNumber(value)) return
  throwMediaRouterError("BAD_REQUEST", `${name} must be positive`, {
    provider: request.provider,
    model: request.model,
  })
}

function validateFiniteOption(
  request: GenerationRequest,
  name: string,
  value: number | undefined,
): void {
  if (value == null) return
  if (Number.isFinite(value)) return
  throwMediaRouterError("BAD_REQUEST", `${name} must be finite`, {
    provider: request.provider,
    model: request.model,
  })
}
