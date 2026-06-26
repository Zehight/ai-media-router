# AI Media Router

[![CI](https://github.com/Zehight/ai-media-router/actions/workflows/ci.yml/badge.svg)](https://github.com/Zehight/ai-media-router/actions/workflows/ci.yml)
[![Release Packages](https://github.com/Zehight/ai-media-router/actions/workflows/release.yml/badge.svg)](https://github.com/Zehight/ai-media-router/actions/workflows/release.yml)
[![Deploy Docs Site](https://github.com/Zehight/ai-media-router/actions/workflows/pages.yml/badge.svg)](https://github.com/Zehight/ai-media-router/actions/workflows/pages.yml)
[![npm version](https://img.shields.io/npm/v/%40miragari%2Fai-media-router)](https://www.npmjs.com/package/@miragari/ai-media-router)

[中文文档](./README.zh-CN.md) · [Docs](./docs/en/getting-started.md) · [Provider Guide](./packages/providers/README.md) · [GitHub Pages](https://zehight.github.io/ai-media-router/)

AI Media Router is a unified TypeScript SDK for multi-provider AI image, video, audio, and 3D generation behind one stable API.

## Why AI Media Router

- One request model across multiple AI media providers
- Clear separation between stable cross-provider parameters and provider-specific knobs
- Stateless async job lifecycle with normalized results
- Provider plugin architecture for built-in adapters and custom integrations
- Monorepo packages that stay small and composable

## Packages

- `@miragari/ai-media-router-core`: shared types, validation, dimensions, errors, and provider contracts
- `@miragari/ai-media-router-client`: router client, polling helpers, batching, profiles, and defaults
- `@miragari/ai-media-router`: built-in providers plus `createMediaRouter()`

## Install

```bash
npm install @miragari/ai-media-router
```

Or install only the layers you need:

```bash
npm install @miragari/ai-media-router-core @miragari/ai-media-router-client
```

## Quick Start

```ts
import { createMediaRouter } from "@miragari/ai-media-router"

const client = createMediaRouter({
  provider: "openai",
  providers: {
    openai: process.env.OPENAI_API_KEY!,
  },
  image: {
    model: "gpt-image-1",
  },
})

const result = await client.generateImage({
  prompt: "A minimal product render of a matte white desk lamp",
  width: 1024,
  height: 1024,
  quality: "high",
})

console.log(result.asset)
```

## Standard Request Shape

AI Media Router keeps stable request fields in `input` and `options`, and pushes unstable provider-native switches into `providerOptions`.

- Image: `prompt`, `negativePrompt`, `images`, `mask`, `width`, `height`, `count`, `seed`, `quality`, `outputFormat`
- Video: `prompt`, `image`, `images`, `video`, `videos`, `audio`, `duration`, `fps`, `mode`, `quality`
- Audio: `prompt`, `text`, `audio`, `audios`, `duration`, `voice`, `format`, `sampleRate`
- Model3D: `prompt`, `images`, `model`, `format`, `quality`, `texture`

## Built-in Provider Example

```ts
import { createMediaRouter } from "@miragari/ai-media-router"

const client = createMediaRouter({
  providers: {
    openai: process.env.OPENAI_API_KEY!,
    qwen: process.env.DASHSCOPE_API_KEY!,
  },
  profiles: {
    thumbnail: {
      type: "image",
      width: 1024,
      height: 1024,
      quality: "high",
    },
    teaserVideo: {
      type: "video",
      provider: "qwen",
      model: "wan2.7",
      options: { duration: 5 },
    },
  },
})
```

## Documentation

- English quick start: [docs/en/getting-started.md](./docs/en/getting-started.md)
- Chinese quick start: [docs/zh-CN/getting-started.md](./docs/zh-CN/getting-started.md)
- Releasing packages: [docs/en/releasing.md](./docs/en/releasing.md)
- Provider authoring: [packages/providers/README.md](./packages/providers/README.md)
- Community guide: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Repository Structure

```text
packages/
  core/        Shared protocol and validation layer
  client/      Runtime router and normalization layer
  providers/   Built-in providers and factory helpers
examples/
  basic/       Small usage sample
site/          GitHub Pages static website
docs/          Bilingual written documentation
```

## Releases

This repository includes:

- GitHub Actions CI
- GitHub Pages deployment
- Changesets-based package release workflow

Maintainers can publish packages with:

```bash
pnpm changeset
pnpm version-packages
pnpm release:publish
```

## License

This project is released under the [MIT License](./LICENSE).
