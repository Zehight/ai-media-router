import {
  completed,
  defineHttpProvider,
} from "../http.js"
import {
  describeMediaInput,
  getImageInputs,
  mediaInputToInlineBase64,
} from "../toolkit.js"
import { googleModels } from "./definition.js"

type GoogleResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inlineData?: { mimeType?: string; data?: string }
      }>
    }
  }>
  error?: { message?: string }
}

export const googleProvider = defineHttpProvider<GoogleResponse>({
  id: "google",
  displayName: "Google GenAI",
  baseURL: "https://generativelanguage.googleapis.com/v1beta",
  auth: { type: "api-key", in: "query", query: "key" },
  models: googleModels,
  create: {
    request: {
      method: "POST",
      path: (context) =>
        googleGeneratePath(context.config.options, context.request.model),
      body: (context) => {
        const dimensions = context.resolved.dimensions
        return {
          contents: [
            {
              role: "user",
              parts: [
                { text: context.request.input.prompt },
                ...getImageInputs(context.request).map(googleMediaPart),
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: {
              aspectRatio: dimensions?.aspectRatio,
              resolution: dimensions?.resolutionTier,
            },
          },
          ...context.request.providerOptions,
        }
      },
      parseResponse: ({ text }) => parseGoogleResponse(text),
      parseError: ({ text }) => parseGoogleResponse(text),
    },
    output: (response, context) => {
      const parts = response.candidates?.flatMap(
        (candidate) => candidate.content?.parts ?? [],
      )

      return completed({
        context,
        assets:
          parts
            ?.filter((part) => part.inlineData?.data)
            .map((part) => ({
              type: "image" as const,
              base64: part.inlineData?.data,
              mimeType: part.inlineData?.mimeType,
            })) ?? [],
        raw: response,
      })
    },
  },
})

function googleMediaPart(input: ReturnType<typeof getImageInputs>[number]) {
  const inline = mediaInputToInlineBase64(input)
  if (inline) {
    return {
      inlineData: {
        data: inline.data,
        mimeType: inline.mimeType,
      },
    }
  }

  const described = describeMediaInput(input)
  if (described.kind === "url") {
    return {
      fileData: {
        fileUri: described.url,
        mimeType: described.mimeType,
      },
    }
  }
  if (described.kind === "file") {
    return {
      fileData: {
        fileUri: described.path,
        mimeType: described.mimeType,
      },
    }
  }

  throw new Error(`Unsupported Google media input kind: ${described.kind}`)
}

function googleGeneratePath(
  options: Record<string, unknown> | undefined,
  model: string,
): string {
  const apiVersionPath =
    typeof options?.apiVersionPath === "string"
      ? options.apiVersionPath.replace(/^\/+|\/+$/g, "")
      : ""
  const generationMethod =
    typeof options?.generationMethod === "string"
      ? options.generationMethod
      : "generateContent"
  const modelPath = model.startsWith("models/") ? model : `models/${model}`
  return `${apiVersionPath ? `/${apiVersionPath}` : ""}/${modelPath}:${generationMethod}`
}

function parseGoogleResponse(text: string): GoogleResponse {
  if (!text.trim()) {
    return {}
  }
  if (!text.trimStart().startsWith("data:")) {
    return JSON.parse(text)
  }
  const events = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => JSON.parse(line) as GoogleResponse)
  if (events.length === 0) {
    return {}
  }
  if (events.length === 1) {
    return events[0]
  }
  const last = events[events.length - 1]
  return {
    ...last,
    candidates: events.flatMap((event) => event.candidates ?? []),
  }
}
