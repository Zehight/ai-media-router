import { describe, expect, it } from "vitest"
import {
  normalizeAudioRequest,
  normalizeGenerationRequest,
  normalizeImageRequest,
  normalizeMediaRouterDefaults,
  normalizeModel3DRequest,
  normalizeVideoRequest,
  type MediaRouterDefaults,
} from "./normalize.js"

const defaults = {
  provider: "defaultProvider",
  models: {
    image: "default-image",
    video: "default-video",
    audio: "default-audio",
    model3d: "default-model3d",
  },
  options: {
    image: {
      width: 1024,
      height: 1024,
      count: 1,
    },
  },
  providerOptions: {
    image: {
      watermark: false,
    },
  },
  profiles: {
    hdImage: {
      type: "image",
      model: "hd-image",
      options: {
        width: 2048,
        height: 2048,
        quality: "high",
      },
      providerOptions: {
        watermark: true,
      },
    },
    videoFast: {
      type: "video",
      model: "video-fast",
    },
  },
} satisfies MediaRouterDefaults

describe("request normalization", () => {
  it("canonicalizes media default slots into internal maps", () => {
    const normalized = normalizeMediaRouterDefaults({
      providers: {
        image: "legacyProvider",
      },
      models: {
        image: "legacy-image",
      },
      options: {
        image: {
          width: 1024,
          count: 1,
        },
      },
      providerOptions: {
        image: {
          watermark: true,
          region: "us",
        },
      },
      image: {
        provider: "slotProvider",
        model: "slot-image",
        options: { width: 1536, height: 1536 },
        providerOptions: { watermark: false },
      },
    })

    expect(normalized).toMatchObject({
      providers: { image: "slotProvider" },
      models: { image: "slot-image" },
      options: { image: { width: 1536, height: 1536, count: 1 } },
      providerOptions: { image: { watermark: false, region: "us" } },
    })
    expect(normalized).not.toHaveProperty("image")
  })

  it("treats unknown media default slot fields as option shorthand", () => {
    const normalized = normalizeMediaRouterDefaults({
      provider: "defaultProvider",
      models: {
        image: "default-image",
      },
      image: {
        width: 1536,
        height: 1536,
        quality: "draft",
        options: { height: 1024 },
      },
    })

    expect(normalized).toMatchObject({
      options: {
        image: {
          width: 1536,
          height: 1024,
          quality: "draft",
        },
      },
    })

    expect(
      normalizeImageRequest("a clean product render", normalized),
    ).toMatchObject({
      options: {
        width: 1536,
        height: 1024,
        quality: "draft",
      },
    })
  })

  it("treats unknown profile fields as option shorthand", () => {
    const profileDefaults = {
      provider: "defaultProvider",
      models: {
        image: "default-image",
      },
      profiles: {
        hdImage: {
          type: "image",
          width: 2048,
          height: 2048,
          quality: "high",
          options: { height: 1536 },
          providerOptions: { moderation: "strict" },
        },
      },
    } satisfies MediaRouterDefaults

    expect(normalizeMediaRouterDefaults(profileDefaults)).toMatchObject({
      profiles: {
        hdImage: {
          type: "image",
          options: {
            width: 2048,
            height: 1536,
            quality: "high",
          },
          providerOptions: { moderation: "strict" },
        },
      },
    })

    expect(
      normalizeImageRequest(
        {
          profile: "hdImage",
          prompt: "a clean product render",
          width: 1024,
        },
        profileDefaults,
      ),
    ).toMatchObject({
      options: {
        width: 1024,
        height: 1536,
        quality: "high",
      },
      providerOptions: { moderation: "strict" },
    })
  })

  it("turns a prompt string into a default image request", () => {
    expect(normalizeImageRequest("a clean product render", defaults)).toMatchObject({
      type: "image",
      provider: "defaultProvider",
      model: "default-image",
      input: { prompt: "a clean product render" },
      options: { width: 1024, height: 1024, count: 1 },
      providerOptions: { watermark: false },
    })
  })

  it("accepts unified media shorthand for image references", () => {
    expect(
      normalizeImageRequest(
        {
          prompt: "make this product photo cleaner",
          media: { url: "https://example.com/reference.png", mimeType: "image/png" },
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        prompt: "make this product photo cleaner",
        images: [{ url: "https://example.com/reference.png", mimeType: "image/png" }],
      },
    })
  })

  it("accepts a single image field as the first image reference", () => {
    expect(
      normalizeImageRequest(
        {
          prompt: "make this product photo cleaner",
          image: "./primary.png",
          images: ["https://example.com/secondary.webp"],
          media: "https://example.com/extra.jpg",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        prompt: "make this product photo cleaner",
        images: [
          { type: "file", path: "./primary.png", mimeType: "image/png" },
          { url: "https://example.com/secondary.webp", mimeType: "image/webp" },
          { url: "https://example.com/extra.jpg", mimeType: "image/jpeg" },
        ],
      },
    })
  })

  it("accepts media URL strings and infers common MIME types", () => {
    expect(
      normalizeImageRequest(
        {
          prompt: "make this product photo cleaner",
          media: "https://example.com/reference.webp?token=abc",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        images: [{ url: "https://example.com/reference.webp?token=abc", mimeType: "image/webp" }],
      },
    })

    expect(
      normalizeImageRequest(
        {
          prompt: "make this product photo cleaner",
          media: "./reference.png",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        images: [{ type: "file", path: "./reference.png", mimeType: "image/png" }],
      },
    })

    expect(
      normalizeImageRequest(
        {
          prompt: "make this product photo cleaner",
          media: "C:\\tmp\\reference.png",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        images: [{ type: "file", path: "C:\\tmp\\reference.png", mimeType: "image/png" }],
      },
    })
  })

  it("accepts string media fields as URLs or local files", () => {
    expect(
      normalizeImageRequest(
        {
          prompt: "mask this product",
          mask: "./mask.png",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        mask: { type: "file", path: "./mask.png", mimeType: "image/png" },
      },
    })

    expect(
      normalizeVideoRequest(
        {
          prompt: "animate this product",
          image: "https://example.com/product.png",
          audio: "./music.mp3",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        image: { url: "https://example.com/product.png", mimeType: "image/png" },
        audio: { type: "file", path: "./music.mp3", mimeType: "audio/mpeg" },
      },
    })

    expect(
      normalizeModel3DRequest(
        {
          prompt: "refine this mesh",
          sourceModel: "/tmp/source.glb",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        model: { type: "file", path: "/tmp/source.glb" },
      },
    })
  })

  it("accepts repeated media fields as URL or local file strings", () => {
    expect(
      normalizeImageRequest(
        {
          prompt: "combine these references",
          images: ["./reference.png", "https://example.com/style.webp"],
          media: "https://example.com/extra.jpg",
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        images: [
          { type: "file", path: "./reference.png", mimeType: "image/png" },
          { url: "https://example.com/style.webp", mimeType: "image/webp" },
          { url: "https://example.com/extra.jpg", mimeType: "image/jpeg" },
        ],
      },
    })

    expect(
      normalizeVideoRequest(
        {
          prompt: "combine this footage and audio",
          videos: ["./source.mp4"],
          audios: ["https://example.com/music.mp3"],
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        videos: [{ type: "file", path: "./source.mp4", mimeType: "video/mp4" }],
        audios: [{ url: "https://example.com/music.mp3", mimeType: "audio/mpeg" }],
      },
    })
  })

  it("routes unified media shorthand into media-specific video inputs", () => {
    expect(
      normalizeVideoRequest(
        {
          prompt: "animate the product with music",
          media: [
            { url: "https://example.com/reference.png", mimeType: "image/png" },
            { url: "https://example.com/track.mp3", mimeType: "audio/mpeg" },
            { url: "https://example.com/source.mp4", mimeType: "video/mp4" },
          ],
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        prompt: "animate the product with music",
        images: [{ url: "https://example.com/reference.png", mimeType: "image/png" }],
        audios: [{ url: "https://example.com/track.mp3", mimeType: "audio/mpeg" }],
        video: { url: "https://example.com/source.mp4", mimeType: "video/mp4" },
      },
    })
  })

  it("routes media URL strings by inferred MIME type for video requests", () => {
    expect(
      normalizeVideoRequest(
        {
          prompt: "combine these clips",
          media: [
            "https://example.com/source.mp4",
            "https://example.com/music.wav",
            "https://example.com/style.png",
          ],
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        video: { url: "https://example.com/source.mp4", mimeType: "video/mp4" },
        audios: [{ url: "https://example.com/music.wav", mimeType: "audio/wav" }],
        images: [{ url: "https://example.com/style.png", mimeType: "image/png" }],
      },
    })
  })

  it("keeps extra unified video media as reference videos after the primary source", () => {
    expect(
      normalizeVideoRequest(
        {
          prompt: "combine these clips",
          media: [
            { url: "https://example.com/source.mp4", mimeType: "video/mp4" },
            { url: "https://example.com/extra.mp4", mimeType: "video/mp4" },
          ],
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        video: { url: "https://example.com/source.mp4", mimeType: "video/mp4" },
        videos: [{ url: "https://example.com/extra.mp4", mimeType: "video/mp4" }],
      },
    })
  })

  it("uses unknown unified video media as image references", () => {
    expect(
      normalizeVideoRequest(
        {
          prompt: "animate the product",
          media: { url: "https://example.com/reference" },
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        images: [{ url: "https://example.com/reference" }],
      },
    })
  })

  it("accepts unified media shorthand for audio and model3d inputs", () => {
    expect(
      normalizeAudioRequest(
        {
          text: "match the speaker style",
          media: { url: "https://example.com/sample.wav", mimeType: "audio/wav" },
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        text: "match the speaker style",
        audios: [{ url: "https://example.com/sample.wav", mimeType: "audio/wav" }],
      },
    })

    expect(
      normalizeModel3DRequest(
        {
          prompt: "turn this into a 3D product model",
          media: { url: "https://example.com/reference.png", mimeType: "image/png" },
        },
        defaults,
      ),
    ).toMatchObject({
      input: {
        prompt: "turn this into a 3D product model",
        images: [{ url: "https://example.com/reference.png", mimeType: "image/png" }],
      },
    })
  })

  it("keeps explicit request fields above router defaults", () => {
    expect(
      normalizeImageRequest(
        {
          prompt: "a clean product render",
          provider: "explicitProvider",
          model: "explicit-model",
          width: 1536,
          providerOptions: { watermark: true },
        },
        defaults,
      ),
    ).toMatchObject({
      provider: "explicitProvider",
      model: "explicit-model",
      options: { width: 1536, height: 1024, count: 1 },
      providerOptions: { watermark: true },
    })
  })

  it("accepts media default slots for minimal router configuration", () => {
    const slotDefaults = {
      provider: "defaultProvider",
      image: {
        model: "slot-image",
        options: { width: 1536, height: 1536, count: 1 },
        providerOptions: { watermark: false },
      },
      video: {
        provider: "videoProvider",
        model: "slot-video",
        options: { duration: 4 },
      },
      audio: {
        provider: "audioProvider",
        model: "slot-audio",
        options: { voice: "narrator" },
        providerOptions: { region: "us" },
      },
      model3d: {
        provider: "modelProvider",
        model: "slot-model3d",
        options: { format: "glb" },
        providerOptions: { mesh: "quad" },
      },
    } satisfies MediaRouterDefaults

    expect(normalizeImageRequest("a clean product render", slotDefaults)).toMatchObject({
      provider: "defaultProvider",
      model: "slot-image",
      options: { width: 1536, height: 1536, count: 1 },
      providerOptions: { watermark: false },
    })
    expect(normalizeVideoRequest("a product demo shot", slotDefaults)).toMatchObject({
      provider: "videoProvider",
      model: "slot-video",
      options: { duration: 4 },
    })
    expect(normalizeAudioRequest("hello world", slotDefaults)).toMatchObject({
      provider: "audioProvider",
      model: "slot-audio",
      options: { voice: "narrator" },
      providerOptions: { region: "us" },
    })
    expect(normalizeModel3DRequest("a walnut chair", slotDefaults)).toMatchObject({
      provider: "modelProvider",
      model: "slot-model3d",
      options: { format: "glb" },
      providerOptions: { mesh: "quad" },
    })
  })

  it("accepts media default slot strings as model shorthand", () => {
    const slotDefaults = {
      provider: "defaultProvider",
      image: "slot-image",
      video: "slot-video",
      audio: "slot-audio",
      model3d: "slot-model3d",
    } satisfies MediaRouterDefaults

    expect(normalizeImageRequest("a clean product render", slotDefaults)).toMatchObject({
      provider: "defaultProvider",
      model: "slot-image",
    })
    expect(normalizeVideoRequest("a product demo shot", slotDefaults)).toMatchObject({
      provider: "defaultProvider",
      model: "slot-video",
    })
    expect(normalizeAudioRequest("hello world", slotDefaults)).toMatchObject({
      provider: "defaultProvider",
      model: "slot-audio",
    })
    expect(normalizeModel3DRequest("a walnut chair", slotDefaults)).toMatchObject({
      provider: "defaultProvider",
      model: "slot-model3d",
    })
  })

  it("does not ignore empty media default slot strings", () => {
    expect(() =>
      normalizeImageRequest("a clean product render", {
        provider: "defaultProvider",
        image: "",
      }),
    ).toThrow("Missing model for image request")
  })

  it("applies profiles above media defaults", () => {
    expect(
      normalizeImageRequest(
        {
          profile: "hdImage",
          prompt: "a clean product render",
        },
        defaults,
      ),
    ).toMatchObject({
      provider: "defaultProvider",
      model: "hd-image",
      options: {
        width: 2048,
        height: 2048,
        count: 1,
        quality: "high",
      },
      providerOptions: { watermark: true },
    })
  })

  it("routes shorthand intents through non-image profiles", () => {
    expect(
      normalizeGenerationRequest(
        {
          profile: "videoFast",
          prompt: "a product demo shot",
          duration: 4,
        },
        defaults,
      ),
    ).toMatchObject({
      type: "video",
      provider: "defaultProvider",
      model: "video-fast",
      input: { prompt: "a product demo shot" },
      options: { duration: 4 },
    })
  })

  it("normalizes explicit audio intents", () => {
    expect(
      normalizeGenerationRequest(
        {
          type: "audio",
          text: "hello",
          voice: "narrator",
        },
        defaults,
      ),
    ).toMatchObject({
      type: "audio",
      provider: "defaultProvider",
      model: "default-audio",
      input: { text: "hello" },
      options: { voice: "narrator" },
    })
  })

  it("turns non-image facade strings into media-specific requests", () => {
    expect(normalizeVideoRequest("a product demo shot", defaults)).toMatchObject({
      type: "video",
      provider: "defaultProvider",
      model: "default-video",
      input: { prompt: "a product demo shot" },
    })
    expect(normalizeAudioRequest("hello world", defaults)).toMatchObject({
      type: "audio",
      provider: "defaultProvider",
      model: "default-audio",
      input: { text: "hello world" },
    })
    expect(normalizeModel3DRequest("a walnut chair", defaults)).toMatchObject({
      type: "model3d",
      provider: "defaultProvider",
      model: "default-model3d",
      input: { prompt: "a walnut chair" },
    })
  })

  it("uses the requested media type when normalizing string generation inputs", () => {
    expect(normalizeGenerationRequest("a product demo shot", defaults, "video")).toMatchObject({
      type: "video",
      input: { prompt: "a product demo shot" },
    })
    expect(normalizeGenerationRequest("hello world", defaults, "audio")).toMatchObject({
      type: "audio",
      input: { text: "hello world" },
    })
    expect(normalizeGenerationRequest("a walnut chair", defaults, "model3d")).toMatchObject({
      type: "model3d",
      input: { prompt: "a walnut chair" },
    })
  })

  it("keeps explicit request fields above profile defaults", () => {
    expect(
      normalizeImageRequest(
        {
          profile: "hdImage",
          prompt: "a clean product render",
          model: "explicit-image",
          width: 1536,
          providerOptions: { watermark: false },
        },
        defaults,
      ),
    ).toMatchObject({
      model: "explicit-image",
      options: {
        width: 1536,
        height: 2048,
        count: 1,
        quality: "high",
      },
      providerOptions: { watermark: false },
    })
  })

  it("does not pass profile through to the normalized provider request", () => {
    const request = normalizeImageRequest(
      {
        profile: "hdImage",
        prompt: "a clean product render",
      },
      defaults,
    )

    expect("profile" in request).toBe(false)
  })

  it("rejects unknown profiles", () => {
    expect(() =>
      normalizeImageRequest(
        {
          profile: "missing",
          prompt: "a clean product render",
        },
        defaults,
      ),
    ).toThrow("Unknown profile: missing")
    expect(() =>
      normalizeImageRequest(
        {
          profile: "toString",
          prompt: "a clean product render",
        },
        defaults,
      ),
    ).toThrow("Unknown profile: toString")
  })

  it("rejects requests when provider cannot be resolved", () => {
    expect(() =>
      normalizeImageRequest(
        {
          model: "default-image",
          prompt: "a clean product render",
        },
        undefined,
      ),
    ).toThrow("Missing provider for image request")
  })

  it("rejects requests when model cannot be resolved", () => {
    expect(() =>
      normalizeVideoRequest(
        {
          provider: "defaultProvider",
          prompt: "a product demo shot",
        },
        undefined,
      ),
    ).toThrow("Missing model for video request")
  })

  it("rejects non-image profiles for image shorthand", () => {
    expect(() =>
      normalizeImageRequest(
        {
          profile: "videoFast",
          prompt: "a clean product render",
        },
        defaults,
      ),
    ).toThrow("Profile videoFast resolves to video, not image")
  })

  it("rejects structured requests whose type conflicts with the profile type", () => {
    expect(() =>
      normalizeGenerationRequest(
        {
          type: "image",
          profile: "videoFast",
          provider: "defaultProvider",
          model: "default-image",
          input: { prompt: "a clean product render" },
        },
        defaults,
      ),
    ).toThrow("Profile videoFast resolves to video, not image")
  })

  it("rejects structured requests whose type conflicts with typed facades", () => {
    const imageMismatch = {
      type: "video",
      provider: "defaultProvider",
      model: "default-video",
      input: { prompt: "a product demo shot" },
    } as unknown as Parameters<typeof normalizeImageRequest>[0]
    const videoMismatch = {
      type: "audio",
      provider: "defaultProvider",
      model: "default-audio",
      input: { text: "hello" },
    } as unknown as Parameters<typeof normalizeVideoRequest>[0]
    const audioMismatch = {
      type: "model3d",
      provider: "defaultProvider",
      model: "default-model3d",
      input: { prompt: "chair" },
    } as unknown as Parameters<typeof normalizeAudioRequest>[0]
    const model3dMismatch = {
      type: "image",
      provider: "defaultProvider",
      model: "default-image",
      input: { prompt: "chair" },
    } as unknown as Parameters<typeof normalizeModel3DRequest>[0]

    expect(() =>
      normalizeImageRequest(imageMismatch, defaults),
    ).toThrow("Request type video cannot be used with image facade")
    expect(() =>
      normalizeVideoRequest(videoMismatch, defaults),
    ).toThrow("Request type audio cannot be used with video facade")
    expect(() =>
      normalizeAudioRequest(audioMismatch, defaults),
    ).toThrow("Request type model3d cannot be used with audio facade")
    expect(() =>
      normalizeModel3DRequest(model3dMismatch, defaults),
    ).toThrow("Request type image cannot be used with model3d facade")
  })

  it("defaults structured requests to image when type is omitted", () => {
    expect(
      normalizeGenerationRequest(
        {
          provider: "defaultProvider",
          model: "default-image",
          input: { prompt: "a clean product render" },
        },
        defaults,
      ),
    ).toMatchObject({
      type: "image",
      input: { prompt: "a clean product render" },
    })
  })
})
