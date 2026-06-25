export {
  completed,
  defineHttpProvider,
  pendingJob,
  pendingProviderJob,
  pendingStatus,
  polledJob,
  providerError,
  statusFrom,
  stripUndefined,
} from "./http.js"
export type { HttpProviderDefinition } from "./http.js"
export type {
  BodySerializationInput,
  HttpCancelRequestSpec,
  HttpCreateRequestSpec,
  HttpOutputHelpers,
  HttpPollRequestSpec,
  HttpResponseParseInput,
  MissingStatusStrategy,
  UnknownStatusStrategy,
} from "./http.js"
export {
  appendPromptFlags,
  assetFromUrl,
  assetsFromImageData,
  collectMediaInputs,
  describeMediaInput,
  firstDefined,
  firstImageInput,
  firstMediaInput,
  getAudioInputs,
  getImageInputs,
  getOutputMimeType,
  getPrompt,
  getVideoInputs,
  isImageRequest,
  isVideoRequest,
  mediaInputToInlineBase64,
  requestMediaType,
} from "./toolkit.js"
export type {
  CollectedMediaInput,
  DescribedMediaInput,
  InlineBase64MediaInput,
  MediaInputRole,
} from "./toolkit.js"
export { googleProvider } from "./google/index.js"
export { openaiProvider } from "./openai/index.js"
export { volcengineProvider } from "./volcengine/index.js"

import type { ProviderPlugin } from "@media-router/core"
import { googleProvider } from "./google/index.js"
import { openaiProvider } from "./openai/index.js"
import { volcengineProvider } from "./volcengine/index.js"

export const builtinProviderPlugins = {
  openai: openaiProvider,
  google: googleProvider,
  volcengine: volcengineProvider,
} satisfies Record<string, ProviderPlugin>
