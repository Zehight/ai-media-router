# Getting Started

## Install

```bash
npm install @miragari/ai-media-router
```

## First client

```ts
import { createMediaRouter } from "@miragari/ai-media-router"

const client = createMediaRouter({
  provider: "openai",
  providers: {
    openai: process.env.OPENAI_API_KEY!,
  },
})
```

## First image request

```ts
const result = await client.generateImage({
  prompt: "A cinematic product render of a white lamp",
  width: 1024,
  height: 1024,
  quality: "high",
})
```

## Next steps

- Learn provider authoring in [../../packages/providers/README.md](../../packages/providers/README.md)
- Read release guidance in [./releasing.md](./releasing.md)
- Browse the public site at <https://zehight.github.io/ai-media-router/>
