# 快速开始

## 安装

```bash
npm install @miragari/ai-media-router
```

## 创建客户端

```ts
import { createMediaRouter } from "@miragari/ai-media-router"

const client = createMediaRouter({
  provider: "openai",
  providers: {
    openai: process.env.OPENAI_API_KEY!,
  },
})
```

## 发起第一张图片请求

```ts
const result = await client.generateImage({
  prompt: "一张电影感白色台灯产品图",
  width: 1024,
  height: 1024,
  quality: "high",
})
```

## 下一步

- Provider 开发请看 [../../packages/providers/README.md](../../packages/providers/README.md)
- 发布流程请看 [./releasing.md](./releasing.md)
- 公开站点请看 <https://zehight.github.io/ai-media-router/>
