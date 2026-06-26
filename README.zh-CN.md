# MediaRouter

[![CI](https://github.com/Zehight/mediaRouter/actions/workflows/ci.yml/badge.svg)](https://github.com/Zehight/mediaRouter/actions/workflows/ci.yml)
[![Release Packages](https://github.com/Zehight/mediaRouter/actions/workflows/release.yml/badge.svg)](https://github.com/Zehight/mediaRouter/actions/workflows/release.yml)
[![Deploy Docs Site](https://github.com/Zehight/mediaRouter/actions/workflows/pages.yml/badge.svg)](https://github.com/Zehight/mediaRouter/actions/workflows/pages.yml)
[![npm version](https://img.shields.io/npm/v/%40miragari%2Fproviders)](https://www.npmjs.com/package/@miragari/providers)

[English README](./README.md) · [中文文档入口](./docs/zh-CN/getting-started.md) · [Provider 开发文档](./packages/providers/README.md) · [GitHub Pages](https://zehight.github.io/mediaRouter/)

MediaRouter 是一个 TypeScript 优先的多媒体生成路由 SDK，用一套稳定接口统一封装图片、视频、音频和 3D 生成提供商。

## 为什么做它

- 用统一请求模型接多个 AI 媒体生成平台
- 把跨平台稳定参数和 provider 私有参数清晰拆开
- 提供无状态异步任务生命周期和统一结果结构
- 用插件机制支持内置 provider 和自定义适配层
- Monorepo 拆分清晰，既可整包使用，也可分层接入

## 包结构

- `@miragari/core`：共享类型、校验、尺寸系统、错误模型、provider 合约
- `@miragari/client`：路由客户端、轮询、批量、profile、默认值系统
- `@miragari/providers`：内置 provider 以及 `createMediaRouter()`

## 安装

```bash
npm install @miragari/providers
```

如果你只想按层接入：

```bash
npm install @miragari/core @miragari/client
```

## 快速开始

```ts
import { createMediaRouter } from "@miragari/providers"

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
  prompt: "一张极简风格的白色台灯产品图",
  width: 1024,
  height: 1024,
  quality: "high",
})

console.log(result.asset)
```

## 统一参数模型

MediaRouter 把稳定字段放在 `input` 和 `options` 里，把 provider 自有且不稳定的开关放进 `providerOptions`。

- 图片：`prompt`、`negativePrompt`、`images`、`mask`、`width`、`height`、`count`、`seed`、`quality`、`outputFormat`
- 视频：`prompt`、`image`、`images`、`video`、`videos`、`audio`、`duration`、`fps`、`mode`、`quality`
- 音频：`prompt`、`text`、`audio`、`audios`、`duration`、`voice`、`format`、`sampleRate`
- 3D：`prompt`、`images`、`model`、`format`、`quality`、`texture`

## 内置 Provider 示例

```ts
import { createMediaRouter } from "@miragari/providers"

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

## 文档导航

- 中文快速开始：[docs/zh-CN/getting-started.md](./docs/zh-CN/getting-started.md)
- English quick start：[docs/en/getting-started.md](./docs/en/getting-started.md)
- 发布流程：[docs/zh-CN/releasing.md](./docs/zh-CN/releasing.md)
- Provider 开发指南：[packages/providers/README.md](./packages/providers/README.md)
- 仓库协作说明：[CONTRIBUTING.md](./CONTRIBUTING.md)

## 仓库结构

```text
packages/
  core/        协议与校验层
  client/      路由与运行时层
  providers/   内置 provider 与工厂函数
examples/
  basic/       最小使用示例
site/          GitHub Pages 静态站点
docs/          中英双语文档
```

## Release 机制

仓库已经补齐：

- GitHub Actions CI
- GitHub Pages 部署
- 基于 Changesets 的 npm 包发布流程

维护者发布时可以执行：

```bash
pnpm changeset
pnpm version-packages
pnpm release:publish
```

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。
